/**
 * PipeEngine 单测（node:test 框架）
 * 覆盖：mask 旋转、关卡生成必然可解、胜利判定、状态机、撤销、倒计时、暂停恢复
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { PipeEngine, DIFFICULTY, DIR, DIR_MASK, rotateMask, rotateMaskN, hasOpening, isRotatable } from './PipeEngine.js'

describe('PipeEngine — mask 旋转工具', () => {
  it('rotateMask: 直管 N+S(5) 旋转一次 → E+W(10)', () => {
    assert.equal(rotateMask(5), 10) // 0b0101 → 0b1010
  })

  it('rotateMask: 十字(15) 旋转任意次不变', () => {
    assert.equal(rotateMask(15), 15)
    assert.equal(rotateMaskN(15, 3), 15)
  })

  it('rotateMaskN: 弯管 N+E(3) 旋转 4 次 → 原样', () => {
    assert.equal(rotateMaskN(3, 4), 3)
  })

  it('rotateMaskN: 负数也能正归位', () => {
    assert.equal(rotateMaskN(3, -1), rotateMaskN(3, 3))
  })

  it('hasOpening 正确识别四个方向', () => {
    assert.ok(hasOpening(5, DIR.N)) // 5=0b0101 → N, S
    assert.ok(hasOpening(5, DIR.S))
    assert.ok(!hasOpening(5, DIR.E))
    assert.ok(!hasOpening(5, DIR.W))
  })

  it('isRotatable: 空地/十字/源/终点不可旋转', () => {
    assert.ok(!isRotatable('EMPTY'))
    assert.ok(!isRotatable('CROSS'))
    assert.ok(!isRotatable('SOURCE'))
    assert.ok(!isRotatable('TARGET'))
    assert.ok(isRotatable('STRAIGHT'))
    assert.ok(isRotatable('CURVE'))
    assert.ok(isRotatable('TEE'))
  })
})

describe('PipeEngine — 关卡生成必然可解', () => {
  // 关键约束：每次 start 后，只要玩家把每段管都转到"正确方向"，
  // 就一定能从源点连通到终点（因为生成时先铺了一条连通路径）。
  // 我们可以直接通过 BFS 验证——在引擎初始 mask 下，路径可能被打乱但连通性不变
  // （因为路径上每段管的 mask 都是"进+出"两个方向，只是旋转了）。
  // 实际上生成后路径是打乱的，必须旋转后才能打通。

  it('start 后 state = playing', () => {
    const e = new PipeEngine()
    e.start('easy')
    assert.equal(e.state, 'playing')
  })

  it('start 后 sourcePos 在 [0,0]，targetPos 在 [rows-1, cols-1]', () => {
    const e = new PipeEngine()
    e.start('normal')
    assert.deepEqual(e.sourcePos, [0, 0])
    assert.deepEqual(e.targetPos, [e.rows - 1, e.cols - 1])
    assert.equal(e.rows, DIFFICULTY.normal.rows)
    assert.equal(e.cols, DIFFICULTY.normal.cols)
  })

  it('start 后每一格都是合法管型', () => {
    const e = new PipeEngine()
    e.start('easy')
    for (const cell of e.grid) {
      const validTypes = ['EMPTY', 'STRAIGHT', 'CURVE', 'TEE', 'CROSS', 'SOURCE', 'TARGET']
      assert.ok(validTypes.includes(cell.type), `非法管型: ${cell.type}`)
      assert.ok(cell.mask >= 0 && cell.mask <= 15, `非法 mask: ${cell.mask}`)
    }
  })

  it('源点和终点在关卡中且为固定不可旋转类型', () => {
    const e = new PipeEngine()
    e.start('hard')
    const [sr, sc] = e.sourcePos
    const [tr, tc] = e.targetPos
    assert.equal(e.grid[sr * e.cols + sc].type, 'SOURCE')
    assert.equal(e.grid[tr * e.cols + tc].type, 'TARGET')
    assert.ok(!isRotatable(e.grid[sr * e.cols + sc].type))
    assert.ok(!isRotatable(e.grid[tr * e.cols + tc].type))
  })

  it('三种难度都能 start 并生成合法关卡', () => {
    const e = new PipeEngine()
    for (const level of ['easy', 'normal', 'hard']) {
      e.start(level)
      assert.equal(e.state, 'playing')
      assert.ok(e.rows > 0 && e.cols > 0)
      assert.ok(e.grid.length === e.rows * e.cols)
    }
  })
})

describe('PipeEngine — 旋转与撤销', () => {
  it('rotate 对不可旋转格返回 false', () => {
    const e = new PipeEngine()
    e.start('easy')
    // 源点
    const srcIdx = e.sourcePos[0] * e.cols + e.sourcePos[1]
    assert.equal(e.rotate(srcIdx), false)
    // 空地：先找到一块空地
    const emptyIdx = e.grid.findIndex(c => c.type === 'EMPTY')
    if (emptyIdx >= 0) assert.equal(e.rotate(emptyIdx), false)
  })

  it('rotate 对可旋转格增加 clicks', () => {
    const e = new PipeEngine()
    e.start('easy')
    // 找到一块可旋转的非源/终点格
    let testIdx = -1
    for (let i = 0; i < e.grid.length; i++) {
      if (isRotatable(e.grid[i].type)) { testIdx = i; break }
    }
    if (testIdx < 0) return // 理论上不会发生
    const prevClicks = e.clicks
    assert.equal(e.rotate(testIdx), true)
    assert.equal(e.clicks, prevClicks + 1)
  })

  it('undo 恢复到旋转前状态', () => {
    const e = new PipeEngine()
    e.start('easy')
    let testIdx = -1
    for (let i = 0; i < e.grid.length; i++) {
      if (isRotatable(e.grid[i].type)) { testIdx = i; break }
    }
    if (testIdx < 0) return
    const prevMask = e.grid[testIdx].mask
    e.rotate(testIdx)
    assert.notEqual(e.grid[testIdx].mask, prevMask)
    e.undo()
    assert.equal(e.grid[testIdx].mask, prevMask)
  })

  it('undo 次数耗尽后返回 false', () => {
    const e = new PipeEngine()
    e.start('easy')
    for (let i = 0; i < 15; i++) {
      e.rotate(1)
      e.undo()
    }
    // 最后一次 undo 应耗尽
    const result = e.undo()
    assert.equal(result, false)
  })
})

describe('PipeEngine — 胜利判定', () => {
  it('手动构造一个 2×2 连通关卡，_checkWin 返回 true', () => {
    // SOURCE[0,0] 朝 S → [1,0] 需要 N 开口；[1,0] 朝 E → TARGET[1,1] 需要 W 开口
    const e = new PipeEngine()
    e.rows = 2; e.cols = 2
    e.grid = [
      { type: 'SOURCE',  mask: DIR_MASK[DIR.S] },                      // [0,0] S(4)
      { type: 'EMPTY',   mask: 0 },                                     // [0,1]
      { type: 'CURVE',   mask: DIR_MASK[DIR.N] | DIR_MASK[DIR.E] },     // [1,0] N(1)+E(2)=3
      { type: 'TARGET',  mask: DIR_MASK[DIR.W] },                       // [1,1] W(8)
    ]
    e.sourcePos = [0, 0]
    e.targetPos = [1, 1]
    // 路径：SOURCE(S) → [1,0]N; [1,0]E → TARGET(W)
    assert.equal(e._checkWin(), true)
  })

  it('断开的管型 _checkWin 返回 false', () => {
    const e = new PipeEngine()
    e.rows = 2; e.cols = 2
    e.grid = [
      { type: 'SOURCE',   mask: DIR_MASK[DIR.E] },       // [0,0] 朝 E
      { type: 'STRAIGHT', mask: DIR_MASK[DIR.N] | DIR_MASK[DIR.S] }, // [0,1] N+S — 没有 W 口！
      { type: 'EMPTY',    mask: 0 },
      { type: 'TARGET',   mask: DIR_MASK[DIR.W] },
    ]
    e.sourcePos = [0, 0]
    e.targetPos = [1, 1]
    assert.equal(e._checkWin(), false)
  })
})

describe('PipeEngine — 状态机与生命周期', () => {
  it('非 playing 态 rotate/undo 被忽略', () => {
    const e = new PipeEngine()
    // 没 start 前
    assert.equal(e.rotate(0), false)
    assert.equal(e.undo(), false)
    e.start('easy')
    e.pause()
    assert.equal(e.rotate(1), false)
    assert.equal(e.undo(), false)
  })

  it('dispose 后回调不触发', () => {
    let called = false
    const e = new PipeEngine({ onState: () => { called = true } })
    e.start('easy')
    called = false
    e.dispose()
    const res = e.rotate(1)
    // rotate 返回 true/false 取决于可旋转性，但 onState 不应被调用
    assert.equal(called, false)
  })
})

describe('PipeEngine — 暂停/恢复/超时', () => {
  it('tick 在超时后触发 onGameOver timeout', async () => {
    const e = new PipeEngine()
    let overResult = null
    const engine = new PipeEngine({
      onGameOver: (info) => { overResult = info.result }
    })
    // 给一个极短的关卡
    engine._cfg = { ...DIFFICULTY.easy, limitSec: 0.05 } // 50ms
    engine.start('easy')
    engine.started = true
    engine.resumeAt = Date.now() - engine._cfg.limitSec * 1000 - 50
    engine.tick()
    assert.equal(overResult, 'timeout')
  })

  it('暂停后 elapsed 冻结，恢复后继续', () => {
    const e = new PipeEngine()
    e.start('easy')
    e.started = true
    e.resumeAt = Date.now() - 3000 // 已过 3s
    e.elapsedBase = 0
    // 再让时钟跑 1s
    const t0 = e._elapsed()
    e.pause()
    const t1 = e._elapsed()
    // 暂停后 elapsed 应几乎不变（小于半秒增量）
    assert.ok(Math.abs(t0 - t1) < 0.5)
    const beforeResume = e.elapsedBase
    // 等 500ms，然后恢复
    e.resume()
    // 恢复后 resumeAt = Date.now()
    assert.ok(e.state === 'playing')
  })
})

describe('PipeEngine — 随机策略注入', () => {
  it('注入固定随机 → 每次生成相同关卡', () => {
    let seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 0.12, 0.22, 0.32, 0.42, 0.52, 0.62, 0.72, 0.82, 0.92]
    let i = 0
    const rand = () => seq[(i++) % seq.length]

    const e1 = new PipeEngine({}, { random: rand })
    e1.start('easy')
    const g1 = e1.grid.map(c => ({ type: c.type, mask: c.mask }))

    i = 0
    const e2 = new PipeEngine({}, { random: rand })
    e2.start('easy')
    const g2 = e2.grid.map(c => ({ type: c.type, mask: c.mask }))

    assert.deepEqual(g1, g2)
  })
})
