/**
 * 钢琴块（Piano Tiles / 别踩白块儿）引擎 —— 纯逻辑，与 UI 解耦。
 *
 * 街机模式：4 条轨道，黑色色块自上而下连续下落，速度随得分递增；在底部判定线
 * 附近点中黑块 +1 分，点到白块或漏点黑块（越过底线）即结束。
 *
 * 坐标约定：y 为色块中心所在的「行高」单位（1 行高 = 一块色块的高度）。
 * 场地可见 VISIBLE 行高，判定线位于底部 y = JUDGE_Y，色块中心越过 MISS_Y 判漏点。
 * 行间距恒为 1 行高（传送带），命中的行保留在数组中维持间距，离开场地后才被清理。
 *
 * 状态机：start → playing ⇄ paused → over
 */

export const PIANO = {
  LANES: 4, // 轨道数
  VISIBLE: 4, // 场地可见行数（场地高度）
  SPAWN_Y: -0.5, // 新行生成时的中心 y（刚好在场地顶部之外，滑入）
  JUDGE_Y: 4, // 判定线 y（底部）
  HIT_TOL: 0.7, // 判定窗口半高（行高单位）
  MISS_Y: 4.9, // 色块中心越过此值判漏点
  BASE_SPEED: 2.0, // 初始速度（行高 / 秒）
  SPEED_GAIN: 0.08, // 每点中 1 块加速（行高 / 秒）
  MAX_SPEED: 8.0, // 速度上限
  SAVE_TTL_MS: 24 * 3600 * 1000, // 存档 24 小时
}

/** 校验并归一化存档；返回合法存档对象，非法返回 null */
export function validateSave(save) {
  if (!save || typeof save !== 'object') return null
  if (save.v !== 1) return null
  const rows = Array.isArray(save.rows) ? save.rows : null
  if (!rows || rows.length === 0 || rows.length > 64) return null
  const clean = []
  for (const r of rows) {
    const id = Number(r && r.id)
    const lane = Number(r && r.lane)
    const y = Number(r && r.y)
    if (!Number.isInteger(id) || id < 1) return null
    if (!Number.isInteger(lane) || lane < 0 || lane >= PIANO.LANES) return null
    if (!Number.isFinite(y)) return null
    clean.push({ id, lane, y, hit: Boolean(r && r.hit) })
  }
  const score = Number(save.score)
  const hits = Number(save.hits)
  const combo = Number(save.combo)
  const maxCombo = Number(save.maxCombo)
  const misses = Number(save.misses)
  const wrongTaps = Number(save.wrongTaps)
  if (![score, hits, combo, maxCombo, misses, wrongTaps].every((v) => Number.isFinite(v) && v >= 0)) {
    return null
  }
  return {
    v: 1,
    rows: clean,
    score: Math.floor(score),
    hits: Math.floor(hits),
    combo: Math.floor(combo),
    maxCombo: Math.floor(maxCombo),
    misses: Math.floor(misses),
    wrongTaps: Math.floor(wrongTaps),
    elapsed: Math.max(0, Number(save.elapsed) || 0),
    ts: Number(save.ts) || 0,
  }
}

export class PianoTilesEngine {
  /**
   * @param {Object} cb { onState, onGameOver, onPause }
   */
  constructor(cb = {}) {
    this.cb = cb
    this.state = 'start'
    this.rows = []
    this.score = 0
    this.combo = 0
    this.maxCombo = 0
    this.hits = 0
    this.misses = 0
    this.wrongTaps = 0
    this._nextId = 1
    this.overReason = ''

    this.elapsedBase = 0
    this.resumeAt = 0
    this.clockRunning = false
  }

  start() {
    this.rows = []
    this.score = 0
    this.combo = 0
    this.maxCombo = 0
    this.hits = 0
    this.misses = 0
    this.wrongTaps = 0
    this._nextId = 1
    this.overReason = ''
    // 预置传送带：从顶部外一行铺到 VISIBLE-1.5，行间距恒为 1，
    // 让玩家在第一块到达判定线前有约 0.4 秒的准备时间。
    const bottomSeed = PIANO.VISIBLE - 1.5
    for (let y = PIANO.SPAWN_Y; y <= bottomSeed + 1e-6; y += 1) {
      this.rows.push({ id: this._nextId++, lane: this._randomLane(), y, hit: false })
    }
    this._ensureRows()

    this.state = 'playing'
    this.elapsedBase = 0
    this.resumeAt = Date.now()
    this.clockRunning = true
    this._emit()
    return this.getSnapshot()
  }

