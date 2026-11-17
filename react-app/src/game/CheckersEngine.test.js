/**
 * CheckersEngine 单测（node:test）
 * 覆盖：开局摆子、初始合法着法、强制吃子、连跳、升王结束回合、
 *       无子/无着法判负、和棋、三档 AI、暂停冻结、每日残局确定性、快照守卫。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CheckersEngine, PIECE, SIDE, LEVELS, CHECKERS,
  createInitialBoard, createDailyBoard, generateMoves, isPlayable,
  hashSeed, mulberry32,
} from './CheckersEngine.js'

const idx = (r, c) => r * 8 + c

/** 用稀疏描述构造棋盘：{ '4,1': PIECE.RED, ... } */
function boardOf(map) {
  const board = new Uint8Array(64)
  for (const [key, piece] of Object.entries(map)) {
    const [r, c] = key.split(',').map(Number)
    board[idx(r, c)] = piece
  }
  return board
}

function makeEngine(board, turn = SIDE.RED, cb = {}) {
  const engine = new CheckersEngine(cb)
  engine.board = board
  engine.turn = turn
  engine.state = 'playing'
  engine.started = true
  engine.resumeAt = Date.now()
  engine.clockRunning = true
  return engine
}

describe('CheckersEngine — 开局与合法着法', () => {
  it('标准开局每方 12 枚且全部落在深色格', () => {
    const board = createInitialBoard()
    let red = 0
    let black = 0
    for (let i = 0; i < 64; i++) {
      const p = board[i]
      if (!p) continue
      const r = i >> 3
      const c = i & 7
      assert.equal(isPlayable(r, c), true, `(${r},${c}) 应落在深色格`)
      if (p === PIECE.RED) red += 1
      if (p === PIECE.BLACK) black += 1
    }
    assert.equal(red, 12)
    assert.equal(black, 12)
  })

  it('红方开局有 7 种合法走法且均为普通移动', () => {
    const board = createInitialBoard()
    const moves = generateMoves(board, SIDE.RED)
    assert.equal(moves.length, 7)
    assert.ok(moves.every((m) => m.captures.length === 0))
    assert.ok(moves.every((m) => (m.from >> 3) === 5))
  })

  it('黑方普通棋只能向下斜走两步', () => {
    const board = boardOf({ '0,1': PIECE.BLACK })
    const moves = generateMoves(board, SIDE.BLACK)
    assert.equal(moves.length, 2)
    assert.deepEqual(moves.map((m) => m.to).sort((a, b) => a - b), [idx(1, 0), idx(1, 2)])
  })

  it('存在吃子时强制只返回吃子着法', () => {
    const board = boardOf({
      '2,1': PIECE.RED,
      '1,2': PIECE.BLACK,
      '5,0': PIECE.RED,
    })
    const moves = generateMoves(board, SIDE.RED)
    assert.equal(moves.length, 1)
    assert.deepEqual(moves[0].captures, [idx(1, 2)])
    assert.equal(moves[0].to, idx(0, 3))
  })
})

describe('CheckersEngine — 连跳', () => {
  it('第一跳后保持红方回合并要求同一枚棋继续跳', () => {
    const board = boardOf({
      '6,1': PIECE.RED,
      '5,2': PIECE.BLACK,
      '3,4': PIECE.BLACK,
      '2,7': PIECE.BLACK,
    })
    const engine = makeEngine(board)

    const first = engine.tryMove(idx(6, 1), idx(4, 3))
    assert.equal(first.ok, true)
    assert.equal(first.chain, true)
    assert.equal(engine.turn, SIDE.RED)
    assert.equal(engine.chainFrom, idx(4, 3))
    assert.equal(engine.capturesMade, 1)

    // 连跳期间其他棋子不可移动
    assert.deepEqual(engine.movesForPiece(idx(2, 7)), [])
    const off = engine.tryMove(idx(2, 7), idx(1, 6))
    assert.equal(off.ok, false)

    const second = engine.tryMove(idx(4, 3), idx(2, 5))
    assert.equal(second.ok, true)
    assert.equal(second.chain, false)
    assert.equal(engine.turn, SIDE.BLACK)
    assert.equal(engine.capturesMade, 2)
  })
})

