/**
 * LifeEngine 单测（node:test）
 * 覆盖：RLE 解析、邻居计数（环绕 / 固定）、B3/S23 演化、静物与周期振荡、
 *       滑翔机位移、灭绝与手动结束、编辑 / 清空 / 随机、速度与边界切换、
 *       暂停冻结、自定义图案校验与快照守卫。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  LifeEngine, LIFE, SPEEDS, PRESETS, PRESET_KEYS,
  parseRLE, createEmptyBoard, populationOf, countNeighbors, stepBoard,
} from './LifeEngine.js'

const idx = (row, col, cols = LIFE.COLS) => row * cols + col

function liveSet(board, cols = LIFE.COLS) {
  const set = new Set()
  for (let i = 0; i < board.length; i++) {
    if (board[i]) set.add(`${Math.floor(i / cols)},${i % cols}`)
  }
  return set
}

/** 用字符串行构造棋盘 */
function boardFrom(rowsText) {
  const rows = rowsText.length
  const cols = rowsText[0].length
  const board = new Uint8Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) board[r * cols + c] = rowsText[r][c] === 'O' ? 1 : 0
  }
  return { board, rows, cols }
}

function makeEngine(cb = {}, options = {}) {
  const engine = new LifeEngine(cb, options)
  engine.start('glider')
  return engine
}

describe('LifeEngine — RLE 解析', () => {
  it('解析滑翔机并忽略注释与换行', () => {
    const parsed = parseRLE('#N Glider\nx = 3, y = 3\nbo$2bo$3o!')
    assert.equal(parsed.width, 3)
    assert.equal(parsed.height, 3)
    assert.equal(parsed.cells.length, 5)
    assert.deepEqual(
      parsed.cells.sort((a, b) => a.row - b.row || a.col - b.col),
      [
        { row: 0, col: 1 },
        { row: 1, col: 2 },
        { row: 2, col: 0 },
        { row: 2, col: 1 },
        { row: 2, col: 2 },
      ],
    )
  })

  it('支持多行、数字重复与 . 兼容写法', () => {
    const parsed = parseRLE('x = 4, y = 2\n2o.2b$\n.4b!')
    assert.equal(parsed.cells.length, 2)
    assert.deepEqual(parsed.cells, [{ row: 0, col: 0 }, { row: 0, col: 1 }])
  })

  it('空图案返回空 cells，语法错误抛异常', () => {
    assert.deepEqual(parseRLE('x = 3, y = 3\n3b$3b$3b!').cells, [])
    assert.throws(() => parseRLE(''), /内容为空/)
    assert.throws(() => parseRLE('3o!'), /缺少 x = N, y = N/)
    assert.throws(() => parseRLE('x = 3, y = 3\n3z!'), /无法识别的字符/)
    assert.throws(() => parseRLE('x = 2, y = 2\n3o!'), /超出声明的宽度/)
    assert.throws(() => parseRLE('x = 3, y = 2\n3o$3o$3o!'), /超出声明的高度/)
  })

  it('内置图案都能被解析且非空', () => {
    for (const key of PRESET_KEYS) {
      const parsed = parseRLE(PRESETS[key].rle)
      assert.ok(parsed.cells.length > 0, `${key} 应有细胞`)
      assert.ok(parsed.width <= LIFE.COLS && parsed.height <= LIFE.ROWS, `${key} 应能放入棋盘`)
    }
  })
})

describe('LifeEngine — 邻居与演化规则', () => {
  it('固定边界下越界邻居不计，环绕边界下角格连到对边', () => {
    const corner = createEmptyBoard(3, 3)
    corner[idx(0, 0, 3)] = 1
    corner[idx(0, 2, 3)] = 1
    corner[idx(2, 0, 3)] = 1
    assert.equal(countNeighbors(corner, 3, 3, idx(0, 0, 3), false), 0)
    assert.equal(countNeighbors(corner, 3, 3, idx(0, 0, 3), true), 2)
    assert.equal(countNeighbors(corner, 3, 3, idx(0, 1, 3), true), 3)
  })

  it('闪烁灯周期 2，方块保持静物', () => {
    const blinker = boardFrom(['...', 'OOO', '...'])
    const next1 = stepBoard(blinker.board, 3, 3, false)
    assert.deepEqual(Array.from(next1), [
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ])
    const next2 = stepBoard(next1, 3, 3, false)
    assert.deepEqual(Array.from(next2), [
      0, 0, 0,
      1, 1, 1,
      0, 0, 0,
    ])

    const block = boardFrom(['OO', 'OO'])
    assert.deepEqual(Array.from(stepBoard(block.board, 2, 2, false)), Array.from(block.board))
  })

  it('孤立细胞下一代死亡', () => {
    const board = createEmptyBoard(3, 3)
    board[idx(1, 1, 3)] = 1
    assert.equal(populationOf(stepBoard(board, 3, 3, true)), 0)
  })
})

