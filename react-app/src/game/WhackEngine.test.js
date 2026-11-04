/**
 * WhackEngine 单元测试（node:test，零依赖）
 * 通过假时钟（Date.now / setTimeout）与内存版 localStorage 实现确定性测试。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WhackEngine, WHACK } from './WhackEngine.js'

// ---------- 测试基建：假时钟 + localStorage mock ----------

let now
let timers
let realDateNow
let realSetTimeout
let realClearTimeout
let realLocalStorage
let realRandom

function makeLocalStorage({ failOnSet = false } = {}) {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failOnSet) throw new Error('QuotaExceeded')
      map.set(k, String(v))
    },
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

function installFakes({ storage } = {}) {
  now = 1_000_000
  timers = []
  realDateNow = Date.now
  realSetTimeout = global.setTimeout
  realClearTimeout = global.clearTimeout
  realLocalStorage = globalThis.localStorage
  realRandom = Math.random

  Date.now = () => now
  global.setTimeout = (fn, ms) => {
    const t = { fn, at: now + ms, cleared: false }
    timers.push(t)
    return t
  }
  global.clearTimeout = (t) => {
    if (t) t.cleared = true
  }
  globalThis.localStorage = storage ?? makeLocalStorage()
}

function restoreFakes() {
  Date.now = realDateNow
  global.setTimeout = realSetTimeout
  global.clearTimeout = realClearTimeout
  globalThis.localStorage = realLocalStorage
  Math.random = realRandom
}

/** 推进假时钟，同步执行到期定时器（模拟事件循环） */
function advance(ms) {
  const target = now + ms
  for (;;) {
    const due = timers
      .filter((t) => !t.cleared && t.at <= target)
      .sort((a, b) => a.at - b.at)
    if (due.length === 0) break
    const t = due[0]
    timers.splice(timers.indexOf(t), 1)
    now = t.at
    t.fn()
  }
  now = target
}

/** 创建引擎并立即开局，返回 { engine, events } */
function createStartedEngine({ storage, random } = {}) {
  installFakes({ storage })
  if (random) Math.random = random
  const events = { states: [], feedbacks: [], over: null, pauses: [], persistErr: 0 }
  const engine = new WhackEngine({
    onState: (s) => events.states.push(s),
    onFeedback: (f) => events.feedbacks.push(f),
    onGameOver: (r) => { events.over = r },
    onPause: (reason) => events.pauses.push(reason),
    onPersistError: () => { events.persistErr += 1 },
  })
  return { engine, events }
}

/** 快进直到出现地鼠（最多 5s），返回 mole 快照 */
function advanceToMole(engine) {
  for (let i = 0; i < 50; i += 1) {
    advance(100)
    const snap = engine.getSnapshot()
    if (snap.mole) return snap.mole
  }
  return null
}

// ---------- 用例 ----------

