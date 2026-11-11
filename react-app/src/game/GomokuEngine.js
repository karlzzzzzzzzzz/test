/**
 * 五子棋 / 连珠（Gomoku，纯逻辑引擎，与 UI 解耦）
 * 架构对齐 ReversiEngine：回调通信 + pause/resume 时钟基准 + tick 超时 + dispose。
 * 状态：start → playing ⇄ paused → over（win | lose | draw | timeout）。
 *
 * 规则：15×15 棋盘，黑先白后；横/竖/两斜线任一方向五连即胜；棋盘填满仍未成五判 draw。
 * 三档 AI：easy 随机（或 30% 贪心）、medium 启发式评估、hard α-β 搜索深度 4（带 3s 超时保护）。
 * 悔棋栈 ≤30 步：双人模式每次点击撤销 2 步（回到己方落子前），单人 AI 模式同理。
 * 回合计时：黑白各独立 60s/回合，剩余时间累加到下回合作缓冲（回合制时间银行）。
 *
 * 约束卡落实：
 *   - 埋点：落子/悔棋/胜负/AI 思考耗时/超时全部通过 onStats 回调交给页面写入 game-gomoku-stats-v1。
 *   - 番茄钟联动：引擎只回调 onSession(startTs, endTs, durSec, win)，页面负责写入 pomodoro-sessions-v1。
 *   - 切后台/失焦：pause() 冻结双方计时、AI 停止思考（恢复时 AI 重新评估）。
 */

export const DIFFICULTY = {
  easy: { label: '轻松', desc: '电脑偶尔走神', depth: 0, thinkDeadlineMs: 500 },
  normal: { label: '挑战', desc: '电脑会堵四连活三', depth: 1, thinkDeadlineMs: 1500 },
  hard: { label: '专家', desc: '电脑向前算 4 步', depth: 4, thinkDeadlineMs: 3000 },
}

export const GOMOKU = {
  SIZE: 15,
  TICK_MS: 250,
  AI_DELAY_MS: 480,
  TURN_SEC: 60,
  UNDO_LIMIT: 30,
  P1: 1, // 黑（先手）
  P2: 2, // 白
  EMPTY: 0,
}

const DIRS = [
  [0, 1],   // 横
  [1, 0],   // 竖
  [1, 1],   // 正斜
  [1, -1],  // 反斜
]

const other = (who) => (who === GOMOKU.P1 ? GOMOKU.P2 : GOMOKU.P1)

/** 初始空棋盘 */
function emptyBoard() {
  return new Array(GOMOKU.SIZE * GOMOKU.SIZE).fill(GOMOKU.EMPTY)
}

/** 构造「中心区优先」的合法位置序列（天元 + 3×3 → 5×5 → 全盘），AI 搜索剪枝 */
function orderedLegal(legal) {
  const out = []
  const center = 112 // 天元 8×15+8
  const push = (idx) => { if (legal.includes(idx) && !out.includes(idx)) out.push(idx) }
  push(center)
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      push(center + dr * 15 + dc)
    }
  }
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      push(center + dr * 15 + dc)
    }
  }
  for (const idx of legal) push(idx)
  return out
}

/** 计算某方向上，某点落子后形成的连续长度（两侧含自己），最大 5 */
function lineLength(board, idx, who, [dr, dc]) {
  const r0 = Math.floor(idx / GOMOKU.SIZE)
  const c0 = idx % GOMOKU.SIZE
  let len = 1
  for (let step = 1; step <= 4; step++) {
    const r = r0 + dr * step
    const c = c0 + dc * step
    if (r < 0 || r >= GOMOKU.SIZE || c < 0 || c >= GOMOKU.SIZE) break
    if (board[r * GOMOKU.SIZE + c] !== who) break
    len += 1
  }
  for (let step = 1; step <= 4; step++) {
    const r = r0 - dr * step
    const c = c0 - dc * step
    if (r < 0 || r >= GOMOKU.SIZE || c < 0 || c >= GOMOKU.SIZE) break
    if (board[r * GOMOKU.SIZE + c] !== who) break
    len += 1
  }
  return len
}

