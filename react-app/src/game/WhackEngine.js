/**
 * 打地鼠引擎（纯逻辑，与 UI 解耦，不依赖 React / DOM / Canvas）
 * 架构对齐 MemoryEngine：回调通信 + pause/resume 时钟基准重置 + dispose 清理。
 *
 * 状态：ready → playing（含 1000ms 准备期）→ paused → over
 * 计时：基于结束时间戳（endAt）驱动，100ms 轮询，切后台恢复不跳秒。
 */

export const WHACK = {
  HOLES: 9,
  COLS: 3,
  GAME_MS: 30000, // 单局固定 30 秒
  READY_MS: 1000, // 准备期，不出鼠
  FIRST_DELAY_MS: 300, // 首个地鼠延迟
  VISIBLE_MS: 600, // 可见窗口初始值
  VISIBLE_DECAY_STEP_MS: 50, // 每 5 秒递减
  VISIBLE_DECAY_EVERY_MS: 5000,
  MIN_VISIBLE_MS: 350, // 可见窗口下限
  GAP_MS: 250, // 地鼠消失后的空窗
  GOLD_RATE: 0.1, // 金鼠概率
  SCORE_NORMAL: 10,
  SCORE_GOLD: 30,
  COMBO_BONUS: 5, // 连击达到阈值后的额外分
  COMBO_THRESHOLD: 4,
  COMBO_WINDOW_MS: 1200, // 连击窗口
  IGNORE_MS: 800, // 命中/消失后同一洞位的忽略窗口
  RESUME_GRACE_MS: 300, // 恢复后无输入缓冲
  TICK_MS: 100,
  STATS_FLUSH_MS: 30000, // 统计兜底落盘间隔
  STATS_KEY: 'game-whack-stats-v1',
  MAX_STAT: 99999,
}

const tickOf = (ms) => Math.round((ms / 1000) * 10) / 10

function safeInt(v, max = WHACK.MAX_STAT) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(max, Math.floor(n))
}

/** 读取并校验统计对象；任何异常一律回退零值 */
function loadStats() {
  const empty = { starts: 0, hits: 0, misses: 0, games: 0, best: 0, maxCombo: 0 }
  try {
    const raw = localStorage.getItem(WHACK.STATS_KEY)
    if (!raw) return { data: empty, storageOk: true }
    const obj = JSON.parse(raw)
    if (!obj || obj.v !== 1) {
      localStorage.removeItem(WHACK.STATS_KEY)
      return { data: empty, storageOk: true }
    }
    return {
      data: {
        starts: safeInt(obj.starts),
        hits: safeInt(obj.hits),
        misses: safeInt(obj.misses),
        games: safeInt(obj.games),
        best: safeInt(obj.best),
        maxCombo: safeInt(obj.maxCombo),
      },
      storageOk: true,
    }
  } catch {
    // 损坏 JSON → 清除脏值；localStorage 不可用 → 降级内存
    try { localStorage.removeItem(WHACK.STATS_KEY) } catch { /* 忽略 */ }
    return { data: empty, storageOk: false }
  }
}

export class WhackEngine {
  /**
   * @param {Object} cb 回调：onState(snapshot) / onFeedback({ type, idx, gain, combo }) /
   *   onGameOver(result) / onPause(reason) / onPersistError()
   */
  constructor(cb = {}) {
    this.cb = cb
    this.state = 'ready'
    this.score = 0
    this.hits = 0
    this.misses = 0
    this.combo = 0
    this.maxCombo = 0
    this.lastHitAt = 0
    this.lastMoleIdx = -1
    this.mole = null // { idx, gold, until }
    this.startedAt = 0
    this.endAt = 0
    this.nextSpawnAt = 0
    this.ignoreUntil = new Array(WHACK.HOLES).fill(0)
    this.graceUntil = 0
    this.remainingMs = WHACK.GAME_MS
    this.tickTimer = null
    this.dirty = false
    this.lastFlushAt = 0
    this.result = null

    const loaded = loadStats()
    this.stats = loaded.data
    this.storageOk = loaded.storageOk
  }

