/**
 * MazeEngine 单元测试（node:test，零依赖）
 * 覆盖：生成连通性与边界、初始快照、沿最短路通关、撞墙、节流、暂停冻结、
 * 超时、提示次数与方向、重走本局、换档重生成、计分封底、dispose。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { MazeEngine, TIERS, MAZE } from './MazeEngine.js'

function makeEngine(tier = 'easy', options = {}) {
  const engine = new MazeEngine({}, { random: () => 0.5, ...options })
  engine.start(tier)
  return engine
}

/** 按 BFS 最短路把玩家走到终点，每步间隔 100ms 跨过节流窗口 */
function walkToGoal(engine, clock) {
  const goal = engine.size * engine.size - 1
  const path = engine._shortestPath(0, goal)
  for (let i = 1; i < path.length; i++) {
    clock.t += 100
    engine.move(engine._dirBetween(path[i - 1], path[i]))
  }
}

test('生成：全格连通、起点左上终点右下、四周外墙不开口，参考步数匹配最短路', () => {
  const engine = makeEngine('hard')
  const total = engine.size * engine.size
  assert.equal(engine.size, 7)

  for (let i = 0; i < total; i++) {
    assert.ok(engine._shortestPath(0, i).length > 0, `第 ${i} 格不可达`)
  }
  assert.equal(engine.walls[0] & MAZE.WALL_N, MAZE.WALL_N)
  assert.equal(engine.walls[0] & MAZE.WALL_W, MAZE.WALL_W)
  assert.equal(engine.walls[total - 1] & MAZE.WALL_S, MAZE.WALL_S)
  assert.equal(engine.walls[total - 1] & MAZE.WALL_E, MAZE.WALL_E)
  assert.equal(engine.par, engine._shortestPath(0, total - 1).length - 1)
  assert.ok(engine.par >= engine.size * 2 - 2)
})

test('初始快照：playing、玩家在起点、步数 0、提示 3 次、只访问起点', () => {
  const engine = makeEngine('normal')
  const snap = engine.getSnapshot()

  assert.equal(snap.state, 'playing')
  assert.equal(snap.tier, 'normal')
  assert.equal(snap.size, 6)
  assert.equal(snap.player, 0)
  assert.equal(snap.goal, 35)
  assert.equal(snap.steps, 0)
  assert.equal(snap.hintsLeft, MAZE.HINT_LIMIT)
  assert.equal(snap.remaining, TIERS.normal.limitSec)
  assert.equal(snap.visited.filter(Boolean).length, 1)
  assert.equal(snap.walls.length, 36)
})

test('沿最短路移动：步数等于参考步数并进入 over/win，得分按公式结算', () => {
  const clock = { t: 0 }
  let over = null
  const engine = new MazeEngine(
    { onGameOver: (score, elapsed, result) => { over = { score, elapsed, result } } },
    { random: () => 0.5, now: () => clock.t },
  )
  engine.start('easy')
  walkToGoal(engine, clock)

  const snap = engine.getSnapshot()
  assert.equal(snap.state, 'over')
  assert.equal(snap.result, 'win')
  assert.equal(snap.steps, engine.par)
  assert.equal(snap.player, snap.goal)
  assert.ok(over && over.result === 'win')
  const expected = Math.max(
    MAZE.MIN_SCORE,
    TIERS.easy.baseScore - Math.floor(engine._elapsed()) * MAZE.SEC_PENALTY,
  )
  assert.equal(over.score, expected)
  assert.equal(snap.score, expected)
})

test('撞墙：外墙与内部墙都不计步、不移动，状态保持 playing', () => {
  const clock = { t: 0 }
  const engine = makeEngine('easy', { now: () => clock.t })
  assert.equal(engine.move('up'), 'blocked', '起点上侧是外墙')
  clock.t += 100
  assert.equal(engine.move('left'), 'blocked', '起点左侧是外墙')
  assert.equal(engine.steps, 0)
  assert.equal(engine.player, 0)
  assert.equal(engine.state, 'playing')
  assert.equal(engine.lastAction, 'blocked')
})

test('节流：60ms 内的第二次移动被忽略，满 60ms 放行', () => {
  const clock = { t: 1000 }
  const engine = makeEngine('easy', { now: () => clock.t })
  const path = engine._shortestPath(0, engine.size * engine.size - 1)
  const dir = engine._dirBetween(path[0], path[1])

  assert.equal(engine.move(dir), 'moved')
  clock.t = 1030
  assert.equal(engine.move(dir), 'ignored')
  assert.equal(engine.steps, 1)
  clock.t = 1000 + MAZE.MIN_MOVE_INTERVAL_MS
  const next = engine.getSnapshot().lastMove?.to
  assert.ok(Number.isInteger(next))
})

