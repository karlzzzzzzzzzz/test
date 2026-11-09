import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * 天气卡片：数据来自 Open-Meteo 免费 API（无需 API Key）
 * - 优先使用浏览器定位，拒绝/失败时回退到杭州（拒绝授权时显示提示条）
 * - 当前实况 + 今日最高/最低温
 * - 地名通过 BigDataCloud 免费逆地理接口补全（失败时静默降级）
 * - 请求链路：10s 超时 + 并发去重 + 最多 2 次退避重试（1s / 3s）
 * - 四态：loading / ok / stale（展示上次成功快照）/ error
 * - 自动刷新：成功 10 分钟；连续失败按 20 / 40 / 60 分钟指数退避
 * - 数据状态通过 useWeather 提升至 Home，供统计条天气摘要格共享
 */

// 定位失败时的默认坐标（杭州）
const FALLBACK = { lat: 30.2809, lon: 120.0267, label: '杭州（默认）' }
// 自动刷新基准间隔
const REFRESH_INTERVAL = 10 * 60 * 1000
// 连续失败退避档位：1 次 → 20 分钟，2 次 → 40 分钟，≥3 次 → 60 分钟
const BACKOFF_STEPS = [20 * 60 * 1000, 40 * 60 * 1000, 60 * 60 * 1000]
// 单次请求超时
const REQUEST_TIMEOUT = 10 * 1000
// 失败重试间隔（最多 2 次）
const RETRY_DELAYS = [1000, 3000]
// 快照可用于降级展示的最大年龄
const STALE_MAX_AGE = 60 * 60 * 1000
// 快照与退避记录的过期时间
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
// 快照体积上限（序列化字符数）
const SNAPSHOT_MAX_CHARS = 500 * 1024
// 手动刷新节流窗口
const REFRESH_THROTTLE = 30 * 1000
// 重试/回退按钮点击后的冻结时长
const ACTION_FREEZE = 5000
// 状态事件节流窗口
const STATE_EVENT_THROTTLE = 500
const SNAPSHOT_KEY = 'weather-last-ok'
const BACKOFF_KEY = 'weather-auto-backoff'
// 定位拒绝提示的会话标记（每会话最多自动提示 1 次）
const DENIED_TIP_KEY = 'weather-geo-denied-tip'
// 未知/加载态下的默认粒子词库
const DEFAULT_KEYWORDS = '气温,湿度,风速,体感,天气预报,天气'

// 模块级节流时间戳：刷新页面即重置，组件卸载重挂不重置（防反复进出页面刷接口）
let lastManualRefreshAt = 0

// WMO 天气代码 → [中文描述, 白天图标, 夜间图标]
const WMO_CODES = {
  0: ['晴', '☀️', '🌙'],
  1: ['大部晴朗', '🌤️', '🌙'],
  2: ['多云', '⛅', '☁️'],
  3: ['阴', '☁️', '☁️'],
  45: ['雾', '🌫️', '🌫️'],
  48: ['雾凇', '🌫️', '🌫️'],
  51: ['小毛毛雨', '🌦️', '🌦️'],
  53: ['毛毛雨', '🌦️', '🌦️'],
  55: ['浓毛毛雨', '🌧️', '🌧️'],
  56: ['冻毛毛雨', '🌧️', '🌧️'],
  57: ['冻毛毛雨', '🌧️', '🌧️'],
  61: ['小雨', '🌦️', '🌦️'],
  63: ['中雨', '🌧️', '🌧️'],
  65: ['大雨', '🌧️', '🌧️'],
  66: ['冻雨', '🌧️', '🌧️'],
  67: ['冻雨', '🌧️', '🌧️'],
  71: ['小雪', '🌨️', '🌨️'],
  73: ['中雪', '🌨️', '🌨️'],
  75: ['大雪', '❄️', '❄️'],
  77: ['雪粒', '🌨️', '🌨️'],
  80: ['小阵雨', '🌦️', '🌦️'],
  81: ['阵雨', '🌧️', '🌧️'],
  82: ['强阵雨', '⛈️', '⛈️'],
  85: ['阵雪', '🌨️', '🌨️'],
  86: ['强阵雪', '❄️', '❄️'],
  95: ['雷暴', '⛈️', '⛈️'],
  96: ['雷暴伴冰雹', '⛈️', '⛈️'],
  99: ['强雷暴伴冰雹', '⛈️', '⛈️'],
}

