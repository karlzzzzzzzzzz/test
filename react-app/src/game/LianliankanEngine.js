/**
 * 连连看引擎（Link-Link，纯逻辑，与 UI 解耦）
 * 架构对齐 LightsOutEngine：回调通信 + pause/resume 时钟基准 + dispose。
 * 状态：start → playing ⇄ paused → over（全部消除）| failed（超时）。
 *
 * 规则：点按两个相同图案的格子，若能用不超过两次转弯的直线路径连通（可绕出棋盘边界），
 * 则两张牌一起消除；消除全部牌即获胜。
 */

// 难度：行 × 列（固定 6 列保证 320px 下每格 ≥40px）、图案种类、限时秒数、基准分
export const DIFFICULTY = {
  easy: { rows: 6, cols: 6, symbols: 6, limitSec: 180, baseScore: 600, label: '轻松 6×6' },
  normal: { rows: 7, cols: 6, symbols: 8, limitSec: 150, baseScore: 900, label: '挑战 6×7' },
  hard: { rows: 8, cols: 6, symbols: 10, limitSec: 120, baseScore: 1200, label: '专家 6×8' },
}

export const LIANLIANKAN = {
  TICK_MS: 200,
  HINT_LIMIT: 3,
  SHUFFLE_LIMIT: 2,
  SEC_PENALTY: 2,
  WRONG_PENALTY: 5,
  MIN_SCORE: 100,
  SHUFFLE_TRIES: 30,
  MAX_TURNS: 2,
}

