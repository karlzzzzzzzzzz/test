/**
 * 消消乐（Match-3）引擎 —— 纯逻辑，与 UI 解耦。
 *
 * 规则：
 * - 8×8 棋盘，每格一种颜色（5 或 6 色），交换相邻两格；
 * - 交换后若横/竖出现 ≥3 个同色即消除，否则交换作废；
 * - 消除后上方方块下落、顶部随机补充，若再次形成三消则连锁加分；
 * - 每步消耗 1 次移动，达到目标分即胜利；步数用尽仍未达标判负；
 * - 棋盘无任何可消除交换时自动重排，并计入 reshuffles。
 *
 * 计分：三消 60 分、四消 100 分、五消及以上 160 分，
 *       连锁第 N 轮得分 ×N。
 *
 * 状态机：start → playing ⇄ paused → over
 */

export const MATCH3 = {
  ROWS: 8,
  COLS: 8,
  MAX_CASCADE: 50,
}

export const LEVELS = {
  easy: { key: 'easy', label: '轻松', blurb: '8×8 · 5 色 · 25 步', colors: 5, moves: 25, target: 1500 },
  normal: { key: 'normal', label: '标准', blurb: '8×8 · 6 色 · 22 步', colors: 6, moves: 22, target: 2200 },
  hard: { key: 'hard', label: '困难', blurb: '8×8 · 6 色 · 18 步', colors: 6, moves: 18, target: 3000 },
}

/** 单组消除的基础分 */
export function baseScoreOf(length) {
  if (length >= 5) return 160
  if (length === 4) return 100
  return 60
}

const at = (r, c, cols) => r * cols + c

/** 找出所有横向 / 纵向 ≥3 的同色组 */
export function findMatches(board, rows, cols) {
  const groups = []
  for (let r = 0; r < rows; r++) {
    let c = 0
    while (c < cols) {
      const value = board[at(r, c, cols)]
      let end = c + 1
      while (end < cols && board[at(r, end, cols)] === value) end += 1
      if (value !== 0 && end - c >= 3) {
        const cells = []
        for (let k = c; k < end; k++) cells.push(at(r, k, cols))
        groups.push({ orientation: 'h', length: end - c, cells })
      }
      c = end
    }
  }
  for (let c = 0; c < cols; c++) {
    let r = 0
    while (r < rows) {
      const value = board[at(r, c, cols)]
      let end = r + 1
      while (end < rows && board[at(end, c, cols)] === value) end += 1
      if (value !== 0 && end - r >= 3) {
        const cells = []
        for (let k = r; k < end; k++) cells.push(at(k, c, cols))
        groups.push({ orientation: 'v', length: end - r, cells })
      }
      r = end
    }
  }
  return groups
}

/** 交换两格（原地） */
export function swapCells(board, a, b) {
  const tmp = board[a]
  board[a] = board[b]
  board[b] = tmp
}

/** 是否存在能形成三消的相邻交换 */
export function hasPossibleMove(board, rows, cols) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = at(r, c, cols)
      if (c + 1 < cols) {
        const j = at(r, c + 1, cols)
        swapCells(board, i, j)
        const found = findMatches(board, rows, cols).length > 0
        swapCells(board, i, j)
        if (found) return true
      }
      if (r + 1 < rows) {
        const j = at(r + 1, c, cols)
        swapCells(board, i, j)
        const found = findMatches(board, rows, cols).length > 0
        swapCells(board, i, j)
        if (found) return true
      }
    }
  }
  return false
}

/** 创建无初始三消且至少存在一步可消的棋盘 */
export function createBoard(rows, cols, colors, random = Math.random) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const board = new Uint8Array(rows * cols)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = at(r, c, cols)
        let value = 0
        let guard = 0
        do {
          value = 1 + Math.floor(random() * colors)
          guard += 1
        } while (guard < 40 && (
          (c >= 2 && board[i - 1] === value && board[i - 2] === value)
          || (r >= 2 && board[i - cols] === value && board[i - 2 * cols] === value)
        ))
        board[i] = value
      }
    }
    if (findMatches(board, rows, cols).length === 0 && hasPossibleMove(board, rows, cols)) {
      return board
    }
  }
  const board = new Uint8Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) board[at(r, c, cols)] = ((r * 2 + c) % colors) + 1
  }
  return board
}

/** 下落 + 顶部补新块（原地） */
function gravityAndRefill(board, rows, cols, colors, random) {
  for (let c = 0; c < cols; c++) {
    let write = rows - 1
    for (let r = rows - 1; r >= 0; r--) {
      const value = board[at(r, c, cols)]
      if (value !== 0) {
        board[at(write, c, cols)] = value
        write -= 1
      }
    }
    for (let r = write; r >= 0; r--) {
      board[at(r, c, cols)] = 1 + Math.floor(random() * colors)
    }
  }
}

