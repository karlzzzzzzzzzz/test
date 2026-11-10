/**
 * 数独（Sudoku，纯逻辑引擎，与 UI 解耦）
 * 架构对齐 MazeEngine：回调通信 + pause/resume 时钟基准 + tick 超时 + dispose。
 * 状态：start → playing ⇄ paused → over（win | fail | timeout）。
 *
 * 规则：
 *  - 回溯法生成终盘（行/列/宫各含 1~9 不重复），随机源注入保证可测。
 *  - 按中心对称（180° 旋转，idx ↔ 80-idx）成对挖空；每挖一对用解计数器
 *    （计到 2 即停）复核唯一解，不唯一则回退该对；单盘尝试上限 200 次，
 *    尝试耗尽重新生成终盘，至多 3 次，仍失败抛错。中心格（idx 40）不挖，
 *    保证挖空数恒为偶数，与三档 36/46/52 对齐。
 *  - 填入与终解比对：正确 → 锁定已确认、清空本格笔记并剔除同行/列/宫同候选；
 *    错误 → 不写入格子，错误 +1、扣 30 分；错误满 3 次判负（fail）。
 *  - 提示每局 3 次：填入选中空格（未选中取第一个空格）正解，扣 50 分。
 *  - 撤销栈 ≤50 步，回退填入/擦除/笔记/提示；不恢复错误计数与已扣分。
 *  - 计分：max(100, 基准 − floor(用时秒)×2 − 错误×30 − 提示×50)；判负/超时 0 分。
 */

export const TIERS = {
  easy: { label: '轻松', blanks: 36, givens: 45, limitSec: 300, baseScore: 600 },
  normal: { label: '挑战', blanks: 46, givens: 35, limitSec: 480, baseScore: 900 },
  hard: { label: '专家', blanks: 52, givens: 29, limitSec: 600, baseScore: 1200 },
}

export const SUDOKU = {
  TICK_MS: 250, // 页面侧倒计时刷新间隔
  ERROR_LIMIT: 3, // 错误满 3 次判负
  ERROR_PENALTY: 30, // 每次错误扣 30 分
  HINT_PENALTY: 50, // 每次提示扣 50 分
  HINT_LIMIT: 3,
  SEC_PENALTY: 2, // 每秒扣 2 分
  MIN_SCORE: 100,
  UNDO_LIMIT: 50,
  DIG_ATTEMPTS: 200, // 单盘挖空尝试上限
  GEN_RETRY: 3, // 整盘重试上限
}

const FULL_MASK = 0x1ff // 1~9 位掩码
const ROWS = []
const COLS = []
const BOXES = []
const PEERS = [] // 每格同行/列/宫的其他格索引
for (let i = 0; i < 9; i++) {
  ROWS.push(Array.from({ length: 9 }, (_, c) => i * 9 + c))
  COLS.push(Array.from({ length: 9 }, (_, r) => r * 9 + i))
  BOXES.push(Array.from({ length: 9 }, (_, k) => {
    const br = Math.floor(i / 3) * 3
    const bc = (i % 3) * 3
    return (br + Math.floor(k / 3)) * 9 + bc + (k % 3)
  }))
}
const UNITS = [...ROWS, ...COLS, ...BOXES]
for (let idx = 0; idx < 81; idx++) {
  const set = new Set()
  for (const unit of UNITS) {
    if (unit.includes(idx)) for (const p of unit) if (p !== idx) set.add(p)
  }
  PEERS.push([...set])
}

export class SudokuEngine {
  /**
   * @param {Object} cb onState(snapshot) / onGameOver(score, elapsed, result) / onPause()
   * @param {Object} options { random, now } 注入随机源与时钟，便于单测
   */
  constructor(cb = {}, options = {}) {
    this.cb = cb
    this.random = options.random || Math.random
    this.now = options.now || Date.now

    this.state = 'start'
    this.tier = 'easy'
    this.solution = new Uint8Array(81)
    this.givens = new Uint8Array(81) // 1 = 已知格
    this.values = new Uint8Array(81) // 当前格内数字（0 = 空）
    this.confirmed = new Uint8Array(81) // 1 = 已确认（已知格恒为 1）
    this.notes = new Uint16Array(81) // 候选数位掩码
    this.errors = 0
    this.hintsLeft = SUDOKU.HINT_LIMIT
    this.hintUsed = 0
    this.undoStack = []
    this.result = null
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
    this.lastAction = null
    this.lastError = -1 // 最近一次错误填入的格子（页面做红标抖动）
    this.lastPlaced = -1 // 最近一次成功填入/提示的格子（页面自动跳下一格）
  }