  /** 从本地存档恢复：进入 paused，等玩家手动继续 */
  restore(save) {
    const data = validateSave(save)
    if (!data) return { ok: false, reason: '存档无效' }
    this.rows = data.rows.map((r) => ({ ...r }))
    this._nextId = this.rows.reduce((m, r) => Math.max(m, r.id), 0) + 1
    this.score = data.score
    this.hits = data.hits
    this.combo = data.combo
    this.maxCombo = data.maxCombo
    this.misses = data.misses
    this.wrongTaps = data.wrongTaps
    this.overReason = ''

    this.state = 'paused'
    this.elapsedBase = data.elapsed * 1000
    this.resumeAt = Date.now()
    this.clockRunning = false
    this._emit()
    return { ok: true, snapshot: this.getSnapshot() }
  }

  /** 点按某条轨道：命中判定窗口内最低的未命中黑块得分，否则判结束 */
  tap(lane) {
    if (this.state !== 'playing') return { ok: false, reason: '当前不能操作' }
    if (!Number.isInteger(lane) || lane < 0 || lane >= PIANO.LANES) {
      return { ok: false, reason: '轨道不存在' }
    }
    const lo = PIANO.JUDGE_Y - PIANO.HIT_TOL
    const hi = PIANO.JUDGE_Y + PIANO.HIT_TOL
    let active = null
    for (const r of this.rows) {
      if (r.hit) continue
      if (r.y >= lo && r.y <= hi && (!active || r.y > active.y)) active = r
    }
    if (!active) {
      // 判定窗口内暂无可点黑块：忽略（避免空点误判）
      this._emit()
      return { ok: true, ignored: true }
    }
    if (active.lane === lane) {
      active.hit = true
      this.score += 1
      this.combo += 1
      this.hits += 1
      if (this.combo > this.maxCombo) this.maxCombo = this.combo
      this._emit()
      return { ok: true, hit: true, score: this.score, combo: this.combo }
    }
    // 点到白块
    this.wrongTaps += 1
    this._end('wrong-tap')
    return { ok: false, reason: '点到了白块', fail: true }
  }

  /** 推进下落（页面 rAF 调用，dt 毫秒）；切后台恢复不跳帧由 dt 上限兜底 */
  tick(dtMs) {
    if (this.state !== 'playing' || !this.clockRunning) return
    const dt = Math.max(0, Math.min(100, Number(dtMs) || 0)) / 1000
    if (dt <= 0) return
    const speed = this._speed()
    for (const r of this.rows) r.y += speed * dt
    // 漏点检测：未命中的行越过底线
    for (const r of this.rows) {
      if (!r.hit && r.y > PIANO.MISS_Y) {
        this._end('missed')
        return
      }
    }
    // 清理已离开场地底部的行（命中行维持间距直到离场）
    const cutoff = PIANO.MISS_Y + 2
    this.rows = this.rows.filter((r) => r.y < cutoff)
    this._ensureRows()
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

  stop() {
    if (this.state !== 'playing' && this.state !== 'paused') return false
    this._finish('stopped')
    return true
  }

  dispose() {
    this.cb = {}
  }

  _speed() {
    return Math.min(PIANO.MAX_SPEED, PIANO.BASE_SPEED + this.hits * PIANO.SPEED_GAIN)
  }

  /** 始终把场地从顶部填满，行间距恒为 1 行高 */
  _ensureRows() {
    while (this.rows.length === 0 || this.rows[0].y > PIANO.SPAWN_Y) {
      const y = this.rows.length ? this.rows[0].y - 1 : PIANO.SPAWN_Y
      this.rows.unshift({ id: this._nextId++, lane: this._randomLane(), y, hit: false })
    }
  }

  _randomLane() {
    return Math.floor(Math.random() * PIANO.LANES)
  }

  _end(reason) {
    if (reason === 'missed') this.misses += 1
    this._finish(reason)
  }

  _finish(result) {
    if (this.clockRunning) {
      this.elapsedBase += Date.now() - this.resumeAt
      this.clockRunning = false
    }
    this.state = 'over'
    this.overReason = result
    this._emit()
    this.cb.onGameOver?.({
      result,
      score: this.score,
      hits: this.hits,
      maxCombo: this.maxCombo,
      misses: this.misses,
      wrongTaps: this.wrongTaps,
      speed: this._speed(),
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
      score: this.score,
      combo: this.combo,
      maxCombo: this.maxCombo,
      hits: this.hits,
      misses: this.misses,
      wrongTaps: this.wrongTaps,
      speed: this._speed(),
      overReason: this.overReason,
      elapsed: this._elapsed(),
      lanes: PIANO.LANES,
      visible: PIANO.VISIBLE,
      judgeY: PIANO.JUDGE_Y,
      hitTol: PIANO.HIT_TOL,
      rows: this.rows.map((r) => ({ id: r.id, lane: r.lane, y: r.y, hit: r.hit })),
    }
  }
}
