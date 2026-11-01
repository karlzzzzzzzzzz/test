/**
 * 数字华容道引擎（3×3 滑块拼图，纯逻辑，不依赖 React / DOM / Canvas）
 * 架构对齐 WhackEngine / MemoryEngine：回调通信 + 暂停冻结 + dispose 清理。
 *
 * 状态：idle → playing → paused → over
 * 计时：首次有效移动后启动，Date.now() 双字段（elapsedBase + resumeAt）驱动，
 * 100ms 轮询且仅在显示值（0.1s）变化时推送，切后台恢复不跳秒。
 */

export const PUZZLE = {
  SIZE: 3,
  CELLS: 9,
  SHUFFLE_MOVES: 80, // 打乱：从完成态随机合法移动次数
  RESHUFFLE_MAX: 5, // 乱度不足时最多重打乱次数
  RESHUFFLE_EXTRA: 20, // 5 次仍未达标时追加的合法移动
  MIN_CORRECT: 7, // 正确位置方块 ≥7 视为乱度不足
  SOLVE_EXTRA: 3, // 打乱后仍为完成态时强制追加的移动
  SWIPE_MIN_PX: 24, // 滑动阈值（对齐 2048 / 贪吃蛇）
  BUSY_MS: 200, // 相邻两拍的输入锁，防连续点按重复计步
  TICK_MS: 100,
}

/** 完成态：1~8 按行优先排列，右下角为空格（0） */
export const SOLVED_BOARD = [1, 2, 3, 4, 5, 6, 7, 8, 0]

// 本会话最佳步数：模块级内存值，页面刷新即清空（本页不新增任何存储键）
let sessionBestSteps = 0

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' }
const DIRS = ['up', 'down', 'left', 'right']

const blankIndexOf = (board) => board.indexOf(0)
const rowOf = (i) => Math.floor(i / PUZZLE.SIZE)
const colOf = (i) => i % PUZZLE.SIZE
const isSolved = (board) => board.every((v, i) => v === SOLVED_BOARD[i])
const correctCount = (board) => board.reduce((n, v, i) => (v === SOLVED_BOARD[i] ? n + 1 : n), 0)

/** 空格朝 dir 移动一步后的落点索引；越界返回 -1 */
function targetOf(blank, dir) {
  const r = rowOf(blank)
  const c = colOf(blank)
  if (dir === 'up' && r > 0) return blank - PUZZLE.SIZE
  if (dir === 'down' && r < PUZZLE.SIZE - 1) return blank + PUZZLE.SIZE
  if (dir === 'left' && c > 0) return blank - 1
  if (dir === 'right' && c < PUZZLE.SIZE - 1) return blank + 1
  return -1
}

export class PuzzleEngine {
  /**
   * @param {Object} cb 回调：onState(snapshot) / onElapsed(ms) / onWin(result) / onPause(reason)
   */
  constructor(cb = {}) {
    this.cb = cb
    this.state = 'idle'
    this.board = [...SOLVED_BOARD]
    this.steps = 0
    this.startedAt = 0 // 首次有效移动的时间戳，0 表示计时未启动
    this.elapsedBase = 0
    this.resumeAt = 0
    this.pausedElapsed = 0
    this.busyUntil = 0
    this.lastMovedIdx = -1
    this.lastEmittedTenth = -1
    this.tickTimer = null
    this.result = null
  }

  /** 开局：重新打乱并清空步数 / 计时 */
  start() {
    clearInterval(this.tickTimer)
    this.tickTimer = null
    this.board = this._shuffle()
    this.state = 'playing'
    this.steps = 0
    this.startedAt = 0
    this.elapsedBase = 0
    this.resumeAt = 0
    this.pausedElapsed = 0
    this.busyUntil = 0
    this.lastMovedIdx = -1
    this.lastEmittedTenth = -1
    this.result = null
    this._emit()
  }

  /**
   * 点按某个格子（鼠标 / 触控 / 键盘统一入口）
   * 仅与空格曼哈顿距离 = 1 的方块响应，其余忽略且不计步。
   * @returns {'moved'|'ignored'}
   */
  tap(idx) {
    if (!this._canInput()) return 'ignored'
    if (!Number.isInteger(idx) || idx < 0 || idx >= PUZZLE.CELLS) return 'ignored'
    if (this.board[idx] === 0) return 'ignored'
    const blank = blankIndexOf(this.board)
    const dist = Math.abs(rowOf(idx) - rowOf(blank)) + Math.abs(colOf(idx) - colOf(blank))
    if (dist !== 1) return 'ignored'
    this._commit(idx, blank)
    return 'moved'
  }

  /**
   * 滑动：空格沿 dir 方向移动一格（up / down / left / right）
   * @returns {'moved'|'ignored'}
   */
  move(dir) {
    if (!this._canInput()) return 'ignored'
    if (!OPPOSITE[dir]) return 'ignored'
    const blank = blankIndexOf(this.board)
    const target = targetOf(blank, dir)
    if (target < 0) return 'ignored'
    this._commit(target, blank)
    return 'moved'
  }

