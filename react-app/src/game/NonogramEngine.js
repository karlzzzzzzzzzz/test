/**
 * 数织（Nonogram / Picross）引擎 —— 纯逻辑，与 UI 解耦。
 *
 * 状态机：start → playing ⇄ paused → over(win)。
 *
 * 规则：网格每行/每列有一组提示数字，表示该行/列中连续填充块的长度
 * （相邻块之间至少隔 1 个空格）。玩家用「填格」或「叉格」还原图案。
 *
 * 胜利判定：用玩家实际填格重新计算行列提示，与目标提示完全一致即胜利。
 * 这样即使谜题有多个解，任何满足提示的图案都能通关，不会出现
 * 「看起来填对了却被判错」的挫败感。
 */

export const CELL = {
  EMPTY: 0,
  FILLED: 1,
  MARKED: 2, // 叉格：玩家标记的确定空格
}

export const LEVELS = {
  easy: { rows: 5, cols: 5, density: 0.54, label: '入门 5×5' },
  normal: { rows: 10, cols: 10, density: 0.52, label: '进阶 10×10' },
  hard: { rows: 15, cols: 15, density: 0.50, label: '专家 15×15' },
}

export const NONOGRAM = {
  UNDO_LIMIT: 200,
  MAX_PROGRESS_CHARS: 400, // 进度序列化上限，超过则不写 localStorage
  HINT_LIMIT: 3,           // 每局提示次数
}

/** 由一行/列的填充状态计算提示数组（1=填充） */
export function computeClue(line) {
  const clue = []
  let run = 0
  for (let i = 0; i < line.length; i++) {
    if (line[i]) {
      run += 1
    } else if (run > 0) {
      clue.push(run)
      run = 0
    }
  }
  if (run > 0) clue.push(run)
  return clue.length ? clue : [0]
}

