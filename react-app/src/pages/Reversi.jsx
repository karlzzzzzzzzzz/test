import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ReversiEngine, DIFFICULTY, REVERSI } from '../game/ReversiEngine'
import './Reversi.css'

const BEST_KEY = 'game-reversi-best-v1'
const STATS_KEY = 'game-reversi-stats-v1'
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
  win: '你赢了！',
  lose: '电脑赢了',
  draw: '平局',
  timeout: '时间到',
}

const RESULT_DESC = {
  win: '终局时你的黑子更多，赢下本局。',
  lose: '终局时电脑的白子更多，再试一次吧。',
  draw: '终局时黑白子数相同，本局平局。',
  timeout: '180 秒倒计时归零，本局结束。',
}

/**
 * 黑白棋页面壳
 * 架构对齐 Connect4.jsx：四态 UI + 引擎回调 + visibility/blur 双路去重暂停；
 * 无障碍：role=grid + roving tabindex + aria-live 播报；触控为原生 button 点按。
 */
function ReversiPage() {
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
  const [focusedIdx, setFocusedIdx] = useState(26)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [best, setBest] = useState(loadBest)
  const [saveError, setSaveError] = useState(false)

  const [finalResult, setFinalResult] = useState('win')
  const [finalScore, setFinalScore] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState(0)
  const [finalMoves, setFinalMoves] = useState(0)
  const [finalLevel, setFinalLevel] = useState('easy')
  const [finalCounts, setFinalCounts] = useState({ player: 0, ai: 0 })

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
    const engine = new ReversiEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state !== stateRef.current) changeScreen(snap.state)

        // aria-live：同一动作只播报一次（tick 每 250ms 复用同一 lastAction）
        const key = `${snap.lastAction}:${snap.moves}:${snap.turn}`
        if (key !== announceKeyRef.current) {
          announceKeyRef.current = key
          const mv = snap.lastMove
          if (snap.lastAction === 'start') setLiveAnnounce('游戏开始，你先落子')
          else if (snap.lastAction === 'tap' && mv) {
            setLiveAnnounce(`你在第${mv.row + 1}行第${mv.col + 1}列落子，翻${mv.flips.length}子，电脑思考中`)
          } else if (snap.lastAction === 'ai' && mv) {
            setLiveAnnounce(`电脑在第${mv.row + 1}行第${mv.col + 1}列落子，翻${mv.flips.length}子，轮到你`)
          } else if (snap.lastAction === 'pass') {
            setLiveAnnounce(snap.passBy === 'ai' ? '对手没有合法落点，自动跳过' : '你没有合法落点，自动跳过')
          } else if (snap.lastAction === 'win') setLiveAnnounce('你赢了，终局时黑子更多')
          else if (snap.lastAction === 'lose') setLiveAnnounce('电脑赢了，终局时白子更多')
          else if (snap.lastAction === 'draw') setLiveAnnounce('平局，黑白子数相同')
          else if (snap.lastAction === 'timeout') setLiveAnnounce('时间到，本局结束')
          else if (snap.lastAction === 'pause') setLiveAnnounce('已暂停')
          else if (snap.lastAction === 'resume') setLiveAnnounce('继续游戏')
        }
      },
      onGameOver: (score, elapsed, result) => {
        const snap = snapshotRef.current
        const level = snap?.level || 'easy'
        const moves = snap?.moves || 0
        const counts = snap?.counts || { player: 0, ai: 0 }
        setFinalLevel(level)
        setFinalElapsed(elapsed)
        setFinalMoves(moves)
        setFinalResult(result)
        setFinalScore(score)
        setFinalCounts(counts)

        if (result === 'win') bumpStats((s) => {
          s.wins[level] = (s.wins[level] || 0) + 1
          s.moves += moves
          s.timeByLevel[level] = Math.round(((s.timeByLevel[level] || 0) + elapsed) * 10) / 10
        })
        else if (result === 'lose') bumpStats((s) => { s.losses[level] = (s.losses[level] || 0) + 1 })
        else if (result === 'draw') bumpStats((s) => { s.draws[level] = (s.draws[level] || 0) + 1 })
        else if (result === 'timeout') bumpStats((s) => { s.draws[level] = (s.draws[level] || 0) + 1 })

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
          document.querySelector('.r-overlay-card .r-btn-primary')?.focus()
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
    const timer = setInterval(() => engineRef.current?.tick(), REVERSI.TICK_MS)
    return () => clearInterval(timer)
  }, [screen])

  // ---------- 电脑落子：思考延迟后执行；暂停时清理，恢复后重新调度 ----------
  useEffect(() => {
    if (screen !== 'playing') return
    if (!snapshot || snapshot.state !== 'playing' || snapshot.turn !== 'ai') return
    const timer = setTimeout(() => engineRef.current?.aiTurn(), REVERSI.AI_DELAY_MS)
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
    setFocusedIdx(26)
    setPausedAuto(false)
    setTimeout(() => {
      document.querySelector('.r-board .r-cell[tabindex="0"]')?.focus()
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
      document.querySelector(`.r-cell[data-idx="${focusedIdx}"]`)?.focus()
    }, 0)
  }

  const handleTap = (idx) => {
    const snap = snapshotRef.current
    if (!snap || snap.state !== 'playing' || snap.turn !== 'player') return
    setFocusedIdx(idx)
    const ok = engineRef.current?.tap(idx)
    if (!ok) {
      const row = Math.floor(idx / REVERSI.SIZE) + 1
      const col = (idx % REVERSI.SIZE) + 1
      setLiveAnnounce('')
      setTimeout(() => setLiveAnnounce(`第${row}行第${col}列不能落子`), 0)
    }
  }

  // ---------- 键盘：方向键移动焦点 + Enter/Space 由原生 button 触发落子 ----------
  const handleBoardKeyDown = (e) => {
    const snap = snapshotRef.current
    if (!snap || snap.state !== 'playing') return
    const size = snap.size
    const r = Math.floor(focusedIdx / size)
    const c = focusedIdx % size
    let nr = r
    let nc = c
    const key = e.key

    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End') {
      e.preventDefault()
      if (key === 'ArrowUp') nr = Math.max(0, r - 1)
      else if (key === 'ArrowDown') nr = Math.min(size - 1, r + 1)
      else if (key === 'ArrowLeft') nc = Math.max(0, c - 1)
      else if (key === 'ArrowRight') nc = Math.min(size - 1, c + 1)
      else if (key === 'Home') nc = 0
      else if (key === 'End') nc = size - 1
      const next = nr * size + nc
      setFocusedIdx(next)
      document.querySelector(`.r-cell[data-idx="${next}"]`)?.focus()
    }
  }

  const bestOfLevel = (level) => best[level]?.score
  const canPlay = screen === 'playing' && snapshot?.turn === 'player'
  const showBoard = snapshot && snapshot.state !== 'start' && screen !== 'over'

  return (
    <div className="r-page" role="application" aria-label="黑白棋小游戏">
      <header className="r-top">
        <Link to="/" className="r-back" aria-label="返回首页">← 首页</Link>
        <h1 className="r-title">黑白棋</h1>
        {screen !== 'start' && (
          <button
            type="button"
            className="r-pause-btn"
            onClick={screen === 'paused' ? handleResume : handlePause}
            aria-label={screen === 'paused' ? '继续游戏' : '暂停游戏'}
          >
            {screen === 'paused' ? '继续' : '暂停'}
          </button>
        )}
      </header>

      {/* HUD */}
      <div className="r-hud" aria-label="游戏信息">
        <div className="r-stat">
          <span className="r-stat-label">步数</span>
          <span className="r-stat-val">{snapshot?.state === 'start' ? '—' : snapshot?.moves ?? '—'}</span>
        </div>
        <div className="r-stat">
          <span className="r-stat-label">黑子</span>
          <span className="r-stat-val r-stat-dark">{snapshot?.state === 'start' ? '—' : snapshot?.counts?.player ?? '—'}</span>
        </div>
        <div className="r-stat">
          <span className="r-stat-label">白子</span>
          <span className="r-stat-val r-stat-light">{snapshot?.state === 'start' ? '—' : snapshot?.counts?.ai ?? '—'}</span>
        </div>
        <div className="r-stat">
          <span className="r-stat-label">倒计时</span>
          <span className="r-stat-val r-timer" role="timer" aria-live="off">
            {snapshot && snapshot.state !== 'start' ? _fmtTime(snapshot.remaining) : _fmtTime(DIFFICULTY.easy.limitSec)}
          </span>
        </div>
      </div>

      <div className="r-turn" aria-hidden="true">
        {screen === 'playing' && (snapshot?.turn === 'ai' ? '电脑思考中…' : snapshot?.passBy ? '对手已跳过，轮到你落子' : '轮到你落子')}
        {screen === 'paused' && '已暂停'}
        {screen === 'over' && '本局结束'}
      </div>

      {/* 读屏播报（视觉隐藏） */}
      <div aria-live="polite" aria-atomic="true" className="r-live-region">{liveAnnounce}</div>

      {/* 棋盘 */}
      {showBoard && (
        <div
          className="r-board-wrap"
          style={{ pointerEvents: screen === 'paused' ? 'none' : 'auto' }}
          aria-hidden={screen === 'paused'}
        >
          <div
            className="r-board"
            role="grid"
            aria-label={`${REVERSI.SIZE} 行 ${REVERSI.SIZE} 列黑白棋棋盘，点按合法空格落子`}
            tabIndex={-1}
            onKeyDown={handleBoardKeyDown}
          >
            {_renderRows(snapshot, focusedIdx, canPlay, handleTap)}
          </div>
        </div>
      )}

      {/* 底部动作区 */}
      {(screen === 'playing' || screen === 'paused') && (
        <div className="r-actions">
          <button
            type="button"
            className="r-btn"
            onClick={() => handleStart(snapshot?.level || 'easy')}
            disabled={screen === 'paused'}
          >
            重新开局
          </button>
          <Link to="/" className="r-btn">返回首页</Link>
        </div>
      )}

      <p className="r-hint">点按带小圆点的空格落子，被夹住的白子会全部翻成黑子；终局时子多者胜。</p>

      {/* start 遮罩 */}
      {screen === 'start' && (
        <div className="r-overlay">
          <div className="r-overlay-card">
            <h2>黑白棋</h2>
            <p>8×8 棋盘，你先执黑。落子必须夹住至少一枚白子，夹住的白子会翻成黑子；终局时子多者胜。</p>
            <p className="r-overlay-hint">对手无子可落时自动跳过；单局限时 3 分钟。</p>
            <div className="r-diff-list" aria-label="选择难度">
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className="r-diff-btn"
                  onClick={() => handleStart(lv)}
                  aria-label={`${DIFFICULTY[lv].label}难度，${DIFFICULTY[lv].desc}，限时 ${DIFFICULTY[lv].limitSec} 秒`}
                >
                  <span className="r-diff-name">{DIFFICULTY[lv].label}</span>
                  <span className="r-diff-meta">
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
        <div className="r-overlay">
          <div className="r-overlay-card">
            <h2>{pausedAuto ? '已自动暂停' : '已暂停'}</h2>
            <p>{pausedAuto ? '检测到页面切走或窗口失焦，计时已冻结。' : '手动暂停中，计时已冻结。'}</p>
            <div className="r-btns">
              <button type="button" className="r-btn-primary" onClick={handleResume}>继续</button>
              <Link to="/" className="r-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* over 遮罩 */}
      {screen === 'over' && (
        <div className="r-overlay">
          <div className={`r-overlay-card${finalResult === 'win' ? ' r-overlay-win' : ''}`}>
            <h2>{RESULT_TITLE[finalResult] || '本局结束'}</h2>
            <p>{RESULT_DESC[finalResult] || ''}</p>
            <div className="r-summary">
              <div><span>难度</span><strong>{DIFFICULTY[finalLevel]?.label}</strong></div>
              <div><span>步数</span><strong>{finalMoves}</strong></div>
              <div><span>黑 / 白</span><strong>{finalCounts.player} / {finalCounts.ai}</strong></div>
              <div><span>用时</span><strong>{_fmtTime(finalElapsed)}</strong></div>
              <div><span>得分</span><strong>{finalScore}</strong></div>
              <div><span>限时</span><strong>{DIFFICULTY[finalLevel]?.limitSec}s</strong></div>
            </div>
            <p className="r-best">
              历史最佳：<strong>{bestOfLevel(finalLevel) ?? '—'}</strong>
              {saveError && <span className="r-save-err">（本局成绩未保存，本地存储不可用）</span>}
            </p>
            <div className="r-btns">
              <button type="button" className="r-btn-primary" onClick={() => handleStart(finalLevel)}>再来一局</button>
              <Link to="/" className="r-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 按行渲染：行 role=row，格 role=gridcell，内部原生 button（roving tabindex） */
function _renderRows(snapshot, focusedIdx, canPlay, onTap) {
  const { board, legal, lastMove } = snapshot
  const size = snapshot.size
  const legalSet = new Set(legal || [])
  const flipSet = new Set(lastMove?.flips || [])
  const out = []
  for (let r = 0; r < size; r++) {
    const rowCells = []
    for (let c = 0; c < size; c++) {
      const idx = r * size + c
      const who = board[idx]
      const isLegal = legalSet.has(idx)
      const isLast = lastMove?.idx === idx
      const flipped = flipSet.has(idx)
      const label = who === REVERSI.PLAYER ? '你的黑子' : who === REVERSI.AI ? '电脑的白子' : isLegal ? '合法落点' : '空位'
      const tip = who === 0 && isLegal ? '，点按在此落子' : ''
      rowCells.push(
        <div key={idx} role="gridcell" className="r-cell-wrap">
          <button
            type="button"
            data-idx={idx}
            className={`r-cell${who === REVERSI.PLAYER ? ' r-dark' : who === REVERSI.AI ? ' r-light' : ''}${isLegal ? ' r-legal' : ''}${isLast ? ' r-last' : ''}${flipped ? ' r-flip' : ''}`}
            tabIndex={focusedIdx === idx ? 0 : -1}
            aria-disabled={!canPlay}
            aria-label={`第${r + 1}行第${c + 1}列，${label}${tip}`}
            onClick={() => onTap(idx)}
          >
            {who === 0 && isLegal && <span className="r-dot" aria-hidden="true" />}
            {who !== 0 && <span className="r-disc" aria-hidden="true" />}
          </button>
        </div>
      )
    }
    out.push(<div key={r} role="row" className="r-row">{rowCells}</div>)
  }
  return out
}

export default ReversiPage
