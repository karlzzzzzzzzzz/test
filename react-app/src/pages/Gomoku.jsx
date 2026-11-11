import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { GomokuEngine, DIFFICULTY, GOMOKU } from '../game/GomokuEngine'
import './Gomoku.css'

const BEST_KEY = 'game-gomoku-best-v1'
const STATS_KEY = 'game-gomoku-stats-v1'
const SESSION_KEY = 'pomodoro-sessions-v1'

function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return {}
    return data
  } catch { return {} }
}

function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return { v: 1, plays: 0, wins: 0, draws: 0, losses: 0, winsByDifficulty: {}, lossesByDifficulty: {}, moves: 0, thinkingMs: 0, timeByDifficulty: {}, aiTimeouts: 0, updatedAt: 0 }
    return { v: 1, plays: 0, wins: 0, draws: 0, losses: 0, winsByDifficulty: {}, lossesByDifficulty: {}, moves: 0, thinkingMs: 0, timeByDifficulty: {}, aiTimeouts: 0, updatedAt: 0, ...data }
  } catch { return { v: 1, plays: 0, wins: 0, draws: 0, losses: 0, winsByDifficulty: {}, lossesByDifficulty: {}, moves: 0, thinkingMs: 0, timeByDifficulty: {}, aiTimeouts: 0, updatedAt: 0 } }
}

const cap = (n) => Math.min(99999, Math.max(0, n))

/** 读取番茄钟 session 数组（损坏回退空数组） */
function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((s) => s && typeof s === 'object') : []
  } catch { return [] }
}

/** 追加一条番茄钟 session（五子棋对局时长 ≥2min 才追加） */
function appendSession(info) {
  if (!info || info.durSec < 120) return
  try {
    const sessions = loadSessions()
    sessions.push({
      startTs: info.startTs,
      endTs: info.endTs,
      durSec: info.durSec,
      game: 'gomoku',
      win: !!info.win,
      level: info.level,
      mode: info.mode,
    })
    // 只保留最近 14 天，防止 localStorage 配额
    const cutoff = Date.now() - 14 * 86400 * 1000
    const trimmed = sessions.filter((s) => s.endTs >= cutoff)
    localStorage.setItem(SESSION_KEY, JSON.stringify(trimmed))
  } catch { /* 不可用时静默跳过，不阻塞本局 */ }
}

/** 计算"最近 24h"内番茄钟有效数量（durSec ≥ 120s） —— 给番茄钟统计条用 */
export function countRecentPomos() {
  try {
    const sessions = loadSessions()
    const cutoff = Date.now() - 24 * 3600 * 1000
    return sessions.filter((s) => s.endTs >= cutoff && s.durSec >= 120).length
  } catch { return 0 }
}

