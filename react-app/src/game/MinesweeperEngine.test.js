/**
 * MinesweeperEngine 单元测试（node:test，零依赖）
 * 覆盖：三档几何、首点安全与八邻域排除、洪泛展开、非法翻开、插旗与上限、
 * 频率节流、撤销（翻开/插旗/首次翻开重置）、踩雷、胜利、暂停冻结、超时、重开、dispose。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { MinesweeperEngine, DIFFICULTY, MINESWEEPER } from './MinesweeperEngine.js'

/** 可控时钟引擎：now 返回内部 clock，测试用 advance 推进 */
function create(level = 'easy', cb = {}, options = {}) {
  let clock = 0
  const engine = new MinesweeperEngine(cb, { random: () => 0.5, now: () => clock, ...options })
  engine.start(level)
  return {
    engine,
    advance(ms = 200) { clock += ms },
    at(ms) { clock = ms },
    clock() { return clock },
  }
}

/** 找一个未翻开、未插旗的安全格 */
function findHiddenSafe(engine, skip = []) {
  for (let i = 0; i < engine.size; i++) {
    if (skip.includes(i)) continue
    if (!engine.revealedArr[i] && !engine.flaggedArr[i] && !engine.mineArr[i]) return i
  }
  return -1
}

test('三档几何：行列/雷数/安全格数与初始状态', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    const { engine } = create(level)
    const cfg = DIFFICULTY[level]
    const snap = engine.getSnapshot()

    assert.equal(snap.state, 'playing')
    assert.equal(snap.rows, cfg.rows)
    assert.equal(snap.cols, cfg.cols)
    assert.equal(snap.mines, cfg.mines)
    assert.equal(snap.cells.length, cfg.rows * cfg.cols)
    assert.equal(snap.safeTotal, cfg.rows * cfg.cols - cfg.mines)
    assert.equal(snap.safeRevealed, 0)
    assert.equal(snap.flagsUsed, 0)
    assert.equal(snap.undoLeft, MINESWEEPER.UNDO_LIMIT)
    assert.equal(snap.started, false)
    assert.equal(snap.remaining, cfg.limitSec)
    assert.ok(snap.cells.every((c) => !c.revealed && !c.flagged && !c.mine))
  }
})

test('首点安全：首次翻开才布雷，首点及其八邻域均无雷', () => {
  const { engine, advance } = create('easy')
  advance(200)
  const first = 24
  assert.equal(engine.minesPlaced, false)
  assert.equal(engine.reveal(first), true)

  assert.equal(engine.minesPlaced, true)
  assert.equal(engine.mineArr[first], 0)
  for (const n of engine._neighbors(first)) assert.equal(engine.mineArr[n], 0, `邻域 ${n} 不应有雷`)
  let total = 0
  for (let i = 0; i < engine.size; i++) total += engine.mineArr[i]
  assert.equal(total, DIFFICULTY.easy.mines)
  assert.equal(engine.getSnapshot().cells[first].revealed, true)
})

test('洪泛展开：首点周围安全区一次翻开，计数与已翻开格一致', () => {
  const { engine, advance } = create('easy')
  advance(200)
  engine.reveal(24)

  const snap = engine.getSnapshot()
  const revealed = snap.cells.filter((c) => c.revealed).length
  assert.equal(snap.lastReveal.flooded, true)
  assert.equal(snap.lastReveal.count, revealed)
  assert.ok(revealed >= 9, `首点 3×3 邻域应全部翻开，实际 ${revealed}`)
  assert.equal(snap.safeRevealed, revealed)
})

test('非法翻开：已翻开、已插旗、越界、非整数一律忽略', () => {
  const { engine, advance } = create('easy')
  advance(200)
  engine.reveal(24)
  const opened = engine.getSnapshot().cells.find((c) => c.revealed).idx

  assert.equal(engine.reveal(opened), false, '已翻开')
  assert.equal(engine.reveal(-1), false)
  assert.equal(engine.reveal(49), false)
  assert.equal(engine.reveal(1.5), false)

  advance(200)
  const hidden = findHiddenSafe(engine)
  assert.equal(engine.toggleFlag(hidden), true)
  advance(200)
  assert.equal(engine.reveal(hidden), false, '已插旗的格子不能直接翻开')
})

