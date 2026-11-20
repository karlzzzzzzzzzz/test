/**
 * 汉诺塔（Tower of Hanoi）引擎 —— 纯逻辑，与 UI 解耦。
 *
 * 规则：
 * - 三根柱子，n 个圆盘从大到小叠在第 1 根柱上；
 * - 每次只能移动一根柱子最上面的圆盘；
 * - 大盘不能放在小盘上；
 * - 把所有圆盘移到第 3 根柱即获胜，最少步数为 2^n - 1。
 *
 * 状态机：start → playing ⇄ paused → over（完成或手动结束）
 */

export const HANOI = {
  PEGS: 3,
  MIN_DISKS: 3,
  MAX_DISKS: 8,
  SAVE_TTL_MS: 24 * 3600 * 1000,
}

export const LEVELS = {
  3: { disks: 3, label: '入门', blurb: '3 盘 · 7 步' },
  4: { disks: 4, label: '轻松', blurb: '4 盘 · 15 步' },
  5: { disks: 5, label: '标准', blurb: '5 盘 · 31 步' },
  6: { disks: 6, label: '进阶', blurb: '6 盘 · 63 步' },
  7: { disks: 7, label: '困难', blurb: '7 盘 · 127 步' },
  8: { disks: 8, label: '大师', blurb: '8 盘 · 255 步' },
}

export const DISK_OPTIONS = [3, 4, 5, 6, 7, 8]

export const PEG_NAMES = ['A 柱', 'B 柱', 'C 柱']

export function minMoves(disks) {
  return 2 ** disks - 1
}

/** 初始柱面：大盘在下、小盘在上 */
export function createPegs(disks) {
  const first = []
  for (let size = disks; size >= 1; size--) first.push(size)
  return [first, [], []]
}

export function topDisk(pegs, peg) {
  const stack = pegs[peg]
  return stack && stack.length ? stack[stack.length - 1] : 0
}

export function canMove(pegs, from, to) {
  if (from === to) return false
  if (!pegs[from] || !pegs[to]) return false
  const disk = topDisk(pegs, from)
  if (!disk) return false
  const target = topDisk(pegs, to)
  return !target || disk < target
}

export function isValidPegs(pegs, disks) {
  if (!Array.isArray(pegs) || pegs.length !== 3) return false
  const seen = new Set()
  for (const stack of pegs) {
    if (!Array.isArray(stack)) return false
    let prev = Infinity
    for (const disk of stack) {
      if (!Number.isInteger(disk) || disk < 1 || disk > disks) return false
      if (seen.has(disk)) return false
      if (disk >= prev) return false
      seen.add(disk)
      prev = disk
    }
  }
  return seen.size === disks
}

export class HanoiEngine {
  /**
   * @param {Object} cb { onState, onGameOver, onPause }
   */
  constructor(cb = {}) {
    this.cb = cb
    this.state = 'start'
    this.disks = 4
    this.pegs = [[], [], []]
    this.selectedPeg = null
    this.history = []

    this.moves = 0
    this.mistakes = 0
    this.undos = 0
    this.assisted = false

    this.started = false
    this.startedAt = 0
    this.elapsedBase = 0
    this.resumeAt = 0
    this.clockRunning = false
  }

  start(disks = 4) {
    const n = Number(disks)
    this.disks = Number.isInteger(n) && n >= HANOI.MIN_DISKS && n <= HANOI.MAX_DISKS ? n : 4
    this.pegs = createPegs(this.disks)
    this.selectedPeg = null
    this.history = []
    this.moves = 0
    this.mistakes = 0
    this.undos = 0
    this.assisted = false

    this.state = 'playing'
    this.started = true
    this.startedAt = Date.now()
    this.elapsedBase = 0
    this.resumeAt = Date.now()
    this.clockRunning = true
    this._emit()
    return this.getSnapshot()
  }

