import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 天气卡片：数据来自 Open-Meteo 免费 API（无需 API Key）
 * - 优先使用浏览器定位，失败/拒绝时回退到北京
 * - 当前实况 + 今日最高/最低温
 * - 地名通过 BigDataCloud 免费逆地理接口补全（失败时静默降级）
 * - 每 10 分钟自动刷新一次，也可手动刷新
 */

// 定位失败时的默认坐标（北京）
const FALLBACK = { lat: 39.9042, lon: 116.4074, label: '北京（默认）' }
const REFRESH_INTERVAL = 10 * 60 * 1000

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

// 获取坐标：浏览器定位 → 失败回退默认城市
function getCoords() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ ...FALLBACK, fallback: true })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        fallback: false,
      }),
      () => resolve({ ...FALLBACK, fallback: true }),
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

function Weather() {
  const [data, setData] = useState(null)
  const [place, setPlace] = useState('')
  const [status, setStatus] = useState('loading') // loading | ok | error
  const [refreshing, setRefreshing] = useState(false)
  const mountedRef = useRef(true)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const { lat, lon, fallback, label } = await getCoords()
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

      if (fallback) {
        setPlace(label)
      } else {
        const name = await reverseGeocode(lat, lon)
        if (mountedRef.current) setPlace(name || '当前位置')
      }
    } catch {
      if (mountedRef.current) setStatus('error')
    } finally {
      if (mountedRef.current) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    load()
    const timer = setInterval(load, REFRESH_INTERVAL)
    return () => {
      mountedRef.current = false
      clearInterval(timer)
    }
  }, [load])

  const current = data?.current
  const daily = data?.daily
  const { desc, icon } = current
    ? describeWeather(current.weather_code, current.is_day)
    : { desc: '', icon: '🌡️' }

  return (
    <section className="bento-card bento-weather">
      <div className="weather-head">
        <p className="weather-title">本地天气</p>
        <button
          type="button"
          className={`weather-refresh${refreshing ? ' is-spinning' : ''}`}
          onClick={load}
          aria-label="刷新天气"
          title="刷新"
          disabled={status === 'loading'}
        >
          ↻
        </button>
      </div>

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
          <button type="button" className="weather-retry" onClick={load}>
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
    </section>
  )
}

export default Weather
