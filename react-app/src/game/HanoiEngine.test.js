/**
 * HanoiEngine 单测（node:test）
 * 覆盖：初始柱面、最少步数、选择/移动流程、非法移动计错、撤销、
 *       3 盘最优解通关、暂停冻结、手动结束、存档恢复校验、快照守卫。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  HanoiEngine, HANOI, DISK_OPTIONS, PEG_NAMES,
  minMoves, createPegs, topDisk, canMove,
} from './HanoiEngine.js'

function makeEngine(disks = 4, cb = {}) {
  const engine = new HanoiEngine(cb)
  engine.start(disks)
  return engine
}

/** 递归求解：把 n 个盘从 from 移到 to */
function solve(engine, n, from, to, aux) {
  if (n === 0) return
  solve(engine, n - 1, from, aux, to)
  const result = engine.move(from, to)
  assert.equal(result.ok, true, `移动 ${from}→${to} 应成功`)
  solve(engine, n - 1, aux, to, from)
}

describe('HanoiEngine — 初始状态与工具函数', () => {
  it('最少步数为 2^n - 1', () => {
    assert.equal(minMoves(3), 7)
    assert.equal(minMoves(4), 15)
    assert.equal(minMoves(8), 255)
    for (const n of DISK_OPTIONS) assert.equal(minMoves(n), 2 ** n - 1)
  })

  it('初始柱面大盘在下、小盘在上，另两柱为空', () => {
    const pegs = createPegs(4)
    assert.deepEqual(pegs, [[4, 3, 2, 1], [], []])
    assert.equal(topDisk(pegs, 0), 1)
    assert.equal(topDisk(pegs, 1), 0)
  })

  it('canMove 只允许小盘压大盘或落到空柱', () => {
    const pegs = [[3, 1], [2], []]
    assert.equal(canMove(pegs, 0, 1), true)
    assert.equal(canMove(pegs, 1, 0), false)
    assert.equal(canMove(pegs, 1, 2), true)
    assert.equal(canMove(pegs, 0, 0), false)
  })

  it('开局快照包含盘数、最优步数与空历史', () => {
    const engine = makeEngine(5)
    const snap = engine.getSnapshot()
    assert.equal(snap.state, 'playing')
    assert.equal(snap.disks, 5)
    assert.equal(snap.optimal, 31)
    assert.equal(snap.moves, 0)
    assert.equal(snap.selectedPeg, null)
    assert.equal(snap.canUndo, false)
    assert.deepEqual(snap.pegs, [[5, 4, 3, 2, 1], [], []])
  })

  it('柱名常量覆盖三根柱子', () => {
    assert.equal(PEG_NAMES.length, 3)
    assert.equal(HANOI.PEGS, 3)
  })
})

describe('HanoiEngine — 选择与移动', () => {
  it('点空柱提示没有圆盘，点同一柱取消选择', () => {
    const engine = makeEngine(4)
    assert.equal(engine.select(1).ok, false)
    assert.equal(engine.select(0).selected, 0)
    const cancel = engine.select(0)
    assert.equal(cancel.deselected, true)
    assert.equal(engine.getSnapshot().selectedPeg, null)
  })

  it('先选柱再点目标柱完成移动并计步', () => {
    const engine = makeEngine(4)
    assert.equal(engine.select(0).selected, 0)
    const result = engine.select(2)
    assert.equal(result.ok, true)
    assert.equal(engine.moves, 1)
    assert.deepEqual(engine.getSnapshot().pegs, [[4, 3, 2], [], [1]])
    assert.equal(engine.getSnapshot().selectedPeg, null)
  })

  it('大盘压小盘被拒绝并计错，柱面不变', () => {
    const engine = makeEngine(4)
    engine.move(0, 1)
    const before = JSON.stringify(engine.getSnapshot().pegs)
    const result = engine.move(0, 1)
    assert.equal(result.ok, false)
    assert.match(result.reason, /大盘不能放在小盘上/)
    assert.equal(engine.mistakes, 1)
    assert.equal(JSON.stringify(engine.getSnapshot().pegs), before)
    assert.equal(engine.moves, 1)
  })

  it('从空柱移动给出原因且不计错', () => {
    const engine = makeEngine(4)
    const result = engine.move(1, 2)
    assert.equal(result.ok, false)
    assert.match(result.reason, /没有圆盘/)
    assert.equal(engine.mistakes, 0)
  })

  it('撤销恢复上一步并标记辅助，步数回退', () => {
    const engine = makeEngine(4)
    engine.move(0, 1)
    const result = engine.undo()
    assert.equal(result.ok, true)
    assert.equal(engine.moves, 0)
    assert.equal(engine.undos, 1)
    assert.equal(engine.assisted, true)
    assert.deepEqual(engine.getSnapshot().pegs, [[4, 3, 2, 1], [], []])
    assert.equal(engine.undo().ok, false)
  })
})