test('TC01 初始状态：ready，分数为 0，剩余时间应为 30s', () => {
  const { engine } = createStartedEngine()
  try {
    const s = engine.getSnapshot()
    assert.equal(s.state, 'ready')
    assert.equal(s.score, 0)
    assert.equal(s.combo, 0)
    assert.equal(s.mole, null)
    // 开局前 HUD 应展示完整时长 30s，而不是 0s
    assert.equal(s.remainingSec, 30)
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC02 start 后进入 playing，准备期内敲击被忽略且不计 miss', () => {
  const { engine } = createStartedEngine()
  try {
    engine.start()
    assert.equal(engine.getSnapshot().state, 'playing')
    assert.equal(engine.getSnapshot().preparing, true)
    // 准备期内（< startedAt）所有敲击忽略
    assert.equal(engine.tap(0), 'ignored')
    assert.equal(engine.tap(4), 'ignored')
    assert.equal(engine.getSnapshot().misses, 0)
    // 准备期内不出鼠
    advance(WHACK.READY_MS - 100)
    assert.equal(engine.getSnapshot().mole, null)
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC03 准备期+首延迟后出鼠，命中普通地鼠 +10', () => {
  const { engine, events } = createStartedEngine({
    random: () => 0.5, // > GOLD_RATE，不出金鼠
  })
  try {
    engine.start()
    const mole = advanceToMole(engine)
    assert.ok(mole, '应在准备期后出鼠')
    assert.equal(mole.gold, false)
    const r = engine.tap(mole.idx)
    assert.equal(r, 'hit')
    assert.equal(engine.getSnapshot().score, WHACK.SCORE_NORMAL)
    assert.equal(engine.getSnapshot().hits, 1)
    assert.equal(engine.getSnapshot().combo, 1)
    const hitFb = events.feedbacks.find((f) => f.type === 'hit')
    assert.ok(hitFb)
    assert.equal(hitFb.gain, WHACK.SCORE_NORMAL)
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC04 命中金鼠 +30', () => {
  let calls = 0
  const { engine } = createStartedEngine({
    // 第一次调用用于选洞位，第二次用于金鼠判定
    random: () => { calls += 1; return calls === 2 ? 0.05 : 0.5 },
  })
  try {
    engine.start()
    const mole = advanceToMole(engine)
    assert.ok(mole)
    assert.equal(mole.gold, true)
    assert.equal(engine.tap(mole.idx), 'hit')
    assert.equal(engine.getSnapshot().score, WHACK.SCORE_GOLD)
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC05 击空计 miss 且清空连击；越界与非进行态敲击被忽略', () => {
  const { engine } = createStartedEngine({ random: () => 0.5 })
  try {
    // 非 playing 状态
    assert.equal(engine.tap(0), 'ignored')
    engine.start()
    const mole = advanceToMole(engine)
    assert.ok(mole)
    // 越界
    assert.equal(engine.tap(-1), 'ignored')
    assert.equal(engine.tap(WHACK.HOLES), 'ignored')
    assert.equal(engine.getSnapshot().misses, 0)
    // 先命中一次建立连击
    assert.equal(engine.tap(mole.idx), 'hit')
    assert.equal(engine.getSnapshot().combo, 1)
    // 击空（换一个肯定没鼠的洞）
    advance(WHACK.GAP_MS + 100) // 等下一只出现前
    const emptyIdx = (mole.idx + 1) % WHACK.HOLES
    const before = engine.getSnapshot()
    const target = before.mole && before.mole.idx !== emptyIdx ? emptyIdx : (emptyIdx + 1) % WHACK.HOLES
    assert.equal(engine.tap(target), 'miss')
    assert.equal(engine.getSnapshot().misses, 1)
    assert.equal(engine.getSnapshot().combo, 0)
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC06 命中后 800ms 忽略窗口内同洞敲击返回 ignored 且不计 miss', () => {
  const { engine } = createStartedEngine({ random: () => 0.5 })
  try {
    engine.start()
    const mole = advanceToMole(engine)
    assert.ok(mole)
    assert.equal(engine.tap(mole.idx), 'hit')
    assert.equal(engine.tap(mole.idx), 'ignored')
    assert.equal(engine.getSnapshot().misses, 0)
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC07 连击加成：连击达到 4 起每次额外 +5', () => {
  const { engine, events } = createStartedEngine({ random: () => 0.5 })
  try {
    engine.start()
    const gains = []
    for (let i = 0; i < 5; i += 1) {
      const mole = advanceToMole(engine)
      assert.ok(mole, `第 ${i + 1} 只地鼠应出现`)
      assert.equal(engine.tap(mole.idx), 'hit')
      gains.push(events.feedbacks.filter((f) => f.type === 'hit').at(-1).gain)
    }
    assert.deepEqual(gains, [10, 10, 10, 15, 15])
    assert.equal(engine.getSnapshot().maxCombo, 5)
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC08 地鼠自然消失不计 miss，间隔后出下一只', () => {
  const { engine } = createStartedEngine({ random: () => 0.5 })
  try {
    engine.start()
    const mole = advanceToMole(engine)
    assert.ok(mole)
    advance(WHACK.VISIBLE_MS + 50) // 超过可见窗口
    assert.equal(engine.getSnapshot().mole, null)
    assert.equal(engine.getSnapshot().misses, 0)
    const mole2 = advanceToMole(engine)
    assert.ok(mole2, '空窗后应出下一只')
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC09 新地鼠不与上一只同洞', () => {
  const { engine } = createStartedEngine({ random: () => 0.5 })
  try {
    engine.start()
    const idxs = []
    for (let i = 0; i < 20; i += 1) {
      const mole = advanceToMole(engine)
      assert.ok(mole)
      idxs.push(mole.idx)
      engine.tap(mole.idx)
    }
    for (let i = 1; i < idxs.length; i += 1) {
      assert.notEqual(idxs[i], idxs[i - 1], `第 ${i} 只不应与上一只同洞`)
    }
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC10 暂停冻结剩余时间与地鼠，恢复后 300ms 缓冲内输入被忽略', () => {
  const { engine } = createStartedEngine({ random: () => 0.5 })
  try {
    engine.start()
    const mole = advanceToMole(engine)
    assert.ok(mole)
    const beforePause = engine.getSnapshot()
    engine.pause('manual')
    assert.equal(engine.getSnapshot().state, 'paused')
    // 冻结：推进时间剩余不变、地鼠不消失
    const frozen = engine.getSnapshot().remainingSec
    advance(5000)
    assert.equal(engine.getSnapshot().remainingSec, frozen)
    assert.equal(engine.getSnapshot().state, 'paused')
    // 恢复
    engine.resume()
    assert.equal(engine.getSnapshot().state, 'playing')
    // 300ms 缓冲期内敲击被忽略（即使敲的是还活着的地鼠）
    assert.equal(engine.tap(mole.idx), 'ignored')
    // 缓冲期后命中
    advance(WHACK.RESUME_GRACE_MS)
    const cur = engine.getSnapshot().mole
    assert.ok(cur, '冻结的地鼠恢复后应仍在')
    assert.equal(engine.tap(cur.idx), 'hit')
    assert.equal(engine.getSnapshot().score, beforePause.score + WHACK.SCORE_NORMAL)
    void beforePause
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC11 准备期内暂停再恢复：剩余准备期应保留（不立即出鼠、不立即计时）', () => {
  const { engine } = createStartedEngine({ random: () => 0.5 })
  try {
    engine.start()
    advance(500) // 准备期过半
    engine.pause('auto')
    assert.equal(engine.getSnapshot().state, 'paused')
    // 准备期内暂停：HUD 仍显示完整 30s，不应含准备期余量（30.5s）
    assert.equal(engine.getSnapshot().remainingSec, 30)
    advance(60000) // 暂停很久
    engine.resume()
    const snap = engine.getSnapshot()
    assert.equal(snap.state, 'playing')
    assert.equal(snap.remainingSec, 30) // 恢复后倒计时从完整 30s 起算
    // 恢复后仍应处于准备期（剩余约 500ms），不应立即出鼠
    assert.equal(snap.preparing, true)
    assert.equal(snap.mole, null)
    advance(400)
    assert.equal(engine.getSnapshot().preparing, true)
    assert.equal(engine.getSnapshot().mole, null)
    // 准备期结束后正常出鼠
    const mole = advanceToMole(engine)
    assert.ok(mole)
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC12 30s 结束后进入 over，结算字段正确并回写最佳纪录', () => {
  const storage = makeLocalStorage()
  const { engine, events } = createStartedEngine({ storage, random: () => 0.5 })
  try {
    engine.start()
    // 命中 2 次，击空 1 次
    for (let i = 0; i < 2; i += 1) {
      const mole = advanceToMole(engine)
      assert.ok(mole)
      engine.tap(mole.idx)
    }
    const snap = engine.getSnapshot()
    const emptyIdx = snap.mole ? (snap.mole.idx + 1) % WHACK.HOLES : 0
    engine.tap(emptyIdx) // 可能 hit/ignored，强制构造 miss 需选无鼠洞
    // 直接快进到结束
    advance(WHACK.GAME_MS + 2000)
    assert.equal(engine.getSnapshot().state, 'over')
    assert.ok(events.over, '应触发 onGameOver')
    const res = events.over
    assert.equal(res.score, engine.getSnapshot().score)
    assert.equal(res.accuracy, Math.round((res.hits / (res.hits + res.misses)) * 100))
    assert.equal(res.newRecord, true)
    // 持久化已写入
    const saved = JSON.parse(storage.getItem(WHACK.STATS_KEY))
    assert.equal(saved.best, res.score)
    assert.equal(saved.games, 1)
    assert.equal(saved.starts, 1)
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC13 新实例从 localStorage 恢复历史最佳', () => {
  const storage = makeLocalStorage()
  installFakes({ storage })
  Math.random = () => 0.5
  try {
    const e1 = new WhackEngine({})
    e1.start()
    const mole = (() => {
      for (let i = 0; i < 50; i += 1) {
        advance(100)
        const m = e1.getSnapshot().mole
        if (m) return m
      }
      return null
    })()
    assert.ok(mole)
    e1.tap(mole.idx)
    advance(WHACK.GAME_MS + 2000)
    assert.equal(e1.getSnapshot().state, 'over')
    e1.dispose()

    const e2 = new WhackEngine({})
    assert.equal(e2.getSnapshot().best, e1.getSnapshot().score)
    e2.dispose()
  } finally {
    restoreFakes()
  }
})

test('TC14 localStorage 不可用时降级并触发 onPersistError', () => {
  const storage = makeLocalStorage({ failOnSet: true })
  const { engine, events } = createStartedEngine({ storage, random: () => 0.5 })
  try {
    engine.start() // start 内部 flush 会失败
    assert.ok(events.persistErr >= 1, '应触发 onPersistError')
    assert.equal(engine.getSnapshot().storageOk, false)
    // 游戏功能不受影响
    const mole = advanceToMole(engine)
    assert.ok(mole)
    assert.equal(engine.tap(mole.idx), 'hit')
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC15 pause/resume 幂等：非 playing 暂停无效，非 paused 恢复无效', () => {
  const { engine, events } = createStartedEngine({ random: () => 0.5 })
  try {
    engine.pause() // ready 状态暂停无效
    assert.equal(events.pauses.length, 0)
    engine.resume() // ready 状态恢复无效
    assert.equal(engine.getSnapshot().state, 'ready')
    engine.start()
    engine.pause('manual')
    engine.pause('manual') // 重复暂停幂等
    assert.equal(events.pauses.length, 1)
    engine.resume()
    assert.equal(engine.getSnapshot().state, 'playing')
  } finally {
    engine.dispose()
    restoreFakes()
  }
})

test('TC16 忽略窗口内同洞刷出新地鼠：命中判定优先于忽略窗口', () => {
  // 随机序列按 _spawn 消费顺序（洞位→金鼠判定）：spawn1→洞0，spawn2→洞4，spawn3→洞0，均非金鼠
  const seq = [0.0, 0.5, 0.5, 0.5, 0.0, 0.5]
  let i = 0
  const { engine } = createStartedEngine({
    random: () => seq[Math.min(i++, seq.length - 1)],
  })
  try {
    engine.start()
    const m1 = advanceToMole(engine)
    assert.equal(m1.idx, 0)
    assert.equal(engine.tap(0), 'hit') // 洞 0 进入 800ms 忽略窗口
    const m2 = advanceToMole(engine)
    assert.equal(m2.idx, 4)
    assert.equal(engine.tap(4), 'hit')
    // 距上次命中洞 0 仅约 600ms（< 800ms），新鼠刷回洞 0 时忽略窗口仍生效
    const m3 = advanceToMole(engine)
    assert.equal(m3.idx, 0, '新地鼠应刷回仍在忽略窗口内的洞 0')
    // 命中判定优先于忽略窗口：活地鼠应判 hit，而非被忽略窗口吞掉
    assert.equal(engine.tap(0), 'hit')
    assert.equal(engine.getSnapshot().hits, 3)
    assert.equal(engine.getSnapshot().misses, 0)
  } finally {
    engine.dispose()
    restoreFakes()
  }
})
