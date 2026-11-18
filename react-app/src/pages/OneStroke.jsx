import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  OneStrokeEngine, LEVELS, LEVEL_DEFS, createDailyLevel,
} from '../game/OneStrokeEngine'
import './OneStroke.css'

const STATS_KEY = 'game-onestroke-stats-v1'
const BEST_KEY = 'game-onestroke-best-v1'
const DAILY_KEY = 'game-onestroke-daily-v1'
const POMODORO_KEY = 'pomodoro-sessions-v1'
const LEVEL_KEYS = ['easy', 'normal', 'hard']
const DAILY_THROTTLE_MS = 30000
const DAILY_API = 'https://timeapi.io/api/Time/current/zone?timeZone=Asia%2FShanghai'

let dailyFetchedAt = 0
let dailyInFlight = false

function pad2(n) {
  return String(n).padStart(2, '0')
}

function localDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`
}

function loadStats() {
  const empty = {
    plays: 0, wins: 0, undos: 0, resets: 0,
    timeByLevel: { easy: 0, normal: 0, hard: 0 },
    updatedAt: 0,
  }
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return empty
    const out = { ...empty, timeByLevel: { ...empty.timeByLevel } }
    for (const key of ['plays', 'wins', 'undos', 'resets']) {
      out[key] = Number.isFinite(data[key]) ? Math.max(0, Math.floor(data[key])) : 0
    }
    out.updatedAt = Number(data.updatedAt) || 0
    if (data.timeByLevel && typeof data.timeByLevel === 'object') {
      for (const key of LEVEL_KEYS) {
        out.timeByLevel[key] = Math.max(0, Number(data.timeByLevel[key]) || 0)
      }
    }
    return out
  } catch { return empty }
}

function loadBest() {
  const empty = { easy: null, normal: null, hard: null }
  try {
    const raw = localStorage.getItem(BEST_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return empty
    const out = { ...empty }
    for (const key of LEVEL_KEYS) {
      const rec = data[key]
      if (!rec || typeof rec !== 'object') continue
      if (!Number.isFinite(rec.time) || !Number.isFinite(rec.moves)) continue
      out[key] = { time: Math.max(0, rec.time), moves: Math.max(0, rec.moves), ts: Number(rec.ts) || 0 }
    }
    return out
  } catch { return empty }
}

function loadDailyRecords() {
  try {
    const raw = localStorage.getItem(DAILY_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return {}
    const out = {}
    for (const [date, rec] of Object.entries(data)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      if (!rec || typeof rec !== 'object') continue
      if (!Number.isFinite(rec.time)) continue
      out[date] = {
        time: Math.max(0, rec.time),
        level: rec.level in LEVELS ? rec.level : 'normal',
        ts: Number(rec.ts) || 0,
      }
    }
    return out
  } catch { return {} }
}

function appendPomodoroSession(startTs, endTs, info) {
  try {
    const raw = localStorage.getItem(POMODORO_KEY)
    const sessions = raw ? JSON.parse(raw) : []
    if (!Array.isArray(sessions)) return
    sessions.push({
      startTs,
      endTs,
      durSec: Math.round((endTs - startTs) / 1000),
      game: 'one-stroke',
      win: true,
      level: info.level,
    })
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000
    localStorage.setItem(POMODORO_KEY, JSON.stringify(sessions.filter((s) => s.endTs >= cutoff)))
  } catch { /* 存储不可用时静默忽略 */ }
}

function nodeLabel(id, cols) {
  return `第 ${Math.floor(id / cols) + 1} 行第 ${(id % cols) + 1} 列`
}

/**
 * 一笔画页面壳 —— 网格欧拉路径，笔不离纸走完所有边。
 *
 * 六屏：start / playing / paused / over
 * 约束卡① 外部 API 取权威日期生成每日关卡，失败降级本地日期
 * 约束卡② 每日关卡刷新 30s 模块级节流 + 请求进行中去重，加载 / 空 / 错误三态完整
 * 约束卡③ 与基线已知不一致点联动：DragList 改为插入式排序（见 3.1.3）
 */
export default function OneStrokePage() {
  const engineRef = useRef(null)
  const snapshotRef = useRef(null)
  const statsRef = useRef(loadStats())
  const bestRef = useRef(loadBest())
  const dailyRecordsRef = useRef(loadDailyRecords())
  const gameStartRef = useRef(0)
  const focusRef = useRef(0)

  const [screen, setScreen] = useState('start')
  const [level, setLevel] = useState('normal')
  const [snapshot, setSnapshot] = useState(null)
  const [focusedNode, setFocusedNode] = useState(0)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [stats, setStats] = useState(statsRef.current)
  const [best, setBest] = useState(bestRef.current)
  const [finalInfo, setFinalInfo] = useState(null)

  const [dailyDate, setDailyDate] = useState(localDateStr)
  const [dailySource, setDailySource] = useState('local')
  const [dailyStatus, setDailyStatus] = useState('loading')
  const [dailyNote, setDailyNote] = useState('')
  const [dailyRecords, setDailyRecords] = useState(dailyRecordsRef.current)

  let dailyPlan = null
  try {
    dailyPlan = dailyDate ? createDailyLevel(dailyDate) : null
  } catch { dailyPlan = null }

  const flushStats = (next) => {
    statsRef.current = next
    setStats(next)
    try { localStorage.setItem(STATS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const saveBest = (next) => {
    bestRef.current = next
    setBest(next)
    try { localStorage.setItem(BEST_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const saveDailyRecord = (date, record) => {
    const next = { ...dailyRecordsRef.current, [date]: record }
    dailyRecordsRef.current = next
    setDailyRecords(next)
    try { localStorage.setItem(DAILY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  // ===== 引擎初始化 =====
  useEffect(() => {
    const engine = new OneStrokeEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state === 'playing') setScreen('playing')
        else if (snap.state === 'paused') setScreen('paused')
        else if (snap.state === 'over') setScreen('over')
      },
      onStuck: ({ remaining }) => {
        setLiveAnnounce(`无路可走，还剩 ${remaining} 条边，请撤销或重置`)
      },
      onGameOver: (info) => {
        const s = { ...statsRef.current, timeByLevel: { ...statsRef.current.timeByLevel } }
        s.plays += 1
        s.wins += 1
        s.undos += info.undos || 0
        s.resets += info.resets || 0
        s.timeByLevel[info.level] = Math.round((s.timeByLevel[info.level] || 0) + info.elapsed)
        s.updatedAt = Date.now()
        flushStats(s)

        const prevBest = bestRef.current[info.level]
        if (!prevBest || info.elapsed < prevBest.time) {
          saveBest({
            ...bestRef.current,
            [info.level]: { time: info.elapsed, moves: info.moves, ts: Date.now() },
          })
        }

        if (info.mode === 'daily' && info.dailyDate) {
          saveDailyRecord(info.dailyDate, {
            time: info.elapsed,
            level: info.level,
            ts: Date.now(),
          })
        }

        const durSec = Math.round(info.elapsed)
        if (gameStartRef.current && durSec >= 120) {
          const endTs = Date.now()
          appendPomodoroSession(endTs - durSec * 1000, endTs, info)
        }

        setFinalInfo(info)
        setLiveAnnounce(`通关！用时 ${fmtTime(info.elapsed)}`)
        setScreen('over')
      },
    })
    engineRef.current = engine
    snapshotRef.current = engine.getSnapshot()

    const tickTimer = setInterval(() => {
      if (engineRef.current && engineRef.current.state === 'playing') engineRef.current.tick()
    }, 500)

    return () => {
      clearInterval(tickTimer)
      engine.dispose()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== 每日关卡：权威日期 + 失败降级 =====
  async function refreshDaily() {
    if (dailyInFlight) return
    const now = Date.now()
    if (now - dailyFetchedAt < DAILY_THROTTLE_MS) {
      setDailyNote('刷新过于频繁，30 秒内不重复请求')
      return
    }
    dailyFetchedAt = now
    dailyInFlight = true
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    setDailyStatus('loading')
    setDailyNote('')
    try {
      const res = await fetch(DAILY_API, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const date = typeof data?.dateTime === 'string' ? data.dateTime.slice(0, 10) : ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('返回格式异常')
      setDailyDate(date)
      setDailySource('api')
      setDailyStatus('ready')
      setDailyNote('已同步网络日期')
    } catch (err) {
      setDailyDate(localDateStr())
      setDailySource('fallback')
      setDailyStatus('error')
      setDailyNote(err?.name === 'AbortError'
        ? '时间服务超时，已按本地日期生成关卡'
        : '时间服务不可用，已按本地日期生成关卡')
    } finally {
      clearTimeout(timer)
      dailyInFlight = false
    }
  }

  useEffect(() => {
    refreshDaily()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (dailyStatus !== 'loading' && !dailyPlan) setDailyStatus('empty')
  }, [dailyPlan, dailyStatus])

  // ===== 自动暂停（双路去重） =====
  useEffect(() => {
    const pauseIfPlaying = () => {
      const e = engineRef.current
      if (e && e.state === 'playing') {
        setPausedAuto(true)
        e.pause()
      }
    }
    const onHide = () => { if (document.visibilityState === 'hidden') pauseIfPlaying() }
    const onBlur = () => pauseIfPlaying()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  function handleStart(lv, mode = 'classic', plan = null) {
    const e = engineRef.current
    if (!e) return
    setLevel(lv)
    setPausedAuto(false)
    setFinalInfo(null)
    gameStartRef.current = Date.now()
    const snap = mode === 'daily' && plan
      ? e.start(plan.levelKey, { mode: 'daily', dailyDate, startNode: plan.start })
      : e.start(lv)
    focusRef.current = snap.current
    setFocusedNode(snap.current)
    setLiveAnnounce(mode === 'daily' ? '每日关卡开始，从起点出发' : '一笔画开始，从起点出发')
  }

  function handleRestart() {
    const snap = snapshotRef.current
    if (snap?.mode === 'daily' && snap.dailyDate) {
      handleStart(snap.level, 'daily', createDailyLevel(snap.dailyDate))
    } else {
      handleStart(level)
    }
  }

  function handlePause() {
    const e = engineRef.current
    if (!e || e.state !== 'playing') return
    e.pause()
    setPausedAuto(false)
  }

  function handleResume() {
    const e = engineRef.current
    if (!e || e.state !== 'paused') return
    e.resume()
    setPausedAuto(false)
  }

  const handleMenu = () => {
    const e = engineRef.current
    if (e && e.state === 'playing') e.pause()
    setPausedAuto(false)
    setFinalInfo(null)
    setScreen('start')
  }

  function handleUndo() {
    const e = engineRef.current
    if (!e) return
    if (e.undo()) {
      focusRef.current = e.current
      setFocusedNode(e.current)
      setLiveAnnounce('已撤销上一条线')
    }
  }

  function handleReset() {
    const e = engineRef.current
    if (!e) return
    if (e.reset()) {
      focusRef.current = e.startNode
      setFocusedNode(e.startNode)
      setLiveAnnounce('已重置，回到起点')
    }
  }

  function activateNode(node) {
    const e = engineRef.current
    const snap = snapshotRef.current
    if (!e || !snap || snap.state !== 'playing') return
    const res = e.tryMove(node)
    if (!res.ok) {
      setLiveAnnounce(res.reason || '无法画线')
      return
    }
    focusRef.current = node
    setFocusedNode(node)
    if (res.win) {
      setLiveAnnounce('恭喜，一笔画完成！')
      return
    }
    if (res.stuck) {
      setLiveAnnounce(`无路可走，还剩 ${res.remaining} 条边，请撤销或重置`)
      return
    }
    setLiveAnnounce(`已画到${nodeLabel(node, snap.cols)}，还剩 ${res.remaining} 条边`)
  }

  // ===== 键盘：方向键移动焦点 + Enter/Space 画线 + Esc 暂停 + Z 撤销 =====
  useEffect(() => {
    const onKey = (ev) => {
      const e = engineRef.current
      if (!e) return
      if (ev.key === 'Escape') {
        if (e.state === 'playing') handlePause()
        else if (e.state === 'paused') handleResume()
        ev.preventDefault()
        return
      }
      if (e.state !== 'playing') return
      if (ev.key === 'z' || ev.key === 'Z' || ev.key === 'Backspace') {
        handleUndo()
        ev.preventDefault()
        return
      }
      const snap = snapshotRef.current
      if (!snap || !snap.nodes.length) return
      const current = snap.nodes.find((n) => n.id === focusRef.current) || snap.nodes[0]
      let dr = 0
      let dc = 0
      if (ev.key === 'ArrowUp') dr = -1
      else if (ev.key === 'ArrowDown') dr = 1
      else if (ev.key === 'ArrowLeft') dc = -1
      else if (ev.key === 'ArrowRight') dc = 1
      if (dr || dc) {
        const target = snap.nodes.find((n) => n.row === current.row + dr && n.col === current.col + dc)
        if (target) {
          focusRef.current = target.id
          setFocusedNode(target.id)
          setLiveAnnounce(nodeLabel(target.id, snap.cols))
        }
        ev.preventDefault()
        return
      }
      if (ev.key === 'Enter' || ev.key === ' ') {
        activateNode(focusRef.current)
        ev.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== 渲染 =====
  const snap = snapshot
  const activeDaily = snap?.mode === 'daily'
  const todayRecord = dailyRecords[dailyDate]
  const bestRec = best[level]

  const posOf = (id) => {
    const cols = snap?.cols || 1
    const rows = snap?.rows || 1
    const row = Math.floor(id / cols)
    const col = id % cols
    return {
      x: cols > 1 ? (col / (cols - 1)) * 100 : 50,
      y: rows > 1 ? (row / (rows - 1)) * 100 : 50,
    }
  }

  const usedNeighbors = new Set()
  if (snap && snap.current >= 0) {
    for (const edge of snap.edges) {
      if (edge.used) continue
      if (edge.a === snap.current) usedNeighbors.add(edge.b)
      else if (edge.b === snap.current) usedNeighbors.add(edge.a)
    }
  }

  return (
    <div className="ost-page">
      <nav className="ost-nav">
        <Link to="/" className="ost-nav-back">← 返回首页</Link>
        <h1 className="ost-nav-title">一笔画 · One Stroke</h1>
        <div className="ost-nav-spacer" />
      </nav>

      {/* ===== 开始屏 ===== */}
      {screen === 'start' && (
        <div className="ost-screen">
          <div className="ost-card">
            <h2 className="ost-title">一笔画</h2>
            <p className="ost-desc">
              从起点出发，笔不离纸，沿着连线把每一条边<strong>恰好走一次</strong>。
              走过的边会点亮，不能再走；走完全部边即通关。走错可以撤销或重置。
            </p>

            <div className="ost-levels">
              {LEVEL_KEYS.map((lv) => (
                <button
                  key={lv}
                  className={`ost-level-btn ${level === lv ? 'active' : ''}`}
                  onClick={() => setLevel(lv)}
                >
                  <span className="ost-level-label">{LEVELS[lv].label}</span>
                  <span className="ost-level-sub">{LEVELS[lv].blurb}</span>
                </button>
              ))}
            </div>

            <button className="ost-start-btn" onClick={() => handleStart(level)}>开始画线</button>

            <div className="ost-daily">
              <div className="ost-daily-head">
                <strong>每日关卡</strong>
                <span className={`ost-daily-badge ${dailySource === 'api' ? 'api' : 'local'}`}>
                  {dailyStatus === 'loading' ? '同步中' : dailySource === 'api' ? '网络日期' : '本地日期'}
                </span>
              </div>
              <div className="ost-daily-date">{dailyDate}</div>

              {dailyStatus === 'loading' && (
                <p className="ost-daily-note loading">正在同步网络日期，加载关卡中…</p>
              )}
              {dailyStatus === 'error' && (
                <p className="ost-daily-note error">{dailyNote}</p>
              )}
              {dailyStatus === 'empty' && (
                <p className="ost-daily-note empty">暂无可用的每日关卡，请刷新重试。</p>
              )}
              {dailyPlan && dailyStatus !== 'loading' && (
                <p className="ost-daily-note">
                  {LEVELS[dailyPlan.levelKey].label} · {LEVELS[dailyPlan.levelKey].blurb}
                  {' · '}起点 {nodeLabel(dailyPlan.start, LEVEL_DEFS[dailyPlan.levelKey].cols)}
                </p>
              )}
              {todayRecord && (
                <p className="ost-daily-result">
                  今日已完成：用时 {fmtTime(todayRecord.time)} · {LEVELS[todayRecord.level]?.label}
                </p>
              )}

              <div className="ost-daily-actions">
                <button className="ost-btn" onClick={refreshDaily} disabled={dailyStatus === 'loading'}>
                  刷新日期
                </button>
                <button
                  className="ost-btn ost-btn-primary"
                  onClick={() => dailyPlan && handleStart(dailyPlan.levelKey, 'daily', dailyPlan)}
                  disabled={!dailyPlan || dailyStatus === 'loading'}
                >
                  开始每日关卡
                </button>
              </div>
            </div>

            <div className="ost-stats-line">
              累计 {stats.plays} 局 · 通关 {stats.wins} · 撤销 {stats.undos} · 重置 {stats.resets}
              {bestRec ? ` · ${LEVELS[level].label}最佳 ${fmtTime(bestRec.time)}` : ''}
            </div>

            <div className="ost-rules">
              <h3>操作方式</h3>
              <ul>
                <li>点击与当前点相邻的圆点画线，走过的边不能重复</li>
                <li>方向键移动焦点 · Enter/空格 画线 · Z/Backspace 撤销</li>
                <li>Esc 暂停 / 继续 · 切后台或窗口失焦自动暂停</li>
                <li>走成死路时撤销上一步，或重置从起点重来</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ===== 游戏主界面 ===== */}
      {snap && snap.edges.length > 0 && screen !== 'start' && (
        <div className="ost-main">
          <div className="ost-hud">
            <div className="ost-hud-left">
              <span className="ost-timer">⏱ {fmtTime(snap.elapsed)}</span>
              <span className="ost-progress">{snap.usedCount} / {snap.totalEdges} 条边</span>
              {snap.stuck && <span className="ost-stuck-tag">无路可走</span>}
            </div>
            <div className="ost-hud-right">
              <span className="ost-level-tag">
                {LEVELS[snap.level]?.label || snap.level}
                {activeDaily ? ' · 每日' : ''}
              </span>
              {screen === 'playing' && <button className="ost-btn" onClick={handlePause}>暂停</button>}
              {screen === 'paused' && <button className="ost-btn ost-btn-primary" onClick={handleResume}>继续</button>}
              <button className="ost-btn" onClick={handleUndo} disabled={!snap.canUndo}>撤销</button>
              <button className="ost-btn" onClick={handleReset}>重置</button>
              <button className="ost-btn" onClick={handleMenu}>菜单</button>
            </div>
          </div>

          <div className="ost-board-wrap">
            <div
              className="ost-board"
              role="grid"
              aria-label={`一笔画棋盘 ${snap.rows} 行 ${snap.cols} 列`}
              aria-rowcount={snap.rows}
              aria-colcount={snap.cols}
            >
              <svg className="ost-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {snap.edges.map((edge, i) => {
                  const a = posOf(edge.a)
                  const b = posOf(edge.b)
                  return (
                    <line
                      key={i}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className={edge.used ? 'used' : ''}
                      vectorEffect="non-scaling-stroke"
                    />
                  )
                })}
              </svg>

              {snap.nodes.map((node) => {
                const pos = posOf(node.id)
                const isCurrent = snap.current === node.id
                const isStart = snap.startNode === node.id
                const isTarget = usedNeighbors.has(node.id)
                const classes = [
                  'ost-node',
                  isCurrent ? 'current' : '',
                  isStart ? 'start' : '',
                  isTarget ? 'target' : '',
                  focusedNode === node.id ? 'focused' : '',
                ].filter(Boolean).join(' ')
                return (
                  <button
                    key={node.id}
                    type="button"
                    role="gridcell"
                    className={classes}
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                    aria-label={`${nodeLabel(node.id, snap.cols)}${isCurrent ? '，当前点' : isTarget ? '，可画线' : ''}`}
                    aria-selected={isCurrent}
                    tabIndex={focusedNode === node.id ? 0 : -1}
                    onClick={() => activateNode(node.id)}
                    onFocus={() => { focusRef.current = node.id; setFocusedNode(node.id) }}
                  >
                    {isCurrent && <span className="ost-current-dot" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="ost-hint-bar">
            点击高亮圆点继续画线 · 方向键移动 · Enter/空格 画线 · Z 撤销 · Esc 暂停
          </div>

          {/* 暂停遮罩 */}
          {screen === 'paused' && (
            <div className="ost-overlay">
              <div className="ost-overlay-card">
                <h3>⏸ 已暂停</h3>
                {pausedAuto && <p className="ost-paused-reason">已自动暂停（页面隐藏或窗口失焦）</p>}
                <div className="ost-overlay-actions">
                  <button className="ost-btn ost-btn-primary big" onClick={handleResume}>继续画线</button>
                  <button className="ost-btn" onClick={handleRestart}>重新开始</button>
                  <button className="ost-btn" onClick={handleMenu}>返回菜单</button>
                </div>
              </div>
            </div>
          )}

          {/* 通关遮罩 */}
          {screen === 'over' && finalInfo && (
            <div className="ost-overlay">
              <div className="ost-overlay-card ost-overlay-win">
                <h3>🎉 一笔画完成！</h3>
                <div className="ost-win-stats">
                  <div className="ost-win-big">{fmtTime(finalInfo.elapsed)}</div>
                  <div className="ost-win-sub">
                    {LEVELS[finalInfo.level]?.label}
                    {finalInfo.mode === 'daily' ? ' · 每日关卡' : ''}
                    {' · '}{finalInfo.moves} 条边 · 撤销 {finalInfo.undos} · 重置 {finalInfo.resets}
                  </div>
                </div>
                {best[finalInfo.level] && best[finalInfo.level].time === finalInfo.elapsed && (
                  <p className="ost-new-record">新纪录！</p>
                )}
                {finalInfo.mode === 'daily' && (
                  <p className="ost-daily-settled">今日关卡已记录：{fmtTime(finalInfo.elapsed)}</p>
                )}
                <div className="ost-overlay-actions">
                  <button className="ost-btn ost-btn-primary big" onClick={handleRestart}>再画一次</button>
                  <button className="ost-btn" onClick={handleMenu}>返回菜单</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div aria-live="polite" aria-atomic="true" className="ost-sr-only">{liveAnnounce}</div>
    </div>
  )
}