/**
 * 反复消除直到稳定。
 * @returns {{ board: Uint8Array, score: number, cleared: number, cascades: number, maxCombo: number }}
 */
export function resolveBoard(board, rows, cols, colors, random = Math.random) {
  const work = board.slice()
  let score = 0
  let cleared = 0
  let steps = 0
  for (let step = 0; step < MATCH3.MAX_CASCADE; step++) {
    const groups = findMatches(work, rows, cols)
    if (!groups.length) break
    const cells = new Set()
    let gained = 0
    for (const group of groups) {
      gained += baseScoreOf(group.length)
      for (const cell of group.cells) cells.add(cell)
    }
    score += gained * (step + 1)
    cleared += cells.size
    for (const cell of cells) work[cell] = 0
    gravityAndRefill(work, rows, cols, colors, random)
    steps += 1
  }
  return {
    board: work,
    score,
    cleared,
    cascades: Math.max(0, steps - 1),
    maxCombo: steps,
  }
}

/** 打乱现有方块直到无初始三消且有可消交换 */
export function shuffleBoard(board, rows, cols, colors, random = Math.random) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const values = Array.from(board)
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      const tmp = values[i]
      values[i] = values[j]
      values[j] = tmp
    }
    const next = Uint8Array.from(values)
    if (findMatches(next, rows, cols).length === 0 && hasPossibleMove(next, rows, cols)) return next
  }
  return createBoard(rows, cols, colors, random)
}

export class Match3Engine {
  /**
   * @param {Object} cb { onState, onGameOver, onPause }
   * @param {Object} options { random }
   */
  constructor(cb = {}, options = {}) {
    this.cb = cb
    this.random = options.random || Math.random

    this.state = 'start'
    this.level = 'normal'
    this.rows = MATCH3.ROWS
    this.cols = MATCH3.COLS
    this.colors = LEVELS.normal.colors
    this.board = new Uint8Array(0)

    this.score = 0
    this.target = LEVELS.normal.target
    this.movesLeft = 0
    this.movesTotal = 0
    this.swaps = 0
    this.matches = 0
    this.cascades = 0
    this.maxCombo = 0
    this.reshuffles = 0

    this.started = false
    this.startedAt = 0
    this.elapsedBase = 0
    this.resumeAt = 0
    this.clockRunning = false
  }

  /** 开始新一局 */
  start(level = 'normal') {
    const key = level in LEVELS ? level : 'normal'
    const cfg = LEVELS[key]
    this.level = key
    this.colors = cfg.colors
    this.rows = MATCH3.ROWS
    this.cols = MATCH3.COLS
    this.board = createBoard(this.rows, this.cols, this.colors, this.random)
    this.target = cfg.target
    this.movesLeft = cfg.moves
    this.movesTotal = cfg.moves
    this.score = 0
    this.swaps = 0
    this.matches = 0
    this.cascades = 0
    this.maxCombo = 0
    this.reshuffles = 0

    this.started = true
    this.startedAt = Date.now()
    this.elapsedBase = 0
    this.resumeAt = Date.now()
    this.clockRunning = true
    this.state = 'playing'
    this._emit()
    return this.getSnapshot()
  }

  /** 从存档恢复（棋盘、分数、剩余步数、已用时长） */
  restore(save) {
    if (!save || typeof save !== 'object') return false
    if (!(save.level in LEVELS)) return false
    const cfg = LEVELS[save.level]
    const total = MATCH3.ROWS * MATCH3.COLS
    if (!Array.isArray(save.board) || save.board.length !== total) return false
    const board = new Uint8Array(total)
    for (let i = 0; i < total; i++) {
      const value = save.board[i]
      if (!Number.isInteger(value) || value < 1 || value > cfg.colors) return false
      board[i] = value
    }
    const movesLeft = Number(save.movesLeft)
    if (!Number.isFinite(movesLeft) || movesLeft <= 0 || movesLeft > cfg.moves) return false

    this.level = save.level
    this.colors = cfg.colors
    this.rows = MATCH3.ROWS
    this.cols = MATCH3.COLS
    this.board = board
    this.target = cfg.target
    this.movesLeft = Math.floor(movesLeft)
    this.movesTotal = cfg.moves
    this.score = Math.max(0, Math.floor(Number(save.score) || 0))
    this.swaps = Math.max(0, Math.floor(Number(save.swaps) || 0))
    this.matches = Math.max(0, Math.floor(Number(save.matches) || 0))
    this.cascades = Math.max(0, Math.floor(Number(save.cascades) || 0))
    this.maxCombo = Math.max(0, Math.floor(Number(save.maxCombo) || 0))
    this.reshuffles = 0

    this.started = true
    this.elapsedBase = Math.max(0, Number(save.elapsed) || 0) * 1000
    this.startedAt = Date.now() - this.elapsedBase
    this.resumeAt = Date.now()
    this.clockRunning = true
    this.state = 'playing'
    this._emit()
    return true
  }

