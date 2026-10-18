/**
 * 俄罗斯方块引擎（纯逻辑，与 UI 解耦）
 * 核心：位运算 —— 棋盘为长度 20 的整数数组，每行 10 bit（bit9=左墙列0，bit0=列9）；
 * 方块为 16bit 整数（4x4，每行 4bit，行内 bit3=左列），28 个旋转态全部预计算查表。
 * 碰撞 = 行位段 & 棋盘行；移动 = 位段 << / >> 后重检；消行 = 行值 === 1023 纯位比较。
 * 架构参照基线 SpaceShooter / Game2048Engine：回调通信 + dispose 清理。
 */

const COLS = 10
const ROWS = 20
const FULL_ROW = 0b1111111111 // 1023，10 列全满
const SCORES = [0, 100, 300, 500, 800] // 单次消 1/2/3/4 行基础分 × 等级
const SOFT_DROP_INTERVAL = 40 // 软降重力间隔 ms
const MIN_INTERVAL = 100 // 重力间隔下限 ms

// 7 种方块 × 4 旋转态，16bit（行0 在 bit15-12 … 行3 在 bit3-0；行内 bit3=列0）
// I / J / L / O / S / T / Z
const SHAPES = [
  [0x0f00, 0x2222, 0x00f0, 0x4444],
  [0x8e00, 0x6440, 0x0e20, 0x44c0],
  [0x2e00, 0x4460, 0x0e80, 0xc440],
  [0x6600, 0x6600, 0x6600, 0x6600],
  [0x6c00, 0x8c40, 0x06c0, 0x4620],
  [0x4e00, 0x4640, 0x0e40, 0x4c40],
  [0xc600, 0x4c80, 0x0c60, 0x2640],
]

/**
 * 碰撞检测：方块 16bit 按 (px,py) 拆 4 个行位段，与棋盘行做 & 运算
 * px 为 4x4 框左列（可为负），py 为框顶行（<0 的行跳过，允许顶部生成）
 */
function collides(board, bits, px, py) {
  for (let r = 0; r < 4; r++) {
    const seg = (bits >> (12 - r * 4)) & 0xf
    if (!seg) continue
    const row = py + r
    if (row >= ROWS) return true // 触底
    if (row < 0) continue
    // seg bit3=棋盘列0 → 与棋盘 bit9 对齐，固定左移 6 位（px=0 时）
    const shift = 6 - px
    let placed
    if (shift >= 0) {
      placed = seg << shift
      if (placed & ~FULL_ROW) return true // 左越界（位超出 bit9）
    } else {
      if (seg & ((1 << -shift) - 1)) return true // 右越界（低位被移出）
      placed = seg >>> -shift
    }
    if (board[row] & placed) return true
  }
  return false
}

/** 锁定：方块位段并入棋盘，并把方块类型写入颜色网格（调用前已确认无碰撞） */
function lockPiece(board, cells, bits, px, py, type) {
  for (let r = 0; r < 4; r++) {
    const seg = (bits >> (12 - r * 4)) & 0xf
    if (!seg) continue
    const row = py + r
    if (row < 0 || row >= ROWS) continue
    const shift = 6 - px
    board[row] |= shift >= 0 ? seg << shift : seg >>> -shift
    for (let c = 0; c < 4; c++) {
      if ((seg >> (3 - c)) & 1) {
        const col = px + c
        if (col >= 0 && col < COLS) cells[row][col] = type + 1
      }
    }
  }
}

/** 消行：行值 === FULL_ROW 判定，占用棋盘与颜色网格同步消行，返回消除行数 */
function clearLines(board, cells) {
  let cleared = 0
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r] === FULL_ROW) {
      board.splice(r, 1)
      board.unshift(0)
      cells.splice(r, 1)
      cells.unshift(new Uint8Array(COLS))
      cleared++
      r++ // 上方行落下，重检当前行
    }
  }
  return cleared
}

/** 7-bag 洗牌：每袋 7 种各 1 个，避免单一方块长时间不出现 */
function shuffledBag() {
  const bag = [0, 1, 2, 3, 4, 5, 6]
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return bag
}

export class TetrisEngine {
  /**
   * @param {Object} cb 回调：onState(snapshot) / onGameOver(score, elapsed) / onPause()
   */
  constructor(cb = {}) {
    this.cb = cb
    this.state = 'start' // start | playing | paused | over
    this.board = new Array(ROWS).fill(0)
    this.cells = Array.from({ length: ROWS }, () => new Uint8Array(COLS)) // 颜色网格（渲染层，值为 type+1）
    this.bag = []
    this.cur = null // { type, rot, x, y }
    this.score = 0
    this.lines = 0
    this.level = 1
    this.softDropping = false
    this.dropTimer = null
    this.nextDropAt = 0
    this.elapsedBase = 0 // 已累计的游戏时长 ms（不含当前 playing 段）
    this.resumeAt = 0 // 当前 playing 段起点
  }

  /** 新开局 */
  start() {
    this.board = new Array(ROWS).fill(0)
    this.cells = Array.from({ length: ROWS }, () => new Uint8Array(COLS))
    this.bag = []
    this.score = 0
    this.lines = 0
    this.level = 1
    this.softDropping = false
    this.elapsedBase = 0
    this.resumeAt = Date.now()
    this.state = 'playing'
    this._spawn()
    this._emit()
    this._scheduleDrop()
  }

