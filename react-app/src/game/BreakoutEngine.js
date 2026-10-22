/**
 * 打砖块引擎（纯逻辑，与 UI 解耦）
 * 核心：固定步长物理 —— 1/240s 定步积分防高速穿透（球速封顶 720px/s 时单步仅 3px，
 * 小于挡板厚度 12px）；8ms setTimeout 节拍链驱动（对齐 SnakeEngine 结束时间戳模式，
 * 超大 dt 钳制吸收，切后台恢复不跳帧）；每步最多处理 1 次砖块碰撞，物理结果确定。
 * 架构参照基线 SnakeEngine / TetrisEngine：回调通信 + dispose 清理 + 脏标记持久化。
 */

// ===== 逻辑画布与布局常量（Canvas 内部坐标系 480×640） =====
const W = 480
const H = 640
const COLS = 10
const ROWS = 6
const GAP = 4
const PADX = 4
const TOP = 48 // 砖块区顶距
const BRICK_W = (W - PADX * 2 - GAP * (COLS - 1)) / COLS // 43.6
const BRICK_H = 20
const BRICK_COUNT = COLS * ROWS

// ===== 挡板 =====
const PADDLE_H = 12
const PADDLE_BOTTOM = 24 // 挡板底边距画布底
const PADDLE_Y = H - PADDLE_BOTTOM - PADDLE_H // 挡板顶边 y = 604
const PADDLE_W0 = 96 // L1 宽度
const PADDLE_W_MIN = 64
const PADDLE_SHRINK = 8 // 每关 -8
const PADDLE_SPEED = 540 // 键盘移动速度 px/s

// ===== 小球 =====
const BALL_R = 6
const SPEED0 = 360 // 初速 px/s
const SPEED_MAX = 720
const SPEED_GROWTH = 1.08 // 每关 ×1.08

// ===== 物理节拍 =====
const STEP = 1 / 240 // 固定步长 s
const TICK_MS = 8 // 节拍间隔（每拍约 2 步）
const MAX_STEPS_PER_TICK = 12 // 单拍步数上限（≈50ms 吸收窗口）
const EMIT_MIN_MS = 16 // 快照推送节流（≈60/s）

const LIVES0 = 3
const WIN_LEVEL = 5 // 完成第 5 关判通关

// ===== 持久化 =====
const STORAGE_KEY = 'game-breakout-state'
const TOUCH_KEY = 'game-breakout-touch-starts'
const SAVE_VERSION = 1
const SAVE_TTL = 7 * 24 * 3600 * 1000 // 7 天 TTL 自动清理
const SAVE_MAX_BYTES = 4000 // 快照序列化上限，超出丢弃
const PERSIST_FALLBACK_MS = 5000 // 运行中兜底写间隔

// ===== 关卡布局表（10 字符 × 6 行：'.'=空 '1'=普通砖 '2'=坚固砖） =====
const LAYOUTS = [
  [ // L1：全普通（60 块）
    '1111111111',
    '1111111111',
    '1111111111',
    '1111111111',
    '1111111111',
    '1111111111',
  ],
  [ // L2：硬砖横带
    '2222222222',
    '1111111111',
    '1111111111',
    '2222222222',
    '1111111111',
    '1111111111',
  ],
  [ // L3：金字塔硬核
    '....11....',
    '..112211..',
    '.11122111.',
    '1112222111',
    '.11122111.',
    '..111111..',
  ],
  [ // L4：交错列阵
    '2121212121',
    '1212121212',
    '2121212121',
    '1212121212',
    '2121212121',
    '1212121212',
  ],
  [ // L5：要塞
    '2222222222',
    '2111111112',
    '2122222212',
    '2121111212',
    '2122222212',
    '2222222222',
  ],
]

function parseLayout(rows) {
  const arr = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = rows[r][c]
      arr.push(ch === '2' ? 2 : ch === '1' ? 1 : 0)
    }
  }
  return arr
}

export class BreakoutEngine {
  /**
   * @param {Object} cb 回调：onState(snapshot) / onGameOver(score, elapsed) /
   *   onWin(score) / onPause() / onPersistError(kind: 'quota'|'unavailable')
   */
  constructor(cb = {}) {
    this.cb = cb
    this.state = 'start' // start | playing | paused | over | win
    this.level = 1
    this.score = 0
    this.lives = LIVES0
    this.won = false
    this.bricks = new Array(BRICK_COUNT).fill(0) // 当前剩余击打数 0/1/2
    this.brickInit = new Array(BRICK_COUNT).fill(0) // 初始类型（计分依据）
    this.paddleX = W / 2
    this.paddleW = PADDLE_W0
    this.speed = SPEED0
    this.ball = { x: W / 2, y: PADDLE_Y - BALL_R, vx: 0, vy: 0, stuck: true }
    this.keys = { left: false, right: false }
    this.tickTimer = null
    this.persistTimer = null
    this.lastTick = 0
    this.lastEmit = 0
    this.forceEmit = true
    this.elapsedBase = 0 // 已累计游戏时长 ms（不含当前 playing 段）
    this.resumeAt = 0
    this.persistAvailable = this._detectStorage()
    this.dirty = false
  }

