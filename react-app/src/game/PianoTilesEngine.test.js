/**
 * PianoTilesEngine 单测（node:test）
 * 覆盖：传送带间距不变量、命中 / 点错 / 漏点、速度曲线与上限、
 *       暂停冻结与恢复、手动结束、存档恢复校验、dt 上限、快照守卫。
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { PianoTilesEngine, PIANO, validateSave } from './PianoTilesEngine.js'

let savedRandom
beforeEach(() => {
  savedRandom = Math.random
})
afterEach(() => {
  Math.random = savedRandom
})

/** 固定黑块轨道：让 Math.floor(Math.random()*4) 恒为 lane */
function mockLane(lane) {
  Math.random = () => (lane + 0.5) / PIANO.LANES
}

/** 按 100ms 步进推进（引擎对单次 tick 有 100ms 上限） */
function advance(engine, ms) {
  let remaining = ms
  while (remaining > 0) {
    const step = Math.min(100, remaining)
    engine.tick(step)
    remaining -= step
    if (engine.state === 'over') break
  }
}

function makeEngine(cb = {}) {
  const engine = new PianoTilesEngine(cb)
  engine.start()
  return engine
}

/** 按 id 取某行当前 y（顶部会插入新行，rows[0] 不固定） */
function rowY(engine, id) {
  const r = engine.getSnapshot().rows.find((x) => x.id === id)
  return r ? r.y : null
}

/** 断言传送带：相邻行 y 差 1，首行不高于生成线 */
function assertConveyor(rows) {
  assert.ok(rows.length >= 1, '至少应有 1 行')
  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      Math.abs(rows[i].y - rows[i - 1].y - 1) < 1e-6,
      `行间距应为 1，实际 ${rows[i - 1].y}→${rows[i].y}`,
    )
  }
  assert.ok(rows[0].y <= PIANO.SPAWN_Y + 1e-6, `顶部行应不高于生成线，实际 ${rows[0].y}`)
}

describe('PianoTilesEngine — 常量与开局', () => {
  it('常量在合理区间', () => {
    assert.equal(PIANO.LANES, 4)
    assert.ok(PIANO.BASE_SPEED > 0 && PIANO.MAX_SPEED > PIANO.BASE_SPEED)
    assert.ok(PIANO.HIT_TOL > 0 && PIANO.MISS_Y > PIANO.JUDGE_Y)
  })

  it('开局为 playing、清零计数、速度为初速', () => {
    mockLane(0)
    const snap = makeEngine().getSnapshot()
    assert.equal(snap.state, 'playing')
    assert.equal(snap.score, 0)
    assert.equal(snap.combo, 0)
    assert.equal(snap.hits, 0)
    assert.equal(snap.speed, PIANO.BASE_SPEED)
    assert.equal(snap.overReason, '')
  })

  it('开局传送带从顶部铺到 VISIBLE-1.5，行间距恒为 1', () => {
    mockLane(0)
    const snap = makeEngine().getSnapshot()
    assertConveyor(snap.rows)
    assert.equal(snap.rows[0].y, PIANO.SPAWN_Y)
    assert.ok(Math.abs(snap.rows[snap.rows.length - 1].y - (PIANO.VISIBLE - 1.5)) < 1e-6)
  })

  it('所有行轨道都在 [0, LANES) 内', () => {
    mockLane(2)
    const snap = makeEngine().getSnapshot()
    for (const r of snap.rows) {
      assert.ok(Number.isInteger(r.lane) && r.lane >= 0 && r.lane < PIANO.LANES)
    }
  })
})

describe('PianoTilesEngine — 传送带不变量', () => {
  it('大量 tick 后行间距仍为 1 且顶部保持填充', () => {
    mockLane(1)
    const engine = makeEngine()
    advance(engine, 5000)
    if (engine.state !== 'over') {
      assertConveyor(engine.getSnapshot().rows)
    }
  })

  it('命中后行被标记但仍维持间距，数组不会无限增长', () => {
    mockLane(0)
    const engine = makeEngine()
    // 推进使最低行进入判定窗口，然后连续点中
    advance(engine, 400)
    for (let i = 0; i < 8; i++) {
      if (engine.state !== 'playing') break
      engine.tap(0)
      advance(engine, 450)
    }
    const rows = engine.getSnapshot().rows
    assertConveyor(rows)
    assert.ok(rows.length <= 12, `行数应受清理约束，实际 ${rows.length}`)
  })
})