function describeWeather(code, isDay) {
  const [desc, dayIcon, nightIcon] = WMO_CODES[code] || ['未知', '🌡️', '🌡️']
  return { desc, icon: isDay ? dayIcon : nightIcon }
}

// 天气 → MouseTrail 粒子词库（6 词）；未知/加载态回退默认词库
function weatherWordsOf(desc) {
  if (!desc) return DEFAULT_KEYWORDS
  if (desc.includes('晴')) return '晴空,阳光,紫外线,防晒,气温,晾晒'
  if (desc.includes('雨')) return '降雨,雨伞,湿度,路面,积水,雨声'
  if (desc.includes('雪')) return '降雪,雪景,防滑,低温,积雪,保暖'
  if (desc.includes('雾')) return '雾气,能见度,湿度,慢行,灯光,气压'
  if (desc.includes('雷')) return '雷暴,闪电,避雨,气压,湿度,预警'
  if (desc.includes('云') || desc.includes('阴')) return '云层,气温,通勤,体感,风向,晾晒'
  return DEFAULT_KEYWORDS
}

const delayForFailCount = (failCount) => {
  if (failCount <= 0) return REFRESH_INTERVAL
  const index = Math.min(failCount, BACKOFF_STEPS.length) - 1
  return BACKOFF_STEPS[index]
}

const minutesOf = (ts) => (ts ? Math.max(1, Math.round((Date.now() - ts) / 60000)) : 0)

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

// ===== 本地快照与退避记录（localStorage 不可用时静默降级为纯内存） =====
function readSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const snapshot = JSON.parse(raw)
    if (!snapshot || !snapshot.current || !snapshot.ts) return null
    if (Date.now() - Number(snapshot.ts) > CACHE_TTL) {
      localStorage.removeItem(SNAPSHOT_KEY)
      return null
    }
    return snapshot
  } catch {
    return null
  }
}

function writeSnapshot(snapshot) {
  try {
    const raw = JSON.stringify(snapshot)
    if (raw.length > SNAPSHOT_MAX_CHARS) return false
    localStorage.setItem(SNAPSHOT_KEY, raw)
    return true
  } catch {
    try {
      localStorage.removeItem(SNAPSHOT_KEY)
    } catch {
      // 存储不可用：仅内存快照
    }
    return false
  }
}

function readBackoff() {
  try {
    const raw = localStorage.getItem(BACKOFF_KEY)
    if (!raw) return { failCount: 0, nextAt: 0 }
    const parsed = JSON.parse(raw)
    const failCount = Math.max(0, Math.min(9, Number(parsed.failCount) || 0))
    const nextAt = Number(parsed.nextAt) || 0
    if (nextAt && Date.now() - nextAt > CACHE_TTL) {
      localStorage.removeItem(BACKOFF_KEY)
      return { failCount: 0, nextAt: 0 }
    }
    return { failCount, nextAt }
  } catch {
    return { failCount: 0, nextAt: 0 }
  }
}

function writeBackoff(failCount, nextAt) {
  try {
    localStorage.setItem(BACKOFF_KEY, JSON.stringify({ failCount, nextAt }))
  } catch {
    // 存储不可用：退避仅在内存生效
  }
}

// ===== 移动端适配检测 =====
// 断点对齐首页统一体系：≥1024 / 768~1023 / 480~767 / <480
const ADAPT_DESKTOP_MIN = 1024
const ADAPT_TABLET_MIN = 768
const ADAPT_MOBILE_MIN = 480
const ADAPT_TOLERANCE = 2 // 取整与亚像素容差
const ADAPT_DEBOUNCE = 300
const ADAPT_RECHECK_DELAY = 200
const ADAPT_REPORT_THROTTLE = 500
const ADAPT_HIDDEN_WIDTH = 100
const ADAPT_PADDING_X = 24 // 与 .bento-weather 左右 padding 一致
const ADAPT_WATCHED = ['.weather-body', '.weather-meta', '.weather-place', '.weather-error']

function getAdaptTier(viewportWidth) {
  if (viewportWidth >= ADAPT_DESKTOP_MIN) return 'desktop'
  if (viewportWidth >= ADAPT_TABLET_MIN) return 'tablet'
  if (viewportWidth >= ADAPT_MOBILE_MIN) return 'mobile'
  return 'compact'
}

