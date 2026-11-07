/**
 * 黑白棋 / 奥赛罗（Reversi，纯逻辑引擎，与 UI 解耦）
 * 架构对齐 Connect4Engine：回调通信 + pause/resume 时钟基准 + tick 超时 + dispose。
 * 状态：start → playing ⇄ paused → over（win | lose | draw | timeout）。
 *
 * 规则：8×8 棋盘，玩家黑棋先手；每次落子必须夹住至少一列对手棋子并全部翻色；
 * 对手无子可落时自动跳过；双方都无法落子（或棋盘落满）时按盘面棋子数定胜负。
 *
 * 约束卡落实：
 *   - 切后台/失焦：页面调用 pause()，计时冻结（与既有游戏同构）。
 *   - 键盘可达：棋盘 role=grid + roving tabindex，页面负责焦点。
 *   - 频率控制：MIN_TAP_INTERVAL_MS 拦截 150ms 内的重复点按；AI 落子由页面延迟调度。
 */

export const DIFFICULTY = {
  easy: { label: '轻松', desc: '电脑偶尔走神', baseScore: 600, limitSec: 180, depth: 0 },
  normal: { label: '挑战', desc: '电脑会抢角与翻子', baseScore: 900, limitSec: 180, depth: 2 },
  hard: { label: '专家', desc: '电脑向前算 3 步', baseScore: 1200, limitSec: 180, depth: 3 },
}

export const REVERSI = {
  SIZE: 8,
  TICK_MS: 250,
  AI_DELAY_MS: 520,
  MOVE_PENALTY: 12,
  SEC_PENALTY: 2,
  MARGIN_BONUS: 20,
  MIN_SCORE: 100,
  MIN_TAP_INTERVAL_MS: 150,
  PLAYER: 1,
  AI: 2,
}

const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
]

// 经典 8×8 位置权重：角位高、边线次之、角旁与中线负分
const WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
]

const other = (who) => (who === REVERSI.PLAYER ? REVERSI.AI : REVERSI.PLAYER)
const nameOf = (who) => (who === REVERSI.PLAYER ? 'player' : 'ai')

/** 初始盘面：黑（玩家）d5/e4，白（电脑）d4/e5，黑先手 */
function initialBoard() {
  const board = new Array(REVERSI.SIZE * REVERSI.SIZE).fill(0)
  board[27] = REVERSI.AI // d4
  board[36] = REVERSI.AI // e5
  board[35] = REVERSI.PLAYER // d5
  board[28] = REVERSI.PLAYER // e4
  return board
}

export class ReversiEngine {
  /**
   * @param {Object} cb onState(snapshot) / onGameOver(score, elapsed, result) / onPause()
   * @param {Object} options { random, now } 注入随机源与时钟，便于单测
   */
  constructor(cb = {}, options = {}) {
    this.cb = cb
    this.random = options.random || Math.random
    this._now = options.now || Date.now

    this.size = REVERSI.SIZE
    this.state = 'start'
    this.level = 'easy'
    this._cfg = DIFFICULTY.easy
    this.board = initialBoard()
    this.turn = 'player'
    this.moves = 0
    this.passes = 0
    this.result = null
    this.lastMove = null
    this.passBy = null
    this.lastAction = null
    this.lastTapAt = -Infinity

    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
  }

  start(level = 'easy') {
    const key = level in DIFFICULTY ? level : 'easy'
    this._cfg = DIFFICULTY[key]
    this.level = key
    this.board = initialBoard()
    this.turn = 'player'
    this.moves = 0
    this.passes = 0
    this.result = null
    this.lastMove = null
    this.passBy = null
    this.lastTapAt = -Infinity
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
    this.state = 'playing'
    this.lastAction = 'start'
    this._emit()
  }

  /**
   * 玩家落子。
   * @param {number} idx 0~63
   * @returns {boolean} true=已落子，false=非法/被节流/未轮到玩家
   */
  tap(idx) {
    if (this.state !== 'playing' || this.turn !== 'player') return false
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.board.length) return false
    if (this._now() - this.lastTapAt < REVERSI.MIN_TAP_INTERVAL_MS) return false
    const flips = this._flipsFor(this.board, idx, REVERSI.PLAYER)
    if (!flips.length) return false

    if (!this.started) {
      this.started = true
      this.resumeAt = this._now() - this.elapsedBase
    }
    this._apply(idx, REVERSI.PLAYER, flips)
    this.moves += 1
    this.lastTapAt = this._now()
    this.lastAction = 'tap'
    this.passBy = null

