/**
 * 排行榜 API（localStorage 本地版）
 * 说明：支付宝云空间无法免 HBuilderX 创建云函数，web 直连也不支持，
 * 故先以 localStorage 实现，接口与未来云函数版保持一致，届时仅需替换本文件。
 * 存储结构：[{ name, score, elapsed, createdAt }]
 */

const STORAGE_KEY = 'game-leaderboard-v1'
const MAX_ROWS = 50 // 本地最多保留 50 条

function loadRows() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const rows = raw ? JSON.parse(raw) : []
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

function saveRows(rows) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, MAX_ROWS)))
}

function sortByRank(rows) {
  return [...rows].sort(
    (a, b) => b.score - a.score || a.createdAt - b.createdAt
  )
}

/** 获取 TOP 10，返回 Promise 以对齐云函数版的异步接口 */
export function fetchTopScores() {
  const rows = sortByRank(loadRows()).slice(0, 10)
  return Promise.resolve(rows)
}

/**
 * 提交分数，返回 { rank }（在本地榜单中的名次）
 */
export function submitScore(name, score, elapsed) {
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
}
