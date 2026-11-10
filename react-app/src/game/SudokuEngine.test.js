/**
 * SudokuEngine 单元测试（node:test，零依赖）
 * 覆盖：生成（已知格数/终盘合法/唯一解/可复现）、初始快照、填入校验（对/错/判负）、
 * 笔记、提示、撤销四类回退、完成判定与计分、暂停冻结、超时、非法档位、dispose。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SudokuEngine, TIERS, SUDOKU } from './SudokuEngine.js'

/** 线性同余随机源：同种子序列可复现 */
function lcg(seed = 42) {
  let s = seed >>> 0
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

function makeEngine(tier = 'easy', options = {}) {
  const engine = new SudokuEngine({}, { random: lcg(42), ...options })
  engine.start(tier)
  return engine
}

/** 终盘合法性：每行/列/宫均为 1~9 不重复 */
function assertValidSolution(solution) {
  for (let i = 0; i < 9; i++) {
    const row = new Set()
    const col = new Set()
    const box = new Set()
    for (let k = 0; k < 9; k++) {
      row.add(solution[i * 9 + k])
      col.add(solution[k * 9 + i])
      box.add(solution[(Math.floor(i / 3) * 3 + Math.floor(k / 3)) * 9 + (i % 3) * 3 + (k % 3)])
    }
    for (const set of [row, col, box]) {
      assert.equal(set.size, 9)
      assert.ok([1, 2, 3, 4, 5, 6, 7, 8, 9].every((n) => set.has(n)))
    }
  }
}

/** 把整盘填完（全部用正解），每步推进时钟 100ms */
function fillAll(engine, clock) {
  for (let i = 0; i < 81; i++) {
    if (engine.givens[i]) continue
    if (clock) clock.t += 100
    engine.place(i, engine.solution[i])
  }
}

test('生成：已知格数与三档一致，终盘合法，题目唯一解', () => {
  for (const [tier, cfg] of Object.entries(TIERS)) {
    const engine = makeEngine(tier)
    const snap = engine.getSnapshot()
    assert.equal(snap.givens.filter(Boolean).length, cfg.givens, `${tier} 已知格应为 ${cfg.givens}`)
    assert.equal(snap.values.filter((v) => v !== 0).length, cfg.givens)
    assertValidSolution(engine.solution)
    // 唯一解复核：计到 2 即停，必须恰好为 1
    assert.equal(engine._solve(Uint8Array.from(engine.values), 2), 1, `${tier} 题目必须唯一解`)
    // 挖空中心对称：idx 与 80-idx 同为空或同为已知
    for (let i = 0; i < 40; i++) {
      assert.equal(Boolean(engine.givens[i]), Boolean(engine.givens[80 - i]), `格子 ${i} 不对称`)
    }
  }
})

test('同随机源题目可复现，不同种子题目不同', () => {
  const a = makeEngine('easy')
  const b = makeEngine('easy')
  assert.deepEqual(Array.from(a.values), Array.from(b.values))
  const c = new SudokuEngine({}, { random: lcg(7) })
  c.start('easy')
  assert.notDeepEqual(Array.from(c.values), Array.from(a.values))
})

test('初始快照：playing、错误 0、提示 3、撤销不可用、计时未启动', () => {
  const engine = makeEngine('normal')
  const snap = engine.getSnapshot()
  assert.equal(snap.state, 'playing')
  assert.equal(snap.tier, 'normal')
  assert.equal(snap.tierLabel, '挑战')
  assert.equal(snap.errors, 0)
  assert.equal(snap.hintsLeft, SUDOKU.HINT_LIMIT)
  assert.equal(snap.canUndo, false)
  assert.equal(snap.started, false)
  assert.equal(snap.remaining, TIERS.normal.limitSec)
  assert.equal(snap.notes.every((n) => n.length === 0), true)
})

test('填入正确：锁定已确认、清本格笔记、剔除同行/列/宫同候选', () => {
  const engine = makeEngine('easy')
  const idx = engine.values.findIndex((v, i) => v === 0 && !engine.givens[i])
  const num = engine.solution[idx]
  const peer = engine.values.findIndex((v, i) =>
    v === 0 && !engine.givens[i] && i !== idx && (
      Math.floor(i / 9) === Math.floor(idx / 9) ||
      i % 9 === idx % 9 ||
      (Math.floor(i / 27) === Math.floor(idx / 27) && Math.floor((i % 9) / 3) === Math.floor((idx % 9) / 3)
      )
    ),
  )
  // 先给本格与邻居格记上该数字的候选
  engine.toggleNote(idx, num)
  engine.toggleNote(peer, num)
  assert.ok(engine.notes[idx] & (1 << (num - 1)))
  assert.ok(engine.notes[peer] & (1 << (num - 1)))

  assert.equal(engine.place(idx, num), 'placed')
  const snap = engine.getSnapshot()
  assert.equal(snap.values[idx], num)
  assert.equal(snap.confirmed[idx], true)
  assert.equal(snap.notes[idx].length, 0, '本格笔记应清空')
  assert.equal(snap.notes[peer].includes(num), false, '同候选应剔除')
  assert.equal(snap.lastPlaced, idx)
  assert.equal(snap.started, true, '首次有效填入启动计时')
  // 已确认格不可再改
  assert.equal(engine.place(idx, (num % 9) + 1), 'blocked')
})

test('填入错误：不写入格子、错误 +1，满 3 次判负且得分 0', () => {
  const clock = { t: 0 }
  let over = null
  const engine = new SudokuEngine(
    { onGameOver: (score, elapsed, result) => { over = { score, elapsed, result } } },
    { random: lcg(42), now: () => clock.t },
  )
  engine.start('easy')
  const blanks = [...engine.values.keys()].filter((i) => !engine.givens[i])
  const wrongAt = (i) => (engine.solution[i] % 9) + 1

  assert.equal(engine.place(blanks[0], wrongAt(blanks[0])), 'error')
  assert.equal(engine.values[blanks[0]], 0, '错误值不应写入格子')
  assert.equal(engine.errors, 1)
  assert.equal(engine.getSnapshot().lastError, blanks[0])
  assert.equal(engine.place(blanks[1], wrongAt(blanks[1])), 'error')
  assert.equal(engine.place(blanks[2], wrongAt(blanks[2])), 'fail')
  assert.equal(engine.state, 'over')
  assert.equal(engine.result, 'fail')
  assert.equal(over.result, 'fail')
  assert.equal(over.score, 0)
  // 判负后盘面锁定
  assert.equal(engine.place(blanks[3], engine.solution[blanks[3]]), 'ignored')
})

test('笔记：切换往返、不校验对错、不计错误、可撤销', () => {
  const engine = makeEngine('easy')
  const idx = engine.values.findIndex((v, i) => v === 0 && !engine.givens[i])
  assert.equal(engine.toggleNote(idx, 5), 'toggled')
  assert.ok(engine.notes[idx] & (1 << 4))
  assert.equal(engine.errors, 0)
  assert.equal(engine.toggleNote(idx, 5), 'toggled')
  assert.equal(engine.notes[idx], 0)
  // 撤销「取消候选」→ 恢复候选
  assert.equal(engine.undo(), true)
  assert.ok(engine.notes[idx] & (1 << 4))
  // 已知格与有值格不可记笔记
  const given = engine.givens.findIndex(Boolean)
  assert.equal(engine.toggleNote(given, 5), 'blocked')
})

test('擦除：清笔记可撤销；空格无笔记与已确认格返回 blocked', () => {
  const engine = makeEngine('easy')
  const idx = engine.values.findIndex((v, i) => v === 0 && !engine.givens[i])
  assert.equal(engine.erase(idx), 'blocked')
  engine.toggleNote(idx, 3)
  engine.toggleNote(idx, 7)
  assert.equal(engine.erase(idx), 'erased')
  assert.equal(engine.notes[idx], 0)
  assert.equal(engine.undo(), true)
  assert.ok(engine.notes[idx] & (1 << 2))
  assert.ok(engine.notes[idx] & (1 << 6))
})

test('提示：填正解并计已确认，未选中取第一空格，3 次用尽返回 null', () => {
  const engine = makeEngine('easy')
  const first = engine.values.findIndex((v, i) => v === 0 && !engine.givens[i])
  assert.equal(engine.hint(-1), first, '未选中时应取第一个空格')
  assert.equal(engine.values[first], engine.solution[first])
  assert.equal(engine.confirmed[first], 1)
  assert.equal(engine.hintsLeft, 2)
  assert.equal(engine.hintUsed, 1)

  const second = engine.values.findIndex((v, i) => v === 0 && !engine.givens[i])
  assert.equal(engine.hint(second), second)
  assert.ok(engine.hint() >= 0)
  assert.equal(engine.hintsLeft, 0)
  assert.equal(engine.hint(), null, '次数用尽返回 null')
})

test('撤销：回退填入并恢复邻居笔记，错误计数与扣分不恢复', () => {
  const engine = makeEngine('easy')
  const blanks = [...engine.values.keys()].filter((i) => !engine.givens[i])
  const [a, b] = blanks
  const numA = engine.solution[a]
  engine.toggleNote(b, numA)
  engine.place(a, numA) // 正确填入会剔除 b 的同候选
  assert.equal(engine.notes[b] & (1 << (numA - 1)), 0)

  // 制造一次错误（计数 +1）
  engine.place(b, (engine.solution[b] % 9) + 1)
  assert.equal(engine.errors, 1)

  assert.equal(engine.undo(), true) // 撤销 place
  assert.equal(engine.values[a], 0)
  assert.equal(engine.confirmed[a], 0)
  assert.ok(engine.notes[b] & (1 << (numA - 1)), '邻居被剔除的候选应恢复')
  assert.equal(engine.errors, 1, '撤销不恢复错误计数')

  assert.equal(engine.undo(), true) // 撤销 note
  assert.equal(engine.undo(), false) // 栈空
  assert.equal(engine.getSnapshot().canUndo, false)
})

test('完成判定：81 格全部已确认进入 win，得分按公式结算', () => {
  const clock = { t: 0 }
  let over = null
  const engine = new SudokuEngine(
    { onGameOver: (score, elapsed, result) => { over = { score, elapsed, result } } },
    { random: lcg(42), now: () => clock.t },
  )
  engine.start('easy')
  // 一次错误 + 一次提示，验证计分各项
  const first = engine.values.findIndex((v, i) => v === 0 && !engine.givens[i])
  engine.place(first, (engine.solution[first] % 9) + 1)
  engine.hint()
  fillAll(engine, clock)

  assert.equal(engine.state, 'over')
  assert.equal(engine.result, 'win')
  assert.ok(over && over.result === 'win')
  const expected = Math.max(
    SUDOKU.MIN_SCORE,
    TIERS.easy.baseScore
      - Math.floor(engine._elapsed()) * SUDOKU.SEC_PENALTY
      - 1 * SUDOKU.ERROR_PENALTY
      - 1 * SUDOKU.HINT_PENALTY,
  )
  assert.equal(over.score, expected)
  assert.equal(engine.getSnapshot().score, expected)
})

test('计分封底：重罚下不低于 100', () => {
  const engine = makeEngine('easy')
  engine.errors = 2
  engine.hintUsed = 3
  engine.elapsedBase = 3600000
  engine.state = 'over'
  engine.result = 'win'
  assert.equal(engine._score(), SUDOKU.MIN_SCORE)
})

test('暂停：填入/提示/撤销被拒绝，计时冻结，恢复后只累加新时段', () => {
  const clock = { t: 0 }
  const engine = makeEngine('normal', { now: () => clock.t })
  const idx = engine.values.findIndex((v, i) => v === 0 && !engine.givens[i])
  engine.place(idx, engine.solution[idx])

  clock.t = 10000
  engine.pause()
  assert.equal(engine.state, 'paused')
  const next = engine.values.findIndex((v, i) => v === 0 && !engine.givens[i])
  assert.equal(engine.place(next, engine.solution[next]), 'ignored')
  assert.equal(engine.hint(), null)
  assert.equal(engine.undo(), false)
  clock.t = 40000
  assert.ok(Math.abs(engine._elapsed() - 10) < 0.2, `暂停期间应保持 10s，实际 ${engine._elapsed()}`)

  engine.resume()
  clock.t = 45000
  assert.ok(Math.abs(engine._elapsed() - 15) < 0.2, `恢复 5s 后应为 15s，实际 ${engine._elapsed()}`)
})

test('超时：倒计时归零进入 over/timeout，得分 0；未启动计时不判超时', () => {
  const clock = { t: 0 }
  let over = null
  const engine = new SudokuEngine(
    { onGameOver: (score, elapsed, result) => { over = { score, elapsed, result } } },
    { random: lcg(42), now: () => clock.t },
  )
  engine.start('easy')
  clock.t = (TIERS.easy.limitSec + 5) * 1000
  engine.tick()
  assert.equal(engine.state, 'playing', '未填入前不计时，不判超时')

  const idx = engine.values.findIndex((v, i) => v === 0 && !engine.givens[i])
  clock.t += 100 // place 会以 300s+ 为基准重启时钟，先回拨保证 place 生效
  clock.t = 0
  engine.place(idx, engine.solution[idx])
  clock.t = (TIERS.easy.limitSec + 5) * 1000
  engine.tick()
  assert.equal(engine.state, 'over')
  assert.equal(engine.result, 'timeout')
  assert.equal(over.result, 'timeout')
  assert.equal(over.score, 0)
  assert.equal(engine.getSnapshot().remaining, 0)
})

test('非法档位回退 easy；非 playing 状态操作均不生效', () => {
  const engine = new SudokuEngine({}, { random: lcg(42) })
  engine.start('not-a-tier')
  assert.equal(engine.tier, 'easy')

  const fresh = new SudokuEngine({}, { random: lcg(42) })
  assert.equal(fresh.place(0, 5), 'ignored')
  assert.equal(fresh.toggleNote(0, 5), 'ignored')
  assert.equal(fresh.erase(0), 'ignored')
  assert.equal(fresh.hint(), null)
  assert.equal(fresh.undo(), false)
})

test('dispose 后不再回调页面', () => {
  let calls = 0
  const engine = new SudokuEngine({ onState: () => { calls += 1 } }, { random: lcg(42) })
  engine.start('easy')
  const before = calls
  engine.dispose()
  const idx = engine.values.findIndex((v, i) => v === 0 && !engine.givens[i])
  engine.place(idx, engine.solution[idx])
  assert.equal(calls, before)
})