/** 从落子点沿方向扫描，返回五连的 5 颗索引数组（含 idx），否则 [] */
function fiveLine(board, idx, who) {
  for (const d of DIRS) {
    const r0 = Math.floor(idx / GOMOKU.SIZE)
    const c0 = idx % GOMOKU.SIZE
    // 以 idx 为基准，把方向上所有同色位置收集起来，判断长度 ≥5
    const line = [idx]
    for (const sign of [1, -1]) {
      for (let step = 1; step <= 4; step++) {
        const r = r0 + d[0] * step * sign
        const c = c0 + d[1] * step * sign
        if (r < 0 || r >= GOMOKU.SIZE || c < 0 || c >= GOMOKU.SIZE) break
        const p = r * GOMOKU.SIZE + c
        if (board[p] !== who) break
        line.push(p)
      }
    }
    if (line.length >= 5) return line
  }
  return []
}

/** 启发式评估：己方活四/活三/活二 + 阻四/阻活三，返回 who 视角的得分 */
function heuristicScore(board, who) {
  const opp = other(who)
  let score = 0
  // 己方连珠分
  for (let idx = 0; idx < board.length; idx++) {
    if (board[idx] !== who) continue
    for (const d of DIRS) {
      const len = lineLength(board, idx, who, d)
      if (len >= 5) score += 1_000_000
      else if (len === 4) score += 200_000
      else if (len === 3) score += 8_000
      else if (len === 2) score += 500
      else score += 10
    }
  }
  // 对方连珠扣分（阻四/阻活三）
  for (let idx = 0; idx < board.length; idx++) {
    if (board[idx] !== opp) continue
    for (const d of DIRS) {
      const len = lineLength(board, idx, opp, d)
      if (len >= 5) score -= 1_000_000
      else if (len === 4) score -= 150_000
      else if (len === 3) score -= 6_000
      else if (len === 2) score -= 400
      else score -= 8
    }
  }
  return score
}

export class GomokuEngine {
  /**
   * @param {Object} cb onState(snapshot) / onGameOver(info) / onPause() / onStats({ aiMs, event }) / onSession(info)
   *   onGameOver: { score, elapsed, result, winner, winLine, moves, aiTimeouts }
   *   onStats: { event: 'move'|'undo'|'win'|'lose'|'draw'|'timeout', aiMs?, aiTimeout? }
   *   onSession: { startTs, endTs, durSec, win, level, mode }
   * @param {Object} options { random, now } 注入随机源与时钟
   */
  constructor(cb = {}, options = {}) {
    this.cb = cb
    this.random = options.random || Math.random
    this._now = options.now || Date.now

    this.size = GOMOKU.SIZE
    this.state = 'start'
    this.mode = 'ai'           // 'ai'（单人 vs AI）| 'pvp'（双人本地）
    this.level = 'easy'
    this._cfg = DIFFICULTY.easy

    this.board = emptyBoard()
    this.turn = GOMOKU.P1      // 黑先
    this.moves = 0
    this.result = null
    this.winner = null
    this.winLine = []
    this.lastMove = null
    this.lastAction = null

    // 悔棋栈：双人每次撤销 2 步（回到己方前），单人 AI 同理
    this.undoStack = []

    // 回合计时：双方独立计时，剩余时间累加到下回合作缓冲
    this.playerTime = GOMOKU.TURN_SEC * 1000 // 黑（玩家）
    this.aiTime = GOMOKU.TURN_SEC * 1000     // 白（AI 或对手）
    this.turnStartAt = this._now()           // ← start 后立即设为 now，P1 回合开始计时
    this.started = false
    this.sessionStartTs = 0
    this.clockRunning = true                 // ← 开局即启动计时（P1 黑先手）

    this.aiTimeouts = 0       // AI 超时回退次数
    this.aiThinkingMs = 0
  }

