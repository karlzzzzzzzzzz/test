/**
 * 推箱子引擎（Sokoban，纯逻辑，与 UI 解耦）
 * 架构对齐 LightsOutEngine：回调通信 + pause/resume 时钟基准 + dispose。
 * 状态：start → playing ⇄ paused → over（全部箱子归位）| failed（超时）。
 *
 * 规则：玩家在网格中移动；若前方是箱子且箱子后方为空地，则推动箱子。
 * 撤销记录每次有效移动前的完整状态（玩家/箱子/步数/推箱数），可无限次回退。
 * 全部关卡均已用独立 BFS 求解器验证可通关，par 为最小移动步数。
 */

// 三档难度：限时秒数与基准分（单关 1~3 分钟）
export const TIERS = {
  easy: { label: '入门', limitSec: 120, baseScore: 500 },
  normal: { label: '进阶', limitSec: 150, baseScore: 800 },
  hard: { label: '专家', limitSec: 180, baseScore: 1200 },
}

// 12 个手工关卡：地图最大 6 列 8 行（320px 下单格热区仍 ≥40px）
// # 墙 / . 目标点 / $ 箱子 / * 箱在目标 / @ 玩家 / + 玩家在目标
export const LEVELS = [
  {
    id: 1,
    name: '一步之遥',
    tier: 'easy',
    par: 3,
    rows: ['#####', '#   #', '# @$#', '#  .#', '#   #', '#####'],
  },
  {
    id: 2,
    name: '双箱归位',
    tier: 'easy',
    par: 5,
    rows: ['######', '#  . #', '#  $ #', '# @  #', '#    #', '#  $ #', '#  . #', '######'],
  },
  {
    id: 3,
    name: '并排双箱',
    tier: 'easy',
    par: 6,
    rows: ['######', '#    #', '# .$ #', '# .$ #', '#  @ #', '######'],
  },
  {
    id: 4,
    name: '拐角推进',
    tier: 'easy',
    par: 8,
    rows: ['######', '# .  #', '#  # #', '# $@ #', '#  $ #', '# .  #', '######'],
  },
  {
    id: 5,
    name: '双向归位',
    tier: 'normal',
    par: 9,
    rows: ['######', '# .  #', '#  $ #', '# $  #', '#  @ #', '# .  #', '######'],
  },
  {
    id: 6,
    name: '上下分流',
    tier: 'normal',
    par: 10,
    rows: ['######', '# .  #', '#  $ #', '# $@ #', '#  . #', '#    #', '######'],
  },
  {
    id: 7,
    name: '三箱分流',
    tier: 'normal',
    par: 13,
    rows: ['######', '# . .#', '#  $ #', '# $ $#', '#  @ #', '# .  #', '######'],
  },
  {
    id: 8,
    name: '墙后绕行',
    tier: 'normal',
    par: 13,
    rows: ['######', '#  . #', '# #  #', '# $@ #', '#  $ #', '# .  #', '######'],
  },
  {
    id: 9,
    name: '夹缝穿行',
    tier: 'hard',
    par: 19,
    rows: ['######', '# . .#', '#  $ #', '# $#$#', '#  @ #', '# .  #', '######'],
  },
  {
    id: 10,
    name: '三箱闭环',
    tier: 'hard',
    par: 23,
    rows: ['######', '#  . #', '#  # #', '# $@$#', '#  $ #', '# . .#', '######'],
  },
  {
    id: 11,
    name: '长路绕行',
    tier: 'hard',
    par: 26,
    rows: ['######', '#  . #', '#  $ #', '# @# #', '#  $ #', '#  . #', '######'],
  },
  {
    id: 12,
    name: '四箱终局',
    tier: 'hard',
    par: 27,
    rows: ['######', '# . .#', '#@ $ #', '# $#$#', '#  $ #', '# . .#', '######'],
  },
]

export const SOKOBAN = {
  TICK_MS: 200, // 页面侧倒计时刷新间隔
  MOVE_PENALTY: 8, // 超出 par 每步扣 8 分
  SEC_PENALTY: 2, // 每秒扣 2 分
  MIN_SCORE: 100,
  MAX_HISTORY: 200,
  LEVEL_COUNT: LEVELS.length,
}

const DIRS = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
}