describe('PianoTilesEngine — tick 与速度', () => {
  it('tick 按 speed*dt 推进 y（50ms @ 初速 = 0.1 行高，低于 dt 上限）', () => {
    mockLane(0)
    const engine = makeEngine()
    const id = engine.getSnapshot().rows[0].id
    const y0 = rowY(engine, id)
    engine.tick(50)
    const y1 = rowY(engine, id)
    assert.ok(y1 !== null, '跟踪的行应仍在场内')
    assert.ok(Math.abs(y1 - y0 - 0.1) < 1e-6, `应推进 0.1，实际 ${y1 - y0}`)
  })

  it('单次 tick dt 上限 100ms，超大步长不跳帧', () => {
    mockLane(0)
    const engine = makeEngine()
    const id = engine.getSnapshot().rows[0].id
    const y0 = rowY(engine, id)
    engine.tick(5000) // 应被截断为 100ms
    const y1 = rowY(engine, id)
    assert.ok(y1 !== null, '跟踪的行应仍在场内')
    assert.ok(Math.abs(y1 - y0 - 0.2) < 1e-6, `应只推进 0.2，实际 ${y1 - y0}`)
  })

  it('速度随命中数线性增长并受 MAX_SPEED 限制', () => {
    mockLane(0)
    const engine = makeEngine()
    assert.equal(engine.getSnapshot().speed, PIANO.BASE_SPEED)
    engine.hits = 10
    assert.equal(engine.getSnapshot().speed, PIANO.BASE_SPEED + 10 * PIANO.SPEED_GAIN)
    engine.hits = 100000
    assert.equal(engine.getSnapshot().speed, PIANO.MAX_SPEED)
  })

  it('非 playing 态 tick 不推进', () => {
    mockLane(0)
    const engine = makeEngine()
    engine.pause()
    const y0 = engine.getSnapshot().rows[0].y
    engine.tick(500)
    assert.equal(engine.getSnapshot().rows[0].y, y0)
  })
})

describe('PianoTilesEngine — 点按判定', () => {
  it('判定窗口外点按被忽略，不扣分不结束', () => {
    mockLane(0)
    const engine = makeEngine() // 最低行 y=2.5，窗口 [3.3,4.7]
    const result = engine.tap(0)
    assert.equal(result.ok, true)
    assert.equal(result.ignored, true)
    assert.equal(engine.getSnapshot().score, 0)
    assert.equal(engine.state, 'playing')
  })

  it('点中判定窗口内的黑块得分并累加连击', () => {
    mockLane(0)
    const engine = makeEngine()
    advance(engine, 400) // 最低行 y 2.5→3.3，进入窗口
    const r1 = engine.tap(0)
    assert.equal(r1.hit, true)
    assert.equal(r1.score, 1)
    const snap = engine.getSnapshot()
    assert.equal(snap.score, 1)
    assert.equal(snap.combo, 1)
    assert.equal(snap.hits, 1)
  })

  it('点到白块立即结束（wrong-tap），onGameOver 只触发一次', () => {
    mockLane(0)
    let calls = 0
    let last = null
    const engine = new PianoTilesEngine({
      onGameOver: (info) => {
        calls += 1
        last = info
      },
    })
    engine.start()
    advance(engine, 400) // 最低行黑块在 0 轨道
    const result = engine.tap(1) // 点白块
    assert.equal(result.fail, true)
    assert.equal(engine.state, 'over')
    assert.equal(engine.overReason, 'wrong-tap')
    assert.equal(engine.getSnapshot().wrongTaps, 1)
    assert.equal(calls, 1)
    assert.equal(last.result, 'wrong-tap')
    // 再次 tick / 点按不应重复触发
    engine.tick(100)
    engine.tap(0)
    assert.equal(calls, 1)
  })

  it('漏点黑块越过底线结束（missed）', () => {
    mockLane(3)
    let last = null
    const engine = new PianoTilesEngine({ onGameOver: (i) => (last = i) })
    engine.start()
    advance(engine, 5000) // 远超过 4.9 行高所需时间
    assert.equal(engine.state, 'over')
    assert.equal(engine.overReason, 'missed')
    assert.equal(engine.getSnapshot().misses, 1)
    assert.equal(last.result, 'missed')
  })

  it('maxCombo 取本局最大连击', () => {
    mockLane(0)
    const engine = makeEngine()
    for (let i = 0; i < 4; i++) {
      advance(engine, 450)
      if (engine.state !== 'playing') break
      engine.tap(0)
    }
    assert.ok(engine.getSnapshot().maxCombo >= 3, `maxCombo 应 ≥3，实际 ${engine.getSnapshot().maxCombo}`)
  })

  it('非法轨道号被拒绝且不改变状态', () => {
    mockLane(0)
    const engine = makeEngine()
    const r = engine.tap(9)
    assert.equal(r.ok, false)
    assert.equal(engine.state, 'playing')
  })
})

