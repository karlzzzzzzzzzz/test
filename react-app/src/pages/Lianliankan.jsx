import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LianliankanEngine, DIFFICULTY, LIANLIANKAN } from '../game/LianliankanEngine'
import './Lianliankan.css'

const BEST_KEY = 'game-lianliankan-best-v1'
const STATS_KEY = 'game-lianliankan-stats-v1'
const LEVELS = ['easy', 'normal', 'hard']

// 图案池：emoji + 中文名，读屏只播报中文名
const SYMBOLS = [
  { char: '🍎', name: '苹果' },
  { char: '🍇', name: '葡萄' },
  { char: '🍋', name: '柠檬' },
  { char: '🍉', name: '西瓜' },
  { char: '🥝', name: '猕猴桃' },
  { char: '🍒', name: '樱桃' },
  { char: '🥥', name: '椰子' },
  { char: '🍑', name: '桃子' },
  { char: '🌽', name: '玉米' },
  { char: '🍄', name: '蘑菇' },
]

/** 读取历史最佳（损坏/不可用时降级为空对象） */
function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return {}
    const out = {}
    for (const k of LEVELS) {
      const r = data[k]
      if (r && Number.isFinite(r.score)) out[k] = { score: r.score, time: r.time || 0, pairs: r.pairs || 0 }
    }
    return out
  } catch {
    return {}
  }
}

