/**
 * 2048 游戏引擎（纯逻辑，与 UI 解耦）
 * 参考 SpaceShooter.js 的「页面壳 + 引擎 + 回调」架构。
 *
 * 棋盘表示：4×4 二维数组 board[row][col]，0 表示空格，非零为方块数值。
 * 渲染：UI 层根据 board 矩阵 + meta 标记自行渲染方块；引擎只算逻辑。
 *
 * 持久化：localStorage 键 game-2048-state，结构
 *   { v:1, board, score, bestScore, undosLeft, history:[{board,score,undosLeft}]≤5, won:boolean, ts }
 * 写入策略：脏标记 + 延迟写入（参照基线番茄钟 3.3 模式），
 *   在 move / reset / undo / pause / dispose / pagehide 时统一落盘。
 */

const SIZE = 4
const STORAGE_KEY = 'game-2048-state'
const SCHEMA_VERSION = 1
const MAX_HISTORY = 5
const INITIAL_UNDOS = 3
const WIN_VALUE = 2048
const PERSIST_DEBOUNCE_MS = 1000
const TILE_SPAWN_PROB_4 = 0.1 // 数字 4 的生成概率 10%，其余 90% 为 2

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function createEmptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0))
}

function cloneBoard(board) {
  return board.map((row) => row.slice())
}

function findEmptyCells(board) {
  const cells = []
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === 0) cells.push({ r, c })
    }
  }
  return cells
}

function spawnRandom(board) {
  const empties = findEmptyCells(board)
  if (empties.length === 0) return null
  const { r, c } = empties[Math.floor(Math.random() * empties.length)]
  const value = Math.random() < TILE_SPAWN_PROB_4 ? 4 : 2
  board[r][c] = value
  return { r, c, value, isNew: true }
}

/**
 * 将一行向左压缩并合并，返回：
 *   - 新行（长度 SIZE，含 0 填充）
 *   - 本行合并产生的得分增量
 *   - 合并位置标记数组（用于 UI pop 动画），mergedCols[i] = true 表示位置 i 是合并产生的新方块
 *   - 是否发生了移动（含位置变化或合并）
 */
function compressLeft(row) {
  const filtered = row.filter((v) => v !== 0)
  const mergedCols = new Array(SIZE).fill(false)
  const result = []
  let scoreGain = 0
  let i = 0
  while (i < filtered.length) {
    if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
      const merged = filtered[i] * 2
      result.push(merged)
      mergedCols[result.length - 1] = true
      scoreGain += merged
      i += 2
    } else {
      result.push(filtered[i])
      i += 1
    }
  }
  while (result.length < SIZE) result.push(0)
  const moved = row.some((v, idx) => v !== result[idx])
  return { row: result, scoreGain, mergedCols, moved }
}

function rotateBoardCW(board) {
  const next = createEmptyBoard()
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      next[c][SIZE - 1 - r] = board[r][c]
    }
  }
  return next
}

function rotateBoardCCW(board) {
  const next = createEmptyBoard()
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      next[SIZE - 1 - c][r] = board[r][c]
    }
  }
  return next
}

// 通用滑动：对每一行应用 compressLeft，旋转预处理 + 后处理还原
function moveBoard(board, dir) {
  // 统一旋转到「向左」处理
  // left  : 0 次 CW
  // up    : 1 次 CCW → 处理 → 1 次 CW 还原
  // right : 2 次 CW → 处理 → 2 次 CCW 还原（即 reverse）
  // down  : 1 次 CW  → 处理 → 1 次 CCW 还原
  let work = cloneBoard(board)
  if (dir === 'up') work = rotateBoardCCW(work)
  else if (dir === 'right') work = work.map((r) => r.slice().reverse())
  else if (dir === 'down') work = rotateBoardCW(work)
  // dir === 'left' 不处理

  const newBoard = []
  const mergedColsByRow = []
  let totalGain = 0
  let anyMoved = false
  for (let r = 0; r < SIZE; r++) {
    const { row, scoreGain, mergedCols, moved } = compressLeft(work[r])
    newBoard.push(row)
    mergedColsByRow.push(mergedCols)
    totalGain += scoreGain
    if (moved) anyMoved = true
  }

  // 还原旋转
  let restored = newBoard
  let restoredMerged = mergedColsByRow
  if (dir === 'up') {
    restored = rotateBoardCW(newBoard)
    restoredMerged = rotateMergedCW(mergedColsByRow)
  } else if (dir === 'right') {
    restored = newBoard.map((r) => r.slice().reverse())
    restoredMerged = mergedColsByRow.map((r) => r.slice().reverse())
  } else if (dir === 'down') {
    restored = rotateBoardCCW(newBoard)
    restoredMerged = rotateMergedCCW(mergedColsByRow)
  }

  return { board: restored, merged: restoredMerged, scoreGain: totalGain, moved: anyMoved }
}

function rotateMergedCW(merged) {
  const next = createEmptyBoard().map(() => new Array(SIZE).fill(false))
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      next[c][SIZE - 1 - r] = merged[r][c]
    }
  }
  return next
}

