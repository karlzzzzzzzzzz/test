/**
 * 一笔画（One Stroke）引擎 —— 纯逻辑，与 UI 解耦。
 *
 * 规则：
 * - 关卡是网格上的一组线段（边），要求从起点出发、笔不离纸、每条边恰好走一次；
 * - 只能沿已存在的边移动到相邻点，走过的边不能重复；
 * - 走完全部边即通关；若停在某个点且周围没有未走过的边，则进入「卡住」状态，
 *   需要撤销或重置（引擎不判负）；
 * - 关卡满足欧拉路径条件：奇数度点恰好 0 或 2 个，且两点间连通。
 *
 * 每日关卡：日期字符串经 FNV-1a 哈希 + mulberry32 选难度与起点，
 * 同一日期完全一致；外部日期接口失败时由页面壳降级本地日期。
 *
 * 状态机：start → playing ⇄ paused → over
 */

export const ONE_STROKE = {
  DAILY_POOL: ['easy', 'normal', 'hard'],
}

export const LEVELS = {
  easy: { key: 'easy', label: '轻松', blurb: '3×3 日字 · 10 条边' },
  normal: { key: 'normal', label: '标准', blurb: '4×4 外环 + 斜线 + 桥 · 14 条边' },
  hard: { key: 'hard', label: '困难', blurb: '5×5 双环 + 桥 · 25 条边' },
}

const idOf = (r, c, cols) => r * cols + c

/** 生成矩形环的边：左上角 (r0,c0)，高 h、宽 w，首尾相接的简单环 */
function ringEdges(rows, cols, r0, c0, h, w) {
  const edges = []
  for (let c = c0; c < c0 + w - 1; c++) {
    edges.push([idOf(r0, c, cols), idOf(r0, c + 1, cols)])
    edges.push([idOf(r0 + h - 1, c, cols), idOf(r0 + h - 1, c + 1, cols)])
  }
  for (let r = r0; r < r0 + h - 1; r++) {
    edges.push([idOf(r, c0, cols), idOf(r + 1, c0, cols)])
    edges.push([idOf(r, c0 + w - 1, cols), idOf(r + 1, c0 + w - 1, cols)])
  }
  return edges
}

