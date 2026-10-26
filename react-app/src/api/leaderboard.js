/**
 * 排行榜 API（localStorage 本地版）
 * 说明：支付宝云空间无法免 HBuilderX 创建云函数，web 直连也不支持，
 * 故先以 localStorage 实现，接口与未来云函数版保持一致，届时仅需替换本文件。
 * 存储结构：[{ name, score, elapsed, createdAt }]
 *
 * 2026-10-18 改造：createLeaderboard(storageKey) 支持按游戏指定存储键，
 * 默认键 game-leaderboard-v1（飞机大战）保持不变；俄罗斯方块使用 game-tetris-leaderboard-v1。
 */

const DEFAULT_STORAGE_KEY = 'game-leaderboard-v1'
const MAX_ROWS = 50 // 本地最多保留 50 条
const PAUSE_CACHE_KEY = 'game-pause-board-cache-v1'
const PAUSE_CACHE_TTL = 5 * 60 * 1000 // 暂停页降级缓存有效期 5 分钟
const SAFE_TIMEOUT = 3000

/**
 * 创建一套绑定指定存储键的排行榜接口
 * @param {string} storageKey localStorage 键名
 */
export function createLeaderboard(storageKey = DEFAULT_STORAGE_KEY) {
  function loadRows() {
    try {
      const raw = localStorage.getItem(storageKey)
      const rows = raw ? JSON.parse(raw) : []
      return Array.isArray(rows) ? rows : []
    } catch {
      return []
    }
  }

  function saveRows(rows) {
    localStorage.setItem(storageKey, JSON.stringify(rows.slice(0, MAX_ROWS)))
  }

  function sortByRank(rows) {
    return [...rows].sort(
      (a, b) => b.score - a.score || a.createdAt - b.createdAt
    )
  }

  return {
    /** 获取 TOP 10，返回 Promise 以对齐云函数版的异步接口 */
    fetchTopScores() {
      const rows = sortByRank(loadRows()).slice(0, 10)
      return Promise.resolve(rows)
    },

    /**
     * 提交分数，返回 { rank }（在本地榜单中的名次）
     */
    submitScore(name, score, elapsed) {
      const rows = loadRows()
      const row = {
        name: String(name || '无名飞侠').slice(0, 12),
        score: Math.max(1, Math.floor(Number(score) || 0)),
        elapsed: Math.round((Number(elapsed) || 0) * 10) / 10,
        createdAt: Date.now(),
      }
      if (row.score <= 0) {
        return Promise.reject(new Error('分数无效'))
      }
      rows.push(row)
      const sorted = sortByRank(rows)
      const rank = sorted.findIndex((r) => r.createdAt === row.createdAt) + 1
      saveRows(sorted)
      return Promise.resolve({ rank: rank || sorted.length })
    },
  }
}

// 向后兼容：默认键（飞机大战 game-leaderboard-v1）的顶层导出，既有调用方无需改动
const defaultLeaderboard = createLeaderboard()

export function fetchTopScores() {
  return defaultLeaderboard.fetchTopScores()
}

export function submitScore(name, score, elapsed) {
  return defaultLeaderboard.submitScore(name, score, elapsed)
}

/** 超时包装：本地版立即返回，为未来云函数版预留 3s 超时能力 */
function withTimeout(promise, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('leaderboard-timeout')), timeout)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function readPauseCache() {
  try {
    const raw = localStorage.getItem(PAUSE_CACHE_KEY)
    if (!raw) return { items: [], source: 'error' }
    const data = JSON.parse(raw)
    const valid =
      data &&
      Array.isArray(data.items) &&
      Number.isFinite(data.ts) &&
      Date.now() - data.ts <= PAUSE_CACHE_TTL
    if (!valid) return { items: [], source: 'error' }
    return { items: data.items.slice(0, 10), source: 'cache', cachedAt: data.ts }
  } catch {
    try {
      localStorage.removeItem(PAUSE_CACHE_KEY)
    } catch {
      // localStorage 不可用：忽略清理
    }
    return { items: [], source: 'error' }
  }
}

function writePauseCache(items) {
  try {
    localStorage.setItem(
      PAUSE_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), items: items.slice(0, 10) })
    )
  } catch {
    // 配额不足或不可用时跳过缓存，不影响排行榜读取
  }
}

/**
 * 暂停页专用安全读取：3s 超时 + 5 分钟缓存降级
 * @returns {Promise<{items: Array, source: 'remote'|'cache'|'error', cachedAt?: number}>}
 */
export async function loadTopScoresSafe({ timeout = SAFE_TIMEOUT } = {}) {
  // 离线时直接读缓存，避免等待超时
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return readPauseCache()
  }
  try {
    const items = await withTimeout(defaultLeaderboard.fetchTopScores(), timeout)
    if (!Array.isArray(items)) return readPauseCache()
    writePauseCache(items)
    return { items, source: 'remote' }
  } catch {
    return readPauseCache()
  }
}
