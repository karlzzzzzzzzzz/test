/**
 * 迷宫寻路（Maze，纯逻辑引擎，与 UI 解耦）
 * 架构对齐 SokobanEngine：回调通信 + pause/resume 时钟基准 + tick 超时 + dispose。
 * 状态：start → playing ⇄ paused → over（win | timeout）。
 *
 * 规则：DFS 回溯生成「完美迷宫」（任意两格之间有且仅有一条通路，全格连通），
 * 起点固定左上角、终点固定右下角；BFS 求出的最短路长度作为参考步数 par。
 * 每次有效移动步数 +1，撞墙不计步；提示会给出下一步方向，每局限 3 次并计入扣分。
 *
 * 约束卡落实：
 *   - 切后台/失焦：页面调用 pause()，计时冻结、移动拒绝。
 *   - 生成失败：start() 抛错由页面捕获进入错误态，可重试。
 *   - 存储由页面负责（最佳/埋点两键）。
 */

const WALL_N = 1
const WALL_E = 2
const WALL_S = 4
const WALL_W = 8

/** 三档难度：尺寸为「可走格」边长，墙由格位边框表达，避免 2n+1 网格在 320px 下热区过小 */
export const TIERS = {
  easy: { label: '轻松', cells: 5, desc: '5×5 格', limitSec: 120, baseScore: 500 },
  normal: { label: '挑战', cells: 6, desc: '6×6 格', limitSec: 150, baseScore: 800 },
  hard: { label: '专家', cells: 7, desc: '7×7 格', limitSec: 180, baseScore: 1200 },
}

export const MAZE = {
  TICK_MS: 250, // 页面侧倒计时刷新间隔
  MIN_MOVE_INTERVAL_MS: 60, // 连续移动节流，防滑动/连点抖动
  SEC_PENALTY: 2, // 每秒扣 2 分
  MOVE_PENALTY: 3, // 超出参考步数每步扣 3 分
  HINT_PENALTY: 25, // 每次提示扣 25 分
  HINT_LIMIT: 3,
  MIN_SCORE: 100,
  SWIPE_MIN: 24, // 页面滑动判定阈值（px）
  WALL_N,
  WALL_E,
  WALL_S,
  WALL_W,
}

const DIRS = {
  up: { bit: WALL_N, opposite: WALL_S, dr: -1, dc: 0, label: '上' },
  right: { bit: WALL_E, opposite: WALL_W, dr: 0, dc: 1, label: '右' },
  down: { bit: WALL_S, opposite: WALL_N, dr: 1, dc: 0, label: '下' },
  left: { bit: WALL_W, opposite: WALL_E, dr: 0, dc: -1, label: '左' },
}

const DIR_LIST = Object.entries(DIRS).map(([name, d]) => ({ name, ...d }))

