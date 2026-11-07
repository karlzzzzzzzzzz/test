/**
 * ReversiEngine 单元测试（node:test，零依赖）
 * 覆盖：初始盘面与合法点、落子翻色、非法位置、回合与节流、自动跳过、
 * 双方无子可落收尾、暂停冻结、超时、三档 AI 合法落点、计分、dispose。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ReversiEngine, DIFFICULTY, REVERSI } from './ReversiEngine.js'

const { PLAYER, AI } = REVERSI
const idx = (row, col) => row * REVERSI.SIZE + col

function makeEngine(level = 'easy', options = {}) {
  const engine = new ReversiEngine({}, { random: () => 0.5, ...options })
  engine.start(level)
  return engine
}

test('初始盘面：黑（玩家）先手，双方各 2 子，4 个合法落点', () => {
  const engine = makeEngine('easy')
  const snap = engine.getSnapshot()

  assert.equal(snap.state, 'playing')
  assert.equal(snap.turn, 'player')
  assert.equal(snap.counts.player, 2)
  assert.equal(snap.counts.ai, 2)
  assert.equal(snap.board.length, 64)
  assert.equal(snap.board[idx(3, 3)], AI) // d4
  assert.equal(snap.board[idx(3, 4)], PLAYER) // e4
  assert.equal(snap.board[idx(4, 3)], PLAYER) // d5
  assert.equal(snap.board[idx(4, 4)], AI) // e5
  // c4 / d3 / e6 / f5，即 26 / 19 / 44 / 37
  assert.deepEqual(snap.legal, [19, 26, 37, 44])
  assert.equal(snap.remaining, DIFFICULTY.easy.limitSec)
  assert.deepEqual(engine.getLegalMoves(), snap.legal)
})

test('合法落子：夹住的对手棋子全部翻色，步数与回合推进', () => {
  const engine = makeEngine('easy')
  assert.equal(engine.tap(26), true)

  const snap = engine.getSnapshot()
  assert.equal(snap.board[26], PLAYER)
  assert.equal(snap.board[27], PLAYER, 'd4 白子应被翻成黑子')
  assert.equal(snap.counts.player, 4)
  assert.equal(snap.counts.ai, 1)
  assert.equal(snap.moves, 1)
  assert.equal(snap.turn, 'ai')
  assert.deepEqual(snap.lastMove, { idx: 26, row: 3, col: 2, who: 'player', flips: [27] })
  assert.equal(snap.aiThinking, true)
  assert.deepEqual(snap.legal, [], '电脑回合不向玩家提示落点')
})

test('非法落子：已占位、无夹吃、越界、非整数一律忽略', () => {
  const engine = makeEngine('easy')
  assert.equal(engine.tap(27), false, '已有棋子')
  assert.equal(engine.tap(0), false, '角落无夹吃')
  assert.equal(engine.tap(-1), false)
  assert.equal(engine.tap(64), false)
  assert.equal(engine.tap(1.5), false)
  assert.equal(engine.moves, 0)
  assert.equal(engine.state, 'playing')
  assert.equal(engine.turn, 'player')
})

test('回合约束：非玩家回合与暂停状态下的点按都不生效', () => {
  const engine = makeEngine('easy')
  assert.equal(engine.tap(26), true)
  assert.equal(engine.turn, 'ai')
  assert.equal(engine.tap(19), false, '电脑回合玩家不能落子')

  engine.pause()
  assert.equal(engine.state, 'paused')
  assert.equal(engine.tap(19), false, '暂停时不能落子')
  assert.equal(engine.aiTurn(), -1, '暂停时电脑也不落子')

  engine.resume()
  assert.equal(engine.state, 'playing')
  assert.ok(engine.aiTurn() >= 0)
})

test('频率控制：150ms 内的重复点按被节流', () => {
  let clock = 1000
  const engine = makeEngine('easy', { now: () => clock })

  assert.equal(engine.tap(26), true)
  assert.ok(engine.aiTurn() >= 0)
  assert.equal(engine.turn, 'player')

  const next = engine.getLegalMoves()[0]
  assert.ok(Number.isInteger(next), '电脑落子后玩家应有合法点')

  assert.equal(engine.tap(next), false, '同一毫秒重复点按被拦截')
  clock = 1000 + REVERSI.MIN_TAP_INTERVAL_MS - 1
  assert.equal(engine.tap(next), false, '不足 150ms 仍被拦截')
  clock = 1000 + REVERSI.MIN_TAP_INTERVAL_MS
  assert.equal(engine.tap(next), true, '满 150ms 后放行')
  assert.equal(engine.moves, 3)
})

test('自动跳过：对手无子可落时轮次回到自己并累计跳过次数', () => {
  const engine = makeEngine('easy')
  const legalOf = engine._legalList.bind(engine)
  engine._legalList = (board, who) => (who === AI ? [] : legalOf(board, who))

  const ended = engine._switchTurn(PLAYER)
  assert.equal(ended, false)
  assert.equal(engine.turn, 'player')
  assert.equal(engine.passBy, 'ai')
  assert.equal(engine.passes, 1)
  assert.equal(engine.lastAction, 'pass')
  assert.equal(engine.getSnapshot().passBy, 'ai')
})

test('双方都无子可落：按盘面棋子数结算，棋子多者胜', () => {
  let over = null
  const engine = new ReversiEngine(
    { onGameOver: (score, elapsed, result) => { over = { score, elapsed, result } } },
    { random: () => 0.5 },
  )
  engine.start('easy')
  engine.board = new Array(64).fill(PLAYER)
  engine.board[10] = 0

  assert.equal(engine._switchTurn(PLAYER), true)
  assert.equal(engine.state, 'over')
  assert.equal(engine.result, 'win')
  assert.ok(over && over.score > 0, '胜利应结算正分')
  assert.equal(engine.getSnapshot().score, over.score)
})

test('终局计子：棋子少为 lose，相等为 draw，且都不计分', () => {
  const engine = makeEngine('easy')

  engine.board = new Array(64).fill(PLAYER)
  engine.board.fill(AI, 0, 40) // AI 40 : 玩家 24
  engine._finishByCount()
  assert.equal(engine.state, 'over')
  assert.equal(engine.result, 'lose')
  assert.equal(engine.getSnapshot().score, null)

  const draw = makeEngine('easy')
  draw.board = new Array(64).fill(0)
  draw.board.fill(PLAYER, 0, 32)
  draw.board.fill(AI, 32, 64)
  draw._finishByCount()
  assert.equal(draw.result, 'draw')
  assert.equal(draw.getSnapshot().score, null)
})

test('暂停冻结计时，恢复后只累加新时段', () => {
  let clock = 0
  const engine = makeEngine('easy', { now: () => clock })
  assert.equal(engine.tap(26), true)

  clock = 10000
  engine.pause()
  assert.ok(Math.abs(engine._elapsed() - 10) < 0.2, `暂停时应为 10s，实际 ${engine._elapsed()}`)
  clock = 40000
  assert.ok(Math.abs(engine._elapsed() - 10) < 0.2, '暂停期间计时不应增长')

  engine.resume()
  clock = 45000
  assert.ok(Math.abs(engine._elapsed() - 15) < 0.2, `恢复 5s 后应为 15s，实际 ${engine._elapsed()}`)
})

test('超时：倒计时归零进入 over/timeout，剩余 0 且不计分', () => {
  let clock = 0
  let over = null
  const engine = new ReversiEngine(
    { onGameOver: (score, elapsed, result) => { over = { score, elapsed, result } } },
    { random: () => 0.5, now: () => clock },
  )
  engine.start('normal')
  assert.equal(engine.tap(26), true)

  clock = (DIFFICULTY.normal.limitSec + 5) * 1000
  engine.tick()
  assert.equal(engine.state, 'over')
  assert.equal(engine.result, 'timeout')
  assert.equal(engine.getSnapshot().remaining, 0)
  assert.equal(over.result, 'timeout')
  assert.equal(over.score, 0)
})

test('三档 AI：都只落在合法点上，落子后回到玩家回合', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    const engine = makeEngine(level)
    assert.equal(engine.tap(26), true)
    const legalBefore = engine._legalList(engine.board, AI)
    assert.ok(legalBefore.length > 0, `${level} 档电脑应有合法点`)

    const aiIdx = engine.aiTurn()
    assert.ok(legalBefore.includes(aiIdx), `${level} 档电脑落点 ${aiIdx} 不合法`)
    assert.equal(engine.board[aiIdx], AI)
    assert.equal(engine.turn, 'player')
    assert.ok(engine.moves >= 2)
  }
})

test('计分：步数与用时扣分后封底 100', () => {
  const engine = makeEngine('easy')
  engine.moves = 20
  engine.elapsedBase = 30000 // 30s
  engine.state = 'over'
  const expected = DIFFICULTY.easy.baseScore - 20 * REVERSI.MOVE_PENALTY - 30 * REVERSI.SEC_PENALTY
  assert.equal(engine._score(), expected)

  engine.moves = 200
  engine.elapsedBase = 600000
  assert.equal(engine._score(), REVERSI.MIN_SCORE)
})

test('完整对局：随机玩家 + 电脑可跑到终局，棋子总数不超过 64', () => {
  let clock = 0
  const engine = makeEngine('normal', { now: () => clock })

  for (let i = 0; i < 300 && engine.state === 'playing'; i++) {
    clock += 200 // 跨过 150ms 节流窗口
    if (engine.turn === 'player') {
      const moves = engine.getLegalMoves()
      if (!moves.length) break
      engine.tap(moves[moves.length - 1])
    } else {
      engine.aiTurn()
    }
  }

  assert.equal(engine.state, 'over')
  assert.ok(['win', 'lose', 'draw'].includes(engine.result))
  const { player, ai } = engine.getSnapshot().counts
  assert.ok(player + ai <= 64)
})

test('重新 start 重置棋盘、回合、步数与计时，且可换难度', () => {
  const engine = makeEngine('hard')
  engine.tap(26)
  engine.aiTurn()
  engine.start('easy')

  const snap = engine.getSnapshot()
  assert.equal(snap.state, 'playing')
  assert.equal(snap.level, 'easy')
  assert.equal(snap.moves, 0)
  assert.equal(snap.turn, 'player')
  assert.equal(snap.passes, 0)
  assert.equal(snap.elapsed, 0)
  assert.equal(snap.board.some(Boolean), true)
  assert.equal(snap.board.filter(Boolean).length, 4)
  assert.deepEqual(snap.legal, [19, 26, 37, 44])
})

test('dispose 后不再回调页面', () => {
  let calls = 0
  const engine = new ReversiEngine({ onState: () => { calls += 1 } }, { random: () => 0.5 })
  engine.start('easy')
  const before = calls
  engine.dispose()
  engine.tap(26)
  assert.equal(calls, before)
})
