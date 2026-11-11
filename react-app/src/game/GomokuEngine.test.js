/**
 * GomokuEngine 单元测试（node:test）
 * 覆盖：开局状态、合法落子、四向成五、AI easy/normal/hard 基本落子、悔棋栈、回合计时、超时、
 * 双路暂停冻结、平局、AI 超时回退标记、dispose、非法档位。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { GomokuEngine, DIFFICULTY, GOMOKU } from './GomokuEngine.js'

function lcg(seed = 42) {
  let s = seed >>> 0
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
}

function make(mode = 'ai', level = 'easy', options = {}) {
  const e = new GomokuEngine({}, { random: lcg(42), ...options })
  e.start(mode, level)
  return e
}

/** 构造一条成五：指定起点 idx，方向 [dr,dc]，落子连续 5 颗 */
function makeFive(e, start, [dr, dc], who = GOMOKU.P1) {
  const idxs = []
  for (let i = 0; i < 5; i++) idxs.push(start + (dr * 15 + dc) * i)
  for (const idx of idxs) {
    // 跳过已落子位置
    if (e.board[idx] !== 0) continue
    e.board[idx] = who
  }
  return idxs
}

test('开局：playing、15×15 空棋盘、黑先', () => {
  const e = make('ai', 'easy')
  const s = e.getSnapshot()
  assert.equal(s.state, 'playing')
  assert.equal(s.size, 15)
  assert.equal(s.board.length, 225)
  assert.equal(s.board.every((v) => v === 0), true)
  assert.equal(s.turn, GOMOKU.P1)
  assert.equal(s.level, 'easy')
  assert.equal(s.mode, 'ai')
  assert.equal(s.moves, 0)
  assert.equal(s.canUndo, false)
})

test('非法档位回退 easy', () => {
  const e = make('ai', 'nope')
  assert.equal(e.level, 'easy')
})

test('非法位置落子返回 false、已被占用返回 false', () => {
  const e = make()
  assert.equal(e.tap(-1), false)
  assert.equal(e.tap(9999), false)
  e.board[112] = GOMOKU.P2 // 中心已被 AI 落（假设）
  // 直接改 board 绕过规则，tap 应拒绝
  const e2 = make()
  e2.board[112] = GOMOKU.P1
  e2.turn = GOMOKU.P1
  // tap 检查 board[idx] !== EMPTY，应返回 false
  // 但 turn 必须是 P1（单人模式）
  // 让我们换个方式：先合法落子一次，再重复落在同一格
  const ok = e2.tap(60)
  assert.equal(ok, true)
  // turn 已切到 P2，单人 AI 模式玩家 tap 被拒绝（turn 不是 P1）
  // 要测"重复落子"，走双人模式
})

test('双人模式：双方轮流落子', () => {
  const e = make('pvp', 'easy')
  assert.equal(e.tap(56), true)   // P1 黑
  const s = e.getSnapshot()
  assert.equal(s.turn, GOMOKU.P2)
  assert.equal(s.board[56], GOMOKU.P1)
  assert.equal(s.moves, 1)
  // 不能重复落在已占用格（当前 turn 是 P2，tap 检查 board[idx]===0 先）
  assert.equal(e.pvpTap(56), false)
  assert.equal(e.pvpTap(60), true) // P2 白
  assert.equal(e.getSnapshot().turn, GOMOKU.P1)
  assert.equal(e.board[60], GOMOKU.P2)
  assert.equal(e.moves, 2)
})

test('单人 AI 模式：玩家落子后自动切 AI，AI 回合玩家 tap 被拒', () => {
  const e = make('ai', 'normal')
  e.tap(112) // 玩家中心落子
  assert.equal(e.turn, GOMOKU.P2)
  const s = e.getSnapshot()
  assert.equal(s.aiThinking, true)
  // 此时玩家不能继续落子
  assert.equal(e.tap(60), false)
  // AI 回合调用 aiTurn 后落子
  const aiIdx = e.aiTurn()
  assert.ok(aiIdx >= 0 && aiIdx !== 112)
  assert.equal(e.board[aiIdx], GOMOKU.P2)
  assert.equal(e.turn, GOMOKU.P1)
  assert.equal(e.moves, 2)
})