export class LianliankanEngine {
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
    this.tiles = [] // (number|null)[]
    this.totalPairs = 0
    this.clearedPairs = 0
    this.selected = null
    this.wrongTaps = 0
    this.hintsLeft = LIANLIANKAN.HINT_LIMIT
    this.shufflesLeft = LIANLIANKAN.SHUFFLE_LIMIT
    this.autoShuffles = 0
    this.hintPair = null
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
    this.lastAction = null
  }

  /** 开局：按难度生成成对牌面，并保证至少存在一组可连通的牌 */
  start(level = 'easy') {
    const key = level in DIFFICULTY ? level : 'easy'
    const cfg = DIFFICULTY[key]
    this._cfg = cfg
    this.level = key
    this.rows = cfg.rows
    this.cols = cfg.cols
    this.totalPairs = (cfg.rows * cfg.cols) / 2
    this.clearedPairs = 0
    this.selected = null
    this.wrongTaps = 0
    this.hintsLeft = LIANLIANKAN.HINT_LIMIT
    this.shufflesLeft = LIANLIANKAN.SHUFFLE_LIMIT
    this.autoShuffles = 0
    this.hintPair = null
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
    this._fillBoard()
    this.state = 'playing'
    this.lastAction = 'start'
    this._emit()
  }

  /**
   * 点按一格：首次点按选中，第二次点按同图案且可连通则消除。
   * 不同图案会切换选中（不惩罚）；同图案但不可连通记一次误点并取消选中。
   * @returns {boolean} true=已处理的选中/切换，false=被忽略或误点
   */
  select(idx) {
    if (this.state !== 'playing') return false
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.tiles.length) return false
    if (this.tiles[idx] === null) return false

    if (!this.started) {
      this.started = true
      this.resumeAt = Date.now() - this.elapsedBase
    }
    this.hintPair = null

    if (this.selected === idx) {
      this.selected = null
      this.lastAction = 'deselect'
      this._emit()
      return true
    }
    if (this.selected === null) {
      this.selected = idx
      this.lastAction = 'select'
      this._emit()
      return true
    }
    const a = this.selected
    if (this.tiles[a] !== this.tiles[idx]) {
      this.selected = idx
      this.lastAction = 'switch'
      this._emit()
      return true
    }
    if (!this._findPath(a, idx)) {
      this.wrongTaps += 1
      this.selected = null
      this.lastAction = 'wrong'
      this._emit()
      return false
    }
    this._clearPair(a, idx)
    return true
  }

  /** 提示：返回一组可连通的坐标，消耗一次机会；无解时先自动洗牌 */
  hint() {
    if (this.state !== 'playing' || this.hintsLeft <= 0) return null
    let pair = this._findAnyPair()
    if (!pair) {
      this._shuffleBoard()
      this.autoShuffles += 1
      pair = this._findAnyPair()
    }
    if (!pair) return null
    this.hintsLeft -= 1
    this.hintPair = pair
    this.lastAction = 'hint'
    this._emit()
    return pair
  }

  /** 手动洗牌：重排剩余牌面，消耗一次机会 */
  shuffle() {
    if (this.state !== 'playing' || this.shufflesLeft <= 0) return false
    this._shuffleBoard()
    this.shufflesLeft -= 1
    this.selected = null
    this.hintPair = null
    this.lastAction = 'shuffle'
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
    if (this.started) this.resumeAt = Date.now()
    this.lastAction = 'resume'
    this._emit()
  }

  dispose() {
    // 引擎不持有定时器（由页面驱动 tick），此处仅解除回调引用
    this.cb = {}
  }

  /** 是否连通：0/1/2 次转弯，可绕出棋盘边界（BFS，状态含方向与转弯数） */
  _findPath(a, b) {
    if (a === b || this.tiles[a] === null || this.tiles[b] === null) return false
    const R = this.rows + 2
    const C = this.cols + 2
    const sr = Math.floor(a / this.cols) + 1
    const sc = (a % this.cols) + 1
    const tr = Math.floor(b / this.cols) + 1
    const tc = (b % this.cols) + 1

    // 可通行：目标格恒可进；棋盘外圈为空白通道；棋盘内已消除的格为空
    const free = (r, c) => {
      if (r < 0 || r >= R || c < 0 || c >= C) return false
      if (r === tr && c === tc) return true
      const rr = r - 1
      const cc = c - 1
      if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) return true
      return this.tiles[rr * this.cols + cc] === null
    }

    const DIRS = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]
    const queue = []
    const seen = new Set()
    for (let d = 0; d < 4; d++) {
      const nr = sr + DIRS[d][0]
      const nc = sc + DIRS[d][1]
      if (nr === tr && nc === tc) return true
      if (!free(nr, nc)) continue
      const key = `${nr},${nc},${d},0`
      if (seen.has(key)) continue
      seen.add(key)
      queue.push({ r: nr, c: nc, d, turns: 0 })
    }

    let head = 0
    while (head < queue.length) {
      const cur = queue[head]
      head += 1
      for (let d = 0; d < 4; d++) {
        const turns = cur.turns + (d === cur.d ? 0 : 1)
        if (turns > LIANLIANKAN.MAX_TURNS) continue
        const nr = cur.r + DIRS[d][0]
        const nc = cur.c + DIRS[d][1]
        if (nr === tr && nc === tc) return true
        if (!free(nr, nc)) continue
        const key = `${nr},${nc},${d},${turns}`
        if (seen.has(key)) continue
        seen.add(key)
        queue.push({ r: nr, c: nc, d, turns })
      }
    }
    return false
  }

  /** 找出任意一组可消除的牌（按图案分组，减少比较次数） */
  _findAnyPair() {
    const groups = new Map()
    for (let i = 0; i < this.tiles.length; i++) {
      const s = this.tiles[i]
      if (s === null) continue
      if (!groups.has(s)) groups.set(s, [])
      groups.get(s).push(i)
    }
    for (const list of groups.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (this._findPath(list[i], list[j])) return { a: list[i], b: list[j] }
        }
      }
    }
    return null
  }

  _clearPair(a, b) {
    this.tiles[a] = null
    this.tiles[b] = null
    this.clearedPairs += 1
    this.selected = null
    this.lastAction = 'clear'

    if (this.clearedPairs >= this.totalPairs) {
      this._finish('over')
      return
    }
    // 无可消除对时自动洗牌，避免玩家陷入死局（免费，不消耗手动次数）
    if (!this._findAnyPair()) {
      this._shuffleBoard()
      this.autoShuffles += 1
      if (!this._findAnyPair()) {
        this._shuffleBoard()
        this.autoShuffles += 1
      }
      this.lastAction = 'auto-shuffle'
    }
    this._emit()
  }

  /** 生成成对牌面并打乱，保证至少存在一组可连通的牌 */
  _fillBoard() {
    const pairs = this.totalPairs
    const list = []
    for (let i = 0; i < pairs; i++) {
      const sym = i % this._cfg.symbols
      list.push(sym, sym)
    }
    let attempt = 0
    do {
      this._shuffleArray(list)
      this.tiles = list.slice()
      attempt += 1
    } while (!this._findAnyPair() && attempt < LIANLIANKAN.SHUFFLE_TRIES)
    if (!this._findAnyPair()) this._forceMove()
  }

  /** 重排剩余牌面（保持牌面多重集不变），并保证存在可消除对 */
  _shuffleBoard() {
    const remaining = []
    for (const s of this.tiles) if (s !== null) remaining.push(s)
    if (remaining.length === 0) return
    let attempt = 0
    do {
      this._shuffleArray(remaining)
      let k = 0
      for (let i = 0; i < this.tiles.length; i++) {
        if (this.tiles[i] !== null) this.tiles[i] = remaining[k++]
      }
      attempt += 1
    } while (!this._findAnyPair() && attempt < LIANLIANKAN.SHUFFLE_TRIES)
    if (!this._findAnyPair()) this._forceMove()
  }

  /** 兜底：把同图案的两张牌分别换到相邻的 0/1 位，必然可直连 */
  _forceMove() {
    const s = this.tiles[0]
    if (s === null) return
    const target = this.tiles.findIndex((v, i) => i > 0 && v === s)
    if (target < 0) return
    const tmp = this.tiles[1]
    this.tiles[1] = this.tiles[target]
    this.tiles[target] = tmp
  }

  _shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      let j = Math.floor(this.random() * (i + 1))
      if (j > i) j = i
      const tmp = arr[i]
      arr[i] = arr[j]
      arr[j] = tmp
    }
  }

  /** 得分：max(100, 基准 − 用时秒数×2 − 误点×5)，仅通关计分 */
  _score() {
    const penalty = Math.floor(this._elapsed()) * LIANLIANKAN.SEC_PENALTY + this.wrongTaps * LIANLIANKAN.WRONG_PENALTY
    return Math.max(LIANLIANKAN.MIN_SCORE, Math.round(this._cfg.baseScore - penalty))
  }

  _elapsed() {
    const running = this.state === 'playing' && this.started ? Date.now() - this.resumeAt : 0
    return Math.round(((this.elapsedBase + running) / 1000) * 10) / 10
  }

  _finish(result) {
    if (this.started) this.elapsedBase += Date.now() - this.resumeAt
    this.state = result
    this.lastAction = result === 'over' ? 'win' : 'timeout'
    this.selected = null
    this.hintPair = null
    this._emit()
    this.cb.onGameOver?.(result === 'over' ? this._score() : 0, this._elapsed(), result === 'over' ? 'win' : 'timeout')
  }

  getSnapshot() {
    const remaining = Math.max(0, Math.ceil(this._cfg.limitSec - this._elapsed()))
    return {
      state: this.state,
      level: this.level,
      rows: this.rows,
      cols: this.cols,
      tiles: this.tiles.slice(),
      selected: this.selected,
      totalPairs: this.totalPairs,
      clearedPairs: this.clearedPairs,
      remainingPairs: this.totalPairs - this.clearedPairs,
      wrongTaps: this.wrongTaps,
      hintsLeft: this.hintsLeft,
      shufflesLeft: this.shufflesLeft,
      autoShuffles: this.autoShuffles,
      hintPair: this.hintPair,
      elapsed: this._elapsed(),
      remaining,
      limitSec: this._cfg.limitSec,
      score: this.state === 'over' ? this._score() : null,
      lastAction: this.lastAction,
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }
}