describe('LifeEngine — 对局流程', () => {
  it('开局载入滑翔机并处于 playing，人口与代数正确', () => {
    const engine = makeEngine()
    const snap = engine.getSnapshot()
    assert.equal(snap.state, 'playing')
    assert.equal(snap.board.length, LIFE.ROWS * LIFE.COLS)
    assert.equal(snap.population, 5)
    assert.equal(snap.generation, 0)
    assert.equal(snap.maxPopulation, 5)
    assert.equal(snap.presetKey, 'glider')
    assert.equal(snap.wrap, true)
  })

  it('闪烁灯一代竖、两代横', () => {
    const engine = makeEngine()
    engine.loadPreset('blinker')
    const start = liveSet(engine.board)
    engine.step()
    const vertical = liveSet(engine.board)
    assert.notDeepEqual(vertical, start)
    engine.step()
    assert.deepEqual(liveSet(engine.board), start)
    assert.equal(engine.generation, 2)
  })

  it('滑翔机 4 代后整体右下移一格', () => {
    const engine = makeEngine()
    const before = liveSet(engine.board)
    for (let i = 0; i < 4; i++) engine.step()
    const after = liveSet(engine.board)
    const shifted = new Set()
    for (const key of before) {
      const [r, c] = key.split(',').map(Number)
      shifted.add(`${r + 1},${c + 1}`)
    }
    assert.deepEqual(after, shifted)
  })

  it('最后一批细胞死亡时进入 over 并回调 extinct', () => {
    let over = null
    const engine = makeEngine({ onGameOver: (info) => { over = info } })
    engine.clear()
    engine.toggleCell(idx(12, 20))
    engine.step()
    assert.ok(over)
    assert.equal(over.result, 'extinct')
    assert.equal(over.population, 0)
    assert.equal(engine.state, 'over')
  })

  it('手动结束观察进入 over 并保留当前人口', () => {
    let over = null
    const engine = makeEngine({ onGameOver: (info) => { over = info } })
    engine.step()
    engine.stop()
    assert.ok(over)
    assert.equal(over.result, 'stopped')
    assert.ok(over.population > 0)
    assert.equal(engine.state, 'over')
  })

  it('合计出生 / 死亡与最大人口随演化更新', () => {
    const engine = makeEngine()
    engine.loadPreset('blinker')
    engine.step()
    const snap = engine.getSnapshot()
    assert.ok(snap.totalBirths > 0)
    assert.ok(snap.totalDeaths > 0)
    assert.ok(snap.maxPopulation >= snap.population)
  })
})

describe('LifeEngine — 编辑与设置', () => {
  it('toggleCell 切换细胞并更新人口；clear 清空并归零代数', () => {
    const engine = makeEngine()
    const before = engine.getSnapshot().population
    const center = idx(0, 0)
    const value = engine.toggleCell(center)
    assert.equal(value, engine.board[center])
    assert.equal(engine.getSnapshot().population, before + value)
    assert.equal(engine.clear(), true)
    const snap = engine.getSnapshot()
    assert.equal(snap.population, 0)
    assert.equal(snap.generation, 0)
    assert.equal(snap.maxPopulation, 0)
  })

  it('randomize 按密度生成细胞，固定随机源结果可复现', () => {
    const random = () => 0.5
    const engine = new LifeEngine({}, { random })
    engine.start('glider', { speed: 'fast' })
    assert.equal(engine.randomize(0.28), true)
    assert.equal(engine.getSnapshot().population, 0)
    engine.randomize(0.6)
    assert.equal(engine.getSnapshot().population, LIFE.ROWS * LIFE.COLS)
  })

  it('setSpeed / setWrap 更新快照，非法速度返回 false', () => {
    const engine = makeEngine()
    assert.equal(engine.setSpeed('turbo'), true)
    assert.equal(engine.getSnapshot().speed, 'turbo')
    assert.equal(engine.setSpeed('nope'), false)
    assert.equal(engine.setWrap(false), true)
    assert.equal(engine.getSnapshot().wrap, false)
    for (const key of Object.keys(SPEEDS)) {
      assert.equal(engine.setSpeed(key), true)
    }
  })

  it('loadCells 接受合法图案，拒绝空图案与超界图案', () => {
    const engine = makeEngine()
    assert.equal(engine.loadCells([]).ok, false)
    assert.equal(engine.loadCells([{ row: LIFE.ROWS, col: 0 }]).ok, false)
    const result = engine.loadCells([{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }])
    assert.equal(result.ok, true)
    assert.equal(result.population, 3)
    assert.equal(engine.getSnapshot().imported, true)
  })
})

describe('LifeEngine — 状态机与守卫', () => {
  it('未开局快照不崩溃且棋盘为空', () => {
    const engine = new LifeEngine()
    const snap = engine.getSnapshot()
    assert.equal(snap.state, 'start')
    assert.deepEqual(snap.board, [])
    assert.equal(snap.population, 0)
    assert.equal(snap.generation, 0)
  })

  it('暂停后 tick 不推进，手动 step 仍可单步', () => {
    const engine = makeEngine()
    engine.pause()
    assert.equal(engine.state, 'paused')
    const gen = engine.generation
    engine.tick()
    assert.equal(engine.generation, gen)
    engine.step()
    assert.equal(engine.generation, gen + 1)
    assert.equal(engine.state, 'paused')
    engine.resume()
    assert.equal(engine.state, 'playing')
  })

  it('暂停时计时冻结', () => {
    const engine = makeEngine()
    engine.pause()
    const t1 = engine.getSnapshot().elapsed
    assert.equal(engine.getSnapshot().elapsed, t1)
    engine.resume()
    assert.equal(engine.getSnapshot().state, 'playing')
  })

  it('over 后不能再 step / toggle / clear', () => {
    const engine = makeEngine()
    engine.stop()
    assert.equal(engine.step(), false)
    assert.equal(engine.toggleCell(0), null)
    assert.equal(engine.clear(), false)
  })

  it('dispose 后不再触发状态回调', () => {
    let called = false
    const engine = makeEngine({ onState: () => { called = true } })
    called = false
    engine.dispose()
    engine.step()
    assert.equal(called, false)
  })
})
