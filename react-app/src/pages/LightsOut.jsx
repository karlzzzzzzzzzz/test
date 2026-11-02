import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LightsOutEngine, DIFFICULTY, LIGHTS_OUT } from '../game/LightsOutEngine'
import './LightsOut.css'

const BEST_KEY = 'game-lightsout-best-v1'
const STATS_KEY = 'game-lightsout-stats-v1'
const LEVELS = ['easy', 'normal', 'hard']

/** 读取历史最佳（损坏/不可用时降级为空对象） */
function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return {}
    const out = {}
    for (const k of LEVELS) {
      const r = data[k]
      if (r && Number.isFinite(r.score)) out[k] = { score: r.score, steps: r.steps || 0, time: r.time || 0 }
    }
    return out
  } catch {
    return {}
  }
}

/** 读取累计埋点（结构损坏时回退空结构） */
function loadStats() {
  const empty = { plays: {}, wins: {}, steps: 0, timeByLevel: {}, updatedAt: 0 }
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return empty
    return {
      ...empty,
      ...data,
      plays: { ...(data.plays || {}) },
      wins: { ...(data.wins || {}) },
      timeByLevel: { ...(data.timeByLevel || {}) },
    }
  } catch {
    return empty
  }
}

function _fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/**
 * 关灯挑战页面壳
 * 架构对齐 Memory.jsx：四态 UI + 引擎回调 + visibility/blur 双路去重暂停；
 * 无障碍：role=grid + roving tabindex + aria-live 播报；触控为原生 button 点按。
 */