export class MazeEngine {
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
    this.size = 0
    this.walls = new Uint8Array(0)
    this.visited = new Uint8Array(0)
    this.player = 0
    this.par = 0
    this.steps = 0
    this.hintsLeft = MAZE.HINT_LIMIT
    this.hintUsed = 0
    this.result = null
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
    this.lastMoveAt = -Infinity
    this.lastAction = null
    this.lastMove = null
    this.lastHint = null
  }

  /**
   * 生成迷宫并开局（可反复调用，完全重置本局）。
   * @param {'easy'|'normal'|'hard'} tier 非法档位回退 easy
   * @param {string} action 起始动作标记（start / new）
   * @throws {Error} 生成结果首尾不连通时抛错，由页面进入错误态
   */
  start(tier = 'easy', action = 'start') {
    const key = tier in TIERS ? tier : 'easy'
    const cfg = TIERS[key]
    this.tier = key
    this.size = cfg.cells
    this._generate()

    const goal = this.size * this.size - 1
    const path = this._shortestPath(0, goal)
    if (path.length < 2) throw new Error('迷宫生成失败：起点与终点不连通')

    this.par = path.length - 1
    this.player = 0
    this.steps = 0
    this.visited = new Uint8Array(this.size * this.size)
    this.visited[0] = 1
    this.hintsLeft = MAZE.HINT_LIMIT
    this.hintUsed = 0
    this.result = null
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
    this.lastMoveAt = -Infinity
    this.state = 'playing'
    this.lastAction = action
    this.lastMove = null
    this.lastHint = null
    this._emit()
  }

  /**
   * 向四方向移动一步：撞墙/越界不计数，有效移动步数 +1。
   * @param {'up'|'down'|'left'|'right'} dir
   * @returns {'moved'|'win'|'blocked'|'ignored'}
   */
  move(dir) {
    if (this.state !== 'playing') return 'ignored'
    const d = DIRS[dir]
    if (!d) return 'ignored'
    const now = this.now()
    if (now - this.lastMoveAt < MAZE.MIN_MOVE_INTERVAL_MS) return 'ignored'
    this.lastMoveAt = now

    const r = Math.floor(this.player / this.size)
    const c = this.player % this.size
    const nr = r + d.dr
    const nc = c + d.dc
    if (nr < 0 || nr >= this.size || nc < 0 || nc >= this.size || (this.walls[this.player] & d.bit)) {
      this.lastAction = 'blocked'
      this.lastMove = null
      this.lastHint = null
      this._emit()
      return 'blocked'
    }

    const from = this.player
    const next = nr * this.size + nc
    this.player = next
    this.steps += 1
    this.visited[next] = 1
    this.lastHint = null
    if (!this.started) {
      this.started = true
      this.resumeAt = now - this.elapsedBase
    }

    this.lastMove = { dir, from, to: next }
    this.lastAction = 'move'
    if (next === this.size * this.size - 1) {
      this._finish('win')
      return 'win'
    }
    this._emit()
    return 'moved'
  }

  /**
   * 提示：给出当前位置沿最短路的下一个方向，不移动玩家。
   * @returns {'up'|'down'|'left'|'right'|null} 次数用尽或非 playing 时为 null
   */
  hint() {
    if (this.state !== 'playing' || this.hintsLeft <= 0) return null
    const path = this._shortestPath(this.player, this.size * this.size - 1)
    if (path.length < 2) return null
    const dir = this._dirBetween(path[0], path[1])
    if (!dir) return null

    this.hintsLeft -= 1
    this.hintUsed += 1
    this.lastAction = 'hint'
    this.lastMove = null
    this.lastHint = { dir, from: path[0], to: path[1], distance: path.length - 1 }
    this._emit()
    return dir
  }

  /** 重走本局：保留同一张迷宫，玩家/步数/计时/提示次数重置 */
  reset() {
    if (this.state !== 'playing' && this.state !== 'paused') return false
    this.state = 'playing'
    this.player = 0
    this.steps = 0
    this.visited = new Uint8Array(this.size * this.size)
    this.visited[0] = 1
    this.hintsLeft = MAZE.HINT_LIMIT
    this.hintUsed = 0
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
    this.lastMoveAt = -Infinity
    this.lastAction = 'reset'
    this.lastMove = null
    this.lastHint = null
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
    const goal = this.size > 0 ? this.size * this.size - 1 : 0
    return {
      state: this.state,
      tier: this.tier,
      tierLabel: TIERS[this.tier]?.label ?? '',
      size: this.size,
      walls: Array.from(this.walls),
      player: this.player,
      start: 0,
      goal,
      steps: this.steps,
      par: this.par,
      distance: this.size > 0 ? Math.max(0, this._shortestPath(this.player, goal).length - 1) : 0,
      hintsLeft: this.hintsLeft,
      hintUsed: this.hintUsed,
      visited: Array.from(this.visited, Boolean),
      elapsed: this._elapsed(),
      remaining: Math.max(0, Math.ceil(this._limit() - this._elapsed())),
      limitSec: this._limit(),
      started: this.started,
      result: this.result,
      score: this.state === 'over' && this.result === 'win' ? this._score() : null,
      lastAction: this.lastAction,
      lastMove: this.lastMove ? { ...this.lastMove } : null,
      lastHint: this.lastHint ? { ...this.lastHint } : null,
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }

  /** DFS 回溯生成完美迷宫：初始四面全墙，逐步凿开相邻格之间的墙 */
  _generate() {
    const size = this.size
    const total = size * size
    const walls = new Uint8Array(total).fill(WALL_N | WALL_E | WALL_S | WALL_W)
    const seen = new Uint8Array(total)
    const stack = [0]
    seen[0] = 1

    while (stack.length) {
      const cur = stack[stack.length - 1]
      const r = Math.floor(cur / size)
      const c = cur % size
      const options = []
      for (const d of DIR_LIST) {
        const nr = r + d.dr
        const nc = c + d.dc
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue
        const next = nr * size + nc
        if (!seen[next]) options.push({ d, next })
      }
      if (!options.length) {
        stack.pop()
        continue
      }
      const pick = options[Math.min(options.length - 1, Math.floor(this.random() * options.length))]
      walls[cur] &= ~pick.d.bit
      walls[pick.next] &= ~pick.d.opposite
      seen[pick.next] = 1
      stack.push(pick.next)
    }

    this.walls = walls
  }

  /** BFS 最短路：返回 [from, ..., to] 的格子索引序列，不可达返回 [] */
  _shortestPath(from, to) {
    if (this.size <= 0) return []
    const total = this.size * this.size
    const prev = new Int16Array(total).fill(-1)
    const queue = [from]
    prev[from] = from

    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head]
      if (cur === to) break
      const r = Math.floor(cur / this.size)
      const c = cur % this.size
      for (const d of DIR_LIST) {
        if (this.walls[cur] & d.bit) continue
        const nr = r + d.dr
        const nc = c + d.dc
        if (nr < 0 || nr >= this.size || nc < 0 || nc >= this.size) continue
        const next = nr * this.size + nc
        if (prev[next] !== -1) continue
        prev[next] = cur
        queue.push(next)
      }
    }

    if (prev[to] === -1) return []
    const path = []
    let cur = to
    while (cur !== from) {
      path.push(cur)
      cur = prev[cur]
    }
    path.push(from)
    return path.reverse()
  }

  _dirBetween(from, to) {
    const dr = Math.floor(to / this.size) - Math.floor(from / this.size)
    const dc = (to % this.size) - (from % this.size)
    const hit = DIR_LIST.find((d) => d.dr === dr && d.dc === dc)
    return hit ? hit.name : null
  }

  _limit() {
    return TIERS[this.tier]?.limitSec ?? TIERS.easy.limitSec
  }

  _baseScore() {
    return TIERS[this.tier]?.baseScore ?? TIERS.easy.baseScore
  }

  /** 得分：max(100, 基准 − 超出参考步数×3 − 秒数×2 − 提示次数×25) */
  _score() {
    const extra = Math.max(0, this.steps - this.par)
    const penalty = extra * MAZE.MOVE_PENALTY
      + Math.floor(this._elapsed()) * MAZE.SEC_PENALTY
      + this.hintUsed * MAZE.HINT_PENALTY
    return Math.max(MAZE.MIN_SCORE, Math.round(this._baseScore() - penalty))
  }

  _elapsed() {
    const running = this.state === 'playing' && this.started ? this.now() - this.resumeAt : 0
    return Math.round(((this.elapsedBase + running) / 1000) * 10) / 10
  }

  _finish(result) {
    if (this.started) this.elapsedBase += this.now() - this.resumeAt
    this.state = 'over'
    this.result = result
    this.lastAction = result === 'win' ? 'win' : 'timeout'
    this._emit()
    this.cb.onGameOver?.(
      result === 'win' ? this._score() : 0,
      this._elapsed(),
      result,
    )
  }
}
