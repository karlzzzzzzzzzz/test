/**
 * OneStrokeEngine 单测（node:test）
 * 覆盖：关卡可一笔画校验、初始合法移动、完整欧拉路径通关、非法操作、
 *       撤销 / 重置 / 卡住判定、暂停冻结、每日关卡确定性、快照守卫。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  OneStrokeEngine, LEVELS, LEVEL_DEFS, ONE_STROKE,
  validateLevel, degreesOf, oddNodesOf, createDailyLevel, edgeKey, hashSeed, mulberry32,
} from './OneStrokeEngine.js'

/** Hierholzer：返回从起点出发依次经过的节点序列（不含起点） */
function eulerWalk(def) {
  const used = new Set()
  const adj = Array.from({ length: def.rows * def.cols }, () => [])
  for (const [a, b] of def.edges) {
    const key = edgeKey(a, b)
    adj[a].push({ to: b, key })
    adj[b].push({ to: a, key })
  }
  const stack = [def.start]
  const circuit = []
  while (stack.length) {
    const v = stack[stack.length - 1]
    const next = adj[v].find((e) => !used.has(e.key))
    if (next) {
      used.add(next.key)
      stack.push(next.to)
    } else {
      circuit.push(stack.pop())
    }
  }
  return circuit.reverse().slice(1)
}

function makeEngine(level = 'easy', cb = {}) {
  const engine = new OneStrokeEngine(cb)
  engine.start(level)
  return engine
}

describe('OneStrokeEngine — 关卡定义', () => {
  it('三档关卡都满足一笔画条件且边数正确', () => {
    const expected = { easy: 10, normal: 14, hard: 25 }
    for (const key of Object.keys(LEVELS)) {
      const result = validateLevel(LEVEL_DEFS[key])
      assert.equal(result.ok, true, `${key} 应可一笔画：${result.problems.join('；')}`)
      assert.equal(result.edgeCount, expected[key])
      assert.equal(result.oddNodes.length, 2, `${key} 应恰有 2 个奇数度点`)
      assert.ok(result.oddNodes.includes(LEVEL_DEFS[key].start), `${key} 起点应在奇点上`)
    }
  })

  it('度数计算与奇数度点识别正确', () => {
    const deg = degreesOf(LEVEL_DEFS.easy)
    assert.equal(deg[3], 3)
    assert.equal(deg[5], 3)
    assert.deepEqual(oddNodesOf(LEVEL_DEFS.easy).sort((a, b) => a - b), [3, 5])
  })

  it('能识别重复边 / 自环 / 越界等非法关卡', () => {
    const bad = { rows: 2, cols: 2, start: 0, edges: [[0, 1], [0, 1], [1, 1], [0, 9]] }
    const result = validateLevel(bad)
    assert.equal(result.ok, false)
    assert.ok(result.problems.some((p) => p.includes('重复边')))
    assert.ok(result.problems.some((p) => p.includes('自环')))
    assert.ok(result.problems.some((p) => p.includes('越界')))
  })
})

describe('OneStrokeEngine — 走线与通关', () => {
  it('开局在起点，三档关卡的当前点都是奇数度点', () => {
    for (const key of Object.keys(LEVELS)) {
      const engine = makeEngine(key)
      const snap = engine.getSnapshot()
      assert.equal(snap.state, 'playing')
      assert.equal(snap.current, LEVEL_DEFS[key].start)
      assert.equal(snap.usedCount, 0)
      assert.equal(snap.canUndo, false)
    }
  })

  it('轻松关起点有 3 个可按方向', () => {
    const engine = makeEngine('easy')
    assert.equal(engine.edgesAt(3).length, 3)
    assert.deepEqual(engine.edgesAt(3).map((i) => {
      const e = engine.edges[i]
      return e.a === 3 ? e.b : e.a
    }).sort((a, b) => a - b), [0, 4, 6])
    assert.equal(engine.tryMove(0).ok, true)
  })

  it('按欧拉路径走完全部边即通关并触发回调', () => {
    for (const key of Object.keys(LEVELS)) {
      let over = null
      const engine = makeEngine(key, { onGameOver: (info) => { over = info } })
      const walk = eulerWalk(LEVEL_DEFS[key])
      for (const node of walk) {
        const res = engine.tryMove(node)
        assert.equal(res.ok, true, `${key} 走 ${node} 失败：${res.reason}`)
      }
      assert.ok(over, `${key} 应触发 onGameOver`)
      assert.equal(over.result, 'win')
      assert.equal(over.level, key)
      assert.equal(over.moves, LEVEL_DEFS[key].edges.length)
      const snap = engine.getSnapshot()
      assert.equal(snap.state, 'over')
      assert.equal(snap.remaining, 0)
      assert.equal(snap.canUndo, false)
    }
  })

  it('拒绝不相邻、已走过、越界与同点操作', () => {
    const engine = makeEngine('easy')
    assert.equal(engine.tryMove(3).reason, '请选择相邻的点')
    assert.equal(engine.tryMove(8).reason, '两点之间没有连线')
    assert.equal(engine.tryMove(99).reason, '目标点不存在')
    assert.equal(engine.tryMove(0).ok, true)
    const usedAgain = engine.tryMove(3)
    assert.equal(usedAgain.ok, false)
    assert.equal(usedAgain.reason, '这条边已经走过')
    assert.equal(engine.tryMove(1).ok, true)
  })
})

