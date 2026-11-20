import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  HanoiEngine, HANOI, LEVELS, DISK_OPTIONS, PEG_NAMES, isValidPegs,
} from '../game/HanoiEngine'
import './Hanoi.css'

const SAVE_KEY = 'game-hanoi-save-v1'
const STATS_KEY = 'game-hanoi-stats-v1'
const POMODORO_KEY = 'pomodoro-sessions-v1'
const SAVE_MAX_CHARS = 4096
const SAVE_DEBOUNCE_MS = 800
const STATS_DEBOUNCE_MS = 1000

function fmtElapsed(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw || raw.length > SAVE_MAX_CHARS) {
      if (raw) localStorage.removeItem(SAVE_KEY)
      return null
    }
    const data = JSON.parse(raw)
    if (!data || data.v !== 1) return null
    const disks = Number(data.disks)
    if (![3, 4, 5, 6, 7, 8].includes(disks)) return null
    if (!isValidPegs(data.pegs, disks)) return null
    if (!Number.isFinite(data.ts) || Date.now() - data.ts > HANOI.SAVE_TTL_MS) {
      localStorage.removeItem(SAVE_KEY)
      return null
    }
    const moves = Number(data.moves)
    const mistakes = Number(data.mistakes)
    const undos = Number(data.undos)
    if (![moves, mistakes, undos].every((v) => Number.isFinite(v) && v >= 0)) return null
    return {
      v: 1,
      disks,
      pegs: data.pegs.map((stack) => stack.map(Number)),
      moves: Math.floor(moves),
      mistakes: Math.floor(mistakes),
      undos: Math.floor(undos),
      assisted: Boolean(data.assisted),
      elapsed: Math.max(0, Number(data.elapsed) || 0),
      ts: Number(data.ts),
    }
  } catch {
    try { localStorage.removeItem(SAVE_KEY) } catch { /* ignore */ }
    return null
  }
}

function loadStats() {
  const empty = { plays: 0, wins: 0, totalMoves: 0, mistakes: 0, undos: 0, bestMoves: {}, updatedAt: 0 }
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return empty
    const out = {
      plays: Number.isFinite(data.plays) ? Math.max(0, Math.floor(data.plays)) : 0,
      wins: Number.isFinite(data.wins) ? Math.max(0, Math.floor(data.wins)) : 0,
      totalMoves: Number.isFinite(data.totalMoves) ? Math.max(0, Math.floor(data.totalMoves)) : 0,
      mistakes: Number.isFinite(data.mistakes) ? Math.max(0, Math.floor(data.mistakes)) : 0,
      undos: Number.isFinite(data.undos) ? Math.max(0, Math.floor(data.undos)) : 0,
      bestMoves: {},
      updatedAt: Number(data.updatedAt) || 0,
    }
    if (data.bestMoves && typeof data.bestMoves === 'object') {
      for (const n of DISK_OPTIONS) {
        const value = Number(data.bestMoves[n])
        if (Number.isFinite(value) && value > 0) out.bestMoves[n] = Math.floor(value)
      }
    }
    return out
  } catch { return empty }
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
      game: 'hanoi',
      win: Boolean(info.win),
      level: `${info.disks}盘`,
    })
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000
    localStorage.setItem(POMODORO_KEY, JSON.stringify(sessions.filter((s) => s.endTs >= cutoff)))
  } catch { /* 存储不可用时静默忽略 */ }
}

function diskWidth(size, disks) {
  return `${42 + (size / disks) * 54}%`
}

function diskColor(size) {
  const hue = 186 + size * 17
  return `linear-gradient(180deg, hsl(${hue} 85% 62%), hsl(${hue + 12} 78% 44%))`
}