/** 解析地图：返回 { width, height, walls, goals, boxes, player }，非法时抛错 */
export function parseLevel(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('地图为空')
  const height = rows.length
  const width = rows[0].length
  if (width === 0) throw new Error('地图宽度为 0')
  const walls = new Array(height * width).fill(false)
  const goals = new Array(height * width).fill(false)
  const boxes = new Set()
  let player = -1
  for (let r = 0; r < height; r++) {
    if (String(rows[r]).length !== width) throw new Error(`第 ${r + 1} 行宽度不一致`)
    for (let c = 0; c < width; c++) {
      const ch = rows[r][c]
      const idx = r * width + c
      if (ch === '#') walls[idx] = true
      else if (ch === '.' || ch === '*' || ch === '+') goals[idx] = true
      if (ch === '$' || ch === '*') boxes.add(idx)
      if (ch === '@' || ch === '+') {
        if (player >= 0) throw new Error('玩家数量不为 1')
        player = idx
      }
    }
  }
  if (player < 0) throw new Error('缺少玩家')
  const goalCount = goals.filter(Boolean).length
  if (boxes.size !== goalCount) throw new Error(`箱子数 ${boxes.size} 与目标数 ${goalCount} 不一致`)
  return { width, height, walls, goals, boxes, player }
}

export class SokobanEngine {
  /**
   * @param {Object} cb 回调：onState(snapshot) / onGameOver(score, elapsed, result) / onPause()
   * @param {Object} options { now } 注入时钟便于单测，默认 Date.now
   */
  constructor(cb = {}, options = {}) {
    this.cb = cb
    this.now = options.now || Date.now

    this.state = 'start'
    this.levelIndex = 0
    this.meta = LEVELS[0]
    this.width = 0
    this.height = 0
    this.walls = []
    this.goals = []
    this.boxes = new Set()
    this.player = -1
    this.moves = 0
    this.pushes = 0
    this.history = []
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
    this.lastAction = null
  }

  /** 开局：按关卡索引加载地图（越界回退第 1 关） */
  start(levelIndex = 0, action = 'start') {
    const idx = Number.isInteger(levelIndex) && levelIndex >= 0 && levelIndex < LEVELS.length ? levelIndex : 0
    const meta = LEVELS[idx]
    const parsed = parseLevel(meta.rows)
    this.levelIndex = idx
    this.meta = meta
    this.width = parsed.width
    this.height = parsed.height
    this.walls = parsed.walls
    this.goals = parsed.goals
    this.boxes = parsed.boxes
    this.player = parsed.player
    this.moves = 0
    this.pushes = 0
    this.history = []
    this.started = false
    this.elapsedBase = 0
    this.resumeAt = 0
    this.state = 'playing'
    this.lastAction = action
    this._emit()
  }

  /**
   * 向四方向移动一步（含推箱）。
   * @param {'up'|'down'|'left'|'right'} dir
   * @returns {'moved'|'pushed'|'blocked'|'win'|'ignored'}
   */
  move(dir) {
    if (this.state !== 'playing') return 'ignored'
    const delta = DIRS[dir]
    if (!delta) return 'ignored'
    const { width, height } = this
    const r = Math.floor(this.player / width)
    const c = this.player % width
    const nr = r + delta[0]
    const nc = c + delta[1]
    if (nr < 0 || nr >= height || nc < 0 || nc >= width) return 'ignored'
    const next = nr * width + nc
    if (this.walls[next]) {
      this.lastAction = 'blocked'
      this._emit()
      return 'blocked'
    }

    const pushing = this.boxes.has(next)
    let pushedTo = -1
    if (pushing) {
      const br = nr + delta[0]
      const bc = nc + delta[1]
      if (br < 0 || br >= height || bc < 0 || bc >= width) {
        this.lastAction = 'blocked'
        this._emit()
        return 'blocked'
      }
      pushedTo = br * width + bc
      if (this.walls[pushedTo] || this.boxes.has(pushedTo)) {
        this.lastAction = 'blocked'
        this._emit()
        return 'blocked'
      }
    }

    // 有效移动：先保存回退快照
    this._pushHistory()
    this.player = next
    if (pushing) {
      this.boxes.delete(next)
      this.boxes.add(pushedTo)
      this.pushes += 1
    }
    this.moves += 1

    if (!this.started) {
      this.started = true
      this.resumeAt = this.now() - this.elapsedBase
    }

    if (this._allOnGoal()) {
      this._finish('over')
      return 'win'
    }
    this.lastAction = pushing ? 'push' : 'move'
    this._emit()
    return pushing ? 'pushed' : 'moved'
  }