test('插旗与上限：切换进入/撤销，旗子数量不超过雷数', () => {
  const { engine, advance } = create('easy')
  advance(200)
  assert.equal(engine.toggleFlag(0), true)
  assert.equal(engine.getSnapshot().flagsUsed, 1)
  assert.equal(engine.getSnapshot().lastAction, 'flag')
  assert.equal(engine.getSnapshot().cells[0].flagged, true)

  advance(200)
  assert.equal(engine.toggleFlag(0), true)
  assert.equal(engine.getSnapshot().flagsUsed, 0)
  assert.equal(engine.getSnapshot().lastAction, 'unflag')

  for (let i = 1; i <= DIFFICULTY.easy.mines; i++) {
    advance(200)
    assert.equal(engine.toggleFlag(i), true)
  }
  advance(200)
  assert.equal(engine.getSnapshot().flagsUsed, DIFFICULTY.easy.mines)
  assert.equal(engine.toggleFlag(DIFFICULTY.easy.mines + 1), false, '旗子用完不能再插')
})

test('频率节流：120ms 内的重复操作被忽略', () => {
  const { engine, advance, at } = create('easy')
  at(1000)
  assert.equal(engine.reveal(24), true)
  const hidden = findHiddenSafe(engine)

  assert.equal(engine.toggleFlag(hidden), false, '同一毫秒内被节流')
  advance(MINESWEEPER.MIN_TAP_INTERVAL_MS - 1)
  assert.equal(engine.toggleFlag(hidden), false, '不足 120ms 仍被节流')
  advance(1)
  assert.equal(engine.toggleFlag(hidden), true, '满 120ms 后放行')
})

test('撤销插旗：恢复旗子状态，次数递减且不影响步数', () => {
  const { engine, advance } = create('easy')
  advance(200)
  engine.toggleFlag(0)
  const moves = engine.getSnapshot().moves
  advance(200)

  assert.equal(engine.undo(), true)
  const snap = engine.getSnapshot()
  assert.equal(snap.cells[0].flagged, false)
  assert.equal(snap.flagsUsed, 0)
  assert.equal(snap.undoLeft, MINESWEEPER.UNDO_LIMIT - 1)
  assert.equal(snap.moves, moves)
  assert.equal(snap.lastAction, 'undo')
})

test('撤销翻开：本步展开的格子重新盖回，安全计数回退', () => {
  const { engine, advance } = create('easy')
  advance(200)
  engine.reveal(24)
  const afterFirst = engine.getSnapshot().safeRevealed

  advance(200)
  const second = findHiddenSafe(engine)
  assert.ok(second >= 0)
  engine.reveal(second)
  const afterSecond = engine.getSnapshot().safeRevealed
  assert.ok(afterSecond > afterFirst)

  advance(200)
  assert.equal(engine.undo(), true)
  const snap = engine.getSnapshot()
  assert.equal(snap.safeRevealed, afterFirst)
  assert.equal(snap.cells[second].revealed, false)
  assert.equal(snap.undoLeft, MINESWEEPER.UNDO_LIMIT - 1)
})

test('撤销首次翻开：雷区与计时重置，可换首点重开', () => {
  const { engine, advance, at } = create('easy')
  advance(200)
  engine.reveal(24)
  at(2200)
  assert.ok(engine.getSnapshot().elapsed > 0)

  advance(200)
  assert.equal(engine.undo(), true)
  const snap = engine.getSnapshot()
  assert.equal(engine.minesPlaced, false)
  assert.equal(snap.started, false)
  assert.equal(snap.elapsed, 0)
  assert.equal(snap.safeRevealed, 0)
  assert.equal(snap.cells.some((c) => c.revealed), false)
  assert.equal(snap.undoLeft, MINESWEEPER.UNDO_LIMIT - 1)

  advance(200)
  assert.equal(engine.reveal(10), true, '换首点可重新布雷')
  assert.equal(engine.mineArr[10], 0)
})

test('撤销次数上限：三次用尽后返回 false', () => {
  const { engine, advance } = create('easy')
  for (let i = 0; i < MINESWEEPER.UNDO_LIMIT; i++) {
    advance(200)
    engine.toggleFlag(i)
  }
  for (let i = 0; i < MINESWEEPER.UNDO_LIMIT; i++) {
    advance(200)
    assert.equal(engine.undo(), true)
  }
  advance(200)
  assert.equal(engine.getSnapshot().undoLeft, 0)
  assert.equal(engine.undo(), false, '次数用尽后不可再撤销')
})

