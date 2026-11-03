import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Connect4Engine, DIFFICULTY, CONNECT4 } from '../game/Connect4Engine'
import './Connect4.css'

const BEST_KEY = 'game-connect4-best-v1'
const STATS_KEY = 'game-connect4-stats-v1'
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
      if (r && Number.isFinite(r.score)) out[k] = { score: r.score, moves: r.moves || 0, time: r.time || 0 }
    }
    return out
  } catch {
    return {}
  }
}

/** 读取累计埋点（结构损坏时回退空结构） */
function loadStats() {
  const empty = { plays: {}, wins: {}, losses: {}, draws: {}, moves: 0, timeByLevel: {}, updatedAt: 0 }
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return empty
    return {
      ...empty,
      ...data,
      plays: { ...(data.plays || {}) },
      wins: { ...(data.wins || {}) },
      losses: { ...(data.losses || {}) },
      draws: { ...(data.draws || {}) },
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

const RESULT_TITLE = {
  win: '四连成功！',
  lose: '电脑连成了四子',
  draw: '平局',
  timeout: '时间到',
}

const RESULT_DESC = {
  win: '你先连成了四子，赢下本局。',
  lose: '电脑先连成了四子，再试一次吧。',
  draw: '棋盘已满，双方都没能连成四子。',
  timeout: '倒计时归零，本局结束。',
}

/**
 * 四连棋页面壳
 * 架构对齐 LightsOut.jsx：四态 UI + 引擎回调 + visibility/blur 双路去重暂停；
 * 无障碍：role=grid + roving tabindex + aria-live 播报；触控为原生 button 点按。
 */
function Connect4Page() {
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
  const [focusedIdx, setFocusedIdx] = useState((CONNECT4.ROWS - 1) * CONNECT4.COLS + 2)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [best, setBest] = useState(loadBest)
  const [saveError, setSaveError] = useState(false)

  const [finalResult, setFinalResult] = useState('win')
  const [finalScore, setFinalScore] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState(0)
  const [finalMoves, setFinalMoves] = useState(0)
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
    const engine = new Connect4Engine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state !== stateRef.current) changeScreen(snap.state)

        // aria-live：同一动作只播报一次（tick 每 250ms 复用同一 lastAction）
        const key = `${snap.lastAction}:${snap.moves}:${snap.turn}`
        if (key !== announceKeyRef.current) {
          announceKeyRef.current = key
          if (snap.lastAction === 'start') setLiveAnnounce('游戏开始，你先落子')
          else if (snap.lastAction === 'drop') setLiveAnnounce(`你落在第 ${(snap.lastDrop?.col ?? 0) + 1} 列，电脑思考中`)
          else if (snap.lastAction === 'ai') setLiveAnnounce(`电脑落在第 ${(snap.lastDrop?.col ?? 0) + 1} 列，轮到你落子`)
          else if (snap.lastAction === 'win') setLiveAnnounce('四连成功，你赢了')
          else if (snap.lastAction === 'lose') setLiveAnnounce('电脑连成了四子，本局失败')
          else if (snap.lastAction === 'draw') setLiveAnnounce('棋盘已满，平局')
          else if (snap.lastAction === 'timeout') setLiveAnnounce('时间到，本局结束')
          else if (snap.lastAction === 'pause') setLiveAnnounce('已暂停')
          else if (snap.lastAction === 'resume') setLiveAnnounce('继续游戏')
        }
      },
      onGameOver: (score, elapsed, result) => {
        const snap = snapshotRef.current
        const level = snap?.level || 'easy'
        const moves = snap?.moves || 0
        setFinalLevel(level)
        setFinalElapsed(elapsed)
        setFinalMoves(moves)
        setFinalResult(result)
        setFinalScore(score)

        if (result === 'win') bumpStats((s) => {
          s.wins[level] = (s.wins[level] || 0) + 1
          s.moves += moves
          s.timeByLevel[level] = Math.round(((s.timeByLevel[level] || 0) + elapsed) * 10) / 10
        })
        else if (result === 'lose') bumpStats((s) => { s.losses[level] = (s.losses[level] || 0) + 1 })
        else if (result === 'draw' || result === 'timeout') bumpStats((s) => { s.draws[level] = (s.draws[level] || 0) + 1 })

        if (result === 'win') {
          // 仅在分数更高时覆盖最佳记录；读取/写入失败降级为仅内存展示
          const current = loadBest()
          const cur = current[level]
          if (!cur || cur.score < score) {
            const next = {
              ...current,
              [level]: { score, moves, time: Math.round(elapsed * 10) / 10 },
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
        changeScreen('over')
        setTimeout(() => {
          document.querySelector('.c4-overlay-card .c4-btn-primary')?.focus()
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
    const timer = setInterval(() => engineRef.current?.tick(), CONNECT4.TICK_MS)
    return () => clearInterval(timer)
  }, [screen])

  // ---------- 电脑落子：思考延迟后执行；暂停时清理，恢复后重新调度 ----------
  useEffect(() => {
    if (screen !== 'playing') return
    if (!snapshot || snapshot.state !== 'playing' || snapshot.turn !== 'ai') return
    const timer = setTimeout(() => engineRef.current?.aiTurn(), CONNECT4.AI_DELAY_MS)
    return () => clearTimeout(timer)
    // 仅在「轮到电脑/步数变化/状态变化」时重新调度；tick 每 250ms 不触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, snapshot?.state, snapshot?.turn, snapshot?.moves])

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
    setFocusedIdx((CONNECT4.ROWS - 1) * CONNECT4.COLS + 2)
    setPausedAuto(false)
    setTimeout(() => {
      document.querySelector('.c4-board .c4-cell[tabindex="0"]')?.focus()
    }, 0)
  }

  const handlePause = () => {
    autoPauseRef.current = false
    engineRef.current?.pause()
  }

  const handleResume = () => {
    autoPauseRef.current = false
    engineRef.current?.resume()
    changeScreen('playing')
    setTimeout(() => {
      document.querySelector(`.c4-cell[data-idx="${focusedIdx}"]`)?.focus()
    }, 0)
  }

  const handleDrop = (col, idx) => {
    const snap = snapshotRef.current
    if (!snap || snap.state !== 'playing' || snap.turn !== 'player') return
    setFocusedIdx(idx)
    engineRef.current?.drop(col)
  }

  // ---------- 键盘：方向键移动 + Enter/Space 由原生 button 触发落子 ----------
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
      const next = nr * cols + nc
      setFocusedIdx(next)
      document.querySelector(`.c4-cell[data-idx="${next}"]`)?.focus()
    }
  }

  const bestOfLevel = (level) => best[level]?.score
  const canPlay = screen === 'playing' && snapshot?.turn === 'player'

  return (
    <div className="c4-page" role="application" aria-label="四连棋小游戏">
      <header className="c4-top">
        <Link to="/" className="c4-back" aria-label="返回首页">← 首页</Link>
        <h1 className="c4-title">四连棋</h1>
        {screen !== 'start' && (
          <button
            type="button"
            className="c4-pause-btn"
            onClick={screen === 'paused' ? handleResume : handlePause}
            aria-label={screen === 'paused' ? '继续游戏' : '暂停游戏'}
          >
            {screen === 'paused' ? '继续' : '暂停'}
          </button>
        )}
      </header>

      {/* HUD */}
      <div className="c4-hud" aria-label="游戏信息">
        <div className="c4-stat">
          <span className="c4-stat-label">步数</span>
          <span className="c4-stat-val">{snapshot?.state === 'start' ? '—' : snapshot?.moves ?? '—'}</span>
        </div>
        <div className="c4-stat">
          <span className="c4-stat-label">难度</span>
          <span className="c4-stat-val c4-stat-small">{DIFFICULTY[snapshot?.level || 'easy']?.label}</span>
        </div>
        <div className="c4-stat">
          <span className="c4-stat-label">倒计时</span>
          <span className="c4-stat-val c4-timer" role="timer" aria-live="off">
            {snapshot && snapshot.state !== 'start' ? _fmtTime(snapshot.remaining) : _fmtTime(DIFFICULTY.easy.limitSec)}
          </span>
        </div>
      </div>

      <div className="c4-turn" aria-hidden="true">
        {screen === 'playing' && (snapshot?.turn === 'ai' ? '电脑思考中…' : '轮到你落子')}
        {screen === 'paused' && '已暂停'}
        {screen === 'over' && '本局结束'}
      </div>

      {/* 读屏播报（视觉隐藏） */}
      <div aria-live="polite" aria-atomic="true" className="c4-live-region">{liveAnnounce}</div>

      {/* 棋盘 */}
      {snapshot && snapshot.state !== 'start' && screen !== 'over' && (
        <div
          className="c4-board-wrap"
          style={{ pointerEvents: screen === 'paused' ? 'none' : 'auto' }}
          aria-hidden={screen === 'paused'}
        >
          <div
            className="c4-board"
            role="grid"
            aria-label={`${CONNECT4.ROWS} 行 ${CONNECT4.COLS} 列四连棋棋盘，点按一列落子`}
            tabIndex={-1}
            onKeyDown={handleBoardKeyDown}
          >
            {_renderRows(snapshot, focusedIdx, canPlay, handleDrop)}
          </div>
        </div>
      )}

      {/* 底部动作区 */}
      {(screen === 'playing' || screen === 'paused') && (
        <div className="c4-actions">
          <button
            type="button"
            className="c4-btn"
            onClick={() => handleStart(snapshot?.level || 'easy')}
            disabled={screen === 'paused'}
          >
            重新开局
          </button>
          <Link to="/" className="c4-btn">返回首页</Link>
        </div>
      )}

      <p className="c4-hint">点按任意一格，棋子会落到该列最底部；先连成四子的一方获胜。</p>

      {/* start 遮罩 */}
      {screen === 'start' && (
        <div className="c4-overlay">
          <div className="c4-overlay-card">
            <h2>四连棋</h2>
            <p>点按一列，棋子落到最底部。横、竖或斜着先连成四枚同色棋子即获胜。</p>
            <p className="c4-overlay-hint">你先手，电脑使用下方对应难度的策略；单局限时 3 分钟。</p>
            <div className="c4-diff-list" role="radiogroup" aria-label="选择难度">
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className="c4-diff-btn"
                  role="radio"
                  aria-checked="false"
                  onClick={() => handleStart(lv)}
                >
                  <span className="c4-diff-name">{DIFFICULTY[lv].label}</span>
                  <span className="c4-diff-meta">
                    {DIFFICULTY[lv].desc} · 限时 {DIFFICULTY[lv].limitSec}s · {bestOfLevel(lv) ? `最佳 ${bestOfLevel(lv)}` : '暂无记录'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* paused 遮罩 */}
      {screen === 'paused' && (
        <div className="c4-overlay">
          <div className="c4-overlay-card">
            <h2>{pausedAuto ? '已自动暂停' : '已暂停'}</h2>
            <p>{pausedAuto ? '检测到页面切走或窗口失焦，计时已冻结。' : '手动暂停中，计时已冻结。'}</p>
            <div className="c4-btns">
              <button type="button" className="c4-btn-primary" onClick={handleResume}>继续</button>
              <Link to="/" className="c4-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* over 遮罩 */}
      {screen === 'over' && (
        <div className="c4-overlay">
          <div className={`c4-overlay-card${finalResult === 'win' ? ' c4-overlay-win' : ''}`}>
            <h2>{RESULT_TITLE[finalResult] || '本局结束'}</h2>
            <p>{RESULT_DESC[finalResult] || ''}</p>
            <div className="c4-summary">
              <div><span>难度</span><strong>{DIFFICULTY[finalLevel]?.label}</strong></div>
              <div><span>步数</span><strong>{finalMoves}</strong></div>
              <div><span>用时</span><strong>{_fmtTime(finalElapsed)}</strong></div>
              <div><span>得分</span><strong>{finalScore}</strong></div>
            </div>
            <p className="c4-best">
              历史最佳：<strong>{bestOfLevel(finalLevel) ?? '—'}</strong>
              {saveError && <span className="c4-save-err">（本局成绩未保存，本地存储不可用）</span>}
            </p>
            <div className="c4-btns">
              <button type="button" className="c4-btn-primary" onClick={() => handleStart(finalLevel)}>再来一局</button>
              <Link to="/" className="c4-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 按行渲染：行 role=row，格 role=gridcell，内部原生 button（roving tabindex） */
function _renderRows(snapshot, focusedIdx, canPlay, onDrop) {
  const { rows, cols, cells, winningLine, lastDrop } = snapshot
  const winSet = new Set(winningLine || [])
  const out = []
  for (let r = 0; r < rows; r++) {
    const rowCells = []
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const who = cells[idx]
      const label = who === CONNECT4.PLAYER ? '你的棋子' : who === CONNECT4.AI ? '电脑的棋子' : '空位'
      const isLast = lastDrop && lastDrop.row === r && lastDrop.col === c
      rowCells.push(
        <div key={idx} role="gridcell" className="c4-cell-wrap">
          <button
            type="button"
            data-idx={idx}
            className={`c4-cell${who === CONNECT4.PLAYER ? ' c4-player' : who === CONNECT4.AI ? ' c4-ai' : ''}${winSet.has(idx) ? ' c4-win' : ''}${isLast ? ' c4-last' : ''}`}
            tabIndex={focusedIdx === idx ? 0 : -1}
            aria-disabled={!canPlay}
            aria-label={`第${r + 1}行第${c + 1}列，${label}，点按在第${c + 1}列落子`}
            onClick={() => onDrop(c, idx)}
          >
            <span className="c4-disc" aria-hidden="true" />
          </button>
        </div>
      )
    }
    out.push(<div key={r} role="row" className="c4-row">{rowCells}</div>)
  }
  return out
}

export default Connect4Page
