/**
 * 记忆翻牌引擎（纯逻辑，与 UI 解耦）
 * 架构对齐 SnakeEngine：回调通信 + dispose 清理 + pause/resume 时钟基准重置。
 * 状态：start → playing → paused → over（全部配对自动进入 over）。
 */

// 难度常量（导出供页面使用）
export const DIFFICULTY = {
  easy: { rows: 4, cols: 4, pairs: 8, baseScore: 800, minSteps: 8 },
  hard: { rows: 4, cols: 5, pairs: 10, baseScore: 1200, minSteps: 10 },
}

// 图标池（共 10 个，图标数量 = max(4×4/2, 5×4/2) = 10）
export const ICON_POOL = ['React', 'Vite', 'LLM', 'Deploy', 'Debug', 'NPM', 'Cloud', 'Test', 'UI', 'Perf']

const TICK_MS = 100 // 计时精度，100ms 刷新一次

export class MemoryEngine {
  /**
   * @param {Object} cb 回调：onState(snapshot) / onGameOver(score, elapsed, win) / onPause()
   */
  constructor(cb = {}) {
    this.cb = cb
    this.state = 'start'
    this.difficulty = 'easy'
    this.cards = [] // [{ id, icon, matched, flipped }]
    this.firstIdx = -1 // 第一张翻开的索引
    this.secondIdx = -1 // 第二张翻开的索引
    this.busy = false // 翻回窗口期锁定输入
    this.steps = 0 // 翻牌对数（第 2 张翻开会 +1）
    this.pairsMatched = 0
    this.baseScore = DIFFICULTY.easy.baseScore
    this.minSteps = DIFFICULTY.easy.minSteps
    this.matchResult = null // null | 'match' | 'mismatch' （onState 触发时携带，用于 aria-live 播报）
    this.tickTimer = null
    this.flipBackTimer = null
    this.started = false // 是否已翻开第一张牌（计时起点）
    this.elapsedBase = 0
    this.resumeAt = 0
  }

  /** 开局：Fisher–Yates 洗牌 */
  start(difficulty = 'easy') {
    const cfg = DIFFICULTY[difficulty] || DIFFICULTY.easy
    const total = cfg.rows * cfg.cols

    // 从图标池取 pairs 个，每个复制一份 → 数组洗牌
    const icons = ICON_POOL.slice(0, cfg.pairs).flatMap((icon) => [icon, icon])
    for (let i = icons.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[icons[i], icons[j]] = [icons[j], icons[i]]
    }

    this.difficulty = difficulty
    this.baseScore = cfg.baseScore
    this.minSteps = cfg.minSteps
    this.rows = cfg.rows
    this.cols = cfg.cols
    this.cards = icons.map((icon, idx) => ({
      id: idx,
      icon,
      matched: false,
      flipped: false,
    }))
    this.firstIdx = -1
    this.secondIdx = -1
    this.busy = false
    this.steps = 0
    this.pairsMatched = 0
    this.matchResult = null
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = Date.now()
    this.state = 'playing'

    clearTimeout(this.tickTimer)
    clearTimeout(this.flipBackTimer)
    this.tickTimer = null
    this.flipBackTimer = null

    this._emit()
  }

  /**
   * 翻牌：仅 playing 态、未锁定（busy=false）、目标未翻开且未配对时生效。
   * 返回值：true=翻牌成功，false=被忽略。
   */
  flip(idx) {
    if (this.state !== 'playing') return false
    if (this.busy) return false
    if (idx < 0 || idx >= this.cards.length) return false
    const card = this.cards[idx]
    if (card.flipped || card.matched) return false
    // 同一张牌已是第一张（连点第一张）→ 忽略
    if (this.firstIdx === idx) return false

    // 计时起点：翻开第一张未被配对的牌时开始
    if (!this.started) {
      this.started = true
      this.resumeAt = Date.now() - this.elapsedBase // 若暂停过则对齐到累计基点
      this._scheduleTick()
    }

    card.flipped = true
    if (this.firstIdx === -1) {
      this.firstIdx = idx
      this.matchResult = null
    } else {
      this.secondIdx = idx
      this.steps += 1
      this._resolvePair()
    }
    this._emit()
    return true
  }

