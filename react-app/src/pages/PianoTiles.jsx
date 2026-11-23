import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PianoTilesEngine, PIANO, validateSave } from '../game/PianoTilesEngine.js'
import './PianoTiles.css'

const SAVE_KEY = 'game-piano-tiles-save-v1'
const STATS_KEY = 'game-piano-tiles-stats-v1'
const DEFAULT_STATS = {
  plays: 0,
  gamesOver: 0,
  totalTiles: 0,
  maxCombo: 0,
  bestScore: 0,
  misses: 0,
  wrongTaps: 0,
  updatedAt: 0,
}

function fmtElapsed(s) {
  const v = Math.max(0, Math.round(s || 0))
  const mm = Math.floor(v / 60)
  const ss = String(v % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    if (raw.length > 4096) {
      localStorage.removeItem(SAVE_KEY)
      return null
    }
    const save = validateSave(JSON.parse(raw))
    if (!save) {
      localStorage.removeItem(SAVE_KEY)
      return null
    }
    if (Date.now() - save.ts > PIANO.SAVE_TTL_MS) {
      localStorage.removeItem(SAVE_KEY)
      return null
    }
    return save
  } catch {
    try {
      localStorage.removeItem(SAVE_KEY)
    } catch {
      /* ignore */
    }
    return null
  }
}

function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY)
    if (!raw) return { ...DEFAULT_STATS }
    const obj = JSON.parse(raw)
    const pick = (key) => Math.max(0, Math.floor(Number(obj?.[key]) || 0))
    return {
      plays: pick('plays'),
      gamesOver: pick('gamesOver'),
      totalTiles: pick('totalTiles'),
      maxCombo: pick('maxCombo'),
      bestScore: pick('bestScore'),
      misses: pick('misses'),
      wrongTaps: pick('wrongTaps'),
      updatedAt: pick('updatedAt'),
    }
  } catch {
    return { ...DEFAULT_STATS }
  }
}

