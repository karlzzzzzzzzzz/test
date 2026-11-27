import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import BubbleShooterEngine, {
  BUBBLE,
  DEADLINE_Y,
  SHOOTER,
  cellCenter,
  validateBubbleSave,
} from '../game/BubbleShooterEngine'
import './BubbleShooter.css'

const COLORS = ['#ff5d5d', '#ffd23f', '#4fd18b', '#4aa8ff', '#b06bff']
const COLOR_NAMES = ['红', '黄', '绿', '蓝', '紫']
const AIM_STEP = (3 * Math.PI) / 180
const AIM_THROTTLE_MS = 40
const SAVE_DEBOUNCE_MS = 800
const STAT_DEBOUNCE_MS = 1000
const OVER_TEXT = { cleared: '清空全盘！', overflow: '气泡触底', crowded: '盘面挤满' }
const W = BUBBLE.W
const H = BUBBLE.H
const R = BUBBLE.R

function fmtElapsed(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(BUBBLE.SAVE_KEY)
    if (!raw || raw.length > BUBBLE.SAVE_MAX_CHARS) {
      if (raw) localStorage.removeItem(BUBBLE.SAVE_KEY)
      return null
    }
    const data = JSON.parse(raw)
    if (!validateBubbleSave(data)) return null
    if (Date.now() - (Number(data.ts) || 0) > BUBBLE.SAVE_TTL_MS) {
      localStorage.removeItem(BUBBLE.SAVE_KEY)
      return null
    }
    return data
  } catch {
    try { localStorage.removeItem(BUBBLE.SAVE_KEY) } catch { /* ignore */ }
    return null
  }
}

function loadBest() {
  try {
    const data = JSON.parse(localStorage.getItem(BUBBLE.BEST_KEY) || 'null')
    if (!data || typeof data !== 'object') return { bestScore: 0, date: '' }
    return { bestScore: Math.max(0, Math.floor(Number(data.bestScore) || 0)), date: String(data.date || '') }
  } catch {
    return { bestScore: 0, date: '' }
  }
}

function loadStats() {
  const empty = { plays: 0, gamesOver: 0, clears: 0, bestScore: 0, totalPops: 0, totalShots: 0, updatedAt: 0 }
  try {
    const data = JSON.parse(localStorage.getItem(BUBBLE.STATS_KEY) || 'null')
    if (!data || typeof data !== 'object') return empty
    const num = (v) => Math.max(0, Math.floor(Number(v) || 0))
    return {
      plays: num(data.plays),
      gamesOver: num(data.gamesOver),
      clears: num(data.clears),
      bestScore: num(data.bestScore),
      totalPops: num(data.totalPops),
      totalShots: num(data.totalShots),
      updatedAt: num(data.updatedAt),
    }
  } catch {
    return empty
  }
}

function clearSave() {
  try { localStorage.removeItem(BUBBLE.SAVE_KEY) } catch { /* ignore */ }
}

