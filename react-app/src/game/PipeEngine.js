/**
 * 接水管（Pipe Connect）引擎 —— 纯逻辑，与 UI 解耦。
 *
 * 状态机：start → playing ⇄ paused → over(win) | timeout。
 *
 * 玩法：网格中每格放置一段管子（直 / 弯 / 三通 / 十字 / 源点 / 终点 / 空地），
 * 点击旋转 90°。将左上角「源点」连通到右下角「终点」即获胜——连通判定基于
 * 每根管四段开口（N/E/S/W）是否与相邻格对应方向也有开口。
 *
 * 旋转编码：每段管存储一个「连接位掩码」bitmask（N=1, E=2, S=4, W=8）。
 * 旋转 90° = (mask << 1 | mask >> 3) & 0xF，即循环左移 1 位（4 bit）。
 */

// ===== 方向常量 =====
export const DIR = { N: 0, E: 1, S: 2, W: 3 }
export const DIR_MASK = [1, 2, 4, 8] // N=bit0, E=bit1, S=bit2, W=bit3
// opposite[dir] = 对面方向
export const OPPOSITE = [2, 3, 0, 1] // N↔S, E↔W
// delta[dir] = [dr, dc]
export const DELTA = [[-1, 0], [0, 1], [1, 0], [0, -1]]

// ===== 基础管型（旋转 0° 的位掩码） =====
export const PIPE_TYPE = {
  EMPTY: 0,   // 空地：mask=0，点击可旋转但永远无开口
  STRAIGHT: 3, // 直管（N+S）→ mask=0b0101=5，这里存的是"两个方向"的位
  CURVE: 0,   // 弯管（N+E）→ mask=0b0011=3
  TEE: 0,     // 三通（N+E+W）→ mask=0b1011=11
  CROSS: 0,   // 十字 → mask=0b1111=15，旋转不变
  SOURCE: 0,  // 源点：固定 N 方向，不可旋转
  TARGET: 0,  // 终点：固定 S 方向，不可旋转
}

// 每种管型的初始 mask（旋转 0° 时）
export const PIPE_BASE_MASK = {
  STRAIGHT: 5, // 0b0101 = N+S
  CURVE: 3,    // 0b0011 = N+E
  TEE: 11,     // 0b1011 = N+E+W
  CROSS: 15,   // 0b1111
  SOURCE: 4,   // 0b0100 = S（源点朝右/朝东流出？实际源点开口方向由生成时决定）
  TARGET: 1,   // 0b0001 = N
}

// ===== 难度 =====
export const DIFFICULTY = {
  easy:   { rows: 4, cols: 4, limitSec: 90,  baseScore: 500, label: '入门 4×4' },
  normal: { rows: 5, cols: 5, limitSec: 150, baseScore: 800, label: '挑战 5×5' },
  hard:   { rows: 6, cols: 6, limitSec: 240, baseScore: 1200, label: '专家 6×6' },
}

export const PIPE = {
  TICK_MS: 200,
  UNDO_LIMIT: 10,
  MAX_ROTATIONS: 3,        // 非十字/空地最多旋转 3 次回到原样
  BASE_ROTATION_RANGE: 3,  // 初始打乱时，每段非空地管随机旋转 0~3 次
  EMPTY_BIAS_EASY: 0.10,   // 难度越高，空地越少
  EMPTY_BIAS_NORMAL: 0.05,
  EMPTY_BIAS_HARD: 0.02,
}

// ===== 辅助：mask 旋转 =====
/** 4bit 位掩码循环左移 1 位（N→E→S→W→N） */
export function rotateMask(mask) {
  return ((mask << 1) & 0xF) | ((mask >> 3) & 0x1)
}

/** 旋转 mask 指定次数（0~3） */
export function rotateMaskN(mask, n) {
  n = ((n % 4) + 4) % 4
  let r = mask & 0xF
  for (let i = 0; i < n; i++) r = rotateMask(r)
  return r
}

/** 从 mask 提取该方向是否有开口 */
export function hasOpening(mask, dir) {
  return (mask & DIR_MASK[dir]) !== 0
}

/** 判断两种管型是否可旋转（空地和十字不可） */
export function isRotatable(type) {
  return type !== 'EMPTY' && type !== 'CROSS' && type !== 'SOURCE' && type !== 'TARGET'
}

