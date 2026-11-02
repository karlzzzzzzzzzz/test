/**
 * 关灯挑战引擎（Lights Out，纯逻辑，与 UI 解耦）
 * 架构对齐 MemoryEngine：回调通信 + pause/resume 时钟基准 + dispose。
 * 状态：start → playing ⇄ paused → over（全灭）| failed（超时）。
 *
 * 规则：点按一格会翻转它自己与上下左右邻居；把所有灯熄灭即胜利。
 * 打乱方式：从「全灭」态随机施加 N 次合法翻转 → 结果必然可解（逆序点回即可复位）。
 */

// 难度：格数、打乱步数（同时作为 par 基准步数）、限时秒数、基准分
export const DIFFICULTY = {
  easy: { rows: 4, cols: 4, scramble: 5, limitSec: 90, baseScore: 600, label: '轻松 4×4' },
  normal: { rows: 5, cols: 5, scramble: 8, limitSec: 150, baseScore: 900, label: '挑战 5×5' },
  hard: { rows: 6, cols: 6, scramble: 12, limitSec: 180, baseScore: 1200, label: '专家 6×6' },
}

export const LIGHTS_OUT = {
  TICK_MS: 200, // 页面侧倒计时刷新间隔
  UNDO_LIMIT: 3,
  STEP_PENALTY: 8, // 超出 par 每步扣 8 分
  SEC_PENALTY: 2, // 每秒扣 2 分
  MIN_SCORE: 100,
  SCRAMBLE_TRIES: 20,
}

export class LightsOutEngine {
  /**
   * @param {Object} cb 回调：onState(snapshot) / onGameOver(score, elapsed, result) / onPause()
   * @param {Object} options { random } 注入随机源便于单测
   */
  constructor(cb = {}, options = {}) {
    this.cb = cb
    this.random = options.random || Math.random

    this.state = 'start'
    this.level = 'easy'
    this._cfg = DIFFICULTY.easy
    this.rows = this._cfg.rows
    this.cols = this._cfg.cols
    this.lights = [] // boolean[]
    this.steps = 0
    this.history = [] // 已生效的翻转索引，供撤销逆序回退
    this.undoLeft = LIGHTS_OUT.UNDO_LIMIT
    this.started = false // 是否已点下第一格（计时起点）
    this.elapsedBase = 0
    this.resumeAt = 0
    this.lastAction = null // start | toggle | undo | win | timeout | null
  }

  /** 开局：按难度生成必然可解的棋盘 */
  start(level = 'easy') {
    const key = level in DIFFICULTY ? level : 'easy'
    const cfg = DIFFICULTY[key]
    this._cfg = cfg
    this.level = key
    this.rows = cfg.rows
    this.cols = cfg.cols
    this.steps = 0
    this.history = []
    this.undoLeft = LIGHTS_OUT.UNDO_LIMIT
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
    this._scramble()
    this.state = 'playing'
    this.lastAction = 'start'
    this._emit()
  }

  /**
   * 翻转一格（含上下左右）。
   * @returns {boolean} true=已生效，false=被忽略
   */
  toggle(idx) {
    if (this.state !== 'playing') return false
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.lights.length) return false

    if (!this.started) {
      this.started = true
      this.resumeAt = Date.now() - this.elapsedBase
    }
    this._flip(idx)
    this.steps += 1
    this.history.push(idx)
    this.lastAction = 'toggle'