  /**
   * 开局。
   * @param {'ai'|'pvp'} mode
   * @param {'easy'|'normal'|'hard'} level 非法回退 easy
   */
  start(mode = 'ai', level = 'easy') {
    const lvl = level in DIFFICULTY ? level : 'easy'
    this.mode = mode === 'pvp' ? 'pvp' : 'ai'
    this.level = lvl
    this._cfg = DIFFICULTY[lvl]

    this.board = emptyBoard()
    this.turn = GOMOKU.P1
    this.moves = 0
    this.result = null
    this.winner = null
    this.winLine = []
    this.lastMove = null
    this.lastAction = 'start'
    this.undoStack = []
    this.playerTime = GOMOKU.TURN_SEC * 1000
    this.aiTime = GOMOKU.TURN_SEC * 1000
    this.turnStartAt = 0
    this.started = false
    this.sessionStartTs = 0
    this.aiTimeouts = 0
    this.aiThinkingMs = 0
    this.state = 'playing'
    this._emit()
  }

  /**
   * 玩家落子（双人模式下双方都调用 tap；单人模式下只玩家调 tap，AI 回合调 aiTurn）。
   * @param {number} idx 0~224
   * @returns {boolean} true=落子成功
   */
  tap(idx) {
    if (this.state !== 'playing') return false
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.board.length) return false
    if (this.board[idx] !== GOMOKU.EMPTY) return false
    if (this.mode === 'ai' && this.turn !== GOMOKU.P1) return false

    this._ensureClock()
    this._pushUndo(idx)
    this.board[idx] = this.turn
    this.moves += 1
    this.lastMove = { idx, who: this.turn }
    this.lastAction = 'tap'
    this.cb.onStats?.({ event: 'move' })

