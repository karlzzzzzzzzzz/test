import { useState, useEffect, useRef, useCallback } from 'react'
import './Pomodoro.css'

const MODES = {
  focus: { label: '专注', minutes: 25, color: '#e2554c' },
  short: { label: '短休息', minutes: 5, color: '#3a9d6e' },
  long: { label: '长休息', minutes: 15, color: '#3d7dc9' },
}

const CYCLE = 4 // 每完成 4 个番茄钟进入一次长休息

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatTime(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${pad(m)}:${pad(s)}`
}

// 完成提示音（Web Audio，无需音频文件）
function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
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
    setTimeout(() => ctx.close(), 2500)
  } catch {
    /* 音频不可用时静默 */
  }
}

function Pomodoro() {
  const [mode, setMode] = useState('focus')
  const [remaining, setRemaining] = useState(MODES.focus.minutes * 60)
  const [running, setRunning] = useState(false)
  const [completed, setCompleted] = useState(() => {
    const saved = Number(localStorage.getItem('pomo-completed') || 0)
    return Number.isFinite(saved) ? saved : 0
  })

  // 用结束时间戳驱动计时，标签页切到后台也能保持准确
  const endAtRef = useRef(0)
  const remainingRef = useRef(remaining)
  remainingRef.current = remaining
  const modeRef = useRef(mode)
  modeRef.current = mode
  const completedRef = useRef(completed)
  completedRef.current = completed

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

  // 计时主循环
  useEffect(() => {
    if (!running) return
    const tick = () => {
      const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000))
      setRemaining(left)
      if (left <= 0) {
        // 当前阶段结束
        playChime()
        const finishedMode = modeRef.current
        let nextCompleted = completedRef.current
        let nextMode = 'focus'
        if (finishedMode === 'focus') {
          nextCompleted = completedRef.current + 1
          setCompleted(nextCompleted)
          localStorage.setItem('pomo-completed', String(nextCompleted))
          nextMode = nextCompleted % CYCLE === 0 ? 'long' : 'short'
        }
        // 休息结束自动回到专注，但不自动开始（给用户准备时间）
        switchMode(nextMode, false)
      }
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [running, switchMode])

  // 浏览器标题实时显示倒计时
  useEffect(() => {
    document.title = running
      ? `${formatTime(remaining)} ${MODES[mode].label} - 番茄钟`
      : '番茄时钟'
    return () => {
      document.title = 'react-app'
    }
  }, [remaining, running, mode])

  const handleStartPause = () => {
    if (running) {
      setRunning(false)
    } else {
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
      // 跳过专注视为完成一个番茄钟：累加计数并推进周期
      const nextCompleted = completedRef.current + 1
      setCompleted(nextCompleted)
      localStorage.setItem('pomo-completed', String(nextCompleted))
      // 每完成 CYCLE 个进入长休息，否则短休息（与自然完成逻辑一致）
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
            今日已完成 <strong>{completed}</strong> 个番茄钟
          </p>
        </div>
      </div>
    </div>
  )
}

export default Pomodoro
