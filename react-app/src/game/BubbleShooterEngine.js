/**
 * 泡泡龙（Bubble Shooter）引擎 — 纯逻辑，无定时器，飞行积分与渲染时钟由页面 rAF 调 tick(dt) 驱动。
 *
 * 盘面：六边形蜂窝网格，偶数行 COLS 格、奇数行 COLS-1 格，行高 = √3 × R。
 * 状态机：idle → playing ⇄ paused → over
 *         playing 内含两个阶段：待发（shot 为空）/ 飞行（shot 非空）
 * 玩法：瞄准发射 → 碰墙反弹 → 触顶或撞到气泡后吸附最近合法空格 →
 *       同色 BFS ≥3 消除 → 悬空气泡坠落 → 每 8 发顶部下压一行 → 行号触底判负。
 */

export const BUBBLE = Object.freeze({
  COLS: 8,                 // 偶数行格数（奇数行少 1 格）
  ROWS: 12,                // 可见行数（0~11），行号 ≥ 12 判负
  R: 1,                    // 逻辑半径
  D: 2,                    // 逻辑直径
  ROW_H: Math.sqrt(3),     // 蜂窝行高
  W: 16,                   // 逻辑宽度 = COLS × D
  SHOOTER_Y: 24.6,         // 发射器逻辑 y
  H: 26.6,                 // 逻辑高度
  COLORS: 5,               // 颜色数
  INIT_ROWS: 5,            // 初始行数
  SPEED: 26,               // 飞行速度（逻辑单位/秒）
  SUBSTEP_MS: 16,          // 飞行子步长
  MAX_TICK_MS: 50,         // 单帧推进上限（防切回页面跳帧）
  AIM_LIMIT: (75 * Math.PI) / 180,
  SHOTS_PER_DROP: 8,       // 每多少发下压一行
  SCORE_POP: 10,           // 每个同色消除得分
  SCORE_DROP: 20,          // 每个悬空坠落得分
  MAX_ROWS: 20,            // 存档行数上限
  SAVE_KEY: 'game-bubble-shooter-save-v1',
  BEST_KEY: 'game-bubble-shooter-best-v1',
  STATS_KEY: 'game-bubble-shooter-stats-v1',
  SAVE_MAX_CHARS: 4096,
  SAVE_TTL_MS: 86400000,
  POMODORO_MIN: 120,
  STATE: { IDLE: 'idle', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' },
})

export const SHOOTER = Object.freeze({ x: BUBBLE.W / 2, y: BUBBLE.SHOOTER_Y })
/** 危险线：最后一行的中心高度，气泡落到下一行（行号 ≥ ROWS）即判负 */
export const DEADLINE_Y = BUBBLE.R + (BUBBLE.ROWS - 1) * BUBBLE.ROW_H

/** 行/列 → 逻辑坐标（offset=1 表示该行右移半格） */
export function cellCenter(row, col, offset) {
  return {
    x: BUBBLE.R + col * BUBBLE.D + (offset ? BUBBLE.R : 0),
    y: BUBBLE.R + row * BUBBLE.ROW_H,
  }
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by)

export default class BubbleShooterEngine {
  constructor({ onState, onGameOver, onPause, rng } = {}) {
    this._rng = typeof rng === 'function' ? rng : Math.random
    this._state = BUBBLE.STATE.IDLE
    this._rows = []          // [{ offset: 0|1, cells: (number|null)[] }]
    this._score = 0
    this._shotsFired = 0
    this._aim = 0            // 弧度，0 = 正上方，正数向右
    this._shot = null        // { x, y, vx, vy, color }
    this._current = 0
    this._next = 1
    this._lastPop = null     // { popped, dropped, gained }
    this._aimPath = []
    this._resumeState = BUBBLE.STATE.PLAYING

    this.onState = onState || null
    this.onGameOver = onGameOver || null
    this.onPause = onPause || null
  }

  // ---------- 只读状态 ----------
  get state() { return this._state }
  get rows() { return this._rows }
  get score() { return this._score }
  get shotsFired() { return this._shotsFired }
  get currentColor() { return this._current }
  get nextColor() { return this._next }
  get aimAngle() { return this._aim }
  get aimPath() { return this._aimPath }
  get shot() { return this._shot }
  get isFlying() { return this._shot !== null }
  get shotsUntilDrop() {
    const rem = this._shotsFired % BUBBLE.SHOTS_PER_DROP
    return rem === 0 ? BUBBLE.SHOTS_PER_DROP : BUBBLE.SHOTS_PER_DROP - rem
  }
  get maxRow() { return this._maxOccupiedRow() }

  // ---------- 生命周期 ----------
  start() {
    this._rows = this._buildInitialRows()
    this._score = 0
    this._shotsFired = 0
    this._aim = 0
    this._shot = null
    this._lastPop = null
    this._current = this._pickColor()
    this._next = this._pickColor()
    this._state = BUBBLE.STATE.PLAYING
    this._recomputeAimPath()
    this._emit()
  }

  /** 页面每帧调用：仅飞行中推进气泡积分 */
  tick(dtMs) {
    if (this._state !== BUBBLE.STATE.PLAYING || !this._shot) return
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? Math.min(dtMs, BUBBLE.MAX_TICK_MS) : 0
    if (!dt) return
    let remaining = dt
    while (remaining > 0 && this._shot) {
      const step = Math.min(remaining, BUBBLE.SUBSTEP_MS)
      this._stepShot(step / 1000)
      remaining -= step
    }
    this._emit()
  }

  // ---------- 瞄准 / 发射 ----------
  /** 按指针目标点瞄准（逻辑坐标）；返回是否生效 */
  aimAt(x, y) {
    if (this._state !== BUBBLE.STATE.PLAYING || this._shot) return false
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    const dx = x - SHOOTER.x
    const up = SHOOTER.y - y
    const raw = up > 0.5
      ? Math.atan2(dx, up)
      : (dx >= 0 ? 1 : -1) * BUBBLE.AIM_LIMIT
    this._aim = clamp(raw, -BUBBLE.AIM_LIMIT, BUBBLE.AIM_LIMIT)
    this._recomputeAimPath()
    this._emit()
    return true
  }

  /** 键盘微调角度（弧度） */
  nudgeAim(delta) {
    if (this._state !== BUBBLE.STATE.PLAYING || this._shot) return false
    if (!Number.isFinite(delta)) return false
    this._aim = clamp(this._aim + delta, -BUBBLE.AIM_LIMIT, BUBBLE.AIM_LIMIT)
    this._recomputeAimPath()
    this._emit()
    return true
  }

  shoot() {
    if (this._state !== BUBBLE.STATE.PLAYING || this._shot) return false
    this._shot = {
      x: SHOOTER.x,
      y: SHOOTER.y - BUBBLE.R,
      vx: Math.sin(this._aim) * BUBBLE.SPEED,
      vy: -Math.cos(this._aim) * BUBBLE.SPEED,
      color: this._current,
    }
    this._aimPath = []
    this._emit()
    return true
  }

  pause() {
    if (this._state !== BUBBLE.STATE.PLAYING) return false
    this._resumeState = BUBBLE.STATE.PLAYING
    this._state = BUBBLE.STATE.PAUSED
    this._aimPath = []
    this._emit()
    if (this.onPause) this.onPause({ reason: 'manual' })
    return true
  }

  resume() {
    if (this._state !== BUBBLE.STATE.PAUSED) return false
    this._state = this._resumeState
    this._recomputeAimPath()
    this._emit()
    return true
  }

  dispose() {
    this.onState = null
    this.onGameOver = null
    this.onPause = null
  }

  // ---------- 存档 ----------
  getSnapshot() {
    return {
      v: 1,
      rows: this._rows.map((row) => ({
        o: row.offset,
        c: row.cells.map((v) => (v === null ? -1 : v)),
      })),
      score: this._score,
      shotsFired: this._shotsFired,
      current: this._current,
      next: this._next,
      aim: this._aim,
      ts: Date.now(),
    }
  }

  restore(save) {
    if (!validateBubbleSave(save)) return false
    this._rows = save.rows.map((row) => ({
      offset: row.o,
      cells: row.c.map((v) => (v === -1 ? null : v)),
    }))
    this._score = save.score
    this._shotsFired = save.shotsFired
    this._current = save.current
    this._next = save.next
    this._aim = typeof save.aim === 'number' ? clamp(save.aim, -BUBBLE.AIM_LIMIT, BUBBLE.AIM_LIMIT) : 0
    this._shot = null
    this._lastPop = null
    this._state = BUBBLE.STATE.PAUSED
    this._resumeState = BUBBLE.STATE.PLAYING
    this._recomputeAimPath()
    this._emit()
    return true
  }

  // ---------- 内部：盘面 ----------
  _buildInitialRows() {
    const rows = []
    // 预分配可见行，保证落位时总有相邻空格可吸附（初始只填前 INIT_ROWS 行）
    for (let r = 0; r < BUBBLE.ROWS; r++) {
      const offset = r % 2
      const count = offset === 0 ? BUBBLE.COLS : BUBBLE.COLS - 1
      const cells = []
      for (let c = 0; c < count; c++) {
        cells.push(r < BUBBLE.INIT_ROWS ? this._randColor() : null)
      }
      rows.push({ offset, cells })
    }
    return rows
  }

  _randColor() {
    return Math.floor(this._rng() * BUBBLE.COLORS) % BUBBLE.COLORS
  }

  /** 优先取盘面现存颜色，保证发射色始终可用 */
  _pickColor() {
    const present = new Set()
    for (const row of this._rows) {
      for (const cell of row.cells) if (cell !== null) present.add(cell)
    }
    if (present.size === 0) return this._randColor()
    const arr = [...present]
    return arr[Math.floor(this._rng() * arr.length) % arr.length]
  }

  _centerOf(r, c) {
    const row = this._rows[r]
    return cellCenter(r, c, row ? row.offset : r % 2)
  }

  _maxOccupiedRow() {
    for (let r = this._rows.length - 1; r >= 0; r--) {
      if (this._rows[r].cells.some((v) => v !== null)) return r
    }
    return -1
  }

  _isEmpty() {
    return this._maxOccupiedRow() < 0
  }

  /** 气泡坐标是否与任一已有气泡相交（阈值略小于直径，保证贴边判定稳定） */
  _collides(x, y) {
    const threshold = BUBBLE.D - 0.25
    const limit = threshold * threshold
    for (let r = 0; r < this._rows.length; r++) {
      const row = this._rows[r]
      for (let c = 0; c < row.cells.length; c++) {
        if (row.cells[c] === null) continue
        const p = cellCenter(r, c, row.offset)
        if (dist2(x, y, p.x, p.y) < limit) return true
      }
    }
    return false
  }

  _stepShot(dtSec) {
    const s = this._shot
    s.x += s.vx * dtSec
    s.y += s.vy * dtSec
    // 左右墙面反弹
    if (s.x < BUBBLE.R) {
      s.x = BUBBLE.R
      s.vx = Math.abs(s.vx)
    } else if (s.x > BUBBLE.W - BUBBLE.R) {
      s.x = BUBBLE.W - BUBBLE.R
      s.vx = -Math.abs(s.vx)
    }
    // 触顶
    if (s.y <= BUBBLE.R) {
      this._land(s, true)
      return
    }
    // 撞到已有气泡
    if (this._collides(s.x, s.y)) this._land(s, false)
  }

  /** 吸附到最近合法空格：第 0 行，或与已有气泡相邻的空格 */
  _nearestFreeCell(x, y, ceiling) {
    let best = null
    let bestD = Infinity
    for (let r = 0; r < this._rows.length; r++) {
      const row = this._rows[r]
      for (let c = 0; c < row.cells.length; c++) {
        if (row.cells[c] !== null) continue
        if (ceiling && r !== 0) continue
        if (r !== 0 && !this._hasOccupiedNeighbor(r, c)) continue
        const p = cellCenter(r, c, row.offset)
        const d = dist2(x, y, p.x, p.y)
        if (d < bestD) {
          bestD = d
          best = { r, c }
        }
      }
    }
    return best
  }

  _hasOccupiedNeighbor(r, c) {
    const p = this._centerOf(r, c)
    const d2 = BUBBLE.D * BUBBLE.D
    for (let nr = Math.max(0, r - 1); nr <= Math.min(this._rows.length - 1, r + 1); nr++) {
      const row = this._rows[nr]
      for (let nc = 0; nc < row.cells.length; nc++) {
        if (row.cells[nc] === null) continue
        if (nr === r && nc === c) continue
        const q = cellCenter(nr, nc, row.offset)
        if (Math.abs(dist2(p.x, p.y, q.x, q.y) - d2) < 1e-6) return true
      }
    }
    return false
  }

  _neighbors(r, c) {
    const p = this._centerOf(r, c)
    const d2 = BUBBLE.D * BUBBLE.D
    const out = []
    for (let nr = Math.max(0, r - 1); nr <= Math.min(this._rows.length - 1, r + 1); nr++) {
      const row = this._rows[nr]
      for (let nc = 0; nc < row.cells.length; nc++) {
        if (nr === r && nc === c) continue
        if (row.cells[nc] === null) continue
        const q = cellCenter(nr, nc, row.offset)
        if (Math.abs(dist2(p.x, p.y, q.x, q.y) - d2) < 1e-6) out.push({ r: nr, c: nc })
      }
    }
    return out
  }

  /** 从 (r,c) 出发的同色连通块 */
  _cluster(r, c) {
    const color = this._rows[r]?.cells[c]
    if (color === null || color === undefined) return []
    const seen = new Set([`${r},${c}`])
    const stack = [{ r, c }]
    const out = []
    while (stack.length) {
      const cur = stack.pop()
      out.push(cur)
      for (const n of this._neighbors(cur.r, cur.c)) {
        const key = `${n.r},${n.c}`
        if (seen.has(key)) continue
        if (this._rows[n.r].cells[n.c] !== color) continue
        seen.add(key)
        stack.push(n)
      }
    }
    return out
  }

  /** 从顶行 BFS，返回所有未与顶行连通的气泡（悬空） */
  _floating() {
    if (this._rows.length === 0) return []
    const seen = new Set()
    const stack = []
    const top = this._rows[0]
    for (let c = 0; c < top.cells.length; c++) {
      if (top.cells[c] !== null) {
        seen.add(`0,${c}`)
        stack.push({ r: 0, c })
      }
    }
    while (stack.length) {
      const cur = stack.pop()
      for (const n of this._neighbors(cur.r, cur.c)) {
        const key = `${n.r},${n.c}`
        if (seen.has(key)) continue
        seen.add(key)
        stack.push(n)
      }
    }
    const out = []
    for (let r = 0; r < this._rows.length; r++) {
      const row = this._rows[r]
      for (let c = 0; c < row.cells.length; c++) {
        if (row.cells[c] !== null && !seen.has(`${r},${c}`)) out.push({ r, c })
      }
    }
    return out
  }

  /** 落位：吸附 → 消除 → 坠落 → 下压 → 判负 */
  _land(shot, ceiling) {
    const cell = this._nearestFreeCell(shot.x, shot.y, ceiling)
    this._shot = null
    if (!cell) {
      this._end('crowded', 0)
      return
    }
    this._rows[cell.r].cells[cell.c] = shot.color
    this._shotsFired += 1

    let popped = 0
    let dropped = 0
    const cluster = this._cluster(cell.r, cell.c)
    if (cluster.length >= 3) {
      popped = cluster.length
      for (const { r, c } of cluster) this._rows[r].cells[c] = null
      const floating = this._floating()
      dropped = floating.length
      for (const { r, c } of floating) this._rows[r].cells[c] = null
    }
    const gained = popped * BUBBLE.SCORE_POP + dropped * BUBBLE.SCORE_DROP
    this._score += gained
    this._lastPop = { popped, dropped, gained }

    if (this._isEmpty()) {
      this._end('cleared', gained)
      return
    }
    if (this._shotsFired % BUBBLE.SHOTS_PER_DROP === 0) this._prependRow()
    if (this._maxOccupiedRow() >= BUBBLE.ROWS) {
      this._end('overflow', gained)
      return
    }
    this._current = this._next
    this._next = this._pickColor()
    this._recomputeAimPath()
    this._emit()
  }

  _prependRow() {
    const first = this._rows[0]
    const offset = first ? 1 - first.offset : 0
    const count = offset === 0 ? BUBBLE.COLS : BUBBLE.COLS - 1
    const cells = []
    for (let c = 0; c < count; c++) cells.push(this._randColor())
    this._rows.unshift({ offset, cells })
  }

  _end(reason, gained) {
    this._state = BUBBLE.STATE.OVER
    this._shot = null
    this._aimPath = []
    this._emit()
    if (this.onGameOver) {
      this.onGameOver({
        reason,
        score: this._score,
        shotsFired: this._shotsFired,
        gained,
      })
    }
  }

  // ---------- 内部：瞄准虚线 ----------
  _recomputeAimPath() {
    if (this._state !== BUBBLE.STATE.PLAYING || this._shot) {
      this._aimPath = []
      return
    }
    const path = []
    let x = SHOOTER.x
    let y = SHOOTER.y - BUBBLE.R
    let vx = Math.sin(this._aim)
    let vy = -Math.cos(this._aim)
    path.push({ x, y })
    const step = 0.35
    for (let i = 0; i < 220; i++) {
      x += vx * step
      y += vy * step
      if (x < BUBBLE.R) {
        x = BUBBLE.R
        vx = -vx
      } else if (x > BUBBLE.W - BUBBLE.R) {
        x = BUBBLE.W - BUBBLE.R
        vx = -vx
      }
      path.push({ x, y })
      if (y <= BUBBLE.R) break
      if (this._collides(x, y)) break
    }
    this._aimPath = path
  }

  _emit() {
    if (!this.onState) return
    this.onState({
      state: this._state,
      score: this._score,
      shotsFired: this._shotsFired,
      shotsUntilDrop: this.shotsUntilDrop,
      rows: this._rows,
      shot: this._shot,
      aim: this._aim,
      aimPath: this._aimPath,
      current: this._current,
      next: this._next,
      lastPop: this._lastPop,
      maxRow: this._maxOccupiedRow(),
    })
  }
}

/** 存档校验：结构、行列数、颜色取值、分数与发射数范围 */
export function validateBubbleSave(save) {
  if (!save || typeof save !== 'object') return false
  if (save.v !== 1) return false
  if (!Array.isArray(save.rows) || save.rows.length < 1 || save.rows.length > BUBBLE.MAX_ROWS) return false
  let occupied = 0
  for (const row of save.rows) {
    if (!row || typeof row !== 'object') return false
    if (row.o !== 0 && row.o !== 1) return false
    const expected = row.o === 0 ? BUBBLE.COLS : BUBBLE.COLS - 1
    if (!Array.isArray(row.c) || row.c.length !== expected) return false
    for (const v of row.c) {
      if (v === -1) continue
      if (!Number.isInteger(v) || v < 0 || v >= BUBBLE.COLORS) return false
      occupied += 1
    }
  }
  if (occupied < 1) return false
  if (!Number.isInteger(save.score) || save.score < 0) return false
  if (!Number.isInteger(save.shotsFired) || save.shotsFired < 0) return false
  if (!Number.isInteger(save.current) || save.current < 0 || save.current >= BUBBLE.COLORS) return false
  if (!Number.isInteger(save.next) || save.next < 0 || save.next >= BUBBLE.COLORS) return false
  if (save.aim !== undefined && (typeof save.aim !== 'number' || !Number.isFinite(save.aim))) return false
  return true
}