  /** 开局（准备期 1000ms 后正式计时） */
  start() {
    const now = Date.now()
    this.state = 'playing'
    this.score = 0
    this.hits = 0
    this.misses = 0
    this.combo = 0
    this.maxCombo = 0
    this.lastHitAt = 0
    this.lastMoleIdx = -1
    this.mole = null
    this.startedAt = now + WHACK.READY_MS
    this.endAt = this.startedAt + WHACK.GAME_MS
    this.remainingMs = WHACK.GAME_MS
    this.nextSpawnAt = this.startedAt + WHACK.FIRST_DELAY_MS
    this.ignoreUntil = new Array(WHACK.HOLES).fill(0)
    this.graceUntil = 0
    this.result = null

    this.stats.starts = safeInt(this.stats.starts + 1)
    this._markDirty()
    this._flush()

    this._schedule()
    this._emit()
  }

  /**
   * 敲击某个洞位（鼠标/触控/键盘统一入口）
   * @returns {'hit'|'miss'|'ignored'}
   */
  tap(idx) {
    if (this.state !== 'playing') return 'ignored'
    if (idx < 0 || idx >= WHACK.HOLES) return 'ignored'
    const now = Date.now()
    // 准备期 / 恢复缓冲期：全部忽略，不计 miss
    if (now < this.startedAt || now < this.graceUntil) return 'ignored'
    // 命中或消失后的忽略窗口
    if (this.ignoreUntil[idx] > now) return 'ignored'

    const m = this.mole
    if (m && m.idx === idx && now < m.until) {
      // 先推进连击，再按本次连击数判定加成（连击 ≥4 起每次额外 +5）
      this.combo = this.lastHitAt && now - this.lastHitAt <= WHACK.COMBO_WINDOW_MS
        ? this.combo + 1
        : 1
      this.maxCombo = Math.max(this.maxCombo, this.combo)
      const gain = (m.gold ? WHACK.SCORE_GOLD : WHACK.SCORE_NORMAL) +
        (this.combo >= WHACK.COMBO_THRESHOLD ? WHACK.COMBO_BONUS : 0)
      this.score += gain
      this.hits += 1
      this.stats.hits = safeInt(this.stats.hits + 1)
      this.lastHitAt = now
      this.mole = null
      this.ignoreUntil[idx] = now + WHACK.IGNORE_MS
      this.nextSpawnAt = now + WHACK.GAP_MS
      this._markDirty()

      this.cb.onFeedback?.({ type: 'hit', idx, gain, gold: m.gold, combo: this.combo })
      this._emit()
      return 'hit'
    }

    this.misses += 1
    this.combo = 0
    this.stats.misses = safeInt(this.stats.misses + 1)
    this._markDirty()
    this.cb.onFeedback?.({ type: 'miss', idx, gain: 0, gold: false, combo: 0 })
    this._emit()
    return 'miss'
  }

  /** 暂停（自动/手动同路径，仅 playing 生效，幂等） */
  pause(reason = 'manual') {
    if (this.state !== 'playing') return
    const now = Date.now()
    this.remainingMs = Math.max(0, this.endAt - now)
    this._frozenMoleRemaining = this.mole ? Math.max(0, this.mole.until - now) : 0
    this._nextSpawnIn = Math.max(0, this.nextSpawnAt - now)
    this.state = 'paused'
    clearTimeout(this.tickTimer)
    this.tickTimer = null
    this._flush()
    this.cb.onPause?.(reason)
    this._emit()
  }

  /** 恢复：重置时钟基准，给 300ms 无输入缓冲 */
  resume() {
    if (this.state !== 'paused') return
    const now = Date.now()
    this.state = 'playing'
    this.endAt = now + this.remainingMs
    this.graceUntil = now + WHACK.RESUME_GRACE_MS
    if (this.mole && this._frozenMoleRemaining > 0) {
      this.mole.until = now + this._frozenMoleRemaining
      this.nextSpawnAt = now + this._nextSpawnIn
    } else {
      this.mole = null
      this.nextSpawnAt = now + WHACK.GAP_MS
    }
    this._schedule()
    this._emit()
  }

  /** 统计脏数据落盘（pagehide / dispose 也调用） */
  flush() {
    this._flush()
  }

  dispose() {
    clearTimeout(this.tickTimer)
    this.tickTimer = null
    this._flush()
  }