  /** 翻牌后 800ms 判定 + 翻回 + 结束检查 */
  _resolvePair() {
    const a = this.cards[this.firstIdx]
    const b = this.cards[this.secondIdx]
    const matched = a.icon === b.icon
    this.matchResult = matched ? 'match' : 'mismatch'

    // 锁定输入（翻回窗口期 / 配对锁定期）
    this.busy = true

    clearTimeout(this.flipBackTimer)
    this.flipBackTimer = setTimeout(() => {
      if (this.state !== 'playing') return
      if (matched) {
        a.matched = true
        b.matched = true
        this.pairsMatched += 1
        if (this.pairsMatched === DIFFICULTY[this.difficulty].pairs) {
          // 全部配对完成 → 结束
          clearTimeout(this.tickTimer)
          this.tickTimer = null
          this.state = 'over'
          this.elapsedBase += Date.now() - this.resumeAt
          this.cb.onGameOver?.(this._score(), this._elapsed(), true)
          this._emit()
          return
        }
      } else {
        a.flipped = false
        b.flipped = false
      }
      this.firstIdx = -1
      this.secondIdx = -1
      this.busy = false
      this.matchResult = null
      this._emit()
    }, 800)
  }

  /** 切后台/失焦/手动暂停（仅 playing 态生效） */
  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    if (this.started) {
      this.elapsedBase += Date.now() - this.resumeAt
    }
    clearTimeout(this.tickTimer)
    clearTimeout(this.flipBackTimer)
    this.tickTimer = null
    this.flipBackTimer = null
    this.cb.onPause?.()
    this._emit()
  }

  /** 恢复：重置时钟基准，防大步长跳帧 */
  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    if (this.started) {
      this.resumeAt = Date.now()
      this._scheduleTick()
    }
    this._emit()
  }

  dispose() {
    clearTimeout(this.tickTimer)
    clearTimeout(this.flipBackTimer)
    this.tickTimer = null
    this.flipBackTimer = null
  }

  /** 得分公式：max(100, base - (steps - minSteps) × 15 - elapsedSec × 3) */
  _score() {
    const diff = DIFFICULTY[this.difficulty]
    const penaltySteps = Math.max(0, this.steps - diff.minSteps) * 15
    const penaltyTime = Math.floor(this._elapsed()) * 3
    return Math.max(100, Math.round(diff.baseScore - penaltySteps - penaltyTime))
  }

  _elapsed() {
    const running = this.started && this.state === 'playing' ? Date.now() - this.resumeAt : 0
    return Math.round(((this.elapsedBase + running) / 1000) * 10) / 10
  }

  _scheduleTick() {
    clearTimeout(this.tickTimer)
    if (this.state !== 'playing' || !this.started) return
    this.tickTimer = setTimeout(() => {
      // 每秒触发一次 state 刷新驱动计时 UI；内部 _emit 是便宜操作
      if (this.state === 'playing') this._emit()
      this._scheduleTick()
    }, TICK_MS)
  }

  getSnapshot() {
    const cfg = DIFFICULTY[this.difficulty]
    return {
      state: this.state,
      difficulty: this.difficulty,
      rows: cfg.rows,
      cols: cfg.cols,
      cards: this.cards.map((c) => ({ ...c })),
      steps: this.steps,
      pairsMatched: this.pairsMatched,
      pairsTotal: cfg.pairs,
      elapsed: this._elapsed(),
      score: this.state === 'over' ? this._score() : null,
      liveScore: this.state === 'playing' ? this._score() : null,
      busy: this.busy,
      matchResult: this.matchResult,
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }
}

// 常量：最小步数、图标池、翻转锁定时长
export const MEMORY = {
  TICK_MS,
  FLIP_LOCK_MS: 800,
}
