import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * 天气卡片：数据来自 Open-Meteo 免费 API（无需 API Key）
 * - 优先使用浏览器定位，拒绝/失败时回退到杭州（拒绝授权时显示提示条）
 * - 当前实况 + 今日最高/最低温
 * - 地名通过 BigDataCloud 免费逆地理接口补全（失败时静默降级）
 * - 每 10 分钟自动刷新一次；手动刷新 30s 节流防刷
 * - 数据状态通过 useWeather 提升至 Home，供统计条天气摘要格共享
 */

// 定位失败时的默认坐标（杭州）
const FALLBACK = { lat: 30.2809, lon: 120.0267, label: '杭州（默认）' }
const REFRESH_INTERVAL = 10 * 60 * 1000
// 手动刷新节流窗口
const REFRESH_THROTTLE = 30 * 1000
// 定位拒绝提示的会话标记（每会话最多自动提示 1 次）
const DENIED_TIP_KEY = 'weather-geo-denied-tip'

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

/**
 * 天气数据 hook：状态提升至 Home，Weather 卡片与统计条摘要格共用同一份状态
 */
export function useWeather() {
  const [data, setData] = useState(null)
  const [place, setPlace] = useState('')
  const [status, setStatus] = useState('loading') // loading | ok | error
  const [refreshing, setRefreshing] = useState(false)
  const [geoDeniedTip, setGeoDeniedTip] = useState(false)
  const [throttleTip, setThrottleTip] = useState(false)
  const mountedRef = useRef(true)
  const throttleTimerRef = useRef(null)

  const load = useCallback(async ({ manual = false } = {}) => {
    setRefreshing(true)
    try {
      const { lat, lon, fallback, label, denied } = await getCoords()
      const url =
        'https://api.open-meteo.com/v1/forecast' +
        `?latitude=${lat}&longitude=${lon}` +
        '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m' +
        '&daily=temperature_2m_max,temperature_2m_min' +
        '&timezone=auto&forecast_days=1'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (!mountedRef.current) return
      setData(json)
      setStatus('ok')

      if (denied) {
        // 手动重试被拒：无条件复现提示（不再写会话标记）
        // 自动加载被拒：每会话最多提示 1 次
        if (manual) {
          setGeoDeniedTip(true)
        } else if (!sessionStorage.getItem(DENIED_TIP_KEY)) {
          sessionStorage.setItem(DENIED_TIP_KEY, '1')
          setGeoDeniedTip(true)
        }
        setPlace(label)
      } else {
        setGeoDeniedTip(false)
        sessionStorage.removeItem(DENIED_TIP_KEY)
        if (fallback) {
          setPlace(label)
        } else {
          const name = await reverseGeocode(lat, lon)
          if (mountedRef.current) setPlace(name || '当前位置')
        }
      }
    } catch {
      if (mountedRef.current) setStatus('error')
    } finally {
      if (mountedRef.current) setRefreshing(false)
    }
  }, [])

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

  // 重试定位：重新走完整定位流程，不受刷新节流限制
  const retryGeo = useCallback(() => {
    load({ manual: true })
  }, [load])

  useEffect(() => {
    mountedRef.current = true
    load()
    const timer = setInterval(load, REFRESH_INTERVAL)
    return () => {
      mountedRef.current = false
      clearInterval(timer)
      clearTimeout(throttleTimerRef.current)
    }
  }, [load])

  // 统计条摘要格数据（与卡片同一份状态，不重复发请求）
  const summary = useMemo(() => {
    if (status === 'loading' && !data) return { kind: 'loading' }
    const current = data?.current
    if (status === 'error' || !current) return { kind: 'error' }
    const { desc, icon } = describeWeather(current.weather_code, current.is_day)
    return {
      kind: 'ok',
      temp: Math.round(current.temperature_2m),
      desc,
      icon,
      // 逆地理失败时城市名为"当前位置"，摘要格省略城市名
      city: place === '当前位置' ? '' : place,
    }
  }, [status, data, place])

  return { data, place, status, refreshing, geoDeniedTip, throttleTip, summary, refresh, retryGeo }
}

function Weather({ weather }) {
  const { data, place, status, refreshing, geoDeniedTip, throttleTip, refresh, retryGeo } = weather
  const cardRef = useRef(null)
  const { tier, cardWidth, overflowCount, recheck } = useAdaptiveProbe(cardRef, status)

  const current = data?.current
  const daily = data?.daily
  const { desc, icon } = current
    ? describeWeather(current.weather_code, current.is_day)
    : { desc: '', icon: '🌡️' }

  return (
    <section
      ref={cardRef}
      className="bento-card bento-weather"
      id="weather-card"
      tabIndex={-1}
      data-adapt-tier={tier}
      data-adapt-width={cardWidth}
      data-adapt-overflow={overflowCount}
    >
      <div className="weather-head">
        <h3 className="weather-title">本地天气</h3>
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
      {geoDeniedTip && status === 'ok' && (
        <div className="weather-denied-tip" role="status">
          <span>已使用杭州默认位置</span>
          <button type="button" className="weather-retry" onClick={retryGeo}>
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
          <span>天气获取失败</span>
          <button type="button" className="weather-retry" onClick={retryGeo}>
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
            📍 {place || '定位中…'}
            <a
              className="weather-source"
              href="https://open-meteo.com/"
              target="_blank"
              rel="noreferrer"
            >
              Open-Meteo
            </a>
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
