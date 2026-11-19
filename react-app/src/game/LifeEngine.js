/**
 * 生命游戏（Conway's Game of Life）引擎 —— 纯逻辑，与 UI 解耦。
 *
 * 规则（B3/S23）：
 * - 活细胞周围有 2 或 3 个活邻居则存活，否则死亡；
 * - 死细胞周围恰好有 3 个活邻居则复活；
 * - 边界可切换「环绕」（上下左右相连）或「固定」（越界视为死）。
 *
 * 支持内置图案（滑翔机 / 闪烁灯 / 脉冲星 / 高斯帕滑翔机枪等）与 RLE 文本解析。
 * 状态机：start → playing ⇄ paused → over（全部细胞死亡或手动结束）
 */

export const LIFE = {
  ROWS: 24,
  COLS: 40,
  DEFAULT_PRESET: 'glider',
  DEFAULT_DENSITY: 0.28,
}

export const SPEEDS = {
  slow: { key: 'slow', label: '慢速', intervalMs: 1000, blurb: '1 代/秒' },
  normal: { key: 'normal', label: '常速', intervalMs: 400, blurb: '2.5 代/秒' },
  fast: { key: 'fast', label: '快速', intervalMs: 140, blurb: '约 7 代/秒' },
  turbo: { key: 'turbo', label: '极速', intervalMs: 60, blurb: '约 16 代/秒' },
}

export const SPEED_KEYS = ['slow', 'normal', 'fast', 'turbo']

export const PRESETS = {
  glider: {
    label: '滑翔机',
    blurb: '最小的飞船，4 代后整体斜移一格',
    rle: 'x = 3, y = 3\nbo$2bo$3o!',
  },
  blinker: {
    label: '闪烁灯',
    blurb: '三格横竖振荡，周期 2',
    rle: 'x = 3, y = 1\n3o!',
  },
  block: {
    label: '静物方块',
    blurb: '稳定不变，用来观察静物',
    rle: 'x = 2, y = 2\n2o$2o!',
  },
  pulsar: {
    label: '脉冲星',
    blurb: '48 格周期 3 振荡器',
    rle: 'x = 13, y = 13\n2b3o3b3o2b$13b$o4bobo4bo$o4bobo4bo$o4bobo4bo$2b3o3b3o2b$13b$2b3o3b3o2b$o4bobo4bo$o4bobo4bo$o4bobo4bo$13b$2b3o3b3o2b!',
  },
  gun: {
    label: '高斯帕滑翔机枪',
    blurb: '每 30 代发射一架滑翔机',
    rle: 'x = 36, y = 9\n24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4bobo$10bo5bo7bo$11bo3bo$12b2o!',
  },
  acorn: {
    label: '橡果',
    blurb: '7 格小图案，能演化上千代',
    rle: 'x = 7, y = 3\nbo$3bo$2o2b3o!',
  },
  rpentomino: {
    label: 'R 五连方',
    blurb: '5 格引发长时间混沌',
    rle: 'x = 3, y = 3\nb2o$2o$bo!',
  },
}

export const PRESET_KEYS = ['glider', 'blinker', 'block', 'pulsar', 'gun', 'acorn', 'rpentomino']

const at = (row, col, cols) => row * cols + col

/** 解析 RLE 文本；空图案返回 cells: []，语法错误抛 Error */
export function parseRLE(text) {
  const source = String(text || '').trim()
  if (!source) throw new Error('内容为空')
  let width = 0
  let height = 0
  let header = false
  let body = ''
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (!header) {
      const match = line.match(/^x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)/i)
      if (match) {
        width = Number(match[1])
        height = Number(match[2])
        header = true
        continue
      }
    }
    body += line
  }
  if (!header) throw new Error('缺少 x = N, y = N 头信息')
  if (!width || !height) throw new Error('图案尺寸不能为 0')
  if (!body) throw new Error('缺少图案内容')

  const cells = []
  let x = 0
  let y = 0
  let count = ''
  let closed = false
  for (const ch of body) {
    if (closed) break
    if (ch >= '0' && ch <= '9') {
      count += ch
      continue
    }
    const n = count ? Number(count) : 1
    count = ''
    if (!Number.isFinite(n) || n <= 0) throw new Error('重复次数必须为正整数')
    if (ch === 'b' || ch === '.') {
      x += n
    } else if (ch === 'o' || ch === 'O') {
      for (let i = 0; i < n; i++) {
        if (x + i >= width) throw new Error('图案超出声明的宽度')
        cells.push({ row: y, col: x + i })
      }
      x += n
    } else if (ch === '$') {
      y += n
      x = 0
    } else if (ch === '!') {
      closed = true
    } else {
      throw new Error(`无法识别的字符「${ch}」`)
    }
    if (y >= height) throw new Error('图案超出声明的高度')
  }
  return { width, height, cells }
}