  /** 暂停（自动 / 手动同路径，仅 playing 生效，幂等） */
  pause(reason = 'manual') {
    if (this.state !== 'playing') return
    if (this.startedAt) this.pausedElapsed = this._elapsedMs()
    clearInterval(this.tickTimer)
    this.tickTimer = null
    this.state = 'paused'
    this.cb.onPause?.(reason)
    this._emit()
  }

  /** 恢复：重置时钟基准，暂停时长不计入 */
  resume() {
    if (this.state !== 'paused') return
    // 把暂停前累计的用时并入基准，避免恢复后从 0 重新计时
    this.elapsedBase = this._elapsedMs()
    this.resumeAt = Date.now()
    this.state = 'playing'
    this.lastEmittedTenth = Math.floor(this.elapsedBase / 100)
    if (this.startedAt) this._startTimer()
    this._emit()
  }

  dispose() {
    clearInterval(this.tickTimer)
    this.tickTimer = null
  }

  getSnapshot() {
    const elapsedMs = this._elapsedMs()
    return {
      state: this.state,
      board: [...this.board],
      steps: this.steps,
      elapsedMs,
      elapsedSec: Math.round(elapsedMs / 100) / 10,
      bestSteps: sessionBestSteps,
      hasBest: sessionBestSteps > 0,
      lastMovedIdx: this.lastMovedIdx,
      result: this.result,
    }
  }

  _canInput() {
    if (this.state !== 'playing') return false
    return Date.now() < this.busyUntil ? false : true
  }

  _commit(tileIdx, blankIdx) {
    const now = Date.now()
    this.board[blankIdx] = this.board[tileIdx]
    this.board[tileIdx] = 0
    this.steps += 1
    this.lastMovedIdx = blankIdx
    this.busyUntil = now + PUZZLE.BUSY_MS

    // 首次有效移动启动计时
    if (!this.startedAt) {
      this.startedAt = now
      this.resumeAt = now
      this.elapsedBase = 0
      this.lastEmittedTenth = 0
      this._startTimer()
    }

    if (isSolved(this.board)) {
      this._finish()
      return
    }
    this._emit()
  }

  _elapsedMs() {
    if (!this.startedAt) return 0
    if (this.state === 'paused' || this.state === 'over') return this.pausedElapsed
    return this.elapsedBase + Math.max(0, Date.now() - this.resumeAt)
  }

  _startTimer() {
    clearInterval(this.tickTimer)
    this.tickTimer = setInterval(() => this._tick(), PUZZLE.TICK_MS)
  }

  _tick() {
    if (this.state !== 'playing') return
    const tenth = Math.floor(this._elapsedMs() / 100)
    if (tenth === this.lastEmittedTenth) return // 秒值/0.1s 未变化不推送
    this.lastEmittedTenth = tenth
    this.cb.onElapsed?.(this._elapsedMs())
  }

  _finish() {
    clearInterval(this.tickTimer)
    this.tickTimer = null
    const elapsedMs = this._elapsedMs()
    this.pausedElapsed = elapsedMs
    this.state = 'over'

    const prevBest = sessionBestSteps
    const newRecord = prevBest > 0 && this.steps < prevBest
    if (prevBest === 0 || newRecord) sessionBestSteps = this.steps

    this.result = {
      steps: this.steps,
      elapsedMs,
      bestSteps: sessionBestSteps,
      newRecord,
    }
    this.cb.onWin?.(this.result)
    this._emit()
  }

  /**
   * 打乱：从完成态随机合法移动（禁止即时反向撤回）
   * 乱度不足（正确位置 ≥7 或仍为完成态）时重打乱，最多 5 次，仍未达标追加 20 次移动
   */
  _shuffle() {
    let candidate = [...SOLVED_BOARD]
    for (let attempt = 0; attempt < PUZZLE.RESHUFFLE_MAX; attempt += 1) {
      candidate = this._randomWalk([...SOLVED_BOARD], PUZZLE.SHUFFLE_MOVES)
      if (correctCount(candidate) < PUZZLE.MIN_CORRECT && !isSolved(candidate)) return candidate
    }
    candidate = this._randomWalk(candidate, PUZZLE.RESHUFFLE_EXTRA)
    if (isSolved(candidate)) candidate = this._randomWalk(candidate, PUZZLE.SOLVE_EXTRA)
    return candidate
  }

  _randomWalk(board, moves) {
    const b = [...board]
    let banned = ''
    for (let i = 0; i < moves; i += 1) {
      const blank = blankIndexOf(b)
      const dirs = DIRS.filter((d) => targetOf(blank, d) >= 0 && d !== banned)
      if (!dirs.length) break
      const dir = dirs[Math.floor(Math.random() * dirs.length)]
      const target = targetOf(blank, dir)
      b[blank] = b[target]
      b[target] = 0
      banned = OPPOSITE[dir] // 下一步不能撤回本次移动
    }
    return b
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }
}