describe('CheckersEngine — 升王', () => {
  it('普通走子到达底线升王并切换回合', () => {
    const board = boardOf({
      '1,0': PIECE.RED,
      '2,3': PIECE.BLACK,
    })
    const engine = makeEngine(board)
    const r = engine.tryMove(idx(1, 0), idx(0, 1))
    assert.equal(r.ok, true)
    assert.equal(r.promoted, true)
    assert.equal(engine.board[idx(0, 1)], PIECE.RED_KING)
    assert.equal(engine.promotions, 1)
    assert.equal(engine.turn, SIDE.BLACK)
  })

  it('吃子升王后即使还能再吃也立即结束回合', () => {
    const board = boardOf({
      '2,1': PIECE.RED,
      '1,2': PIECE.BLACK,
      '1,4': PIECE.BLACK,
      '4,7': PIECE.RED,
    })
    const engine = makeEngine(board)
    const r = engine.tryMove(idx(2, 1), idx(0, 3))
    assert.equal(r.ok, true)
    assert.equal(r.promoted, true)
    assert.equal(r.chain, false)
    assert.equal(engine.board[idx(0, 3)], PIECE.RED_KING)
    assert.equal(engine.turn, SIDE.BLACK)
  })
})

describe('CheckersEngine — 胜负与和棋', () => {
  it('吃光对方棋子判胜', () => {
    let over = null
    const board = boardOf({
      '2,1': PIECE.RED,
      '1,2': PIECE.BLACK,
    })
    const engine = makeEngine(board, SIDE.RED, { onGameOver: (info) => { over = info } })
    engine.tryMove(idx(2, 1), idx(0, 3))
    assert.ok(over, '应触发 onGameOver')
    assert.equal(over.result, 'win')
    assert.equal(engine.state, 'over')
    assert.equal(engine.winner, SIDE.RED)
  })

  it('对方无合法着法判负', () => {
    let over = null
    const board = boardOf({
      '5,0': PIECE.RED,
      '7,6': PIECE.BLACK, // 黑方普通棋在底线无法继续前进
    })
    const engine = makeEngine(board, SIDE.RED, { onGameOver: (info) => { over = info } })
    engine.tryMove(idx(5, 0), idx(4, 1))
    assert.ok(over)
    assert.equal(over.result, 'win')
  })

  it('连续 80 个半回合无吃子判和', () => {
    const engine = makeEngine(createInitialBoard())
    engine.quietPlies = CHECKERS.DRAW_QUIET_PLIES
    let over = null
    engine.cb = { onGameOver: (info) => { over = info } }
    const move = generateMoves(engine.board, SIDE.RED)[0]
    engine.tryMove(move.from, move.to)
    assert.ok(over)
    assert.equal(over.result, 'draw')
    assert.equal(engine.state, 'over')
    assert.equal(engine.winner, null)
  })
})

describe('CheckersEngine — AI', () => {
  it('三档 AI 在强制吃子局面下都会吃子', () => {
    for (const level of Object.keys(LEVELS)) {
      const board = boardOf({
        '4,1': PIECE.BLACK,
        '5,2': PIECE.RED,
        '1,2': PIECE.RED,
      })
      const engine = makeEngine(board, SIDE.BLACK)
      engine.level = level
      const move = engine.chooseAiMove()
      assert.ok(move, `${level} 应返回着法`)
      assert.deepEqual(move.captures, [idx(5, 2)], `${level} 应强制吃子`)
      assert.equal(move.to, idx(6, 3))
    }
  })

  it('playAiMove 落子并切换回合', () => {
    const board = boardOf({
      '2,1': PIECE.BLACK,
      '5,2': PIECE.RED,
      '6,5': PIECE.RED,
    })
    const engine = makeEngine(board, SIDE.BLACK)
    engine.level = 'normal'
    const move = engine.playAiMove()
    assert.ok(move)
    assert.equal(engine.turn, SIDE.RED)
    assert.ok(engine.movesPlayed >= 1)
  })

  it('轮到红方时 AI 不落子', () => {
    const engine = makeEngine(createInitialBoard(), SIDE.RED)
    assert.equal(engine.chooseAiMove(), null)
    assert.equal(engine.playAiMove(), null)
  })
})

