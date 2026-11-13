import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PipeEngine, DIFFICULTY, PIPE } from '../game/PipeEngine'
import './Pipe.css'

const BEST_KEY = 'game-pipe-best-v1'
const STATS_KEY = 'game-pipe-stats-v1'
const POMODORO_KEY = 'pomodoro-sessions-v1'
const LEVELS = ['easy', 'normal', 'hard']

function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return {}
    const out = {}
    for (const k of LEVELS) {
      const r = data[k]
      if (r && Number.isFinite(r.score)) out[k] = { score: r.score, clicks: r.clicks || 0, time: r.time || 0 }
    }
    return out
  } catch { return {} }
}

function loadStats() {
  const empty = { plays: {}, wins: {}, clicks: 0, timeByLevel: {}, updatedAt: 0 }
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

function appendPomodoroSession(startTs, endTs, game, win, level) {
  try {
    const raw = localStorage.getItem(POMODORO_KEY)
    const sessions = raw ? JSON.parse(raw) : []
    if (!Array.isArray(sessions)) return
    sessions.push({ startTs, endTs, durSec: Math.round((endTs - startTs) / 1000), game, win, level })
    // 只保留最近 14 天
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000
    const trimmed = sessions.filter(s => s.endTs >= cutoff)
    localStorage.setItem(POMODORO_KEY, JSON.stringify(trimmed))
  } catch { /* ignore */ }
}

function _fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function _flushStats(statsRef) {
  if (!statsRef.current || !statsRef.current._dirty) return
  statsRef.current._dirty = false
  try { localStorage.setItem(STATS_KEY, JSON.stringify(statsRef.current)) } catch {}
}

/**
 * 接水管页面壳 —— 旋转管件连通源点到终点。
 * 架构对齐 LightsOut / Gomoku：
 *   六屏状态机 start / playing / paused / over(win|timeout)
 *   visibilitychange + blur 双路去重自动暂停
 *   role=grid + roving tabindex + aria-live
 *   键盘：方向键移动 + Enter/Space 旋转 + Z 撤销 + Esc 暂停 + R 重开
 *   番茄钟 session 联动（对局 ≥ 120s 自动追加）
 */
export default function PipePage() {
  const engineRef = useRef(null)
  const snapshotRef = useRef(null)
  const statsRef = useRef(null)
  const pauseStartRef = useRef(0)
  const gameStartRef = useRef(0)
  const autoPauseRef = useRef(false)
  const focusIdxRef = useRef(0)

  const [screen, setScreen] = useState('start')
  const [level, setLevel] = useState('easy')
  const [snapshot, setSnapshot] = useState(null)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [best, setBest] = useState(loadBest)

  const [finalScore, setFinalScore] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState(0)
  const [finalClicks, setFinalClicks] = useState(0)
  const [finalLevel, setFinalLevel] = useState('easy')
  const [finalResult, setFinalResult] = useState('win')

  // 初始化 statsRef
  if (statsRef.current === null) statsRef.current = loadStats()

  // ===== 引擎创建 =====
  useEffect(() => {
    const engine = new PipeEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state === 'playing') setScreen('playing')
        else if (snap.state === 'paused') setScreen('paused')
      },
      onPause: () => {
        pauseStartRef.current = Date.now()
      },
      onGameOver: (info) => {
        const snap = engineRef.current.getSnapshot()
        setFinalScore(info.score)
        setFinalElapsed(info.elapsed)
        setFinalClicks(snap.clicks)
        setFinalLevel(snap.level)
        setFinalResult(info.result)

        // 埋点
        const s = statsRef.current
        s.plays[snap.level] = (s.plays[snap.level] || 0) + 1
        if (info.result === 'win') s.wins[snap.level] = (s.wins[snap.level] || 0) + 1
        s.clicks += snap.clicks
        s.timeByLevel[snap.level] = (s.timeByLevel[snap.level] || 0) + info.elapsed
        s.updatedAt = Date.now()
        s._dirty = true
        _flushStats(s)

        // 最佳（仅胜局）
        if (info.result === 'win') {
          const prev = best[snap.level]
          if (!prev || info.score > prev.score || (info.score === prev.score && info.elapsed < prev.time)) {
            const newBest = { ...best, [snap.level]: { score: info.score, clicks: snap.clicks, time: info.elapsed } }
            setBest(newBest)
            try { localStorage.setItem(BEST_KEY, JSON.stringify(newBest)) } catch {}
          }
        }

        // 番茄钟 session：时长 ≥ 120s 才追加
        const durSec = Math.round(info.elapsed)
        const actualEndTs = pauseStartRef.current || Date.now()
        const sessionStart = gameStartRef.current
        if (sessionStart && durSec >= 120) {
          appendPomodoroSession(sessionStart, actualEndTs, 'pipe', info.result === 'win', snap.level)
        }

        setScreen('over')
      },
    })
    engineRef.current = engine
    snapshotRef.current = engine.getSnapshot()

    // tick 定时器
    const tickTimer = setInterval(() => {
      if (engineRef.current && engineRef.current.state === 'playing') {
        engineRef.current.tick()
      }
    }, PIPE.TICK_MS)

    return () => {
      clearInterval(tickTimer)
      engine.dispose()
      engineRef.current = null
      _flushStats(statsRef.current)
    }
  }, [])

  // ===== 自动暂停：visibilitychange + blur =====
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        const e = engineRef.current
        if (e && e.state === 'playing') {
          autoPauseRef.current = true
          setPausedAuto(true)
          e.pause()
        }
      }
    }
    const onBlur = () => {
      const e = engineRef.current
      if (e && e.state === 'playing') {
        autoPauseRef.current = true
        setPausedAuto(true)
        e.pause()
      }
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // ===== 脏标记延迟持久化：pagehide/beforeunload =====
  useEffect(() => {
    const flush = () => _flushStats(statsRef.current)
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    // 兜底：每 15s flush
    const t = setInterval(flush, 15000)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      clearInterval(t)
      _flushStats(statsRef.current)
    }
  }, [])

  // ===== 键盘事件 =====
  useEffect(() => {
    const onKey = (ev) => {
      if (!engineRef.current) return
      const e = engineRef.current
      if (e.state !== 'playing' && e.state !== 'paused') return

      const snap = snapshotRef.current
      if (!snap) return
      const { rows, cols } = snap

      if (ev.key === 'Escape') {
        if (e.state === 'playing') { e.pause(); setScreen('paused') }
        else if (e.state === 'paused') { e.resume(); setScreen('playing'); setPausedAuto(false) }
        ev.preventDefault()
        return
      }
      if (ev.key.toLowerCase() === 'z' && e.state === 'playing') {
        e.undo()
        ev.preventDefault()
        return
      }
      if (ev.key.toLowerCase() === 'r' && e.state === 'playing') {
        handleStart()
        ev.preventDefault()
        return
      }
      if (e.state !== 'playing') return

      // 方向键移动焦点
      let nr = Math.floor(focusedIdxRef.current / cols)
      let nc = focusedIdxRef.current % cols
      let moved = false
      if (ev.key === 'ArrowUp' && nr > 0) { nr -= 1; moved = true }
      else if (ev.key === 'ArrowDown' && nr < rows - 1) { nr += 1; moved = true }
      else if (ev.key === 'ArrowLeft' && nc > 0) { nc -= 1; moved = true }
      else if (ev.key === 'ArrowRight' && nc < cols - 1) { nc += 1; moved = true }

      if (moved) {
        const nidx = nr * cols + nc
        focusedIdxRef.current = nidx
        setFocusedIdx(nidx)
        ev.preventDefault()
      }

      if ((ev.key === 'Enter' || ev.key === ' ') && e.state === 'playing') {
        e.rotate(focusedIdxRef.current)
        ev.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ===== 操作函数 =====
  function handleStart(lvl) {
    const useLevel = lvl || level
    setLevel(useLevel)
    pauseStartRef.current = 0
    gameStartRef.current = Date.now()
    focusIdxRef.current = 0
    setFocusedIdx(0)
    setPausedAuto(false)
    setLiveAnnounce('')
    engineRef.current.start(useLevel)
    setScreen('playing')
    // 设置焦点到第一格（DOM 渲染后）
    setTimeout(() => {
      const el = document.querySelector('.pipe-cell[data-idx="0"]')
      el?.focus()
    }, 50)
  }

  function handleCellClick(idx) {
    if (!engineRef.current || engineRef.current.state !== 'playing') return
    engineRef.current.rotate(idx)
    focusedIdxRef.current = idx
    setFocusedIdx(idx)
  }

  function handleUndo() {
    if (!engineRef.current) return
    engineRef.current.undo()
  }

  function handlePause() {
    if (!engineRef.current) return
    engineRef.current.pause()
    setPausedAuto(false)
    setScreen('paused')
  }

  function handleResume() {
    if (!engineRef.current) return
    engineRef.current.resume()
    setPausedAuto(false)
    setScreen('playing')
  }

  // ===== 渲染 =====
  const snap = snapshot

  return (
    <div className="pipe-page">
      <nav className="pipe-nav">
        <Link to="/" className="pipe-nav-back">← 返回首页</Link>
        <h1 className="pipe-nav-title">接水管 · Pipe Connect</h1>
        <div className="pipe-nav-spacer" />
      </nav>

      {/* ========= 开始屏 ========= */}
      {screen === 'start' && (
        <div className="pipe-screen pipe-screen-start">
          <div className="pipe-card">
            <h2 className="pipe-title">接水管</h2>
            <p className="pipe-desc">
              旋转每段管子，把左上角的<strong>源点</strong>连通到右下角的<strong>终点</strong>。
              连通后水流会从蓝色源点流向橙色终点，点亮整条管道。
            </p>
            <div className="pipe-levels">
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  className={`pipe-level-btn ${level === lv ? 'active' : ''}`}
                  onClick={() => setLevel(lv)}
                >
                  <div className="pipe-level-label">{DIFFICULTY[lv].label}</div>
                  <div className="pipe-level-sub">{DIFFICULTY[lv].rows}×{DIFFICULTY[lv].cols} · {DIFFICULTY[lv].limitSec}s</div>
                </button>
              ))}
            </div>
            <button className="pipe-start-btn" onClick={() => handleStart()}>开始游戏</button>

            <div className="pipe-best-section">
              <h3>最佳记录</h3>
              {LEVELS.every(lv => !best[lv]) ? (
                <p className="pipe-best-empty">暂无记录，快来挑战吧！</p>
              ) : (
                <div className="pipe-best-grid">
                  {LEVELS.map(lv => best[lv] && (
                    <div key={lv} className="pipe-best-item">
                      <div className="pipe-best-lv">{DIFFICULTY[lv].label}</div>
                      <div className="pipe-best-score">{best[lv].score} 分</div>
                      <div className="pipe-best-sub">
                        {best[lv].clicks} 转 · {_fmtTime(best[lv].time)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========= 游戏中 / 暂停 / 结束 ========= */}
      {snap && screen !== 'start' && (
        <div className="pipe-main">
          {/* HUD */}
          <div className="pipe-hud">
            <div className="pipe-hud-left">
              <span className={`pipe-time ${snap.remaining <= 10 ? 'danger' : ''}`}>
                ⏱ {_fmtTime(snap.remaining)}
              </span>
              <span className="pipe-clicks">🔧 {snap.clicks} 转</span>
            </div>
            <div className="pipe-hud-center">
              <span className="pipe-level-tag">{DIFFICULTY[snap.level].label}</span>
            </div>
            <div className="pipe-hud-right">
              {screen === 'playing' && (
                <button className="pipe-btn" onClick={handlePause} title="暂停 (Esc)">暂停</button>
              )}
              {screen === 'paused' && (
                <button className="pipe-btn pipe-btn-primary" onClick={handleResume}>
                  {pausedAuto ? '继续' : '继续'}
                </button>
              )}
              <button className="pipe-btn" onClick={handleUndo} disabled={snap.undoLeft <= 0}>
                撤销 ({snap.undoLeft})
              </button>
              <button className="pipe-btn" onClick={() => handleStart()}>重新开始</button>
            </div>
          </div>

          {/* 棋盘 */}
          <div className="pipe-board-wrap">
            <div
              className="pipe-board"
              role="grid"
              aria-label={`接水管棋盘 ${snap.rows} 行 ${snap.cols} 列`}
              style={{
                gridTemplateColumns: `repeat(${snap.cols}, 1fr)`,
                gridTemplateRows: `repeat(${snap.rows}, 1fr)`,
              }}
            >
              {snap.grid.map((cell) => (
                <div
                  key={cell.idx}
                  className={`pipe-cell
                    pipe-${cell.type.toLowerCase()}
                    ${cell.connected ? 'connected' : ''}
                    ${focusedIdx === cell.idx ? 'focused' : ''}`}
                  role="gridcell"
                  tabIndex={focusedIdx === cell.idx ? 0 : -1}
                  aria-label={_cellAria(cell, snap)}
                  data-idx={cell.idx}
                  onClick={() => handleCellClick(cell.idx)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleCellClick(cell.idx)
                    }
                  }}
                >
                  <PipeGlyph cell={cell} />
                </div>
              ))}
            </div>
          </div>

          {/* 操作提示 */}
          <div className="pipe-hint">
            👆 点按或方向键移动 · Enter/Space 旋转 · Z 撤销 · Esc 暂停
          </div>

          {/* 暂停遮罩 */}
          {screen === 'paused' && (
            <div className="pipe-overlay">
              <div className="pipe-overlay-card">
                <h3>⏸ 游戏暂停</h3>
                {pausedAuto && <p className="pipe-paused-reason">已自动暂停（页面隐藏或窗口失焦）</p>}
                <button className="pipe-btn pipe-btn-primary big" onClick={handleResume}>
                  继续游戏
                </button>
                <button className="pipe-btn" onClick={() => handleStart()}>重新开始</button>
                <button className="pipe-btn" onClick={() => { setScreen('start') }}>返回菜单</button>
              </div>
            </div>
          )}

          {/* 结束遮罩 */}
          {screen === 'over' && (
            <div className="pipe-overlay">
              <div className="pipe-overlay-card pipe-overlay-over">
                {finalResult === 'win' ? (
                  <>
                    <h3>🎉 通关成功！</h3>
                    <div className="pipe-overlay-stats">
                      <div className="pipe-overlay-big">{finalScore} <span className="pipe-overlay-unit">分</span></div>
                      <div className="pipe-overlay-sub">
                        {DIFFICULTY[finalLevel].label} · {finalClicks} 转 · {_fmtTime(finalElapsed)}
                      </div>
                    </div>
                    {best[finalLevel]?.score === finalScore && (
                      <p className="pipe-new-record">🏆 新的最佳记录！</p>
                    )}
                  </>
                ) : (
                  <>
                    <h3>⏰ 时间到</h3>
                    <p>别灰心，再来一次试试！</p>
                  </>
                )}
                <button className="pipe-btn pipe-btn-primary big" onClick={() => handleStart()}>再来一局</button>
                <button className="pipe-btn" onClick={() => setScreen('start')}>返回菜单</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* aria-live 播报区 */}
      <div aria-live="polite" aria-atomic="true" className="pipe-sr-only">
        {liveAnnounce}
      </div>
    </div>
  )
}

/** 渲染管道 SVG 图形 —— 根据 cell.mask 绘制四向开口 */
function PipeGlyph({ cell }) {
  const { type, mask, connected } = cell
  if (type === 'EMPTY') return null

  const stroke = type === 'SOURCE' ? '#3b82f6'
    : type === 'TARGET' ? '#f97316'
    : connected ? '#06b6d4'
    : '#a0a0a0'

  const strokeWidth = type === 'SOURCE' || type === 'TARGET' ? 10 : 8

  // 4 开口：N(1), E(2), S(4), W(8)
  // 画在 100×100 viewBox 上，中心 (50, 50)
  // 每个方向从中心延伸到边缘中点
  const N = mask & 1
  const E = mask & 2
  const S = mask & 4
  const W = mask & 8

  return (
    <svg viewBox="0 0 100 100" className={`pipe-svg ${connected ? 'flow' : ''}`}>
      {N && <line x1="50" y1="50" x2="50" y2="0" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />}
      {S && <line x1="50" y1="50" x2="50" y2="100" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />}
      {E && <line x1="50" y1="50" x2="100" y2="50" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />}
      {W && <line x1="50" y1="50" x2="0" y2="50" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />}
      {/* 中心圆点 */}
      {type === 'SOURCE' && <circle cx="50" cy="50" r="14" fill="#3b82f6" />}
      {type === 'TARGET' && <circle cx="50" cy="50" r="14" fill="#f97316" />}
      {(type === 'SOURCE' || type === 'TARGET') && (
        <circle cx="50" cy="50" r="6" fill="white" />
      )}
    </svg>
  )
}

function _cellAria(cell, snap) {
  const { type, connected } = cell
  const r = Math.floor(cell.idx / snap.cols) + 1
  const c = (cell.idx % snap.cols) + 1
  const pos = `第 ${r} 行第 ${c} 列`
  if (type === 'EMPTY') return `${pos}，空地`
  if (type === 'SOURCE') return `${pos}，源点`
  if (type === 'TARGET') return `${pos}，终点`
  if (type === 'STRAIGHT') return `${pos}，直管${connected ? '，已连通' : ''}`
  if (type === 'CURVE') return `${pos}，弯管${connected ? '，已连通' : ''}`
  if (type === 'TEE') return `${pos}，三通${connected ? '，已连通' : ''}`
  if (type === 'CROSS') return `${pos}，十字${connected ? '，已连通' : ''}`
  return pos
}
