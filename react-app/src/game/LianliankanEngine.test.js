/**
 * LianliankanEngine 单元测试（node:test，零依赖）
 * 覆盖：牌面生成、≤2 转弯连通（直连/一转弯/两转弯/绕边界/阻断）、选中与误点、消除与通关、提示与洗牌、暂停、超时、计分。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { LianliankanEngine, DIFFICULTY, LIANLIANKAN } from './LianliankanEngine.js'

/** 构造一个只含空位的棋盘引擎（用于连通性测试） */
function boardEngine(rows, cols) {
  const engine = new LianliankanEngine()
  engine.rows = rows
  engine.cols = cols
  engine.tiles = new Array(rows * cols).fill(null)
  engine.state = 'playing'
  engine.totalPairs = 0
  engine.clearedPairs = 0
  return engine
}

/** 构造一个完整成对棋盘：第 i 对占 2i / 2i+1 两个相邻格 */
function pairedEngine(rows, cols) {
  const engine = new LianliankanEngine()
  engine.rows = rows
  engine.cols = cols
  engine.tiles = []
  const pairs = (rows * cols) / 2
  for (let i = 0; i < pairs; i++) engine.tiles.push(i, i)
  engine.state = 'playing'
  engine.totalPairs = pairs
  engine.clearedPairs = 0
  engine.started = false
  engine.hintsLeft = LIANLIANKAN.HINT_LIMIT
  engine.shufflesLeft = LIANLIANKAN.SHUFFLE_LIMIT
  return engine
}

test('开局：牌面数量与成对性正确，且必然存在可消除对', () => {
  const engine = new LianliankanEngine()
  engine.start('normal')
  assert.equal(engine.rows, 7)
  assert.equal(engine.cols, 6)
  assert.equal(engine.tiles.length, 42)
  assert.equal(engine.totalPairs, 21)

  const counts = new Map()
  for (const s of engine.tiles) counts.set(s, (counts.get(s) || 0) + 1)
  for (const [sym, n] of counts) assert.equal(n % 2, 0, `图案 ${sym} 数量应为偶数，实际 ${n}`)
  assert.ok(engine._findAnyPair(), '开局应存在至少一组可消除对')
})

test('连通：同一行直线可连，相邻也可连', () => {
  const e = boardEngine(4, 4)
  e.tiles[0] = 1
  e.tiles[3] = 1
  assert.equal(e._findPath(0, 3), true)
  assert.equal(e._findPath(0, 1), false, '图案不同不可连')

  e.tiles[1] = 1
  assert.equal(e._findPath(0, 1), true)
})

test('连通：一转弯路径成立，被完全围住的两张牌不可连', () => {
  const e = boardEngine(5, 5)
  e.tiles[0] = 1
  e.tiles[12] = 1 // (2,2)，经 (0,2) 或 (2,0) 一转弯可达
  assert.equal(e._findPath(0, 12), true)

  // 整盘填满，仅中心 (2,2) 与 (2,4) 同图案：四周无空位且够不到外圈 → 不可连
  const blocked = boardEngine(5, 5)
  blocked.tiles = new Array(25).fill(9)
  blocked.tiles[12] = 1
  blocked.tiles[14] = 1
  assert.equal(blocked._findPath(12, 14), false)
})

test('连通：需要两次转弯（中间列绕行）时可连', () => {
  const e = boardEngine(5, 5)
  e.tiles[4] = 2 // (0,4)
  e.tiles[20] = 2 // (4,0)
  e.tiles[0] = 3 // 堵住 (0,0) 转弯点
  e.tiles[24] = 3 // 堵住 (4,4) 转弯点
  assert.equal(e._findPath(4, 20), true, '应可经 (0,2)/(2,0) 两转弯连通')
})

test('连通：可绕出棋盘边界（同行被完全堵住时）', () => {
  const e = boardEngine(6, 6)
  e.tiles[0] = 4
  e.tiles[5] = 4
  for (let c = 1; c < 5; c++) e.tiles[c] = 5
  assert.equal(e._findPath(0, 5), true, '从棋盘上方外圈绕行应可连')
})

test('选中：不同图案切换不惩罚，同图案不可连记误点并取消选中', () => {
  const e = pairedEngine(4, 4)
  assert.equal(e.select(0), true)
  assert.equal(e.selected, 0)
  assert.equal(e.select(9), true)
  assert.equal(e.selected, 9)
  assert.equal(e.wrongTaps, 0, '切换图案不记误点')

  const blocked = boardEngine(5, 5)
  blocked.tiles = new Array(25).fill(7)
  blocked.tiles[12] = 1
  blocked.tiles[14] = 1
  assert.equal(blocked.select(12), true)
  assert.equal(blocked.select(14), false)
  assert.equal(blocked.wrongTaps, 1)
  assert.equal(blocked.selected, null)
})