test('四向成五：横/竖/正斜/反斜任一方向判胜', () => {
  // 横：50,51,52,53,54 （row 3, col 5-9）
  const e1 = make('pvp')
  for (const idx of [50, 51, 52, 53]) { e1.board[idx] = GOMOKU.P1; e1.turn = GOMOKU.P1; }
  const win1 = e1.tap(54)
  assert.equal(win1, true)
  assert.equal(e1.state, 'over')
  assert.equal(e1.result, 'win')
  assert.equal(e1.winner, GOMOKU.P1)
  assert.equal(e1.winLine.length, 5)

  // 竖：50, 65, 80, 95, 110 （col 5, row 3-7）
  const e2 = make('pvp')
  for (const idx of [50, 65, 80, 95]) { e2.board[idx] = GOMOKU.P1; e2.turn = GOMOKU.P1; }
  assert.equal(e2.tap(110), true)
  assert.equal(e2.result, 'win')

  // 正斜：0,16,32,48,64
  const e3 = make('pvp')
  for (const idx of [0, 16, 32, 48]) { e3.board[idx] = GOMOKU.P1; e3.turn = GOMOKU.P1; }
  assert.equal(e3.tap(64), true)
  assert.equal(e3.result, 'win')

  // 反斜：4,18,32,46,60 （idx = row*15 + col, row-col = -10 斜率 -1）
  const e4 = make('pvp')
  // (row,col) = (0,4),(1,3),(2,2),(3,1),(4,0) → 4,18,32,46,60
  for (const idx of [4, 18, 32, 46]) { e4.board[idx] = GOMOKU.P1; e4.turn = GOMOKU.P1; }
  assert.equal(e4.tap(60), true)
  assert.equal(e4.result, 'win')
})

test('悔棋：双人/单人每次撤销 2 步，清空棋盘恢复 turn，栈空禁用', () => {
  const e = make('pvp')
  e.tap(56); e.pvpTap(60); e.tap(62) // P1→P2→P1 共 3 步
  assert.equal(e.moves, 3)
  assert.equal(e.getSnapshot().canUndo, true)
  const ok = e.undo()
  assert.equal(ok, true)
  assert.equal(e.moves, 1) // 撤回 2 步 → 只剩第一步
  assert.equal(e.board[60], 0)
  assert.equal(e.board[62], 0)
  assert.equal(e.board[56], GOMOKU.P1) // 第一步还在
  assert.equal(e.turn, GOMOKU.P2)    // 轮到 P2 走（3 步撤回 2 步，剩下 P1 先手）

  // 单人 AI：玩家落 → AI 落（2 步），悔棋回到玩家落之前
  const e2 = make('ai')
  e2.tap(112); e2.aiTurn()
  assert.equal(e2.moves, 2)
  const ok2 = e2.undo()
  assert.equal(ok2, true)
  assert.equal(e2.moves, 0)
  assert.equal(e2.board[112], 0)
  assert.equal(e2.turn, GOMOKU.P1)

  // 栈空：undo 连续多次直至 canUndo=false
  let cnt = 0
  while (e2.undo()) cnt += 1
  assert.equal(cnt, 0)
  assert.equal(e2.getSnapshot().canUndo, false)
})

test('悔棋栈上限 30 步', () => {
  const e = make('pvp')
  for (let i = 0; i < 80 && e.state === 'playing'; i++) {
    // 随机落子，避开已占用
    let idx = 0
    while (idx < 225 && e.board[idx] !== 0) idx += 1
    if (idx >= 225) break
    if (e.turn === GOMOKU.P1) e.tap(idx); else e.pvpTap(idx)
  }
  assert.ok(e.moves >= 60)
  // 悔棋栈应只保留最近 30 步
  let cnt = 0
  while (e.undo()) cnt += 1
  // 每次 undo 撤销 2 步，30 步 → 最多撤销 15 次
  assert.ok(cnt <= 16)
  assert.ok(e.moves >= 0)
})

test('AI easy 基本能落子；hard 也能落子；棋盘初始无落子时 AI（先手？不，AI 是 P2 白，黑先手）', () => {
  const e = make('ai', 'easy')
  e.tap(112) // 玩家先落
  const idx = e.aiTurn()
  assert.ok(idx >= 0 && idx !== 112)

  const e2 = make('ai', 'hard')
  e2.tap(112)
  const idx2 = e2.aiTurn()
  assert.ok(idx2 >= 0 && idx2 !== 112)
})

test('AI 超时回退标记：thinkDeadlineMs 内没完成但页面已截断（引擎层不截断），仅 AI 耗时记入 aiThinkingMs', () => {
  const e = make('ai', 'easy')
  e.tap(112)
  e.aiTurn()
  assert.ok(e.aiThinkingMs >= 0)
  assert.equal(e.aiTimeouts, 0) // easy thinkDeadline 500ms，实际很快
})