    if (this._countLit() === 0) {
      this._finish('over')
    } else {
      this._emit()
    }
    return true
  }

  /** 撤销最后一步：回退灯态，但不返还步数。每局上限 3 次。 */
  undo() {
    if (this.state !== 'playing') return false
    if (this.undoLeft <= 0 || this.history.length === 0) return false

    const idx = this.history.pop()
    this._flip(idx) // 交叉翻转自逆，再执行一次即回到上一步
    this.undoLeft -= 1
    this.lastAction = 'undo'
    this._emit()
    return true
  }

  /** 页面每 200ms 调用一次：驱动倒计时刷新与超时判定 */
  tick() {
    if (this.state !== 'playing' || !this.started) return
    if (this._elapsed() >= this._cfg.limitSec) {
      this._finish('failed')
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
    if (this.started) {
      // 累计基点已在 pause 时结算，这里只重置当前段起点
      this.resumeAt = Date.now()
    }
    this.lastAction = 'resume'
    this._emit()
  }

  dispose() {
    // 引擎不持有定时器（由页面驱动 tick），此处仅解除回调引用
    this.cb = {}
  }

  /** 得分：max(100, 基准 − 超 par 步数×8 − 秒数×2) */
  _score() {
    const extra = Math.max(0, this.steps - this._cfg.scramble)
    const penalty = extra * LIGHTS_OUT.STEP_PENALTY + Math.floor(this._elapsed()) * LIGHTS_OUT.SEC_PENALTY
    return Math.max(LIGHTS_OUT.MIN_SCORE, Math.round(this._cfg.baseScore - penalty))
  }

  _elapsed() {
    const running = this.state === 'playing' && this.started ? Date.now() - this.resumeAt : 0
    return Math.round(((this.elapsedBase + running) / 1000) * 10) / 10
  }

  _finish(result) {
    if (this.started) this.elapsedBase += Date.now() - this.resumeAt
    this.state = result
    this.lastAction = result === 'over' ? 'win' : 'timeout'
    this._emit()
    this.cb.onGameOver?.(result === 'over' ? this._score() : 0, this._elapsed(), result === 'over' ? 'win' : 'timeout')
  }

  /** 随机打乱：从全灭态施加 scramble 次翻转；同格不连续，结果全灭则重抽 */
  _scramble() {
    const total = this.rows * this.cols
    let attempt = 0
    do {
      this.lights = new Array(total).fill(false)
      let prev = -1
      for (let i = 0; i < this._cfg.scramble; i++) {
        let idx = Math.floor(this.random() * total)
        if (idx >= total) idx = total - 1
        if (idx === prev) idx = (idx + 1) % total
        this._flip(idx)
        prev = idx
      }
      attempt += 1
    } while (this._countLit() === 0 && attempt < LIGHTS_OUT.SCRAMBLE_TRIES)

    // 极端兜底：仍然全灭则中心单点两次（必然留下 4~5 盏灯且一步可解）
    if (this._countLit() === 0) {
      this._flip(Math.floor(total / 2))
    }
  }

  /** 翻转自身 + 上下左右（越界忽略），不改动步数与历史 */
  _flip(idx) {
    const { rows, cols } = this
    const r = Math.floor(idx / cols)
    const c = idx % cols
    this.lights[idx] = !this.lights[idx]
    if (r > 0) this.lights[idx - cols] = !this.lights[idx - cols]
    if (r < rows - 1) this.lights[idx + cols] = !this.lights[idx + cols]
    if (c > 0) this.lights[idx - 1] = !this.lights[idx - 1]
    if (c < cols - 1) this.lights[idx + 1] = !this.lights[idx + 1]
  }

  _countLit() {
    let n = 0
    for (let i = 0; i < this.lights.length; i++) if (this.lights[i]) n += 1
    return n
  }

  getSnapshot() {
    const remaining = Math.max(0, Math.ceil(this._cfg.limitSec - this._elapsed()))
    return {
      state: this.state,
      level: this.level,
      rows: this.rows,
      cols: this.cols,
      lights: this.lights.slice(),
      steps: this.steps,
      remainingLights: this._countLit(),
      elapsed: this._elapsed(),
      remaining,
      limitSec: this._cfg.limitSec,
      undoLeft: this.undoLeft,
      par: this._cfg.scramble,
      score: this.state === 'over' ? this._score() : null,
      lastAction: this.lastAction,
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }
}