/** 读取累计埋点（结构损坏时回退空结构） */
function loadStats() {
  const empty = { plays: {}, wins: {}, pairs: 0, timeByLevel: {}, updatedAt: 0 }
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
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * 连连看页面壳
 * 架构对齐 LightsOut：四态 UI + 引擎回调 + visibility/blur 双路去重暂停；
 * 无障碍：role=grid + roving tabindex + aria-live；触控为原生 button 点按。
 */
function LianliankanPage() {
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
  const [finalPairs, setFinalPairs] = useState(0)
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
    const engine = new LianliankanEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state !== stateRef.current) changeScreen(snap.state)

        // aria-live：同一动作只播报一次（tick 每 200ms 复用同一 lastAction）
        const key = `${snap.lastAction}:${snap.clearedPairs}:${snap.wrongTaps}:${snap.autoShuffles}:${snap.hintsLeft}`
        if (key !== announceKeyRef.current) {
          announceKeyRef.current = key
          if (snap.lastAction === 'clear') setLiveAnnounce(`消除成功，剩余 ${snap.remainingPairs} 对`)
          else if (snap.lastAction === 'wrong') setLiveAnnounce('这两张牌连不起来，重新选择')
          else if (snap.lastAction === 'auto-shuffle') setLiveAnnounce('没有可消除的牌，已自动洗牌')
          else if (snap.lastAction === 'hint') setLiveAnnounce('已提示一对可消除的牌')
          else if (snap.lastAction === 'shuffle') setLiveAnnounce('已重新洗牌')
          else if (snap.lastAction === 'win') setLiveAnnounce('全部消除，挑战成功')
          else if (snap.lastAction === 'timeout') setLiveAnnounce('时间到，挑战失败')
        }
      },
      onGameOver: (score, elapsed, result) => {
        const snap = snapshotRef.current
        const level = snap?.level || 'easy'
        setFinalLevel(level)
        setFinalElapsed(elapsed)
        setFinalPairs(snap?.clearedPairs || 0)
        setFinalScore(score)

        if (result === 'win') {
          bumpStats((s) => {
            s.wins[level] = (s.wins[level] || 0) + 1
            s.pairs += snap?.clearedPairs || 0
            s.timeByLevel[level] = Math.round(((s.timeByLevel[level] || 0) + elapsed) * 10) / 10
          })
          const current = loadBest()
          const cur = current[level]
          if (!cur || cur.score < score) {
            const next = {
              ...current,
              [level]: { score, time: Math.round(elapsed * 10) / 10, pairs: snap?.clearedPairs || 0 },
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
          document.querySelector('.llk-overlay-card .llk-btn-primary')?.focus()
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
    const timer = setInterval(() => engineRef.current?.tick(), LIANLIANKAN.TICK_MS)
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
    const onHidden = () => {
      if (document.hidden) flushStats()
    }
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
    bumpStats((s) => {
      s.plays[level] = (s.plays[level] || 0) + 1
    })
    announceKeyRef.current = ''
    changeScreen('playing')
    setFocusedIdx(0)
    setPausedAuto(false)
    setTimeout(() => document.querySelector('.llk-board .llk-tile')?.focus(), 0)
  }

  const handlePause = () => {
    autoPauseRef.current = false
    engineRef.current?.pause()
  }

  const handleResume = () => {
    autoPauseRef.current = false
    engineRef.current?.resume()
    changeScreen('playing')
    setTimeout(() => document.querySelector('.llk-board .llk-tile')?.focus(), 0)
  }

  const handleSelect = (idx) => {
    setFocusedIdx(idx)
    engineRef.current?.select(idx)
  }

  // ---------- 键盘：方向键移动（Enter/Space 走按钮原生点击） ----------
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
    }
  }

  const renderBoard = () => {
    if (!snapshot || !snapshot.tiles) {
      return <div className="llk-board llk-board-empty" aria-hidden="true" />
    }
    const { rows, cols, tiles, selected, hintPair } = snapshot
    const out = []
    for (let r = 0; r < rows; r++) {
      const cells = []
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c
        const tile = tiles[idx]
        const isSelected = selected === idx
        const isHint = hintPair && (hintPair.a === idx || hintPair.b === idx)
        const isFocus = focusedIdx === idx
        const sym = tile === null ? null : SYMBOLS[tile]
        cells.push(
          <button
            key={`${idx}`}
            type="button"
            role="gridcell"
            className={`llk-tile${tile === null ? ' is-empty' : ''}${isSelected ? ' is-selected' : ''}${isHint ? ' is-hint' : ''}`}
            data-idx={idx}
            tabIndex={isFocus ? 0 : -1}
            disabled={tile === null}
            aria-selected={isSelected}
            aria-label={sym ? `${sym.name}，第 ${r + 1} 行第 ${c + 1} 列` : `空位，第 ${r + 1} 行第 ${c + 1} 列`}
            onClick={() => handleSelect(idx)}
          >
            {sym ? <span className="llk-symbol" aria-hidden="true">{sym.char}</span> : null}
          </button>,
        )
      }
      out.push(
        <div key={`row-${r}`} className="llk-row" role="row">
          {cells}
        </div>,
      )
    }
    return (
      <div className="llk-board" role="grid" aria-label={`${rows} 行 ${cols} 列连连看棋盘`} onKeyDown={handleBoardKeyDown} tabIndex={-1}>
        {out}
      </div>
    )
  }

  const bestOfLevel = (level) => best[level]?.score

  return (
    <div className="llk-page" role="application" aria-label="连连看小游戏">
      <header className="llk-top">
        <Link to="/" className="llk-back" aria-label="返回首页">← 首页</Link>
        <h1 className="llk-title">连连看</h1>
        {screen !== 'start' && (
          <button
            type="button"
            className="llk-pause-btn"
            onClick={screen === 'paused' ? handleResume : handlePause}
            aria-label={screen === 'paused' ? '继续游戏' : '暂停游戏'}
          >
            {screen === 'paused' ? '继续' : '暂停'}
          </button>
        )}
      </header>

      <div className="llk-hud" aria-label="游戏信息">
        <div className="llk-stat">
          <span className="llk-stat-label">剩余</span>
          <span className="llk-stat-val">{snapshot && snapshot.state !== 'start' ? `${snapshot.remainingPairs} 对` : '—'}</span>
        </div>
        <div className="llk-stat">
          <span className="llk-stat-label">误点</span>
          <span className="llk-stat-val">{snapshot && snapshot.state !== 'start' ? snapshot.wrongTaps : '—'}</span>
        </div>
        <div className="llk-stat">
          <span className="llk-stat-label">倒计时</span>
          <span className="llk-stat-val llk-timer" role="timer" aria-live="off">
            {snapshot && snapshot.state !== 'start' ? _fmtTime(snapshot.remaining) : _fmtTime(DIFFICULTY.easy.limitSec)}
          </span>
        </div>
      </div>

      <div className="llk-live-region" aria-live="polite" aria-atomic="true">{liveAnnounce}</div>

      <div className="llk-board-wrap">{renderBoard()}</div>

      <div className="llk-actions">
        <button
          type="button"
          className="llk-btn"
          onClick={() => engineRef.current?.hint()}
          disabled={!snapshot || snapshot.state !== 'playing' || snapshot.hintsLeft <= 0}
        >
          提示（{snapshot?.hintsLeft ?? LIANLIANKAN.HINT_LIMIT}）
        </button>
        <button
          type="button"
          className="llk-btn"
          onClick={() => engineRef.current?.shuffle()}
          disabled={!snapshot || snapshot.state !== 'playing' || snapshot.shufflesLeft <= 0}
        >
          洗牌（{snapshot?.shufflesLeft ?? LIANLIANKAN.SHUFFLE_LIMIT}）
        </button>
        <Link to="/" className="llk-btn">返回首页</Link>
      </div>

      <p className="llk-hint">点两张相同的图案：路径不超过两次转弯（可绕出棋盘边界）即可消除；消除全部成对图案即过关。</p>

      {screen === 'start' && (
        <div className="llk-overlay llk-overlay-start">
          <div className="llk-overlay-card">
            <p className="llk-overlay-eyebrow">LINK · LINK</p>
            <h2 className="llk-overlay-title">连连看</h2>
            <p className="llk-overlay-desc">点两张相同的图案，若能用不超过两次转弯的路径连通，就一起消除。</p>
            <div className="llk-levels">
              {LEVELS.map((key) => {
                const cfg = DIFFICULTY[key]
                const b = bestOfLevel(key)
                return (
                  <button key={key} type="button" className="llk-level" onClick={() => handleStart(key)}>
                    <span className="llk-level-name">{cfg.label}</span>
                    <span className="llk-level-desc">限时 {cfg.limitSec}s · 最佳 {b ?? '暂无'}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {screen === 'paused' && (
        <div className="llk-overlay" role="dialog" aria-modal="true" aria-labelledby="llk-paused-title">
          <div className="llk-overlay-card">
            <h2 className="llk-overlay-title" id="llk-paused-title">已暂停</h2>
            <p className="llk-overlay-desc">{pausedAuto ? '切换到后台时自动暂停，计时已冻结。' : '点击继续回到本局。'}</p>
            <div className="llk-overlay-actions">
              <button type="button" className="llk-btn llk-btn-primary" onClick={handleResume}>继续</button>
              <Link to="/" className="llk-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {screen === 'over' && (
        <div className="llk-overlay" role="dialog" aria-modal="true" aria-labelledby="llk-over-title">
          <div className="llk-overlay-card">
            <h2 className="llk-overlay-title" id="llk-over-title">全部消除</h2>
            <p className="llk-overlay-desc">{DIFFICULTY[finalLevel].label} · 用时 {_fmtTime(finalElapsed)}</p>
            <div className="llk-result">
              <div><span>得分</span><strong>{finalScore}</strong></div>
              <div><span>消除</span><strong>{finalPairs} 对</strong></div>
              <div><span>历史最佳</span><strong>{best[finalLevel]?.score ?? '暂无记录'}</strong></div>
            </div>
            {saveError && <p className="llk-warn">本局成绩未保存（本地存储不可用）</p>}
            <div className="llk-overlay-actions">
              <button type="button" className="llk-btn llk-btn-primary" onClick={() => handleStart(finalLevel)}>再来一局</button>
              <Link to="/" className="llk-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {screen === 'failed' && (
        <div className="llk-overlay" role="dialog" aria-modal="true" aria-labelledby="llk-fail-title">
          <div className="llk-overlay-card">
            <h2 className="llk-overlay-title" id="llk-fail-title">时间到</h2>
            <p className="llk-overlay-desc">还剩 {snapshot?.remainingPairs ?? 0} 对没消完，本局不计分。</p>
            <div className="llk-overlay-actions">
              <button type="button" className="llk-btn llk-btn-primary" onClick={() => handleStart(finalLevel)}>重新挑战</button>
              <Link to="/" className="llk-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default LianliankanPage