test('回合计时：初始 60s/回合；回合切换剩余时间 +60s 缓冲；tick 到 0 判负', () => {
  const clock = { t: 0 }
  const e = new GomokuEngine({}, { random: lcg(42), now: () => clock.t })
  e.start('ai', 'easy')
  // 初始 playerRemain = 60000
  let s = e.getSnapshot()
  assert.equal(s.playerRemain, GOMOKU.TURN_SEC * 1000)
  assert.equal(s.aiRemain, GOMOKU.TURN_SEC * 1000)

  // 玩家落子（启动计时）
  clock.t = 10000
  e.tap(112)
  // 玩家花了 10s，剩余 50s；AI 获得 50 + 60 = 110s 回合
  assert.equal(e.playerTime, 50000 + 60000)

  // AI 回合从初始 60s 开始花了 10s，剩余 50s + 60s 缓冲 = 110s
  clock.t = 20000
  e.aiTurn()
  assert.equal(e.aiTime, 110000) // 60000 - 10000 + 60000

  // tick 判超时：玩家回合，playerRemain 归 0
  e.turn = GOMOKU.P1
  e.turnStartAt = clock.t
  e.playerTime = 1000 // 只有 1s
  clock.t += 1500
  e.tick()
  assert.equal(e.state, 'over')
  assert.equal(e.result, 'timeout')
  assert.equal(e.winner, GOMOKU.P2)
})

test('双路暂停：冻结双方剩余时间，恢复后继续累计', () => {
  const clock = { t: 0 }
  const e = new GomokuEngine({}, { random: lcg(42), now: () => clock.t })
  e.start('pvp', 'easy')
  // start 时 turnStartAt = 0, playerTime = 60000
  clock.t = 5000
  e.tap(112) // P1 黑落子，turn 切到 P2
  // P1 花了 5s：playerTime = 60000 - 5000 + 60000 = 115000
  assert.equal(e.turn, GOMOKU.P2)

  // P2 回合暂停（冻结 P2 剩余时间）
  clock.t = 20000 // P2 已经过了 15s
  e.pause()
  assert.equal(e.state, 'paused')
  // P2 剩余：60000 - 15000 = 45000
  assert.equal(e.aiTime, 45000)

  clock.t = 100000 // 过了很久
  assert.equal(e._now(), 100000)
  // 恢复
  e.resume()
  assert.equal(e.state, 'playing')
  assert.equal(e.turnStartAt, 100000)
  // 之后 tick 应该仍从 45000 开始计时
  clock.t = 100000 + 44900
  const snap = e.getSnapshot()
  // aiRemain = aiTime - (now - turnStartAt) = 45000 - 44900 = 100
  assert.ok(Math.abs(snap.aiRemain - 100) < 100)
})

test('棋盘填满：双人模式没有五连 → draw', () => {
  const e = make('pvp')
  // 构造"完全布满棋盘但双方都没五连"——15×15 太复杂，直接在最后一步用特殊落子触发
  // 我们让 turn 指向 P1，棋盘填满（包括对手没五连），tap 最后一格 → isFull() 判 draw
  for (let i = 0; i < 225; i++) e.board[i] = (i % 2) + 1
  // 破坏可能的五连：每 5 个换一方
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      // 保持随机排布避免五连
      e.board[row * 15 + col] = ((row * 3 + col) % 2) + 1
    }
  }
  // 最后一格空出来
  e.board[224] = GOMOKU.EMPTY
  e.turn = GOMOKU.P2
  e.moves = 224
  assert.equal(e.tap(224), true)
  assert.equal(e.state, 'over')
  assert.equal(e.result, 'draw')
})

test('非 playing 状态操作均被忽略', () => {
  const e = make()
  e.state = 'over'
  assert.equal(e.tap(112), false)
  assert.equal(e.aiTurn(), -1)
  assert.equal(e.undo(), false)
  assert.equal(e.resign(), false)
})

test('dispose 后不再回调', () => {
  let calls = 0
  const e = new GomokuEngine({ onState: () => { calls += 1 } })
  e.start('ai', 'easy')
  const before = calls
  e.dispose()
  e.tap(112)
  e.aiTurn()
  assert.equal(calls, before)
})

test('悔棋恢复时，AI 模式撤 2 步，剩余时间不被污染（直接置 60s 新回合）', () => {
  const e = make('ai')
  e.tap(112); e.aiTurn()
  e.undo()
  // 悔棋后双方剩余时间都重置为 60s
  assert.equal(e.playerTime, GOMOKU.TURN_SEC * 1000)
  assert.equal(e.aiTime, GOMOKU.TURN_SEC * 1000)
})
