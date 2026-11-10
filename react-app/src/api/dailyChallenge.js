/**
 * 首页「今日游戏挑战」数据层（纯函数 + localStorage 读写）
 * - 按本地日期确定性从 16 款可玩小游戏中选一款：同一日期恒定，连续两天必不相同
 * - 「今日一句」来自一言 API；校验失败或请求失败时降级到本地句子池
 * - 存储读写全部容错：不可用 / JSON 损坏 / 版本或日期不符一律视为无数据
 *
 * 日期键统一为本地时区的 `YYYY-MM-DD`，与用户感知的「今天」一致。
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** 可玩小游戏注册表（slug 必须与 App.jsx 既有路由一致，本次不新增路由） */
export const GAME_ROSTER = [
  { slug: 'game', name: '飞机大战', to: '/game', rule: '移动战机、击落敌机、躲开弹幕，生命耗尽结束', difficulty: '中等', duration: '5~10 分钟' },
  { slug: '2048', name: '2048 小游戏', to: '/2048', rule: '滑动合并相同数字，拼出 2048', difficulty: '简单', duration: '3~8 分钟' },
  { slug: 'tetris', name: '俄罗斯方块', to: '/tetris', rule: '旋转下落的方块，填满整行即可消除', difficulty: '中等', duration: '5~10 分钟' },
  { slug: 'snake', name: '贪吃蛇', to: '/snake', rule: '吃食物变长，别撞墙也别撞到自己', difficulty: '简单', duration: '2~5 分钟' },
  { slug: 'breakout', name: '打砖块', to: '/breakout', rule: '控制挡板弹球，打光全部砖块', difficulty: '中等', duration: '5~10 分钟' },
  { slug: 'memory', name: '记忆翻牌', to: '/memory', rule: '翻开两张相同图案的牌，配对全部消除', difficulty: '简单', duration: '2~4 分钟' },
  { slug: 'whack', name: '打地鼠', to: '/whack', rule: '30 秒内敲中冒头的地鼠，连击额外加分', difficulty: '简单', duration: '1 分钟' },
  { slug: 'puzzle', name: '数字华容道', to: '/puzzle', rule: '滑动数字块，把 1~8 按顺序排好', difficulty: '中等', duration: '3~8 分钟' },
  { slug: 'lightsout', name: '关灯挑战', to: '/lightsout', rule: '点按翻转十字灯组，把所有灯熄灭', difficulty: '困难', duration: '2~6 分钟' },
  { slug: 'connect4', name: '四连棋', to: '/connect4', rule: '轮流落子，先连成四子一线者获胜', difficulty: '中等', duration: '3~8 分钟' },
  { slug: 'lianliankan', name: '连连看', to: '/lianliankan', rule: '点两张相同图案，两次转弯内连通即可消除', difficulty: '中等', duration: '3~8 分钟' },
  { slug: 'sokoban', name: '推箱子', to: '/sokoban', rule: '把箱子推到目标点过关，步数越少分越高', difficulty: '中等', duration: '3~8 分钟' },
  { slug: 'reversi', name: '黑白棋', to: '/reversi', rule: '夹吃翻转对手棋子，终局子多者胜', difficulty: '中等', duration: '3~8 分钟' },
  { slug: 'minesweeper', name: '扫雷', to: '/minesweeper', rule: '依据数字提示避开所有地雷，清空雷区', difficulty: '困难', duration: '2~6 分钟' },
  { slug: 'maze', name: '迷宫寻路', to: '/maze', rule: '从左上角走到右下角，步数越少分越高', difficulty: '简单', duration: '1~3 分钟' },
  { slug: 'sudoku', name: '数独', to: '/sudoku', rule: '填入 1~9 使每行每列每宫不重复，错误 3 次判负', difficulty: '困难', duration: '2~5 分钟' },
]

/** 本地降级句子池：接口不可用时按日期确定性选句 */
export const FALLBACK_QUOTES = [
  { text: '慢慢来，比较快。', source: '本地句子池' },
  { text: '把今天过好，明天自然会有答案。', source: '本地句子池' },
  { text: '专注一件事，比同时开始十件事更接近完成。', source: '本地句子池' },
  { text: '休息不是浪费时间，是下一次出发的准备。', source: '本地句子池' },
  { text: '小步前进，也是在前进。', source: '本地句子池' },
  { text: '先完成，再完美。', source: '本地句子池' },
  { text: '认真玩一局，也是认真生活的一部分。', source: '本地句子池' },
  { text: '今天比昨天多懂一点，就够了。', source: '本地句子池' },
]

export const QUOTE_API = 'https://v1.hitokoto.cn/?encode=json&charset=utf-8'
export const QUOTE_TIMEOUT_MS = 10 * 1000
export const DATE_CHECK_MS = 60 * 1000

export const OPEN_KEY = 'daily-challenge-open'
export const QUOTE_KEY = 'daily-challenge-quote'
// 缓存的体积上限（字符数），超限不写入，避免单条名言撑大存储
const QUOTE_CACHE_MAX_LEN = 200

/** 本地日期 → `YYYY-MM-DD` */
export function dateKeyOf(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 日期键 → 自 1970-01-01 起的天数序号；格式非法或日期越界时返回 NaN */
export function dayNumber(dateKey) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''))
  if (!matched) return NaN
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return NaN
  const ts = Date.UTC(year, month - 1, day)
  const probe = new Date(ts)
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return NaN
  }
  return Math.floor(ts / DAY_MS)
}

/**
 * 按日期选游戏：索引 = (天数序号 + 年份*7) % 游戏数
 * 天数序号每天 +1，因此连续两天索引必不相同；年份加权避免固定周期过于机械。
 */
export function pickDailyChallenge(dateKey, roster = GAME_ROSTER) {
  if (!Array.isArray(roster) || roster.length === 0) return null
  const day = dayNumber(dateKey)
  if (!Number.isFinite(day)) return null
  if (roster.length === 1) return roster[0]
  const year = Number(String(dateKey).slice(0, 4))
  const index = (day + year * 7) % roster.length
  return roster[index]
}

/** 按日期选本地降级句子；句子池为空时返回 null */
export function pickFallbackQuote(dateKey, pool = FALLBACK_QUOTES) {
  if (!Array.isArray(pool) || pool.length === 0) return null
  const day = dayNumber(dateKey)
  if (!Number.isFinite(day)) return pool[0]
  return pool[day % pool.length]
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

/** 今日是否已点击开始挑战 */
export function readOpened(storage, dateKey) {
  try {
    const raw = storage?.getItem(OPEN_KEY)
    if (!raw) return false
    const data = JSON.parse(raw)
    return !!data && data.v === 1 && data.date === dateKey
  } catch {
    return false
  }
}

/** 记录今日已点击开始挑战；存储不可用时静默忽略 */
export function markOpened(storage, dateKey) {
  try {
    storage?.setItem(OPEN_KEY, JSON.stringify({ v: 1, date: dateKey, ts: Date.now() }))
  } catch {
    // 隐私模式 / 配额满：仅内存态生效
  }
}

/** 读取当日名言缓存；结构损坏、版本或日期不符返回 null */
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

/** 写入当日名言缓存（成功与降级都写，避免同日反复请求失败接口） */
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
