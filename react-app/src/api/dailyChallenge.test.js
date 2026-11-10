/**
 * dailyChallenge 数据层单元测试（node:test，零依赖）
 * 覆盖：日期键与天数序号、确定性选游戏（连续两天不重复）、注册表完整性、
 * 非法输入空态、一言字段校验与截断、降级句子池、存储读写与容错。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DATE_CHECK_MS,
  FALLBACK_QUOTES,
  GAME_ROSTER,
  OPEN_KEY,
  QUOTE_KEY,
  QUOTE_TIMEOUT_MS,
  dateKeyOf,
  dayNumber,
  markOpened,
  normalizeQuote,
  pickDailyChallenge,
  pickFallbackQuote,
  readCachedQuote,
  readOpened,
  writeCachedQuote,
} from './dailyChallenge.js'

/** 内存版 Storage，可注入初始化数据与写入异常 */
function fakeStorage(initial = {}, { failWrite = false } = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failWrite) throw new Error('quota exceeded')
      map.set(k, String(v))
    },
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

test('dateKeyOf 按本地时区输出 YYYY-MM-DD', () => {
  assert.equal(dateKeyOf(new Date(2026, 10, 4)), '2026-11-04')
  assert.equal(dateKeyOf(new Date(2026, 0, 1)), '2026-01-01')
})

test('dayNumber 合法日期递增 1，非法格式与越界日期返回 NaN', () => {
  const a = dayNumber('2026-11-04')
  const b = dayNumber('2026-11-05')
  assert.ok(Number.isFinite(a))
  assert.equal(b - a, 1)
  assert.ok(Number.isNaN(dayNumber('2026-13-40')))
  assert.ok(Number.isNaN(dayNumber('2026-02-30')))
  assert.ok(Number.isNaN(dayNumber('2026-1-4')))
  assert.ok(Number.isNaN(dayNumber('')))
  assert.ok(Number.isNaN(dayNumber(null)))
})

test('pickDailyChallenge 同一日期结果恒定', () => {
  const first = pickDailyChallenge('2026-11-04')
  const second = pickDailyChallenge('2026-11-04')
  assert.ok(first)
  assert.equal(first.slug, second.slug)
})

test('pickDailyChallenge 连续 40 天相邻日期均不重复', () => {
  for (let i = 0; i < 40; i++) {
    const day = new Date(2026, 10, 4 + i)
    const today = dateKeyOf(day)
    const next = dateKeyOf(new Date(2026, 10, 5 + i))
    const a = pickDailyChallenge(today)
    const b = pickDailyChallenge(next)
    assert.ok(a && b)
    assert.notEqual(a.slug, b.slug, `${today} 与 ${next} 选到了同一款游戏`)
  }
})

test('pickDailyChallenge 全日期覆盖全部注册表游戏', () => {
  const seen = new Set()
  for (let i = 0; i < 60; i++) {
    const game = pickDailyChallenge(dateKeyOf(new Date(2026, 10, 4 + i)))
    seen.add(game.slug)
  }
  assert.equal(seen.size, GAME_ROSTER.length)
})

test('pickDailyChallenge 非法日期 / 空注册表返回 null', () => {
  assert.equal(pickDailyChallenge('2026-02-30'), null)
  assert.equal(pickDailyChallenge(''), null)
  assert.equal(pickDailyChallenge('2026-11-04', []), null)
  assert.equal(pickDailyChallenge('2026-11-04', null), null)
})

test('注册表完整：16 款、slug 与路由唯一、展示字段齐全', () => {
  assert.equal(GAME_ROSTER.length, 16)
  const slugs = new Set()
  const routes = new Set()
  for (const game of GAME_ROSTER) {
    assert.ok(game.slug && !slugs.has(game.slug), `slug 重复：${game.slug}`)
    slugs.add(game.slug)
    assert.ok(game.to.startsWith('/') && !routes.has(game.to), `路由重复或非法：${game.to}`)
    routes.add(game.to)
    assert.ok(game.name && game.rule && game.difficulty && game.duration, `字段缺失：${game.slug}`)
  }
})

