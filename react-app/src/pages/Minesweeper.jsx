import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MinesweeperEngine, DIFFICULTY, MINESWEEPER } from '../game/MinesweeperEngine'
import './Minesweeper.css'

const BEST_KEY = 'game-minesweeper-best-v1'
const STATS_KEY = 'game-minesweeper-stats-v1'
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
      if (r && Number.isFinite(r.score)) {
        out[k] = {
          score: r.score,
          time: Number.isFinite(r.time) ? r.time : 0,
          undoLeft: Number.isFinite(r.undoLeft) ? r.undoLeft : 0,
        }
      }
    }
    return out
  } catch {
    return {}
  }
}

/** 读取累计埋点（结构损坏时回退空结构） */
function loadStats() {
  const empty = {
    plays: {}, wins: {}, losses: {}, timeouts: {}, timeByLevel: {},
    reveals: 0, updatedAt: 0,
  }
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
      timeouts: { ...(data.timeouts || {}) },
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
  win: '雷区清空！',
  lose: '踩到地雷',
  timeout: '时间到',
}

const RESULT_DESC = {
  win: '所有安全格都已翻开，本局胜利。',
  lose: '你翻开了一颗地雷，本局结束。',
  timeout: '180 秒倒计时归零，本局结束。',
}

/**
 * 扫雷页面壳
 * 架构对齐 Reversi.jsx：四态 UI + 引擎回调 + visibility/blur 双路去重暂停；
 * 无障碍：role=grid + roving tabindex + aria-live 播报；触控以模式切换区分翻开/插旗。
 */