  /** 撤销最近一次有效移动：玩家/箱子/步数/推箱数一并回退 */
  undo() {
    if (this.state !== 'playing' || this.history.length === 0) return false
    const snap = this.history.pop()
    this.player = snap.player
    this.boxes = new Set(snap.boxes)
    this.moves = snap.moves
    this.pushes = snap.pushes
    this.lastAction = 'undo'
    this._emit()
    return true
  }

  /** 重开当前关：地图、步数、推箱、历史与计时全部重置 */
  restart() {
    if (this.state !== 'playing' && this.state !== 'paused') return false
    this.start(this.levelIndex, 'restart')
    return true
  }

  /** 页面每 200ms 调用一次：驱动倒计时刷新与超时判定 */
  tick() {
    if (this.state !== 'playing' || !this.started) return
    if (this._elapsed() >= this._limit()) {
      this._finish('failed')
      return
    }
    this._emit()
  }

  /** 切后台/失焦/手动暂停（仅 playing 生效） */
  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    if (this.started) this.elapsedBase += this.now() - this.resumeAt
    this.lastAction = 'pause'
    this.cb.onPause?.()
    this._emit()
  }

  /** 恢复：重置时钟基准，防暂停时长计入 */
  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    if (this.started) this.resumeAt = this.now()
    this.lastAction = 'resume'
    this._emit()
  }

  dispose() {
    // 引擎不持有定时器（由页面驱动 tick），此处仅解除回调引用
    this.cb = {}
  }

  _limit() {
    return TIERS[this.meta.tier]?.limitSec ?? TIERS.easy.limitSec
  }

  _baseScore() {
    return TIERS[this.meta.tier]?.baseScore ?? TIERS.easy.baseScore
  }

  _pushHistory() {
    this.history.push({
      player: this.player,
      boxes: [...this.boxes],
      moves: this.moves,
      pushes: this.pushes,
    })
    if (this.history.length > SOKOBAN.MAX_HISTORY) this.history.shift()
  }

  _allOnGoal() {
    if (this.boxes.size === 0) return false
    for (const idx of this.boxes) if (!this.goals[idx]) return false
    return true
  }

  _boxesOnGoal() {
    let n = 0
    for (const idx of this.boxes) if (this.goals[idx]) n += 1
    return n
  }

  /** 得分：max(100, 基准 − 超出 par 步数×8 − 秒数×2) */
  _score() {
    const extra = Math.max(0, this.moves - this.meta.par)
    const penalty = extra * SOKOBAN.MOVE_PENALTY + Math.floor(this._elapsed()) * SOKOBAN.SEC_PENALTY
    return Math.max(SOKOBAN.MIN_SCORE, Math.round(this._baseScore() - penalty))
  }

  _elapsed() {
    const running = this.state === 'playing' && this.started ? this.now() - this.resumeAt : 0
    return Math.round(((this.elapsedBase + running) / 1000) * 10) / 10
  }

  _finish(result) {
    if (this.started) this.elapsedBase += this.now() - this.resumeAt
    this.state = result
    this.lastAction = result === 'over' ? 'win' : 'timeout'
    this._emit()
    this.cb.onGameOver?.(
      result === 'over' ? this._score() : 0,
      this._elapsed(),
      result === 'over' ? 'win' : 'timeout',
    )
  }

  getSnapshot() {
    const remaining = Math.max(0, Math.ceil(this._limit() - this._elapsed()))
    const boxes = new Array(this.width * this.height).fill(false)
    for (const idx of this.boxes) boxes[idx] = true
    return {
      state: this.state,
      levelId: this.meta.id,
      levelIndex: this.levelIndex,
      name: this.meta.name,
      tier: this.meta.tier,
      tierLabel: TIERS[this.meta.tier]?.label ?? '',
      rows: this.height,
      cols: this.width,
      walls: this.walls.slice(),
      goals: this.goals.slice(),
      boxes,
      player: this.player,
      moves: this.moves,
      pushes: this.pushes,
      totalBoxes: this.boxes.size,
      boxesOnGoal: this._boxesOnGoal(),
      elapsed: this._elapsed(),
      remaining,
      limitSec: this._limit(),
      par: this.meta.par,
      undoCount: this.history.length,
      canUndo: this.state === 'playing' && this.history.length > 0,
      score: this.state === 'over' ? this._score() : null,
      lastAction: this.lastAction,
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }
}