function rotateMergedCCW(merged) {
  const next = createEmptyBoard().map(() => new Array(SIZE).fill(false))
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      next[SIZE - 1 - c][r] = merged[r][c]
    }
  }
  return next
}

function hasWon(board) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] >= WIN_VALUE) return true
    }
  }
  return false
}

function hasAnyMove(board) {
  // 有空格 → 可移动
  if (findEmptyCells(board).length > 0) return true
  // 相邻同值 → 可合并
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = board[r][c]
      if (c + 1 < SIZE && board[r][c + 1] === v) return true
      if (r + 1 < SIZE && board[r + 1][c] === v) return true
    }
  }
  return false
}

function buildSnapshot(board, score, undosLeft, history, won) {
  return {
    v: SCHEMA_VERSION,
    board: cloneBoard(board),
    score,
    bestScore: 0, // 由外部 bestScore 覆盖
    undosLeft,
    history: history.slice(-MAX_HISTORY),
    won,
    ts: Date.now(),
  }
}

export class Game2048 {
  constructor(callbacks = {}) {
    this.callbacks = callbacks
    this.board = createEmptyBoard()
    this.score = 0
    this.bestScore = 0
    this.undosLeft = INITIAL_UNDOS
    this.history = []
    this.won = false
    this.state = 'idle' // idle | playing | paused | over | win
    this.dirty = false
    this.persistTimer = null
    this.persistAvailable = this._detectStorage()
    this.lastSpawn = null // { r, c, value, isNew } 最近一次新生成的方块
    this.lastMerged = null // 二维布尔矩阵：最近一次合并位置
    this._stateDirty = false
  }

  _detectStorage() {
    try {
      const probe = '__g2048_probe__'
      localStorage.setItem(probe, '1')
      localStorage.removeItem(probe)
      return true
    } catch {
      return false
    }
  }

  _emitState() {
    if (typeof this.callbacks.onState !== 'function') return
    this.callbacks.onState({
      board: cloneBoard(this.board),
      score: this.score,
      bestScore: this.bestScore,
      undosLeft: this.undosLeft,
      state: this.state,
      lastSpawn: this.lastSpawn,
      lastMerged: this.lastMerged
        ? this.lastMerged.map((row) => row.slice())
        : null,
      won: this.won,
    })
  }

  _emitScore() {
    this.callbacks.onScore?.(this.score)
  }

  _emitBest() {
    this.callbacks.onBest?.(this.bestScore)
  }

  _emitUndos() {
    this.callbacks.onUndos?.(this.undosLeft)
  }

  _emitWin() {
    this.callbacks.onWin?.(this.score)
  }

  _emitGameOver() {
    this.callbacks.onGameOver?.(this.score)
  }

  _emitPause() {
    this.callbacks.onPause?.()
  }

