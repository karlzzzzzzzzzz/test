/**
 * NonogramEngine 单测（node:test）
 * 覆盖：提示计算、关卡生成、状态循环、撤销、提示、胜利判定（含多解）、
 *       暂停冻结、进度序列化、随机源可重现。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  NonogramEngine, LEVELS, CELL, NONOGRAM,
  computeClue, clueEquals, serializeGrid, deserializeGrid,
} from './NonogramEngine.js'

/** 用答案填满网格，构造必胜局面 */
function fillByAnswer(engine) {
  const total = engine.rows * engine.cols
  for (let i = 0; i < total; i++) {
    if (engine.answer[i] === 1) engine.grid[i] = CELL.FILLED
    else engine.grid[i] = CELL.MARKED
  }
}

describe('NonogramEngine — 提示计算', () => {
  it('computeClue 连续块', () => {
    assert.deepEqual(computeClue([1, 1, 1, 0, 1]), [3, 1])
  })

  it('computeClue 全空返回 [0]', () => {
    assert.deepEqual(computeClue([0, 0, 0]), [0])
  })

  it('computeClue 全填返回 [n]', () => {
    assert.deepEqual(computeClue([1, 1, 1, 1]), [4])
  })

  it('computeClue 交替填充', () => {
    assert.deepEqual(computeClue([1, 0, 1, 0, 1]), [1, 1, 1])
  })

  it('clueEquals 正确比较', () => {
    assert.equal(clueEquals([1, 2], [1, 2]), true)
    assert.equal(clueEquals([1, 2], [1, 2, 3]), false)
    assert.equal(clueEquals([1, 2], [2, 1]), false)
  })
})

describe('NonogramEngine — 序列化', () => {
  it('serializeGrid / deserializeGrid 往返一致', () => {
    const grid = new Uint8Array([0, 1, 2, 1, 0, 2])
    const s = serializeGrid(grid)
    assert.equal(s, '012102')
    const back = deserializeGrid(s, 6)
    assert.deepEqual(Array.from(back), [0, 1, 2, 1, 0, 2])
  })

  it('deserializeGrid 长度不符返回 null', () => {
    assert.equal(deserializeGrid('012', 5), null)
  })

  it('deserializeGrid 非法字符返回 null', () => {
    assert.equal(deserializeGrid('019', 3), null)
  })
})

describe('NonogramEngine — 关卡生成', () => {
  it('三档难度都能生成且尺寸正确', () => {
    const e = new NonogramEngine()
    for (const level of ['easy', 'normal', 'hard']) {
      e.start(level)
      assert.equal(e.state, 'playing')
      assert.equal(e.rows, LEVELS[level].rows)
      assert.equal(e.cols, LEVELS[level].cols)
      assert.equal(e.answer.length, e.rows * e.cols)
      assert.equal(e.grid.length, e.rows * e.cols)
    }
  })

  it('生成后每行每列都有填充块（无空行空列）', () => {
    const e = new NonogramEngine()
    e.start('normal')
    for (let r = 0; r < e.rows; r++) {
      const line = []
      for (let c = 0; c < e.cols; c++) line.push(e.answer[r * e.cols + c])
      assert.notDeepEqual(computeClue(line), [0], `第 ${r} 行为空`)
    }
    for (let c = 0; c < e.cols; c++) {
      const line = []
      for (let r = 0; r < e.rows; r++) line.push(e.answer[r * e.cols + c])
      assert.notDeepEqual(computeClue(line), [0], `第 ${c} 列为空`)
    }
  })

  it('行列提示数量与维度一致', () => {
    const e = new NonogramEngine()
    e.start('hard')
    assert.equal(e.rowClues.length, e.rows)
    assert.equal(e.colClues.length, e.cols)
    assert.ok(e.rowClues.every(c => Array.isArray(c) && c.length >= 1))
    assert.ok(e.colClues.every(c => Array.isArray(c) && c.length >= 1))
  })

  it('注入固定随机源 → 两次生成完全一致', () => {
    let i = 0
    const seq = [0.13, 0.47, 0.82, 0.31, 0.66, 0.05, 0.91, 0.24, 0.58, 0.73, 0.39, 0.86, 0.12, 0.55, 0.68, 0.94, 0.27, 0.61, 0.44, 0.79]
    const rand = () => seq[(i++) % seq.length]

    const a = new NonogramEngine({}, { random: rand })
    a.start('easy')
    const aAns = Array.from(a.answer)

    i = 0
    const b = new NonogramEngine({}, { random: rand })
    b.start('easy')
    const bAns = Array.from(b.answer)

    assert.deepEqual(aAns, bAns)
  })
})