  _detectStorage() {
    try {
      const probe = '__breakout_probe__'
      localStorage.setItem(probe, '1')
      localStorage.removeItem(probe)
      return true
    } catch {
      return false
    }
  }

  // ===== 对外操作 =====

  /** 新开局：第 1 关、3 命、0 分 */
  start() {
    this.level = 1
    this.score = 0
    this.lives = LIVES0
    this.won = false
    this.elapsedBase = 0
    this._loadLevel(1)
    this._enterPlaying()
  }

  /**
   * 从快照续玩：读取 localStorage 校验合法性，成功返回 true 并进入 playing
   * （球复位待发），失败（损坏/版本不符/超 TTL/无剩余砖）清除旧值返回 false
   */
  restoreSave() {
    const data = this._readSave()
    if (!data) return false
    this.level = data.level
    this.score = data.score
    this.lives = data.lives
    this.won = !!data.won
    this.elapsedBase = 0
    this._loadLevel(data.level, data.bricks)
    this._enterPlaying()
    return true
  }

  /** 供开始屏判断是否有可恢复进度：返回 { level } 或 null（非法快照顺带清除） */
  getSaveInfo() {
    const data = this._readSave()
    return data ? { level: data.level } : null
  }

  /** 通关后「继续挑战」：进入下一关（无尽循环 L3~L5 布局，球速继续 +8% 封顶 720） */
  continueChallenge() {
    if (this.state !== 'win') return
    this._loadLevel(this.level + 1)
    this._enterPlaying()
  }

  /** 发球（仅 playing 且待发态）：角度 90°±15° 随机 */
  launch() {
    if (this.state !== 'playing' || !this.ball.stuck) return false
    const rad = ((90 + (Math.random() * 30 - 15)) * Math.PI) / 180
    this.ball.vx = Math.cos(rad) * this.speed
    this.ball.vy = -Math.sin(rad) * this.speed
    this.ball.stuck = false
    this.forceEmit = true
    return true
  }

  /** 键盘按住状态（←→/AD，速度 540px/s，由页面 keydown/keyup 维护） */
  setKey(dir, pressed) {
    if (dir === 'left' || dir === 'right') this.keys[dir] = pressed
  }

  /** 鼠标/触控直接映射挡板中心 X（钳制在画布内） */
  movePaddleTo(x) {
    const half = this.paddleW / 2
    this.paddleX = Math.max(half, Math.min(W - half, x))
    if (this.ball.stuck) this.forceEmit = true
  }