// 检查已渲染子元素是否横向溢出卡片（scrollWidth 超出或越过卡片内边距）
function findClippedElements(card) {
  const cardRect = card.getBoundingClientRect()
  const leftLimit = cardRect.left + ADAPT_PADDING_X - ADAPT_TOLERANCE
  const rightLimit = cardRect.right - ADAPT_PADDING_X + ADAPT_TOLERANCE
  const clipped = []
  // 页面级横向滚动：卡片被内容撑宽时自身不会越界，溢出会体现在文档宽度上
  const docEl = card.ownerDocument.documentElement
  if (docEl.scrollWidth - docEl.clientWidth > ADAPT_TOLERANCE) clipped.push('page')
  ADAPT_WATCHED.forEach((selector) => {
    const el = card.querySelector(selector)
    if (!el) return
    const rect = el.getBoundingClientRect()
    const scrollOverflow = el.scrollWidth - el.clientWidth
    if (
      scrollOverflow > ADAPT_TOLERANCE ||
      rect.right > rightLimit ||
      rect.left < leftLimit
    ) {
      clipped.push(selector.slice(1))
    }
  })
  return clipped
}

/**
 * 适配检测 hook：视口断点 + 卡片实测宽度 + 子元素溢出检测
 * - 尺寸变化 300ms 防抖；异常需间隔 200ms 两次确认
 * - 状态变化通过 data-adapt-* 落到卡片根节点，并派发 weather:adapt:report 埋点
 * - 只读 DOM 尺寸，不发请求、不写存储
 */