describe('HanoiEngine — 通关与结束', () => {
  it('3 盘按最优解 7 步通关并回调 win', () => {
    let over = null
    const engine = makeEngine(3, { onGameOver: (info) => { over = info } })
    solve(engine, 3, 0, 2, 1)
    assert.ok(over)
    assert.equal(over.result, 'win')
    assert.equal(over.moves, 7)
    assert.equal(over.optimal, 7)
    assert.equal(over.assisted, false)
    assert.equal(engine.state, 'over')
    assert.deepEqual(engine.getSnapshot().pegs, [[], [], [3, 2, 1]])
  })

  it('通关后不能再移动或撤销', () => {
    const engine = makeEngine(3)
    solve(engine, 3, 0, 2, 1)
    assert.equal(engine.move(2, 0).ok, false)
    assert.equal(engine.undo().ok, false)
    assert.equal(engine.select(0).ok, false)
  })

  it('手动结束保留当前步数并回调 stopped', () => {
    let over = null
    const engine = makeEngine(4, { onGameOver: (info) => { over = info } })
    engine.move(0, 2)
    engine.stop()
    assert.ok(over)
    assert.equal(over.result, 'stopped')
    assert.equal(over.moves, 1)
    assert.equal(engine.state, 'over')
  })
})

describe('HanoiEngine — 暂停与存档', () => {
  it('暂停后不能移动，恢复后继续', () => {
    const engine = makeEngine(4)
    engine.pause()
    assert.equal(engine.state, 'paused')
    assert.equal(engine.move(0, 1).ok, false)
    const t1 = engine.getSnapshot().elapsed
    engine.tick()
    assert.equal(engine.getSnapshot().elapsed, t1)
    engine.resume()
    assert.equal(engine.move(0, 1).ok, true)
  })

  it('合法存档可恢复到 paused，非法存档被拒绝', () => {
    const source = makeEngine(4)
    source.move(0, 2)
    const snap = source.getSnapshot()
    const engine = new HanoiEngine()
    const result = engine.restore({
      disks: 4,
      pegs: snap.pegs,
      moves: snap.moves,
      mistakes: 0,
      undos: 0,
      assisted: false,
      elapsed: 12,
    })
    assert.equal(result.ok, true)
    assert.equal(engine.state, 'paused')
    assert.equal(engine.getSnapshot().moves, 1)
    assert.equal(engine.getSnapshot().elapsed, 12)

    assert.equal(engine.restore(null).ok, false)
    assert.equal(engine.restore({ disks: 4, pegs: [[1, 2], [], []], moves: 0 }).ok, false)
    assert.equal(engine.restore({ disks: 2, pegs: [[2, 1], [], []], moves: 0 }).ok, false)
    assert.equal(engine.restore({ disks: 4, pegs: [[4, 3, 2, 1], [], []], moves: -1 }).ok, false)
  })

  it('restore 后撤销历史为空，但仍可继续移动', () => {
    const source = makeEngine(4)
    source.move(0, 1)
    const engine = new HanoiEngine()
    engine.restore({
      disks: 4,
      pegs: source.getSnapshot().pegs,
      moves: 1,
      mistakes: 0,
      undos: 0,
      assisted: false,
      elapsed: 0,
    })
    assert.equal(engine.getSnapshot().canUndo, false)
    engine.resume()
    assert.equal(engine.move(0, 2).ok, true)
  })
})

describe('HanoiEngine — 守卫', () => {
  it('未开局快照不崩溃', () => {
    const engine = new HanoiEngine()
    const snap = engine.getSnapshot()
    assert.equal(snap.state, 'start')
    assert.deepEqual(snap.pegs, [[], [], []])
    assert.equal(snap.moves, 0)
    assert.equal(snap.optimal, 15)
  })

  it('dispose 后不再触发状态回调', () => {
    let called = false
    const engine = makeEngine(4, { onState: () => { called = true } })
    called = false
    engine.dispose()
    engine.move(0, 1)
    assert.equal(called, false)
  })
})
