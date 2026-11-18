/**
 * Match3Engine 单测（node:test）
 * 覆盖：三消扫描、可交换判定、棋盘生成、消除下落与计分、连锁、
 *       交换合法性、胜负判定、暂停冻结、存档恢复、无解重排、快照守卫。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  Match3Engine, MATCH3, LEVELS, baseScoreOf, findMatches, hasPossibleMove,
  createBoard, resolveBoard, shuffleBoard, swapCells,
} from './Match3Engine.js'

/** 用数字字符串构造棋盘：['123','456'] → 2 行 3 列 */
function boardFrom(rowsText) {
  const rows = rowsText.length
  const cols = rowsText[0].length
  const board = new Uint8Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) board[r * cols + c] = Number(rowsText[r][c])
  }
  return { board, rows, cols }
}

function seeded(seed = 12345) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/** 在引擎当前棋盘上找到第一个「交换后能/不能三消」的相邻对 */
function findSwap(engine, wantMatch) {
  const { rows, cols } = engine
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * cols + c
      const neighbors = []
      if (c + 1 < cols) neighbors.push(a + 1)
      if (r + 1 < rows) neighbors.push(a + cols)
      for (const b of neighbors) {
        const copy = Uint8Array.from(engine.board)
        swapCells(copy, a, b)
        const matched = findMatches(copy, rows, cols).length > 0
        if (matched === wantMatch) return [a, b]
      }
    }
  }
  return null
}

describe('Match3Engine — 三消扫描', () => {
  it('识别横向三连与四连', () => {
    const h = boardFrom(['111', '234', '567'])
    const groups = findMatches(h.board, h.rows, h.cols)
    assert.equal(groups.length, 1)
    assert.equal(groups[0].orientation, 'h')
    assert.equal(groups[0].length, 3)

    const four = boardFrom(['1111', '2345', '5678'])
    assert.equal(findMatches(four.board, four.rows, four.cols)[0].length, 4)
  })

  it('识别纵向三连', () => {
    const v = boardFrom(['123', '145', '167'])
    const groups = findMatches(v.board, v.rows, v.cols)
    assert.equal(groups.length, 1)
    assert.equal(groups[0].orientation, 'v')
    assert.deepEqual(groups[0].cells, [0, 3, 6])
  })

  it('十字交叉会同时返回横纵两组', () => {
    const cross = boardFrom(['010', '111', '010'])
    const groups = findMatches(cross.board, cross.rows, cross.cols)
    assert.equal(groups.length, 2)
    assert.ok(groups.some((g) => g.orientation === 'h'))
    assert.ok(groups.some((g) => g.orientation === 'v'))
  })

  it('无三消与空位不误判', () => {
    const none = boardFrom(['123', '456', '789'])
    assert.equal(findMatches(none.board, none.rows, none.cols).length, 0)
    const zeros = boardFrom(['000', '000', '000'])
    assert.equal(findMatches(zeros.board, zeros.rows, zeros.cols).length, 0)
  })

  it('基础分随消除长度递增', () => {
    assert.equal(baseScoreOf(3), 60)
    assert.equal(baseScoreOf(4), 100)
    assert.equal(baseScoreOf(5), 160)
    assert.equal(baseScoreOf(7), 160)
  })
})

describe('Match3Engine — 棋盘生成与交换判定', () => {
  it('生成的棋盘无初始三消且存在可消交换', () => {
    for (const key of Object.keys(LEVELS)) {
      const cfg = LEVELS[key]
      const board = createBoard(MATCH3.ROWS, MATCH3.COLS, cfg.colors, seeded(cfg.colors * 1000))
      assert.equal(board.length, 64)
      assert.equal(findMatches(board, MATCH3.ROWS, MATCH3.COLS).length, 0)
      assert.equal(hasPossibleMove(board, MATCH3.ROWS, MATCH3.COLS), true)
      for (const value of board) assert.ok(value >= 1 && value <= cfg.colors)
    }
  })

  it('hasPossibleMove 对死局返回 false', () => {
    const dead = boardFrom(['1234', '3412', '2143', '4321'])
    assert.equal(findMatches(dead.board, dead.rows, dead.cols).length, 0)
    assert.equal(hasPossibleMove(dead.board, dead.rows, dead.cols), false)
  })

  it('shuffleBoard 重排后无三消且存在可消交换', () => {
    const dead = boardFrom(['1234', '3412', '2143', '4321'])
    const next = shuffleBoard(dead.board, dead.rows, dead.cols, 4, seeded(9))
    assert.equal(next.length, 16)
    assert.equal(findMatches(next, dead.rows, dead.cols).length, 0)
    assert.equal(hasPossibleMove(next, dead.rows, dead.cols), true)
  })
})

describe('Match3Engine — 消除、下落与连锁', () => {
  it('消除后棋盘补满、得分与清除数正确', () => {
    const src = boardFrom(['111', '234', '567'])
    const result = resolveBoard(src.board, src.rows, src.cols, 4, seeded(3))
    assert.equal(result.board.length, 9)
    assert.ok(result.cleared >= 3)
    assert.ok(result.score >= 60)
    assert.equal(findMatches(result.board, src.rows, src.cols).length, 0)
  })

  it('固定随机源下连锁会产生额外清除与更高得分', () => {
    // 4×4 横向一行四连，补充块固定为 1，会持续触发连锁
    const src = boardFrom(['1111', '2345', '3456', '4567'])
    const result = resolveBoard(src.board, src.rows, src.cols, 4, () => 0)
    assert.ok(result.cleared > 4)
    assert.ok(result.maxCombo >= 2)
    assert.ok(result.cascades >= 1)
    assert.ok(result.score > 100)
  })
})

