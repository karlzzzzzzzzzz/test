import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { NonogramEngine, LEVELS, CELL, NONOGRAM } from '../game/NonogramEngine'
import './Nonogram.css'

const BEST_KEY = 'game-nonogram-best-v1'
const STATS_KEY = 'game-nonogram-stats-v1'
const PROGRESS_KEY = 'game-nonogram-progress-v1'
const POMODORO_KEY = 'pomodoro-sessions-v1'
const LEVEL_KEYS = ['easy', 'normal', 'hard']

function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return {}
    const out = {}
    for (const k of LEVEL_KEYS) {
      const r = data[k]
      if (r && Number.isFinite(r.elapsed)) out[k] = { elapsed: r.elapsed, moves: r.moves || 0 }
    }
    return out
  } catch { return {} }
}

function loadStats() {
  const empty = { plays: {}, wins: {}, timeByLevel: {}, hintsUsed: 0, updatedAt: 0 }
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return empty
    return {
      ...empty, ...data,
      plays: { ...(data.plays || {}) },
      wins: { ...(data.wins || {}) },
      timeByLevel: { ...(data.timeByLevel || {}) },
    }
  } catch { return empty }
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return null
    if (!data.level || typeof data.grid !== 'string') return null
    if (data.grid.length > NONOGRAM.MAX_PROGRESS_CHARS) return null
    // 超过 24h 的进度视为过期
    if (Number.isFinite(data.ts) && Date.now() - data.ts > 24 * 3600 * 1000) return null
    return data
  } catch { return null }
}

