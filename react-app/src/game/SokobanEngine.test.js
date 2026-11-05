/**
 * 推箱子引擎单测（node:test，零依赖）
 * 覆盖：关卡元数据合法性、12 关最短解回放、移动/推箱/撞墙、撤销、重开、
 * 超时失败、暂停冻结计时、计分公式、地图解析异常。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SokobanEngine, LEVELS, TIERS, SOKOBAN, parseLevel } from './SokobanEngine.js'

const SOLUTION = {
  1: 'URD',
  2: 'RUDDD',
  3: 'RULRUL',
  4: 'DRDLULUU',
  5: 'UURULDLDD',
  6: 'URULDLDLDR',
  7: 'UURULDLDDRRUU',
  8: 'DLLURDRRDLUUU',
  9: 'LLUURDDRRUULULLDDRU',
  10: 'DRDLULULUURRRDDDULLULUR',
  11: 'UURRDLRDDLDLLUURULURDDDLDR',
  12: 'RDLDDRRRUUULULLDDRDRLUURRDD',
}

const DIR_OF = { U: 'up', D: 'down', L: 'left', R: 'right' }

/** 用假时钟构造引擎，并记录最后一次结算 */
function makeEngine(now = () => 0) {
  const events = { over: null, states: [] }
  const engine = new SokobanEngine(
    {
      onState: (snap) => events.states.push(snap),
      onGameOver: (score, elapsed, result) => { events.over = { score, elapsed, result } },
    },
    { now },
  )
  return { engine, events }
}

function play(engine, path) {
  for (const ch of path) {
    const r = engine.move(DIR_OF[ch])
    if (r === 'blocked' || r === 'ignored') return r
  }
  return 'done'
}

test('关卡元数据：12 关、最大 6 列 8 行、箱子与目标数一致', () => {
  assert.equal(LEVELS.length, 12)
  assert.equal(SOKOBAN.LEVEL_COUNT, 12)
  for (const level of LEVELS) {
    assert.ok(level.id >= 1 && level.id <= 12)
    assert.ok(level.name && level.tier in TIERS)
    assert.ok(level.par > 0)
    const parsed = parseLevel(level.rows)
    assert.ok(parsed.width <= 6, `${level.name} 宽度 ${parsed.width}`)
    assert.ok(parsed.height <= 8, `${level.name} 高度 ${parsed.height}`)
    let goals = 0
    for (const g of parsed.goals) if (g) goals += 1
    assert.equal(parsed.boxes.size, goals, `${level.name} 箱子/目标不一致`)
  }
})

test('12 关最短解均可通关，且步数等于 par', () => {
  for (const level of LEVELS) {
    const { engine, events } = makeEngine()
    engine.start(level.id - 1)
    assert.equal(play(engine, SOLUTION[level.id]), 'done', `第 ${level.id} 关解失败`)
    const snap = engine.getSnapshot()
    assert.equal(snap.state, 'over', `第 ${level.id} 关未结算`)
    assert.equal(snap.moves, level.par, `第 ${level.id} 关步数 ${snap.moves} != par ${level.par}`)
    assert.equal(snap.boxesOnGoal, snap.totalBoxes)
    assert.equal(events.over?.result, 'win')
    assert.ok(events.over.score >= SOKOBAN.MIN_SCORE)
  }
})

test('开局：默认第 1 关，非法索引回退第 1 关', () => {
  const { engine } = makeEngine()
  engine.start()
  const snap = engine.getSnapshot()
  assert.equal(snap.state, 'playing')
  assert.equal(snap.levelId, 1)
  assert.equal(snap.rows, 6)
  assert.equal(snap.cols, 5)
  assert.equal(snap.moves, 0)
  assert.equal(snap.pushes, 0)
  assert.equal(snap.totalBoxes, 1)

  engine.start(99)
  assert.equal(engine.getSnapshot().levelId, 1)
  engine.start(-3)
  assert.equal(engine.getSnapshot().levelId, 1)
})

test('移动与撞墙：撞墙不增加步数并返回 blocked', () => {
  const { engine } = makeEngine()
  engine.start(0)
  assert.equal(engine.move('up'), 'moved')
  assert.equal(engine.getSnapshot().moves, 1)
  assert.equal(engine.move('up'), 'blocked')
  const snap = engine.getSnapshot()
  assert.equal(snap.moves, 1)
  assert.equal(snap.lastAction, 'blocked')
  assert.equal(engine.move('sideways'), 'ignored')
})

test('推箱受阻：箱子后方是墙时整步无效', () => {
  const { engine } = makeEngine()
  engine.start(0)
  // 第 1 关：玩家 (2,2)，箱子 (2,3)，箱子右侧紧邻墙
  assert.equal(engine.move('right'), 'blocked')
  const snap = engine.getSnapshot()
  assert.equal(snap.moves, 0)
  assert.equal(snap.pushes, 0)
  assert.equal(snap.player, 2 * snap.cols + 2)
})