test('normalizeQuote 接受合法响应，缺失/空串/类型错误返回 null', () => {
  assert.deepEqual(normalizeQuote({ hitokoto: '  保持热爱  ', from: '某处' }), {
    text: '保持热爱',
    source: '某处',
  })
  assert.deepEqual(normalizeQuote({ hitokoto: '一句话' }), { text: '一句话', source: '一言' })
  assert.equal(normalizeQuote(null), null)
  assert.equal(normalizeQuote({}), null)
  assert.equal(normalizeQuote({ hitokoto: '   ' }), null)
  assert.equal(normalizeQuote({ hitokoto: 123 }), null)
})

test('normalizeQuote 超长文本截断到 80 字符并补省略号', () => {
  const long = '字'.repeat(100)
  const quoted = normalizeQuote({ hitokoto: long, from: '出处'.repeat(20) })
  assert.equal(quoted.text.length, 81)
  assert.ok(quoted.text.endsWith('…'))
  assert.ok(quoted.source.length <= 30)
})

test('pickFallbackQuote 同日恒定，空池返回 null', () => {
  assert.equal(pickFallbackQuote('2026-11-04'), pickFallbackQuote('2026-11-04'))
  assert.equal(pickFallbackQuote('2026-11-04', []), null)
  assert.equal(pickFallbackQuote('2026-11-04', null), null)
  for (const item of FALLBACK_QUOTES) {
    assert.ok(item.text && item.source)
  }
})

test('已挑战标记：仅当日命中为 true，损坏 JSON / 无存储降级为 false', () => {
  const storage = fakeStorage()
  assert.equal(readOpened(storage, '2026-11-04'), false)
  markOpened(storage, '2026-11-04')
  assert.equal(readOpened(storage, '2026-11-04'), true)
  assert.equal(readOpened(storage, '2026-11-05'), false)
  assert.equal(readOpened(fakeStorage({ [OPEN_KEY]: '{bad json' }), '2026-11-04'), false)
  assert.equal(readOpened(null, '2026-11-04'), false)
})

test('已挑战标记：写入异常被吞掉，不抛错', () => {
  const storage = fakeStorage({}, { failWrite: true })
  assert.doesNotThrow(() => markOpened(storage, '2026-11-04'))
  assert.equal(readOpened(storage, '2026-11-04'), false)
})

test('名言缓存：写入后可读回，跨日与损坏数据失效', () => {
  const storage = fakeStorage()
  writeCachedQuote(storage, '2026-11-04', { text: '今日一句', source: '一言' })
  assert.deepEqual(readCachedQuote(storage, '2026-11-04'), {
    text: '今日一句',
    source: '一言',
    fallback: false,
  })
  writeCachedQuote(storage, '2026-11-04', { text: '降级句', source: '本地句子池' }, true)
  assert.equal(readCachedQuote(storage, '2026-11-04').fallback, true)
  assert.equal(readCachedQuote(storage, '2026-11-05'), null)
  assert.equal(readCachedQuote(fakeStorage({ [QUOTE_KEY]: 'not json' }), '2026-11-04'), null)
  assert.equal(readCachedQuote(null, '2026-11-04'), null)
})

test('名言缓存：超长内容不写入，避免撑大存储', () => {
  const storage = fakeStorage()
  writeCachedQuote(storage, '2026-11-04', { text: '字'.repeat(200), source: '一言' })
  assert.equal(storage.dump()[QUOTE_KEY], undefined)
  assert.equal(readCachedQuote(storage, '2026-11-04'), null)
})

test('超时与换日检查的时间常量符合需求', () => {
  assert.equal(QUOTE_TIMEOUT_MS, 10000)
  assert.equal(DATE_CHECK_MS, 60000)
})