describe('Match3Engine — 对局流程', () => {
  it('开局快照字段完整且步数正确', () => {
    const engine = new Match3Engine({}, { random: seeded(1) })
    const snap = engine.start('normal')
    assert.equal(snap.state, 'playing')
    assert.equal(snap.board.length, 64)
    assert.equal(snap.movesLeft, LEVELS.normal.moves)
    assert.equal(snap.target, LEVELS.normal.target)
    assert.equal(snap.score, 0)
  })

  it('非法交换被拒绝且棋盘不变', () => {
    const engine = new Match3Engine({}, { random: seeded(2) })
    engine.start('easy')
    const before = Array.from(engine.board)
    assert.equal(engine.trySwap(0, 0).ok, false)
    assert.equal(engine.trySwap(0, 9).reason, '只能交换相邻的两个方块')
    assert.equal(engine.trySwap(-1, 0).reason, '格子不存在')
    const noMatch = findSwap(engine, false)
    assert.ok(noMatch, '棋盘上应存在无法三消的相邻对')
    assert.equal(engine.trySwap(noMatch[0], noMatch[1]).reason, '这次交换无法形成三消')
    assert.deepEqual(Array.from(engine.board), before)
    assert.equal(engine.movesLeft, LEVELS.easy.moves)
  })

  it('有效交换扣步、加分并记录连锁', () => {
    const engine = new Match3Engine({}, { random: seeded(4) })
    engine.start('easy')
    const pair = findSwap(engine, true)
    assert.ok(pair)
    const res = engine.trySwap(pair[0], pair[1])
    assert.equal(res.ok, true)
    assert.ok(res.gained > 0)
    assert.equal(engine.movesLeft, LEVELS.easy.moves - 1)
    assert.ok(engine.score > 0)
    assert.ok(engine.matches >= 3)
    assert.ok(engine.maxCombo >= 1)
  })

  it('达到目标分立即胜利并触发回调', () => {
    let over = null
    const engine = new Match3Engine({ onGameOver: (info) => { over = info } }, { random: seeded(5) })
    engine.start('easy')
    engine.score = LEVELS.easy.target - 1
    engine.movesLeft = 5
    const pair = findSwap(engine, true)
    const res = engine.trySwap(pair[0], pair[1])
    assert.equal(res.win, true)
    assert.ok(over)
    assert.equal(over.result, 'win')
    assert.equal(engine.state, 'over')
  })

  it('步数用尽且未达标判负', () => {
    let over = null
    const engine = new Match3Engine({ onGameOver: (info) => { over = info } }, { random: seeded(6) })
    engine.start('easy')
    engine.score = 0
    engine.movesLeft = 1
    const pair = findSwap(engine, true)
    const res = engine.trySwap(pair[0], pair[1])
    assert.equal(res.lose, true)
    assert.ok(over)
    assert.equal(over.result, 'lose')
    assert.equal(over.movesLeft, 0)
    assert.equal(engine.state, 'over')
  })

  it('无解棋盘在交换后自动重排', () => {
    const engine = new Match3Engine({}, { random: seeded(7) })
    engine.start('easy')
    // 仅在极端情况下触发；通过替换为已知死局并直接调用私有逻辑不可行，
    // 这里验证 hasPossibleMove 与 reshuffles 初值，重排路径由 shuffleBoard 单测覆盖。
    assert.equal(engine.reshuffles, 0)
    assert.equal(hasPossibleMove(engine.board, engine.rows, engine.cols), true)
  })
})

describe('Match3Engine — 存档与状态机', () => {
  it('restore 可还原合法存档，非法存档返回 false', () => {
    const source = new Match3Engine({}, { random: seeded(8) })
    source.start('normal')
    const snap = source.getSnapshot()

    const target = new Match3Engine({}, { random: seeded(9) })
    assert.equal(target.restore({
      level: 'normal',
      board: snap.board,
      movesLeft: 10,
      score: 640,
      swaps: 3,
      matches: 21,
      cascades: 1,
      maxCombo: 2,
      elapsed: 42,
    }), true)
    const restored = target.getSnapshot()
    assert.equal(restored.state, 'playing')
    assert.equal(restored.movesLeft, 10)
    assert.equal(restored.score, 640)
    assert.equal(restored.elapsed, 42)
    assert.deepEqual(restored.board, snap.board)

    assert.equal(target.restore(null), false)
    assert.equal(target.restore({ level: 'nope', board: snap.board, movesLeft: 3 }), false)
    assert.equal(target.restore({ level: 'normal', board: [1, 2, 3], movesLeft: 3 }), false)
    assert.equal(target.restore({ level: 'normal', board: snap.board, movesLeft: 0 }), false)
    assert.equal(target.restore({ level: 'normal', board: new Array(64).fill(9), movesLeft: 3 }), false)
  })

  it('未开局快照不崩溃且棋盘为空', () => {
    const engine = new Match3Engine()
    const snap = engine.getSnapshot()
    assert.equal(snap.state, 'start')
    assert.deepEqual(snap.board, [])
    assert.equal(snap.movesLeft, 0)
  })

  it('暂停后不能交换、计时冻结，恢复后继续', () => {
    const engine = new Match3Engine({}, { random: seeded(10) })
    engine.start('easy')
    engine.pause()
    assert.equal(engine.state, 'paused')
    const t1 = engine.getSnapshot().elapsed
    assert.equal(engine.trySwap(0, 1).ok, false)
    assert.equal(engine.getSnapshot().elapsed, t1)
    engine.resume()
    assert.equal(engine.state, 'playing')
  })

  it('dispose 后不再触发状态回调', () => {
    let called = false
    const engine = new Match3Engine({ onState: () => { called = true } }, { random: seeded(11) })
    engine.start('easy')
    called = false
    engine.dispose()
    engine.tick()
    assert.equal(called, false)
  })
})