export function clueEquals(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** 把网格序列化成紧凑字符串：0/1/2 逐格 */
export function serializeGrid(grid) {
  let s = ''
  for (let i = 0; i < grid.length; i++) s += String(grid[i])
  return s
}

/** 反序列化，长度不符返回 null */
export function deserializeGrid(str, expectedLen) {
  if (typeof str !== 'string' || str.length !== expectedLen) return null
  const out = new Uint8Array(expectedLen)
  for (let i = 0; i < expectedLen; i++) {
    const v = str.charCodeAt(i) - 48
    if (v !== 0 && v !== 1 && v !== 2) return null
    out[i] = v
  }
  return out
}

export class NonogramEngine {
  /**
   * @param {Object} cb { onState, onGameOver, onPause }
   * @param {Object} options { random }
   */
  constructor(cb = {}, options = {}) {
    this.cb = cb
    this.random = options.random || Math.random

    this.state = 'start'
    this.level = 'easy'
    this._cfg = LEVELS.easy

    this.rows = 5
    this.cols = 5
    this.answer = new Uint8Array(25)
    this.grid = new Uint8Array(25)
    this.rowClues = []
    this.colClues = []

    this.started = false
    this.startedAt = 0
    this.elapsedBase = 0
    this.resumeAt = 0
    this.clockRunning = false

    this.history = []
    this.hintsLeft = NONOGRAM.HINT_LIMIT
    this.moves = 0
    this.lastAction = null
  }

  start(level = 'easy', savedProgress = null) {
    const key = level in LEVELS ? level : 'easy'
    const cfg = LEVELS[key]
    this._cfg = cfg
    this.level = key
    this.rows = cfg.rows
    this.cols = cfg.cols

    const total = this.rows * this.cols
    this.answer = new Uint8Array(total)
    this.grid = new Uint8Array(total)

    this._generate()
    this._computeClues()

    // 恢复进度（仅当尺寸匹配且合法）
    let restored = false
    if (savedProgress && typeof savedProgress === 'object') {
      if (savedProgress.level === key) {
        const g = deserializeGrid(savedProgress.grid, total)
        if (g) {
          this.grid = g
          restored = true
        }
      }
    }

    this.started = restored
    this.startedAt = restored ? Date.now() : 0
    this.elapsedBase = restored && Number.isFinite(savedProgress?.elapsed) ? savedProgress.elapsed : 0
    this.resumeAt = restored ? Date.now() : 0
    this.clockRunning = restored

    this.history = []
    this.hintsLeft = NONOGRAM.HINT_LIMIT
    this.moves = 0
    this.state = 'playing'
    this.lastAction = restored ? 'restore' : 'start'
    this._emit()
    return { restored }
  }

  /** 循环切换：空 → 填 → 叉 → 空 */
  cycle(idx) {
    if (this.state !== 'playing') return false
    if (!this._validIdx(idx)) return false
    this._ensureClock()
    const prev = this.grid[idx]
    const next = prev === CELL.EMPTY ? CELL.FILLED
      : prev === CELL.FILLED ? CELL.MARKED : CELL.EMPTY
    this._apply(idx, next, prev)
    return true
  }

  /** 直接设置为指定状态 */
  setCell(idx, value) {
    if (this.state !== 'playing') return false
    if (!this._validIdx(idx)) return false
    if (value !== CELL.EMPTY && value !== CELL.FILLED && value !== CELL.MARKED) return false
    this._ensureClock()
    const prev = this.grid[idx]
    if (prev === value) return false
    this._apply(idx, value, prev)
    return true
  }

  /** 提示：随机揭示一个尚未正确填充的格（最多 3 次/局） */
  hint() {
    if (this.state !== 'playing' || this.hintsLeft <= 0) return false
    this._ensureClock()
    const total = this.rows * this.cols
    const candidates = []
    for (let i = 0; i < total; i++) {
      if (this.answer[i] === 1 && this.grid[i] !== CELL.FILLED) candidates.push(i)
    }
    if (candidates.length === 0) return false
    const idx = candidates[Math.floor(this.random() * candidates.length)]
    const prev = this.grid[idx]
    this.history.push({ idx, prev })
    this.grid[idx] = CELL.FILLED
    this.hintsLeft -= 1
    this.moves += 1
    this.lastAction = 'hint'
    this._afterChange()
    return true
  }

  undo() {
    if (this.state !== 'playing' || this.history.length === 0) return false
    const last = this.history.pop()
    this.grid[last.idx] = last.prev
    this.moves = Math.max(0, this.moves - 1)
    this.lastAction = 'undo'
    this._emit()
    return true
  }

  /** 清空当前局所有标记（不可撤销，需确认） */
  clearAll() {
    if (this.state !== 'playing') return false
    this.grid.fill(CELL.EMPTY)
    this.history = []
    this.moves = 0
    this.lastAction = 'clear'
    this._emit()
    return true
  }

  tick() {
    if (this.state !== 'playing' || !this.clockRunning) return
    this._emit()
  }

  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    if (this.clockRunning) {
      this.elapsedBase += Date.now() - this.resumeAt
      this.clockRunning = false
    }
    this.lastAction = 'pause'
    this.cb.onPause?.()
    this._emit()
  }

  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    if (this.started) {
      this.resumeAt = Date.now()
      this.clockRunning = true
    }
    this.lastAction = 'resume'
    this._emit()
  }

  dispose() {
    this.cb = {}
  }

  // ===== 内部 =====
  _validIdx(idx) {
    return Number.isInteger(idx) && idx >= 0 && idx < this.rows * this.cols
  }

  _ensureClock() {
    if (!this.started) {
      this.started = true
      this.startedAt = Date.now()
      this.resumeAt = Date.now()
      this.clockRunning = true
    }
  }

  _apply(idx, next, prev) {
    this.history.push({ idx, prev })
    if (this.history.length > NONOGRAM.UNDO_LIMIT) this.history.shift()
    this.grid[idx] = next
    this.moves += 1
    this.lastAction = 'cell'
    this._afterChange()
  }

  _afterChange() {
    if (this._checkWin()) {
      this._finish()
    } else {
      this._emit()
    }
  }

  /**
   * 胜利判定：玩家填格计算出的行列提示必须与目标提示逐行逐列一致。
   * 注意只统计 FILLED，MARKED 视为空格。
   */
  _checkWin() {
    const { rows, cols } = this
    for (let r = 0; r < rows; r++) {
      const line = new Uint8Array(cols)
      for (let c = 0; c < cols; c++) {
        line[c] = this.grid[r * cols + c] === CELL.FILLED ? 1 : 0
      }
      if (!clueEquals(computeClue(line), this.rowClues[r])) return false
    }
    for (let c = 0; c < cols; c++) {
      const line = new Uint8Array(rows)
      for (let r = 0; r < rows; r++) {
        line[r] = this.grid[r * cols + c] === CELL.FILLED ? 1 : 0
      }
      if (!clueEquals(computeClue(line), this.colClues[c])) return false
    }
    return true
  }

  _generate() {
    const total = this.rows * this.cols
    const density = this._cfg.density
    // 随机布点，再保证每行每列至少有一个填充块（避免 [0] 提示过多）
    for (let attempt = 0; attempt < 60; attempt++) {
      for (let i = 0; i < total; i++) {
        this.answer[i] = this.random() < density ? 1 : 0
      }
      if (this._rowColsAllNonEmpty()) break
    }
  }

  _rowColsAllNonEmpty() {
    const { rows, cols } = this
    for (let r = 0; r < rows; r++) {
      let any = false
      for (let c = 0; c < cols; c++) if (this.answer[r * cols + c]) { any = true; break }
      if (!any) return false
    }
    for (let c = 0; c < cols; c++) {
      let any = false
      for (let r = 0; r < rows; r++) if (this.answer[r * cols + c]) { any = true; break }
      if (!any) return false
    }
    return true
  }

  _computeClues() {
    const { rows, cols } = this
    this.rowClues = []
    this.colClues = []
    for (let r = 0; r < rows; r++) {
      const line = []
      for (let c = 0; c < cols; c++) line.push(this.answer[r * cols + c])
      this.rowClues.push(computeClue(line))
    }
    for (let c = 0; c < cols; c++) {
      const line = []
      for (let r = 0; r < rows; r++) line.push(this.answer[r * cols + c])
      this.colClues.push(computeClue(line))
    }
  }

  _finish() {
    if (this.clockRunning) {
      this.elapsedBase += Date.now() - this.resumeAt
      this.clockRunning = false
    }
    this.state = 'over'
    this.lastAction = 'win'
    this._emit()
    this.cb.onGameOver?.({
      result: 'win',
      elapsed: this._elapsed(),
      moves: this.moves,
      level: this.level,
      hintsLeft: this.hintsLeft,
    })
  }

  _elapsed() {
    const running = this.clockRunning ? Date.now() - this.resumeAt : 0
    return Math.round((this.elapsedBase + running) / 100) / 10
  }

  getSnapshot() {
    const total = this.rows * this.cols
    const remaining = this.grid.reduce((acc, v, i) => {
      return acc + (this.answer[i] === 1 && v !== CELL.FILLED ? 1 : 0)
    }, 0)
    const filledCount = (() => {
      let n = 0
      for (let i = 0; i < total; i++) if (this.grid[i] === CELL.FILLED) n += 1
      return n
    })()
    const answerCount = (() => {
      let n = 0
      for (let i = 0; i < total; i++) if (this.answer[i] === 1) n += 1
      return n
    })()

    return {
      state: this.state,
      level: this.level,
      rows: this.rows,
      cols: this.cols,
      grid: Array.from(this.grid),
      rowClues: this.rowClues.map(c => c.slice()),
      colClues: this.colClues.map(c => c.slice()),
      elapsed: this._elapsed(),
      moves: this.moves,
      hintsLeft: this.hintsLeft,
      filledCount,
      answerCount,
      remaining,
      lastAction: this.lastAction,
    }
  }

  /** 导出当前进度用于持久化 */
  exportProgress() {
    return {
      level: this.level,
      grid: serializeGrid(this.grid),
      elapsed: this._elapsed(),
      ts: Date.now(),
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }
}