describe('NonogramEngine — 填格与撤销', () => {
  it('cycle: 空 → 填 → 叉 → 空', () => {
    const e = new NonogramEngine()
    e.start('easy')
    assert.equal(e.grid[0], CELL.EMPTY)
    e.cycle(0)
    assert.equal(e.grid[0], CELL.FILLED)
    e.cycle(0)
    assert.equal(e.grid[0], CELL.MARKED)
    e.cycle(0)
    assert.equal(e.grid[0], CELL.EMPTY)
  })

  it('setCell 直接设置且同值不记入历史', () => {
    const e = new NonogramEngine()
    e.start('easy')
    const ok = e.setCell(0, CELL.FILLED)
    assert.equal(ok, true)
    assert.equal(e.grid[0], CELL.FILLED)
    const same = e.setCell(0, CELL.FILLED)
    assert.equal(same, false)
  })

  it('undo 逐步回退', () => {
    const e = new NonogramEngine()
    e.start('easy')
    e.setCell(0, CELL.FILLED)
    e.setCell(1, CELL.MARKED)
    e.undo()
    assert.equal(e.grid[1], CELL.EMPTY)
    assert.equal(e.grid[0], CELL.FILLED)
    e.undo()
    assert.equal(e.grid[0], CELL.EMPTY)
  })

  it('非法索引被忽略', () => {
    const e = new NonogramEngine()
    e.start('easy')
    assert.equal(e.cycle(-1), false)
    assert.equal(e.cycle(9999), false)
    assert.equal(e.setCell(1.5, CELL.FILLED), false)
  })

  it('非 playing 态操作被忽略', () => {
    const e = new NonogramEngine()
    assert.equal(e.cycle(0), false)
    e.start('easy')
    e.pause()
    assert.equal(e.cycle(0), false)
    assert.equal(e.undo(), false)
    assert.equal(e.hint(), false)
  })

  it('clearAll 清空所有标记', () => {
    const e = new NonogramEngine()
    e.start('easy')
    e.setCell(0, CELL.FILLED)
    e.setCell(1, CELL.MARKED)
    e.clearAll()
    assert.ok(e.grid.every(v => v === CELL.EMPTY))
  })
})

describe('NonogramEngine — 提示功能', () => {
  it('hint 揭示一个答案格并消耗次数', () => {
    const e = new NonogramEngine()
    e.start('easy')
    const before = e.hintsLeft
    const total = e.rows * e.cols
    let answerIdx = -1
    for (let i = 0; i < total; i++) if (e.answer[i] === 1) { answerIdx = i; break }
    assert.ok(answerIdx >= 0)
    e.hint()
    assert.equal(e.hintsLeft, before - 1)
    // 至少有一个答案格被填上
    let filledOnAnswer = 0
    for (let i = 0; i < total; i++) if (e.answer[i] === 1 && e.grid[i] === CELL.FILLED) filledOnAnswer += 1
    assert.ok(filledOnAnswer >= 1)
  })

  it('hint 次数耗尽后返回 false', () => {
    const e = new NonogramEngine()
    e.start('normal')
    for (let i = 0; i < NONOGRAM.HINT_LIMIT; i++) e.hint()
    assert.equal(e.hintsLeft, 0)
    assert.equal(e.hint(), false)
  })
})