  _markDirty() {
    this.dirty = true
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => this.persist(), PERSIST_DEBOUNCE_MS)
  }

  _applyBestFromStorage() {
    if (!this.persistAvailable) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data = JSON.parse(raw)
      if (data && typeof data.bestScore === 'number') {
        this.bestScore = Math.max(0, Math.floor(data.bestScore))
      }
    } catch {
      // 忽略，保持 bestScore=0
    }
  }

  /**
   * 开局或从 localStorage 恢复
   */
  start() {
    this._applyBestFromStorage()
    const restored = this._tryRestore()
    if (restored) {
      this.state = 'playing'
      this._emitState()
      return
    }
    this._newGame()
  }

  _newGame() {
    this.board = createEmptyBoard()
    this.score = 0
    this.undosLeft = INITIAL_UNDOS
    this.history = []
    this.won = false
    this.state = 'playing'
    this.lastSpawn = null
    this.lastMerged = null
    // 开局生成 2 个方块
    spawnRandom(this.board)
    spawnRandom(this.board)
    this._emitState()
    this._emitScore()
    this._emitUndos()
    this._markDirty()
  }

  reset() {
    this._newGame()
    this.persist()
  }

  _tryRestore() {
    if (!this.persistAvailable) return false
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      const data = JSON.parse(raw)
      if (!data || data.v !== SCHEMA_VERSION) {
        // 版本不符，清掉旧值，回退新开局
        localStorage.removeItem(STORAGE_KEY)
        return false
      }
      if (!Array.isArray(data.board) || data.board.length !== SIZE) return false
      // 校验 board 形状
      for (const row of data.board) {
        if (!Array.isArray(row) || row.length !== SIZE) return false
      }
      this.board = cloneBoard(data.board)
      this.score = Math.max(0, Math.floor(Number(data.score) || 0))
      this.bestScore = Math.max(this.bestScore, Math.floor(Number(data.bestScore) || 0))
      this.undosLeft = Math.max(0, Math.min(INITIAL_UNDOS, Math.floor(Number(data.undosLeft) || 0)))
      const history = Array.isArray(data.history) ? data.history : []
      this.history = history.slice(-MAX_HISTORY).map((s) => ({
        board: cloneBoard(s.board),
        score: Number(s.score) || 0,
        undosLeft: Number(s.undosLeft) || 0,
      }))
      this.won = !!data.won
      this.lastSpawn = null
      this.lastMerged = null
      return true
    } catch {
      return false
    }
  }

  /**
   * 执行滑动，dir ∈ 'up' | 'down' | 'left' | 'right'
   * 返回是否实际移动了方块（用于决定是否消耗撤销次数）
   */
  move(dir) {
    if (this.state !== 'playing') return false
    const snapshot = {
      board: cloneBoard(this.board),
      score: this.score,
      undosLeft: this.undosLeft,
    }
    const { board: newBoard, merged, scoreGain, moved } = moveBoard(this.board, dir)
    if (!moved) return false
    // 推入历史快照（用于撤销）
    this.history.push(snapshot)
    if (this.history.length > MAX_HISTORY) this.history.shift()
    this.board = newBoard
    this.lastMerged = merged
    this.score += scoreGain
    if (this.score > this.bestScore) {
      this.bestScore = this.score
      this._emitBest()
    }
    // 生成新方块
    this.lastSpawn = spawnRandom(this.board)
    // 检查胜利
    if (!this.won && hasWon(this.board)) {
      this.won = true
      this.state = 'win'
      this._emitState()
      this._emitScore()
      this._emitUndos()
      this._emitWin()
      this._markDirty()
      return true
    }
    // 检查游戏结束
    if (!hasAnyMove(this.board)) {
      this.state = 'over'
      this._emitState()
      this._emitScore()
      this._emitUndos()
      this._emitGameOver()
      this._markDirty()
      return true
    }
    this._emitState()
    this._emitScore()
    this._emitUndos()
    this._markDirty()
    return true
  }

  /**
   * 撤销上一步：恢复到最近一次快照
   */
  undo() {
    if (this.state !== 'playing' && this.state !== 'over' && this.state !== 'win') return false
    if (this.undosLeft <= 0) return false
    if (this.history.length === 0) return false
    const snapshot = this.history.pop()
    this.board = cloneBoard(snapshot.board)
    this.score = snapshot.score
    this.undosLeft = snapshot.undosLeft - 1
    // 撤销后重新评估状态：win/over 都回到 playing（玩家重新决策）
    this.state = 'playing'
    this.lastSpawn = null
    this.lastMerged = null
    this._emitState()
    this._emitScore()
    this._emitUndos()
    this._markDirty()
    return true
  }

  /**
   * 胜利遮罩点击「继续挑战」
   */
  continueAfterWin() {
    if (this.state !== 'win') return false
    this.state = 'playing'
    this._emitState()
    this._markDirty()
    return true
  }

  pause() {
    if (this.state !== 'playing') return false
    this.state = 'paused'
    this._emitState()
    this._emitPause()
    this.persist()
    return true
  }

  resume() {
    if (this.state !== 'paused') return false
    this.state = 'playing'
    this._emitState()
    return true
  }

  /**
   * 立即写入 localStorage。失败时通知 UI 降级（onPersistError）
   */
  persist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (!this.persistAvailable) {
      this.dirty = false
      this.callbacks.onPersistError?.('unavailable')
      return false
    }
    if (!this.dirty) return true
    const snapshot = buildSnapshot(
      this.board,
      this.score,
      this.undosLeft,
      this.history,
      this.won,
    )
    snapshot.bestScore = this.bestScore
    try {
      const json = JSON.stringify(snapshot)
      // 长度上限保护（参照基线简历页 mobile-layout-pref >200B 截断策略）
      if (json.length > 5000) {
        // 极端情况：丢弃 history 压缩
        snapshot.history = []
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
      } else {
        localStorage.setItem(STORAGE_KEY, json)
      }
      this.dirty = false
      return true
    } catch (e) {
      // QuotaExceededError：降级内存
      this.persistAvailable = false
      this.callbacks.onPersistError?.('quota')
      return false
    }
  }

  dispose() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.persist()
  }

  /** 静态工具：触摸操作启动累计次数写入 game-2048-touch-starts（每局 1 次，0~99999 封顶） */
  static bumpTouchStarts() {
    try {
      const KEY = 'game-2048-touch-starts'
      const cur = Math.max(0, Math.min(99999, Number(localStorage.getItem(KEY)) || 0))
      localStorage.setItem(KEY, String(Math.min(99999, cur + 1)))
    } catch {
      // 不可用时静默忽略
    }
  }

  /** 静态工具：读取触摸启动累计次数（用于 UI 展示） */
  static readTouchStarts() {
    try {
      return Math.max(0, Math.min(99999, Number(localStorage.getItem('game-2048-touch-starts')) || 0))
    } catch {
      return 0
    }
  }

  static isReducedMotion() {
    try {
      return window.matchMedia(REDUCED_MOTION).matches
    } catch {
      return false
    }
  }
}

export const GAME_2048_CONSTANTS = {
  SIZE,
  WIN_VALUE,
  INITIAL_UNDOS,
  STORAGE_KEY,
  SCHEMA_VERSION,
}