function useAdaptiveProbe(cardRef, status) {
  const [tier, setTier] = useState(() => getAdaptTier(window.innerWidth))
  const [cardWidth, setCardWidth] = useState(0)
  const [overflowCount, setOverflowCount] = useState(0)

  const statusRef = useRef(status)
  const mountedRef = useRef(true)
  const observerModeRef = useRef(true)
  const checkTimerRef = useRef(null)
  const recheckTimerRef = useRef(null)
  const reportTimerRef = useRef(null)
  const pendingResultRef = useRef(null)
  const pendingReportRef = useRef(null)
  const lastReportAtRef = useRef(0)
  const lastSignatureRef = useRef('')

  // 派发埋点：签名去重 + 500ms 节流（节流期内保留最后一次状态）
  const flushReport = useCallback(() => {
    reportTimerRef.current = null
    const entry = pendingReportRef.current
    pendingReportRef.current = null
    if (!entry || !mountedRef.current) return
    if (entry.signature === lastSignatureRef.current) return
    lastSignatureRef.current = entry.signature
    lastReportAtRef.current = Date.now()
    window.dispatchEvent(new CustomEvent('weather:adapt:report', { detail: entry.payload }))
    const prev = window.__weatherAdaptStats || {}
    window.__weatherAdaptStats = {
      count: Math.min(99999, (Number(prev.count) || 0) + 1),
      lastTier: entry.payload.viewportTier,
      lastOverflowCount: entry.payload.overflowCount,
      lastTs: entry.payload.ts,
      observer: entry.payload.observer,
    }
  }, [])

  const enqueueReport = useCallback((result) => {
    const signature = `${result.tier}|${result.clipped.length}|${result.clipped.join(',')}`
    if (signature === lastSignatureRef.current) return
    pendingReportRef.current = {
      signature,
      payload: {
        viewportTier: result.tier,
        viewportWidth: window.innerWidth,
        cardWidth: result.width,
        overflowCount: result.clipped.length,
        clippedElements: result.clipped.slice(0, 4),
        observer: observerModeRef.current,
        ts: Date.now(),
      },
    }
    if (reportTimerRef.current) return
    const delay = Math.max(0, ADAPT_REPORT_THROTTLE - (Date.now() - lastReportAtRef.current))
    if (delay === 0) flushReport()
    else reportTimerRef.current = setTimeout(flushReport, delay)
  }, [flushReport])

  const applyResult = useCallback((result) => {
    if (!mountedRef.current) return
    setTier(result.tier)
    setCardWidth(result.width)
    setOverflowCount(result.clipped.length)
    enqueueReport(result)
  }, [enqueueReport])

  const runCheck = useCallback(() => {
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    if (rect.width < ADAPT_HIDDEN_WIDTH) {
      // 卡片隐藏 / 未完成布局：跳过本轮，保留上次状态
      clearTimeout(recheckTimerRef.current)
      recheckTimerRef.current = null
      pendingResultRef.current = null
      return
    }

    const result = {
      tier: getAdaptTier(window.innerWidth),
      width: Math.round(rect.width),
      clipped: statusRef.current === 'loading' ? [] : findClippedElements(card),
    }

    if (!result.clipped.length) {
      // 一次正常检测即恢复，清除待确认异常
      clearTimeout(recheckTimerRef.current)
      recheckTimerRef.current = null
      pendingResultRef.current = null
      applyResult(result)
      return
    }

    // 首次异常：200ms 后复检，两次均异常才确认
    pendingResultRef.current = result
    clearTimeout(recheckTimerRef.current)
    recheckTimerRef.current = setTimeout(() => {
      recheckTimerRef.current = null
      const cardNow = cardRef.current
      if (!cardNow || !mountedRef.current) return
      const rectNow = cardNow.getBoundingClientRect()
      if (rectNow.width < ADAPT_HIDDEN_WIDTH) return
      pendingResultRef.current = null
      applyResult({
        tier: getAdaptTier(window.innerWidth),
        width: Math.round(rectNow.width),
        clipped: statusRef.current === 'loading' ? [] : findClippedElements(cardNow),
      })
    }, ADAPT_RECHECK_DELAY)
  }, [applyResult, cardRef])

  const scheduleCheck = useCallback(() => {
    clearTimeout(checkTimerRef.current)
    checkTimerRef.current = setTimeout(() => {
      checkTimerRef.current = null
      runCheck()
    }, ADAPT_DEBOUNCE)
  }, [runCheck])

  // 手动重新检测：跳过 300ms 防抖
  const recheck = useCallback(() => {
    clearTimeout(checkTimerRef.current)
    checkTimerRef.current = null
    runCheck()
  }, [runCheck])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    mountedRef.current = true
    const card = cardRef.current
    if (!card) return

    const supported = 'ResizeObserver' in window
    observerModeRef.current = supported
    const prevStats = window.__weatherAdaptStats
    window.__weatherAdaptStats = {
      count: Number(prevStats?.count) || 0,
      lastTier: prevStats?.lastTier ?? null,
      lastOverflowCount: Number(prevStats?.lastOverflowCount) || 0,
      lastTs: prevStats?.lastTs ?? 0,
      observer: supported,
    }

    let observer = null
    if (supported) {
      observer = new ResizeObserver(scheduleCheck)
      observer.observe(card)
    }
    // 视口断点可能先于卡片宽度变化，始终补充窗口 resize 监听
    window.addEventListener('resize', scheduleCheck)
    runCheck()

    return () => {
      mountedRef.current = false
      if (observer) observer.disconnect()
      window.removeEventListener('resize', scheduleCheck)
      clearTimeout(checkTimerRef.current)
      clearTimeout(recheckTimerRef.current)
      clearTimeout(reportTimerRef.current)
      checkTimerRef.current = null
      recheckTimerRef.current = null
      reportTimerRef.current = null
      pendingResultRef.current = null
      pendingReportRef.current = null
    }
  }, [cardRef, runCheck, scheduleCheck])

  // 加载结束（成功或失败）200ms 后补一次完整检测
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (prev === 'loading' && status !== 'loading') {
      const timer = setTimeout(() => {
        if (mountedRef.current) runCheck()
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [status, runCheck])

  return { tier, cardWidth, overflowCount, recheck }
}

// 获取坐标：浏览器定位 → 拒绝/失败回退默认城市（denied 标记是否为用户拒绝授权）
function getCoords() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ ...FALLBACK, fallback: true, denied: false })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        fallback: false,
        denied: false,
      }),
      (err) => resolve({ ...FALLBACK, fallback: true, denied: err.code === err.PERMISSION_DENIED }),
      { timeout: 8000, maximumAge: 600000 },
    )
  })
}