  move(dx) {
    if (this.state !== 'playing' || !this.cur) return false
    const { type, rot, x, y } = this.cur
    if (collides(this.board, SHAPES[type][rot], x + dx, y)) return false
    this.cur = { type, rot, x: x + dx, y }
    this._emit()
    return true
  }

  /** 顺时针旋转（查表切下一态），失败依次尝试左移 1 列、右移 1 列踢墙 */
  rotate() {
    if (this.state !== 'playing' || !this.cur) return false
    const { type, rot, x, y } = this.cur
    const nextRot = (rot + 1) & 3
    const bits = SHAPES[type][nextRot]
    for (const nx of [x, x - 1, x + 1]) {
      if (!collides(this.board, bits, nx, y)) {
        this.cur = { type, rot: nextRot, x: nx, y }
        this._emit()
        return true
      }
    }
    return false // 踢墙全失败，保持原态
  }

  /** 软降开关：开启后重力间隔降为 40ms */
  softDrop(on) {
    if (this.state !== 'playing') return
    if (this.softDropping === !!on) return
    this.softDropping = !!on
    this._scheduleDrop()
  }

  /** 硬降：立即落底锁定，+2 分/格 */
  hardDrop() {
    if (this.state !== 'playing' || !this.cur) return
    const { type, rot, x } = this.cur
    let { y } = this.cur
    const bits = SHAPES[type][rot]
    let dist = 0
    while (!collides(this.board, bits, x, y + 1)) {
      y++
      dist++
    }
    this.cur = { type, rot, x, y }
    this.score += dist * 2
    this._lockAndNext()
    this._emit()
    this._scheduleDrop()
  }

  /** 切后台/失焦自动暂停（仅 playing 态生效） */
  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    this.elapsedBase += Date.now() - this.resumeAt
    this.softDropping = false
    clearTimeout(this.dropTimer)
    this.dropTimer = null
    this.cb.onPause?.()
    this._emit()
  }

  /** 恢复：重置时钟基准，防大步长跳帧 */
  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    this.resumeAt = Date.now()
    this._emit()
    this._scheduleDrop()
  }

  dispose() {
    clearTimeout(this.dropTimer)
    this.dropTimer = null
  }

  getSnapshot() {
    return {
      board: [...this.board],
      cells: this.cells.map((row) => Array.from(row)),
      piece: this.cur ? { ...this.cur } : null,
      next: this._peekNext(),
      score: this.score,
      level: this.level,
      lines: this.lines,
      state: this.state,
      elapsed: this._elapsed(),
    }
  }

  _elapsed() {
    const running = this.state === 'playing' ? Date.now() - this.resumeAt : 0
    return Math.round(((this.elapsedBase + running) / 1000) * 10) / 10
  }

  _peekNext() {
    if (this.bag.length === 0) this.bag = shuffledBag()
    return this.bag[this.bag.length - 1]
  }

  _spawn() {
    if (this.bag.length === 0) this.bag = shuffledBag()
    const type = this.bag.pop()
    this.cur = { type, rot: 0, x: 3, y: 0 }
    // 生成位即碰撞 → 游戏结束
    if (collides(this.board, SHAPES[type][0], 3, 0)) {
      this.state = 'over'
      this.elapsedBase += Date.now() - this.resumeAt
      clearTimeout(this.dropTimer)
      this.dropTimer = null
      this.cb.onGameOver?.(this.score, this._elapsed())
    }
  }

  _moveDown() {
    const { type, rot, x, y } = this.cur
    if (collides(this.board, SHAPES[type][rot], x, y + 1)) return false
    this.cur = { type, rot, x, y: y + 1 }
    return true
  }

  _lockAndNext() {
    const { type, rot, x, y } = this.cur
    lockPiece(this.board, this.cells, SHAPES[type][rot], x, y, type)
    const cleared = clearLines(this.board, this.cells)
    if (cleared > 0) {
      this.score += SCORES[cleared] * this.level
      this.lines += cleared
      this.level = Math.floor(this.lines / 10) + 1
    }
    this._spawn() // 内部含结束判定
  }

  _tick() {
    if (this.state !== 'playing') return
    if (!this._moveDown()) this._lockAndNext()
    this._emit()
    this._scheduleDrop()
  }

  /** 重力调度：基于结束时间戳驱动，等级越高间隔越短 */
  _scheduleDrop() {
    clearTimeout(this.dropTimer)
    if (this.state !== 'playing') return
    const interval = this.softDropping
      ? SOFT_DROP_INTERVAL
      : Math.max(MIN_INTERVAL, 1000 - (this.level - 1) * 80)
    this.nextDropAt = Date.now() + interval
    this.dropTimer = setTimeout(() => this._tick(), interval)
  }

  _emit() {
    this.cb.onState?.(this.getSnapshot())
  }
}

// 导出常量供页面渲染使用（位段拆解、形状表、棋盘尺寸）
export const TETRIS = { COLS, ROWS, FULL_ROW, SHAPES }
