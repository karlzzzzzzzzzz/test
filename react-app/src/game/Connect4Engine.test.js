/**
 * Connect4Engine 单元测试（node:test，零依赖）
 * 覆盖：落子重力、成四判定（横/竖/双斜）、胜负与计分、电脑堵三连、回合流转、
 * 暂停冻结、超时、满列/非法列、平局收尾。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Connect4Engine, DIFFICULTY, CONNECT4 } from './Connect4Engine.js'

const { PLAYER, AI, COLS, ROWS } = CONNECT4
const bottom = (col) => (ROWS - 1) * COLS + col

function makeEngine(level = 'normal', options = {}) {
  const engine = new Connect4Engine({}, { random: () => 0.5, ...options })
  engine.start(level)
  return engine
}

function fill(cells, idxs, who) {
  for (const i of idxs) cells[i] = who
}

test('落子重力：棋子落到该列最底部，再落一子叠在上一层', () => {
  const engine = makeEngine('easy')
  assert.equal(engine.drop(0), true)
  assert.equal(engine.cells[bottom(0)], PLAYER)
  assert.equal(engine._lowestEmpty(0), bottom(0) - COLS)

  // 让电脑在同一列再落一子，验证堆叠
  engine.turn = 'ai'
  engine.lastAction = 'ai'
  const before = engine.cells.slice()
  engine._place(engine._lowestEmpty(0), AI)
  assert.equal(engine.cells[bottom(0) - COLS], AI)
  assert.deepEqual(before.slice(bottom(0)), engine.cells.slice(bottom(0)))
})

test('成四判定：横向、纵向、主对角线、副对角线均识别', () => {
  const cases = [
    [bottom(0), bottom(1), bottom(2), bottom(3)],
    [COLS * 3, COLS * 4, COLS * 5, bottom(0)],
    [COLS * 3, COLS * 4 + 1, COLS * 5 + 2, bottom(3)],
    [COLS * 3 + 3, COLS * 4 + 2, COLS * 5 + 1, bottom(0)],
  ]
  const engine = makeEngine('easy')
  for (const idxs of cases) {
    engine.cells = new Array(ROWS * COLS).fill(0)
    fill(engine.cells, idxs, AI)
    assert.deepEqual(engine._lineFrom(engine.cells, idxs[3], AI), idxs.slice().sort((a, b) => a - b))
  }
})

test('玩家落子成四：立即结束并结算分数', () => {
  const engine = makeEngine('normal')
  engine.cells = new Array(ROWS * COLS).fill(0)
  fill(engine.cells, [bottom(0), bottom(1), bottom(2)], PLAYER)
  engine.turn = 'player'
  engine.started = false
  assert.equal(engine.drop(3), true)
  assert.equal(engine.state, 'over')
  assert.equal(engine.result, 'win')
  assert.deepEqual(engine.winningLine, [bottom(0), bottom(1), bottom(2), bottom(3)])
  assert.ok(engine._score() >= 100)
})

test('电脑一步成四：优先取胜，结算为 lose 且不计分', () => {
  const engine = makeEngine('hard')
  engine.cells = new Array(ROWS * COLS).fill(0)
  fill(engine.cells, [bottom(0), bottom(1), bottom(2)], AI)
  engine.turn = 'ai'
  engine.moves = 3
  const col = engine.aiTurn()
  assert.equal(col, 3)
  assert.equal(engine.state, 'over')
  assert.equal(engine.result, 'lose')
  assert.equal(engine.getSnapshot().score, null)
})

test('电脑堵三连：普通难度优先封堵玩家即将成四的列', () => {
  const engine = makeEngine('normal')
  engine.cells = new Array(ROWS * COLS).fill(0)
  fill(engine.cells, [bottom(0), bottom(1), bottom(2)], PLAYER)
  engine.turn = 'ai'
  assert.equal(engine.aiTurn(), 3)
  assert.equal(engine.result, null)
  assert.equal(engine.cells[bottom(3)], AI)
  assert.equal(engine.turn, 'player')
})

test('回合流转：玩家落子后轮到电脑，电脑落子后回到玩家', () => {
  const engine = makeEngine('normal')
  assert.equal(engine.drop(2), true)
  assert.equal(engine.turn, 'ai')
  assert.equal(engine.drop(2), false, '电脑回合玩家不能再落子')
  const col = engine.aiTurn()
  assert.ok(col >= 0 && col < COLS, `电脑应落在合法列，实际 ${col}`)
  assert.equal(engine.turn, 'player')
  assert.equal(engine.moves, 2)
})

test('非法列与满列：一律忽略且不增加步数', () => {
  const engine = makeEngine('easy')
  assert.equal(engine.drop(-1), false)
  assert.equal(engine.drop(COLS), false)
  assert.equal(engine.drop(1.5), false)
  assert.equal(engine.moves, 0)

  for (let r = 0; r < ROWS; r++) engine.cells[r * COLS + 0] = AI
  assert.equal(engine.drop(0), false)
  assert.equal(engine.moves, 0)
})

test('暂停：电脑回合暂停后调用 aiTurn 被忽略，恢复后仍等待电脑落子', () => {
  const engine = makeEngine('normal')
  engine.drop(2)
  assert.equal(engine.turn, 'ai')
  engine.pause()
  assert.equal(engine.aiTurn(), -1)
  assert.equal(engine.moves, 1)
  engine.resume()
  assert.equal(engine.state, 'playing')
  assert.equal(engine.turn, 'ai')
})

test('暂停冻结计时，恢复后只累加新时段', () => {
  const realNow = Date.now
  let clock = 0
  Date.now = () => clock
  try {
    const engine = makeEngine('easy')
    engine.drop(0)
    clock = 10000
    engine.pause()
    assert.ok(Math.abs(engine._elapsed() - 10) < 0.2, `暂停时应为 10s，实际 ${engine._elapsed()}`)
    clock = 40000
    assert.ok(Math.abs(engine._elapsed() - 10) < 0.2, '暂停期间计时不应增长')
    engine.resume()
    clock = 45000
    assert.ok(Math.abs(engine._elapsed() - 15) < 0.2, `恢复 5s 后应为 15s，实际 ${engine._elapsed()}`)
  } finally {
    Date.now = realNow
  }
})

test('超时：倒计时归零进入 over/timeout，剩余为 0 且不计分', () => {
  const realNow = Date.now
  let clock = 0
  Date.now = () => clock
  try {
    let over = null
    const engine = new Connect4Engine({ onGameOver: (score, elapsed, result) => { over = { score, elapsed, result } } })
    engine.start('normal')
    engine.drop(0)
    clock = (DIFFICULTY.normal.limitSec + 5) * 1000
    engine.tick()
    assert.equal(engine.state, 'over')
    assert.equal(engine.result, 'timeout')
    assert.equal(engine.getSnapshot().remaining, 0)
    assert.equal(over.result, 'timeout')
    assert.equal(over.score, 0)
  } finally {
    Date.now = realNow
  }
})

test('计分：步数与用时扣分后封底 100', () => {
  const engine = makeEngine('easy')
  engine.moves = 20
  engine.elapsedBase = 30000 // 30s
  engine.state = 'over'
  const expected = DIFFICULTY.easy.baseScore - 20 * CONNECT4.MOVE_PENALTY - 30 * CONNECT4.SEC_PENALTY
  assert.equal(engine._score(), Math.max(CONNECT4.MIN_SCORE, expected))

  engine.moves = 200
  engine.elapsedBase = 600000
  assert.equal(engine._score(), CONNECT4.MIN_SCORE)
})

test('平局收尾：满盘无四连时结果 draw 且不计分', () => {
  const engine = makeEngine('easy')
  engine._finish('draw')
  assert.equal(engine.state, 'over')
  assert.equal(engine.result, 'draw')
  const snap = engine.getSnapshot()
  assert.equal(snap.score, null)
  assert.equal(snap.remaining >= 0, true)
})

test('开局重置：重新 start 清空棋盘、回合与计时', () => {
  const engine = makeEngine('hard')
  engine.drop(1)
  engine.aiTurn()
  engine.start('easy')
  assert.equal(engine.moves, 0)
  assert.equal(engine.turn, 'player')
  assert.equal(engine.cells.some(Boolean), false)
  assert.equal(engine.state, 'playing')
  assert.equal(engine.level, 'easy')
})