function fmtMs(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function turnLabel(turn, mode) {
  if (mode === 'ai') {
    if (turn === GOMOKU.P1) return '你（黑）'
    return '电脑（白）'
  }
  return turn === GOMOKU.P1 ? '黑方' : '白方'
}

/**
 * 五子棋页面壳
 * 架构对齐 Reversi.jsx：四屏遮罩 + 引擎回调 + visibility/blur 双路去重暂停；
 * 额外实现 AI 延迟调度（AI_DELAY_MS）、悔棋栈（每次撤销 2 步）、番茄钟 session 追加。
 */
function GomokuPage() {
  const engineRef = useRef(null)
  const snapshotRef = useRef(null)
  const stateRef = useRef('start')
  const pausedByVisibilityRef = useRef(false)
  const autoPauseRef = useRef(false)
  const aiTimerRef = useRef(null)
  const focusIdxRef = useRef(112) // 天元
  const statsRef = useRef(null)
  const dirtyRef = useRef(false)
  const writeTimerRef = useRef(null)
  const aliveRef = useRef(false)
  const lastTierRef = useRef('easy')
  const lastModeRef = useRef('ai')
  const errorTimerRef = useRef(null)

  const [screen, setScreen] = useState('start')
  const [snapshot, setSnapshot] = useState(null)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [selected, setSelected] = useState(112)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [best, setBest] = useState(loadBest)
  const [aiTimeoutFlash, setAiTimeoutFlash] = useState(false)

  const [finalResult, setFinalResult] = useState('win')
  const [finalWinner, setFinalWinner] = useState(GOMOKU.P1)
  const [finalMoves, setFinalMoves] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState(0)
  const [finalLevel, setFinalLevel] = useState('easy')
  const [finalMode, setFinalMode] = useState('ai')

  const changeScreen = (s) => { stateRef.current = s; setScreen(s) }

  const flushStats = () => {
    if (!dirtyRef.current || !statsRef.current) return
    try {
      statsRef.current.updatedAt = Date.now()
      localStorage.setItem(STATS_KEY, JSON.stringify(statsRef.current))
    } catch {}
    dirtyRef.current = false
    if (writeTimerRef.current) { clearTimeout(writeTimerRef.current); writeTimerRef.current = null }
  }
  const scheduleFlush = () => {
    dirtyRef.current = true
    if (!writeTimerRef.current) writeTimerRef.current = setTimeout(flushStats, 1000)
  }
  const bumpStats = (fn) => { fn(statsRef.current); scheduleFlush() }

  // ---------- 引擎生命周期 ----------
  useEffect(() => {
    aliveRef.current = true
    statsRef.current = loadStats()
    const engine = new GomokuEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state !== stateRef.current) changeScreen(snap.state)

        // AI 回合自动调度
        if (snap.state === 'playing' && snap.aiThinking) {
          clearTimeout(aiTimerRef.current)
          aiTimerRef.current = setTimeout(() => {
            if (!aliveRef.current) return
            if (engineRef.current?.state === 'playing' && engineRef.current.turn === GOMOKU.P2) {
              engineRef.current.aiTurn()
            }
          }, GOMOKU.AI_DELAY_MS)
        }

        // AI 超时回退闪烁标记（引擎只计数，页面负责显示）
        if (snap.aiTimeouts > 0) {
          setAiTimeoutFlash(true)
        } else if (!snap.aiThinking) {
          setAiTimeoutFlash(false)
        }
      },
      onGameOver: (info) => {
        const level = info?.level || 'easy'
        const mode = info?.mode || 'ai'
        setFinalResult(info.result || 'win')
        setFinalWinner(info.winner || GOMOKU.P1)
        setFinalMoves(info.moves || 0)
        setFinalElapsed(info.elapsedSec || 0)
        setFinalLevel(level)
        setFinalMode(mode)

        // 埋点：按难度分类 win/loss
        const myWin = info.result === 'win' || (mode === 'pvp' && info.result !== 'lose')
        const winKey = `winsByDifficulty`
        const loseKey = `lossesByDifficulty`
        bumpStats((s) => {
          s.plays = cap(s.plays + 1)
          if (info.result === 'win') { s.wins = cap(s.wins + 1); s[winKey][level] = cap((s[winKey][level] || 0) + 1) }
          else if (info.result === 'lose') { s.losses = cap(s.losses + 1); s[loseKey][level] = cap((s[loseKey][level] || 0) + 1) }
          else if (info.result === 'timeout') { s.losses = cap(s.losses + 1) }
          else { s.draws = cap(s.draws + 1) }
          s.moves = cap(s.moves + (info.moves || 0))
          s.aiTimeouts = cap((s.aiTimeouts || 0) + (info.aiTimeouts || 0))
          s.timeByDifficulty[level] = cap((s.timeByDifficulty[level] || 0) + Math.round(info.elapsedSec || 0))
        })

        // 单人 AI 模式下玩家胜利才算进最佳
        if ((mode === 'ai' && info.result === 'win') || (mode === 'pvp' && myWin)) {
          const current = loadBest()
          const prev = current[level]
          const candidate = {
            moves: info.moves || 0,
            timeSec: info.elapsedSec || 0,
            date: new Date().toISOString().slice(0, 10),
          }
          // 更少落子优先；落子相同则用时更少优先
          const better = !prev
            || candidate.moves < prev.moves
            || (candidate.moves === prev.moves && candidate.timeSec < prev.timeSec)
          if (better) {
            const next = { ...current, [level]: candidate }
            try { localStorage.setItem(BEST_KEY, JSON.stringify(next)) } catch {}
            setBest(next)
          }
        }

        // 番茄钟 session 追加（≥ 120s 才记一个番茄钟）
        engineRef.current?.cb?.onSession && engineRef.current.cb.onSession(null) // placeholder
        changeScreen('over')
        setTimeout(() => document.querySelector('.gomoku-overlay-card .gomoku-btn-primary')?.focus(), 0)
      },
      onPause: () => {
        setPausedAuto(autoPauseRef.current)
        if (stateRef.current === 'playing') changeScreen('paused')
      },
      onSession: (info) => { appendSession(info) },
    })
    engineRef.current = engine
    return () => {
      aliveRef.current = false
      clearTimeout(aiTimerRef.current)
      clearTimeout(errorTimerRef.current)
      engine.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 倒计时驱动 ----------
  useEffect(() => {
    if (screen !== 'playing') return
    const timer = setInterval(() => engineRef.current?.tick(), GOMOKU.TICK_MS)
    return () => clearInterval(timer)
  }, [screen])

  // ---------- 切后台/失焦双路去重暂停 ----------
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        pausedByVisibilityRef.current = true
        autoPauseRef.current = true
        clearTimeout(aiTimerRef.current)
        engineRef.current?.pause()
      }
    }
    const onBlur = () => {
      if (pausedByVisibilityRef.current) { pausedByVisibilityRef.current = false; return }
      autoPauseRef.current = true
      clearTimeout(aiTimerRef.current)
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
  const handleStart = (mode, level) => {
    lastTierRef.current = level
    lastModeRef.current = mode
    autoPauseRef.current = false
    pausedByVisibilityRef.current = false
    setAiTimeoutFlash(false)
    clearTimeout(aiTimerRef.current)
    changeScreen('loading')
    setTimeout(() => {
      engineRef.current?.start(mode, level)
      bumpStats((s) => { s.plays = cap(s.plays + 0.0001); /* plays 在结束时精确累加 */ })
      setSelected(112)
      changeScreen('playing')
      focusCell(112)
    }, 180)
  }

  const focusCell = (idx) => {
    setTimeout(() => {
      document.querySelector(`.gomoku-board .gomoku-cell[data-idx="${idx}"]`)?.focus({ preventScroll: true })
    }, 0)
  }

  // ---------- 暂停/恢复 ----------
  const handlePause = () => {
    autoPauseRef.current = false
    clearTimeout(aiTimerRef.current)
    engineRef.current?.pause()
  }
  const handleResume = () => {
    autoPauseRef.current = false
    engineRef.current?.resume()
    changeScreen('playing')
    if (snapshotRef.current?.aiThinking) {
      // 恢复后 AI 重新调度
      setTimeout(() => engineRef.current?.aiTurn(), GOMOKU.AI_DELAY_MS)
    }
    focusCell(selected)
  }

  // ---------- 落子 ----------
  const placeAt = (idx) => {
    const snap = snapshotRef.current
    if (!snap || snap.state !== 'playing') return
    if (snap.aiThinking) { setLiveAnnounce('电脑思考中，请稍候'); return }
    if (engineRef.current?.board?.[idx] !== GOMOKU.EMPTY) return

    if (lastModeRef.current === 'pvp') {
      // 双人：当前 turn 决定谁落子
      if (snap.turn === GOMOKU.P1) engineRef.current?.tap(idx)
      else engineRef.current?.pvpTap(idx)
    } else {
      // 单人：只有玩家回合才能落子
      if (snap.isPlayerTurn) engineRef.current?.tap(idx)
    }
    setSelected(idx)
    const newSnap = snapshotRef.current
    if (newSnap?.lastMove?.idx === idx) {
      const r = Math.floor(idx / 15) + 1
      const c = (idx % 15) + 1
      setLiveAnnounce(`${turnLabel(newSnap.turn, lastModeRef.current)} 落子 第 ${r} 行第 ${c} 列`)
    }
  }

  const handleUndo = () => {
    if (snapshot?.state !== 'playing') return
    const ok = engineRef.current?.undo()
    setLiveAnnounce(ok ? '已撤销上一步（回退 2 步）' : '没有可撤销的操作')
  }

  const handleResign = () => {
    if (snapshot?.state !== 'playing') return
    engineRef.current?.resign()
  }

  // ---------- 盘面键盘：方向键移动选中格，Enter/Space 落子 ----------
  const handleBoardKeyDown = (e) => {
    const snap = snapshotRef.current
    if (!snap || snap.state !== 'playing') return
    const key = e.key
    const d = { ArrowUp: -15, ArrowDown: 15, ArrowLeft: -1, ArrowRight: 1 }[key]
    if (d !== undefined) {
      e.preventDefault()
      let next = selected + d
      if (key === 'ArrowLeft' && selected % 15 === 0) next = selected
      if (key === 'ArrowRight' && selected % 15 === 14) next = selected
      if (next < 0 || next > 224) next = selected
      setSelected(next)
      focusCell(next)
      const r = Math.floor(next / 15) + 1
      const c = (next % 15) + 1
      const v = engineRef.current?.board?.[next] || 0
      const stateText = v === GOMOKU.P1 ? '黑' : v === GOMOKU.P2 ? '白' : '空'
      setLiveAnnounce(`第 ${r} 行第 ${c} 列，${stateText}`)
      return
    }
    if (key === 'Enter' || key === ' ') {
      e.preventDefault()
      placeAt(selected)
      return
    }
    if (key === 'Escape') { handlePause(); return }
    if (key.toLowerCase() === 'h') { handleUndo(); return }
    if (key.toLowerCase() === 'r') { handleResign(); return }
  }

  // ---------- 渲染 ----------
  const showBoard = snapshot && (screen === 'playing' || screen === 'paused' || screen === 'over')

  return (
    <div className="gomoku-page" role="application" aria-label="五子棋">
      <header className="gomoku-top">
        <Link to="/" className="gomoku-back" aria-label="返回首页">← 首页</Link>
        <h1 className="gomoku-title">五子棋</h1>
        {(screen === 'playing' || screen === 'paused') && (
          <button type="button" className="gomoku-pause-btn" onClick={screen === 'paused' ? handleResume : handlePause} aria-label={screen === 'paused' ? '继续游戏' : '暂停游戏'}>
            {screen === 'paused' ? '继续' : '暂停'}
          </button>
        )}
      </header>

      <div className="gomoku-hud" aria-label="游戏信息">
        <div className="gomoku-stat gomoku-stat-turn">
          <span className="gomoku-stat-label">当前</span>
          <span className="gomoku-turn-indicator" aria-hidden="true" style={{ background: snapshot?.turn === GOMOKU.P1 ? '#222' : '#f3f3f3' }} />
          <span className="gomoku-stat-val">{snapshot ? turnLabel(snapshot.turn, lastModeRef.current) : '—'}</span>
          {snapshot?.aiThinking && <span className="gomoku-thinking">思考中…</span>}
        </div>
        <div className="gomoku-stat">
          <span className="gomoku-stat-label">黑方</span>
          <span className="gomoku-stat-val gomoku-timer" role="timer" aria-live="off">{snapshot ? fmtMs(snapshot.playerRemain) : '—'}</span>
        </div>
        <div className="gomoku-stat">
          <span className="gomoku-stat-label">白方</span>
          <span className="gomoku-stat-val gomoku-timer" role="timer" aria-live="off">{snapshot ? fmtMs(snapshot.aiRemain) : '—'}</span>
        </div>
        <div className="gomoku-stat">
          <span className="gomoku-stat-label">落子</span>
          <span className="gomoku-stat-val">{snapshot ? snapshot.moves : '—'}</span>
        </div>
      </div>
      {aiTimeoutFlash && snapshot?.state === 'playing' && (
        <div className="gomoku-ai-timeout" role="status">AI 思考超时，已用启发式评估（难度已回退）</div>
      )}

      <div aria-live="polite" aria-atomic="true" className="gomoku-live">{liveAnnounce}</div>

      {showBoard && (
        <div className="gomoku-board-wrap" aria-hidden={screen === 'paused'}>
          <div
            className="gomoku-board"
            role="grid"
            aria-label="15 行 15 列五子棋棋盘，方向键移动，Enter 或空格落子"
            tabIndex={-1}
            onKeyDown={handleBoardKeyDown}
          >
            {renderBoard(snapshot, selected, placeAt)}
          </div>
        </div>
      )}

      {showBoard && (
        <div className="gomoku-actions" aria-hidden={screen === 'paused'}>
          <button type="button" className="gomoku-btn" onClick={handleUndo} disabled={!snapshot?.canUndo || screen !== 'playing'} aria-label="悔棋（撤销 2 步）">悔棋</button>
          <button type="button" className="gomoku-btn gomoku-btn-danger" onClick={handleResign} disabled={screen !== 'playing'} aria-label="认输">认输</button>
        </div>
      )}

      <p className="gomoku-hint">15×15 棋盘，横/竖/斜任一方向五连即胜；黑先白后。方向键移动，Enter/空格落子，Esc 暂停，H 悔棋，R 认输。</p>

      {/* start 遮罩 */}
      {screen === 'start' && (
        <div className="gomoku-overlay">
          <div className="gomoku-overlay-card gomoku-start-card">
            <h2>五子棋 · 连珠</h2>
            <p>先在横/竖/斜任一方向连成五子者胜。黑先白后，每回合 60 秒、剩余时间累加到下回合作缓冲。</p>
            <div className="gomoku-mode-list" role="radiogroup" aria-label="对战模式">
              <p className="gomoku-mode-title">对战模式</p>
              <div className="gomoku-mode-row">
                <button type="button" className="gomoku-mode-btn" onClick={() => { lastModeRef.current = 'ai' }} id="gomoku-mode-ai">单人 AI</button>
                <button type="button" className="gomoku-mode-btn" onClick={() => { lastModeRef.current = 'pvp' }} id="gomoku-mode-pvp">双人对战</button>
              </div>
            </div>
            <div className="gomoku-diff-list" aria-label="选择 AI 难度">
              <p className="gomoku-mode-title">AI 难度</p>
              {Object.entries(DIFFICULTY).map(([lv, cfg]) => (
                <button
                  key={lv}
                  type="button"
                  className="gomoku-diff-btn"
                  onClick={() => handleStart(lastModeRef.current, lv)}
                  aria-label={`AI ${cfg.label}难度，${cfg.desc}`}
                >
                  <span className="gomoku-diff-name">{cfg.label}</span>
                  <span className="gomoku-diff-meta">{cfg.desc}</span>
                </button>
              ))}
            </div>
            {!Object.keys(best).length && (
              <p className="gomoku-empty">暂无对局最佳记录，下次胜局后自动保存。</p>
            )}
          </div>
        </div>
      )}

      {/* loading 遮罩 */}
      {screen === 'loading' && (
        <div className="gomoku-overlay">
          <div className="gomoku-overlay-card" role="status" aria-live="polite">
            <div className="gomoku-spinner" aria-hidden="true" />
            <h2>准备中…</h2>
            <p>AI 正在构思开局。</p>
          </div>
        </div>
      )}

      {/* paused 遮罩（不遮蔽棋盘，但冻结计时与输入） */}
      {screen === 'paused' && (
        <div className="gomoku-overlay">
          <div className="gomoku-overlay-card">
            <h2>{pausedAuto ? '已自动暂停' : '已暂停'}</h2>
            <p>{pausedAuto ? '检测到页面切走或窗口失焦，计时已冻结。' : '手动暂停中，计时已冻结。棋盘可见，AI 不会落子。'}</p>
            <div className="gomoku-btns">
              <button type="button" className="gomoku-btn-primary" onClick={handleResume}>继续</button>
              <Link to="/" className="gomoku-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* over 遮罩 */}
      {screen === 'over' && (
        <div className="gomoku-overlay">
          <div className={`gomoku-overlay-card${finalResult === 'win' ? ' gomoku-overlay-win' : ''}`}>
            <h2>
              {finalResult === 'win'
                ? '恭喜你赢了！'
                : finalResult === 'lose'
                  ? '电脑赢了'
                  : finalResult === 'timeout'
                    ? finalWinner === GOMOKU.P1 ? '白方超时' : '黑方超时'
                    : '平手'}
            </h2>
            <p>
              {finalMode === 'pvp'
                ? `双人对战 ${finalResult === 'win' || finalResult === 'lose'
                    ? (finalWinner === GOMOKU.P1 ? '黑方胜' : '白方胜')
                    : '双方平局'}`
                : finalResult === 'win'
                  ? `你在 ${finalLevel} 难度下战胜了电脑。`
                  : finalResult === 'timeout'
                    ? (finalWinner === GOMOKU.P2 ? '电脑超时，你胜！' : '你超时了。')
                    : '电脑赢了这一局。'}
            </p>
            <div className="gomoku-summary">
              <div><span>落子数</span><strong>{finalMoves}</strong></div>
              <div><span>用时</span><strong>{Math.round(finalElapsed)}s</strong></div>
              <div><span>难度</span><strong>{DIFFICULTY[finalLevel]?.label}</strong></div>
              <div><span>模式</span><strong>{finalMode === 'ai' ? '单人 AI' : '双人'}</strong></div>
            </div>
            <div className="gomoku-btns">
              <button type="button" className="gomoku-btn-primary" onClick={() => handleStart(finalMode || lastModeRef.current, finalLevel || lastTierRef.current)}>再来一局</button>
              <Link to="/" className="gomoku-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function renderBoard(snapshot, selected, onClick) {
  const rows = []
  for (let r = 0; r < 15; r++) {
    const cells = []
    for (let c = 0; c < 15; c++) {
      const idx = r * 15 + c
      const v = snapshot.board[idx]
      const isSelected = selected === idx
      const isLast = snapshot.lastMove?.idx === idx
      const isTengen = idx === 112
      const isWin = snapshot.winLine && snapshot.winLine.includes(idx)
      const cls = [
        'gomoku-cell',
        isSelected ? 'gomoku-selected' : '',
        isTengen ? 'gomoku-tengen' : '',
        isLast ? 'gomoku-last' : '',
        isWin ? 'gomoku-win' : '',
      ].filter(Boolean).join(' ')
      cells.push(
        <div
          key={idx}
          role="gridcell"
          data-idx={idx}
          className={cls}
          tabIndex={isSelected ? 0 : -1}
          aria-selected={isSelected}
          aria-label={`第${r + 1}行第${c + 1}列，${v === GOMOKU.P1 ? '黑子' : v === GOMOKU.P2 ? '白子' : '空'}`}
          onClick={() => onClick(idx)}
        >
          {v !== GOMOKU.EMPTY && (
            <span className={`gomoku-stone ${v === GOMOKU.P1 ? 'gomoku-black' : 'gomoku-white'}`} aria-hidden="true" />
          )}
        </div>,
      )
    }
    rows.push(<div key={r} role="row" className="gomoku-row">{cells}</div>)
  }
  return rows
}

export default GomokuPage