  /**
   * 交换两个相邻格子。
   * @returns {{ ok: boolean, reason?: string, gained?: number, cleared?: number,
   *             cascades?: number, reshuffled?: boolean, win?: boolean, lose?: boolean }}
   */
  trySwap(a, b) {
    if (this.state !== 'playing') return { ok: false, reason: '当前不能交换' }
    const total = this.rows * this.cols
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= total || b >= total) {
      return { ok: false, reason: '格子不存在' }
    }
    if (a === b) return { ok: false, reason: '请选择两个相邻格子' }
    const ra = Math.floor(a / this.cols)
    const ca = a % this.cols
    const rb = Math.floor(b / this.cols)
    const cb = b % this.cols
    if (Math.abs(ra - rb) + Math.abs(ca - cb) !== 1) {
      return { ok: false, reason: '只能交换相邻的两个方块' }
    }
    if (this.movesLeft <= 0) return { ok: false, reason: '步数已用尽' }

    swapCells(this.board, a, b)
    if (!findMatches(this.board, this.rows, this.cols).length) {
      swapCells(this.board, a, b)
      return { ok: false, reason: '这次交换无法形成三消' }
    }

    const resolved = resolveBoard(this.board, this.rows, this.cols, this.colors, this.random)
    this.board = resolved.board
    this.score += resolved.score
    this.swaps += 1
    this.matches += resolved.cleared
    this.cascades += resolved.cascades
    this.maxCombo = Math.max(this.maxCombo, resolved.maxCombo)
    this.movesLeft -= 1

    if (this.score >= this.target) {
      this._finish('win')
      return {
        ok: true, gained: resolved.score, cleared: resolved.cleared,
        cascades: resolved.cascades, win: true, lose: false,
      }
    }
    if (this.movesLeft <= 0) {
      this._finish('lose')
      return {
        ok: true, gained: resolved.score, cleared: resolved.cleared,
        cascades: resolved.cascades, win: false, lose: true,
      }
    }

    let reshuffled = false
    if (!hasPossibleMove(this.board, this.rows, this.cols)) {
      this.board = shuffleBoard(this.board, this.rows, this.cols, this.colors, this.random)
      this.reshuffles += 1
      reshuffled = true
    }
    this._emit()
    return {
      ok: true, gained: resolved.score, cleared: resolved.cleared,
      cascades: resolved.cascades, reshuffled, win: false, lose: false,
    }
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
    this.cb.onPause?.()
    this._emit()
  }

  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    this.resumeAt = Date.now()
    this.clockRunning = true
    this._emit()
  }

  dispose() {
    this.cb = {}
  }

  _finish(result) {
    if (this.clockRunning) {
      this.elapsedBase += Date.now() - this.resumeAt
      this.clockRunning = false
    }
    this.state = 'over'
    this._emit()
    this.cb.onGameOver?.({
      result,
      score: this.score,
      target: this.target,
      level: this.level,
      movesTotal: this.movesTotal,
      movesLeft: this.movesLeft,
      swaps: this.swaps,
      matches: this.matches,
      cascades: this.cascades,
      maxCombo: this.maxCombo,
      reshuffles: this.reshuffles,
      elapsed: this._elapsed(),
    })
  }

  _elapsed() {
    const running = this.clockRunning ? Date.now() - this.resumeAt : 0
    return Math.round((this.elapsedBase + running) / 100) / 10
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }

  getSnapshot() {
    return {
      state: this.state,
      level: this.level,
      rows: this.rows,
      cols: this.cols,
      colors: this.colors,
      board: this.board.length ? Array.from(this.board) : [],
      score: this.score,
      target: this.target,
      movesLeft: this.movesLeft,
      movesTotal: this.movesTotal,
      swaps: this.swaps,
      matches: this.matches,
      cascades: this.cascades,
      maxCombo: this.maxCombo,
      reshuffles: this.reshuffles,
      elapsed: this._elapsed(),
    }
  }
}