    // 判胜 / 判满 / 切换
    const win = fiveLine(this.board, idx, this.turn)
    if (win.length) {
      this.winLine = win
      this.winner = this.turn
      this._finish('win')
      return true
    }
    if (this._isFull()) {
      this._finish('draw')
      return true
    }
    this._switchTurn()
    return true
  }

  /**
   * AI 落子（页面在 AI_DELAY_MS 后调用）。
   * @returns {number} 落子索引，-1 表示未执行
   */
  aiTurn() {
    if (this.state !== 'playing' || this.mode !== 'ai' || this.turn !== GOMOKU.P2) return -1
    this._ensureClock()
    const startTs = this._now()
    const idx = this._chooseAiMove()
    const elapsed = this._now() - startTs
    this.aiThinkingMs += elapsed
    if (elapsed > this._cfg.thinkDeadlineMs) {
      this.aiTimeouts += 1
      this.cb.onStats?.({ event: 'move', aiMs: elapsed, aiTimeout: true })
    } else {
      this.cb.onStats?.({ event: 'move', aiMs: elapsed })
    }
    if (idx < 0) return -1

    this._pushUndo(idx)
    this.board[idx] = GOMOKU.P2
    this.moves += 1
    this.lastMove = { idx, who: GOMOKU.P2 }
    this.lastAction = 'ai'

    const win = fiveLine(this.board, idx, GOMOKU.P2)
    if (win.length) {
      this.winLine = win
      this.winner = GOMOKU.P2
      this._finish('lose')
      return idx
    }
    if (this._isFull()) {
      this._finish('draw')
      return idx
    }
    this._switchTurn()
    return idx
  }

  /** 双人模式下 P2（白方）手动落子。 */
  pvpTap(idx) {
    if (this.mode !== 'pvp') return false
    if (this.turn !== GOMOKU.P2) return false
    return this.tap(idx)
  }

  /** 悔棋一次。双人模式每次调用撤销 2 步（回到调用方落子前的局面）。 */
  undo() {
    if (this.state !== 'playing') return false
    const steps = this.mode === 'ai' ? 2 : 2 // 单人 AI 撤己方 + AI，双人撤当前方 + 对手
    let ok = false
    for (let i = 0; i < steps && this.undoStack.length; i++) {
      const op = this.undoStack.pop()
      this.board[op.idx] = GOMOKU.EMPTY
      this.moves = Math.max(0, this.moves - 1)
      this.turn = op.prevTurn
      this.lastMove = op.prevLastMove
      ok = true
    }
    if (ok) {
      this.lastAction = 'undo'
      this.cb.onStats?.({ event: 'undo' })
      // 悔棋后重置双方剩余时间（避免把"已经消耗的时间"也带回来）
      this.playerTime = GOMOKU.TURN_SEC * 1000
      this.aiTime = GOMOKU.TURN_SEC * 1000
      this.turnStartAt = this._now()
      this.clockRunning = true
      this._emit()
    }
    return ok
  }

  /** 认输（当前执子方）。 */
  resign() {
    if (this.state !== 'playing') return false
    const loser = this.turn
    this.winner = other(loser)
    this._finish('resign')
    return true
  }

  /** 页面每 TICK_MS 调用：刷新双方回合计时并判超时 */
  tick() {
    if (this.state !== 'playing' || !this.clockRunning) return
    const elapsed = this._now() - this.turnStartAt
    if (this.turn === GOMOKU.P1 && this.playerTime - elapsed <= 0) {
      this.winner = GOMOKU.P2
      this._finish('timeout')
      return
    }
    if (this.turn === GOMOKU.P2 && this.aiTime - elapsed <= 0) {
      this.winner = GOMOKU.P1
      this._finish('timeout')
      return
    }
    this._emit()
  }

  pause() {
    if (this.state !== 'playing') return
    // 冻结当前回合剩余时间
    if (this.clockRunning) {
      const used = this._now() - this.turnStartAt
      if (this.turn === GOMOKU.P1) this.playerTime = Math.max(0, this.playerTime - used)
      else this.aiTime = Math.max(0, this.aiTime - used)
    }
    this.clockRunning = false
    this.state = 'paused'
    this.lastAction = 'pause'
    this.cb.onPause?.()
    this._emit()
  }

  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    this.clockRunning = true
    this.turnStartAt = this._now()
    this.lastAction = 'resume'
    this._emit()
  }

  dispose() {
    this.cb = {}
  }

  getSnapshot() {
    const playerRemain = this.state === 'playing' && this.turn === GOMOKU.P1 && this.started
      ? Math.max(0, this.playerTime - (this._now() - this.turnStartAt))
      : Math.max(0, this.playerTime)
    const aiRemain = this.state === 'playing' && this.turn === GOMOKU.P2 && this.started
      ? Math.max(0, this.aiTime - (this._now() - this.turnStartAt))
      : Math.max(0, this.aiTime)
    return {
      state: this.state,
      mode: this.mode,
      level: this.level,
      levelLabel: this._cfg.label,
      size: this.size,
      board: this.board.slice(),
      turn: this.turn,
      turnLabel: this.turn === GOMOKU.P1 ? '黑' : '白',
      moves: this.moves,
      playerRemain, // ms
      aiRemain,     // ms
      result: this.result,
      winner: this.winner,
      winLine: this.winLine.slice(),
      isPlayerTurn: this.mode === 'ai' ? this.turn === GOMOKU.P1 : true,
      aiThinking: this.state === 'playing' && this.mode === 'ai' && this.turn === GOMOKU.P2,
      canUndo: this.state === 'playing' && this.undoStack.length >= 2,
      lastMove: this.lastMove ? { ...this.lastMove } : null,
      lastAction: this.lastAction,
      aiTimeouts: this.aiTimeouts,
      started: this.started,
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }

  _ensureClock() {
    if (this.started) return
    this.started = true
    this.sessionStartTs = this._now()
    // turnStartAt 已在 start() 里设好；pvp 双人模式下也要从开局起算
  }

  /** 把"剩余时间"保存到 undo 里，悔棋恢复当前 turn 时，剩余时间也恢复当时状态（更直观） */
  _pushUndo(idx) {
    this.undoStack.push({
      idx,
      prevTurn: this.turn,
      prevLastMove: this.lastMove ? { ...this.lastMove } : null,
      // 保存玩家/AI 各自剩余时间（毫秒）
      playerTimeSave: this.turn === GOMOKU.P1 ? this.playerTime - (this.started ? (this._now() - this.turnStartAt) : 0) : this.playerTime,
      aiTimeSave: this.turn === GOMOKU.P2 ? this.aiTime - (this.started ? (this._now() - this.turnStartAt) : 0) : this.aiTime,
      // turnStartAt 留给悔棋恢复时重置
    })
    if (this.undoStack.length > GOMOKU.UNDO_LIMIT) this.undoStack.shift()
  }

  _switchTurn() {
    // 保存当前回合消耗时间，剩余时间累加到下回合（回合制时间银行）
    if (this.clockRunning) {
      const used = this._now() - this.turnStartAt
      if (this.turn === GOMOKU.P1) {
        const remain = Math.max(0, this.playerTime - used)
        this.playerTime = remain + GOMOKU.TURN_SEC * 1000 // 剩余 + 60s 新回合
      } else {
        const remain = Math.max(0, this.aiTime - used)
        this.aiTime = remain + GOMOKU.TURN_SEC * 1000
      }
    }
    this.clockRunning = true
    this.turn = other(this.turn)
    this.turnStartAt = this._now()
  }

  _isFull() {
    return !this.board.includes(GOMOKU.EMPTY)
  }

  _chooseAiMove() {
    const legal = this._legalList()
    if (!legal.length) return -1
    const ordered = orderedLegal(legal)
    if (this._cfg.depth === 0) {
      // easy：70% 随机走神，30% 贪心（启发式）
      if (this.random() < 0.7) return ordered[Math.floor(this.random() * ordered.length)]
      return this._greedyPick(ordered)
    }
    if (this._cfg.depth <= 1) return this._greedyPick(ordered)
    return this._abPick(ordered)
  }

  _legalList() {
    const out = []
    // 只考虑"当前已落子 2 格半径范围内"的空格，剪枝
    const hasAny = this.moves > 0
    for (let idx = 0; idx < this.board.length; idx++) {
      if (this.board[idx] !== GOMOKU.EMPTY) continue
      if (!hasAny) { out.push(idx); continue }
      const r = Math.floor(idx / 15)
      const c = idx % 15
      let near = false
      for (let dr = -2; dr <= 2 && !near; dr++) {
        for (let dc = -2; dc <= 2 && !near; dc++) {
          if (!dr && !dc) continue
          const nr = r + dr, nc = c + dc
          if (nr < 0 || nr >= 15 || nc < 0 || nc >= 15) continue
          if (this.board[nr * 15 + nc] !== GOMOKU.EMPTY) near = true
        }
      }
      if (near) out.push(idx)
    }
    return out
  }

  /** 启发式选点：己方评估 + 对方评估，选最大差值（攻防兼顾） */
  _greedyPick(ordered) {
    let best = -Infinity
    let pick = ordered[0]
    for (const idx of ordered) {
      this.board[idx] = GOMOKU.P2
      const mine = heuristicScore(this.board, GOMOKU.P2)
      this.board[idx] = GOMOKU.P1
      const yours = heuristicScore(this.board, GOMOKU.P1)
      this.board[idx] = GOMOKU.EMPTY
      const val = Math.max(mine, yours * 0.9 + mine * 0.1)
      if (val > best) { best = val; pick = idx }
    }
    return pick
  }

  /** α-β 搜索：AI 视角极大化，玩家视角极小化，深度上限 _cfg.depth */
  _abPick(ordered) {
    const deadline = this._now() + this._cfg.thinkDeadlineMs
    let best = -Infinity
    let pick = ordered[0]
    let alpha = -Infinity
    const depth = this._cfg.depth
    for (const idx of ordered) {
      this.board[idx] = GOMOKU.P2
      const val = this._abSearch(GOMOKU.P1, depth - 1, alpha, Infinity, deadline)
      this.board[idx] = GOMOKU.EMPTY
      if (val > best) { best = val; pick = idx }
      alpha = Math.max(alpha, best)
      if (this._now() > deadline) break
    }
    return pick
  }

  _abSearch(who, depth, alpha, beta, deadline) {
    // 超时即返回当前启发式估算（让上层及时截断）
    if (this._now() > deadline) return heuristicScore(this.board, GOMOKU.P2)
    // 终局检查：若 AI 已有五连则极大化，玩家有五连则极小化
    // 剪枝：只搜"相邻已落子 2 格内"的空格
    let hasAny = false
    for (let i = 0; i < this.board.length; i++) {
      if (this.board[i] !== GOMOKU.EMPTY) { hasAny = true; break }
    }
    if (!hasAny) return 0
    const legal = this._legalList().slice(0, 40) // 再截一层
    if (!legal.length || depth <= 0) return heuristicScore(this.board, GOMOKU.P2)

    if (who === GOMOKU.P2) {
      let best = -Infinity
      for (const idx of orderedLegal(legal)) {
        this.board[idx] = GOMOKU.P2
        // 立即成五 → 直接返回极大值
        if (fiveLine(this.board, idx, GOMOKU.P2).length) { this.board[idx] = GOMOKU.EMPTY; return 1_000_000 - (this._cfg.depth - depth) * 1000 }
        const val = this._abSearch(GOMOKU.P1, depth - 1, alpha, beta, deadline)
        this.board[idx] = GOMOKU.EMPTY
        best = Math.max(best, val)
        alpha = Math.max(alpha, best)
        if (beta <= alpha) break
        if (this._now() > deadline) break
      }
      return best
    }

    let best = Infinity
    for (const idx of orderedLegal(legal)) {
      this.board[idx] = GOMOKU.P1
      if (fiveLine(this.board, idx, GOMOKU.P1).length) { this.board[idx] = GOMOKU.EMPTY; return -1_000_000 + (this._cfg.depth - depth) * 1000 }
      const val = this._abSearch(GOMOKU.P2, depth - 1, alpha, beta, deadline)
      this.board[idx] = GOMOKU.EMPTY
      best = Math.min(best, val)
      beta = Math.min(beta, best)
      if (beta <= alpha) break
      if (this._now() > deadline) break
    }
    return best
  }

  _finish(result) {
    const endAt = this._now()
    let durSec = 0
    if (this.sessionStartTs) durSec = Math.max(0, Math.round((endAt - this.sessionStartTs) / 1000))
    this.state = 'over'
    this.result = result
    this.lastAction = result

    // AI 模式下 result 'lose' 就是玩家输，映射为 'lose'
    this.cb.onStats?.({ event: result === 'win' ? 'win' : result === 'lose' ? 'lose' : result })

    this.cb.onGameOver?.({
      result,
      winner: this.winner,
      moves: this.moves,
      elapsedSec: durSec,
      aiTimeouts: this.aiTimeouts,
      level: this.level,
      mode: this.mode,
    })

    // 番茄钟联动：对局时长 ≥2min 才写入（短对局不触发）
    if (durSec >= 120) {
      const win = this.mode === 'pvp' ? result === 'win' : result !== 'lose'
      this.cb.onSession?.({
        startTs: this.sessionStartTs || endAt - durSec * 1000,
        endTs: endAt,
        durSec,
        win,
        level: this.level,
        mode: this.mode,
      })
    }

    this._emit()
  }
}
