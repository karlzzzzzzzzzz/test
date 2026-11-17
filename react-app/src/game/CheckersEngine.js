/**
 * 跳棋（English Draughts / 西洋跳棋）引擎 —— 纯逻辑，与 UI 解耦。
 *
 * 规则：
 * - 8×8 棋盘，只在深色格（(row + col) % 2 === 1）上走子；
 * - 红方（玩家）在下方，向 row 减小方向前进；黑方（AI）在上方，向 row 增大方向前进；
 * - 普通棋子只能斜向前进一步；升王后可四向斜走；
 * - 吃子为跳过相邻敌子落到其后的空格；只要存在吃子走法就必须吃（强制吃子）；
 * - 一次吃子后若同一枚棋还能继续吃，则必须连跳（回合不切换）；
 * - 普通棋子走到对方底线升王，升王后当回合立即结束；
 * - 一方无子或无合法着法即判负；连续 80 个半回合无吃子 / 无升王判和。
 *
 * 状态机：start → playing ⇄ paused → over
 */

export const PIECE = {
  EMPTY: 0,
  RED: 1,
  RED_KING: 2,
  BLACK: 3,
  BLACK_KING: 4,
}

export const SIDE = { RED: 'red', BLACK: 'black' }

export const LEVELS = {
  easy: { key: 'easy', label: '轻松', depth: 0, blurb: '随机走子' },
  normal: { key: 'normal', label: '标准', depth: 2, blurb: '两层搜索' },
  hard: { key: 'hard', label: '困难', depth: 4, blurb: '四层 α-β 搜索' },
}

export const CHECKERS = {
  BOARD_SIZE: 8,
  DRAW_QUIET_PLIES: 80,  // 40 个回合无吃子即判和
  DAILY_PIECES: 6,       // 每日残局每方棋子数
  AI_BUDGET_MS: { normal: 260, hard: 900 },
}

const KING_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
const RED_DIRS = [[-1, -1], [-1, 1]]
const BLACK_DIRS = [[1, -1], [1, 1]]

export function isRedPiece(p) {
  return p === PIECE.RED || p === PIECE.RED_KING
}

export function isBlackPiece(p) {
  return p === PIECE.BLACK || p === PIECE.BLACK_KING
}

export function isKingPiece(p) {
  return p === PIECE.RED_KING || p === PIECE.BLACK_KING
}

export function sideOf(piece) {
  if (isRedPiece(piece)) return SIDE.RED
  if (isBlackPiece(piece)) return SIDE.BLACK
  return null
}

export function isPlayable(row, col) {
  return (row + col) % 2 === 1
}

const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8

function dirsOf(piece) {
  if (isKingPiece(piece)) return KING_DIRS
  if (piece === PIECE.RED) return RED_DIRS
  return BLACK_DIRS
}

function willPromote(piece, toRow) {
  return (piece === PIECE.RED && toRow === 0) || (piece === PIECE.BLACK && toRow === 7)
}

/** 标准开局：黑方 0~2 行、红方 5~7 行的深色格各 12 枚 */
export function createInitialBoard() {
  const board = new Uint8Array(64)
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (!isPlayable(r, c)) continue
      const idx = r * 8 + c
      if (r < 3) board[idx] = PIECE.BLACK
      else if (r > 4) board[idx] = PIECE.RED
    }
  }
  return board
}

