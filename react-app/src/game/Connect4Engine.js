/**
 * 四连棋引擎（Connect Four，纯逻辑，与 UI 解耦）
 * 架构对齐 LightsOutEngine：回调通信 + pause/resume 时钟基准 + dispose。
 * 状态：start → playing ⇄ paused → over（win | lose | draw | timeout）。
 *
 * 规则：点按一列，棋子落到该列最底部；先让四枚同色棋子连成横/竖/斜线即获胜。
 * 棋盘 6 列 × 7 行：6 列保证 320px 宽度下每格仍 ≥40px 热区。
 */

export const DIFFICULTY = {
  easy: { label: '轻松', desc: '电脑偶尔走神', baseScore: 600, limitSec: 180, ai: 'easy' },
  normal: { label: '挑战', desc: '电脑会堵你的三连', baseScore: 900, limitSec: 180, ai: 'normal' },
  hard: { label: '专家', desc: '电脑会向前算 4 步', baseScore: 1200, limitSec: 180, ai: 'hard' },
}

export const CONNECT4 = {
  ROWS: 7,
  COLS: 6,
  NEED: 4,
  TICK_MS: 250, // 页面侧倒计时刷新间隔
  AI_DELAY_MS: 420, // 电脑落子前的思考延迟（页面侧）
  MOVE_PENALTY: 12, // 每落一子扣 12 分
  SEC_PENALTY: 2, // 每秒扣 2 分
  MIN_SCORE: 100,
  AI_DEPTH: 4,
  PLAYER: 1,
  AI: 2,
}

const DIRS = [
  [0, 1], // 横
  [1, 0], // 竖
  [1, 1], // 左上-右下
  [1, -1], // 右上-左下
]

/** 生成所有「4 连」窗口的索引，供评估函数复用 */
function buildWindows(rows, cols, need) {
  const out = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (const [dr, dc] of DIRS) {
        const endR = r + dr * (need - 1)
        const endC = c + dc * (need - 1)
        if (endR < 0 || endR >= rows || endC < 0 || endC >= cols) continue
        const win = []
        for (let i = 0; i < need; i++) win.push((r + dr * i) * cols + (c + dc * i))
        out.push(win)
      }
    }
  }
  return out
}

export class Connect4Engine {
  /**
   * @param {Object} cb 回调：onState(snapshot) / onGameOver(score, elapsed, result) / onPause()
   * @param {Object} options { random } 注入随机源便于单测
   */
  constructor(cb = {}, options = {}) {
    this.cb = cb
    this.random = options.random || Math.random

    this.rows = CONNECT4.ROWS
    this.cols = CONNECT4.COLS
    this.windows = buildWindows(this.rows, this.cols, CONNECT4.NEED)

    this.state = 'start'
    this.level = 'easy'
    this._cfg = DIFFICULTY.easy
    this.cells = new Array(this.rows * this.cols).fill(0)
    this.turn = 'player'
    this.moves = 0
    this.result = null
    this.winningLine = null
    this.lastDrop = null
    this.lastAction = null

    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
  }

  /** 开局：清空棋盘，玩家先手 */
  start(level = 'easy') {
    const key = level in DIFFICULTY ? level : 'easy'
    this._cfg = DIFFICULTY[key]
    this.level = key
    this.cells = new Array(this.rows * this.cols).fill(0)
    this.turn = 'player'
    this.moves = 0
    this.result = null
    this.winningLine = null
    this.lastDrop = null
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
    this.state = 'playing'
    this.lastAction = 'start'
    this._emit()
  }

  /**
   * 玩家落子。
   * @param {number} col 列索引 0~cols-1
   * @returns {boolean} true=已落子，false=被忽略
   */
  drop(col) {
    if (this.state !== 'playing' || this.turn !== 'player') return false
    if (!Number.isInteger(col) || col < 0 || col >= this.cols) return false
    const idx = this._lowestEmpty(col)
    if (idx < 0) return false

    if (!this.started) {
      this.started = true
      this.resumeAt = Date.now() - this.elapsedBase
    }
    this._place(idx, CONNECT4.PLAYER)
    this.moves += 1
    this.turn = 'ai'
    this.lastAction = 'drop'

    const line = this._lineFrom(this.cells, idx, CONNECT4.PLAYER)
    if (line) {
      this.winningLine = line
      this._finish('win')
      return true
    }
    if (this.moves >= this.rows * this.cols) {
      this._finish('draw')
      return true
    }
    this._emit()
    return true
  }

