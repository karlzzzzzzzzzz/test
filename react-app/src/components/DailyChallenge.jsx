import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DATE_CHECK_MS,
  QUOTE_API,
  QUOTE_TIMEOUT_MS,
  dateKeyOf,
  markOpened,
  normalizeQuote,
  pickDailyChallenge,
  pickFallbackQuote,
  readCachedQuote,
  readOpened,
  writeCachedQuote,
} from '../api/dailyChallenge'
import './DailyChallenge.css'

/** localStorage 不可用（隐私模式等）时返回 null，读写函数内部已全部容错 */
function getStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 缓存命中时直接返回展示态，避免挂载后再发请求 */
function initialQuote() {
  const cached = readCachedQuote(getStorage(), dateKeyOf())
  if (!cached) return { status: 'loading' }
  return { status: cached.fallback ? 'fallback' : 'ok', text: cached.text, source: cached.source }
}

/**
 * 首页「今日游戏挑战」区块
 * - 按日期确定性选游戏；跨日由 60s 定时器切换
 * - 一言接口 10s 超时，失败降级到本地句子池，成功与降级都按日缓存
 * - 切后台 / 失焦双路去重暂停换日检查，回前台立即校准
 * - 键盘与 aria：CTA 与重试可聚焦，Space 映射激活，状态变化 aria-live 播报
 */