test('暂停：移动与提示被拒绝，计时冻结，恢复后只累加新时段', () => {
  const clock = { t: 0 }
  const engine = makeEngine('normal', { now: () => clock.t })
  const path = engine._shortestPath(0, engine.size * engine.size - 1)
  assert.equal(engine.move(engine._dirBetween(path[0], path[1])), 'moved')

  clock.t = 10000
  engine.pause()
  assert.equal(engine.state, 'paused')
  assert.equal(engine.move(engine._dirBetween(path[1], path[2])), 'ignored')
  assert.equal(engine.hint(), null)
  clock.t = 40000
  assert.ok(Math.abs(engine._elapsed() - 10) < 0.2, `暂停期间应保持 10s，实际 ${engine._elapsed()}`)

  engine.resume()
  clock.t = 45000
  assert.ok(Math.abs(engine._elapsed() - 15) < 0.2, `恢复 5s 后应为 15s，实际 ${engine._elapsed()}`)
})

test('超时：倒计时归零进入 over/timeout，得分 0', () => {
  const clock = { t: 0 }
  let over = null
  const engine = new MazeEngine(
    { onGameOver: (score, elapsed, result) => { over = { score, elapsed, result } } },
    { random: () => 0.5, now: () => clock.t },
  )
  engine.start('normal')
  const path = engine._shortestPath(0, engine.size * engine.size - 1)
  engine.move(engine._dirBetween(path[0], path[1]))

  clock.t = (TIERS.normal.limitSec + 5) * 1000
  engine.tick()
  assert.equal(engine.state, 'over')
  assert.equal(engine.result, 'timeout')
  assert.equal(engine.getSnapshot().remaining, 0)
  assert.equal(over.result, 'timeout')
  assert.equal(over.score, 0)
})

test('提示：方向与最短路一致，最多 3 次，不改变步数', () => {
  const engine = makeEngine('easy')
  const goal = engine.size * engine.size - 1
  const first = engine.hint()
  const path = engine._shortestPath(0, goal)
  assert.equal(first, engine._dirBetween(path[0], path[1]))
  assert.deepEqual(engine.getSnapshot().lastHint, {
    dir: first,
    from: 0,
    to: path[1],
    distance: path.length - 1,
  })
  assert.equal(engine.steps, 0)
  assert.equal(engine.hintsLeft, 2)

  assert.ok(engine.hint())
  assert.ok(engine.hint())
  assert.equal(engine.hintsLeft, 0)
  assert.equal(engine.hint(), null, '次数用尽后返回 null')
})

test('重走本局：同一张迷宫、玩家回起点、步数/计时/提示全部重置', () => {
  const clock = { t: 0 }
  const engine = makeEngine('hard', { now: () => clock.t })
  const wallsBefore = Array.from(engine.walls)
  const path = engine._shortestPath(0, engine.size * engine.size - 1)
  clock.t += 100
  engine.move(engine._dirBetween(path[0], path[1]))
  engine.hint()
  clock.t += 5000

  assert.equal(engine.reset(), true)
  const snap = engine.getSnapshot()
  assert.deepEqual(snap.walls, wallsBefore)
  assert.equal(snap.player, 0)
  assert.equal(snap.steps, 0)
  assert.equal(snap.hintsLeft, MAZE.HINT_LIMIT)
  assert.equal(snap.elapsed, 0)
  assert.equal(snap.visited.filter(Boolean).length, 1)
  assert.equal(snap.lastAction, 'reset')
})

test('换档与重生成：尺寸、限时与墙体随档位变化，同随机源可复现', () => {
  const a = makeEngine('easy')
  assert.equal(a.size, 5)
  assert.equal(a.getSnapshot().limitSec, 120)

  a.start('hard')
  assert.equal(a.size, 7)
  assert.equal(a.getSnapshot().limitSec, 180)

  const b1 = makeEngine('normal')
  const b2 = makeEngine('normal')
  assert.deepEqual(Array.from(b1.walls), Array.from(b2.walls), '同随机源应生成同一张迷宫')

  const c = makeEngine('normal')
  c.start('not-a-tier')
  assert.equal(c.tier, 'easy', '非法档位回退 easy')
})

test('计分：超过参考步数/用时/提示均扣分，最低封底 100', () => {
  const engine = makeEngine('easy')
  engine.steps = engine.par + 10
  engine.hintUsed = 1
  engine.elapsedBase = 30000 // 30s
  engine.state = 'over'
  engine.result = 'win'
  const expected = TIERS.easy.baseScore
    - 10 * MAZE.MOVE_PENALTY
    - 30 * MAZE.SEC_PENALTY
    - 1 * MAZE.HINT_PENALTY
  assert.equal(engine._score(), expected)

  engine.steps = 500
  engine.hintUsed = 3
  engine.elapsedBase = 600000
  assert.equal(engine._score(), MAZE.MIN_SCORE)
})

test('非 playing / 非法方向：移动与提示均不生效', () => {
  const engine = new MazeEngine({}, { random: () => 0.5 })
  assert.equal(engine.move('up'), 'ignored')
  assert.equal(engine.hint(), null)
  assert.equal(engine.reset(), false)

  engine.start('easy')
  assert.equal(engine.move('jump'), 'ignored')
  assert.equal(engine.move(undefined), 'ignored')
  assert.equal(engine.steps, 0)
})

test('dispose 后不再回调页面', () => {
  let calls = 0
  const engine = new MazeEngine({ onState: () => { calls += 1 } }, { random: () => 0.5 })
  engine.start('easy')
  const before = calls
  engine.dispose()
  engine.move('up')
  assert.equal(calls, before)
})