export function createEmptyBoard(rows = LIFE.ROWS, cols = LIFE.COLS) {
  return new Uint8Array(rows * cols)
}

export function populationOf(board) {
  let count = 0
  for (let i = 0; i < board.length; i++) if (board[i]) count += 1
  return count
}

/** 计算指定格子的活邻居数；wrap=true 时上下左右与对角都环绕 */
export function countNeighbors(board, rows, cols, index, wrap) {
  const row = Math.floor(index / cols)
  const col = index % cols
  let count = 0
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      let r = row + dr
      let c = col + dc
      if (wrap) {
        r = (r + rows) % rows
        c = (c + cols) % cols
      } else if (r < 0 || r >= rows || c < 0 || c >= cols) {
        continue
      }
      count += board[at(r, c, cols)] ? 1 : 0
    }
  }
  return count
}

/** 演化一代，返回新棋盘 */
export function stepBoard(board, rows, cols, wrap) {
  const next = new Uint8Array(rows * cols)
  for (let i = 0; i < next.length; i++) {
    const neighbors = countNeighbors(board, rows, cols, i, wrap)
    if (board[i]) next[i] = neighbors === 2 || neighbors === 3 ? 1 : 0
    else next[i] = neighbors === 3 ? 1 : 0
  }
  return next
}

export class LifeEngine {
  /**
   * @param {Object} cb { onState, onGameOver, onPause }
   * @param {Object} options { random }
   */
  constructor(cb = {}, options = {}) {
    this.cb = cb
    this.random = options.random || Math.random

    this.state = 'start'
    this.rows = LIFE.ROWS
    this.cols = LIFE.COLS
    this.board = new Uint8Array(0)
    this.presetKey = LIFE.DEFAULT_PRESET
    this.imported = false
    this.speed = 'normal'
    this.wrap = true

    this.generation = 0
    this.population = 0
    this.maxPopulation = 0
    this.lastBirths = 0
    this.lastDeaths = 0
    this.totalBirths = 0
    this.totalDeaths = 0

    this.started = false
    this.startedAt = 0
    this.elapsedBase = 0
    this.resumeAt = 0
    this.clockRunning = false
  }

  /** 开始新一局：载入内置图案并开始演化 */
  start(presetKey = LIFE.DEFAULT_PRESET, opts = {}) {
    const key = presetKey in PRESETS ? presetKey : LIFE.DEFAULT_PRESET
    this.rows = LIFE.ROWS
    this.cols = LIFE.COLS
    this.speed = opts.speed in SPEEDS ? opts.speed : 'normal'
    this.wrap = opts.wrap !== false
    this._placePreset(key, false)
    this.generation = 0
    this.totalBirths = 0
    this.totalDeaths = 0
    this.state = 'playing'
    this.started = true
    this.startedAt = Date.now()
    this.elapsedBase = 0
    this.resumeAt = Date.now()
    this.clockRunning = true
    this._emit()
    return this.getSnapshot()
  }

  /** 载入内置图案（重置代数为 0，保持当前 playing / paused 状态） */
  loadPreset(key) {
    if (!(key in PRESETS)) return false
    return this._placePreset(key)
  }

  _placePreset(key, emit = true) {
    const parsed = parseRLE(PRESETS[key].rle)
    this.board = this._centerCells(parsed.cells)
    this.presetKey = key
    this.imported = false
    this.generation = 0
    this.lastBirths = 0
    this.lastDeaths = 0
    this.totalBirths = 0
    this.totalDeaths = 0
    this.population = populationOf(this.board)
    this.maxPopulation = this.population
    if (emit && this.state !== 'start') this._emit()
    return true
  }

  /** 载入自定义 RLE 解析后的细胞（会校验是否超出网格） */
  loadCells(cells) {
    if (!Array.isArray(cells) || cells.length === 0) return { ok: false, reason: '图案为空' }
    const maxRow = Math.max(...cells.map((c) => c.row))
    const maxCol = Math.max(...cells.map((c) => c.col))
    if (maxRow >= this.rows || maxCol >= this.cols) {
      return { ok: false, reason: `图案 ${maxCol + 1}×${maxRow + 1} 超出棋盘 ${this.cols}×${this.rows}` }
    }
    this.board = this._centerCells(cells)
    this.presetKey = ''
    this.imported = true
    this.generation = 0
    this.lastBirths = 0
    this.lastDeaths = 0
    this.totalBirths = 0
    this.totalDeaths = 0
    this.population = populationOf(this.board)
    this.maxPopulation = this.population
    if (this.state !== 'start') this._emit()
    return { ok: true, population: this.population }
  }