function drawBubble(ctx, x, y, color) {
  ctx.beginPath()
  ctx.arc(x, y, R - 0.045, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 0.09
  ctx.strokeStyle = 'rgba(10, 16, 32, 0.35)'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x - 0.3, y - 0.34, R * 0.28, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.fill()
}

/**
 * 泡泡龙页面壳
 * 架构参照 Breakout.jsx：引擎快照写入 ref，单 rAF 循环驱动积分与按需重绘，
 * 不对 React setState 高频施压；状态：start | playing | paused | over | error
 */
export default function BubbleShooter() {
  const [screen, setScreen] = useState('start')
  const [hud, setHud] = useState({ score: 0, shotsFired: 0, shotsUntilDrop: BUBBLE.SHOTS_PER_DROP, current: 0, next: 1 })
  const [elapsed, setElapsed] = useState(0)
  const [hasSave, setHasSave] = useState(null)
  const [best, setBest] = useState(loadBest)
  const [stats, setStats] = useState(loadStats)
  const [overInfo, setOverInfo] = useState(null)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [note, setNote] = useState('')

  const engineRef = useRef(null)
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const snapRef = useRef(null)
  const redrawRef = useRef(false)
  const stateRef = useRef('start')
  const rafRef = useRef(0)
  const elapsedRef = useRef(0)
  const elapsedShownRef = useRef(0)
  const saveTimerRef = useRef(null)
  const statTimerRef = useRef(null)
  const statDirtyRef = useRef(false)
  const sessionSettledRef = useRef(false)
  const pausedByVisibilityRef = useRef(false)
  const autoPauseRef = useRef(false)
  const aimThrottleRef = useRef(0)
  const lastPopRef = useRef(null)
  const popsRef = useRef(0)
  const statsRef = useRef(stats)

  useEffect(() => { statsRef.current = stats }, [stats])

  const changeScreen = (s) => {
    stateRef.current = s
    setScreen(s)
  }

  // ---------- 画布绘制（只读 ref，不依赖 React state） ----------
  const draw = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.fillStyle = '#0d1224'
    ctx.fillRect(0, 0, W, H)
    // 危险线
    ctx.save()
    ctx.setLineDash([0.35, 0.35])
    ctx.lineWidth = 0.08
    ctx.strokeStyle = 'rgba(255, 90, 90, 0.5)'
    ctx.beginPath()
    ctx.moveTo(0, DEADLINE_Y)
    ctx.lineTo(W, DEADLINE_Y)
    ctx.stroke()
    ctx.restore()
    // 盘面气泡
    const snap = snapRef.current
    if (snap) {
      for (let r = 0; r < snap.rows.length; r++) {
        const row = snap.rows[r]
        for (let c = 0; c < row.cells.length; c++) {
          const v = row.cells[c]
          if (v === null) continue
          const p = cellCenter(r, c, row.offset)
          if (p.y - R > H) continue
          drawBubble(ctx, p.x, p.y, COLORS[v])
        }
      }
      // 瞄准虚线
      if (snap.state === BUBBLE.STATE.PLAYING && !snap.shot && snap.aimPath.length > 1) {
        ctx.save()
        ctx.setLineDash([0.3, 0.32])
        ctx.lineWidth = 0.1
        ctx.strokeStyle = 'rgba(226, 238, 255, 0.38)'
        ctx.beginPath()
        ctx.moveTo(snap.aimPath[0].x, snap.aimPath[0].y)
        for (let i = 1; i < snap.aimPath.length; i++) ctx.lineTo(snap.aimPath[i].x, snap.aimPath[i].y)
        ctx.stroke()
        ctx.restore()
      }
      // 飞行中的气泡
      if (snap.shot) drawBubble(ctx, snap.shot.x, snap.shot.y, COLORS[snap.shot.color])
      // 发射器
      ctx.beginPath()
      ctx.arc(SHOOTER.x, SHOOTER.y, R * 0.85, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(180, 200, 240, 0.16)'
      ctx.fill()
      ctx.lineWidth = 0.1
      ctx.strokeStyle = 'rgba(226, 238, 255, 0.35)'
      ctx.stroke()
      // 待发气泡（飞行中隐藏）
      if (!snap.shot) drawBubble(ctx, SHOOTER.x, SHOOTER.y - R, COLORS[snap.current])
      // 下一个气泡预览
      ctx.beginPath()
      ctx.arc(W - 1.7, H - 1.5, R * 0.85, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
      ctx.fill()
      drawBubble(ctx, W - 1.7, H - 1.5, COLORS[snap.next])
      ctx.fillStyle = 'rgba(200, 215, 245, 0.6)'
      ctx.font = '0.62px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('NEXT', W - 1.7, H - 0.25)
    }
  }, [])

  // ---------- 引擎工厂 ----------
  const createEngine = useCallback(() => {
    const engine = new BubbleShooterEngine({
      onState: (snap) => {
        snapRef.current = snap
        redrawRef.current = true
        if (snap.state !== stateRef.current) {
          stateRef.current = snap.state
          setScreen(snap.state)
        }
        setHud((prev) =>
          prev.score === snap.score &&
          prev.shotsFired === snap.shotsFired &&
          prev.shotsUntilDrop === snap.shotsUntilDrop &&
          prev.current === snap.current &&
          prev.next === snap.next
            ? prev
            : {
                score: snap.score,
                shotsFired: snap.shotsFired,
                shotsUntilDrop: snap.shotsUntilDrop,
                current: snap.current,
                next: snap.next,
              },
        )
        if (snap.lastPop && snap.lastPop !== lastPopRef.current) {
          lastPopRef.current = snap.lastPop
          const { popped, dropped, gained } = snap.lastPop
          if (popped || dropped) {
            popsRef.current += popped + dropped
            setNote(
              popped
                ? `消除 ${popped} 个${dropped ? `、坠落 ${dropped} 个` : ''}，+${gained} 分`
                : `坠落 ${dropped} 个，+${gained} 分`,
            )
          }
        }
      },
      onGameOver: (info) => {
        const isRecord = info.score > loadBest().bestScore
        setOverInfo({ ...info, isRecord })
        setNote(`${OVER_TEXT[info.reason] || '游戏结束'}，本局 ${info.score} 分`)
      },
      onPause: () => setPausedAuto(autoPauseRef.current),
    })
    return engine
  }, [])

  // ---------- 启动 / 继续 / 重开 / 返回 ----------
  const startGame = useCallback(() => {
    engineRef.current?.dispose()
    const engine = createEngine()
    engineRef.current = engine
    autoPauseRef.current = false
    setPausedAuto(false)
    setOverInfo(null)
    setNote('')
    lastPopRef.current = null
    popsRef.current = 0
    sessionSettledRef.current = false
    elapsedRef.current = 0
    elapsedShownRef.current = 0
    setElapsed(0)
    engine.start()
    redrawRef.current = true
    setStats((prev) => {
      const next = { ...prev, plays: prev.plays + 1, updatedAt: Date.now() }
      try { localStorage.setItem(BUBBLE.STATS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [createEngine])

  const resumeGame = useCallback(() => {
    const save = loadSaved()
    if (!save) {
      setHasSave(null)
      return
    }
    engineRef.current?.dispose()
    const engine = createEngine()
    engineRef.current = engine
    autoPauseRef.current = false
    setPausedAuto(false)
    setOverInfo(null)
    setNote('')
    lastPopRef.current = null
    popsRef.current = 0
    sessionSettledRef.current = false
    if (!engine.restore(save)) {
      setHasSave(null)
      startGame()
      return
    }
    const shown = Math.max(0, Math.floor(Number(save.elapsed) || 0))
    elapsedRef.current = shown
    elapsedShownRef.current = shown
    setElapsed(shown)
    redrawRef.current = true
  }, [createEngine, startGame])

  const handleRestart = () => {
    clearSave()
    startGame()
  }

  const handleBack = () => {
    clearSave()
    engineRef.current?.dispose()
    engineRef.current = null
    snapRef.current = null
    setOverInfo(null)
    setNote('')
    setElapsed(0)
    elapsedRef.current = 0
    elapsedShownRef.current = 0
    changeScreen('start')
  }

  const handleResume = () => {
    autoPauseRef.current = false
    setPausedAuto(false)
    setNote('')
    engineRef.current?.resume()
    redrawRef.current = true
  }

  const handlePause = () => {
    autoPauseRef.current = false
    engineRef.current?.pause()
  }

  // 初次挂载：读取存档
  useEffect(() => {
    const save = loadSaved()
    if (save) setHasSave(save)
  }, [])

  // 画布挂载后初始化（start/error 屏不渲染画布）
  const boardMounted = screen !== 'start' && screen !== 'error'
  useEffect(() => {
    if (!boardMounted) return
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      changeScreen('error')
      return
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctxRef.current = ctx
    redrawRef.current = true
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardMounted])

  // 单 rAF：playing 时驱动引擎积分与计时，按需重绘
  useEffect(() => {
    if (screen !== 'playing') return
    let last = 0
    const loop = (ts) => {
      if (!last) last = ts
      const dt = Math.min(ts - last, 100)
      last = ts
      if (stateRef.current === 'playing') {
        engineRef.current?.tick(dt)
        elapsedRef.current += dt / 1000
        const sec = Math.floor(elapsedRef.current)
        if (sec !== elapsedShownRef.current) {
          elapsedShownRef.current = sec
          setElapsed(sec)
        }
      }
      if (redrawRef.current) {
        redrawRef.current = false
        draw()
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [screen, draw])

  // 暂停态也要保证画布内容是最新（例如从 start 直接恢复）
  useEffect(() => {
    if (redrawRef.current) {
      redrawRef.current = false
      draw()
    }
  }, [screen, draw])

  // 存档防抖（playing / paused）
  useEffect(() => {
    if (screen !== 'playing' && screen !== 'paused') return
    const engine = engineRef.current
    if (!engine) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      try {
        const snap = engine.getSnapshot()
        snap.elapsed = Math.max(0, Math.floor(elapsedRef.current))
        const str = JSON.stringify(snap)
        if (str.length <= BUBBLE.SAVE_MAX_CHARS) localStorage.setItem(BUBBLE.SAVE_KEY, str)
      } catch { /* ignore */ }
    }, SAVE_DEBOUNCE_MS)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [screen, hud.score, hud.shotsFired, elapsed])

  // 结束结算：最佳 / 埋点 / 番茄钟
  useEffect(() => {
    if (screen !== 'over' || !overInfo) return
    const score = overInfo.score
    setBest((prev) => {
      if (score > prev.bestScore) {
        const next = { bestScore: score, date: new Date().toISOString().slice(0, 10) }
        try { localStorage.setItem(BUBBLE.BEST_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        return next
      }
      return prev
    })
    const nextStats = {
      ...statsRef.current,
      gamesOver: statsRef.current.gamesOver + 1,
      clears: statsRef.current.clears + (overInfo.reason === 'cleared' ? 1 : 0),
      bestScore: Math.max(statsRef.current.bestScore, score),
      totalPops: statsRef.current.totalPops + popsRef.current,
      totalShots: statsRef.current.totalShots + Math.max(0, overInfo.shotsFired || 0),
      updatedAt: Date.now(),
    }
    statsRef.current = nextStats
    setStats(nextStats)
    statDirtyRef.current = true
    if (statTimerRef.current) clearTimeout(statTimerRef.current)
    statTimerRef.current = setTimeout(() => {
      try { localStorage.setItem(BUBBLE.STATS_KEY, JSON.stringify(statsRef.current)) } catch { /* ignore */ }
      statDirtyRef.current = false
    }, STAT_DEBOUNCE_MS)
    // 番茄钟：对局 ≥120s 且同局仅结算一次
    if (!sessionSettledRef.current && elapsedRef.current >= BUBBLE.POMODORO_MIN) {
      sessionSettledRef.current = true
      try {
        const arr = JSON.parse(localStorage.getItem('pomodoro-sessions-v1') || '[]')
        arr.push({
          startTs: Date.now() - Math.floor(elapsedRef.current) * 1000,
          endTs: Date.now(),
          durSec: Math.floor(elapsedRef.current),
          game: 'bubble-shooter',
          win: overInfo.reason === 'cleared',
          level: `${score}分`,
          mode: 'focus',
        })
        const cutoff = Date.now() - 14 * 86400000
        localStorage.setItem('pomodoro-sessions-v1', JSON.stringify(arr.filter((x) => x.endTs > cutoff)))
      } catch { /* ignore */ }
    }
    clearSave()
  }, [screen, overInfo])

  // pagehide：暂停并冲刷埋点
  useEffect(() => {
    const flush = () => {
      const engine = engineRef.current
      if (engine && engine.state === BUBBLE.STATE.PLAYING) engine.pause()
      if (statDirtyRef.current) {
        try { localStorage.setItem(BUBBLE.STATS_KEY, JSON.stringify(statsRef.current)) } catch { /* ignore */ }
        statDirtyRef.current = false
      }
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  // 双路自动暂停（visibilitychange + blur 去重）
  useEffect(() => {
    const autoPause = () => {
      const engine = engineRef.current
      if (!engine || engine.state !== BUBBLE.STATE.PLAYING) return
      autoPauseRef.current = true
      engine.pause()
      setNote('已自动暂停：离开页面')
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        pausedByVisibilityRef.current = true
        autoPause()
      } else {
        pausedByVisibilityRef.current = false
      }
    }
    const onBlur = () => {
      if (pausedByVisibilityRef.current) return
      autoPause()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // ---------- 指针操作：按下/拖动瞄准（40ms 节流），抬起发射 ----------
  const toLogical = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }
  const onPointerDown = (e) => {
    if (stateRef.current !== 'playing') return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    const p = toLogical(e)
    if (p) engineRef.current?.aimAt(p.x, p.y)
  }
  const onPointerMove = (e) => {
    if (stateRef.current !== 'playing') return
    const now = performance.now()
    if (now - aimThrottleRef.current < AIM_THROTTLE_MS) return
    aimThrottleRef.current = now
    const p = toLogical(e)
    if (p) engineRef.current?.aimAt(p.x, p.y)
  }
  const onPointerUp = (e) => {
    if (stateRef.current !== 'playing') return
    const p = toLogical(e)
    if (p) engineRef.current?.aimAt(p.x, p.y)
    engineRef.current?.shoot()
  }

  // ---------- 键盘：←/→ 微调、空格发射、Esc 暂停、R 重开 ----------
  useEffect(() => {
    const onKey = (e) => {
      const s = stateRef.current
      if (s !== 'playing' && s !== 'paused') return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (s === 'playing') handlePause()
        else handleResume()
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        handleRestart()
        return
      }
      if (s !== 'playing') return
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        engineRef.current?.nudgeAim(-AIM_STEP)
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        engineRef.current?.nudgeAim(AIM_STEP)
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        engineRef.current?.shoot()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen]) // eslint-disable-line react-hooks/exhaustive-deps

  const bubbleCount = snapRef.current
    ? snapRef.current.rows.reduce((sum, row) => sum + row.cells.filter((v) => v !== null).length, 0)
    : 0

  return (
    <div className="bs-wrap">
      <header className="bs-header">
        <Link to="/" className="bs-back">← 返回首页</Link>
        <h1>泡泡龙 · Bubble Shooter</h1>
      </header>

      {screen === 'start' && (
        <div className="bs-start">
          <h2>瞄准 · 发射 · 三连消除</h2>
          <p className="bs-rule">
            拖动或按 ←/→ 调整角度，松手（或空格）发射气泡。同色气泡连成 3 个及以上即消除，
            失去顶部支撑的气泡会整组坠落。每发射 8 发，顶部会下压一行；气泡触底即本局结束。
          </p>

          {hasSave && (
            <div className="bs-save-card">
              <span>
                发现未完成对局（{hasSave.score} 分，已发射 {hasSave.shotsFired} 发）
              </span>
              <button type="button" onClick={resumeGame}>继续上次</button>
              <button type="button" onClick={() => { clearSave(); setHasSave(null) }}>放弃</button>
            </div>
          )}

          <div className="bs-meta">
            <span>历史最佳：{best.bestScore > 0 ? `${best.bestScore} 分` : '暂无记录'}</span>
            <span>累计：{stats.plays} 局 · 通关 {stats.clears} 次 · 最高 {stats.bestScore} 分</span>
          </div>

          <button type="button" className="bs-primary" onClick={startGame}>开始游戏</button>

          <div className="bs-hint">
            <p>键盘：←/→ 瞄准 · 空格/Enter 发射 · Esc 暂停 · R 重开</p>
            <p>触控：按住拖动瞄准，松手发射</p>
          </div>
        </div>
      )}

      {screen === 'error' && (
        <div className="bs-error" role="alert">
          <h2>无法初始化画布</h2>
          <p>当前浏览器不支持 Canvas 2D，游戏无法运行。请更换浏览器或关闭精简模式后重试。</p>
          <Link to="/" className="bs-primary bs-link">返回首页</Link>
        </div>
      )}

      {screen !== 'start' && screen !== 'error' && (
        <>
          <div className="bs-hud">
            <div className="bs-hud-item">
              <span className="label">得分</span>
              <span className="value">{hud.score}</span>
            </div>
            <div className="bs-hud-item">
              <span className="label">已发射</span>
              <span className="value">{hud.shotsFired}</span>
            </div>
            <div className="bs-hud-item">
              <span className="label">距下压</span>
              <span className="value">{hud.shotsUntilDrop}</span>
            </div>
            <div className="bs-hud-item">
              <span className="label">当前色</span>
              <span className="value bs-color">
                <i className="bs-dot" style={{ background: COLORS[hud.current] }} />
                {COLOR_NAMES[hud.current]}
              </span>
            </div>
            <div className="bs-hud-item">
              <span className="label">用时</span>
              <span className="value">{fmtElapsed(elapsed)}</span>
            </div>
          </div>

          <div
            className="bs-board-wrap"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => { /* 取消手势不发射 */ }}
          >
            <canvas
              ref={canvasRef}
              className="bs-canvas"
              role="img"
              aria-label={`泡泡龙盘面，当前 ${bubbleCount} 个气泡，得分 ${hud.score}`}
            />
          </div>

          <div className="bs-aim-row">
            <button type="button" className="bs-aim-btn" onClick={() => engineRef.current?.nudgeAim(-AIM_STEP * 2)} disabled={screen !== 'playing'}>
              ← 瞄准
            </button>
            <button type="button" className="bs-shoot-btn" onClick={() => engineRef.current?.shoot()} disabled={screen !== 'playing'}>
              发射
            </button>
            <button type="button" className="bs-aim-btn" onClick={() => engineRef.current?.nudgeAim(AIM_STEP * 2)} disabled={screen !== 'playing'}>
              瞄准 →
            </button>
          </div>

          {note && <p className="bs-note" role="status">{note}</p>}

          <div className="bs-actions">
            {screen === 'playing' && <button type="button" onClick={handlePause}>暂停 (Esc)</button>}
            {screen === 'paused' && <button type="button" onClick={handleResume}>继续</button>}
            <button type="button" onClick={handleRestart}>重开 (R)</button>
            <button type="button" onClick={handleBack}>返回菜单</button>
          </div>
        </>
      )}

      {screen === 'paused' && (
        <div className="bs-overlay">
          <div className="bs-overlay-card">
            <h3>已暂停</h3>
            <p>{pausedAuto ? '检测到你切换了页面，游戏已自动暂停。' : '游戏已暂停。'}</p>
            <button type="button" className="bs-primary" onClick={handleResume}>继续</button>
            <button type="button" onClick={handleBack}>放弃并返回菜单</button>
          </div>
        </div>
      )}

      {screen === 'over' && overInfo && (
        <div className="bs-overlay">
          <div className="bs-overlay-card">
            <h3>{OVER_TEXT[overInfo.reason] || '游戏结束'}</h3>
            <p>本局得分 <strong>{overInfo.score}</strong></p>
            <p>发射 {overInfo.shotsFired} 发 · 用时 {fmtElapsed(elapsed)}</p>
            {overInfo.isRecord && <p className="bs-new-record">新纪录！</p>}
            <button type="button" className="bs-primary" onClick={handleRestart}>再来一局</button>
            <button type="button" onClick={handleBack}>返回菜单</button>
          </div>
        </div>
      )}

      <div aria-live="polite" className="sr-only">
        {screen === 'playing' && `得分 ${hud.score}，距下压 ${hud.shotsUntilDrop} 发`}
        {screen === 'over' && overInfo ? `游戏结束，${OVER_TEXT[overInfo.reason] || ''}，得分 ${overInfo.score}` : ''}
      </div>
    </div>
  )
}