test('推箱与撤销：位置/箱子/步数/推箱数完整回退', () => {
  const { engine } = makeEngine(() => 0)
  engine.start(1)
  assert.equal(engine.move('right'), 'moved')
  assert.equal(engine.move('up'), 'pushed')
  let snap = engine.getSnapshot()
  assert.equal(snap.moves, 2)
  assert.equal(snap.pushes, 1)
  assert.equal(snap.boxesOnGoal, 1)
  assert.equal(snap.canUndo, true)

  assert.equal(engine.undo(), true)
  snap = engine.getSnapshot()
  assert.equal(snap.moves, 1)
  assert.equal(snap.pushes, 0)
  assert.equal(snap.boxesOnGoal, 0)
  assert.equal(snap.player, 3 * snap.cols + 3)
  assert.equal(snap.lastAction, 'undo')

  assert.equal(engine.undo(), true)
  snap = engine.getSnapshot()
  assert.equal(snap.moves, 0)
  assert.equal(snap.canUndo, false)
  assert.equal(engine.undo(), false)
  assert.equal(engine.getSnapshot().moves, 0)
})

test('重开：地图、步数、推箱、历史与计时全部重置', () => {
  let t = 0
  const { engine } = makeEngine(() => t)
  engine.start(1)
  engine.move('right')
  t = 5000
  engine.move('up')
  assert.equal(engine.getSnapshot().moves, 2)
  assert.equal(engine.getSnapshot().pushes, 1)
  assert.equal(engine.getSnapshot().undoCount, 2)
  assert.ok(engine.getSnapshot().elapsed >= 5)

  engine.restart()
  const snap = engine.getSnapshot()
  assert.equal(snap.state, 'playing')
  assert.equal(snap.levelId, 2)
  assert.equal(snap.moves, 0)
  assert.equal(snap.pushes, 0)
  assert.equal(snap.undoCount, 0)
  assert.equal(snap.elapsed, 0)
  assert.equal(snap.lastAction, 'restart')
  assert.equal(snap.canUndo, false)
})

test('超时：达到限时进入 failed，得分为 0', () => {
  let t = 0
  const { engine, events } = makeEngine(() => t)
  engine.start(0)
  engine.move('up')
  t = TIERS.easy.limitSec * 1000
  engine.tick()
  const snap = engine.getSnapshot()
  assert.equal(snap.state, 'failed')
  assert.equal(snap.score, null)
  assert.equal(events.over?.result, 'timeout')
  assert.equal(events.over?.score, 0)
  engine.start(0)
  assert.equal(engine.getSnapshot().state, 'playing')
})

test('暂停/恢复：暂停时长不计入用时', () => {
  let t = 0
  const { engine } = makeEngine(() => t)
  engine.start(0)
  engine.move('up') // 计时启动
  t = 2000
  engine.pause()
  assert.equal(engine.getSnapshot().state, 'paused')
  assert.equal(engine.getSnapshot().elapsed, 2)

  t = 100000
  engine.resume()
  assert.equal(engine.getSnapshot().state, 'playing')
  t = 101000
  engine.tick()
  const snap = engine.getSnapshot()
  assert.equal(snap.elapsed, 3)
  assert.equal(snap.remaining, TIERS.easy.limitSec - 3)
  // 重复暂停/恢复幂等
  engine.pause()
  engine.pause()
  assert.equal(engine.getSnapshot().state, 'paused')
})

test('计分：超出 par 每步扣 8 分', () => {
  const { engine, events } = makeEngine(() => 0)
  engine.start(0)
  // 先左右各走一步（原地返回），再走最短解 → moves = 5，par = 3
  engine.move('left')
  engine.move('right')
  play(engine, 'URD')
  const snap = engine.getSnapshot()
  assert.equal(snap.state, 'over')
  assert.equal(snap.moves, 5)
  assert.equal(events.over?.score, TIERS.easy.baseScore - 2 * SOKOBAN.MOVE_PENALTY)
  assert.equal(snap.lastAction, 'win')
  assert.equal(snap.canUndo, false)
})

test('未移动时不进入倒计时，tick 不触发超时', () => {
  let t = 0
  const { engine } = makeEngine(() => t)
  engine.start(0)
  t = TIERS.easy.limitSec * 1000
  engine.tick()
  assert.equal(engine.getSnapshot().state, 'playing')
  assert.equal(engine.getSnapshot().elapsed, 0)
})

test('地图解析异常：行宽不一致 / 箱子数与目标数不符 / 缺少玩家', () => {
  assert.throws(() => parseLevel(['###', '#@#', '####']), /宽度不一致/)
  assert.throws(() => parseLevel(['######', '#@$$.#', '######']), /不一致/)
  assert.throws(() => parseLevel(['#####', '# $.#', '#####']), /缺少玩家/)
  assert.throws(() => parseLevel([]), /地图为空/)
})