  _schedule() {
    clearTimeout(this.tickTimer)
    if (this.state !== 'playing') return
    this.tickTimer = setTimeout(() => this._tick(), WHACK.TICK_MS)
  }

  _tick() {
    const now = Date.now()
    if (this.state !== 'playing') return

    // 准备期：不出鼠、不计时
    if (now >= this.startedAt) {
      if (now >= this.endAt) {
        this._finish()
        return
      }
      if (this.mole && now >= this.mole.until) {
        // 地鼠自然消失：仅同一洞位进入 800ms 忽略窗口，不计 miss
        this.ignoreUntil[this.mole.idx] = now + WHACK.IGNORE_MS
        this.mole = null
        this.nextSpawnAt = now + WHACK.GAP_MS
      }
      if (!this.mole && now >= this.nextSpawnAt) this._spawn(now)
    }

    // 统计兜底落盘
    if (this.dirty && now - this.lastFlushAt >= WHACK.STATS_FLUSH_MS) this._flush()

    this._emit()
    this._schedule()
  }

  _spawn(now) {
    let idx = Math.floor(Math.random() * WHACK.HOLES)
    if (idx === this.lastMoleIdx) {
      // 不与上一只同洞（9 洞取模偏移保证一定不同）
      idx = (idx + 1 + Math.floor(Math.random() * (WHACK.HOLES - 1))) % WHACK.HOLES
    }
    this.lastMoleIdx = idx
    const elapsed = WHACK.GAME_MS - Math.max(0, this.endAt - now)
    const decaySteps = Math.floor(elapsed / WHACK.VISIBLE_DECAY_EVERY_MS)
    const visible = Math.max(
      WHACK.MIN_VISIBLE_MS,
      WHACK.VISIBLE_MS - decaySteps * WHACK.VISIBLE_DECAY_STEP_MS,
    )
    this.mole = {
      idx,
      gold: Math.random() < WHACK.GOLD_RATE,
      until: now + visible,
    }
  }

  _finish() {
    clearTimeout(this.tickTimer)
    this.tickTimer = null
    this.state = 'over'
    this.mole = null
    this.remainingMs = 0

    const newRecord = this.score > this.stats.best
    this.stats.games = safeInt(this.stats.games + 1)
    if (newRecord) this.stats.best = safeInt(this.score)
    this.stats.maxCombo = safeInt(Math.max(this.stats.maxCombo, this.maxCombo))
    this._markDirty()
    this._flush()

    this.result = {
      score: this.score,
      best: this.stats.best,
      hits: this.hits,
      misses: this.misses,
      accuracy: this.hits + this.misses === 0
        ? 0
        : Math.round((this.hits / (this.hits + this.misses)) * 100),
      maxCombo: this.maxCombo,
      newRecord,
    }
    this.cb.onGameOver?.(this.result)
    this._emit()
  }

  _markDirty() {
    this.dirty = true
  }

  _flush() {
    this.dirty = false
    this.lastFlushAt = Date.now()
    try {
      const payload = JSON.stringify({
        v: 1,
        starts: this.stats.starts,
        hits: this.stats.hits,
        misses: this.stats.misses,
        games: this.stats.games,
        best: this.stats.best,
        maxCombo: this.stats.maxCombo,
        ts: Date.now(),
      })
      localStorage.setItem(WHACK.STATS_KEY, payload)
      if (!this.storageOk) {
        this.storageOk = true
        this._emit()
      }
    } catch {
      if (this.storageOk) {
        this.storageOk = false
        this.cb.onPersistError?.()
        this._emit()
      }
    }
  }

  getSnapshot() {
    const now = Date.now()
    const remain = this.state === 'paused'
      ? this.remainingMs
      : this.state === 'playing'
        ? Math.max(0, this.endAt - now)
        : 0
    const remainingSec = tickOf(remain)
    return {
      state: this.state,
      score: this.score,
      hits: this.hits,
      misses: this.misses,
      combo: this.combo,
      maxCombo: this.maxCombo,
      remainingSec,
      totalSec: WHACK.GAME_MS / 1000,
      preparing: this.state === 'playing' && now < this.startedAt,
      mole: this.state === 'playing' && this.mole ? { idx: this.mole.idx, gold: this.mole.gold } : null,
      best: this.stats.best,
      storageOk: this.storageOk,
      result: this.result,
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }
}