describe('CheckersEngine — 状态机与守卫', () => {
  it('未开局时快照不崩溃且棋盘为空', () => {
    const engine = new CheckersEngine()
    const snap = engine.getSnapshot()
    assert.equal(snap.state, 'start')
    assert.deepEqual(snap.board, [])
    assert.equal(snap.playerPieces, 0)
    assert.equal(snap.aiPieces, 0)
    assert.equal(snap.legalMoveCount, 0)
  })

  it('暂停后无法走子，计时冻结，恢复后继续', () => {
    const engine = makeEngine(createInitialBoard())
    engine.pause()
    assert.equal(engine.state, 'paused')
    const t1 = engine.getSnapshot().elapsed
    assert.equal(engine.tryMove(idx(5, 0), idx(4, 1)).ok, false)
    assert.equal(engine.getSnapshot().elapsed, t1)
    engine.resume()
    assert.equal(engine.state, 'playing')
    assert.equal(engine.tryMove(idx(5, 0), idx(4, 1)).ok, true)
  })

  it('非法走子给出原因', () => {
    const engine = makeEngine(createInitialBoard())
    const r1 = engine.tryMove(idx(0, 1), idx(1, 2))
    assert.equal(r1.ok, false)
    assert.equal(r1.reason, '只能移动红棋')
    const r2 = engine.tryMove(idx(5, 0), idx(5, 2))
    assert.equal(r2.ok, false)
  })

  it('dispose 后不再触发状态回调', () => {
    let called = false
    const engine = makeEngine(createInitialBoard(), SIDE.RED, { onState: () => { called = true } })
    engine.dispose()
    engine.tryMove(idx(5, 0), idx(4, 1))
    assert.equal(called, false)
  })
})

describe('CheckersEngine — 每日残局', () => {
  it('同一天生成的盘面完全一致，双方各 6 枚', () => {
    const a = createDailyBoard('2026-11-17')
    const b = createDailyBoard('2026-11-17')
    assert.deepEqual(Array.from(a), Array.from(b))

    let red = 0
    let black = 0
    for (let i = 0; i < 64; i++) {
      const p = a[i]
      if (!p) continue
      const r = i >> 3
      const c = i & 7
      assert.equal(isPlayable(r, c), true)
      if (p === PIECE.RED) { red += 1; assert.ok(r >= 5) }
      if (p === PIECE.BLACK) { black += 1; assert.ok(r <= 2) }
    }
    assert.equal(red, CHECKERS.DAILY_PIECES)
    assert.equal(black, CHECKERS.DAILY_PIECES)
  })

  it('连续多个日期生成的残局双方都至少有一种走法', () => {
    for (const date of ['2026-11-17', '2026-11-18', '2026-12-01', '2027-01-01', '2027-06-30']) {
      const board = createDailyBoard(date)
      assert.ok(generateMoves(board, SIDE.RED).length > 0, `${date} 红方应有走法`)
      assert.ok(generateMoves(board, SIDE.BLACK).length > 0, `${date} 黑方应有走法`)
    }
  })

  it('不同日期盘面不同', () => {
    const a = Array.from(createDailyBoard('2026-11-17'))
    const b = Array.from(createDailyBoard('2026-11-18'))
    assert.notDeepEqual(a, b)
  })

  it('每日模式启动后记录日期且状态为 playing', () => {
    const engine = new CheckersEngine()
    const snap = engine.start('normal', { mode: 'daily', dailyDate: '2026-11-17' })
    assert.equal(snap.mode, 'daily')
    assert.equal(snap.dailyDate, '2026-11-17')
    assert.equal(snap.state, 'playing')
    assert.equal(snap.playerPieces, CHECKERS.DAILY_PIECES)
  })
})

describe('CheckersEngine — 随机源工具', () => {
  it('hashSeed 稳定且区分大小写', () => {
    assert.equal(hashSeed('2026-11-17'), hashSeed('2026-11-17'))
    assert.notEqual(hashSeed('2026-11-17'), hashSeed('2026-11-18'))
  })

  it('mulberry32 同种子序列一致且落在 [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 10; i++) {
      const v = a()
      assert.equal(v, b())
      assert.ok(v >= 0 && v < 1)
    }
  })
})