export class PipeEngine {
  /**
   * @param {Object} cb 回调：
   *   onState(snapshot)   — 每次数据变化触发
   *   onGameOver({result, score, elapsed})
   *   onPause()
   * @param {Object} options { random } 注入随机源便于单测
   */
  constructor(cb = {}, options = {}) {
    this.cb = cb
    this.random = options.random || Math.random

    this.state = 'start'
    this.level = 'easy'
    this._cfg = DIFFICULTY.easy

    this.rows = 4
    this.cols = 4
    // 每格对象：{ type, mask } — type 为 'EMPTY'|'STRAIGHT'|...|'SOURCE'|'TARGET'
    // sourcePos / targetPos 固定为 [0,0] 和 [rows-1, cols-1]
    this.grid = []
    this.sourcePos = [0, 0]
    this.targetPos = [3, 3]

    this.clicks = 0          // 旋转次数
    this.history = []        // 撤销栈：{ idx, prevMask, prevType }
    this.undoLeft = PIPE.UNDO_LIMIT

    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
    this.lastAction = null
  }

  /** 开局：生成必然可解的关卡 */
  start(level = 'easy') {
    const key = level in DIFFICULTY ? level : 'easy'
    const cfg = DIFFICULTY[key]
    this._cfg = cfg
    this.level = key
    this.rows = cfg.rows
    this.cols = cfg.cols
    this.sourcePos = [0, 0]
    this.targetPos = [cfg.rows - 1, cfg.cols - 1]
    this.clicks = 0
    this.history = []
    this.undoLeft = PIPE.UNDO_LIMIT
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0

    this._generate()
    this.state = 'playing'
    this.lastAction = 'start'
    this._emit()
  }

  /** 点击某格 → 旋转 */
  rotate(idx) {
    if (this.state !== 'playing') return false
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.rows * this.cols) return false

    const cell = this.grid[idx]
    if (!cell) return false
    if (!isRotatable(cell.type)) return false // 空地/十字/源/终点 不响应

    if (!this.started) {
      this.started = true
      this.resumeAt = Date.now() - this.elapsedBase
    }

    this.history.push({ idx, prevMask: cell.mask, prevType: cell.type })
    this.undoLeft = Math.max(0, this.undoLeft - 0) // 不消耗撤销次数

    cell.mask = rotateMask(cell.mask)
    this.clicks += 1
    this.lastAction = 'rotate'

