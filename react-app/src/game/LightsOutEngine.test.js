/**
 * LightsOutEngine 单元测试（node:test，零依赖）
 * 通过可注入随机源 + Date.now 打桩，覆盖：翻转几何、胜利与计分、撤销、暂停、超时、打乱可解性。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { LightsOutEngine, DIFFICULTY, LIGHTS_OUT } from './LightsOutEngine.js'

/** 构造一个已开局引擎，并把棋盘重置为全灭（便于构造确定性场景） */
function makeEngine(level = 'easy') {
  const engine = new LightsOutEngine()
  engine.start(level)
  engine.lights = new Array(engine.rows * engine.cols).fill(false)
  engine.steps = 0
  engine.history = []
  engine.undoLeft = LIGHTS_OUT.UNDO_LIMIT
  return engine
}

const litIdx = (engine) => engine.lights.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)

test('翻转几何：4×4 中央格翻转自身与上下左右共 5 格', () => {
  const engine = makeEngine('easy')
  engine._flip(5) // r1c1
  assert.deepEqual(litIdx(engine), [1, 4, 5, 6, 9])
})

test('翻转几何：角格只翻转 3 格，顶边格翻转 4 格（越界不报错）', () => {
  const engine = makeEngine('easy')
  engine._flip(0)
  assert.deepEqual(litIdx(engine), [0, 1, 4])

  engine.lights = new Array(16).fill(false)
  engine._flip(1) // r0c1
  assert.deepEqual(litIdx(engine), [0, 1, 2, 5])
})

test('toggle：仅 playing 态生效，非法索引被忽略，步数逐次累加', () => {
  const engine = makeEngine('easy')
  assert.equal(engine.toggle(-1), false)
  assert.equal(engine.toggle(999), false)
  assert.equal(engine.toggle(1.5), false)
  assert.equal(engine.steps, 0)

  assert.equal(engine.toggle(0), true)
  assert.equal(engine.steps, 1)

  engine.pause()
  assert.equal(engine.toggle(0), false, '暂停态不应翻转')
  assert.equal(engine.steps, 1)
})

test('胜利判定：熄灭最后一盏灯立即进入 over 并计分', () => {
  const engine = makeEngine('easy')
  engine.steps = 0
  engine.toggle(5) // 点亮 5 格
  assert.equal(engine.state, 'playing')
  engine.toggle(5) // 再点一次回到全灭
  assert.equal(engine.state, 'over')
  assert.equal(engine.lights.some(Boolean), false)
  assert.ok(engine._score() >= 580 && engine._score() <= 600, `得分 ${engine._score()} 应接近基准 600`)
})

test('计分：超出 par 与用时都会扣分，且封底 100', () => {
  const engine = makeEngine('easy')
  engine.steps = 20
  engine.elapsedBase = 40000 // 40s
  engine.state = 'over'
  const expected = DIFFICULTY.easy.baseScore - (20 - 5) * LIGHTS_OUT.STEP_PENALTY - 40 * LIGHTS_OUT.SEC_PENALTY
  assert.equal(engine._score(), Math.max(100, expected))

  engine.steps = 500
  engine.elapsedBase = 600000
  assert.equal(engine._score(), 100)
})

test('撤销：回退灯态但不返还步数，每局最多 3 次', () => {
  const engine = makeEngine('easy')
  engine.toggle(0)
  assert.deepEqual(litIdx(engine), [0, 1, 4])
  assert.equal(engine.steps, 1)

  assert.equal(engine.undo(), true)
  assert.deepEqual(litIdx(engine), [])
  assert.equal(engine.steps, 1, '撤销不返还步数')

  // 再撤销两次用尽额度（每次需要先有一步可撤销）
  engine.toggle(2)
  assert.equal(engine.undo(), true)
  engine.toggle(3)
  assert.equal(engine.undo(), true)
  assert.equal(engine.undoLeft, 0)

  engine.toggle(6)
  assert.equal(engine.undo(), false, '额度用尽后撤销无效')
  assert.equal(engine.history.length, 1)
})

test('撤销：无历史时直接忽略', () => {
  const engine = makeEngine('easy')
  assert.equal(engine.undo(), false)
  assert.equal(engine.undoLeft, LIGHTS_OUT.UNDO_LIMIT)
})

test('暂停冻结计时，恢复后只累加新时段', () => {
  const realNow = Date.now
  let clock = 0
  Date.now = () => clock
  try {
    const engine = makeEngine('easy')
    engine.started = false
    engine.toggle(0) // 首格启动计时
    clock = 10000
    engine.pause()
    assert.ok(Math.abs(engine._elapsed() - 10) < 0.2, `暂停时应为 10s，实际 ${engine._elapsed()}`)

    clock = 40000 // 暂停 30s
    assert.ok(Math.abs(engine._elapsed() - 10) < 0.2, '暂停期间计时不应增长')

    engine.resume()
    clock = 45000
    assert.ok(Math.abs(engine._elapsed() - 15) < 0.2, `恢复 5s 后应为 15s，实际 ${engine._elapsed()}`)
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
    const engine = new LightsOutEngine({ onGameOver: (score, elapsed, result) => { over = { score, elapsed, result } } })
    engine.start('easy')
    engine.toggle(0) // 启动计时
    clock = (DIFFICULTY.easy.limitSec + 5) * 1000
    engine.tick()

    assert.equal(engine.state, 'failed')
    assert.deepEqual(over, { score: 0, elapsed: over.elapsed, result: 'timeout' })
    const snap = engine.getSnapshot()
    assert.equal(snap.remaining, 0)
    assert.equal(snap.score, null)
    assert.ok(over.elapsed >= DIFFICULTY.easy.limitSec)
  } finally {
    Date.now = realNow
  }
})

test('打乱必然可解：按打乱序列逆序回推可回到全灭', () => {
  // 固定随机源 → 打乱序列可预测：0,3,5,8,11（4×4 范围内互不相同）
  const seq = [0.05, 0.2, 0.35, 0.5, 0.7]
  const engine = new LightsOutEngine({}, { random: () => seq.shift() ?? 0.1 })
  engine.start('easy')
  assert.ok(engine.lights.some(Boolean), '打乱后不应全灭')

  for (const idx of [11, 8, 5, 3, 0]) engine._flip(idx)
  assert.equal(engine.lights.some(Boolean), false, '逆序回推应恢复到全灭')
})
