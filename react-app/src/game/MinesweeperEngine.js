/**
 * 扫雷（Minesweeper，纯逻辑引擎，与 UI 解耦）
 * 架构对齐 ReversiEngine：回调通信 + pause/resume 时钟基准 + tick 超时 + dispose。
 * 状态：start → playing ⇄ paused → over（win | lose | timeout）。
 *
 * 规则：首点安全（首次翻开时布雷，排除首点及其八邻域）；翻开数字格显示相邻雷数，
 * 翻开空白格自动展开连通区域；可插旗标记；踩雷即负；所有安全格翻开始判胜。
 * 撤销：记录最近的操作（翻开含洪泛格、插旗/撤旗），最多回退 3 次，回退首次翻开会
 * 重置雷区与计时，允许换一个首点重新开局。
 *
 * 约束卡落实：
 *   - localStorage 持久化由页面负责（最佳/埋点两键）。
 *   - 切后台/失焦：页面调用 pause()，计时冻结。
 *   - 撤销/回退：引擎内置 undo 栈与次数上限。
 */

export const DIFFICULTY = {
  easy: { label: '轻松', desc: '7×7 · 8 雷', rows: 7, cols: 7, mines: 8, baseScore: 600, limitSec: 180 },
  normal: { label: '挑战', desc: '8×8 · 12 雷', rows: 8, cols: 8, mines: 12, baseScore: 900, limitSec: 180 },
  hard: { label: '专家', desc: '8×10 · 20 雷', rows: 10, cols: 8, mines: 20, baseScore: 1200, limitSec: 180 },
}

export const MINESWEEPER = {
  TICK_MS: 250,
  SEC_PENALTY: 2,
  MIN_SCORE: 100,
  MIN_TAP_INTERVAL_MS: 120,
  UNDO_LIMIT: 3,
}

export class MinesweeperEngine {
  /**
   * @param {Object} cb onState(snapshot) / onGameOver(score, elapsed, result) / onPause()
   * @param {Object} options { random, now } 注入随机源与时钟，便于单测
   */
  constructor(cb = {}, options = {}) {
    this.cb = cb
    this.random = options.random || Math.random
    this._now = options.now || Date.now

    this.state = 'start'
    this.level = 'easy'
    this._cfg = DIFFICULTY.easy
    this._resetBoard()
  }

  /** 按当前难度重置棋盘与全部运行时数据（不动难度配置） */
  _resetBoard() {
    const { rows, cols, mines } = this._cfg
    this.rows = rows
    this.cols = cols
    this.mines = mines
    this.size = rows * cols
    this.mineArr = new Uint8Array(this.size)
    this.adjArr = new Uint8Array(this.size)
    this.revealedArr = new Uint8Array(this.size)
    this.flaggedArr = new Uint8Array(this.size)

    this.minesPlaced = false
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0

    this.flagsUsed = 0
    this.safeTotal = this.size - mines
    this.safeRevealed = 0
    this.boomIdx = -1
    this.moves = 0

    this.result = null
    this.undoLeft = MINESWEEPER.UNDO_LIMIT
    this.undoStack = []
    this.lastAction = null
    this.lastReveal = null
    this.lastFlag = null
    this.lastUndo = null
    this.lastTapAt = -Infinity
  }

  start(level = 'easy') {
    const key = level in DIFFICULTY ? level : 'easy'
    this._cfg = DIFFICULTY[key]
    this.level = key
    this._resetBoard()
    this.state = 'playing'
    this.lastAction = 'start'
    this._emit()
  }

  /**
   * 翻开一格。首次翻开时才布雷，并保证首点及其八邻域无雷。
   * @param {number} idx 0 ~ rows*cols-1
   * @returns {boolean} true=已执行（含踩雷），false=非法/节流/非 playing
   */
  reveal(idx) {
    if (this.state !== 'playing') return false
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.size) return false
    if (this.revealedArr[idx] || this.flaggedArr[idx]) return false
    if (this._now() - this.lastTapAt < MINESWEEPER.MIN_TAP_INTERVAL_MS) return false
    this.lastTapAt = this._now()

    const first = !this.minesPlaced
    if (first) this._placeMines(idx)
    if (!this.started) {
      this.started = true
      this.resumeAt = this._now() - this.elapsedBase
    }