/**
 * 汉诺塔页面壳 —— 3 根柱子 + 3~8 盘，点击或数字键拿放圆盘。
 *
 * 六屏：start / playing / paused / over
 * 约束卡① localStorage 持久化：进度 ≤4096 字符、24h TTL、胜负/重开即清理
 * 约束卡② 与基线计数 / 路由 / 存储键联动修正
 * 约束卡③ 移动端触控与窄屏：整根柱子可点、按钮 ≥44px、320px 不溢出
 */
export default function HanoiPage() {
  const engineRef = useRef(null)
  const snapshotRef = useRef(null)
  const statsRef = useRef(loadStats())
  const saveTimerRef = useRef(null)
  const statsTimerRef = useRef(null)
  const statsDirtyRef = useRef(false)
  const sessionStartRef = useRef(0)
  const sessionSettledRef = useRef(false)

  const [screen, setScreen] = useState('start')
  const [diskChoice, setDiskChoice] = useState(4)
  const [snapshot, setSnapshot] = useState(null)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [stats, setStats] = useState(statsRef.current)
  const [savedGame, setSavedGame] = useState(loadSavedGame)
  const [finalInfo, setFinalInfo] = useState(null)

  const flushStatsNow = () => {
    if (statsTimerRef.current) {
      clearTimeout(statsTimerRef.current)
      statsTimerRef.current = null
    }
    if (!statsDirtyRef.current) return
    statsDirtyRef.current = false
    statsRef.current.updatedAt = Date.now()
    try { localStorage.setItem(STATS_KEY, JSON.stringify(statsRef.current)) } catch { /* ignore */ }
  }

  const markStatsDirty = () => {
    statsDirtyRef.current = true
    if (statsTimerRef.current) return
    statsTimerRef.current = setTimeout(() => {
      statsTimerRef.current = null
      flushStatsNow()
    }, STATS_DEBOUNCE_MS)
  }

  const syncStats = (patch) => {
    const next = { ...statsRef.current, ...patch }
    statsRef.current = next
    setStats(next)
    markStatsDirty()
  }

  const writeSave = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const snap = snapshotRef.current
    if (!snap || (snap.state !== 'playing' && snap.state !== 'paused') || snap.moves <= 0) {
      try { localStorage.removeItem(SAVE_KEY) } catch { /* ignore */ }
      return null
    }
    const payload = {
      v: 1,
      disks: snap.disks,
      pegs: snap.pegs,
      moves: snap.moves,
      mistakes: snap.mistakes,
      undos: snap.undos,
      assisted: snap.assisted,
      elapsed: snap.elapsed,
      ts: Date.now(),
    }
    const raw = JSON.stringify(payload)
    if (raw.length > SAVE_MAX_CHARS) return null
    try { localStorage.setItem(SAVE_KEY, raw) } catch { return null }
    return payload
  }

  const scheduleSave = () => {
    if (saveTimerRef.current) return
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      writeSave()
    }, SAVE_DEBOUNCE_MS)
  }

  const clearSave = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    try { localStorage.removeItem(SAVE_KEY) } catch { /* ignore */ }
    setSavedGame(null)
  }

  const settleSession = (info = {}) => {
    if (sessionSettledRef.current) return
    if (!sessionStartRef.current) return
    sessionSettledRef.current = true
    const elapsed = Number.isFinite(info.elapsed) ? info.elapsed : (Date.now() - sessionStartRef.current) / 1000
    if (elapsed < 120) return
    const endTs = Date.now()
    appendPomodoroSession(endTs - elapsed * 1000, endTs, {
      win: info.result === 'win',
      disks: info.disks || snapshotRef.current?.disks || diskChoice,
    })
  }

  const recordRun = (info) => {
    const s = statsRef.current
    const next = {
      ...s,
      totalMoves: s.totalMoves + (info.moves || 0),
      mistakes: s.mistakes + (info.mistakes || 0),
      undos: s.undos + (info.undos || 0),
      bestMoves: { ...s.bestMoves },
    }
    if (info.result === 'win') {
      next.wins = s.wins + 1
      if (!info.assisted) {
        const prev = next.bestMoves[info.disks]
        if (!prev || info.moves < prev) next.bestMoves[info.disks] = info.moves
      }
    }
    statsRef.current = next
    setStats(next)
    markStatsDirty()
  }

  // ===== 引擎初始化 =====
  useEffect(() => {
    const engine = new HanoiEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.moves > 0 && (snap.state === 'playing' || snap.state === 'paused')) scheduleSave()
      },
      onGameOver: (info) => {
        clearSave()
        recordRun(info)
        settleSession(info)
        flushStatsNow()
        setFinalInfo(info)
        setScreen('over')
        setPausedAuto(false)
        setLiveAnnounce(info.result === 'win' ? '恭喜，全部圆盘已移到 C 柱' : '观察结束')
      },
    })
    engineRef.current = engine
    snapshotRef.current = engine.getSnapshot()

    return () => {
      writeSave()
      flushStatsNow()
      engine.dispose()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (screen !== 'playing') return undefined
    const timer = setInterval(() => {
      const engine = engineRef.current
      if (engine && engine.state === 'playing') engine.tick()
    }, 500)
    return () => clearInterval(timer)
  }, [screen])

  useEffect(() => {
    const pauseIfPlaying = (reason) => {
      const engine = engineRef.current
      if (!engine || engine.state !== 'playing') return
      engine.pause()
      setScreen('paused')
      setPausedAuto(true)
      setLiveAnnounce(`已自动暂停（${reason}）`)
      writeSave()
      flushStatsNow()
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') pauseIfPlaying('切到后台')
    }
    const onBlur = () => pauseIfPlaying('窗口失焦')
    const onPageHide = () => {
      writeSave()
      flushStatsNow()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', onPageHide)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (ev) => {
      const tag = ev.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (screen !== 'playing' && screen !== 'paused') return
      if (ev.key === '1' || ev.key === '2' || ev.key === '3') {
        ev.preventDefault()
        handlePeg(Number(ev.key) - 1)
      } else if (ev.code === 'Space') {
        ev.preventDefault()
        togglePause()
      } else if (ev.key === 'u' || ev.key === 'U') {
        ev.preventDefault()
        handleUndo()
      } else if (ev.key === 'Escape') {
        const engine = engineRef.current
        if (engine && engine.state === 'playing') {
          engine.pause()
          setScreen('paused')
          setPausedAuto(false)
          setLiveAnnounce('已暂停')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])

  // ===== 操作 =====
  const beginRun = (disks) => {
    settleSession(snapshotRef.current || {})
    clearSave()
    const engine = engineRef.current
    if (!engine) return
    const snap = engine.start(disks)
    snapshotRef.current = snap
    setSnapshot(snap)
    setScreen('playing')
    setPausedAuto(false)
    setFinalInfo(null)
    sessionStartRef.current = Date.now()
    sessionSettledRef.current = false
    syncStats({ plays: statsRef.current.plays + 1 })
    setLiveAnnounce(`${disks} 盘挑战开始，最少 ${2 ** disks - 1} 步`)
  }

  const handleContinue = () => {
    if (!savedGame) return
    const engine = engineRef.current
    if (!engine) return
    const result = engine.restore(savedGame)
    if (!result.ok) {
      clearSave()
      setLiveAnnounce(`无法恢复存档：${result.reason}`)
      return
    }
    snapshotRef.current = result.snapshot
    setSnapshot(result.snapshot)
    setDiskChoice(savedGame.disks)
    setScreen('paused')
    setPausedAuto(false)
    setFinalInfo(null)
    sessionStartRef.current = Date.now()
    sessionSettledRef.current = false
    setLiveAnnounce('已恢复上次进度，点继续开始计时')
  }

  const handlePeg = (peg) => {
    const engine = engineRef.current
    if (!engine || engine.state !== 'playing') return
    const result = engine.select(peg)
    if (!result.ok) {
      setLiveAnnounce(`${PEG_NAMES[peg]}：${result.reason}`)
      return
    }
    if (result.selected !== undefined) {
      setLiveAnnounce(`已拿起 ${PEG_NAMES[peg]} 顶部圆盘`)
    } else if (result.deselected) {
      setLiveAnnounce(`已取消选择 ${PEG_NAMES[peg]}`)
    } else {
      const snap = engine.getSnapshot()
      setLiveAnnounce(`移动成功，当前第 ${snap.moves} 步`)
    }
  }

  const togglePause = () => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.state === 'playing') {
      engine.pause()
      setScreen('paused')
      setPausedAuto(false)
      writeSave()
      setLiveAnnounce('已暂停，可继续、撤销或重开')
    } else if (engine.state === 'paused') {
      engine.resume()
      setScreen('playing')
      setPausedAuto(false)
      setLiveAnnounce('继续计时')
    }
  }

  const handleUndo = () => {
    const engine = engineRef.current
    if (!engine) return
    const result = engine.undo()
    if (!result.ok) {
      setLiveAnnounce(result.reason)
      return
    }
    writeSave()
    setLiveAnnounce(`已撤销一步，当前第 ${engine.getSnapshot().moves} 步`)
  }

  const handleRestart = () => {
    const snap = snapshotRef.current
    if (snap && snap.moves > 0) {
      recordRun({ ...snap, result: 'stopped' })
      settleSession(snap)
    }
    beginRun(snap?.disks || diskChoice)
  }

  const handleStop = () => {
    const engine = engineRef.current
    if (!engine) return
    engine.stop()
  }

  const handleMenu = () => {
    const engine = engineRef.current
    const snap = snapshotRef.current
    if (engine && engine.state === 'playing') engine.pause()
    if (snap && snap.moves > 0) {
      const payload = writeSave()
      setSavedGame(payload)
      settleSession(snap)
    }
    setScreen('start')
    setPausedAuto(false)
    setFinalInfo(null)
    setLiveAnnounce('已返回开始菜单，进度保留 24 小时')
  }

  const handleDiscardSave = () => {
    clearSave()
    setLiveAnnounce('已放弃上次进度')
  }

  const pageNav = (
    <nav className="hanoi-nav">
      <Link className="hanoi-nav-back" to="/">← 返回首页</Link>
      <h1 className="hanoi-nav-title">汉诺塔</h1>
      <span className="hanoi-nav-spacer" />
      {screen !== 'start' && <span className="hanoi-nav-badge">{snapshot?.disks ?? diskChoice} 盘</span>}
    </nav>
  )

  if (screen === 'start') {
    return (
      <div className="hanoi-page">
        {pageNav}
        <main className="hanoi-screen">
          <section className="hanoi-card">
            <h2 className="hanoi-title">汉诺塔</h2>
            <p className="hanoi-desc">
              把所有圆盘从 A 柱移到 C 柱，每次只能移动最上面的一个，且大盘不能压在小盘上。
              最少步数是 2<sup>n</sup> − 1；试试用最少的步数完成。
            </p>

            {savedGame && (
              <div className="hanoi-resume" role="status">
                <div>
                  <strong>继续上次进度</strong>
                  <span>
                    {savedGame.disks} 盘 · 第 {savedGame.moves} 步 · 用时 {fmtElapsed(savedGame.elapsed)}
                  </span>
                </div>
                <div className="hanoi-resume-actions">
                  <button type="button" className="hanoi-btn hanoi-btn-primary" onClick={handleContinue}>继续</button>
                  <button type="button" className="hanoi-link-btn" onClick={handleDiscardSave}>放弃</button>
                </div>
              </div>
            )}

            <div className="hanoi-section-head">
              <h3>选择盘数</h3>
              <span>盘数越多，最少步数翻倍增长</span>
            </div>
            <div className="hanoi-levels" role="group" aria-label="盘数">
              {DISK_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`hanoi-level ${diskChoice === n ? 'active' : ''}`}
                  aria-pressed={diskChoice === n}
                  onClick={() => setDiskChoice(n)}
                >
                  <strong>{n} 盘</strong>
                  <span>{LEVELS[n].label} · {2 ** n - 1} 步</span>
                  <em>{stats.bestMoves[n] ? `最佳 ${stats.bestMoves[n]}` : '尚无记录'}</em>
                </button>
              ))}
            </div>

            <button type="button" className="hanoi-start-btn" onClick={() => beginRun(diskChoice)}>
              开始挑战
            </button>

            <p className="hanoi-stats-line">
              完成 <strong>{stats.wins}</strong> 局 · 累计 <strong>{stats.totalMoves}</strong> 步 ·
              失误 <strong>{stats.mistakes}</strong> 次
            </p>

            <ul className="hanoi-rules">
              <li>点柱子拿起顶部圆盘，再点另一根柱子放下；再点同一根柱子取消选择。</li>
              <li>键盘 1 / 2 / 3 对应 A / B / C 柱，空格暂停，U 撤销，Esc 暂停。</li>
              <li>移动端整根柱子都是触控热区，不需要拖拽。</li>
              <li>进度自动保存 24 小时；通关、重开或放弃后清理。</li>
            </ul>
          </section>
        </main>
        <p className="hanoi-live" aria-live="polite">{liveAnnounce}</p>
      </div>
    )
  }

  if (screen === 'over') {
    const extra = finalInfo ? Math.max(0, finalInfo.moves - finalInfo.optimal) : 0
    return (
      <div className="hanoi-page">
        {pageNav}
        <main className="hanoi-screen">
          <section className="hanoi-card hanoi-over-card">
            <div className={`hanoi-over-mark ${finalInfo?.result === 'win' ? 'win' : ''}`} aria-hidden="true" />
            <h2 className="hanoi-title">{finalInfo?.result === 'win' ? '完成！' : '观察结束'}</h2>
            <p className="hanoi-desc">
              {finalInfo?.result === 'win'
                ? (extra === 0 ? '正好用最少步数完成，完美。' : `比最少步数多用了 ${extra} 步，再来一次试试。`)
                : '你结束了这次挑战，进度不会保留。'}
            </p>
            <div className="hanoi-over-stats">
              <div><span>实际步数</span><strong>{finalInfo?.moves ?? 0}</strong></div>
              <div><span>最少步数</span><strong>{finalInfo?.optimal ?? 0}</strong></div>
              <div><span>失误</span><strong>{finalInfo?.mistakes ?? 0}</strong></div>
              <div><span>撤销</span><strong>{finalInfo?.undos ?? 0}</strong></div>
              <div><span>用时</span><strong>{fmtElapsed(finalInfo?.elapsed)}</strong></div>
              <div><span>盘数</span><strong>{finalInfo?.disks ?? diskChoice}</strong></div>
            </div>
            {finalInfo?.assisted && <p className="hanoi-over-note">使用过撤销，本次不计入最佳步数。</p>}
            <div className="hanoi-inline-actions">
              <button type="button" className="hanoi-start-btn" onClick={() => beginRun(finalInfo?.disks || diskChoice)}>
                再来一局
              </button>
              <button type="button" className="hanoi-btn" onClick={() => setScreen('start')}>返回开始菜单</button>
            </div>
          </section>
        </main>
        <p className="hanoi-live" aria-live="polite">{liveAnnounce}</p>
      </div>
    )
  }

  return (
    <div className="hanoi-page">
      {pageNav}
      <main className="hanoi-screen hanoi-screen-wide">
        <section className="hanoi-card hanoi-card-wide">
          <div className="hanoi-hud" aria-label="对局统计">
            <div><span>步数</span><strong>{snapshot?.moves ?? 0}</strong></div>
            <div><span>最少</span><strong>{snapshot?.optimal ?? 0}</strong></div>
            <div><span>失误</span><strong>{snapshot?.mistakes ?? 0}</strong></div>
            <div><span>撤销</span><strong>{snapshot?.undos ?? 0}</strong></div>
            <div><span>用时</span><strong>{fmtElapsed(snapshot?.elapsed)}</strong></div>
            <div><span>盘数</span><strong>{snapshot?.disks ?? diskChoice}</strong></div>
          </div>

          <div className="hanoi-board-wrap">
            <div className="hanoi-board" role="group" aria-label="汉诺塔三根柱子">
              {[0, 1, 2].map((peg) => {
                const stack = snapshot?.pegs?.[peg] || []
                const top = stack.length ? stack[stack.length - 1] : 0
                const selected = snapshot?.selectedPeg === peg
                return (
                  <button
                    key={peg}
                    type="button"
                    className={`hanoi-peg ${selected ? 'selected' : ''}`}
                    aria-pressed={selected}
                    aria-label={`${PEG_NAMES[peg]}，${stack.length} 个圆盘${top ? `，顶部 ${top} 号盘` : ''}`}
                    onClick={() => handlePeg(peg)}
                  >
                    <span className="hanoi-peg-label">{PEG_NAMES[peg]}</span>
                    <span className="hanoi-disks">
                      {stack.map((size) => (
                        <span
                          key={size}
                          className="hanoi-disk"
                          style={{ width: diskWidth(size, snapshot?.disks || diskChoice), background: diskColor(size) }}
                        >
                          <em>{size}</em>
                        </span>
                      ))}
                    </span>
                    <span className="hanoi-peg-base" />
                  </button>
                )
              })}
            </div>
            {screen === 'paused' && (
              <div className="hanoi-pause-mask" role="dialog" aria-label="已暂停">
                <div>
                  <p className="hanoi-pause-title">{pausedAuto ? '已自动暂停' : '已暂停'}</p>
                  <p className="hanoi-pause-sub">
                    {pausedAuto ? '切到后台或窗口失焦时自动暂停，回来后需手动继续。' : '进度已保存，可以继续或撤销上一步。'}
                  </p>
                  <div className="hanoi-pause-actions">
                    <button type="button" className="hanoi-btn hanoi-btn-primary" onClick={togglePause}>继续</button>
                    <button type="button" className="hanoi-btn" onClick={handleUndo}>撤销一步</button>
                    <button type="button" className="hanoi-btn" onClick={handleRestart}>重开本局</button>
                    <button type="button" className="hanoi-btn" onClick={handleStop}>结束观察</button>
                    <button type="button" className="hanoi-btn" onClick={handleMenu}>返回菜单</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <p className="hanoi-hint">
            点柱子拿起 / 放下圆盘；键盘 1 / 2 / 3 对应 A / B / C，空格暂停，U 撤销。
          </p>

          <div className="hanoi-toolbar">
            <button type="button" className="hanoi-btn hanoi-btn-primary" onClick={togglePause}>
              {screen === 'playing' ? '暂停' : '继续'}
            </button>
            <button type="button" className="hanoi-btn" onClick={handleUndo} disabled={!snapshot?.canUndo}>撤销</button>
            <button type="button" className="hanoi-btn" onClick={handleRestart}>重开</button>
            <button type="button" className="hanoi-btn" onClick={handleStop}>结束观察</button>
            <button type="button" className="hanoi-btn" onClick={handleMenu}>返回菜单</button>
          </div>

          <p className="hanoi-live" aria-live="polite">{liveAnnounce}</p>
          {pausedAuto && <p className="hanoi-hint">已自动暂停：切到后台或窗口失焦不会继续计时。</p>}
          <p className="hanoi-save-note">进度自动保存 24 小时；通关、重开或放弃后清理。</p>
        </section>
      </main>
    </div>
  )
}