  /**
   * 电脑落子（页面在 AI_DELAY_MS 后调用；暂停期间调用会被忽略）。
   * @returns {number} 落子的列，-1 表示无可用列/未轮到电脑
   */
  aiTurn() {
    if (this.state !== 'playing' || this.turn !== 'ai') return -1
    const col = this._chooseAiCol()
    if (col < 0) {
      this._finish('draw')
      return -1
    }
    const idx = this._lowestEmpty(col)
    this._place(idx, CONNECT4.AI)
    this.moves += 1
    this.turn = 'player'
    this.lastAction = 'ai'
    this.lastDrop = { col, row: Math.floor(idx / this.cols), who: 'ai' }

    const line = this._lineFrom(this.cells, idx, CONNECT4.AI)
    if (line) {
      this.winningLine = line
      this._finish('lose')
      return col
    }
    if (this.moves >= this.rows * this.cols) {
      this._finish('draw')
      return col
    }
    this._emit()
    return col
  }

  /** 页面每 250ms 调用一次：驱动倒计时刷新与超时判定 */
  tick() {
    if (this.state !== 'playing' || !this.started) return
    if (this._elapsed() >= this._cfg.limitSec) {
      this._finish('timeout')
      return
    }
    this._emit()
  }

  /** 切后台/失焦/手动暂停（仅 playing 生效） */
  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    if (this.started) this.elapsedBase += Date.now() - this.resumeAt
    this.lastAction = 'pause'
    this.cb.onPause?.()
    this._emit()
  }

  /** 恢复：重置时钟基准，防暂停时长计入 */
  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    if (this.started) this.resumeAt = Date.now()
    this.lastAction = 'resume'
    this._emit()
  }

  dispose() {
    // 引擎不持有定时器（tick 与 AI 延迟均由页面驱动），此处仅解除回调引用
    this.cb = {}
  }

  /** 得分：仅胜利计分；max(100, 基准 − 落子数×12 − 秒数×2) */
  _score() {
    const penalty = this.moves * CONNECT4.MOVE_PENALTY + Math.floor(this._elapsed()) * CONNECT4.SEC_PENALTY
    return Math.max(CONNECT4.MIN_SCORE, Math.round(this._cfg.baseScore - penalty))
  }

  _elapsed() {
    const running = this.state === 'playing' && this.started ? Date.now() - this.resumeAt : 0
    return Math.round(((this.elapsedBase + running) / 1000) * 10) / 10
  }

  _finish(result) {
    if (this.started) this.elapsedBase += Date.now() - this.resumeAt
    this.state = 'over'
    this.result = result
    this.lastAction = result
    this._emit()
    this.cb.onGameOver?.(result === 'win' ? this._score() : 0, this._elapsed(), result)
  }

  /** 该列最低的空位索引；满列返回 -1 */
  _lowestEmpty(col) {
    for (let r = this.rows - 1; r >= 0; r--) {
      const idx = r * this.cols + col
      if (this.cells[idx] === 0) return idx
    }
    return -1
  }

  _place(idx, who) {
    this.cells[idx] = who
    this.lastDrop = { col: idx % this.cols, row: Math.floor(idx / this.cols), who: who === CONNECT4.AI ? 'ai' : 'player' }
  }

  /** 从最后落子出发，四方向找连续同色 ≥4，返回所有连成的索引 */
  _lineFrom(cells, idx, who) {
    const r0 = Math.floor(idx / this.cols)
    const c0 = idx % this.cols
    for (const [dr, dc] of DIRS) {
      const line = [idx]
      for (const sign of [-1, 1]) {
        let r = r0 + dr * sign
        let c = c0 + dc * sign
        while (r >= 0 && r < this.rows && c >= 0 && c < this.cols && cells[r * this.cols + c] === who) {
          line.push(r * this.cols + c)
          r += dr * sign
          c += dc * sign
        }
      }
      if (line.length >= CONNECT4.NEED) {
        line.sort((a, b) => a - b)
        return line
      }
    }
    return null
  }

  _legalCols(cells) {
    const out = []
    for (let c = 0; c < this.cols; c++) {
      if (cells[(this.rows - 1) * this.cols + c] === 0) out.push(c)
    }
    return out
  }

  /** 模拟落子，返回 { cells: 新数组, idx } */
  _simulate(cells, col, who) {
    const next = cells.slice()
    for (let r = this.rows - 1; r >= 0; r--) {
      const idx = r * this.cols + col
      if (next[idx] === 0) {
        next[idx] = who
        return { cells: next, idx }
      }
    }
    return null
  }

  /** 某方是否存在一步成四的落点 */
  _findWinningMove(cells, who) {
    for (const col of this._ordered(this._legalCols(cells))) {
      const sim = this._simulate(cells, col, who)
      if (sim && this._lineFrom(sim.cells, sim.idx, who)) return col
    }
    return -1
  }

  _ordered(legal) {
    const order = [2, 3, 1, 4, 0, 5]
    return order.filter((c) => legal.includes(c))
  }

  /** 电脑选列：三档 AI 强度 */
  _chooseAiCol() {
    const legal = this._legalCols(this.cells)
    if (!legal.length) return -1

    const win = this._findWinningMove(this.cells, CONNECT4.AI)
    if (win >= 0) return win

    if (this._cfg.ai === 'easy') {
      // 40% 走神随机；否则多数情况下会堵三连
      if (this.random() < 0.4) return legal[Math.floor(this.random() * legal.length)]
      const block = this._findWinningMove(this.cells, CONNECT4.PLAYER)
      if (block >= 0 && this.random() < 0.7) return block
      return this._ordered(legal)[0]
    }

    const block = this._findWinningMove(this.cells, CONNECT4.PLAYER)
    if (block >= 0) return block

    if (this._cfg.ai === 'normal') {
      // 1 层评估：挑落子后局面评分最高的列，平分时随机
      let bestVal = -Infinity
      let best = []
      for (const col of this._ordered(legal)) {
        const sim = this._simulate(this.cells, col, CONNECT4.AI)
        const val = this._eval(sim.cells)
        if (val > bestVal) {
          bestVal = val
          best = [col]
        } else if (val === bestVal) {
          best.push(col)
        }
      }
      return best[Math.floor(this.random() * best.length)] ?? this._ordered(legal)[0]
    }

    return this._minimaxMove(legal)
  }

  /** 专家：alpha-beta 极小化极大搜索 */
  _minimaxMove(legal) {
    let bestVal = -Infinity
    let bestCol = this._ordered(legal)[0]
    let alpha = -Infinity
    const beta = Infinity
    for (const col of this._ordered(legal)) {
      const sim = this._simulate(this.cells, col, CONNECT4.AI)
      let val
      if (this._lineFrom(sim.cells, sim.idx, CONNECT4.AI)) {
        val = 1e9
      } else {
        val = this._search(sim.cells, CONNECT4.AI_DEPTH - 1, alpha, beta, CONNECT4.PLAYER, sim.idx, CONNECT4.AI)
      }
      if (val > bestVal) {
        bestVal = val
        bestCol = col
      }
      alpha = Math.max(alpha, bestVal)
    }
    return bestCol
  }

  _search(cells, depth, alpha, beta, who, lastIdx, lastWho) {
    if (lastIdx != null) {
      const line = this._lineFrom(cells, lastIdx, lastWho)
      if (line) return lastWho === CONNECT4.AI ? 1e9 + depth : -1e9 - depth
    }
    const legal = this._legalCols(cells)
    if (depth <= 0 || !legal.length) return this._eval(cells)

    if (who === CONNECT4.AI) {
      let val = -Infinity
      for (const col of this._ordered(legal)) {
        const sim = this._simulate(cells, col, CONNECT4.AI)
        val = Math.max(val, this._search(sim.cells, depth - 1, alpha, beta, CONNECT4.PLAYER, sim.idx, CONNECT4.AI))
        alpha = Math.max(alpha, val)
        if (beta <= alpha) break
      }
      return val
    }

    let val = Infinity
    for (const col of this._ordered(legal)) {
      const sim = this._simulate(cells, col, CONNECT4.PLAYER)
      val = Math.min(val, this._search(sim.cells, depth - 1, alpha, beta, CONNECT4.AI, sim.idx, CONNECT4.PLAYER))
      beta = Math.min(beta, val)
      if (beta <= alpha) break
    }
    return val
  }

  /** 局面评估（电脑视角）：窗口内三连权重高，中心列略加分 */
  _eval(cells) {
    let score = 0
    for (const win of this.windows) {
      let ai = 0
      let pl = 0
      for (const idx of win) {
        if (cells[idx] === CONNECT4.AI) ai += 1
        else if (cells[idx] === CONNECT4.PLAYER) pl += 1
      }
      if (ai > 0 && pl > 0) continue
      if (ai === 4) return 1e8
      if (pl === 4) return -1e8
      if (ai === 3) score += 40
      else if (ai === 2) score += 8
      else if (ai === 1) score += 1
      if (pl === 3) score -= 40
      else if (pl === 2) score -= 8
      else if (pl === 1) score -= 1
    }
    for (let r = 0; r < this.rows; r++) {
      for (const c of [2, 3]) {
        const v = cells[r * this.cols + c]
        if (v === CONNECT4.AI) score += 6
        else if (v === CONNECT4.PLAYER) score -= 6
      }
    }
    return score
  }

  getSnapshot() {
    const remaining = Math.max(0, Math.ceil(this._cfg.limitSec - this._elapsed()))
    return {
      state: this.state,
      level: this.level,
      rows: this.rows,
      cols: this.cols,
      cells: this.cells.slice(),
      turn: this.turn,
      moves: this.moves,
      elapsed: this._elapsed(),
      remaining,
      limitSec: this._cfg.limitSec,
      result: this.result,
      winningLine: this.winningLine ? this.winningLine.slice() : null,
      lastDrop: this.lastDrop ? { ...this.lastDrop } : null,
      aiThinking: this.state === 'playing' && this.turn === 'ai',
      score: this.state === 'over' && this.result === 'win' ? this._score() : null,
      lastAction: this.lastAction,
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }
}