  _centerCells(cells) {
    const board = createEmptyBoard(this.rows, this.cols)
    if (!cells.length) return board
    const maxRow = Math.max(...cells.map((c) => c.row))
    const maxCol = Math.max(...cells.map((c) => c.col))
    const offsetRow = Math.max(0, Math.floor((this.rows - (maxRow + 1)) / 2))
    const offsetCol = Math.max(0, Math.floor((this.cols - (maxCol + 1)) / 2))
    for (const { row, col } of cells) {
      const r = row + offsetRow
      const c = col + offsetCol
      if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) board[at(r, c, this.cols)] = 1
    }
    return board
  }

  /** 手动演化一代；playing 与 paused 都可单步 */
  step() {
    if (this.state !== 'playing' && this.state !== 'paused') return false
    const next = stepBoard(this.board, this.rows, this.cols, this.wrap)
    let births = 0
    let deaths = 0
    for (let i = 0; i < next.length; i++) {
      if (!this.board[i] && next[i]) births += 1
      else if (this.board[i] && !next[i]) deaths += 1
    }
    this.board = next
    this.generation += 1
    this.lastBirths = births
    this.lastDeaths = deaths
    this.totalBirths += births
    this.totalDeaths += deaths
    this.population = populationOf(this.board)
    this.maxPopulation = Math.max(this.maxPopulation, this.population)
    if (this.population === 0) {
      this._finish('extinct')
      return true
    }
    this._emit()
    return true
  }

  tick() {
    if (this.state !== 'playing') return
    this.step()
  }

  /** 点击切换单个细胞（建议页面先暂停） */
  toggleCell(index) {
    if (this.state !== 'playing' && this.state !== 'paused') return null
    if (!Number.isInteger(index) || index < 0 || index >= this.board.length) return null
    this.board[index] = this.board[index] ? 0 : 1
    this.population = populationOf(this.board)
    this.maxPopulation = Math.max(this.maxPopulation, this.population)
    this._emit()
    return this.board[index]
  }

  clear() {
    if (this.state === 'start' || this.state === 'over') return false
    this.board = createEmptyBoard(this.rows, this.cols)
    this.generation = 0
    this.lastBirths = 0
    this.lastDeaths = 0
    this.totalBirths = 0
    this.totalDeaths = 0
    this.population = 0
    this.maxPopulation = 0
    this.presetKey = ''
    this.imported = false
    this._emit()
    return true
  }

  randomize(density = LIFE.DEFAULT_DENSITY) {
    if (this.state === 'start') return false
    const board = createEmptyBoard(this.rows, this.cols)
    for (let i = 0; i < board.length; i++) board[i] = this.random() < density ? 1 : 0
    this.board = board
    this.generation = 0
    this.lastBirths = 0
    this.lastDeaths = 0
    this.totalBirths = 0
    this.totalDeaths = 0
    this.population = populationOf(board)
    this.maxPopulation = this.population
    this.presetKey = ''
    this.imported = false
    this._emit()
    return true
  }

  setSpeed(key) {
    if (!(key in SPEEDS)) return false
    this.speed = key
    this._emit()
    return true
  }

  setWrap(wrap) {
    this.wrap = Boolean(wrap)
    this._emit()
    return true
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

  /** 手动结束观察：进入 over 并带回最终统计 */
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
    this.state = 'over'
    this._emit()
    this.cb.onGameOver?.({
      result,
      generation: this.generation,
      population: this.population,
      maxPopulation: this.maxPopulation,
      totalBirths: this.totalBirths,
      totalDeaths: this.totalDeaths,
      speed: this.speed,
      wrap: this.wrap,
      presetKey: this.presetKey,
      imported: this.imported,
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
      rows: this.rows,
      cols: this.cols,
      board: this.board.length ? Array.from(this.board) : [],
      presetKey: this.presetKey,
      imported: this.imported,
      speed: this.speed,
      wrap: this.wrap,
      generation: this.generation,
      population: this.population,
      maxPopulation: this.maxPopulation,
      lastBirths: this.lastBirths,
      lastDeaths: this.lastDeaths,
      totalBirths: this.totalBirths,
      totalDeaths: this.totalDeaths,
      elapsed: this._elapsed(),
    }
  }
}
