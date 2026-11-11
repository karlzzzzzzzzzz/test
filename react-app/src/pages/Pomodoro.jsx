import { useState, useEffect, useRef, useCallback } from 'react'
import './Pomodoro.css'

/** 番茄钟 session 数组键 —— 与五子棋（/gomoku）联动共用 */
const SESSION_KEY = 'pomodoro-sessions-v1'

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatTime(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${pad(m)}:${pad(s)}`
}

/** 读取 session 数组（损坏回退空数组） */
function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((s) => s && typeof s === 'object') : []
  } catch { return [] }
}

/** 追加一条番茄钟 session（只保留最近 14 天） */
function appendSession(startTs, endTs, durSec) {
  try {
    const sessions = loadSessions()
    sessions.push({ startTs, endTs, durSec, game: 'pomodoro', win: true })
    const cutoff = Date.now() - 14 * 86400 * 1000
    const trimmed = sessions.filter((s) => s.endTs >= cutoff)
    localStorage.setItem(SESSION_KEY, JSON.stringify(trimmed))
  } catch { /* 静默跳过 */ }
}

/** 最近 24h 内 durSec ≥ 120 的有效番茄钟数 —— 统计条口径 */
function countRecentPomos() {
  try {
    const sessions = loadSessions()
    const cutoff = Date.now() - 24 * 3600 * 1000
    return sessions.filter((s) => s.endTs >= cutoff && s.durSec >= 120).length
  } catch { return 0 }
}

const MODES = {
  // 主题色需满足白字/白底 ≥4.5:1（原 #e2554c 3.73、#3a9d6e 3.37、#3d7dc9 4.22 均不达标）
  focus: { label: '专注', minutes: 25, color: '#c24138' },
  short: { label: '短休息', minutes: 5, color: '#2c7a54' },
  long: { label: '长休息', minutes: 15, color: '#2f68ad' },
}

const CYCLE = 4 // 每完成 4 个番茄钟进入一次长休息
const MAX_COMPLETED = 99999 // 计数上限，超出封顶（localStorage 容量控制，序列化 ≤ 5 字节）

// 读取持久化计数：仅接受 0~99999 的整数，非法值回退 0 并清除原值
function loadCompleted() {
  try {
    const raw = localStorage.getItem('pomo-completed')
    if (raw === null) return 0
    const n = Number(raw)
    if (Number.isInteger(n) && n >= 0 && n <= MAX_COMPLETED) return n
    localStorage.removeItem('pomo-completed')
    return 0
  } catch {
    return 0 // localStorage 不可用时仅内存计数
  }
}

// AudioContext 模块级单例复用，避免每次完成创建/销毁实例
let audioCtx = null

// 完成提示音（Web Audio，无需音频文件）
function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!audioCtx) audioCtx = new Ctx()
    const ctx = audioCtx
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const notes = [523.25, 659.25, 783.99] // C5 E5 G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.25)
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.25 + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.25 + 0.5)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.25)
      osc.stop(ctx.currentTime + i * 0.25 + 0.55)
    })
  } catch {
    /* 音频不可用时静默 */
  }
}

function Pomodoro() {
  const [mode, setMode] = useState('focus')
  const [remaining, setRemaining] = useState(MODES.focus.minutes * 60)
  const [running, setRunning] = useState(false)
  const [completed, setCompleted] = useState(loadCompleted)

  // 用结束时间戳驱动计时，标签页切到后台也能保持准确
  const endAtRef = useRef(0)
  const remainingRef = useRef(remaining)
  remainingRef.current = remaining
  const modeRef = useRef(mode)
  modeRef.current = mode
  const completedRef = useRef(completed)
  completedRef.current = completed
  // 计数脏标记：变更后不即时写 localStorage，等待统一写入时机
  const dirtyRef = useRef(false)

  const total = MODES[mode].minutes * 60
  const progress = 1 - remaining / total

  const switchMode = useCallback((next, autoStart = false) => {
    setMode(next)
    setRemaining(MODES[next].minutes * 60)
    setRunning(autoStart)
    if (autoStart) {
      endAtRef.current = Date.now() + MODES[next].minutes * 60 * 1000
    }
  }, [])

  // 计数 +1（封顶 MAX_COMPLETED）并置脏标记，返回新值
  const bumpCompleted = useCallback(() => {
    const next = Math.min(MAX_COMPLETED, completedRef.current + 1)
    setCompleted(next)
    dirtyRef.current = true
    return next
  }, [])

  // 记录本轮开始/结束时间（session 数组）
  const sessionStartAtRef = useRef(0)

  // 无脏数据时不产生同步写；写入成功才清除脏标记
  const flushCompleted = useCallback(() => {
    if (!dirtyRef.current) return
    try {
      localStorage.setItem('pomo-completed', String(completedRef.current))
      dirtyRef.current = false
    } catch {
      /* localStorage 不可用时保持内存计数，下次时机再试 */
    }
  }, [])

  // 统一写入时机：页面隐藏 / 关闭 / 组件卸载；运行中每 30 秒兜底一次
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushCompleted()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flushCompleted)
    // 兼容不支持 pagehide 的旧浏览器
    window.addEventListener('beforeunload', flushCompleted)
    const id = running ? setInterval(flushCompleted, 30000) : null
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flushCompleted)
      window.removeEventListener('beforeunload', flushCompleted)
      if (id) clearInterval(id)
      flushCompleted()
    }
  }, [running, flushCompleted])

  // 计时主循环
  useEffect(() => {
    if (!running) return
    const tick = () => {
      const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000))
      // 秒值去重：250ms 轮询下每秒仅 1 次实际状态更新
      if (left !== remainingRef.current) {
        setRemaining(left)
      }
      if (left <= 0) {
        // 当前阶段结束
        playChime()
        const finishedMode = modeRef.current
        let nextMode = 'focus'
        if (finishedMode === 'focus') {
          const nextCompleted = bumpCompleted()
          // 追加 session 数组（时长 = 25min 专注）
          appendSession(sessionStartAtRef.current, Date.now(), MODES.focus.minutes * 60)
          nextMode = nextCompleted % CYCLE === 0 ? 'long' : 'short'
        }
        // 休息结束自动回到专注，但不自动开始（给用户准备时间）
        switchMode(nextMode, false)
      }
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [running, switchMode, bumpCompleted])

  // 运行中标题随秒值更新
  useEffect(() => {
    if (running) {
      document.title = `${formatTime(remaining)} ${MODES[mode].label} - 番茄钟`
    }
  }, [remaining, running, mode])

  // 非运行态仅在模式/运行状态变化时写静态标题；卸载时恢复站点标题
  useEffect(() => {
    if (!running) {
      document.title = '番茄时钟'
    }
    return () => {
      document.title = 'react-app'
    }
  }, [running, mode])

  const handleStartPause = () => {
    if (running) {
      setRunning(false)
    } else {
      sessionStartAtRef.current = Date.now()
      endAtRef.current = Date.now() + remainingRef.current * 1000
      setRunning(true)
    }
  }

  const handleReset = () => {
    setRunning(false)
    setRemaining(MODES[modeRef.current].minutes * 60)
  }

  const handleSkip = () => {
    if (modeRef.current === 'focus') {
      // 跳过专注视为完成一个番茄钟：累加计数（脏标记）+ 推进周期 + 追加 session（按实际时长）
      const nextCompleted = bumpCompleted()
      appendSession(sessionStartAtRef.current, Date.now(), Math.round((endAtRef.current - Date.now()) / 1000 + MODES.focus.minutes * 60 - remainingRef.current))
      const nextMode = nextCompleted % CYCLE === 0 ? 'long' : 'short'
      switchMode(nextMode, false)
    } else {
      // 跳过休息直接回到专注
      switchMode('focus', false)
    }
  }

  // SVG 圆环参数
  const R = 130
  const C = 2 * Math.PI * R
  const dotsInCycle = completed % CYCLE

  // 统计条数值：最近 24h 内有效番茄钟数（滚动窗口口径）；累计总数保持不变
  const recentPomos = countRecentPomos()

  return (
    <div className="pomo-page" style={{ '--accent': MODES[mode].color }}>
      <div className="pomo-card">
        <h1>番茄时钟</h1>
        <p className="pomo-tip">专注 25 分钟，休息 5 分钟，每 4 个番茄休息 15 分钟</p>

        <div className="pomo-modes">
          {Object.entries(MODES).map(([key, m]) => (
            <button
              key={key}
              type="button"
              className={`pomo-mode-btn ${mode === key ? 'active' : ''}`}
              onClick={() => switchMode(key, false)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="pomo-ring">
          <svg width="300" height="300" viewBox="0 0 300 300">
            <circle className="pomo-ring-bg" cx="150" cy="150" r={R} />
            <circle
              className="pomo-ring-fg"
              cx="150"
              cy="150"
              r={R}
              strokeDasharray={C}
              strokeDashoffset={C * (1 - progress)}
            />
          </svg>
          <div className="pomo-time">
            <span className="pomo-time-text">{formatTime(remaining)}</span>
            <span className="pomo-time-label">{MODES[mode].label}</span>
          </div>
        </div>

        <div className="pomo-controls">
          <button type="button" className="pomo-btn pomo-btn-main" onClick={handleStartPause}>
            {running ? '暂停' : '开始'}
          </button>
          <button type="button" className="pomo-btn" onClick={handleReset}>
            重置
          </button>
          <button type="button" className="pomo-btn" onClick={handleSkip}>
            跳过
          </button>
        </div>

        <div className="pomo-stats">
          <div className="pomo-dots">
            {Array.from({ length: CYCLE }).map((_, i) => (
              <span key={i} className={`pomo-dot ${i < dotsInCycle ? 'filled' : ''}`} />
            ))}
          </div>
          <p>
            <strong>{recentPomos}</strong> 个番茄钟 / 最近 24h
            <span className="pomo-cumulative"> · 累计 {completed} 个</span>
          </p>
        </div>
      </div>
    </div>
  )
}

export default Pomodoro