function LightsOutPage() {
  const engineRef = useRef(null)
  const snapshotRef = useRef(null)
  const stateRef = useRef('start')
  const pausedByVisibilityRef = useRef(false)
  const autoPauseRef = useRef(false)
  const announceKeyRef = useRef('')
  const statsRef = useRef(null)
  const dirtyRef = useRef(false)
  const writeTimerRef = useRef(null)
  if (statsRef.current === null) statsRef.current = loadStats()

  const [screen, setScreen] = useState('start')
  const [snapshot, setSnapshot] = useState(null)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [best, setBest] = useState(loadBest)
  const [saveError, setSaveError] = useState(false)

  const [finalScore, setFinalScore] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState(0)
  const [finalSteps, setFinalSteps] = useState(0)
  const [finalLevel, setFinalLevel] = useState('easy')

  const changeScreen = (s) => {
    stateRef.current = s
    setScreen(s)
  }

  // ---------- 埋点：脏标记 + 1s 兜底 + pagehide 落盘 ----------
  const flushStats = () => {
    if (!dirtyRef.current || !statsRef.current) return
    try {
      statsRef.current.updatedAt = Date.now()
      localStorage.setItem(STATS_KEY, JSON.stringify(statsRef.current))
    } catch {
      // 配额满/不可用：仅内存累计，不阻断游戏
    } finally {
      dirtyRef.current = false
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current)
        writeTimerRef.current = null
      }
    }
  }

  const scheduleFlush = () => {
    dirtyRef.current = true
    if (!writeTimerRef.current) writeTimerRef.current = setTimeout(flushStats, 1000)
  }

  const bumpStats = (fn) => {
    fn(statsRef.current)
    scheduleFlush()
  }

  // ---------- 引擎生命周期 ----------
  useEffect(() => {
    const engine = new LightsOutEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state !== stateRef.current) changeScreen(snap.state)

        // aria-live：同一动作只播报一次（tick 每 200ms 复用同一 lastAction）
        const key = `${snap.lastAction}:${snap.steps}:${snap.undoLeft}:${snap.remainingLights}`
        if (key !== announceKeyRef.current) {
          announceKeyRef.current = key
          if (snap.lastAction === 'toggle') setLiveAnnounce(`剩余 ${snap.remainingLights} 盏灯`)
          else if (snap.lastAction === 'undo') setLiveAnnounce(`已撤销，剩余 ${snap.remainingLights} 盏灯`)
          else if (snap.lastAction === 'win') setLiveAnnounce('全部熄灭，挑战成功')
          else if (snap.lastAction === 'timeout') setLiveAnnounce('时间到，挑战失败')
        }
      },
      onGameOver: (score, elapsed, result) => {
        const snap = snapshotRef.current
        const level = snap?.level || 'easy'
        setFinalLevel(level)
        setFinalElapsed(elapsed)
        setFinalSteps(snap?.steps || 0)
        setFinalScore(score)

        if (result === 'win') bumpStats((s) => {
          s.wins[level] = (s.wins[level] || 0) + 1
          s.steps += snap?.steps || 0
          s.timeByLevel[level] = Math.round(((s.timeByLevel[level] || 0) + elapsed) * 10) / 10
        })

        if (result === 'win') {
          // 仅在分数更高时覆盖最佳记录；读取/写入失败降级为仅内存展示
          const current = loadBest()
          const cur = current[level]
          if (!cur || cur.score < score) {
            const next = {
              ...current,
              [level]: { score, steps: snap?.steps || 0, time: Math.round(elapsed * 10) / 10 },
            }
            try {
              localStorage.setItem(BEST_KEY, JSON.stringify(next))
              setSaveError(false)
            } catch {
              setSaveError(true)
            }
            setBest(next)
          } else {
            setBest(current)
          }
        }
        changeScreen(result === 'win' ? 'over' : 'failed')
        setTimeout(() => {
          document.querySelector('.lo-overlay-card .lo-btn-primary')?.focus()
        }, 0)
      },
      onPause: () => {
        setPausedAuto(autoPauseRef.current)
        if (stateRef.current === 'playing') changeScreen('paused')
      },
    })
    engineRef.current = engine
    return () => engine.dispose()
  }, [])

  // ---------- 倒计时驱动 ----------
  useEffect(() => {
    if (screen !== 'playing') return
    const timer = setInterval(() => engineRef.current?.tick(), LIGHTS_OUT.TICK_MS)
    return () => clearInterval(timer)
  }, [screen])

  // ---------- 切后台/失焦双路去重暂停 ----------
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        pausedByVisibilityRef.current = true
        autoPauseRef.current = true
        engineRef.current?.pause()
      }
    }
    const onBlur = () => {
      if (pausedByVisibilityRef.current) {
        pausedByVisibilityRef.current = false
        return
      }
      autoPauseRef.current = true
      engineRef.current?.pause()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // ---------- 埋点落盘生命周期 ----------
  useEffect(() => {
    window.addEventListener('pagehide', flushStats)
    const onHidden = () => { if (document.hidden) flushStats() }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      flushStats()
      window.removeEventListener('pagehide', flushStats)
      document.removeEventListener('visibilitychange', onHidden)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 开局 ----------
  const handleStart = (level) => {
    engineRef.current?.start(level)
    bumpStats((s) => { s.plays[level] = (s.plays[level] || 0) + 1 })
    announceKeyRef.current = ''
    changeScreen('playing')
    setFocusedIdx(0)
    setPausedAuto(false)
    setTimeout(() => document.querySelector('.lo-board .lo-tile')?.focus(), 0)
  }

  const handlePause = () => {
    autoPauseRef.current = false
    engineRef.current?.pause()
  }

  const handleResume = () => {
    autoPauseRef.current = false
    engineRef.current?.resume()
    changeScreen('playing')
    setTimeout(() => document.querySelector('.lo-board .lo-tile')?.focus(), 0)
  }

  const handleToggle = (idx) => {
    if (engineRef.current?.toggle(idx)) setFocusedIdx(idx)
  }

  const handleUndo = () => {
    engineRef.current?.undo()
  }

  // ---------- 键盘：方向键移动 + Enter/Space 翻转 ----------
  const handleBoardKeyDown = (e) => {
    const snap = snapshotRef.current
    if (!snap || snap.state !== 'playing') return
    const { rows, cols } = snap
    const r = Math.floor(focusedIdx / cols)
    const c = focusedIdx % cols
    let nr = r
    let nc = c
    const key = e.key

    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End') {
      e.preventDefault()
      if (key === 'ArrowUp') nr = Math.max(0, r - 1)
      else if (key === 'ArrowDown') nr = Math.min(rows - 1, r + 1)
      else if (key === 'ArrowLeft') nc = Math.max(0, c - 1)
      else if (key === 'ArrowRight') nc = Math.min(cols - 1, c + 1)
      else if (key === 'Home') nc = 0
      else if (key === 'End') nc = cols - 1
      setFocusedIdx(nr * cols + nc)
      return
    }

    if (key === 'Enter' || key === ' ') {
      // 焦点在棋盘容器本身（-1）时不拦截页面滚动/按钮原生行为
      if (e.target !== e.currentTarget) return
      e.preventDefault()
      handleToggle(focusedIdx)
    }
  }

  const bestOfLevel = (level) => best[level]?.score

  return (
    <div className="lo-page" role="application" aria-label="关灯挑战小游戏">
      <header className="lo-top">
        <Link to="/" className="lo-back" aria-label="返回首页">← 首页</Link>
        <h1 className="lo-title">关灯挑战</h1>
        {screen !== 'start' && (
          <button
            type="button"
            className="lo-pause-btn"
            onClick={screen === 'paused' ? handleResume : handlePause}
            aria-label={screen === 'paused' ? '继续游戏' : '暂停游戏'}
          >
            {screen === 'paused' ? '继续' : '暂停'}
          </button>
        )}
      </header>

      {/* HUD */}
      <div className="lo-hud" aria-label="游戏信息">
        <div className="lo-stat">
          <span className="lo-stat-label">步数</span>
          <span className="lo-stat-val">{snapshot?.state === 'start' ? '—' : snapshot?.steps ?? '—'}</span>
        </div>
        <div className="lo-stat">
          <span className="lo-stat-label">剩余灯</span>
          <span className="lo-stat-val">{snapshot?.state === 'start' ? '—' : snapshot?.remainingLights ?? '—'}</span>
        </div>
        <div className="lo-stat">
          <span className="lo-stat-label">倒计时</span>
          <span className="lo-stat-val lo-timer" role="timer" aria-live="off">
            {snapshot && snapshot.state !== 'start' ? _fmtTime(snapshot.remaining) : _fmtTime(DIFFICULTY.easy.limitSec)}
          </span>
        </div>
      </div>

      {/* 读屏播报（视觉隐藏） */}
      <div aria-live="polite" aria-atomic="true" className="lo-live-region">{liveAnnounce}</div>

      {/* 棋盘 */}
      {snapshot && snapshot.lights.length > 0 && screen !== 'start' && screen !== 'over' && screen !== 'failed' && (
        <div
          className="lo-board-wrap"
          style={{ pointerEvents: screen === 'paused' ? 'none' : 'auto' }}
          aria-hidden={screen === 'paused'}
        >
          <div
            className="lo-board"
            role="grid"
            aria-label={`${snapshot.rows} 行 ${snapshot.cols} 列灯阵，点按翻转`}
            tabIndex={-1}
            onKeyDown={handleBoardKeyDown}
          >
            {_renderRows(snapshot, focusedIdx, handleToggle)}
          </div>
        </div>
      )}

      {/* 底部动作区 */}
      {(screen === 'playing' || screen === 'paused') && (
        <div className="lo-actions">
          <button
            type="button"
            className="lo-btn"
            onClick={handleUndo}
            disabled={screen === 'paused' || (snapshot?.undoLeft ?? 0) <= 0}
          >
            撤销 ({snapshot?.undoLeft ?? 0})
          </button>
          <button
            type="button"
            className="lo-btn"
            onClick={() => handleStart(snapshot?.level || 'easy')}
            disabled={screen === 'paused'}
          >
            重新打乱
          </button>
        </div>
      )}

      <p className="lo-hint">点按任意格会翻转它和上下左右的灯，把灯全部熄灭即过关。</p>

      {/* start 遮罩 */}
      {screen === 'start' && (
        <div className="lo-overlay">
          <div className="lo-overlay-card">
            <h2>关灯挑战</h2>
            <p>点按一格，会同时翻转它和上下左右邻居的灯。把所有灯熄灭即过关。</p>
            <p className="lo-overlay-hint">触屏点按即可；键盘可用方向键移动 + Enter/Space 翻转。</p>
            <div className="lo-diff-list" role="radiogroup" aria-label="选择难度">
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className="lo-diff-btn"
                  role="radio"
                  aria-checked="false"
                  onClick={() => handleStart(lv)}
                >
                  <span className="lo-diff-name">{DIFFICULTY[lv].label}</span>
                  <span className="lo-diff-meta">限时 {DIFFICULTY[lv].limitSec}s · {bestOfLevel(lv) ? `最佳 ${bestOfLevel(lv)}` : '暂无记录'}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* paused 遮罩 */}
      {screen === 'paused' && (
        <div className="lo-overlay">
          <div className="lo-overlay-card">
            <h2>{pausedAuto ? '已自动暂停' : '已暂停'}</h2>
            <p>{pausedAuto ? '检测到页面切走或窗口失焦，计时已冻结。' : '手动暂停中，计时已冻结。'}</p>
            <div className="lo-btns">
              <button type="button" className="lo-btn-primary" onClick={handleResume}>继续</button>
              <Link to="/" className="lo-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* over 遮罩 */}
      {screen === 'over' && (
        <div className="lo-overlay">
          <div className="lo-overlay-card lo-overlay-win">
            <h2>全部熄灭！</h2>
            <div className="lo-summary">
              <div><span>难度</span><strong>{DIFFICULTY[finalLevel]?.label}</strong></div>
              <div><span>步数</span><strong>{finalSteps}</strong></div>
              <div><span>用时</span><strong>{_fmtTime(finalElapsed)}</strong></div>
              <div><span>得分</span><strong>{finalScore}</strong></div>
            </div>
            <p className="lo-best">
              历史最佳：<strong>{bestOfLevel(finalLevel) ?? '—'}</strong>
              {saveError && <span className="lo-save-err">（本局成绩未保存，本地存储不可用）</span>}
            </p>
            <div className="lo-btns">
              <button type="button" className="lo-btn-primary" onClick={() => handleStart(finalLevel)}>再来一局</button>
              <Link to="/" className="lo-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* failed 遮罩（超时） */}
      {screen === 'failed' && (
        <div className="lo-overlay">
          <div className="lo-overlay-card">
            <h2>时间到</h2>
            <p>还剩 {snapshot?.remainingLights ?? 0} 盏灯没熄灭，本局不计分。</p>
            <div className="lo-summary">
              <div><span>难度</span><strong>{DIFFICULTY[finalLevel]?.label}</strong></div>
              <div><span>步数</span><strong>{finalSteps}</strong></div>
              <div><span>用时</span><strong>{_fmtTime(DIFFICULTY[finalLevel]?.limitSec)}</strong></div>
            </div>
            <div className="lo-btns">
              <button type="button" className="lo-btn-primary" onClick={() => handleStart(finalLevel)}>重新挑战</button>
              <Link to="/" className="lo-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 按行渲染：行 role=row，格 role=gridcell，内部原生 button（roving tabindex） */
function _renderRows(snapshot, focusedIdx, onToggle) {
  const { rows, cols, lights } = snapshot
  const out = []
  for (let r = 0; r < rows; r++) {
    const cells = []
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const lit = Boolean(lights[idx])
      cells.push(
        <div key={idx} role="gridcell" className="lo-cell">
          <button
            type="button"
            className={`lo-tile${lit ? ' lo-tile-on' : ''}`}
            tabIndex={focusedIdx === idx ? 0 : -1}
            aria-pressed={lit}
            aria-label={`第${r + 1}行第${c + 1}列，灯${lit ? '亮' : '灭'}，点按翻转`}
            onClick={() => onToggle(idx)}
          >
            <span className="lo-lamp" aria-hidden="true" />
          </button>
        </div>
      )
    }
    out.push(
      <div key={r} role="row" className="lo-row" style={{ '--lo-cols': cols }}>{cells}</div>
    )
  }
  return out
}

export default LightsOutPage