    if (this._isFull()) {
      this._finishByCount()
      return true
    }
    const ended = this._switchTurn(REVERSI.PLAYER)
    if (!ended) this._emit()
    return true
  }

  /**
   * 电脑落子（页面在 AI_DELAY_MS 后调用；暂停/未轮到电脑时忽略）。
   * @returns {number} 落子索引，-1 表示未执行
   */
  aiTurn() {
    if (this.state !== 'playing' || this.turn !== 'ai') return -1
    const idx = this._chooseAiMove()
    if (idx < 0) {
      this._finishByCount()
      return -1
    }
    const flips = this._flipsFor(this.board, idx, REVERSI.AI)
    this._apply(idx, REVERSI.AI, flips)
    this.moves += 1
    this.lastAction = 'ai'
    this.passBy = null

    if (this._isFull()) {
      this._finishByCount()
      return idx
    }
    const ended = this._switchTurn(REVERSI.AI)
    if (!ended) this._emit()
    return idx
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

  /** 提示当前玩家所有合法落点（UI 小圆点） */
  getLegalMoves() {
    return this._legalList(this.board, REVERSI.PLAYER)
  }

  getSnapshot() {
    const remaining = Math.max(0, Math.ceil(this._cfg.limitSec - this._elapsed()))
    const counts = this._counts()
    return {
      state: this.state,
      level: this.level,
      size: this.size,
      board: this.board.slice(),
      turn: this.turn,
      moves: this.moves,
      passes: this.passes,
      elapsed: this._elapsed(),
      remaining,
      limitSec: this._cfg.limitSec,
      result: this.result,
      counts,
      legal: this.state === 'playing' && this.turn === 'player' ? this._legalList(this.board, REVERSI.PLAYER) : [],
      lastMove: this.lastMove ? { ...this.lastMove, flips: this.lastMove.flips.slice() } : null,
      passBy: this.passBy,
      aiThinking: this.state === 'playing' && this.turn === 'ai',
      score: this.state === 'over' && this.result === 'win' ? this._score() : null,
      lastAction: this.lastAction,
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }

  _counts() {
    let player = 0
    let ai = 0
    for (const v of this.board) {
      if (v === REVERSI.PLAYER) player += 1
      else if (v === REVERSI.AI) ai += 1
    }
    return { player, ai }
  }

  _isFull() {
    return !this.board.includes(0)
  }

  /** 八方向扫描：返回被夹住、需要翻色的索引 */
  _flipsFor(board, idx, who) {
    if (board[idx] !== 0) return []
    const opp = other(who)
    const r0 = Math.floor(idx / this.size)
    const c0 = idx % this.size
    const flips = []
    for (const [dr, dc] of DIRS) {
      const line = []
      let r = r0 + dr
      let c = c0 + dc
      while (r >= 0 && r < this.size && c >= 0 && c < this.size && board[r * this.size + c] === opp) {
        line.push(r * this.size + c)
        r += dr
        c += dc
      }
      if (line.length && r >= 0 && r < this.size && c >= 0 && c < this.size && board[r * this.size + c] === who) {
        flips.push(...line)
      }
    }
    return flips
  }

  _legalList(board, who) {
    const out = []
    for (let idx = 0; idx < board.length; idx++) {
      if (board[idx] === 0 && this._flipsFor(board, idx, who).length) out.push(idx)
    }
    return out
  }

  _apply(idx, who, flips) {
    this.board[idx] = who
    for (const f of flips) this.board[f] = who
    this.lastMove = { idx, row: Math.floor(idx / this.size), col: idx % this.size, who: nameOf(who), flips: flips.slice() }
  }

  /**
   * 切换回合；对手无子可落则自动跳过。
   * @returns {boolean} true=本局已结束（内部已 emit）
   */
  _switchTurn(afterWho) {
    const next = other(afterWho)
    if (this._legalList(this.board, next).length) {
      this.turn = nameOf(next)
      return false
    }
    const back = other(next)
    if (this._legalList(this.board, back).length) {
      this.turn = nameOf(back)
      this.passBy = nameOf(next)
      this.passes += 1
      this.lastAction = 'pass'
      return false
    }
    this._finishByCount()
    return true
  }

  _finishByCount() {
    const c = this._counts()
    const result = c.player > c.ai ? 'win' : c.player < c.ai ? 'lose' : 'draw'
    this._finish(result)
  }

  _finish(result) {
    if (this.started) this.elapsedBase += this._now() - this.resumeAt
    this.state = 'over'
    this.result = result
    this.lastAction = result
    this._emit()
    this.cb.onGameOver?.(result === 'win' ? this._score() : 0, this._elapsed(), result)
  }

  _score() {
    const c = this._counts()
    const margin = Math.max(0, c.player - c.ai)
    const penalty = this.moves * REVERSI.MOVE_PENALTY + Math.floor(this._elapsed()) * REVERSI.SEC_PENALTY
    return Math.max(REVERSI.MIN_SCORE, Math.round(this._cfg.baseScore - penalty + margin * REVERSI.MARGIN_BONUS))
  }

  _elapsed() {
    const running = this.state === 'playing' && this.started ? this._now() - this.resumeAt : 0
    return Math.round(((this.elapsedBase + running) / 1000) * 10) / 10
  }

  /** 电脑选点：三档强度，easy 随机走神 / normal 贪心 / hard 极小化极大 */
  _chooseAiMove() {
    const legal = this._legalList(this.board, REVERSI.AI)
    if (!legal.length) return -1
    if (this._cfg.depth === 0) {
      if (this.random() < 0.3) return legal[Math.floor(this.random() * legal.length)]
      return this._greedyMove(legal, 1)
    }
    if (this._cfg.depth <= 2) return this._greedyMove(legal, 2)
    return this._minimaxMove(legal)
  }

  _greedyMove(legal, cornerBias = 1) {
    let bestVal = -Infinity
    let best = []
    for (const idx of this._ordered(legal)) {
      const flips = this._flipsFor(this.board, idx, REVERSI.AI).length
      const val = flips + WEIGHTS[idx] * (cornerBias === 2 ? 0.5 : 0.2)
      if (val > bestVal) {
        bestVal = val
        best = [idx]
      } else if (val === bestVal) {
        best.push(idx)
      }
    }
    return best[Math.floor(this.random() * best.length)] ?? legal[0]
  }

  _ordered(legal) {
    const corners = [0, 7, 56, 63]
    return [...corners.filter((c) => legal.includes(c)), ...legal.filter((c) => !corners.includes(c))]
  }

  _minimaxMove(legal) {
    let bestVal = -Infinity
    let bestIdx = this._ordered(legal)[0]
    let alpha = -Infinity
    for (const idx of this._ordered(legal)) {
      const flips = this._flipsFor(this.board, idx, REVERSI.AI)
      const next = this.board.slice()
      next[idx] = REVERSI.AI
      for (const f of flips) next[f] = REVERSI.AI
      const val = this._search(next, REVERSI.PLAYER, this._cfg.depth - 1, alpha, Infinity)
      if (val > bestVal) {
        bestVal = val
        bestIdx = idx
      }
      alpha = Math.max(alpha, bestVal)
    }
    return bestIdx
  }

  _search(board, who, depth, alpha, beta) {
    const legal = this._legalList(board, who)
    if (!legal.length) {
      const otherLegal = this._legalList(board, other(who))
      if (!otherLegal.length || depth <= 0) return this._eval(board)
      return this._search(board, other(who), depth, alpha, beta)
    }
    if (depth <= 0) return this._eval(board)

    if (who === REVERSI.AI) {
      let best = -Infinity
      for (const idx of this._ordered(legal)) {
        const next = board.slice()
        const flips = this._flipsFor(board, idx, REVERSI.AI)
        next[idx] = REVERSI.AI
        for (const f of flips) next[f] = REVERSI.AI
        best = Math.max(best, this._search(next, REVERSI.PLAYER, depth - 1, alpha, beta))
        alpha = Math.max(alpha, best)
        if (beta <= alpha) break
      }
      return best
    }

    let best = Infinity
    for (const idx of this._ordered(legal)) {
      const next = board.slice()
      const flips = this._flipsFor(board, idx, REVERSI.PLAYER)
      next[idx] = REVERSI.PLAYER
      for (const f of flips) next[f] = REVERSI.PLAYER
      best = Math.min(best, this._search(next, REVERSI.AI, depth - 1, alpha, beta))
      beta = Math.min(beta, best)
      if (beta <= alpha) break
    }
    return best
  }

  _eval(board) {
    let score = 0
    let discs = 0
    for (let i = 0; i < board.length; i++) {
      if (board[i] === REVERSI.AI) {
        score += WEIGHTS[i]
        discs += 1
      } else if (board[i] === REVERSI.PLAYER) {
        score -= WEIGHTS[i]
        discs -= 1
      }
    }
    return score + discs * 4
  }
}