describe('PianoTilesEngine — 暂停 / 恢复 / 结束', () => {
  it('pause 冻结状态并置 paused，resume 后继续推进', () => {
    mockLane(0)
    const engine = makeEngine()
    engine.pause()
    assert.equal(engine.state, 'paused')
    const id = engine.getSnapshot().rows[0].id
    const y0 = rowY(engine, id)
    engine.tick(500)
    assert.equal(rowY(engine, id), y0)
    engine.resume()
    assert.equal(engine.state, 'playing')
    engine.tick(500)
    assert.ok(rowY(engine, id) > y0)
  })

  it('非 playing 态 pause 无副作用', () => {
    mockLane(0)
    const engine = makeEngine()
    engine.pause()
    const snap = engine.getSnapshot()
    engine.pause()
    assert.equal(engine.state, 'paused')
    assert.equal(engine.getSnapshot().rows[0].y, snap.rows[0].y)
  })

  it('stop 结束并以 stopped 回调', () => {
    mockLane(0)
    let last = null
    const engine = new PianoTilesEngine({ onGameOver: (i) => (last = i) })
    engine.start()
    assert.equal(engine.stop(), true)
    assert.equal(engine.state, 'over')
    assert.equal(last.result, 'stopped')
    assert.equal(engine.stop(), false) // 已结束再调返回 false
  })
})

describe('PianoTilesEngine — 存档恢复', () => {
  it('合法存档恢复为 paused 并保留计数与行', () => {
    mockLane(0)
    const engine = makeEngine()
    advance(engine, 300)
    engine.tap(0)
    const snap = engine.getSnapshot()
    const save = {
      v: 1,
      rows: snap.rows.map((r) => ({ id: r.id, lane: r.lane, y: r.y, hit: r.hit })),
      score: snap.score,
      hits: snap.hits,
      combo: snap.combo,
      maxCombo: snap.maxCombo,
      misses: snap.misses,
      wrongTaps: snap.wrongTaps,
      elapsed: snap.elapsed,
      ts: Date.now(),
    }
    const e2 = new PianoTilesEngine()
    const result = e2.restore(save)
    assert.equal(result.ok, true)
    assert.equal(e2.state, 'paused')
    assert.equal(e2.getSnapshot().score, snap.score)
    assert.equal(e2.getSnapshot().rows.length, snap.rows.length)
    // 恢复后继续推进不抛错
    e2.resume()
    advance(e2, 200)
  })

  it('非法存档被拒绝并返回原因，引擎保持 start', () => {
    const e = new PianoTilesEngine()
    assert.equal(e.state, 'start')
    assert.equal(e.restore(null).ok, false)
    assert.equal(e.restore({ v: 2, rows: [] }).ok, false)
    assert.equal(e.restore({ v: 1, rows: [{ id: 1, lane: 9, y: 1 }] }).ok, false)
    assert.equal(e.restore({ v: 1, rows: [{ id: 1, lane: 0, y: 'x' }] }).ok, false)
    assert.equal(e.state, 'start')
  })

  it('validateSave 逐字段校验', () => {
    assert.equal(validateSave(null), null)
    assert.equal(validateSave({ v: 1 }), null) // 缺 rows
    assert.equal(validateSave({ v: 1, rows: [] }), null)
    assert.equal(validateSave({ v: 1, rows: [{ id: -1, lane: 0, y: 1 }] }), null)
    assert.equal(validateSave({ v: 1, rows: [{ id: 1, lane: 0, y: 1 }], score: -1 }), null)
    const ok = validateSave({
      v: 1,
      rows: [{ id: 1, lane: 0, y: 1.5, hit: false }],
      score: 3,
      hits: 3,
      combo: 2,
      maxCombo: 3,
      misses: 0,
      wrongTaps: 0,
      elapsed: 12,
      ts: 1,
    })
    assert.ok(ok)
    assert.equal(ok.score, 3)
    assert.equal(ok.rows[0].lane, 0)
  })
})

describe('PianoTilesEngine — dispose 与快照', () => {
  it('dispose 后回调被清空，不再触发', () => {
    let calls = 0
    const engine = new PianoTilesEngine({ onState: () => (calls += 1), onGameOver: () => {} })
    engine.start()
    const baseline = calls
    engine.dispose()
    engine.tick(100)
    assert.equal(calls, baseline)
  })

  it('快照包含渲染所需的全部字段', () => {
    mockLane(0)
    const snap = makeEngine().getSnapshot()
    for (const key of [
      'state', 'score', 'combo', 'maxCombo', 'hits', 'misses', 'wrongTaps',
      'speed', 'overReason', 'elapsed', 'lanes', 'visible', 'judgeY', 'hitTol', 'rows',
    ]) {
      assert.ok(key in snap, `快照缺字段 ${key}`)
    }
    assert.equal(snap.lanes, PIANO.LANES)
  })
})
