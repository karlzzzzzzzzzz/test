/**
 * 贪吃蛇引擎（纯逻辑，与 UI 解耦）
 * 核心：固定节拍 + 方向输入缓冲队列 —— 节拍由结束时间戳驱动（对齐 TetrisEngine 重力 /
 * 番茄钟计时模式，切后台恢复不跳帧）；方向输入进入容量 2 的缓冲队列，每拍消费 1 个，
 * 入队过滤同向 / 反向（180°）：快速连按两键在相邻两拍依次转向，不会同帧反向自杀。
 * 架构参照基线 SpaceShooter / TetrisEngine：回调通信 + dispose 清理。
 */

const COLS = 20
const ROWS = 20
const BASE_INTERVAL = 150 // 初始节拍 ms
const TIER_STEP = 50 // 每得分 50 升 1 档
const MAX_TIER = 9 // 速度档上限
const FOOD_SCORE = 10 // 每个食物得分
const QUEUE_CAP = 2 // 输入缓冲队列容量
const WIN_LENGTH = COLS * ROWS // 占满全图判通关

// 方向单位向量（页面键盘/触控层映射后传入）
export const DIR = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

export class SnakeEngine {
  /**
   * @param {Object} cb 回调：onState(snapshot) / onGameOver(score, elapsed, win) / onPause()
   */
  constructor(cb = {}) {
    this.cb = cb
    this.state = 'start' // start | playing | paused | over
    this.snake = [] // 坐标队列 {x, y}，头在前
    this.dir = DIR.right
    this.queue = [] // 输入缓冲队列（≤QUEUE_CAP）
    this.food = null
    this.score = 0
    this.win = false
    this.tickTimer = null
    this.elapsedBase = 0 // 已累计的游戏时长 ms（不含当前 playing 段）
    this.resumeAt = 0 // 当前 playing 段起点
  }

  /** 新开局：初始长度 3，棋盘中部向右 */
  start() {
    const midY = Math.floor(ROWS / 2)
    const midX = Math.floor(COLS / 2)
    this.snake = [
      { x: midX, y: midY },
      { x: midX - 1, y: midY },
      { x: midX - 2, y: midY },
    ]
    this.dir = DIR.right
    this.queue = []
    this.score = 0
    this.win = false
    this.elapsedBase = 0
    this.resumeAt = Date.now()
    this.state = 'playing'
    this._spawnFood()
    this._emit()
    this._scheduleTick()
  }

  /**
   * 方向入队：与队尾（队列空时与当前方向）相同或相反（点积 ±1）的输入丢弃；
   * 队列满（容量 2）丢弃。仅 playing 态接受。
   */
  enqueue(d) {
    if (this.state !== 'playing') return false
    if (this.queue.length >= QUEUE_CAP) return false
    const ref = this.queue.length > 0 ? this.queue[this.queue.length - 1] : this.dir
    const dot = ref.x * d.x + ref.y * d.y // 同向=1 反向=-1 垂直=0
    if (dot !== 0) return false
    this.queue.push(d)
    return true
  }

  /** 切后台/失焦/手动暂停（仅 playing 态生效） */
  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    this.elapsedBase += Date.now() - this.resumeAt
    clearTimeout(this.tickTimer)
    this.tickTimer = null
    this.cb.onPause?.()
    this._emit()
  }

  /** 恢复：重置时钟基准，防大步长跳帧 */
  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    this.resumeAt = Date.now()
    this._emit()
    this._scheduleTick()
  }

  dispose() {
    clearTimeout(this.tickTimer)
    this.tickTimer = null
  }

  getSnapshot() {
    return {
      snake: this.snake.map((s) => ({ x: s.x, y: s.y })),
      food: this.food ? { x: this.food.x, y: this.food.y } : null,
      score: this.score,
      length: this.snake.length,
      tier: this._tier(),
      interval: this._interval(),
      state: this.state,
      win: this.win,
      elapsed: this._elapsed(),
    }
  }

  /** 速度档位 = min(9, floor(score/50))，节拍 = 150 − 档位×10 ms */
  _tier() {
    return Math.min(MAX_TIER, Math.floor(this.score / TIER_STEP))
  }

  _interval() {
    return BASE_INTERVAL - this._tier() * 10 // 档 0~9 → 150~60ms
  }

  _elapsed() {
    const running = this.state === 'playing' ? Date.now() - this.resumeAt : 0
    return Math.round(((this.elapsedBase + running) / 1000) * 10) / 10
  }

  _tick() {
    if (this.state !== 'playing') return
    // 每拍消费 1 个缓冲输入
    if (this.queue.length > 0) this.dir = this.queue.shift()
    const head = this.snake[0]
    const nx = head.x + this.dir.x
    const ny = head.y + this.dir.y
    // 撞墙
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
      this._end(false)
      return
    }
    // 撞身（从紧：含本拍即将移出的尾节）
    if (this.snake.some((s) => s.x === nx && s.y === ny)) {
      this._end(false)
      return
    }
    this.snake.unshift({ x: nx, y: ny })
    const ate = this.food && nx === this.food.x && ny === this.food.y
    if (ate) {
      this.score += FOOD_SCORE // 吃食物：长度 +1（不移除尾节）
      if (this.snake.length >= WIN_LENGTH || !this._spawnFood()) {
        this._end(true) // 无空格生成食物 → 通关结束，分数有效
        return
      }
    } else {
      this.snake.pop()
    }
    this._emit()
    this._scheduleTick()
  }

  /** 食物随机生成于空格（排除蛇体全部坐标）；无空格返回 false */
  _spawnFood() {
    const occupied = new Set(this.snake.map((s) => s.y * COLS + s.x))
    const empty = []
    for (let i = 0; i < WIN_LENGTH; i++) {
      if (!occupied.has(i)) empty.push(i)
    }
    if (empty.length === 0) {
      this.food = null
      return false
    }
    const pick = empty[Math.floor(Math.random() * empty.length)]
    this.food = { x: pick % COLS, y: Math.floor(pick / COLS) }
    return true
  }

  /** 结束：onGameOver 恰好触发一次（state 切 over 后 _tick 不再进入） */
  _end(win) {
    this.state = 'over'
    this.win = win
    this.elapsedBase += Date.now() - this.resumeAt
    clearTimeout(this.tickTimer)
    this.tickTimer = null
    this.cb.onGameOver?.(this.score, this._elapsed(), win)
  }

  /** 节拍调度：基于结束时间戳驱动，档位越高间隔越短 */
  _scheduleTick() {
    clearTimeout(this.tickTimer)
    if (this.state !== 'playing') return
    const interval = this._interval()
    this.tickTimer = setTimeout(() => this._tick(), interval)
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }
}

// 导出常量供页面渲染使用（棋盘尺寸、节拍参数）
export const SNAKE = { COLS, ROWS, BASE_INTERVAL, QUEUE_CAP, WIN_LENGTH }
