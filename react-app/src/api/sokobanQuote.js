/**
 * 推箱子「通关寄语」数据层（纯函数 + localStorage 读写）
 * - 优先请求一言 API；超时/非 2xx/字段非法时降级到本地句子池
 * - 成功与降级都按日缓存，避免同日反复请求失败接口
 * - 存储读写全部容错：不可用 / JSON 损坏 / 版本或日期不符一律视为无数据
 */

export const QUOTE_API = 'https://v1.hitokoto.cn/?encode=json&charset=utf-8'
export const QUOTE_TIMEOUT_MS = 3 * 1000
export const QUOTE_KEY = 'game-sokoban-quote-v1'
const QUOTE_CACHE_MAX_LEN = 200

/** 本地降级句子池：按关卡确定性选句 */
export const FALLBACK_QUOTES = [
  { text: '箱子归位，心也归位。', source: '本地句子池' },
  { text: '想清楚再推，比推错了再撤更快。', source: '本地句子池' },
  { text: '一次只解决一个箱子。', source: '本地句子池' },
  { text: '退一步，是为了把下一步走对。', source: '本地句子池' },
  { text: '路是绕出来的，不是撞出来的。', source: '本地句子池' },
  { text: '先完成这一关，再去下一关。', source: '本地句子池' },
  { text: '能重开，就不怕走错。', source: '本地句子池' },
  { text: '把复杂拆成一小步一小步。', source: '本地句子池' },
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

/** 按关卡选本地降级句子；句子池为空时返回 null */
export function pickFallbackQuote(levelId, pool = FALLBACK_QUOTES) {
  if (!Array.isArray(pool) || pool.length === 0) return null
  const n = Number(levelId)
  const index = Number.isFinite(n) && n >= 1 ? (Math.floor(n) - 1) % pool.length : 0
  return pool[index]
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

/** 写入当日寄语缓存（成功与降级都写） */
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