    if (this.mineArr[idx]) {
      this.revealedArr[idx] = 1
      this.boomIdx = idx
      this.moves += 1
      this.lastReveal = { idx, count: 1, flooded: false, boom: true }
      this._finish('lose')
      return true
    }

    const opened = this._flood(idx)
    this.safeRevealed += opened.length
    this.moves += 1
    this.undoStack.push({ type: 'reveal', indices: opened, first })
    this.lastFlag = null
    this.lastUndo = null
    this.lastReveal = { idx, count: opened.length, flooded: opened.length > 1, boom: false }

    if (this.safeRevealed >= this.safeTotal) {
      this.lastAction = 'win'
      this._finish('win')
      return true
    }
    this.lastAction = 'reveal'
    this._emit()
    return true
  }

  /**
   * 插旗 / 撤旗（仅未翻开的格子；旗子数量上限等于雷数）。
   * @returns {boolean} true=已执行
   */
  toggleFlag(idx) {
    if (this.state !== 'playing') return false
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.size) return false
    if (this.revealedArr[idx]) return false
    if (this._now() - this.lastTapAt < MINESWEEPER.MIN_TAP_INTERVAL_MS) return false
    const prev = this.flaggedArr[idx]
    if (!prev && this.flagsUsed >= this.mines) return false
    this.lastTapAt = this._now()

    this.flaggedArr[idx] = prev ? 0 : 1
    this.flagsUsed += prev ? -1 : 1
    this.undoStack.push({ type: 'flag', idx, prev: prev ? 1 : 0 })
    this.lastAction = prev ? 'unflag' : 'flag'
    this.lastFlag = { idx, flagged: !prev }
    this.lastReveal = null
    this.lastUndo = null
    this._emit()
    return true
  }

  /**
   * 回退上一次操作：翻开则把本步展开的格子全部盖回；插旗则恢复旗子状态。
   * 回退「首次翻开」会重置雷区与计时，允许换首点重开。
   * @returns {boolean} true=已回退
   */
  undo() {
    if (this.state !== 'playing') return false
    if (this.undoLeft <= 0 || !this.undoStack.length) return false
    if (this._now() - this.lastTapAt < MINESWEEPER.MIN_TAP_INTERVAL_MS) return false

    const action = this.undoStack.pop()
    if (action.type === 'reveal') {
      this.moves = Math.max(0, this.moves - 1)
      if (action.first) {
        // 首次翻开被回退：雷区回到未生成状态，计时归零，换首点重新开始
        this.mineArr.fill(0)
        this.adjArr.fill(0)
        this.revealedArr.fill(0)
        this.minesPlaced = false
        this.started = false
        this.elapsedBase = 0
        this.resumeAt = 0
        this.safeRevealed = 0
      } else {
        for (const i of action.indices) this.revealedArr[i] = 0
        this.safeRevealed -= action.indices.length
      }
    } else {
      this.flaggedArr[action.idx] = action.prev
      this.flagsUsed += action.prev ? 1 : -1
    }

    this.undoLeft -= 1
    this.moves = Math.max(0, this.moves - 1)
    this.lastAction = 'undo'
    this.lastUndo = { type: action.type }
    this.lastReveal = null
    this.lastFlag = null
    this._emit()
    return true
  }

  /** 页面每 TICK_MS 调用：刷新倒计时并判定超时 */
  tick() {
    if (this.state !== 'playing' || !this.started) return
    if (this._elapsed() >= this._cfg.limitSec) {
      this._finish('timeout')
      return
    }
    this._emit()
  }

  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    if (this.started) this.elapsedBase += this._now() - this.resumeAt
    this.lastAction = 'pause'
    this.cb.onPause?.()
    this._emit()
  }

  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    if (this.started) this.resumeAt = this._now()
    this.lastAction = 'resume'
    this._emit()
  }

  dispose() {
    this.cb = {}
  }

  getSnapshot() {
    const remaining = Math.max(0, Math.ceil(this._cfg.limitSec - this._elapsed()))
    const cells = []
    for (let i = 0; i < this.size; i++) {
      cells.push({
        idx: i,
        adj: this.adjArr[i],
        revealed: this.revealedArr[i] === 1,
        flagged: this.flaggedArr[i] === 1,
        // 局末（胜/负）才公开雷位；超时不公开，避免误导
        mine: this.state === 'over' && this.result !== 'timeout' ? this.mineArr[i] === 1 : false,
        boom: this.boomIdx === i,
      })
    }
    return {
      state: this.state,
      level: this.level,
      rows: this.rows,
      cols: this.cols,
      mines: this.mines,
      flagsUsed: this.flagsUsed,
      safeTotal: this.safeTotal,
      safeRevealed: this.safeRevealed,
      cells,
      moves: this.moves,
      elapsed: this._elapsed(),
      remaining,
      limitSec: this._cfg.limitSec,
      result: this.result,
      score: this.state === 'over' && this.result === 'win' ? this._score() : null,
      undoLeft: this.undoLeft,
      started: this.started,
      lastAction: this.lastAction,
      lastReveal: this.lastReveal ? { ...this.lastReveal } : null,
      lastFlag: this.lastFlag ? { ...this.lastFlag } : null,
      lastUndo: this.lastUndo ? { ...this.lastUndo } : null,
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }

  /** 首次翻开时布雷：排除首点及其八邻域；不足时退回仅排除首点 */
  _placeMines(firstIdx) {
    const forbidden = new Set([firstIdx, ...this._neighbors(firstIdx)])
    let candidates = []
    for (let i = 0; i < this.size; i++) if (!forbidden.has(i)) candidates.push(i)
    if (candidates.length < this.mines) {
      candidates = []
      for (let i = 0; i < this.size; i++) if (i !== firstIdx) candidates.push(i)
    }
    // Fisher–Yates 部分洗牌
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(this.random() * (i + 1)))
      const tmp = candidates[i]
      candidates[i] = candidates[j]
      candidates[j] = tmp
    }
    for (let k = 0; k < this.mines; k++) this.mineArr[candidates[k]] = 1
    this._recomputeAdj()
    this.minesPlaced = true
  }

  _recomputeAdj() {
    for (let i = 0; i < this.size; i++) {
      if (this.mineArr[i]) {
        this.adjArr[i] = 0
        continue
      }
      let count = 0
      for (const n of this._neighbors(i)) if (this.mineArr[n]) count += 1
      this.adjArr[i] = count
    }
  }

  _neighbors(idx) {
    const r0 = Math.floor(idx / this.cols)
    const c0 = idx % this.cols
    const out = []
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const r = r0 + dr
        const c = c0 + dc
        if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) out.push(r * this.cols + c)
      }
    }
    return out
  }

  /** 翻开并洪泛展开：空白格（相邻 0 雷）扩散到边界；已插旗的格子不自动翻开 */
  _flood(start) {
    const out = []
    const stack = [start]
    while (stack.length) {
      const i = stack.pop()
      if (this.revealedArr[i] || this.flaggedArr[i]) continue
      this.revealedArr[i] = 1
      out.push(i)
      if (this.adjArr[i] === 0) {
        for (const n of this._neighbors(i)) {
          if (!this.revealedArr[n] && !this.flaggedArr[n]) stack.push(n)
        }
      }
    }
    return out
  }

  _finish(result) {
    if (this.started) this.elapsedBase += this._now() - this.resumeAt
    this.state = 'over'
    this.result = result
    if (result === 'win') {
      // 胜利时把剩余雷位标记出来，便于结算页/棋盘展示
      for (let i = 0; i < this.size; i++) {
        if (!this.mineArr[i]) this.revealedArr[i] = 1
      }
      this.lastAction = 'win'
    } else {
      this.lastAction = result
    }
    this._emit()
    this.cb.onGameOver?.(result === 'win' ? this._score() : 0, this._elapsed(), result)
  }

  /** 胜利计分：`max(100, baseScore − floor(elapsed)×2)` */
  _score() {
    const penalty = Math.floor(this._elapsed()) * MINESWEEPER.SEC_PENALTY
    return Math.max(MINESWEEPER.MIN_SCORE, Math.round(this._cfg.baseScore - penalty))
  }

  _elapsed() {
    const running = this.state === 'playing' && this.started ? this._now() - this.resumeAt : 0
    return Math.round(((this.elapsedBase + running) / 1000) * 10) / 10
  }
}
