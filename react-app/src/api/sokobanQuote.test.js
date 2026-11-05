/**
 * 推箱子通关寄语数据层单测（node:test，零依赖）
 * 覆盖：一言字段校验与截断、本地降级选句、缓存读写容错、请求失败降级。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  QUOTE_KEY,
  FALLBACK_QUOTES,
  normalizeQuote,
  pickFallbackQuote,
  readCachedQuote,
  writeCachedQuote,
  requestQuote,
  dateKeyOf,
} from './sokobanQuote.js'

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    dump: () => [...map.entries()],
  }
}

test('一言字段校验：空串/类型非法返回 null，超长截断', () => {
  assert.equal(normalizeQuote(null), null)
  assert.equal(normalizeQuote({}), null)
  assert.equal(normalizeQuote({ hitokoto: '   ' }), null)
  assert.equal(normalizeQuote({ hitokoto: 123 }), null)
  assert.deepEqual(normalizeQuote({ hitokoto: '  保持热爱  ', from: '某处' }), {
    text: '保持热爱',
    source: '某处',
  })
  assert.deepEqual(normalizeQuote({ hitokoto: '一句话' }), { text: '一句话', source: '一言' })
  const long = '字'.repeat(200)
  const quoted = normalizeQuote({ hitokoto: long, from: '出处'.repeat(20) })
  assert.equal(quoted.text.length, 81)
  assert.ok(quoted.text.endsWith('…'))
  assert.equal(quoted.source.length, 30)
})

test('本地降级句子池：按关卡确定性选句', () => {
  assert.equal(pickFallbackQuote(1).text, FALLBACK_QUOTES[0].text)
  assert.equal(pickFallbackQuote(8).text, FALLBACK_QUOTES[7].text)
  assert.equal(pickFallbackQuote(9).text, FALLBACK_QUOTES[0].text)
  assert.equal(pickFallbackQuote(0).text, FALLBACK_QUOTES[0].text)
  assert.equal(pickFallbackQuote('x').text, FALLBACK_QUOTES[0].text)
  assert.equal(pickFallbackQuote(1, []), null)
})

test('寄语缓存：正常读写、日期/版本/JSON 损坏均视为无缓存', () => {
  const storage = makeStorage()
  const date = dateKeyOf(new Date(2026, 10, 5))
  assert.equal(readCachedQuote(storage, date), null)

  writeCachedQuote(storage, date, { text: '通关一句', source: '一言' })
  assert.deepEqual(readCachedQuote(storage, date), { text: '通关一句', source: '一言', fallback: false })

  writeCachedQuote(storage, date, { text: '降级一句', source: '本地句子池' }, true)
  assert.deepEqual(readCachedQuote(storage, date), { text: '降级一句', source: '本地句子池', fallback: true })

  assert.equal(readCachedQuote(storage, '2026-11-06'), null)
  storage.setItem(QUOTE_KEY, '{bad json')
  assert.equal(readCachedQuote(storage, date), null)
  storage.setItem(QUOTE_KEY, JSON.stringify({ v: 2, date, text: '旧版本' }))
  assert.equal(readCachedQuote(storage, date), null)
  storage.setItem(QUOTE_KEY, JSON.stringify({ v: 1, date, text: '' }))
  assert.equal(readCachedQuote(storage, date), null)
})

test('寄语缓存写入：空文本/超长文本不落盘，存储异常不抛出', () => {
  const storage = makeStorage()
  const date = '2026-11-05'
  writeCachedQuote(storage, date, null)
  writeCachedQuote(storage, date, { text: '' })
  writeCachedQuote(storage, date, { text: '字'.repeat(200) })
  assert.equal(readCachedQuote(storage, date), null)

  const broken = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  assert.doesNotThrow(() => writeCachedQuote(broken, date, { text: '一句话' }))
  assert.equal(readCachedQuote(broken, date), null)
})

test('一言请求：成功返回校验结果，非 2xx/异常/无 fetch 返回 null', async () => {
  const ok = async () => ({ ok: true, json: async () => ({ hitokoto: '  向前一步  ', from: '某处' }) })
  assert.deepEqual(await requestQuote(ok), { text: '向前一步', source: '某处' })

  const badJson = async () => ({ ok: true, json: async () => ({ hitokoto: 1 }) })
  assert.equal(await requestQuote(badJson), null)

  const notOk = async () => ({ ok: false, json: async () => ({}) })
  assert.equal(await requestQuote(notOk), null)

  const boom = async () => { throw new Error('network') }
  assert.equal(await requestQuote(boom), null)

  assert.equal(await requestQuote(null), null)
})