describe('OneStrokeEngine — 撤销 / 重置 / 卡住', () => {
  it('撤销回退边、当前点与步数', () => {
    const engine = makeEngine('easy')
    engine.tryMove(0)
    engine.tryMove(1)
    assert.equal(engine.getSnapshot().usedCount, 2)
    assert.equal(engine.undo(), true)
    const snap = engine.getSnapshot()
    assert.equal(snap.usedCount, 1)
    assert.equal(snap.current, 0)
    assert.equal(snap.moves, 1)
    assert.equal(snap.undos, 1)
    assert.equal(engine.undo(), true)
    assert.equal(engine.getSnapshot().current, 3)
    assert.equal(engine.undo(), false)
  })

  it('重置清空走过的边并回到起点、计时归零', () => {
    const engine = makeEngine('easy')
    engine.tryMove(0)
    engine.tryMove(1)
    assert.equal(engine.reset(), true)
    const snap = engine.getSnapshot()
    assert.equal(snap.usedCount, 0)
    assert.equal(snap.current, LEVEL_DEFS.easy.start)
    assert.equal(snap.moves, 0)
    assert.equal(snap.resets, 1)
    assert.equal(snap.elapsed, 0)
  })

  it('走到死路时标记 stuck，撤销后解除', () => {
    const engine = makeEngine('easy')
    // 除 3-0 与 7-8 外全部标为已走：走 3→0 后 0 点无未走边，但还剩 7-8
    engine.used = engine.used.map(() => true)
    engine.used[engine.edgeBetween(3, 0)] = false
    engine.used[engine.edgeBetween(7, 8)] = false
    const res = engine.tryMove(0)
    assert.equal(res.ok, true)
    assert.equal(res.stuck, true)
    assert.equal(res.remaining, 1)
    assert.equal(engine.getSnapshot().stuck, true)
    engine.undo()
    assert.equal(engine.getSnapshot().stuck, false)
  })
})

describe('OneStrokeEngine — 状态机与守卫', () => {
  it('未开局时快照不崩溃且为空', () => {
    const engine = new OneStrokeEngine()
    const snap = engine.getSnapshot()
    assert.equal(snap.state, 'start')
    assert.deepEqual(snap.edges, [])
    assert.deepEqual(snap.nodes, [])
    assert.equal(snap.totalEdges, 0)
    assert.equal(snap.canUndo, false)
  })

  it('暂停后不能画线，计时冻结；恢复后继续', () => {
    const engine = makeEngine('easy')
    engine.pause()
    assert.equal(engine.state, 'paused')
    const t1 = engine.getSnapshot().elapsed
    assert.equal(engine.tryMove(0).ok, false)
    assert.equal(engine.getSnapshot().elapsed, t1)
    engine.resume()
    assert.equal(engine.tryMove(0).ok, true)
  })

  it('dispose 后不再触发状态回调', () => {
    let called = false
    const engine = makeEngine('easy', { onState: () => { called = true } })
    called = false
    engine.dispose()
    engine.tryMove(0)
    assert.equal(called, false)
  })
})

describe('OneStrokeEngine — 每日关卡', () => {
  it('同一天生成的难度与起点完全一致', () => {
    const a = createDailyLevel('2026-11-18')
    const b = createDailyLevel('2026-11-18')
    assert.deepEqual(a, b)
    assert.ok(ONE_STROKE.DAILY_POOL.includes(a.levelKey))
  })

  it('每日起点必定落在奇数度点上且关卡合法', () => {
    for (const date of ['2026-11-18', '2026-12-01', '2027-01-01', '2027-06-30']) {
      const daily = createDailyLevel(date)
      const def = LEVEL_DEFS[daily.levelKey]
      assert.ok(oddNodesOf(def).includes(daily.start), `${date} 起点应在奇点上`)
      assert.equal(validateLevel(def).ok, true)
    }
  })

  it('不同日期会抽到不同的难度或起点组合', () => {
    const combos = new Set()
    for (let i = 1; i <= 12; i++) {
      const daily = createDailyLevel(`2026-11-${String(i).padStart(2, '0')}`)
      combos.add(`${daily.levelKey}:${daily.start}`)
    }
    assert.ok(combos.size >= 2)
  })

  it('每日模式启动后记录日期并可指定起点', () => {
    const engine = new OneStrokeEngine()
    const snap = engine.start('easy', { mode: 'daily', dailyDate: '2026-11-18', startNode: 5 })
    assert.equal(snap.mode, 'daily')
    assert.equal(snap.dailyDate, '2026-11-18')
    assert.equal(snap.current, 5)
  })
})

describe('OneStrokeEngine — 随机源工具', () => {
  it('hashSeed 稳定且区分日期', () => {
    assert.equal(hashSeed('2026-11-18'), hashSeed('2026-11-18'))
    assert.notEqual(hashSeed('2026-11-18'), hashSeed('2026-11-19'))
  })

  it('mulberry32 同种子序列一致且落在 [0,1)', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    for (let i = 0; i < 10; i++) {
      const v = a()
      assert.equal(v, b())
      assert.ok(v >= 0 && v < 1)
    }
  })
})