function appendPomodoroSession(startTs, endTs, level) {
  try {
    const raw = localStorage.getItem(POMODORO_KEY)
    const sessions = raw ? JSON.parse(raw) : []
    if (!Array.isArray(sessions)) return
    sessions.push({ startTs, endTs, durSec: Math.round((endTs - startTs) / 1000), game: 'nonogram', win: true, level })
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000
    localStorage.setItem(POMODORO_KEY, JSON.stringify(sessions.filter(s => s.endTs >= cutoff)))
  } catch { /* ignore */ }
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * 数织页面壳 —— 根据行列提示还原图案。
 *
 * 六屏：start / playing / paused / over
 * 约束卡① 键盘无障碍：role=grid + roving tabindex + aria-live 播报
 * 约束卡② localStorage：progress（单条，≤400 字符）+ best + stats，24h 过期清理
 * 约束卡③ 切后台/失焦：visibilitychange + blur 双路去重自动暂停
 */
export default function NonogramPage() {
  const engineRef = useRef(null)
  const snapshotRef = useRef(null)
  const statsRef = useRef(loadStats())
  const bestRef = useRef(loadBest())
  const gameStartRef = useRef(0)
  const pauseStartRef = useRef(0)
  const focusIdxRef = useRef(0)
  const progressTimerRef = useRef(null)

  const [screen, setScreen] = useState('start')
  const [level, setLevel] = useState('easy')
  const [snapshot, setSnapshot] = useState(null)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [best, setBest] = useState(bestRef.current)
  const [savedProgress, setSavedProgress] = useState(loadProgress)

  const [finalElapsed, setFinalElapsed] = useState(0)
  const [finalMoves, setFinalMoves] = useState(0)
  const [finalLevel, setFinalLevel] = useState('easy')
  const [newRecord, setNewRecord] = useState(false)

  const flushStats = () => {
    const s = statsRef.current
    if (!s || !s._dirty) return
    s._dirty = false
    const rest = { ...s }
    delete rest._dirty
    try { localStorage.setItem(STATS_KEY, JSON.stringify(rest)) } catch { /* ignore */ }
  }

  const saveProgress = () => {
    const e = engineRef.current
    if (!e || e.state !== 'playing') return
    const prog = e.exportProgress()
    if (prog.grid.length > NONOGRAM.MAX_PROGRESS_CHARS) return
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(prog)) } catch { /* ignore */ }
  }

  // ===== 引擎初始化 =====
  useEffect(() => {
    const engine = new NonogramEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state === 'playing') setScreen('playing')
        else if (snap.state === 'paused') setScreen('paused')
      },
      onPause: () => { pauseStartRef.current = Date.now() },
      onGameOver: (info) => {
        const snap = engineRef.current.getSnapshot()
        setFinalElapsed(info.elapsed)
        setFinalMoves(info.moves)
        setFinalLevel(info.level)

        // 最佳成绩：更短用时优先（同用时步数更少）
        const prev = bestRef.current[info.level]
        const isBetter = !prev || info.elapsed < prev.elapsed
          || (info.elapsed === prev.elapsed && info.moves < prev.moves)
        if (isBetter) {
          const next = { ...bestRef.current, [info.level]: { elapsed: info.elapsed, moves: info.moves } }
          bestRef.current = next
          setBest(next)
          try { localStorage.setItem(BEST_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        }
        setNewRecord(isBetter)

        // 埋点
        const s = statsRef.current
        s.plays[info.level] = (s.plays[info.level] || 0) + 1
        s.wins[info.level] = (s.wins[info.level] || 0) + 1
        s.timeByLevel[info.level] = (s.timeByLevel[info.level] || 0) + info.elapsed
        s.hintsUsed = (s.hintsUsed || 0) + (NONOGRAM.HINT_LIMIT - info.hintsLeft)
        s.updatedAt = Date.now()
        s._dirty = true
        flushStats()

        // 清掉已完成的进度
        try { localStorage.removeItem(PROGRESS_KEY) } catch { /* ignore */ }
        setSavedProgress(null)

        // 番茄钟 session：对局 ≥120s 才计入
        const durSec = Math.round(info.elapsed)
        if (gameStartRef.current && durSec >= 120) {
          appendPomodoroSession(gameStartRef.current, Date.now(), info.level)
        }

        setLiveAnnounce('恭喜完成数织！')
        setScreen('over')
      },
    })
    engineRef.current = engine
    snapshotRef.current = engine.getSnapshot()

    const tickTimer = setInterval(() => {
      if (engineRef.current && engineRef.current.state === 'playing') engineRef.current.tick()
    }, 500)

    // 进度定期落盘（每 2s，避免每次点击写 storage）
    const progressTimer = setInterval(saveProgress, 2000)
    progressTimerRef.current = progressTimer

    return () => {
      clearInterval(tickTimer)
      clearInterval(progressTimer)
      engine.dispose()
      engineRef.current = null
      flushStats()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== 约束卡③：自动暂停 =====
  useEffect(() => {
    const pauseIfPlaying = () => {
      const e = engineRef.current
      if (e && e.state === 'playing') {
        setPausedAuto(true)
        e.pause()
        saveProgress()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== 落盘兜底 =====
  useEffect(() => {
    const flush = () => { flushStats(); saveProgress() }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== 键盘 =====
  useEffect(() => {
    const onKey = (ev) => {
      const e = engineRef.current
      const snap = snapshotRef.current
      if (!e || !snap) return

      if (ev.key === 'Escape') {
        if (e.state === 'playing') { e.pause() }
        else if (e.state === 'paused') { e.resume(); setPausedAuto(false) }
        ev.preventDefault()
        return
      }
      if (e.state !== 'playing') return

      const key = ev.key.toLowerCase()
      if (key === 'z') { e.undo(); ev.preventDefault(); return }
      if (key === 'h') { doHint(); ev.preventDefault(); return }
      if (key === 'r') { handleStart(level); ev.preventDefault(); return }

      const { rows, cols } = snap
      let r = Math.floor(focusIdxRef.current / cols)
      let c = focusIdxRef.current % cols
      let moved = false
      if (ev.key === 'ArrowUp' && r > 0) { r -= 1; moved = true }
      else if (ev.key === 'ArrowDown' && r < rows - 1) { r += 1; moved = true }
      else if (ev.key === 'ArrowLeft' && c > 0) { c -= 1; moved = true }
      else if (ev.key === 'ArrowRight' && c < cols - 1) { c += 1; moved = true }
      if (moved) {
        const nidx = r * cols + c
        focusIdxRef.current = nidx
        setFocusedIdx(nidx)
        announceCell(nidx)
        ev.preventDefault()
        return
      }

      if (ev.key === 'Enter' || ev.key === ' ') {
        applyCycle(focusIdxRef.current)
        ev.preventDefault()
      } else if (key === 'x') {
        const cur = snap.grid[focusIdxRef.current]
        e.setCell(focusIdxRef.current, cur === CELL.MARKED ? CELL.EMPTY : CELL.MARKED)
        announceCell(focusIdxRef.current)
        ev.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level])

  // ===== 操作 =====
  function announceCell(idx) {
    const snap = snapshotRef.current
    if (!snap) return
    const r = Math.floor(idx / snap.cols) + 1
    const c = (idx % snap.cols) + 1
    const v = snap.grid[idx]
    const stateText = v === CELL.FILLED ? '已填充' : v === CELL.MARKED ? '已标记空格' : '空'
    const rowClue = snap.rowClues[r - 1]?.join(' ') || '0'
    const colClue = snap.colClues[c - 1]?.join(' ') || '0'
    setLiveAnnounce(`第 ${r} 行第 ${c} 列，${stateText}。行提示 ${rowClue}，列提示 ${colClue}`)
  }

  function applyCycle(idx) {
    const e = engineRef.current
    if (!e || e.state !== 'playing') return
    e.cycle(idx)
    focusIdxRef.current = idx
    setFocusedIdx(idx)
    announceCell(idx)
    saveProgress()
  }

  function handleStart(lv) {
    const useLevel = lv || level
    setLevel(useLevel)
    gameStartRef.current = Date.now()
    pauseStartRef.current = 0
    focusIdxRef.current = 0
    setFocusedIdx(0)
    setPausedAuto(false)
    setNewRecord(false)
    setLiveAnnounce('')
    const prog = savedProgress && savedProgress.level === useLevel ? savedProgress : null
    engineRef.current.start(useLevel, prog)
    setScreen('playing')
  }

  function handleResumeProgress() {
    if (!savedProgress) return
    setLevel(savedProgress.level)
    gameStartRef.current = Date.now()
    focusIdxRef.current = 0
    setFocusedIdx(0)
    setPausedAuto(false)
    engineRef.current.start(savedProgress.level, savedProgress)
    setScreen('playing')
  }

  function doHint() {
    const e = engineRef.current
    if (!e || e.state !== 'playing') return
    if (e.hintsLeft <= 0) { setLiveAnnounce('提示次数已用完'); return }
    e.hint()
    setLiveAnnounce(`已使用提示，剩余 ${engineRef.current.hintsLeft} 次`)
  }

  function handleUndo() {
    engineRef.current?.undo()
    saveProgress()
  }

  function handleClear() {
    const e = engineRef.current
    if (!e || e.state !== 'playing') return
    if (e.moves === 0) return
    e.clearAll()
    saveProgress()
    setLiveAnnounce('已清空所有标记')
  }

  function handlePause() {
    const e = engineRef.current
    if (!e) return
    e.pause()
    setPausedAuto(false)
    saveProgress()
  }

  function handleResume() {
    engineRef.current?.resume()
    setPausedAuto(false)
  }

  // ===== 渲染 =====
  const snap = snapshot

  return (
    <div className="nono-page">
      <nav className="nono-nav">
        <Link to="/" className="nono-nav-back">← 返回首页</Link>
        <h1 className="nono-nav-title">数织 · Nonogram</h1>
        <div className="nono-nav-spacer" />
      </nav>

      {/* ===== 开始屏 ===== */}
      {screen === 'start' && (
        <div className="nono-screen">
          <div className="nono-card">
            <h2 className="nono-title">数织</h2>
            <p className="nono-desc">
              根据每行每列的数字提示，推理出哪些格子应该涂黑。数字表示<strong>连续填充块的长度</strong>，
              相邻块之间至少空一格。用<strong>填格</strong>与<strong>叉格</strong>标记，全部满足提示即通关。
            </p>

            {savedProgress && (
              <div className="nono-resume">
                <div className="nono-resume-text">
                  <strong>发现未完成的对局</strong>
                  <span>{LEVELS[savedProgress.level]?.label || savedProgress.level} · 已用时 {fmtTime(savedProgress.elapsed)}</span>
                </div>
                <div className="nono-resume-actions">
                  <button className="nono-btn nono-btn-primary" onClick={handleResumeProgress}>继续</button>
                  <button
                    className="nono-btn"
                    onClick={() => {
                      try { localStorage.removeItem(PROGRESS_KEY) } catch { /* ignore */ }
                      setSavedProgress(null)
                    }}
                  >
                    放弃
                  </button>
                </div>
              </div>
            )}

            <div className="nono-levels">
              {LEVEL_KEYS.map((lv) => (
                <button
                  key={lv}
                  className={`nono-level-btn ${level === lv ? 'active' : ''}`}
                  onClick={() => setLevel(lv)}
                >
                  <span className="nono-level-label">{LEVELS[lv].label}</span>
                  <span className="nono-level-sub">
                    {best[lv] ? `最佳 ${fmtTime(best[lv].elapsed)}` : '暂无记录'}
                  </span>
                </button>
              ))}
            </div>

            <button className="nono-start-btn" onClick={() => handleStart()}>开始游戏</button>

            <div className="nono-rules">
              <h3>操作方式</h3>
              <ul>
                <li>点击格子：空 → 填 → 叉 → 空 循环</li>
                <li>方向键移动 · Enter/空格 填 · X 标叉 · Z 撤销 · H 提示 · Esc 暂停</li>
                <li>每局 3 次提示，可在右侧提示按钮使用</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ===== 游戏主界面 ===== */}
      {snap && screen !== 'start' && (
        <div className="nono-main">
          <div className="nono-hud">
            <div className="nono-hud-left">
              <span className="nono-timer">⏱ {fmtTime(snap.elapsed)}</span>
              <span className="nono-progress-text">剩余 {snap.remaining} 格</span>
            </div>
            <div className="nono-hud-right">
              <span className="nono-level-tag">{LEVELS[snap.level].label}</span>
              <button className="nono-btn" onClick={handleUndo} disabled={snap.moves === 0}>撤销</button>
              <button className="nono-btn" onClick={doHint} disabled={snap.hintsLeft <= 0}>提示 {snap.hintsLeft}</button>
              <button className="nono-btn" onClick={handleClear} disabled={snap.moves === 0}>清空</button>
              {screen === 'playing' && <button className="nono-btn" onClick={handlePause}>暂停</button>}
              {screen === 'paused' && <button className="nono-btn nono-btn-primary" onClick={handleResume}>继续</button>}
              <button className="nono-btn" onClick={() => handleStart(level)}>重开</button>
            </div>
          </div>

          <div className="nono-board-wrap">
            <div
              className="nono-board"
              role="grid"
              aria-label={`数织棋盘 ${snap.rows} 行 ${snap.cols} 列`}
              style={{
                '--nono-cols': snap.cols,
                '--nono-rows': snap.rows,
              }}
            >
              {/* 左上角空位 */}
              <div className="nono-corner" aria-hidden="true" />

              {/* 顶部列提示 */}
              {snap.colClues.map((clue, c) => (
                <div
                  key={`cc-${c}`}
                  className={`nono-clue nono-clue-col ${(c + 1) % 5 === 0 && c !== snap.cols - 1 ? 'group-edge' : ''}`}
                  aria-hidden="true"
                >
                  {clue.map((n, i) => <span key={i}>{n}</span>)}
                </div>
              ))}

              {/* 逐行：行提示 + 格子 */}
              {Array.from({ length: snap.rows }).map((_, r) => (
                <Fragment key={`r-${r}`}>
                  <div
                    className={`nono-clue nono-clue-row ${(r + 1) % 5 === 0 && r !== snap.rows - 1 ? 'group-edge' : ''}`}
                    aria-hidden="true"
                  >
                    {snap.rowClues[r].map((n, i) => <span key={i}>{n}</span>)}
                  </div>
                  {Array.from({ length: snap.cols }).map((_, c) => {
                    const idx = r * snap.cols + c
                    const v = snap.grid[idx]
                    const isFocused = focusedIdx === idx
                    return (
                      <div
                        key={idx}
                        role="gridcell"
                        className={`nono-cell ${v === CELL.FILLED ? 'filled' : ''} ${v === CELL.MARKED ? 'marked' : ''} ${isFocused ? 'focused' : ''} ${(c + 1) % 5 === 0 && c !== snap.cols - 1 ? 'group-edge-x' : ''} ${(r + 1) % 5 === 0 && r !== snap.rows - 1 ? 'group-edge-y' : ''}`}
                        aria-label={cellLabel(snap, idx)}
                        aria-selected={v === CELL.FILLED}
                        tabIndex={isFocused ? 0 : -1}
                        data-idx={idx}
                        onClick={() => applyCycle(idx)}
                        onFocus={() => { focusIdxRef.current = idx; setFocusedIdx(idx) }}
                      >
                        <span className="nono-cell-inner" aria-hidden="true" />
                      </div>
                    )
                  })}
                </Fragment>
              ))}
            </div>
          </div>

          <div className="nono-hint-bar">
            👆 点击/: 填格 · 右键或 X 标叉 · 方向键移动 · Z 撤销 · H 提示 · Esc 暂停
          </div>

          {/* 暂停遮罩 */}
          {screen === 'paused' && (
            <div className="nono-overlay">
              <div className="nono-overlay-card">
                <h3>⏸ 游戏暂停</h3>
                {pausedAuto && <p className="nono-paused-reason">已自动暂停（页面隐藏或窗口失焦）</p>}
                <div className="nono-overlay-actions">
                  <button className="nono-btn nono-btn-primary big" onClick={handleResume}>继续游戏</button>
                  <button className="nono-btn" onClick={() => handleStart(level)}>重新开始</button>
                  <button className="nono-btn" onClick={() => setScreen('start')}>返回菜单</button>
                </div>
              </div>
            </div>
          )}

          {/* 结束遮罩 */}
          {screen === 'over' && (
            <div className="nono-overlay">
              <div className="nono-overlay-card nono-overlay-win">
                <h3>🎉 通关成功！</h3>
                <div className="nono-win-stats">
                  <div className="nono-win-big">{fmtTime(finalElapsed)}</div>
                  <div className="nono-win-sub">{LEVELS[finalLevel].label} · {finalMoves} 步</div>
                </div>
                {newRecord && <p className="nono-record">🏆 新的最佳记录！</p>}
                <div className="nono-overlay-actions">
                  <button className="nono-btn nono-btn-primary big" onClick={() => handleStart(level)}>再来一局</button>
                  <button className="nono-btn" onClick={() => setScreen('start')}>返回菜单</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div aria-live="polite" aria-atomic="true" className="nono-sr-only">{liveAnnounce}</div>
    </div>
  )
}

function cellLabel(snap, idx) {
  const r = Math.floor(idx / snap.cols) + 1
  const c = (idx % snap.cols) + 1
  const v = snap.grid[idx]
  const stateText = v === CELL.FILLED ? '已填充' : v === CELL.MARKED ? '已标叉' : '空格'
  return `第 ${r} 行第 ${c} 列，${stateText}`
}