function MinesweeperPage() {
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
  const [focusedIdx, setFocusedIdx] = useState(24)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [best, setBest] = useState(loadBest)
  const [saveError, setSaveError] = useState(false)
  const [mode, setMode] = useState('reveal')

  const [finalResult, setFinalResult] = useState('win')
  const [finalScore, setFinalScore] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState(0)
  const [finalLevel, setFinalLevel] = useState('easy')
  const [finalRevealed, setFinalRevealed] = useState(0)
  const [finalFlags, setFinalFlags] = useState(0)
  const [finalUndoLeft, setFinalUndoLeft] = useState(0)

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
    const engine = new MinesweeperEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state !== stateRef.current) changeScreen(snap.state)

        // aria-live：同一动作只播报一次（tick 每 250ms 复用同一 lastAction）
        const key = `${snap.lastAction}:${snap.moves}:${snap.safeRevealed}:${snap.flagsUsed}:${snap.undoLeft}`
        if (key !== announceKeyRef.current) {
          announceKeyRef.current = key
          const at = (i) => `第${Math.floor(i / snap.cols) + 1}行第${(i % snap.cols) + 1}列`
          const rv = snap.lastReveal
          if (snap.lastAction === 'start') setLiveAnnounce('游戏开始，首次翻开保证安全')
          else if (snap.lastAction === 'reveal' && rv) {
            setLiveAnnounce(
              rv.flooded
                ? `翻开${at(rv.idx)}，连带展开 ${rv.count} 格`
                : `翻开${at(rv.idx)}，相邻 ${snap.cells[rv.idx]?.adj ?? 0} 颗雷`,
            )
          } else if (snap.lastAction === 'flag') setLiveAnnounce(`${at(snap.lastFlag?.idx ?? 0)}已插旗，剩余雷数 ${snap.mines - snap.flagsUsed}`)
          else if (snap.lastAction === 'unflag') setLiveAnnounce(`已取消${at(snap.lastFlag?.idx ?? 0)}的标记`)
          else if (snap.lastAction === 'undo') setLiveAnnounce(`已回退上一步，还可撤销 ${snap.undoLeft} 次`)
          else if (snap.lastAction === 'win') setLiveAnnounce('雷区清空，你赢了')
          else if (snap.lastAction === 'lose') setLiveAnnounce('踩到地雷，本局结束')
          else if (snap.lastAction === 'timeout') setLiveAnnounce('时间到，本局结束')
          else if (snap.lastAction === 'pause') setLiveAnnounce('已暂停')
          else if (snap.lastAction === 'resume') setLiveAnnounce('继续游戏')
        }
      },
      onGameOver: (score, elapsed, result) => {
        const snap = snapshotRef.current
        const level = snap?.level || 'easy'
        setFinalLevel(level)
        setFinalElapsed(elapsed)
        setFinalResult(result)
        setFinalScore(score)
        setFinalRevealed(snap?.safeRevealed || 0)
        setFinalFlags(snap?.flagsUsed || 0)
        setFinalUndoLeft(snap?.undoLeft || 0)

        if (result === 'win') bumpStats((s) => {
          s.wins[level] = (s.wins[level] || 0) + 1
          s.timeByLevel[level] = Math.round(((s.timeByLevel[level] || 0) + elapsed) * 10) / 10
          s.reveals = (s.reveals || 0) + (snap?.safeRevealed || 0)
        })
        else if (result === 'lose') bumpStats((s) => {
          s.losses[level] = (s.losses[level] || 0) + 1
          s.reveals = (s.reveals || 0) + (snap?.safeRevealed || 0)
        })
        else if (result === 'timeout') bumpStats((s) => { s.timeouts[level] = (s.timeouts[level] || 0) + 1 })

        if (result === 'win') {
          // 仅在分数更高时覆盖最佳记录；读取/写入失败降级为仅内存展示
          const current = loadBest()
          const cur = current[level]
          if (!cur || cur.score < score) {
            const next = {
              ...current,
              [level]: { score, time: Math.round(elapsed * 10) / 10, undoLeft: snap?.undoLeft || 0 },
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
        setTimeout(() => {
          document.querySelector('.ms-overlay-card .ms-btn-primary')?.focus()
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
    const timer = setInterval(() => engineRef.current?.tick(), MINESWEEPER.TICK_MS)
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
    const cfg = DIFFICULTY[level]
    const center = Math.floor(cfg.rows / 2) * cfg.cols + Math.floor(cfg.cols / 2)
    announceKeyRef.current = ''
    setMode('reveal')
    setFocusedIdx(center)
    setPausedAuto(false)
    changeScreen('playing')
    setTimeout(() => {
      document.querySelector('.ms-board .ms-cell[tabindex="0"]')?.focus()
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
      document.querySelector(`.ms-cell[data-idx="${focusedIdx}"]`)?.focus()
    }, 0)
  }

  const announce = (text) => {
    setLiveAnnounce('')
    setTimeout(() => setLiveAnnounce(text), 0)
  }

  const handleCell = (idx) => {
    const snap = snapshotRef.current
    if (!snap || snap.state !== 'playing') return
    setFocusedIdx(idx)
    const cell = snap.cells[idx]
    const where = `第${Math.floor(idx / snap.cols) + 1}行第${(idx % snap.cols) + 1}列`

    if (cell.revealed) {
      announce(`${where}已经翻开`)
      return
    }
    if (mode === 'flag') {
      const ok = engineRef.current?.toggleFlag(idx)
      if (!ok) announce(cell.flagged ? `${where}标记已取消失败，请稍后再试` : `${where}无法插旗：旗子已用完或操作过快`)
      return
    }
    if (cell.flagged) {
      announce(`${where}已插旗，请先取消标记再翻开`)
      return
    }
    const ok = engineRef.current?.reveal(idx)
    if (!ok) announce(`${where}操作过快，请稍后再试`)
  }

  const handleUndo = () => {
    const ok = engineRef.current?.undo()
    if (!ok) announce('当前无法撤销')
  }

  const toggleMode = () => {
    if (stateRef.current !== 'playing') return
    setMode((m) => (m === 'reveal' ? 'flag' : 'reveal'))
  }

  // ---------- 键盘：方向键移动焦点，F 插旗，Enter/Space 由原生 button 触发 ----------
  const handleBoardKeyDown = (e) => {
    const snap = snapshotRef.current
    if (!snap || snap.state !== 'playing') return
    const key = e.key

    if (key === 'f' || key === 'F') {
      e.preventDefault()
      const cell = snap.cells[focusedIdx]
      if (!cell || cell.revealed) return
      engineRef.current?.toggleFlag(focusedIdx)
      return
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
    e.preventDefault()
    const r = Math.floor(focusedIdx / snap.cols)
    const c = focusedIdx % snap.cols
    let nr = r
    let nc = c
    if (key === 'ArrowUp') nr = Math.max(0, r - 1)
    else if (key === 'ArrowDown') nr = Math.min(snap.rows - 1, r + 1)
    else if (key === 'ArrowLeft') nc = Math.max(0, c - 1)
    else if (key === 'ArrowRight') nc = Math.min(snap.cols - 1, c + 1)
    else if (key === 'Home') nc = 0
    else if (key === 'End') nc = snap.cols - 1
    const next = nr * snap.cols + nc
    setFocusedIdx(next)
    document.querySelector(`.ms-cell[data-idx="${next}"]`)?.focus()
  }

  const bestOfLevel = (level) => best[level]?.score
  const canPlay = screen === 'playing' && snapshot?.state === 'playing'
  const showBoard = snapshot && snapshot.state !== 'start' && screen !== 'over'
  const remainingMines = snapshot ? Math.max(0, snapshot.mines - snapshot.flagsUsed) : null

  return (
    <div className="ms-page" role="application" aria-label="扫雷小游戏">
      <header className="ms-top">
        <Link to="/" className="ms-back" aria-label="返回首页">← 首页</Link>
        <h1 className="ms-title">扫雷</h1>
        {screen !== 'start' && (
          <button
            type="button"
            className="ms-pause-btn"
            onClick={screen === 'paused' ? handleResume : handlePause}
            aria-label={screen === 'paused' ? '继续游戏' : '暂停游戏'}
          >
            {screen === 'paused' ? '继续' : '暂停'}
          </button>
        )}
      </header>

      {/* HUD */}
      <div className="ms-hud" aria-label="游戏信息">
        <div className="ms-stat">
          <span className="ms-stat-label">已翻开</span>
          <span className="ms-stat-val">
            {snapshot?.state === 'start' ? '—' : `${snapshot?.safeRevealed ?? 0}/${snapshot?.safeTotal ?? 0}`}
          </span>
        </div>
        <div className="ms-stat">
          <span className="ms-stat-label">剩余雷</span>
          <span className="ms-stat-val ms-stat-mine">{snapshot?.state === 'start' ? '—' : remainingMines}</span>
        </div>
        <div className="ms-stat">
          <span className="ms-stat-label">撤销</span>
          <span className="ms-stat-val">{snapshot?.state === 'start' ? '—' : snapshot?.undoLeft ?? 0}</span>
        </div>
        <div className="ms-stat">
          <span className="ms-stat-label">倒计时</span>
          <span className="ms-stat-val ms-timer" role="timer" aria-live="off">
            {snapshot && snapshot.state !== 'start' ? _fmtTime(snapshot.remaining) : _fmtTime(DIFFICULTY.easy.limitSec)}
          </span>
        </div>
      </div>

      {/* 模式切换：触屏通过模式区分翻开 / 插旗 */}
      {(screen === 'playing' || screen === 'paused') && (
        <div className="ms-mode-bar">
          <button
            type="button"
            className={`ms-mode-btn${mode === 'flag' ? ' ms-mode-on' : ''}`}
            onClick={toggleMode}
            disabled={screen === 'paused'}
            aria-pressed={mode === 'flag'}
          >
            {mode === 'flag' ? '标记模式' : '翻开模式'}
          </button>
          <span className="ms-mode-hint">
            {mode === 'flag' ? '点按格子插旗 / 撤旗' : '点按格子翻开，F 键可插旗'}
          </span>
        </div>
      )}

      {/* 读屏播报（视觉隐藏） */}
      <div aria-live="polite" aria-atomic="true" className="ms-live-region">{liveAnnounce}</div>

      {/* 盘面 */}
      {showBoard && (
        <div
          className="ms-board-wrap"
          style={{ pointerEvents: screen === 'paused' ? 'none' : 'auto' }}
          aria-hidden={screen === 'paused'}
        >
          <div
            className="ms-board"
            role="grid"
            aria-label={`${snapshot.rows} 行 ${snapshot.cols} 列扫雷雷区，共 ${snapshot.mines} 颗雷`}
            style={{ '--ms-cols': String(snapshot.cols) }}
            tabIndex={-1}
            onKeyDown={handleBoardKeyDown}
          >
            {_renderRows(snapshot, focusedIdx, canPlay, handleCell)}
          </div>
        </div>
      )}

      {/* 底部动作区 */}
      {(screen === 'playing' || screen === 'paused') && (
        <div className="ms-actions">
          <button
            type="button"
            className="ms-btn"
            onClick={handleUndo}
            disabled={screen === 'paused' || !snapshot || snapshot.undoLeft <= 0}
          >
            撤销一步（{snapshot?.undoLeft ?? 0}）
          </button>
          <button
            type="button"
            className="ms-btn"
            onClick={() => handleStart(snapshot?.level || 'easy')}
            disabled={screen === 'paused'}
          >
            重新开局
          </button>
          <Link to="/" className="ms-btn">返回首页</Link>
        </div>
      )}

      <p className="ms-hint">首点及其周围八格保证无雷；数字表示相邻地雷数。切换「标记模式」后点按格子插旗。</p>

      {/* start 遮罩 */}
      {screen === 'start' && (
        <div className="ms-overlay">
          <div className="ms-overlay-card">
            <h2>扫雷</h2>
            <p>翻开所有安全格即胜利，踩到地雷本局结束。首次翻开的位置及其周围八格一定没有雷。</p>
            <p className="ms-overlay-hint">触屏用「标记模式」插旗；撤销最多 3 次；单局限时 3 分钟。</p>
            <div className="ms-diff-list" aria-label="选择难度">
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className="ms-diff-btn"
                  onClick={() => handleStart(lv)}
                  aria-label={`${DIFFICULTY[lv].label}难度，${DIFFICULTY[lv].desc}，限时 ${DIFFICULTY[lv].limitSec} 秒`}
                >
                  <span className="ms-diff-name">{DIFFICULTY[lv].label}</span>
                  <span className="ms-diff-meta">
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
        <div className="ms-overlay">
          <div className="ms-overlay-card">
            <h2>{pausedAuto ? '已自动暂停' : '已暂停'}</h2>
            <p>{pausedAuto ? '检测到页面切走或窗口失焦，计时已冻结。' : '手动暂停中，计时已冻结。'}</p>
            <div className="ms-btns">
              <button type="button" className="ms-btn-primary" onClick={handleResume}>继续</button>
              <Link to="/" className="ms-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* over 遮罩 */}
      {screen === 'over' && (
        <div className="ms-overlay">
          <div className={`ms-overlay-card${finalResult === 'win' ? ' ms-overlay-win' : ''}`}>
            <h2>{RESULT_TITLE[finalResult] || '本局结束'}</h2>
            <p>{RESULT_DESC[finalResult] || ''}</p>
            <div className="ms-summary">
              <div><span>难度</span><strong>{DIFFICULTY[finalLevel]?.label}</strong></div>
              <div><span>用时</span><strong>{_fmtTime(finalElapsed)}</strong></div>
              <div><span>已翻开</span><strong>{finalRevealed}</strong></div>
              <div><span>标记</span><strong>{finalFlags}</strong></div>
              <div><span>撤销剩余</span><strong>{finalUndoLeft}</strong></div>
              <div><span>得分</span><strong>{finalScore}</strong></div>
            </div>
            <p className="ms-best">
              历史最佳：<strong>{bestOfLevel(finalLevel) ?? '—'}</strong>
              {saveError && <span className="ms-save-err">（本局成绩未保存，本地存储不可用）</span>}
            </p>
            <div className="ms-btns">
              <button type="button" className="ms-btn-primary" onClick={() => handleStart(finalLevel)}>再来一局</button>
              <Link to="/" className="ms-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 按行渲染：行 role=row，格 role=gridcell，内部原生 button（roving tabindex） */
function _renderRows(snapshot, focusedIdx, canPlay, onCell) {
  const { cells, rows, cols, lastReveal } = snapshot
  const lastIdx = lastReveal?.idx ?? -1
  const out = []
  for (let r = 0; r < rows; r++) {
    const rowCells = []
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const cell = cells[idx]
      const open = cell.revealed
      const showFlag = cell.flagged && !open
      const showMine = !showFlag && cell.mine && !open
      const n = open ? cell.adj : 0
      const stateText = showFlag
        ? '已插旗'
        : open
          ? n > 0 ? `相邻 ${n} 颗雷` : '空白格'
          : cell.mine
            ? cell.boom ? '踩中的地雷' : '地雷'
            : '未翻开'

      rowCells.push(
        <div key={idx} role="gridcell" className="ms-cell-wrap">
          <button
            type="button"
            data-idx={idx}
            className={`ms-cell${open ? ' ms-open' : ''}${open && n > 0 ? ` ms-n${n}` : ''}${showFlag ? ' ms-flagged' : ''}${showMine ? ' ms-mine-cell' : ''}${cell.boom ? ' ms-boom' : ''}${idx === lastIdx ? ' ms-new' : ''}`}
            tabIndex={focusedIdx === idx ? 0 : -1}
            aria-disabled={!canPlay}
            aria-label={`第${r + 1}行第${c + 1}列，${stateText}`}
            onClick={() => onCell(idx)}
          >
            {showFlag && <span className="ms-flag" aria-hidden="true" />}
            {showMine && <span className="ms-mine-icon" aria-hidden="true" />}
            {open && n > 0 && <span className="ms-num" aria-hidden="true">{n}</span>}
          </button>
        </div>,
      )
    }
    out.push(<div key={r} role="row" className="ms-row">{rowCells}</div>)
  }
  return out
}

export default MinesweeperPage