test('消除：相邻同图案两张牌被移除，剩余对数递减', () => {
  const e = pairedEngine(4, 4)
  e.select(0)
  e.select(1)
  assert.equal(e.tiles[0], null)
  assert.equal(e.tiles[1], null)
  assert.equal(e.clearedPairs, 1)
  assert.equal(e.getSnapshot().remainingPairs, 7)
  assert.equal(e.lastAction, 'clear')
})

test('通关：全部消除后进入 over 并按公式计分', () => {
  const e = pairedEngine(4, 4)
  for (let i = 0; i < 8; i++) {
    e.select(i * 2)
    e.select(i * 2 + 1)
  }
  assert.equal(e.state, 'over')
  assert.equal(e.clearedPairs, 8)
  assert.ok(e._score() >= 100)
  assert.equal(e.getSnapshot().score, e._score())
})

test('提示：返回可连通的一对并消耗次数，次数用尽后返回 null', () => {
  const e = pairedEngine(4, 4)
  e.hintsLeft = 1
  const pair = e.hint()
  assert.ok(pair && e._findPath(pair.a, pair.b))
  assert.equal(e.hintsLeft, 0)
  assert.equal(e.hint(), null)
})

test('洗牌：保持牌面多重集不变，且洗牌后存在可消除对', () => {
  const e = new LianliankanEngine()
  e.start('normal')
  const before = e.tiles.filter(Boolean).sort((a, b) => a - b).join(',')

  e._shuffleBoard()
  const after = e.tiles.filter(Boolean).sort((a, b) => a - b).join(',')
  assert.equal(before, after, '洗牌不改变牌面组成')
  assert.ok(e._findAnyPair(), '洗牌后必须存在可消除对')
})

test('洗牌次数：手动洗牌消耗次数，用尽后返回 false', () => {
  const e = pairedEngine(4, 4)
  e.shufflesLeft = 1
  assert.equal(e.shuffle(), true)
  assert.equal(e.shufflesLeft, 0)
  assert.equal(e.shuffle(), false)
})

test('暂停冻结计时，恢复后只累加新时段', () => {
  const realNow = Date.now
  let clock = 0
  Date.now = () => clock
  try {
    const e = pairedEngine(4, 4)
    e.select(0) // 首次点按启动计时
    clock = 10000
    e.pause()
    assert.ok(Math.abs(e._elapsed() - 10) < 0.2)
    clock = 40000
    assert.ok(Math.abs(e._elapsed() - 10) < 0.2, '暂停期间不计时')
    e.resume()
    clock = 45000
    assert.ok(Math.abs(e._elapsed() - 15) < 0.2)
  } finally {
    Date.now = realNow
  }
})

test('超时：tick 检测到限时耗尽后进入 failed，剩余时间不为负', () => {
  const realNow = Date.now
  let clock = 0
  Date.now = () => clock
  try {
    let over = null
    const e = new LianliankanEngine({ onGameOver: (score, elapsed, result) => (over = { score, elapsed, result }) })
    e.start('hard')
    e.select(0)
    clock = (DIFFICULTY.hard.limitSec + 3) * 1000
    e.tick()
    assert.equal(e.state, 'failed')
    assert.deepEqual(over, { score: 0, elapsed: over.elapsed, result: 'timeout' })
    assert.equal(e.getSnapshot().remaining, 0)
    assert.equal(e.getSnapshot().score, null)
  } finally {
    Date.now = realNow
  }
})

test('计分封底 100，误点与用时都会扣分', () => {
  const e = pairedEngine(4, 4)
  e.state = 'over'
  e.level = 'easy'
  e._cfg = DIFFICULTY.easy
  e.wrongTaps = 100
  e.elapsedBase = 400000
  assert.equal(e._score(), 100)
})

test('非法点按被忽略：越界、空位、暂停态', () => {
  const e = pairedEngine(4, 4)
  assert.equal(e.select(-1), false)
  assert.equal(e.select(99), false)
  e.tiles[2] = null
  assert.equal(e.select(2), false)
  e.pause()
  assert.equal(e.select(0), false)
  assert.equal(e.selected, null)
})