  /**
   * 生成题目并开局（可反复调用，完全重置本局）。
   * @param {'easy'|'normal'|'hard'} tier 非法档位回退 easy
   * @param {string} action 起始动作标记（start / new）
   * @throws {Error} 多次重试仍无法得到唯一解题目时抛错，由页面进入错误态
   */
  start(tier = 'easy', action = 'start') {
    const key = tier in TIERS ? tier : 'easy'
    this.tier = key
    const blanks = TIERS[key].blanks

    let puzzle = null
    for (let attempt = 0; attempt < SUDOKU.GEN_RETRY && !puzzle; attempt++) {
      puzzle = this._generatePuzzle(blanks)
    }
    if (!puzzle) throw new Error('数独出题失败：挖空尝试耗尽')

    this.givens = puzzle.givens
    this.values = puzzle.values
    this.confirmed = Uint8Array.from(puzzle.givens)
    this.notes = new Uint16Array(81)
    this.errors = 0
    this.hintsLeft = SUDOKU.HINT_LIMIT
    this.hintUsed = 0
    this.undoStack = []
    this.result = null
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
    this.lastError = -1
    this.lastPlaced = -1
    this.state = 'playing'
    this.lastAction = action
    this._emit()
  }

  /**
   * 正式填入：与终解比对。
   * @returns {'placed'|'win'|'error'|'fail'|'blocked'|'ignored'}
   */
  place(idx, num) {
    if (this.state !== 'playing') return 'ignored'
    if (!this._editable(idx) || num < 1 || num > 9) return 'blocked'

    if (this.solution[idx] !== num) {
      this.errors += 1
      this.lastError = idx
      this.lastPlaced = -1
      this.lastAction = 'error'
      if (this.errors >= SUDOKU.ERROR_LIMIT) {
        this._finish('fail')
        return 'fail'
      }
      this._emit()
      return 'error'
    }

    this._startClock()
    this._applyFill(idx, num, 'place')
    if (this._isComplete()) {
      this._finish('win')
      return 'win'
    }
    this._emit()
    return 'placed'
  }

  /**
   * 笔记模式：切换候选数（不校验对错、不参与完成判定、不计错误）。
   * @returns {'toggled'|'blocked'|'ignored'}
   */
  toggleNote(idx, num) {
    if (this.state !== 'playing') return 'ignored'
    if (!this._editable(idx) || this.values[idx] !== 0 || num < 1 || num > 9) return 'blocked'
    const bit = 1 << (num - 1)
    const added = !(this.notes[idx] & bit)
    this.notes[idx] ^= bit
    this._pushUndo({ type: 'note', idx, bit, added })
    this.lastAction = 'note'
    this.lastError = -1
    this.lastPlaced = -1
    this._emit()
    return 'toggled'
  }

  /**
   * 擦除：清空选中格的笔记（已确认格/已知格不可改）。
   * @returns {'erased'|'blocked'|'ignored'}
   */
  erase(idx) {
    if (this.state !== 'playing') return 'ignored'
    if (!this._editable(idx) || this.values[idx] !== 0 || this.notes[idx] === 0) return 'blocked'
    this._pushUndo({ type: 'erase', idx, prevNotes: this.notes[idx] })
    this.notes[idx] = 0
    this.lastAction = 'erase'
    this.lastError = -1
    this.lastPlaced = -1
    this._emit()
    return 'erased'
  }

  /**
   * 提示：填入选中空格（未选中取第一个空格）的正解，扣 50 分并计为已确认。
   * @returns {number|null} 填入的格子索引；次数用尽/无空格/非 playing 时为 null
   */
  hint(selected = -1) {
    if (this.state !== 'playing' || this.hintsLeft <= 0) return null
    let idx = this._editable(selected) && this.values[selected] === 0 ? selected : -1
    if (idx < 0) idx = this.values.findIndex((v, i) => v === 0 && this.givens[i] === 0)
    if (idx < 0) return null

    this._startClock()
    this.hintsLeft -= 1
    this.hintUsed += 1
    this._applyFill(idx, this.solution[idx], 'hint')
    if (this._isComplete()) {
      this._finish('win')
      return idx
    }
    this._emit()
    return idx
  }