test('踩雷即负：暴露全部雷位、标出踩中格、不计分且不可撤销', () => {
  let over = null
  const { engine, advance } = create('easy', {
    onGameOver: (score, elapsed, result) => { over = { score, elapsed, result } },
  })
  advance(200)
  engine.reveal(24)

  let mineIdx = -1
  for (let i = 0; i < engine.size; i++) if (engine.mineArr[i]) { mineIdx = i; break }
  assert.ok(mineIdx >= 0)
  advance(200)
  assert.equal(engine.reveal(mineIdx), true)

  const snap = engine.getSnapshot()
  assert.equal(snap.state, 'over')
  assert.equal(snap.result, 'lose')
  assert.equal(snap.score, null)
  assert.equal(snap.cells[mineIdx].boom, true)
  assert.equal(snap.cells.filter((c) => c.mine).length, DIFFICULTY.easy.mines)
  assert.ok(over && over.result === 'lose' && over.score === 0)
  advance(200)
  assert.equal(engine.undo(), false, '局末不可撤销')
})

test('清空安全格即胜：剩余雷位公开并计正分', () => {
  let over = null
  const { engine, advance } = create('normal', {
    onGameOver: (score, elapsed, result) => { over = { score, elapsed, result } },
  })
  advance(200)
  engine.reveal(27)

  // 人为把除一格安全格以外的安全格都翻开，验证收尾判断
  let lastSafe = -1
  for (let i = engine.size - 1; i >= 0; i--) {
    if (!engine.mineArr[i]) { lastSafe = i; break }
  }
  for (let i = 0; i < engine.size; i++) {
    if (!engine.mineArr[i] && i !== lastSafe) engine.revealedArr[i] = 1
  }
  engine.safeRevealed = engine.safeTotal - 1

  advance(200)
  assert.equal(engine.reveal(lastSafe), true)
  const snap = engine.getSnapshot()
  assert.equal(snap.state, 'over')
  assert.equal(snap.result, 'win')
  assert.ok(snap.score >= MINESWEEPER.MIN_SCORE)
  assert.equal(snap.cells.filter((c) => c.mine).length, DIFFICULTY.normal.mines)
  assert.equal(engine.revealedArr[lastSafe], 1)
  assert.ok(over && over.result === 'win' && over.score > 0)
})

test('暂停冻结计时，恢复后只累加新时段', () => {
  const { engine, advance, at } = create('easy')
  advance(200)
  engine.reveal(24)

  at(10200)
  engine.pause()
  assert.equal(engine.state, 'paused')
  assert.ok(Math.abs(engine._elapsed() - 10) < 0.2, `暂停时应为 10s，实际 ${engine._elapsed()}`)
  at(40000)
  assert.ok(Math.abs(engine._elapsed() - 10) < 0.2, '暂停期间计时不应增长')

  engine.resume()
  at(45000)
  assert.ok(Math.abs(engine._elapsed() - 15) < 0.2, `恢复 5s 后应为 15s，实际 ${engine._elapsed()}`)
})

test('超时：倒计时归零进入 over/timeout，不计分且不公开雷位', () => {
  let over = null
  const { engine, advance, at } = create('easy', {
    onGameOver: (score, elapsed, result) => { over = { score, elapsed, result } },
  })
  advance(200)
  engine.reveal(24)
  const before = engine.getSnapshot().cells.filter((c) => c.mine).length
  assert.equal(before, 0, '进行中不公开雷位')

  at((DIFFICULTY.easy.limitSec + 5) * 1000)
  engine.tick()
  const snap = engine.getSnapshot()
  assert.equal(snap.state, 'over')
  assert.equal(snap.result, 'timeout')
  assert.equal(snap.remaining, 0)
  assert.equal(snap.score, null)
  assert.equal(snap.cells.filter((c) => c.mine).length, 0, '超时不公开雷位')
  assert.ok(over && over.result === 'timeout' && over.score === 0)
})

test('重新 start 重置棋盘并可切换难度', () => {
  const { engine, advance } = create('easy')
  advance(200)
  engine.reveal(24)

  engine.start('hard')
  const snap = engine.getSnapshot()
  assert.equal(snap.level, 'hard')
  assert.equal(snap.rows, DIFFICULTY.hard.rows)
  assert.equal(snap.cols, DIFFICULTY.hard.cols)
  assert.equal(snap.mines, DIFFICULTY.hard.mines)
  assert.equal(snap.state, 'playing')
  assert.equal(snap.safeRevealed, 0)
  assert.equal(snap.flagsUsed, 0)
  assert.equal(snap.elapsed, 0)
  assert.equal(snap.undoLeft, MINESWEEPER.UNDO_LIMIT)
  assert.equal(snap.cells.some((c) => c.revealed), false)
})

test('dispose 后不再回调页面', () => {
  let calls = 0
  const engine = new MinesweeperEngine({ onState: () => { calls += 1 } }, { random: () => 0.5 })
  engine.start('easy')
  const before = calls
  engine.dispose()
  engine.reveal(24)
  assert.equal(calls, before)
})