// 逆地理编码（免费、无需 Key），失败时静默忽略
async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`,
    )
    if (!res.ok) return ''
    const d = await res.json()
    return d.city || d.locality || d.principalSubdivision || ''
  } catch {
    return ''
  }
}

function buildWeatherUrl(lat, lon) {
  return 'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m' +
    '&daily=temperature_2m_max,temperature_2m_min' +
    '&timezone=auto&forecast_days=1'
}

/**
 * 带超时的 JSON 请求：10s 未返回即中断并按 timeout 归类
 * AbortController 不可用时降级为 Promise.race + 定时器
 */
function requestJson(url, abortRef) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  if (controller) abortRef.current = controller
  let timer = null
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (controller) controller.abort()
      const error = new Error('timeout')
      error.reason = 'timeout'
      reject(error)
    }, REQUEST_TIMEOUT)
  })
  const request = fetch(url, controller ? { signal: controller.signal } : undefined)
    .then((res) => {
      if (!res.ok) {
        const error = new Error(`HTTP ${res.status}`)
        error.reason = 'http'
        throw error
      }
      return res.json()
    })
    .catch((error) => {
      if (error && error.reason) throw error
      const wrapped = new Error(error?.message || 'network')
      wrapped.reason = controller && error?.name === 'AbortError' ? 'timeout' : 'network'
      throw wrapped
    })
  return Promise.race([request, timeout]).finally(() => {
    clearTimeout(timer)
    if (abortRef.current === controller) abortRef.current = null
  })
}

/**
 * 天气数据 hook：状态提升至 Home，Weather 卡片与统计条摘要格共用同一份状态
 * 四态：loading / ok / stale / error；失败时最多回退到 60 分钟内的成功快照
 */
export function useWeather() {
  // 首屏启动数据：上次成功快照 + 退避记录（只读一次）
  const [bootSnapshot] = useState(readSnapshot)
  const [bootBackoff] = useState(readBackoff)

  const [data, setData] = useState(() => (
    bootSnapshot ? { current: bootSnapshot.current, daily: bootSnapshot.daily } : null
  ))
  const [place, setPlace] = useState(() => bootSnapshot?.place || '')
  const [status, setStatus] = useState('loading') // loading | ok | stale | error
  const [staleTs, setStaleTs] = useState(0)
  const [failCount, setFailCount] = useState(bootBackoff.failCount)
  const [failReason, setFailReason] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [geoDeniedTip, setGeoDeniedTip] = useState(false)
  const [throttleTip, setThrottleTip] = useState(false)
  const [actionLocked, setActionLocked] = useState(false)
  const [hasPrev, setHasPrev] = useState(false)
  const [paused, setPaused] = useState(false)
  // 每次加载结束自增，驱动自动刷新重新排期
  const [loadSeq, setLoadSeq] = useState(0)

  const mountedRef = useRef(true)
  const abortRef = useRef(null)
  const inFlightRef = useRef(null)
  const snapshotRef = useRef(bootSnapshot)
  const prevSnapshotRef = useRef(null)
  const failCountRef = useRef(bootBackoff.failCount)
  const nextAtRef = useRef(bootBackoff.nextAt)
  const lastLoadAtRef = useRef(0)
  const throttleTimerRef = useRef(null)
  const freezeTimerRef = useRef(null)
  const resumeTimerRef = useRef(null)
  // 状态事件节流（签名去重 + 500ms）
  const statePendingRef = useRef(null)
  const stateTimerRef = useRef(null)
  const stateLastAtRef = useRef(0)
  const stateSignatureRef = useRef('')

  const applyGeoDeniedTip = useCallback((denied, manual) => {
    if (!denied) {
      try {
        sessionStorage.removeItem(DENIED_TIP_KEY)
      } catch {
        // 忽略存储异常
      }
      setGeoDeniedTip(false)
      return
    }
    // 手动重试被拒：无条件复现提示；自动加载被拒：每会话最多提示 1 次
    if (manual) {
      setGeoDeniedTip(true)
      return
    }
    try {
      if (!sessionStorage.getItem(DENIED_TIP_KEY)) {
        sessionStorage.setItem(DENIED_TIP_KEY, '1')
        setGeoDeniedTip(true)
      }
    } catch {
      setGeoDeniedTip(true)
    }
  }, [])

  const load = useCallback(async ({ manual = false } = {}) => {
    // 并发去重：同一时刻只保留 1 个 in-flight 请求
    if (inFlightRef.current) return inFlightRef.current
    setRefreshing(true)
    const run = (async () => {
      let geoFallback = false
      let coords
      try {
        coords = await getCoords()
        geoFallback = coords.fallback
      } catch {
        coords = { ...FALLBACK, fallback: true, denied: false }
        geoFallback = true
      }
      if (!mountedRef.current) return

      let json = null
      let reason = geoFallback ? 'geo' : 'network'
      for (let i = 0; i <= RETRY_DELAYS.length; i += 1) {
        try {
          json = await requestJson(buildWeatherUrl(coords.lat, coords.lon), abortRef)
          break
        } catch (error) {
          reason = error?.reason || 'network'
          if (i < RETRY_DELAYS.length) {
            await sleep(RETRY_DELAYS[i])
            if (!mountedRef.current) return
          }
        }
      }
      if (!mountedRef.current) return

      if (json && json.current) {
        let nextPlace = coords.label || FALLBACK.label
        if (!geoFallback) {
          nextPlace = (await reverseGeocode(coords.lat, coords.lon)) || '当前位置'
          if (!mountedRef.current) return
        }
        const snapshot = { current: json.current, daily: json.daily, place: nextPlace, ts: Date.now() }
        if (snapshotRef.current) {
          prevSnapshotRef.current = snapshotRef.current
          setHasPrev(true)
        }
        snapshotRef.current = snapshot
        writeSnapshot(snapshot)
        failCountRef.current = 0
        nextAtRef.current = 0
        writeBackoff(0, 0)
        setFailCount(0)
        setFailReason('')
        setData(json)
        setPlace(nextPlace)
        setStaleTs(0)
        setStatus('ok')
        applyGeoDeniedTip(Boolean(coords.denied), manual)
        return
      }

      // 全部重试失败：累计失败次数并按指数退避排期
      const nextFailCount = Math.min(failCountRef.current + 1, BACKOFF_STEPS.length + 1)
      failCountRef.current = nextFailCount
      nextAtRef.current = Date.now() + delayForFailCount(nextFailCount)
      writeBackoff(nextFailCount, nextAtRef.current)
      setFailCount(nextFailCount)
      setFailReason(geoFallback ? 'geo' : reason)

      const snapshot = snapshotRef.current
      const age = snapshot ? Date.now() - Number(snapshot.ts || 0) : Infinity
      if (snapshot && age <= STALE_MAX_AGE) {
        // 快照有效期内的降级展示（stale）
        setData({ current: snapshot.current, daily: snapshot.daily })
        setPlace(snapshot.place || '')
        setStaleTs(Number(snapshot.ts) || Date.now())
        setStatus('stale')
      } else {
        setData(null)
        setStaleTs(0)
        setStatus('error')
      }
    })()
    inFlightRef.current = run
    try {
      await run
    } finally {
      if (inFlightRef.current === run) inFlightRef.current = null
      if (mountedRef.current) {
        setRefreshing(false)
        lastLoadAtRef.current = Date.now()
        setLoadSeq((n) => n + 1)
      }
    }
    return run
  }, [applyGeoDeniedTip])

  // 手动刷新（↻ 按钮）：30s 节流，节流命中时提示
  const refresh = useCallback(() => {
    const now = Date.now()
    if (now - lastManualRefreshAt < REFRESH_THROTTLE) {
      setThrottleTip(true)
      clearTimeout(throttleTimerRef.current)
      throttleTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setThrottleTip(false)
      }, 2000)
      return
    }
    lastManualRefreshAt = now
    load({ manual: true })
  }, [load])

  // 重试/回退按钮冻结 5s，避免连点打穿退避策略
  const freezeActions = useCallback(() => {
    setActionLocked(true)
    clearTimeout(freezeTimerRef.current)
    freezeTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setActionLocked(false)
    }, ACTION_FREEZE)
  }, [])

  // 重试：重新走完整定位 + 天气链路，不受 30s 手动刷新节流限制
  const retry = useCallback(() => {
    freezeActions()
    load({ manual: true })
  }, [freezeActions, load])

  // 回退：恢复上一次成功快照（仅 1 级），并同步覆盖本地快照
  const rollback = useCallback(() => {
    const prev = prevSnapshotRef.current
    if (!prev) return
    freezeActions()
    snapshotRef.current = prev
    writeSnapshot(prev)
    setData({ current: prev.current, daily: prev.daily })
    setPlace(prev.place || '')
    setStaleTs(Number(prev.ts) || Date.now())
    setStatus('stale')
    setFailReason('')
  }, [freezeActions])

  // 首次加载
  useEffect(() => {
    mountedRef.current = true
    load()
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
      clearTimeout(throttleTimerRef.current)
      clearTimeout(freezeTimerRef.current)
      clearTimeout(resumeTimerRef.current)
      clearTimeout(stateTimerRef.current)
    }
  }, [load])

  // 自动刷新排期：成功 10 分钟；失败按 20/40/60 分钟退避；切后台暂停
  useEffect(() => {
    if (paused || lastLoadAtRef.current === 0) return undefined
    const now = Date.now()
    let delay = delayForFailCount(failCount)
    if (nextAtRef.current > now) delay = nextAtRef.current - now
    const timer = setTimeout(() => {
      if (mountedRef.current) load()
    }, delay)
    return () => clearTimeout(timer)
  }, [failCount, loadSeq, paused, load])

  // 切后台/失焦暂停（双路去重），回前台或网络恢复时按 nextAt 补一次
  useEffect(() => {
    const pause = () => setPaused(true)
    const resume = () => {
      setPaused(false)
      if (lastLoadAtRef.current === 0) return
      const now = Date.now()
      const due = lastLoadAtRef.current + delayForFailCount(failCountRef.current)
      if (now < due || now < nextAtRef.current) return
      clearTimeout(resumeTimerRef.current)
      resumeTimerRef.current = setTimeout(() => {
        if (mountedRef.current) load()
      }, 0)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') pause()
      else resume()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', pause)
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', pause)
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      clearTimeout(resumeTimerRef.current)
    }
  }, [load])

  // 状态事件：签名去重 + 500ms 节流，供首页与测试观测
  const emitState = useCallback((payload) => {
    const signature = `${payload.status}|${payload.stale}|${payload.failCount}|${payload.reason}`
    if (signature === stateSignatureRef.current) return
    statePendingRef.current = { signature, payload }
    if (stateTimerRef.current) return
    const delay = Math.max(0, STATE_EVENT_THROTTLE - (Date.now() - stateLastAtRef.current))
    stateTimerRef.current = setTimeout(() => {
      stateTimerRef.current = null
      const entry = statePendingRef.current
      statePendingRef.current = null
      if (!entry || !mountedRef.current) return
      if (entry.signature === stateSignatureRef.current) return
      stateSignatureRef.current = entry.signature
      stateLastAtRef.current = Date.now()
      window.dispatchEvent(new CustomEvent('weather:state', { detail: entry.payload }))
      const prev = window.__weatherStateStats || {}
      window.__weatherStateStats = {
        count: Math.min(99999, (Number(prev.count) || 0) + 1),
        lastStatus: entry.payload.status,
        lastReason: entry.payload.reason,
        lastFailCount: entry.payload.failCount,
        lastTs: entry.payload.ts,
      }
    }, delay)
  }, [])

  useEffect(() => {
    emitState({
      status,
      stale: status === 'stale',
      failCount,
      reason: failReason,
      ts: Date.now(),
    })
  }, [status, failCount, failReason, emitState])

  // 统计条摘要格数据（与卡片同一份状态，不重复发请求）
  const summary = useMemo(() => {
    if (status === 'loading' && !data) return { kind: 'loading' }
    const current = data?.current
    if (!current) return { kind: 'error' }
    const { desc, icon } = describeWeather(current.weather_code, current.is_day)
    return {
      kind: status === 'stale' ? 'stale' : 'ok',
      temp: Math.round(current.temperature_2m),
      desc,
      icon,
      // 逆地理失败时城市名为"当前位置"，摘要格省略城市名
      city: place === '当前位置' ? '' : place,
      ageMin: minutesOf(staleTs),
    }
  }, [status, data, place, staleTs])

  return {
    data,
    place,
    status,
    staleTs,
    staleMinutes: minutesOf(staleTs),
    refreshing,
    geoDeniedTip,
    throttleTip,
    failReason,
    actionLocked,
    hasPrev,
    summary,
    refresh,
    retry,
    rollback,
  }
}

function Weather({ weather }) {
  const {
    data, place, status, staleMinutes, refreshing, geoDeniedTip,
    throttleTip, actionLocked, hasPrev, refresh, retry, rollback,
  } = weather
  const cardRef = useRef(null)
  const { tier, cardWidth, overflowCount, recheck } = useAdaptiveProbe(cardRef, status)

  const current = data?.current
  const daily = data?.daily
  const { desc, icon } = current
    ? describeWeather(current.weather_code, current.is_day)
    : { desc: '', icon: '🌡️' }
  const isStale = status === 'stale'

  return (
    <section
      ref={cardRef}
      className={`bento-card bento-weather${isStale ? ' is-stale' : ''}`}
      id="weather-card"
      tabIndex={-1}
      data-adapt-tier={tier}
      data-adapt-width={cardWidth}
      data-adapt-overflow={overflowCount}
      data-weather-stale={isStale ? 'true' : 'false'}
      data-keywords={weatherWordsOf(desc)}
    >
      <div className="weather-head">
        <h3 className="weather-title">本地天气</h3>
        {isStale && (
          <span className="weather-stale-chip" role="status" aria-live="polite">
            离线 · {staleMinutes} 分钟前
          </span>
        )}
        <button
          type="button"
          className={`weather-refresh${refreshing ? ' is-spinning' : ''}`}
          onClick={refresh}
          aria-label="刷新天气"
          aria-busy={refreshing}
          title={throttleTip ? '刷新过于频繁，请稍后再试' : '刷新'}
          disabled={status === 'loading'}
        >
          <span className="weather-refresh-icon" aria-hidden="true">↻</span>
        </button>
      </div>

      {/* 定位被拒绝：提示条 + 重试定位（每会话自动提示最多 1 次，手动重试被拒总是复现） */}
      {geoDeniedTip && status !== 'loading' && (
        <div className="weather-denied-tip" role="status">
          <span>已使用杭州默认位置</span>
          <button type="button" className="weather-retry" onClick={retry} disabled={actionLocked}>
            重试定位
          </button>
        </div>
      )}

      {status === 'loading' && !data && (
        <div className="weather-body">
          <span className="weather-skeleton weather-skeleton-icon" />
          <div className="weather-skeleton-block">
            <span className="weather-skeleton weather-skeleton-temp" />
            <span className="weather-skeleton weather-skeleton-line" />
          </div>
        </div>
      )}

      {status === 'error' && !data && (
        <div className="weather-error">
          <span>{weather.failReason === 'geo' ? '定位失败，无法获取天气' : '天气获取失败'}</span>
          <button type="button" className="weather-retry" onClick={retry} disabled={actionLocked}>
            重试
          </button>
        </div>
      )}

      {current && (
        <>
          <div className="weather-body">
            <span className="weather-icon" aria-hidden="true">{icon}</span>
            <div className="weather-main">
              <div className="weather-temp-row">
                <span className="weather-temp">
                  {Math.round(current.temperature_2m)}
                </span>
                <span className="weather-unit">°C</span>
              </div>
              <p className="weather-desc">
                {desc}
                {daily && (
                  <span className="weather-range">
                    {' '}最高 {Math.round(daily.temperature_2m_max[0])}° / 最低 {Math.round(daily.temperature_2m_min[0])}°
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="weather-meta">
            <span className="weather-meta-item">💧 湿度 {current.relative_humidity_2m}%</span>
            <span className="weather-meta-item">🌬️ 风速 {Math.round(current.wind_speed_10m)} km/h</span>
            <span className="weather-meta-item">🌡️ 体感 {Math.round(current.apparent_temperature)}°</span>
          </div>

          <p className="weather-place">
            <span className="weather-place-name">📍 {place || '定位中…'}</span>
            {isStale ? (
              <span className="weather-place-actions">
                {hasPrev && (
                  <button
                    type="button"
                    className="weather-inline-btn"
                    onClick={rollback}
                    disabled={actionLocked}
                    aria-label={`回退到 ${staleMinutes} 分钟前的天气数据`}
                  >
                    回退
                  </button>
                )}
                <button
                  type="button"
                  className="weather-inline-btn"
                  onClick={retry}
                  disabled={actionLocked}
                  aria-label="重新获取天气数据"
                >
                  重试
                </button>
              </span>
            ) : (
              <a
                className="weather-source"
                href="https://open-meteo.com/"
                target="_blank"
                rel="noreferrer"
              >
                Open-Meteo
              </a>
            )}
          </p>
        </>
      )}

      {/* 适配异常提示：仅在有横向溢出时渲染，重新检测跳过 300ms 防抖 */}
      {overflowCount > 0 && (
        <p className="weather-adapt-tip" role="status" aria-live="polite">
          <span>适配异常：{overflowCount} 处横向溢出</span>
          <button
            type="button"
            className="weather-adapt-retry"
            onClick={recheck}
            aria-label="重新检测天气卡片移动端适配"
          >
            重新检测
          </button>
        </p>
      )}
    </section>
  )
}

export default Weather