  /** 切后台/失焦/手动暂停（仅 playing 态生效，含待发子态）；暂停即落盘 */
  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    this.elapsedBase += Date.now() - this.resumeAt
    this.keys = { left: false, right: false }
    this._stopLoop()
    this._markDirty()
    this.persist()
    this.cb.onPause?.()
    this._emit()
  }

  /** 恢复：重置时钟基准，防大步长跳帧 */
  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    this.resumeAt = Date.now()
    this._startLoop()
    this._emit()
  }

  dispose() {
    this._stopLoop()
    this.persist()
  }

  getSnapshot() {
    return {
      state: this.state,
      score: this.score,
      level: this.level,
      lives: this.lives,
      bricks: this.bricks.slice(),
      brickInit: this.brickInit,
      ball: {
        x: Math.round(this.ball.x * 10) / 10,
        y: Math.round(this.ball.y * 10) / 10,
        stuck: this.ball.stuck,
      },
      paddleX: Math.round(this.paddleX * 10) / 10,
      paddleW: this.paddleW,
      won: this.won,
      elapsed: this._elapsed(),
    }
  }

  // ===== 内部：状态切换 =====

  _enterPlaying() {
    this.state = 'playing'
    this.resumeAt = Date.now()
    this._markDirty()
    this._startLoop()
    this._emit()
  }

  _loadLevel(level, savedBricks) {
    this.level = level
    const layout = LAYOUTS[level <= WIN_LEVEL ? level - 1 : 2 + ((level - WIN_LEVEL - 1) % 3)]
    this.brickInit = parseLayout(layout)
    this.bricks = savedBricks ? savedBricks.slice() : this.brickInit.slice()
    this.paddleW = Math.max(PADDLE_W_MIN, PADDLE_W0 - (level - 1) * PADDLE_SHRINK)
    this.speed = Math.min(SPEED_MAX, SPEED0 * Math.pow(SPEED_GROWTH, level - 1))
    this.paddleX = W / 2
    this.ball = { x: this.paddleX, y: PADDLE_Y - BALL_R, vx: 0, vy: 0, stuck: true }
    this.forceEmit = true
  }

  // ===== 内部：物理循环（setTimeout 节拍链 + 固定步长积分） =====

  _startLoop() {
    this._stopLoop()
    this.lastTick = performance.now()
    this.lastEmit = 0
    const tick = () => {
      if (this.state !== 'playing') return
      const now = performance.now()
      let dt = (now - this.lastTick) / 1000
      this.lastTick = now
      // 超大 dt 钳制吸收（切后台恢复由 resume 重置基准，这里是双保险）
      if (dt > MAX_STEPS_PER_TICK * STEP) dt = MAX_STEPS_PER_TICK * STEP
      let steps = Math.floor(dt / STEP)
      while (steps-- > 0 && this.state === 'playing') this._step(STEP)
      if (this.forceEmit || now - this.lastEmit >= EMIT_MIN_MS) {
        this.lastEmit = now
        this.forceEmit = false
        this._emit()
      }
      this.tickTimer = setTimeout(tick, TICK_MS)
    }
    this.tickTimer = setTimeout(tick, TICK_MS)
    // 运行中 5s 兜底持久化
    this.persistTimer = setInterval(() => this.persist(), PERSIST_FALLBACK_MS)
  }

  _stopLoop() {
    if (this.tickTimer) {
      clearTimeout(this.tickTimer)
      this.tickTimer = null
    }
    if (this.persistTimer) {
      clearInterval(this.persistTimer)
      this.persistTimer = null
    }
  }

  /** 单个固定步：挡板移动 → 球积分 → 墙/挡板/砖块（最多 1 次）/落底判定 */
  _step(dt) {
    // 挡板键盘移动（两端钳制）
    const dir = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0)
    if (dir !== 0) this.movePaddleTo(this.paddleX + dir * PADDLE_SPEED * dt)
    const b = this.ball
    if (b.stuck) {
      b.x = this.paddleX
      b.y = PADDLE_Y - BALL_R
      return
    }
    const prevY = b.y
    b.x += b.vx * dt
    b.y += b.vy * dt
    // 左右墙
    if (b.x < BALL_R) {
      b.x = BALL_R
      b.vx = Math.abs(b.vx)
    } else if (b.x > W - BALL_R) {
      b.x = W - BALL_R
      b.vx = -Math.abs(b.vx)
    }
    // 顶墙
    if (b.y < BALL_R) {
      b.y = BALL_R
      b.vy = Math.abs(b.vy)
    }
    // 挡板碰撞（仅下行且上一步球底在挡板顶之上，防侧面穿入）
    if (
      b.vy > 0 &&
      prevY + BALL_R <= PADDLE_Y &&
      b.y + BALL_R >= PADDLE_Y &&
      b.y + BALL_R <= PADDLE_Y + PADDLE_H + 2 &&
      b.x >= this.paddleX - this.paddleW / 2 - BALL_R &&
      b.x <= this.paddleX + this.paddleW / 2 + BALL_R
    ) {
      const offset = Math.max(-1, Math.min(1, (b.x - this.paddleX) / (this.paddleW / 2)))
      const angle = (offset * 60 * Math.PI) / 180 // 反射角：偏移 × 60°（自垂直线）
      const sp = Math.hypot(b.vx, b.vy)
      b.vx = Math.sin(angle) * sp
      b.vy = -Math.cos(angle) * sp
      b.y = PADDLE_Y - BALL_R
    }
    // 砖块碰撞：行优先扫描，每步最多 1 次
    this._hitBrick(b)
    // 落底：生命 -1 复位待发；归零结束
    if (b.y - BALL_R > H) this._loseLife()
  }

  _hitBrick(b) {
    for (let r = 0; r < ROWS; r++) {
      const by = TOP + r * (BRICK_H + GAP)
      if (b.y + BALL_R < by || b.y - BALL_R > by + BRICK_H) continue
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c
        if (this.bricks[i] === 0) continue
        const bx = PADX + c * (BRICK_W + GAP)
        if (b.x + BALL_R < bx || b.x - BALL_R > bx + BRICK_W) continue
        // 最近点判定碰撞轴向（入射轴镜像反弹）
        const cx = Math.max(bx, Math.min(b.x, bx + BRICK_W))
        const cy = Math.max(by, Math.min(b.y, by + BRICK_H))
        const dx = b.x - cx
        const dy = b.y - cy
        if (dx === 0 && dy === 0) {
          b.vy = -b.vy // 球心陷入（极罕见）：垂直反弹
        } else if (Math.abs(dx) > Math.abs(dy)) {
          b.vx = dx > 0 ? Math.abs(b.vx) : -Math.abs(b.vx)
        } else {
          b.vy = dy > 0 ? Math.abs(b.vy) : -Math.abs(b.vy)
        }
        // 计分：坚固砖首击 +20（2→1），击碎 +80；普通砖击碎 +50
        this.bricks[i] -= 1
        if (this.bricks[i] > 0) {
          this.score += 20
        } else {
          this.score += this.brickInit[i] === 2 ? 80 : 50
        }
        this._markDirty()
        this.forceEmit = true
        if (this.bricks.every((v) => v === 0)) this._levelClear()
        return // 每步最多 1 次砖块碰撞
      }
    }
  }

  _levelClear() {
    this._markDirty()
    if (this.level >= WIN_LEVEL && !this.won) {
      // 完成 L5 → 通关（won 锁保证仅触发一次）
      this.won = true
      this.state = 'win'
      this.elapsedBase += Date.now() - this.resumeAt
      this._stopLoop()
      this.persist()
      this.cb.onWin?.(this.score)
      this._emit()
      return
    }
    this._loadLevel(this.level + 1)
    this.persist()
    this._emit()
  }

  _loseLife() {
    this.lives -= 1
    this._markDirty()
    if (this.lives <= 0) {
      this.state = 'over'
      this.elapsedBase += Date.now() - this.resumeAt
      this._stopLoop()
      this.persist()
      this.cb.onGameOver?.(this.score, this._elapsed())
      this._emit()
      return
    }
    this.ball = { x: this.paddleX, y: PADDLE_Y - BALL_R, vx: 0, vy: 0, stuck: true }
    this.persist()
    this._emit()
  }

  _elapsed() {
    const running = this.state === 'playing' ? Date.now() - this.resumeAt : 0
    return Math.round(((this.elapsedBase + running) / 1000) * 10) / 10
  }

  // ===== 内部：持久化（脏标记 + 事件点统一落盘 + 5s 兜底） =====

  _markDirty() {
    this.dirty = true
  }

  persist() {
    if (!this.dirty) return
    this.dirty = false
    if (!this.persistAvailable) return // 已降级内存（构造探测或配额满）
    try {
      const snap = {
        v: SAVE_VERSION,
        level: this.level,
        score: this.score,
        lives: this.lives,
        bricks: this.bricks,
        won: this.won,
        ts: Date.now(),
      }
      const s = JSON.stringify(snap)
      if (s.length > SAVE_MAX_BYTES) {
        localStorage.removeItem(STORAGE_KEY) // 异常膨胀：丢弃快照
        return
      }
      localStorage.setItem(STORAGE_KEY, s)
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        this.persistAvailable = false // 配额满：降级内存，进度仅本次会话有效
        this.cb.onPersistError?.('quota')
      }
      // 其他异常静默，不阻断游戏
    }
  }

  /** 读取并全量校验快照；非法（版本/损坏/超 TTL/无砖/命数越界）清除并返回 null */
  _readSave() {
    if (!this.persistAvailable) return null
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const d = JSON.parse(raw)
      const invalid =
        !d ||
        d.v !== SAVE_VERSION ||
        Date.now() - d.ts > SAVE_TTL ||
        !Number.isInteger(d.level) ||
        d.level < 1 ||
        !Number.isFinite(d.score) ||
        d.score < 0 ||
        !Number.isInteger(d.lives) ||
        d.lives < 1 ||
        d.lives > LIVES0 ||
        !Array.isArray(d.bricks) ||
        d.bricks.length !== BRICK_COUNT ||
        !d.bricks.every((v) => v === 0 || v === 1 || v === 2) ||
        !d.bricks.some((v) => v > 0)
      if (invalid) {
        localStorage.removeItem(STORAGE_KEY)
        return null
      }
      return d
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // 忽略
      }
      return null
    }
  }

  /** 静态工具：触摸操作启动累计次数写入 game-breakout-touch-starts（每局 1 次，0~99999 封顶） */
  static bumpTouchStarts() {
    try {
      const cur = Math.max(0, Math.min(99999, Number(localStorage.getItem(TOUCH_KEY)) || 0))
      localStorage.setItem(TOUCH_KEY, String(Math.min(99999, cur + 1)))
    } catch {
      // 不可用时静默忽略
    }
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }
}

// 导出常量供页面渲染使用
export const BREAKOUT = {
  W,
  H,
  COLS,
  ROWS,
  GAP,
  PADX,
  TOP,
  BRICK_W,
  BRICK_H,
  PADDLE_H,
  PADDLE_Y,
  BALL_R,
  LIVES0,
}