/** 三档手工关卡：全部满足欧拉路径条件（奇数度点为 2 个） */
export const LEVEL_DEFS = {
  easy: {
    rows: 3,
    cols: 3,
    start: 3,
    edges: [
      [0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [7, 8],
      [0, 3], [3, 6], [2, 5], [5, 8],
    ],
  },
  normal: {
    rows: 4,
    cols: 4,
    start: 4,
    edges: [...ringEdges(4, 4, 0, 0, 4, 4), [5, 10], [4, 5]],
  },
  hard: {
    rows: 5,
    cols: 5,
    start: 6,
    edges: [...ringEdges(5, 5, 0, 0, 5, 5), ...ringEdges(5, 5, 1, 1, 3, 3), [5, 6]],
  },
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

export function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

/** 计算每个节点的度数 */
export function degreesOf(def) {
  const deg = new Array(def.rows * def.cols).fill(0)
  for (const [a, b] of def.edges) {
    deg[a] += 1
    deg[b] += 1
  }
  return deg
}

/** 返回奇数度节点列表 */
export function oddNodesOf(def) {
  const deg = degreesOf(def)
  const out = []
  for (let i = 0; i < deg.length; i++) {
    if (deg[i] % 2 === 1) out.push(i)
  }
  return out
}

/**
 * 校验关卡是否可一笔画：边合法、无重边、连通、奇数度点 0 或 2 个，
 * 且 start 在存在两个奇点时必须落在奇点上。
 */
export function validateLevel(def) {
  const problems = []
  if (!def || !Number.isInteger(def.rows) || !Number.isInteger(def.cols)) {
    return { ok: false, problems: ['缺少行列定义'] }
  }
  const total = def.rows * def.cols
  const seen = new Set()
  const adj = Array.from({ length: total }, () => [])
  for (const pair of def.edges || []) {
    const [a, b] = pair
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= total || b >= total) {
      problems.push(`边越界：${a}-${b}`)
      continue
    }
    if (a === b) {
      problems.push(`自环：${a}-${a}`)
      continue
    }
    const key = edgeKey(a, b)
    if (seen.has(key)) {
      problems.push(`重复边：${key}`)
      continue
    }
    seen.add(key)
    adj[a].push(b)
    adj[b].push(a)
  }
  if (!Number.isInteger(def.start) || def.start < 0 || def.start >= total) {
    problems.push('起点非法')
  } else if (adj[def.start].length === 0) {
    problems.push('起点没有任何边')
  } else {
    const visited = new Set([def.start])
    const stack = [def.start]
    while (stack.length) {
      const cur = stack.pop()
      for (const next of adj[cur]) {
        if (!visited.has(next)) {
          visited.add(next)
          stack.push(next)
        }
      }
    }
    for (let i = 0; i < total; i++) {
      if (adj[i].length && !visited.has(i)) problems.push('存在不连通的区域')
    }
  }
  const odds = oddNodesOf(def)
  if (odds.length !== 0 && odds.length !== 2) problems.push(`奇数度点为 ${odds.length} 个`)
  if (odds.length === 2 && !odds.includes(def.start)) problems.push('起点必须落在奇数度点上')
  return { ok: problems.length === 0, problems, oddNodes: odds, edgeCount: seen.size }
}

/**
 * 按日期生成每日关卡：难度与起点都由日期确定，同一日期完全一致。
 * @returns {{ levelKey: string, start: number }}
 */
export function createDailyLevel(dateStr) {
  const rand = mulberry32(hashSeed(`one-stroke:${dateStr}`))
  const levelKey = ONE_STROKE.DAILY_POOL[Math.floor(rand() * ONE_STROKE.DAILY_POOL.length)]
  const def = LEVEL_DEFS[levelKey]
  const odds = oddNodesOf(def)
  const start = odds.length ? odds[Math.floor(rand() * odds.length)] : def.start
  return { levelKey, start }
}

export class OneStrokeEngine {
  /**
   * @param {Object} cb { onState, onGameOver, onPause, onStuck }
   */
  constructor(cb = {}) {
    this.cb = cb

    this.state = 'start'
    this.level = 'easy'
    this.mode = 'classic'
    this.dailyDate = ''

    this.rows = 0
    this.cols = 0
    this.edges = []
    this.used = []
    this.startNode = -1
    this.current = -1
    this.history = []
    this.stuck = false

    this.moves = 0
    this.undos = 0
    this.resets = 0

    this.started = false
    this.startedAt = 0
    this.elapsedBase = 0
    this.resumeAt = 0
    this.clockRunning = false
  }

  /**
   * 开始一局。
   * @param {string} level easy | normal | hard
   * @param {Object} opts { mode: 'classic' | 'daily', dailyDate, startNode }
   */
  start(level = 'easy', opts = {}) {
    const key = level in LEVEL_DEFS ? level : 'easy'
    this.level = key
    this.mode = opts.mode === 'daily' ? 'daily' : 'classic'
    this.dailyDate = this.mode === 'daily' ? String(opts.dailyDate || '') : ''

    const def = LEVEL_DEFS[key]
    this.rows = def.rows
    this.cols = def.cols
    this.edges = def.edges.map(([a, b]) => ({ a, b }))
    this.used = new Array(this.edges.length).fill(false)
    this.startNode = Number.isInteger(opts.startNode) && opts.startNode >= 0 && opts.startNode < this.rows * this.cols
      ? opts.startNode
      : def.start
    this.current = this.startNode
    this.history = []
    this.stuck = false
    this.moves = 0
    this.undos = 0
    this.resets = 0

    this.started = true
    this.startedAt = Date.now()
    this.elapsedBase = 0
    this.resumeAt = Date.now()
    this.clockRunning = true

    this.state = 'playing'
    this._emit()
    return this.getSnapshot()
  }

  /** 与 node 相连的边下标（含已走过） */
  edgesAt(node) {
    const out = []
    for (let i = 0; i < this.edges.length; i++) {
      if (this.edges[i].a === node || this.edges[i].b === node) out.push(i)
    }
    return out
  }

  /** 与 node 相连且未走过的边 */
  unusedEdgesAt(node) {
    return this.edgesAt(node).filter((i) => !this.used[i])
  }

  /** 两点之间的边下标，没有则返回 -1 */
  edgeBetween(a, b) {
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i]
      if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return i
    }
    return -1
  }

  /**
   * 从当前点画到相邻点。
   * @returns {{ ok: boolean, reason?: string, remaining?: number, stuck?: boolean, win?: boolean }}
   */
  tryMove(node) {
    if (this.state !== 'playing') return { ok: false, reason: '当前不能画线' }
    if (!Number.isInteger(node) || node < 0 || node >= this.rows * this.cols) {
      return { ok: false, reason: '目标点不存在' }
    }
    if (node === this.current) return { ok: false, reason: '请选择相邻的点' }
    const ei = this.edgeBetween(this.current, node)
    if (ei < 0) return { ok: false, reason: '两点之间没有连线' }
    if (this.used[ei]) return { ok: false, reason: '这条边已经走过' }

    this.used[ei] = true
    this.history.push(ei)
    this.current = node
    this.moves += 1
    this.stuck = false

    const remaining = this.used.filter((v) => !v).length
    if (remaining === 0) {
      this._finish()
      return { ok: true, remaining: 0, stuck: false, win: true }
    }
    if (this.unusedEdgesAt(node).length === 0) {
      this.stuck = true
      this._emit()
      this.cb.onStuck?.({ node, remaining })
      return { ok: true, remaining, stuck: true }
    }
    this._emit()
    return { ok: true, remaining, stuck: false }
  }

  /** 撤销上一条边；已通关或暂停时不可撤销 */
  undo() {
    if (this.state !== 'playing' || this.history.length === 0) return false
    const ei = this.history.pop()
    const edge = this.edges[ei]
    this.used[ei] = false
    this.current = edge.a === this.current ? edge.b : edge.a
    this.moves = Math.max(0, this.moves - 1)
    this.undos += 1
    this.stuck = false
    this._emit()
    return true
  }

  /** 清空已走的边并回到起点，计时归零 */
  reset() {
    if (this.state === 'start') return false
    this.used = new Array(this.edges.length).fill(false)
    this.history = []
    this.current = this.startNode
    this.moves = 0
    this.stuck = false
    this.resets += 1
    this.state = 'playing'
    this.elapsedBase = 0
    this.resumeAt = Date.now()
    this.clockRunning = true
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

  _finish() {
    if (this.clockRunning) {
      this.elapsedBase += Date.now() - this.resumeAt
      this.clockRunning = false
    }
    this.state = 'over'
    this._emit()
    this.cb.onGameOver?.({
      result: 'win',
      elapsed: this._elapsed(),
      moves: this.moves,
      undos: this.undos,
      resets: this.resets,
      level: this.level,
      mode: this.mode,
      dailyDate: this.dailyDate,
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
    const total = this.edges.length
    const usedCount = this.used.filter(Boolean).length
    const nodes = []
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const id = idOf(r, c, this.cols)
        const degree = this.edgesAt(id).length
        if (degree === 0) continue
        nodes.push({ id, row: r, col: c, degree })
      }
    }
    return {
      state: this.state,
      level: this.level,
      mode: this.mode,
      dailyDate: this.dailyDate,
      rows: this.rows,
      cols: this.cols,
      nodes,
      edges: this.edges.map((e, i) => ({ a: e.a, b: e.b, used: this.used[i] })),
      startNode: this.startNode,
      current: this.current,
      totalEdges: total,
      usedCount,
      remaining: total - usedCount,
      moves: this.moves,
      undos: this.undos,
      resets: this.resets,
      elapsed: this._elapsed(),
      canUndo: this.state === 'playing' && this.history.length > 0,
      stuck: this.stuck,
    }
  }
}
