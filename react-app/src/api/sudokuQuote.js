/**
 * 数独「通关寄语」数据层（纯函数 + localStorage 读写）
 * - 优先请求一言 API（3s 超时）；超时/非 2xx/字段非法时降级到本地句子池
 * - 成功与降级都按日缓存（game-sudoku-quote-v1），同日不再重复请求
 * - 存储读写全部容错：不可用 / JSON 损坏 / 版本或日期不符一律视为无数据
 */

export const QUOTE_API = 'https://v1.hitokoto.cn/?encode=json&charset=utf-8'
export const QUOTE_TIMEOUT_MS = 3 * 1000
export const QUOTE_KEY = 'game-sudoku-quote-v1'
const QUOTE_CACHE_MAX_LEN = 200

/** 本地降级句子池：按日期确定性选句 */
export const FALLBACK_QUOTES = [
  { text: '每个空格，都有唯一属于它的数字。', source: '本地句子池' },
  { text: '排除到尽头，答案自然浮现。', source: '本地句子池' },
  { text: '先看懂全局，再填下一格。', source: '本地句子池' },
  { text: '错误的尝试，也是推理的一部分。', source: '本地句子池' },
  { text: '九行九列，各归其位。', source: '本地句子池' },
  { text: '耐心是逻辑最好的朋友。', source: '本地句子池' },
  { text: '把候选数写小，把思路放大。', source: '本地句子池' },
  { text: '填满最后一格的人，赢过了自己。', source: '本地句子池' },
]

/** 本地日期 → `YYYY-MM-DD` */
export function dateKeyOf(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 校验一言响应：返回 { text, source } 或 null（字段缺失/类型错误/空串） */
export function normalizeQuote(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.hitokoto !== 'string') return null
  const text = raw.hitokoto.trim()
  if (!text) return null
  const clipped = text.length > 80 ? `${text.slice(0, 80)}…` : text
  const from = typeof raw.from === 'string' ? raw.from.trim().slice(0, 30) : ''
  return { text: clipped, source: from || '一言' }
}

/** 按日期选本地降级句子；句子池为空时返回 null */
export function pickFallbackQuote(dateKey, pool = FALLBACK_QUOTES) {
  if (!Array.isArray(pool) || pool.length === 0) return null
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''))
  if (!matched) return pool[0]
  const day = Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])) / 86400000
  return pool[Math.floor(day) % pool.length]
}

/** 读取当日寄语缓存；结构损坏、版本或日期不符返回 null */
export function readCachedQuote(storage, dateKey) {
  try {
    const raw = storage?.getItem(QUOTE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || data.v !== 1 || data.date !== dateKey) return null
    if (typeof data.text !== 'string' || !data.text) return null
    return {
      text: data.text,
      source: typeof data.source === 'string' && data.source ? data.source : '一言',
      fallback: data.fallback === true,
    }
  } catch {
    return null
  }
}

/** 写入当日寄语缓存（成功与降级都写，序列化超 200 字符不写） */
export function writeCachedQuote(storage, dateKey, quote, fallback = false) {
  if (!quote || typeof quote.text !== 'string' || !quote.text) return
  try {
    const payload = JSON.stringify({
      v: 1,
      date: dateKey,
      text: quote.text,
      source: quote.source || '一言',
      fallback: fallback === true,
    })
    if (payload.length > QUOTE_CACHE_MAX_LEN) return
    storage?.setItem(QUOTE_KEY, payload)
  } catch {
    // 存储不可用或超限：仅内存态生效
  }
}

/** 请求一言；超时/非 2xx/解析失败一律返回 null，由调用方走降级 */
export async function requestQuote(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS)
  try {
    const res = await fetchImpl(`${QUOTE_API}&_=${Date.now()}`, { signal: controller.signal })
    if (!res || !res.ok) return null
    const data = await res.json()
    return normalizeQuote(data)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