describe('NonogramEngine — 胜利判定', () => {
  it('按答案填满 → 胜利', () => {
    let over = null
    const e = new NonogramEngine({ onGameOver: (info) => { over = info } })
    e.start('easy')
    fillByAnswer(e)
    // 填满后直接做一次胜利检查并结束（避免再改格子破坏正确局面）
    assert.equal(e._checkWin(), true)
    e._finish()
    assert.ok(over, '应触发 onGameOver')
    assert.equal(over.result, 'win')
    assert.equal(e.state, 'over')
  })

  it('多解：另一种满足提示的图案同样胜利', () => {
    const e = new NonogramEngine()
    e.rows = 2; e.cols = 2
    // 答案取对角线：行 [1],[1]；列 [1],[1]
    e.answer = new Uint8Array([1, 0, 0, 1])
    e.grid = new Uint8Array(4)
    e._computeClues()
    assert.deepEqual(e.rowClues, [[1], [1]])
    assert.deepEqual(e.colClues, [[1], [1]])

    // 另一种满足相同提示的图案：反对角线
    e.state = 'playing'
    e.grid = new Uint8Array([0, 1, 1, 0])
    assert.equal(e._checkWin(), true)
  })

  it('部分正确 → 未胜利', () => {
    const e = new NonogramEngine()
    e.start('easy')
    e.setCell(0, CELL.FILLED)
    assert.equal(e.state, 'playing')
  })

  it('叉格不计入填充', () => {
    const e = new NonogramEngine()
    e.rows = 1; e.cols = 3
    e.answer = new Uint8Array([0, 0, 0])
    e.grid = new Uint8Array([2, 2, 2]) // 全叉
    e._computeClues()
    assert.deepEqual(e.rowClues, [[0]])
    e.state = 'playing'
    assert.equal(e._checkWin(), true)
  })
})

describe('NonogramEngine — 暂停与计时', () => {
  it('暂停后 elapsed 冻结，恢复后继续', async () => {
    const e = new NonogramEngine()
    e.start('easy')
    e.setCell(0, CELL.FILLED) // 启动时钟
    e.resumeAt = Date.now() - 2000
    const t1 = e._elapsed()
    e.pause()
    const t2 = e._elapsed()
    assert.ok(t1 >= 2 && t1 < 2.5, `t1=${t1}`)
    assert.equal(t1, t2, '暂停后应冻结')
    assert.equal(e.state, 'paused')
  })

  it('dispose 后回调不再触发', () => {
    let called = false
    const e = new NonogramEngine({ onState: () => { called = true } })
    e.start('easy')
    called = false
    e.dispose()
    e.cycle(0)
    assert.equal(called, false)
  })
})

describe('NonogramEngine — 进度持久化', () => {
  it('exportProgress 可被 start 还原', () => {
    const e = new NonogramEngine()
    e.start('easy')
    e.setCell(0, CELL.FILLED)
    e.setCell(1, CELL.MARKED)
    const prog = e.exportProgress()

    const e2 = new NonogramEngine()
    const r = e2.start('easy', prog)
    assert.equal(r.restored, true)
    assert.equal(e2.grid[0], CELL.FILLED)
    assert.equal(e2.grid[1], CELL.MARKED)
    assert.ok(e2.started)
  })

  it('难度不匹配的进度不还原', () => {
    const e = new NonogramEngine()
    e.start('easy')
    const prog = e.exportProgress()
    prog.level = 'hard'
    const e2 = new NonogramEngine()
    const r = e2.start('easy', prog)
    assert.equal(r.restored, false)
  })

  it('损坏的进度字符串不还原', () => {
    const e = new NonogramEngine()
    const r = e.start('easy', { level: 'easy', grid: 'abc', elapsed: 0 })
    assert.equal(r.restored, false)
  })
})