function appendPomodoroSession(game, win, level, elapsed) {
  try {
    const list = JSON.parse(localStorage.getItem('pomodoro-sessions-v1') || '[]')
    list.push({
      id: `piano-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      start: Date.now() - Math.round(elapsed * 1000),
      end: Date.now(),
      elapsed,
      game,
      win,
      level,
    })
    localStorage.setItem('pomodoro-sessions-v1', JSON.stringify(list))
  } catch {
    /* 容量满等情况静默忽略 */
  }
}

/** 计算判定窗口内最低未命中黑块所在轨道（视觉高亮） */
function activeLaneOf(snap) {
  if (!snap) return -1
  const lo = snap.judgeY - snap.hitTol
  const hi = snap.judgeY + snap.hitTol
  let active = null
  for (const r of snap.rows) {
    if (r.hit) continue
    if (r.y >= lo && r.y <= hi && (!active || r.y > active.y)) active = r
  }
  return active ? active.lane : -1
}

export default function PianoTiles() {
  const navigate = useNavigate()
  const engineRef = useRef(null)
  const snapshotRef = useRef(null)
  const statsRef = useRef(loadStats())
  const statsDirtyRef = useRef(false)
  const statsTimerRef = useRef(null)
  const saveTimerRef = useRef(null)
  const sessionStartRef = useRef(Date.now())
  const sessionSettledRef = useRef(false)

  const [screen, setScreen] = useState('start') // start | playing | paused | over
  const [snapshot, setSnapshot] = useState(null)
  const [stats, setStats] = useState(statsRef.current)
  const [savedGame, setSavedGame] = useState(() => loadSavedGame())
  const [pausedAuto, setPausedAuto] = useState(false)
  const [finalInfo, setFinalInfo] = useState(null)
  const [liveAnnounce, setLiveAnnounce] = useState('')

  /* ========== 存档 ========== */
  const clearSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    try {
      localStorage.removeItem(SAVE_KEY)
    } catch {
      /* ignore */
    }
    setSavedGame(null)
  }, [])

  const writeSave = useCallback(() => {
    const snap = snapshotRef.current
    if (!snap) return
    if (snap.state !== 'playing' && snap.state !== 'paused') return
    if (snap.hits <= 0) {
      clearSave()
      return
    }
    const save = {
      v: 1,
      rows: snap.rows.map((r) => ({ id: r.id, lane: r.lane, y: r.y, hit: r.hit })),
      score: snap.score,
      hits: snap.hits,
      combo: snap.combo,
      maxCombo: snap.maxCombo,
      misses: snap.misses,
      wrongTaps: snap.wrongTaps,
      elapsed: snap.elapsed,
      ts: Date.now(),
    }
    const text = JSON.stringify(save)
    if (text.length > 4096) {
      clearSave()
      return
    }
    try {
      localStorage.setItem(SAVE_KEY, text)
    } catch {
      clearSave()
    }
  }, [clearSave])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(writeSave, 800)
  }, [writeSave])

  /* ========== 统计（埋点） ========== */
  const flushStatsNow = useCallback(() => {
    if (!statsDirtyRef.current) return
    statsDirtyRef.current = false
    if (statsTimerRef.current) {
      clearTimeout(statsTimerRef.current)
      statsTimerRef.current = null
    }
    const s = statsRef.current
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify({ ...s, updatedAt: Date.now() }))
    } catch {
      /* ignore */
    }
    setStats({ ...s })
  }, [])

  const markStatsDirty = useCallback(() => {
    statsDirtyRef.current = true
    if (statsTimerRef.current) clearTimeout(statsTimerRef.current)
    statsTimerRef.current = setTimeout(flushStatsNow, 1000)
  }, [flushStatsNow])

  const syncStats = useCallback(
    (patch) => {
      const s = statsRef.current
      const next = { ...s, ...patch }
      for (const key of ['plays', 'gamesOver', 'totalTiles', 'maxCombo', 'bestScore', 'misses', 'wrongTaps']) {
        next[key] = Math.max(0, Math.floor(Number(next[key]) || 0))
      }
      statsRef.current = next
      setStats({ ...next })
      markStatsDirty()
    },
    [markStatsDirty],
  )

  const recordRun = useCallback(
    (info) => {
      const s = statsRef.current
      const next = {
        ...s,
        gamesOver: s.gamesOver + 1,
        totalTiles: s.totalTiles + (info?.hits || 0),
        maxCombo: Math.max(s.maxCombo, info?.maxCombo || 0),
        bestScore: Math.max(s.bestScore, info?.score || 0),
        misses: s.misses + (info?.misses || 0),
        wrongTaps: s.wrongTaps + (info?.wrongTaps || 0),
      }
      statsRef.current = next
      setStats({ ...next })
      markStatsDirty()
    },
    [markStatsDirty],
  )

  /* ========== 番茄钟会话结算 ========== */
  const settleSession = useCallback(
    (snap, reason) => {
      if (sessionSettledRef.current) return
      sessionSettledRef.current = true
      const effectiveElapsed = Math.max(0, (snap?.elapsed || 0) - 0)
      if (effectiveElapsed >= 120) {
        appendPomodoroSession('piano-tiles', false, `${snap?.score || 0}分`, effectiveElapsed)
      }
      if (reason === 'gameover') recordRun(snap)
    },
    [recordRun],
  )

  /* ========== 引擎生命周期 ========== */
  const handleTap = useCallback((lane) => {
    const engine = engineRef.current
    if (!engine || engine.state !== 'playing') return
    const result = engine.tap(lane)
    if (result?.hit && result.score % 10 === 0) {
      setLiveAnnounce(`已得 ${result.score} 分，连击 ${result.combo}`)
    }
  }, [])

  useEffect(() => {
    const engine = new PianoTilesEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state === 'playing' || snap.state === 'paused') scheduleSave()
        else if (snap.state === 'over') clearSave()
      },
      onGameOver: (info) => {
        settleSession(snapshotRef.current, 'gameover')
        setFinalInfo(info)
        setScreen('over')
        setLiveAnnounce(
          info.result === 'wrong-tap'
            ? '点到白块，游戏结束'
            : info.result === 'missed'
              ? '漏点黑块，游戏结束'
              : '游戏结束',
        )
      },
      onPause: () => {
        writeSave()
        flushStatsNow()
      },
    })
    engineRef.current = engine
    snapshotRef.current = engine.getSnapshot()
    setSnapshot(engine.getSnapshot())

    const onHide = () => {
      const e = engineRef.current
      if (e && e.state === 'playing') {
        e.pause()
        setScreen('paused')
        setPausedAuto(true)
      }
    }
    const onVisibility = () => {
      if (document.hidden) onHide()
    }
    const onBlur = () => onHide()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', flushStatsNow)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', flushStatsNow)
      if (statsTimerRef.current) clearTimeout(statsTimerRef.current)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      writeSave()
      flushStatsNow()
      engine.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* rAF 主循环：仅 playing 时推进，每帧刷新 last 避免恢复跳帧 */
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now) => {
      raf = requestAnimationFrame(loop)
      const engine = engineRef.current
      const dt = now - last
      last = now
      if (engine && engine.state === 'playing') engine.tick(dt)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  /* ========== 控制 ========== */
  const beginRun = useCallback(() => {
    settleSession(snapshotRef.current, 'abandon')
    clearSave()
    const engine = engineRef.current
    if (!engine) return
    const snap = engine.start()
    snapshotRef.current = snap
    setSnapshot(snap)
    setScreen('playing')
    setPausedAuto(false)
    setFinalInfo(null)
    sessionStartRef.current = Date.now()
    sessionSettledRef.current = false
    syncStats({ plays: statsRef.current.plays + 1 })
    setLiveAnnounce('黑块下落中，点中黑块，别踩白块')
  }, [clearSave, settleSession, syncStats])

  const handleContinue = useCallback(() => {
    if (!savedGame) return
    const engine = engineRef.current
    if (!engine) return
    const result = engine.restore(savedGame)
    if (!result.ok) {
      clearSave()
      setLiveAnnounce('存档已失效，已清除')
      return
    }
    snapshotRef.current = result.snapshot
    setSnapshot(result.snapshot)
    setScreen('paused')
    setPausedAuto(false)
    setFinalInfo(null)
    sessionStartRef.current = Date.now()
    sessionSettledRef.current = false
    setLiveAnnounce('已恢复进度，点继续开始')
  }, [savedGame, clearSave])

  const togglePause = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.state === 'playing') {
      engine.pause()
      setScreen('paused')
      setPausedAuto(false)
    } else if (engine.state === 'paused') {
      engine.resume()
      setScreen('playing')
      setPausedAuto(false)
    }
  }, [])

  const handleRestart = useCallback(() => {
    beginRun()
  }, [beginRun])

  const handleStop = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.state === 'playing' || engine.state === 'paused') {
      engine.stop()
    }
  }, [])

  const handleMenu = useCallback(() => {
    const engine = engineRef.current
    if (engine && (engine.state === 'playing' || engine.state === 'paused')) {
      engine.stop()
    }
    navigate('/')
  }, [navigate])

  const handleDiscardSave = useCallback(() => {
    clearSave()
    setLiveAnnounce('已放弃存档')
  }, [clearSave])

  /* 键盘：1/2/3/4 点轨道，Space/Pause 暂停，Esc 暂停 */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const k = e.key
      if (screen === 'playing' && (k === '1' || k === '2' || k === '3' || k === '4')) {
        e.preventDefault()
        handleTap(Number(k) - 1)
      } else if (k === ' ' || k === 'Spacebar') {
        if (screen === 'playing' || screen === 'paused') {
          e.preventDefault()
          togglePause()
        }
      } else if (k === 'Escape') {
        if (screen === 'playing') {
          e.preventDefault()
          togglePause()
        }
      } else if ((k === 'p' || k === 'P') && (screen === 'playing' || screen === 'paused')) {
        e.preventDefault()
        togglePause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen, handleTap, togglePause])

  /* ========== 渲染 ========== */
  const visibleRows = useMemo(() => snapshot?.rows.filter((r) => !r.hit) || [], [snapshot])
  const activeLane = useMemo(() => (screen === 'playing' ? activeLaneOf(snapshot) : -1), [screen, snapshot])
  const isNewBest = finalInfo ? finalInfo.score > 0 && finalInfo.score >= stats.bestScore : false

  return (
    <div className="piano-page">
      <nav className="piano-nav">
        <Link to="/" className="piano-nav-back" onClick={handleMenu}>
          ← 返回
        </Link>
        <h1 className="piano-nav-title">钢琴块</h1>
        <span className="piano-nav-spacer" />
        <span className="piano-nav-badge">街机模式</span>
      </nav>

      <div className="piano-announce" role="status" aria-live="polite" aria-atomic="true">
        {liveAnnounce}
      </div>

      {screen === 'start' && (
        <div className="piano-screen">
          <div className="piano-card">
            <h2 className="piano-title">钢琴块 · 别踩白块</h2>
            <p className="piano-desc">
              4 条轨道，黑色色块连续下落且越落越快。在底部判定线附近点中黑块得分；
              <strong>点到白块或漏点黑块立即结束</strong>。冲击你的最高分。
            </p>
            <div className="piano-stats-grid">
              <div className="piano-stat"><span className="piano-stat-label">最高分</span><span className="piano-stat-value">{stats.bestScore}</span></div>
              <div className="piano-stat"><span className="piano-stat-label">累计点中</span><span className="piano-stat-value">{stats.totalTiles}</span></div>
              <div className="piano-stat"><span className="piano-stat-label">最高连击</span><span className="piano-stat-value">{stats.maxCombo}</span></div>
              <div className="piano-stat"><span className="piano-stat-label">游玩次数</span><span className="piano-stat-value">{stats.plays}</span></div>
            </div>
            <div className="piano-rules">
              <h3>玩法</h3>
              <ul>
                <li>点按底部判定线附近的黑块 +1 分，连击不中断。</li>
                <li>点到白块，或让黑块越过底线，游戏结束。</li>
                <li>得分越高，下落越快，考验反应与节奏。</li>
              </ul>
            </div>
            {savedGame && (
              <div className="piano-save-block">
                <span>检测到未完成存档（得分 {savedGame.score}）</span>
                <div className="piano-save-actions">
                  <button className="piano-btn piano-btn-primary" onClick={handleContinue}>继续</button>
                  <button className="piano-btn" onClick={handleDiscardSave}>放弃存档</button>
                </div>
              </div>
            )}
            <div className="piano-actions">
              <button className="piano-btn piano-btn-primary piano-btn-lg" onClick={beginRun}>开始游戏</button>
            </div>
            <p className="piano-keyhint">键盘：1 / 2 / 3 / 4 点对应轨道，Space 暂停，Esc 返回</p>
          </div>
        </div>
      )}

      {(screen === 'playing' || screen === 'paused') && snapshot && (
        <div className="piano-screen piano-screen-wide">
          <div className="piano-card piano-card-wide">
            <div className="piano-hud">
              <div className="piano-hud-item"><span className="piano-hud-label">得分</span><span className="piano-hud-value">{snapshot.score}</span></div>
              <div className="piano-hud-item"><span className="piano-hud-label">最高</span><span className="piano-hud-value">{stats.bestScore}</span></div>
              <div className="piano-hud-item"><span className="piano-hud-label">连击</span><span className="piano-hud-value">{snapshot.combo}</span></div>
              <div className="piano-hud-item"><span className="piano-hud-label">速度</span><span className="piano-hud-value">{snapshot.speed.toFixed(1)}</span></div>
              <div className="piano-hud-item"><span className="piano-hud-label">用时</span><span className="piano-hud-value">{fmtElapsed(snapshot.elapsed)}</span></div>
              <button className="piano-hud-pause" onClick={togglePause} aria-label="暂停">
                {screen === 'paused' ? '▶' : '❚❚'}
              </button>
            </div>

            <div
              className="piano-board"
              role="img"
              aria-label={`钢琴块场地，当前得分 ${snapshot.score}，连击 ${snapshot.combo}`}
            >
              <div className="piano-track" aria-hidden="true">
                <span className="piano-divider piano-divider-1" />
                <span className="piano-divider piano-divider-2" />
                <span className="piano-divider piano-divider-3" />
                {visibleRows.map((r) => (
                  <div
                    key={r.id}
                    className={`piano-tile ${activeLane === r.lane ? 'piano-tile-active' : ''}`}
                    style={{ top: `${((r.y - 0.5) * 100) / PIANO.VISIBLE}%`, left: `${r.lane * 25}%` }}
                  />
                ))}
                <div className="piano-judge" />
              </div>
              {[0, 1, 2, 3].map((lane) => (
                <button
                  key={lane}
                  className={`piano-lane-btn ${activeLane === lane ? 'piano-lane-active' : ''}`}
                  style={{ left: `${lane * 25}%` }}
                  aria-label={`第 ${lane + 1} 轨道`}
                  onClick={() => handleTap(lane)}
                />
              ))}
            </div>

            <p className="piano-keyhint piano-keyhint-inline">点按轨道或按 1 / 2 / 3 / 4</p>

            {screen === 'paused' && (
              <div className="piano-overlay" role="dialog" aria-modal="true" aria-label="已暂停">
                <div className="piano-overlay-card">
                  <h3>{pausedAuto ? '已自动暂停' : '已暂停'}</h3>
                  <p>得分 {snapshot.score} · 用时 {fmtElapsed(snapshot.elapsed)}</p>
                  <div className="piano-actions">
                    <button className="piano-btn piano-btn-primary" onClick={togglePause}>继续</button>
                    <button className="piano-btn" onClick={handleRestart}>重开</button>
                    <button className="piano-btn" onClick={handleStop}>结束</button>
                    <button className="piano-btn" onClick={handleMenu}>返回菜单</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {screen === 'over' && finalInfo && (
        <div className="piano-screen">
          <div className="piano-card">
            <h2 className="piano-title">游戏结束</h2>
            <p className="piano-desc">
              {finalInfo.result === 'wrong-tap' ? '点到了白块。' : finalInfo.result === 'missed' ? '漏点了黑块。' : '本局已结束。'}
              {isNewBest ? ' 新纪录！' : ''}
            </p>
            <div className="piano-stats-grid">
              <div className="piano-stat piano-stat-accent"><span className="piano-stat-label">本局得分</span><span className="piano-stat-value">{finalInfo.score}</span></div>
              <div className="piano-stat"><span className="piano-stat-label">最高分</span><span className="piano-stat-value">{stats.bestScore}</span></div>
              <div className="piano-stat"><span className="piano-stat-label">最高连击</span><span className="piano-stat-value">{finalInfo.maxCombo}</span></div>
              <div className="piano-stat"><span className="piano-stat-label">用时</span><span className="piano-stat-value">{fmtElapsed(finalInfo.elapsed)}</span></div>
            </div>
            <div className="piano-actions">
              <button className="piano-btn piano-btn-primary piano-btn-lg" onClick={handleRestart}>再来一局</button>
              <button className="piano-btn" onClick={handleMenu}>返回菜单</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