  /** 从本地存档恢复：进入 paused，等玩家手动继续 */
  restore(save) {
    if (!save || typeof save !== 'object') return { ok: false, reason: '存档格式无效' }
    const disks = Number(save.disks)
    if (!Number.isInteger(disks) || disks < HANOI.MIN_DISKS || disks > HANOI.MAX_DISKS) {
      return { ok: false, reason: '存档盘数无效' }
    }
    if (!isValidPegs(save.pegs, disks)) return { ok: false, reason: '存档柱面无效' }
    const moves = Number(save.moves)
    const mistakes = Number(save.mistakes)
    const undos = Number(save.undos)
    if (![moves, mistakes, undos].every((v) => Number.isFinite(v) && v >= 0)) {
      return { ok: false, reason: '存档计数无效' }
    }

    this.disks = disks
    this.pegs = save.pegs.map((stack) => [...stack])
    this.selectedPeg = null
    this.history = []
    this.moves = Math.floor(moves)
    this.mistakes = Math.floor(mistakes)
    this.undos = Math.floor(undos)
    this.assisted = Boolean(save.assisted)
    this.state = 'paused'
    this.started = true
    this.startedAt = Date.now()
    this.elapsedBase = Math.max(0, Number(save.elapsed) || 0) * 1000
    this.resumeAt = Date.now()
    this.clockRunning = false
    this._emit()
    return { ok: true, snapshot: this.getSnapshot() }
  }

  /** 点击一根柱子：空选择时选中，已选中时尝试移动或取消 */
  select(peg) {
    if (this.state !== 'playing') return { ok: false, reason: '当前不能移动' }
    if (!Number.isInteger(peg) || peg < 0 || peg >= 3) return { ok: false, reason: '柱子不存在' }

    if (this.selectedPeg === null) {
      if (!this.pegs[peg].length) return { ok: false, reason: '该柱没有圆盘' }
      this.selectedPeg = peg
      this._emit()
      return { ok: true, selected: peg }
    }
    if (this.selectedPeg === peg) {
      this.selectedPeg = null
      this._emit()
      return { ok: true, deselected: true }
    }
    const from = this.selectedPeg
    const result = this.move(from, peg)
    if (!result.ok) this.selectedPeg = from
    return result
  }

  move(from, to) {
    if (this.state !== 'playing') return { ok: false, reason: '当前不能移动' }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 2 || to < 0 || to > 2) {
      return { ok: false, reason: '柱子不存在' }
    }
    if (from === to) return { ok: false, reason: '起点与终点相同' }
    const disk = topDisk(this.pegs, from)
    if (!disk) return { ok: false, reason: '该柱没有圆盘' }
    const target = topDisk(this.pegs, to)
    if (target && disk > target) {
      this.mistakes += 1
      this._emit()
      return { ok: false, reason: '大盘不能放在小盘上' }
    }

    this.pegs[from].pop()
    this.pegs[to].push(disk)
    this.history.push({ from, to })
    this.moves += 1
    this.selectedPeg = null

    if (this.pegs[2].length === this.disks) {
      this._finish('win')
      return { ok: true, win: true }
    }
    this._emit()
    return { ok: true }
  }

  undo() {
    if (this.state !== 'playing' && this.state !== 'paused') return { ok: false, reason: '当前不能撤销' }
    if (!this.history.length) return { ok: false, reason: '没有可撤销的步骤' }
    const last = this.history.pop()
    const disk = this.pegs[last.to].pop()
    this.pegs[last.from].push(disk)
    this.moves = Math.max(0, this.moves - 1)
    this.undos += 1
    this.assisted = true
    this.selectedPeg = null
    this._emit()
    return { ok: true }
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
    this.selectedPeg = null
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

  _finish(result) {
    if (this.clockRunning) {
      this.elapsedBase += Date.now() - this.resumeAt
      this.clockRunning = false
    }
    this.selectedPeg = null
    this.state = 'over'
    this._emit()
    this.cb.onGameOver?.({
      result,
      disks: this.disks,
      moves: this.moves,
      optimal: minMoves(this.disks),
      mistakes: this.mistakes,
      undos: this.undos,
      assisted: this.assisted,
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
      disks: this.disks,
      pegs: this.pegs.map((stack) => [...stack]),
      selectedPeg: this.selectedPeg,
      moves: this.moves,
      optimal: minMoves(this.disks),
      mistakes: this.mistakes,
      undos: this.undos,
      assisted: this.assisted,
      canUndo: this.history.length > 0,
      elapsed: this._elapsed(),
    }
  }
}