function DailyChallenge() {
  const [todayKey, setTodayKey] = useState(() => dateKeyOf())
  const [opened, setOpened] = useState(() => readOpened(getStorage(), dateKeyOf()))
  const [quote, setQuote] = useState(initialQuote)

  const challenge = useMemo(() => pickDailyChallenge(todayKey), [todayKey])

  const todayKeyRef = useRef(todayKey)
  // 首次渲染时缓存未命中才需要补请求；后续跨日由 applyDay 直接处理
  const needsInitialLoadRef = useRef(quote.status === 'loading')
  const mountedRef = useRef(true)
  const abortRef = useRef(null)
  const requestSeqRef = useRef(0)
  const pausedRef = useRef(false)
  const pausedByVisibilityRef = useRef(false)

  const loadQuote = useCallback(async (dayKey) => {
    // 序号用于丢弃被后续请求取代的结果（含 StrictMode 下的重复挂载）
    const seq = requestSeqRef.current + 1
    requestSeqRef.current = seq
    const isStale = () => !mountedRef.current || seq !== requestSeqRef.current

    abortRef.current?.abort()
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    abortRef.current = controller
    setQuote({ status: 'loading' })

    let timer = null
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort()
        reject(new Error('timeout'))
      }, QUOTE_TIMEOUT_MS)
    })

    try {
      const res = await Promise.race([
        fetch(`${QUOTE_API}&_=${Date.now()}`, controller ? { signal: controller.signal } : undefined),
        timeoutPromise,
      ])
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const normalized = normalizeQuote(data)
      if (!normalized) throw new Error('bad payload')
      if (isStale()) return
      setQuote({ status: 'ok', ...normalized })
      writeCachedQuote(getStorage(), dayKey, normalized)
    } catch {
      if (isStale()) return
      const fallback = pickFallbackQuote(dayKey)
      if (fallback) {
        setQuote({ status: 'fallback', ...fallback })
        writeCachedQuote(getStorage(), dayKey, fallback, true)
      } else {
        setQuote({ status: 'error' })
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }, [])

  // 跨日切换：先读当日「已挑战」标记与缓存，无缓存才请求（事件驱动，不放在 effect 里同步 setState）
  const applyDay = useCallback(
    (nextKey) => {
      if (nextKey === todayKeyRef.current) return
      todayKeyRef.current = nextKey
      setTodayKey(nextKey)
      setOpened(readOpened(getStorage(), nextKey))
      const cached = readCachedQuote(getStorage(), nextKey)
      if (cached) {
        setQuote({ status: cached.fallback ? 'fallback' : 'ok', text: cached.text, source: cached.source })
      } else {
        loadQuote(nextKey)
      }
    },
    [loadQuote],
  )

  // 挂载：缓存未命中时补一次请求
  useEffect(() => {
    if (!needsInitialLoadRef.current) return
    needsInitialLoadRef.current = false
    loadQuote(todayKeyRef.current)
  }, [loadQuote])

  // 卸载：只标记卸载，让在途请求自然结束（StrictMode 下会被重复挂载，中断会丢掉首次请求）
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 跨日检查 + 切后台/失焦双路去重暂停（对齐 3.2.6 的游戏暂停机制）
  useEffect(() => {
    const checkDate = () => {
      const nextKey = dateKeyOf()
      if (nextKey !== todayKeyRef.current) applyDay(nextKey)
    }

    const timer = setInterval(() => {
      if (!pausedRef.current) checkDate()
    }, DATE_CHECK_MS)

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        pausedByVisibilityRef.current = true
        pausedRef.current = true
        return
      }
      pausedByVisibilityRef.current = false
      pausedRef.current = false
      checkDate()
    }

    const onBlur = () => {
      // 同一次切后台可能同时触发 hidden 与 blur，后到的 blur 直接忽略
      if (pausedByVisibilityRef.current) return
      pausedRef.current = true
    }

    const onFocus = () => {
      if (document.visibilityState === 'hidden') return
      pausedRef.current = false
      checkDate()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [applyDay])

  const handleStart = () => {
    markOpened(getStorage(), todayKey)
    setOpened(true)
  }

  // 锚点在部分浏览器/读屏下 Space 不触发跳转，这里统一映射为激活
  const handleCtaKeyDown = (event) => {
    if (event.key === ' ') {
      event.preventDefault()
      event.currentTarget.click()
    }
  }

  const announcement =
    quote.status === 'loading'
      ? '正在获取今日一句'
      : quote.status === 'fallback'
        ? `实时名言获取失败，已使用本地句子：${quote.text}`
        : quote.status === 'ok'
          ? `今日一句：${quote.text}，来自${quote.source}`
          : '今日一句暂不可用'

  return (
    <section className="bento-card daily-card bento-span-12" id="daily-challenge" aria-label="今日游戏挑战">
      {challenge ? (
        <>
          <div className="daily-main">
            <p className="daily-eyebrow">DAILY CHALLENGE · {todayKey}</p>
            <h3 className="daily-game-name">{challenge.name}</h3>
            <p className="daily-rule">{challenge.rule}</p>
            <ul className="daily-meta" aria-label="挑战信息">
              <li className="daily-meta-item">
                <span className="daily-meta-label">难度</span>
                {challenge.difficulty}
              </li>
              <li className="daily-meta-item">
                <span className="daily-meta-label">时长</span>
                {challenge.duration}
              </li>
            </ul>
            <div className="daily-actions">
              <Link
                className="daily-cta"
                to={challenge.to}
                onClick={handleStart}
                onKeyDown={handleCtaKeyDown}
                aria-label={`开始今日挑战：${challenge.name}`}
              >
                开始挑战 →
              </Link>
              <span className="daily-state" aria-live="polite">
                {opened ? '今日已挑战' : '今日尚未开始'}
              </span>
            </div>
          </div>

          <div className="daily-quote">
            <p className="daily-quote-label">今日一句</p>
            {quote.status === 'loading' && (
              <p className="daily-quote-text daily-quote-loading">正在获取今日一句…</p>
            )}
            {(quote.status === 'ok' || quote.status === 'fallback') && (
              <blockquote className="daily-quote-text">
                {quote.text}
                <cite className="daily-quote-source">— {quote.source}</cite>
              </blockquote>
            )}
            {quote.status === 'error' && (
              <p className="daily-quote-text daily-quote-loading">今日一句暂不可用</p>
            )}
            {(quote.status === 'fallback' || quote.status === 'error') && (
              <div className="daily-quote-tip">
                <span>
                  {quote.status === 'fallback'
                    ? '实时名言获取失败，已使用本地句子'
                    : '今日一句暂不可用'}
                </span>
                <button
                  type="button"
                  className="daily-quote-retry"
                  onClick={() => loadQuote(todayKey)}
                  aria-label="重新获取今日一句"
                >
                  重试
                </button>
              </div>
            )}
            <span className="sr-only" role="status" aria-live="polite">
              {announcement}
            </span>
          </div>
        </>
      ) : (
        <div className="daily-main daily-empty">
          <p className="daily-eyebrow">DAILY CHALLENGE</p>
          <h3 className="daily-game-name">今日暂无可用挑战</h3>
          <p className="daily-rule">游戏注册表为空或日期不可用，请稍后再来。</p>
        </div>
      )}
    </section>
  )
}

export default DailyChallenge