/** FNV-1a 字符串哈希，用于把日期映射成随机种子 */
export function hashSeed(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 轻量确定性伪随机源（mulberry32） */
export function mulberry32(seed) {
  let s = seed >>> 0
  return function next() {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 按日期生成「每日残局」初始盘面：每方各 DAILY_PIECES 枚，全部落在己方半场。
 * 保证最前排至少有一枚（该排前方为空，必有合法着法），同一日期结果完全一致。
 */
export function createDailyBoard(dateStr) {
  const rand = mulberry32(hashSeed(`checkers:${dateStr}`))
  const board = new Uint8Array(64)

  const pickSquares = (rows, frontRow, count) => {
    const pool = []
    for (const r of rows) {
      for (let c = 0; c < 8; c++) {
        if (isPlayable(r, c)) pool.push(r * 8 + c)
      }
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const tmp = pool[i]
      pool[i] = pool[j]
      pool[j] = tmp
    }
    const chosen = new Set()
    const front = pool.find((i) => (i >> 3) === frontRow)
    if (front !== undefined) chosen.add(front)
    for (const sq of pool) {
      if (chosen.size >= count) break
      chosen.add(sq)
    }
    return [...chosen].slice(0, count)
  }

  for (const i of pickSquares([5, 6, 7], 5, CHECKERS.DAILY_PIECES)) board[i] = PIECE.RED
  for (const i of pickSquares([0, 1, 2], 2, CHECKERS.DAILY_PIECES)) board[i] = PIECE.BLACK
  return board
}

/**
 * 生成指定方的全部合法着法。
 * chainFrom >= 0 时表示正在连跳，只允许该枚棋继续吃子。
 * 存在吃子时只返回吃子着法（强制吃子）。
 */
export function generateMoves(board, side, chainFrom = -1) {
  const captures = []
  const quiet = []
  const froms = []
  if (chainFrom >= 0) {
    froms.push(chainFrom)
  } else {
    for (let i = 0; i < 64; i++) {
      if (sideOf(board[i]) === side) froms.push(i)
    }
  }

  for (const from of froms) {
    const piece = board[from]
    if (!piece || sideOf(piece) !== side) continue
    const r = from >> 3
    const c = from & 7
    for (const [dr, dc] of dirsOf(piece)) {
      const mr = r + dr
      const mc = c + dc
      if (!inBounds(mr, mc)) continue
      const mid = board[mr * 8 + mc]
      if (mid && sideOf(mid) !== side) {
        const lr = r + 2 * dr
        const lc = c + 2 * dc
        if (!inBounds(lr, lc)) continue
        const to = lr * 8 + lc
        if (board[to] !== PIECE.EMPTY) continue
        captures.push({
          from,
          to,
          captures: [mr * 8 + mc],
          promote: willPromote(piece, lr),
        })
      } else if (!mid && chainFrom < 0) {
        quiet.push({
          from,
          to: mr * 8 + mc,
          captures: [],
          promote: willPromote(piece, mr),
        })
      }
    }
  }

  return captures.length ? captures : quiet
}

/** 在棋盘副本上执行一次着法（原地修改传入棋盘） */
export function applyMove(board, side, move) {
  const piece = board[move.from]
  board[move.from] = PIECE.EMPTY
  for (const cap of move.captures) board[cap] = PIECE.EMPTY
  const toRow = move.to >> 3
  let promoted = false
  let nextPiece = piece
  if (willPromote(piece, toRow)) {
    nextPiece = side === SIDE.RED ? PIECE.RED_KING : PIECE.BLACK_KING
    promoted = true
  }
  board[move.to] = nextPiece
  return { promoted }
}

const otherSide = (side) => (side === SIDE.RED ? SIDE.BLACK : SIDE.RED)

export class CheckersEngine {
  /**
   * @param {Object} cb { onState, onGameOver, onPause }
   * @param {Object} options { random }
   */
  constructor(cb = {}, options = {}) {
    this.cb = cb
    this.random = options.random || Math.random

    this.state = 'start'
    this.level = 'normal'
    this.mode = 'classic' // classic | daily
    this.dailyDate = ''

    this.board = new Uint8Array(0)
    this.turn = SIDE.RED
    this.chainFrom = -1
    this.winner = null

    this.movesPlayed = 0
    this.capturesMade = 0
    this.promotions = 0
    this.quietPlies = 0

    this.started = false
    this.startedAt = 0
    this.elapsedBase = 0
    this.resumeAt = 0
    this.clockRunning = false

    this.aiMs = 0
    this.lastAction = null
    this.lastMove = null
  }

  /**
   * 开始新对局。
   * @param {string} level easy | normal | hard
   * @param {Object} opts { mode: 'classic' | 'daily', dailyDate }
   */
  start(level = 'normal', opts = {}) {
    const key = level in LEVELS ? level : 'normal'
    this.level = key
    this.mode = opts.mode === 'daily' ? 'daily' : 'classic'
    this.dailyDate = this.mode === 'daily' ? String(opts.dailyDate || '') : ''
    this.board = this.mode === 'daily' && this.dailyDate
      ? createDailyBoard(this.dailyDate)
      : createInitialBoard()

    this.turn = SIDE.RED
    this.chainFrom = -1
    this.winner = null
    this.movesPlayed = 0
    this.capturesMade = 0
    this.promotions = 0
    this.quietPlies = 0
    this.aiMs = 0

    this.started = true
    this.startedAt = Date.now()
    this.elapsedBase = 0
    this.resumeAt = Date.now()
    this.clockRunning = true

    this.lastMove = null
    this.lastAction = 'start'
    this.state = 'playing'
    this._emit()
    return this.getSnapshot()
  }

  /** 当前执子方的全部合法着法（连跳时只含该棋） */
  legalMoves() {
    if (this.state !== 'playing') return []
    return generateMoves(this.board, this.turn, this.chainFrom)
  }

  /** 某枚棋当前的合法落点（UI 高亮用），非本方回合返回空数组 */
  movesForPiece(idx) {
    if (this.state !== 'playing' || this.turn !== SIDE.RED) return []
    if (!Number.isInteger(idx) || idx < 0 || idx >= 64) return []
    return this.legalMoves().filter((m) => m.from === idx)
  }

  /**
   * 玩家走子。
   * @returns {{ ok: boolean, reason?: string, chain?: boolean, promoted?: boolean }}
   */
  tryMove(from, to) {
    if (this.state !== 'playing') return { ok: false, reason: '当前不能走子' }
    if (this.turn !== SIDE.RED) return { ok: false, reason: '等待 AI 走子' }
    const legal = this.movesForPiece(from)
    const hit = legal.find((m) => m.to === to)
    if (!hit) return { ok: false, reason: this.explainIllegal(from) }
    const promoted = hit.promote
    this._advance(hit)
    return {
      ok: true,
      chain: this.state === 'playing' && this.turn === SIDE.RED && this.chainFrom >= 0,
      promoted,
    }
  }

  /** AI 计算一步（不落子），供页面壳插入思考延迟 */
  chooseAiMove() {
    if (this.state !== 'playing' || this.turn !== SIDE.BLACK) return null
    const moves = generateMoves(this.board, SIDE.BLACK, this.chainFrom)
    if (!moves.length) return null

    const t0 = Date.now()
    let move
    if (this.level === 'easy') {
      move = moves[Math.floor(this.random() * moves.length)]
    } else {
      const cfg = LEVELS[this.level]
      const budget = CHECKERS.AI_BUDGET_MS[this.level] || 300
      move = this._searchRoot(moves, cfg.depth, Date.now() + budget)
    }
    this.aiMs += Date.now() - t0
    return move
  }

  /** AI 思考并落子，返回实际着法 */
  playAiMove() {
    const move = this.chooseAiMove()
    if (!move) return null
    this._advance(move)
    return move
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

  explainIllegal(from) {
    const piece = this.board[from]
    if (!piece || !isRedPiece(piece)) return '只能移动红棋'
    if (this.chainFrom >= 0) return '必须用同一枚棋子继续连跳'
    const all = generateMoves(this.board, SIDE.RED, -1)
    if (all.length && all[0].captures.length) return '有可吃子的走法，必须吃子'
    return '这不是合法的着法'
  }

  _advance(move) {
    const mover = this.turn
    const { promoted } = applyMove(this.board, mover, move)

    this.movesPlayed += 1
    if (move.captures.length) {
      this.capturesMade += move.captures.length
      this.quietPlies = 0
    } else {
      this.quietPlies += 1
    }
    if (promoted) {
      this.promotions += 1
      this.quietPlies = 0
    }

    let chained = false
    if (move.captures.length && !promoted) {
      const further = generateMoves(this.board, mover, move.to)
      if (further.length) {
        this.chainFrom = move.to
        this.turn = mover
        chained = true
      }
    }
    if (!chained) {
      this.chainFrom = -1
      this.turn = otherSide(mover)
    }

    this.lastMove = { from: move.from, to: move.to, captures: move.captures.slice() }
    this.lastAction = move.captures.length ? 'capture' : promoted ? 'promote' : 'move'

    const ended = this._checkEnd(mover, chained)
    if (!ended) this._emit()
  }

  /** 返回 true 表示已结束（_finish 内部已 emit） */
  _checkEnd(mover, chained) {
    if (chained) return false
    const opp = this.turn
    let oppPieces = 0
    for (let i = 0; i < 64; i++) {
      if (sideOf(this.board[i]) === opp) oppPieces += 1
    }
    if (oppPieces === 0) {
      this._finish(mover)
      return true
    }
    if (generateMoves(this.board, opp, -1).length === 0) {
      this._finish(mover)
      return true
    }
    if (this.quietPlies >= CHECKERS.DRAW_QUIET_PLIES) {
      this._finish(null)
      return true
    }
    return false
  }

  _finish(winner) {
    if (this.clockRunning) {
      this.elapsedBase += Date.now() - this.resumeAt
      this.clockRunning = false
    }
    this.state = 'over'
    this.winner = winner
    this.chainFrom = -1
    this.lastAction = winner ? 'win' : 'draw'
    this._emit()
    const result = winner === SIDE.RED ? 'win' : winner === SIDE.BLACK ? 'lose' : 'draw'
    this.cb.onGameOver?.({
      result,
      elapsed: this._elapsed(),
      moves: this.movesPlayed,
      captures: this.capturesMade,
      promotions: this.promotions,
      aiMs: this.aiMs,
      level: this.level,
      mode: this.mode,
      dailyDate: this.dailyDate,
    })
  }

  _searchRoot(moves, depth, deadline) {
    let best = moves[0]
    let bestScore = -Infinity
    for (const move of moves) {
      const board = this.board.slice()
      const { promoted } = applyMove(board, SIDE.BLACK, move)
      let nextChain = -1
      if (move.captures.length && !promoted) {
        if (generateMoves(board, SIDE.BLACK, move.to).length) nextChain = move.to
      }
      let score
      if (nextChain >= 0) {
        score = this._negamax(board, SIDE.BLACK, depth - 1, -Infinity, Infinity, nextChain, deadline)
      } else {
        score = -this._negamax(board, SIDE.RED, depth - 1, -Infinity, Infinity, -1, deadline)
      }
      score += (this.random() - 0.5) * 0.01 // 同分随机打散，避免每局完全一样
      if (score > bestScore) {
        bestScore = score
        best = move
      }
    }
    return best
  }

  _negamax(board, side, depth, alpha, beta, chainFrom, deadline) {
    if (Date.now() > deadline) return this._evaluate(board, side)
    const moves = generateMoves(board, side, chainFrom)
    if (moves.length === 0) return -90000 - depth
    if (depth <= 0) return this._evaluate(board, side)

    let best = -Infinity
    for (const move of moves) {
      const next = board.slice()
      const { promoted } = applyMove(next, side, move)
      let nextSide = otherSide(side)
      let nextChain = -1
      if (move.captures.length && !promoted) {
        if (generateMoves(next, side, move.to).length) {
          nextSide = side
          nextChain = move.to
        }
      }
      const value = nextSide === side
        ? this._negamax(next, nextSide, depth - 1, alpha, beta, nextChain, deadline)
        : -this._negamax(next, nextSide, depth - 1, -beta, -alpha, -1, deadline)
      if (value > best) best = value
      if (best > alpha) alpha = best
      if (alpha >= beta) break
    }
    return best
  }

  /** 以 side 视角评估盘面：子力 + 推进度 + 中路倾向 */
  _evaluate(board, side) {
    let red = 0
    let black = 0
    const center = [0, 1, 2, 3, 3, 2, 1, 0]
    for (let i = 0; i < 64; i++) {
      const p = board[i]
      if (!p) continue
      const r = i >> 3
      const c = i & 7
      if (isRedPiece(p)) {
        red += isKingPiece(p) ? 180 : 100 + (7 - r) * 6 + center[c]
      } else {
        black += isKingPiece(p) ? 180 : 100 + r * 6 + center[c]
      }
    }
    const diff = black - red
    return side === SIDE.BLACK ? diff : -diff
  }

  _elapsed() {
    const running = this.clockRunning ? Date.now() - this.resumeAt : 0
    return Math.round((this.elapsedBase + running) / 100) / 10
  }

  getSnapshot() {
    const board = this.board && this.board.length ? Array.from(this.board) : []
    let redCount = 0
    let blackCount = 0
    for (const p of board) {
      if (isRedPiece(p)) redCount += 1
      else if (isBlackPiece(p)) blackCount += 1
    }
    const moves = this.state === 'playing' && board.length
      ? generateMoves(this.board, this.turn, this.chainFrom)
      : []
    return {
      state: this.state,
      level: this.level,
      mode: this.mode,
      dailyDate: this.dailyDate,
      board,
      turn: this.turn,
      chainFrom: this.chainFrom,
      winner: this.winner,
      playerPieces: redCount,
      aiPieces: blackCount,
      mustCapture: moves.some((m) => m.captures.length > 0),
      legalMoveCount: moves.length,
      elapsed: this._elapsed(),
      moves: this.movesPlayed,
      captures: this.capturesMade,
      promotions: this.promotions,
      aiMs: this.aiMs,
      lastAction: this.lastAction,
      lastMove: this.lastMove,
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }
}