    if (this._checkWin()) {
      this._finish('over')
    } else {
      this._emit()
    }
    return true
  }

  /** 撤销 */
  undo() {
    if (this.state !== 'playing') return false
    if (this.undoLeft <= 0 || this.history.length === 0) return false

    const last = this.history.pop()
    const cell = this.grid[last.idx]
    if (cell) {
      cell.mask = last.prevMask
      // type 也可能在 generate 阶段改过；撤销时恢复
      if (last.prevType !== undefined) cell.type = last.prevType
    }
    this.clicks = Math.max(0, this.clicks - 1)
    this.undoLeft -= 1
    this.lastAction = 'undo'
    this._emit()
    return true
  }

  /** 每次 tick（~200ms）驱动倒计时 */
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
    if (this.started) this.elapsedBase += Date.now() - this.resumeAt
    this.lastAction = 'pause'
    this.cb.onPause?.()
    this._emit()
  }

  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    if (this.started) this.resumeAt = Date.now()
    this.lastAction = 'resume'
    this._emit()
  }

  dispose() {
    this.cb = {}
  }

  // ===== 连通判定 =====
  /**
   * 从源点出发 BFS，沿相邻开口方向遍历所有可达格，看终点是否在其中。
   */
  _checkWin() {
    const total = this.rows * this.cols
    const visited = new Uint8Array(total)
    const queue = [this._posToIdx(...this.sourcePos)]
    visited[queue[0]] = 1

    while (queue.length) {
      const idx = queue.shift()
      const r = Math.floor(idx / this.cols)
      const c = idx % this.cols
      const mask = this.grid[idx].mask

      // 到达终点？
      if (r === this.targetPos[0] && c === this.targetPos[1]) return true

      for (let d = 0; d < 4; d++) {
        if (!hasOpening(mask, d)) continue
        const [dr, dc] = DELTA[d]
        const nr = r + dr, nc = c + dc
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue
        const nidx = this._posToIdx(nr, nc)
        if (visited[nidx]) continue
        const nmask = this.grid[nidx].mask
        if (hasOpening(nmask, OPPOSITE[d])) {
          visited[nidx] = 1
          queue.push(nidx)
        }
      }
    }
    return false
  }

  // ===== 关卡生成 =====
  /**
   * 先铺一条从源点到终点的路径（用 DFS 回溯，必然连通），
   * 路径上每格根据进/出方向决定管型，其余格子按概率撒空地或短直管，
   * 最后随机旋转每段（避开不可旋转的源/终点/空地/十字）。
   */
  _generate() {
    const total = this.rows * this.cols
    this.grid = new Array(total)
    for (let i = 0; i < total; i++) {
      this.grid[i] = { type: 'EMPTY', mask: 0 }
    }

    const [sr, sc] = this.sourcePos
    const [tr, tc] = this.targetPos

    // 1) 铺主路径
    const path = this._findPath(sr, sc, tr, tc)
    // 路径的"连接需求"：path[i] 与 path[i+1] 之间的方向
    // 先标记哪些格在路径上，然后填管型
    for (let i = 0; i < path.length; i++) {
      const [r, c] = path[i]
      const idx = this._posToIdx(r, c)
      // 确定需要哪些开口
      const opens = []
      if (i > 0) {
        const [pr, pc] = path[i - 1]
        opens.push(this._dirBetween(pr, pc, r, c))
      }
      if (i < path.length - 1) {
        const [nr, nc] = path[i + 1]
        opens.push(this._dirBetween(r, c, nr, nc))
      }
      // 根据 opens 选择管型
      let type, mask
      if (i === 0) {
        type = 'SOURCE'
        mask = DIR_MASK[opens[0]] // 只朝路径方向开口
      } else if (i === path.length - 1) {
        type = 'TARGET'
        mask = DIR_MASK[opens[0]] // 只朝路径方向开口
      } else {
        if (opens.length === 2) {
          type = this._typeFor(opens[0], opens[1])
          mask = this._maskFor(type, opens)
        } else {
          type = 'STRAIGHT'
          mask = DIR_MASK[opens[0]] | DIR_MASK[OPPOSITE[opens[0]]]
        }
      }
      this.grid[idx] = { type, mask }
    }

    // 2) 撒装饰管（非路径格 → 随机短管或空地）
    let emptyBias
    if (this.level === 'easy') emptyBias = PIPE.EMPTY_BIAS_EASY
    else if (this.level === 'normal') emptyBias = PIPE.EMPTY_BIAS_NORMAL
    else emptyBias = PIPE.EMPTY_BIAS_HARD

    const pathSet = new Set(path.map(([r, c]) => r * this.cols + c))
    for (let i = 0; i < total; i++) {
      if (pathSet.has(i)) continue
      if (this.random() < emptyBias) continue // 空地跳过
      // 随机放一段装饰管：直管 或 弯管
      const types = ['STRAIGHT', 'CURVE']
      const t = types[Math.floor(this.random() * types.length)]
      const baseMask = t === 'STRAIGHT' ? PIPE_BASE_MASK.STRAIGHT : PIPE_BASE_MASK.CURVE
      this.grid[i] = { type: t, mask: baseMask }
    }

    // 3) 路径上的管也允许随机旋转（除了源/终点）——确保可解
    //    但源/终点的开口方向必须指向相邻路径格，否则无解
    for (let i = 0; i < total; i++) {
      const cell = this.grid[i]
      if (!isRotatable(cell.type)) continue
      const rotCount = Math.floor(this.random() * 3) + 1 // 1~3 次
      for (let k = 0; k < rotCount; k++) cell.mask = rotateMask(cell.mask)
    }
  }

  /** 从 (sr,sc) 到 (tr,tc) 找一条简单路径（保证可解）：优先沿方向移动，不会绕太远 */
  _findPath(sr, sc, tr, tc) {
    const path = [[sr, sc]]
    let r = sr, c = sc
    const maxSteps = this.rows * this.cols

    while ((r !== tr || c !== tc) && path.length < maxSteps) {
      const dr = tr - r
      const dc = tc - c
      // 选一个优先方向：如果 dr>0 先尝试 S，然后 E；dc>0 先尝试 E，然后 S
      const candidates = []
      if (dr !== 0) candidates.push(dr > 0 ? DIR.S : DIR.N)
      if (dc !== 0) candidates.push(dc > 0 ? DIR.E : DIR.W)
      // 再补两个邻方向做备选
      if (dr === 0 && dc !== 0) {
        // 同行，需绕开
        candidates.push(DIR.N, DIR.S)
      } else if (dc === 0 && dr !== 0) {
        candidates.push(DIR.E, DIR.W)
      } else {
        candidates.push(DIR.W, DIR.N, DIR.E, DIR.S)
      }

      let moved = false
      const visited = new Set(path.map(([rp, cp]) => rp * this.cols + cp))
      for (const d of candidates) {
        const [ddr, ddc] = DELTA[d]
        const nr2 = r + ddr, nc2 = c + ddc
        if (nr2 < 0 || nr2 >= this.rows || nc2 < 0 || nc2 >= this.cols) continue
        if (visited.has(nr2 * this.cols + nc2)) continue
        // 偶尔随机选非优先方向增加路径复杂度
        if (candidates.indexOf(d) > 0 && this.random() > 0.25) continue
        r = nr2; c = nc2
        path.push([r, c])
        moved = true
        break
      }
      if (!moved) {
        // 死胡同：退回上一步重新尝试
        if (path.length > 1) path.pop()
        else break
        const last = path[path.length - 1]
        r = last[0]; c = last[1]
      }
    }
    return path
  }

  /** 两格之间的方向 */
  _dirBetween(r1, c1, r2, c2) {
    if (r2 < r1) return DIR.N
    if (r2 > r1) return DIR.S
    if (c2 < c1) return DIR.W
    return DIR.E
  }

  /** 根据两个开口方向确定管型（假设开口方向正交或相反） */
  _typeFor(d1, d2) {
    if (d1 === OPPOSITE[d2]) return 'STRAIGHT' // 正对
    return 'CURVE' // 正交
  }

  /** 给定管型和需要的开口方向，构造正确 mask */
  _maskFor(type, opens) {
    let mask = 0
    for (const d of opens) mask |= DIR_MASK[d]
    // 如果是 STRAIGHT 但两个开口不正对 → 修正（理论上不会走到这里）
    return mask
  }

  // ===== 计分 =====
  /** 得分：max(50, 基准 − 旋转数×5 − 秒数×1) */
  _score() {
    const penalty = this.clicks * 5 + Math.floor(this._elapsed()) * 1
    return Math.max(50, Math.round(this._cfg.baseScore - penalty))
  }

  _elapsed() {
    const running = this.state === 'playing' && this.started
      ? Date.now() - this.resumeAt : 0
    return Math.round(((this.elapsedBase + running) / 1000) * 10) / 10
  }

  _finish(result) {
    if (this.started) this.elapsedBase += Date.now() - this.resumeAt
    this.state = result === 'over' ? 'over' : 'timeout'
    this.lastAction = result === 'over' ? 'win' : 'timeout'
    this._emit()
    this.cb.onGameOver?.({
      result: result === 'over' ? 'win' : 'timeout',
      score: result === 'over' ? this._score() : 0,
      elapsed: this._elapsed(),
    })
  }

  // ===== 索引工具 =====
  _posToIdx(r, c) { return r * this.cols + c }
  _idxToPos(idx) { return [Math.floor(idx / this.cols), idx % this.cols] }

  // ===== 快照 =====
  getSnapshot() {
    const remaining = Math.max(0, Math.ceil(this._cfg.limitSec - this._elapsed()))
    // 计算连通组：从源点出发 BFS，marked 为连通的 idx 集合
    const connectedSet = this._connectedFromSource()

    return {
      state: this.state,
      level: this.level,
      rows: this.rows,
      cols: this.cols,
      grid: this.grid.map((c, i) => ({
        idx: i,
        type: c.type,
        mask: c.mask,
        connected: connectedSet.has(i),
      })),
      source: this.sourcePos.slice(),
      target: this.targetPos.slice(),
      clicks: this.clicks,
      elapsed: this._elapsed(),
      remaining,
      limitSec: this._cfg.limitSec,
      undoLeft: this.undoLeft,
      score: this.state === 'over' ? this._score() : null,
      lastAction: this.lastAction,
    }
  }

  /** 返回从源点出发当前能连通到哪些格（含终点判定用） */
  _connectedFromSource() {
    const visited = new Set()
    if (!this.grid || this.grid.length === 0) return visited
    const srcIdx = this._posToIdx(...this.sourcePos)
    if (srcIdx >= this.grid.length) return visited
    visited.add(srcIdx)
    const queue = [srcIdx]

    while (queue.length) {
      const idx = queue.shift()
      const r = Math.floor(idx / this.cols)
      const c = idx % this.cols
      const cell = this.grid[idx]
      if (!cell) continue
      const mask = cell.mask

      for (let d = 0; d < 4; d++) {
        if (!hasOpening(mask, d)) continue
        const [dr, dc] = DELTA[d]
        const nr = r + dr, nc = c + dc
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue
        const nidx = this._posToIdx(nr, nc)
        if (visited.has(nidx)) continue
        const ncell = this.grid[nidx]
        if (!ncell) continue
        const nmask = ncell.mask
        if (hasOpening(nmask, OPPOSITE[d])) {
          visited.add(nidx)
          queue.push(nidx)
        }
      }
    }
    return visited
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }
}