  /**
   * 撤销上一次填入/擦除/笔记/提示；不恢复错误计数与已扣分（防刷分）。
   * @returns {boolean} 栈空或非 playing 时返回 false
   */
  undo() {
    if (this.state !== 'playing' || this.undoStack.length === 0) return false
    const op = this.undoStack.pop()
    if (op.type === 'place' || op.type === 'hint') {
      this.values[op.idx] = 0
      this.confirmed[op.idx] = 0
      this.notes[op.idx] = op.prevNotes
      for (const r of op.removed) this.notes[r.idx] |= r.bit
    } else if (op.type === 'note') {
      if (op.added) this.notes[op.idx] &= ~op.bit
      else this.notes[op.idx] |= op.bit
    } else if (op.type === 'erase') {
      this.notes[op.idx] = op.prevNotes
    }
    this.lastAction = 'undo'
    this.lastError = -1
    this.lastPlaced = op.idx
    this._emit()
    return true
  }

  /** 页面每 TICK_MS 调用：刷新倒计时并判定超时 */
  tick() {
    if (this.state !== 'playing' || !this.started) return
    if (this._elapsed() >= this._limit()) {
      this._finish('timeout')
      return
    }
    this._emit()
  }

  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    if (this.started) this.elapsedBase += this.now() - this.resumeAt
    this.lastAction = 'pause'
    this.cb.onPause?.()
    this._emit()
  }

  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    if (this.started) this.resumeAt = this.now()
    this.lastAction = 'resume'
    this._emit()
  }

  dispose() {
    this.cb = {}
  }

  getSnapshot() {
    const filled = this.confirmed.reduce((n, v) => n + v, 0)
    return {
      state: this.state,
      tier: this.tier,
      tierLabel: TIERS[this.tier]?.label ?? '',
      givens: Array.from(this.givens, Boolean),
      values: Array.from(this.values),
      confirmed: Array.from(this.confirmed, Boolean),
      notes: Array.from(this.notes, (mask) => {
        const out = []
        for (let n = 1; n <= 9; n++) if (mask & (1 << (n - 1))) out.push(n)
        return out
      }),
      filled,
      errors: this.errors,
      hintsLeft: this.hintsLeft,
      hintUsed: this.hintUsed,
      canUndo: this.undoStack.length > 0,
      elapsed: this._elapsed(),
      remaining: Math.max(0, Math.ceil(this._limit() - this._elapsed())),
      limitSec: this._limit(),
      started: this.started,
      result: this.result,
      score: this.state === 'over' && this.result === 'win' ? this._score() : null,
      lastAction: this.lastAction,
      lastError: this.lastError,
      lastPlaced: this.lastPlaced,
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }

  /** 可改：在界内、非已知、未确认 */
  _editable(idx) {
    return Number.isInteger(idx) && idx >= 0 && idx < 81 && this.givens[idx] === 0 && this.confirmed[idx] === 0
  }

  _startClock() {
    if (this.started) return
    this.started = true
    this.resumeAt = this.now() - this.elapsedBase
  }

  /** 写入正解：锁定、清本格笔记、剔除同行/列/宫同候选，并入撤销栈 */
  _applyFill(idx, num, type) {
    const bit = 1 << (num - 1)
    const removed = []
    for (const p of PEERS[idx]) {
      if (this.notes[p] & bit) {
        this.notes[p] &= ~bit
        removed.push({ idx: p, bit })
      }
    }
    this._pushUndo({ type, idx, prevNotes: this.notes[idx], removed })
    this.values[idx] = num
    this.confirmed[idx] = 1
    this.notes[idx] = 0
    this.lastAction = type
    this.lastError = -1
    this.lastPlaced = idx
  }

  _pushUndo(op) {
    this.undoStack.push(op)
    if (this.undoStack.length > SUDOKU.UNDO_LIMIT) this.undoStack.shift()
  }

  _isComplete() {
    for (let i = 0; i < 81; i++) if (this.confirmed[i] === 0) return false
    return true
  }

  /** 回溯法填满 81 格（MRV + 随机候选序），结果写入 this.solution */
  _fillSolution() {
    const grid = new Uint8Array(81)
    if (this._solve(grid, 1, true) < 1) return false
    this.solution = grid
    return true
  }

  /**
   * 回溯求解：limit 为解数上限（计到 limit 即停）。
   * keep 为 true（生成终盘）时找到一解即定格在 grid 上并中断搜索；
   * keep 为 false（解计数）时正常回溯枚举，用于唯一解复核。
   * @returns {number} 找到的解数（封顶 limit）
   */
  _solve(grid, limit = 2, keep = false) {
    let count = 0
    const step = () => {
      if (count >= limit) return true
      // MRV：选候选最少的空格
      let best = -1
      let bestMask = 0
      let bestCount = 10
      for (let i = 0; i < 81; i++) {
        if (grid[i] !== 0) continue
        const mask = this._candidates(grid, i)
        const n = this._popcount(mask)
        if (n === 0) return false // 死路
        if (n < bestCount) {
          best = i
          bestMask = mask
          bestCount = n
          if (n === 1) break
        }
      }
      if (best < 0) {
        count += 1 // 无空格：找到一解
        return keep
      }
      const digits = []
      for (let n = 1; n <= 9; n++) if (bestMask & (1 << (n - 1))) digits.push(n)
      if (keep) this._shuffle(digits)
      for (const d of digits) {
        if (count >= limit) break
        grid[best] = d
        if (step()) return true // keep 模式：保留当前填值并全程中断
        grid[best] = 0
      }
      return false
    }
    step()
    return count
  }

  _candidates(grid, idx) {
    let used = 0
    for (const p of PEERS[idx]) used |= grid[p] ? 1 << (grid[p] - 1) : 0
    return FULL_MASK & ~used
  }

  _popcount(mask) {
    let n = 0
    while (mask) {
      mask &= mask - 1
      n += 1
    }
    return n
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(this.random() * (i + 1)))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  /**
   * 生成一版题目：填终盘 → 中心对称成对挖空 + 唯一解复核。
   * @returns {{ givens: Uint8Array, values: Uint8Array } | null} 尝试耗尽返回 null
   */
  _generatePuzzle(blanks) {
    if (!this._fillSolution()) return null

    const values = Uint8Array.from(this.solution)
    // 候选挖空顺序：0~80 打乱，配对 idx ↔ 80-idx，中心格（40 的对称即自身）跳过
    const order = this._shuffle(Array.from({ length: 81 }, (_, i) => i))
    const seen = new Uint8Array(81)
    let removedCount = 0
    let attempts = 0

    for (const idx of order) {
      if (removedCount >= blanks || attempts >= SUDOKU.DIG_ATTEMPTS) break
      if (seen[idx]) continue
      const sym = 80 - idx
      seen[idx] = 1
      seen[sym] = 1
      if (idx === sym) continue // 中心格不挖，保持成对
      if (values[idx] === 0 || values[sym] === 0) continue

      attempts += 1
      const a = values[idx]
      const b = values[sym]
      values[idx] = 0
      values[sym] = 0
      if (this._solve(Uint8Array.from(values), 2) !== 1) {
        values[idx] = a // 不唯一：回退该对
        values[sym] = b
        continue
      }
      removedCount += 2
    }

    if (removedCount < blanks) return null

    const givens = new Uint8Array(81)
    for (let i = 0; i < 81; i++) givens[i] = values[i] !== 0 ? 1 : 0
    return { givens, values }
  }

  _limit() {
    return TIERS[this.tier]?.limitSec ?? TIERS.easy.limitSec
  }

  _baseScore() {
    return TIERS[this.tier]?.baseScore ?? TIERS.easy.baseScore
  }

  /** 得分：max(100, 基准 − floor(秒)×2 − 错误×30 − 提示×50) */
  _score() {
    const penalty = Math.floor(this._elapsed()) * SUDOKU.SEC_PENALTY
      + this.errors * SUDOKU.ERROR_PENALTY
      + this.hintUsed * SUDOKU.HINT_PENALTY
    return Math.max(SUDOKU.MIN_SCORE, Math.round(this._baseScore() - penalty))
  }

  _elapsed() {
    const running = this.state === 'playing' && this.started ? this.now() - this.resumeAt : 0
    return Math.round(((this.elapsedBase + running) / 1000) * 10) / 10
  }

  _finish(result) {
    if (this.started) this.elapsedBase += this.now() - this.resumeAt
    this.state = 'over'
    this.result = result
    this.lastAction = result === 'win' ? 'win' : result
    this._emit()
    this.cb.onGameOver?.(
      result === 'win' ? this._score() : 0,
      this._elapsed(),
      result,
    )
  }
}
