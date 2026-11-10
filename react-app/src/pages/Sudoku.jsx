import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SudokuEngine, TIERS, SUDOKU } from '../game/SudokuEngine'
import {
  dateKeyOf,
  pickFallbackQuote,
  readCachedQuote,
  requestQuote,
  writeCachedQuote,
} from '../api/sudokuQuote'
import './Sudoku.css'

const BEST_KEY = 'game-sudoku-best-v1'
const STATS_KEY = 'game-sudoku-stats-v1'
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
          errors: Number.isFinite(r.errors) ? r.errors : 0,
          hints: Number.isFinite(r.hints) ? r.hints : 0,
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
    v: 1, plays: 0, wins: 0, fails: 0, timeouts: 0, cells: 0, timeByLevel: {}, updatedAt: 0,
  }
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return empty
    return { ...empty, ...data, timeByLevel: { ...(data.timeByLevel || {}) } }
  } catch {
    return empty
  }
}

const cap = (n) => Math.min(99999, Math.max(0, n))

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** 格子关联：同行/列/宫 */
function isPeer(a, b) {
  if (a === b) return false
  const ra = Math.floor(a / 9)
  const ca = a % 9
  const rb = Math.floor(b / 9)
  const cb = b % 9
  return ra === rb || ca === cb || (Math.floor(ra / 3) === Math.floor(rb / 3) && Math.floor(ca / 3) === Math.floor(cb / 3))
}

/**
 * 数独页面壳
 * 架构对齐 Maze.jsx：六屏（start/loading/playing/paused/error/over）+ 引擎回调
 * + visibility/blur 双路去重暂停；盘面 div[role=gridcell] + roving tabindex，
 * 全部写入收敛到 ≥40px 数字面板（320px 下 9 列格子约 34px，不做 button）。
 */
function SudokuPage() {
  const engineRef = useRef(null)
  const snapshotRef = useRef(null)
  const stateRef = useRef('start')
  const pausedByVisibilityRef = useRef(false)
  const autoPauseRef = useRef(false)
  const aliveRef = useRef(false)
  const statsRef = useRef(null)
  const dirtyRef = useRef(false)
  const writeTimerRef = useRef(null)
  const genTimerRef = useRef(null)
  const errorTimerRef = useRef(null)
  const lastTierRef = useRef('easy')
  if (statsRef.current === null) statsRef.current = loadStats()

  const [screen, setScreen] = useState('start')
  const [snapshot, setSnapshot] = useState(null)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [selected, setSelected] = useState(40)
  const [noteMode, setNoteMode] = useState(false)
  const [errorIdx, setErrorIdx] = useState(-1)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [best, setBest] = useState(loadBest)
  const [saveError, setSaveError] = useState(false)
  const [engineError, setEngineError] = useState(false)
  const [quote, setQuote] = useState(null)
  const [quoteLoading, setQuoteLoading] = useState(false)

  const [finalResult, setFinalResult] = useState('win')
  const [finalScore, setFinalScore] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState(0)
  const [finalErrors, setFinalErrors] = useState(0)
  const [finalHints, setFinalHints] = useState(0)
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

  // ---------- 通关寄语：缓存优先 → 一言（3s 超时）→ 本地降级 ----------
  const loadQuote = async () => {
    const day = dateKeyOf()
    const cached = readCachedQuote(localStorage, day)
    if (cached) {
      setQuote(cached)
      setQuoteLoading(false)
      return
    }
    setQuote(null)
    setQuoteLoading(true)
    const remote = await requestQuote()
    if (!aliveRef.current) return
    const next = remote || pickFallbackQuote(day)
    setQuote(next)
    setQuoteLoading(false)
    writeCachedQuote(localStorage, day, next, !remote)
  }

  /** 选中下一个可填空格（填入/提示成功后自动跳转） */
  const selectNextEmpty = (snap, fromIdx) => {
    for (let step = 1; step <= 81; step++) {
      const idx = (fromIdx + step) % 81
      if (!snap.givens[idx] && !snap.confirmed[idx]) return idx
    }
    return fromIdx
  }

  // ---------- 引擎生命周期 ----------
  useEffect(() => {
    aliveRef.current = true
    const engine = new SudokuEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state !== stateRef.current) changeScreen(snap.state)

        // 错误红标抖动 300ms
        if (snap.lastAction === 'error' && snap.lastError >= 0) {
          setErrorIdx(snap.lastError)
          clearTimeout(errorTimerRef.current)
          errorTimerRef.current = setTimeout(() => setErrorIdx(-1), 300)
        }
      },
      onGameOver: (score, elapsed, result) => {
        const snap = snapshotRef.current
        const level = snap?.tier || 'easy'
        const errors = snap?.errors || 0
        const hints = snap?.hintUsed || 0
        setFinalResult(result)
        setFinalScore(score)
        setFinalElapsed(elapsed)
        setFinalErrors(errors)
        setFinalHints(hints)
        setFinalLevel(level)

        if (result === 'win') {
          bumpStats((s) => {
            s.wins = cap(s.wins + 1)
            s.cells = cap(s.cells + (snap?.filled ?? 0))
            s.timeByLevel[level] = cap((s.timeByLevel[level] || 0) + Math.round(elapsed))
          })
          const current = loadBest()
          const prev = current[level]
          if (!prev || score > prev.score) {
            const next = {
              ...current,
              [level]: { score, time: Math.round(elapsed * 10) / 10, errors, hints },
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
          loadQuote()
        } else {
          setQuote(null)
          setQuoteLoading(false)
          bumpStats((s) => {
            if (result === 'timeout') s.timeouts = cap(s.timeouts + 1)
            else s.fails = cap(s.fails + 1)
            s.cells = cap(s.cells + (snap?.filled ?? 0))
          })
        }

        changeScreen('over')
        setTimeout(() => {
          document.querySelector('.sd-overlay-card .sd-btn-primary')?.focus()
        }, 0)
      },
      onPause: () => {
        setPausedAuto(autoPauseRef.current)
        if (stateRef.current === 'playing') changeScreen('paused')
      },
    })
    engineRef.current = engine
    return () => {
      aliveRef.current = false
      clearTimeout(genTimerRef.current)
      clearTimeout(errorTimerRef.current)
      engine.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 倒计时驱动 ----------
  useEffect(() => {
    if (screen !== 'playing') return
    const timer = setInterval(() => engineRef.current?.tick(), SUDOKU.TICK_MS)
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

  const focusCell = (idx) => {
    setTimeout(() => {
      document.querySelector(`.sd-board .sd-cell[data-idx="${idx}"]`)?.focus({ preventScroll: true })
    }, 0)
  }

  // ---------- 开局：先进入 loading 态，下一帧再出题，保证「正在出题」可见 ----------
  const handleStart = (level) => {
    const tier = level in TIERS ? level : 'easy'
    lastTierRef.current = tier
    clearTimeout(genTimerRef.current)
    clearTimeout(errorTimerRef.current)
    setErrorIdx(-1)
    setEngineError(false)
    setPausedAuto(false)
    setNoteMode(false)
    setQuote(null)
    setQuoteLoading(false)
    changeScreen('loading')
    genTimerRef.current = setTimeout(() => {
      try {
        engineRef.current?.start(tier, 'new')
      } catch {
        setEngineError(true)
        changeScreen('error')
        return
      }
      bumpStats((s) => { s.plays = cap(s.plays + 1) })
      const snap = snapshotRef.current
      const first = snap ? snap.givens.findIndex((g) => !g) : 0
      setSelected(first >= 0 ? first : 0)
      changeScreen('playing')
      focusCell(first >= 0 ? first : 0)
    }, 220)
  }

  const handlePause = () => {
    autoPauseRef.current = false
    engineRef.current?.pause()
  }

  const handleResume = () => {
    autoPauseRef.current = false
    engineRef.current?.resume()
    changeScreen('playing')
    focusCell(selected)
  }

  // ---------- 选中 ----------
  const selectCell = (idx, announce = false) => {
    setSelected(idx)
    if (announce) {
      const snap = snapshotRef.current
      if (!snap) return
      const r = Math.floor(idx / 9) + 1
      const c = (idx % 9) + 1
      const v = snap.values[idx]
      const state = snap.givens[idx] ? `已知数字 ${v}` : snap.confirmed[idx] ? `已确认 ${v}` : '空格'
      setLiveAnnounce(`第 ${r} 行第 ${c} 列，${state}`)
    }
  }

  // ---------- 写入（数字面板 / 键盘数字键共用） ----------
  const inputNumber = (num) => {
    const snap = snapshotRef.current
    if (!snap || stateRef.current !== 'playing') return
    if (snap.givens[selected] || snap.confirmed[selected]) {
      setLiveAnnounce('已知格与已确认格不可修改，请选择一个空格')
      return
    }
    if (noteMode) {
      const r = engineRef.current?.toggleNote(selected, num)
      if (r === 'toggled') setLiveAnnounce(`笔记${snapshotRef.current?.notes[selected]?.includes(num) ? '添加' : '移除'}候选 ${num}`)
      return
    }
    const r = engineRef.current?.place(selected, num)
    if (r === 'placed' || r === 'win') {
      const next = snapshotRef.current
      setLiveAnnounce(r === 'win' ? '填入正确，恭喜通关' : '填入正确')
      if (r === 'placed' && next) {
        const nIdx = selectNextEmpty(next, selected)
        setSelected(nIdx)
        focusCell(nIdx)
      }
    } else if (r === 'error' || r === 'fail') {
      const errs = snapshotRef.current?.errors ?? 0
      setLiveAnnounce(r === 'fail' ? '填入错误，错误已满 3 次，本局失败' : `填入错误，已错 ${errs} 次，满 3 次判负`)
    }
  }

  const handleErase = () => {
    const snap = snapshotRef.current
    if (!snap || stateRef.current !== 'playing') return
    const r = engineRef.current?.erase(selected)
    setLiveAnnounce(r === 'erased' ? '已擦除本格笔记' : '本格无可擦除内容')
  }

  const handleHint = () => {
    if (stateRef.current !== 'playing') return
    const idx = engineRef.current?.hint(selected)
    if (idx === null || idx === undefined) {
      setLiveAnnounce('提示次数已用完')
      return
    }
    const next = snapshotRef.current
    if (next && next.state === 'playing') {
      const nIdx = selectNextEmpty(next, idx)
      setSelected(nIdx)
      focusCell(nIdx)
    } else {
      setSelected(idx)
    }
    setLiveAnnounce(`提示：第 ${Math.floor(idx / 9) + 1} 行第 ${(idx % 9) + 1} 列填入 ${snapshotRef.current?.values[idx] ?? ''}，剩余 ${snapshotRef.current?.hintsLeft ?? 0} 次`)
  }

  const handleUndo = () => {
    if (stateRef.current !== 'playing') return
    const ok = engineRef.current?.undo()
    setLiveAnnounce(ok ? '已撤销上一步，错误计数不恢复' : '没有可撤销的操作')
  }

  // ---------- 盘面键盘：方向键移动选中（roving tabindex），数字键写入 ----------
  const handleBoardKeyDown = (e) => {
    const snap = snapshotRef.current
    if (!snap || snap.state !== 'playing') return
    const key = e.key
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault()
      const d = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[key]
      let next = selected + d
      if (key === 'ArrowLeft' && selected % 9 === 0) next = selected
      if (key === 'ArrowRight' && selected % 9 === 8) next = selected
      if (next < 0 || next > 80) next = selected
      setSelected(next)
      focusCell(next)
      return
    }
    if (key >= '1' && key <= '9') {
      e.preventDefault()
      inputNumber(Number(key))
      return
    }
    if (key === 'Backspace' || key === 'Delete') {
      e.preventDefault()
      handleErase()
    }
  }

  const bestOfLevel = (level) => best[level]?.score
  const hasAnyBest = LEVELS.some((lv) => best[lv])
  const showBoard = snapshot && (screen === 'playing' || screen === 'paused' || screen === 'over')
  const selValue = snapshot?.values[selected] ?? 0

  return (
    <div className="sd-page" role="application" aria-label="数独小游戏">
      <header className="sd-top">
        <Link to="/" className="sd-back" aria-label="返回首页">← 首页</Link>
        <h1 className="sd-title">数独</h1>
        {(screen === 'playing' || screen === 'paused') && (
          <button
            type="button"
            className="sd-pause-btn"
            onClick={screen === 'paused' ? handleResume : handlePause}
            aria-label={screen === 'paused' ? '继续游戏' : '暂停游戏'}
          >
            {screen === 'paused' ? '继续' : '暂停'}
          </button>
        )}
      </header>

      {/* HUD */}
      <div className="sd-hud" aria-label="游戏信息">
        <div className="sd-stat">
          <span className="sd-stat-label">已填</span>
          <span className="sd-stat-val">{snapshot && snapshot.state !== 'start' ? `${snapshot.filled}/81` : '—'}</span>
        </div>
        <div className="sd-stat">
          <span className="sd-stat-label">错误</span>
          <span className="sd-stat-val">{snapshot && snapshot.state !== 'start' ? `${snapshot.errors}/${SUDOKU.ERROR_LIMIT}` : '—'}</span>
        </div>
        <div className="sd-stat">
          <span className="sd-stat-label">提示</span>
          <span className="sd-stat-val">{snapshot && snapshot.state !== 'start' ? snapshot.hintsLeft : '—'}</span>
        </div>
        <div className="sd-stat">
          <span className="sd-stat-label">倒计时</span>
          <span className="sd-stat-val sd-timer" role="timer" aria-live="off">
            {snapshot && snapshot.state !== 'start' ? fmtTime(snapshot.remaining) : '—'}
          </span>
        </div>
      </div>

      {/* 读屏播报（视觉隐藏） */}
      <div aria-live="polite" aria-atomic="true" className="sd-live">{liveAnnounce}</div>

      {/* 数独盘面 */}
      {showBoard && (
        <div
          className="sd-board-wrap"
          style={{ pointerEvents: screen === 'paused' ? 'none' : 'auto' }}
          aria-hidden={screen === 'paused'}
        >
          <div
            className="sd-board"
            role="grid"
            aria-label="9 行 9 列数独盘面，方向键移动选中，数字键填入"
            tabIndex={-1}
            onKeyDown={handleBoardKeyDown}
          >
            {renderRows(snapshot, selected, selValue, errorIdx, selectCell)}
          </div>
        </div>
      )}

      {/* 数字面板：全部写入动作的唯一入口（≥40px 热区） */}
      {showBoard && (
        <div className="sd-pad-wrap" aria-hidden={screen === 'paused'}>
          <div className="sd-pad" role="group" aria-label={noteMode ? '数字面板（笔记模式）' : '数字面板'}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button
                key={n}
                type="button"
                className={`sd-pad-key${selValue === n ? ' sd-pad-same' : ''}`}
                disabled={screen === 'paused'}
                onClick={() => inputNumber(n)}
                aria-label={`填入数字 ${n}${noteMode ? '（笔记）' : ''}`}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              className="sd-pad-key sd-pad-erase"
              disabled={screen === 'paused'}
              onClick={handleErase}
              aria-label="擦除选中格笔记"
            >
              擦除
            </button>
          </div>

          {/* 动作区 */}
          <div className="sd-actions">
            <button
              type="button"
              className={`sd-btn${noteMode ? ' sd-btn-on' : ''}`}
              aria-pressed={noteMode}
              disabled={screen === 'paused'}
              onClick={() => {
                setNoteMode((v) => {
                  setLiveAnnounce(v ? '笔记模式已关闭' : '笔记模式已开启，数字键记候选数')
                  return !v
                })
              }}
            >
              笔记{noteMode ? '中' : ''}
            </button>
            <button
              type="button"
              className="sd-btn"
              onClick={handleHint}
              disabled={screen === 'paused' || !snapshot?.hintsLeft}
            >
              提示 ({snapshot?.hintsLeft ?? 0})
            </button>
            <button
              type="button"
              className="sd-btn"
              onClick={handleUndo}
              disabled={screen === 'paused' || !snapshot?.canUndo}
            >
              撤销
            </button>
          </div>
        </div>
      )}

      <p className="sd-hint">点按格子选中，用数字面板或键盘数字键填入；开启笔记模式后记候选数。错误满 3 次判负，提示与错误都会扣分。</p>

      {/* start 遮罩 */}
      {screen === 'start' && (
        <div className="sd-overlay">
          <div className="sd-overlay-card sd-start-card">
            <h2>数独</h2>
            <p>在 9×9 盘面填入 1~9，使每行、每列、每个 3×3 宫都不重复。每局题目保证唯一解，错误满 3 次判负。</p>
            <p className="sd-overlay-hint">每局 3 次提示（每次扣 50 分），支持撤销与笔记；用时越短、错误越少，得分越高。</p>
            <div className="sd-diff-list" aria-label="选择难度">
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className="sd-diff-btn"
                  onClick={() => handleStart(lv)}
                  aria-label={`${TIERS[lv].label}难度，已知 ${TIERS[lv].givens} 格，限时 ${TIERS[lv].limitSec} 秒${bestOfLevel(lv) ? `，最佳 ${bestOfLevel(lv)} 分` : ''}`}
                >
                  <span className="sd-diff-name">{TIERS[lv].label}</span>
                  <span className="sd-diff-meta">
                    已知 {TIERS[lv].givens} 格 · 限时 {TIERS[lv].limitSec}s · {bestOfLevel(lv) ? `最佳 ${bestOfLevel(lv)}` : '暂无记录'}
                  </span>
                </button>
              ))}
            </div>
            {!hasAnyBest && (
              <p className="sd-empty">暂无最佳记录，通关一局后自动保存。</p>
            )}
          </div>
        </div>
      )}

      {/* loading 遮罩（出题中） */}
      {screen === 'loading' && (
        <div className="sd-overlay">
          <div className="sd-overlay-card" role="status" aria-live="polite">
            <div className="sd-spinner" aria-hidden="true" />
            <h2>正在出题…</h2>
            <p>回溯生成终盘，并按中心对称挖空、复核唯一解。</p>
          </div>
        </div>
      )}

      {/* error 遮罩（出题失败） */}
      {screen === 'error' && (
        <div className="sd-overlay">
          <div className="sd-overlay-card">
            <h2>出题失败</h2>
            <p>{engineError ? '本次出题未能得到唯一解题目，请重试。' : '未知错误，请重试。'}</p>
            <div className="sd-btns">
              <button type="button" className="sd-btn-primary" onClick={() => handleStart(lastTierRef.current)}>
                重试
              </button>
              <Link to="/" className="sd-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* paused 遮罩（完全遮蔽盘面数字，防暂停抄题） */}
      {screen === 'paused' && (
        <div className="sd-overlay">
          <div className="sd-overlay-card">
            <h2>{pausedAuto ? '已自动暂停' : '已暂停'}</h2>
            <p>{pausedAuto ? '检测到页面切走或窗口失焦，计时已冻结。' : '手动暂停中，盘面已遮蔽、计时已冻结。'}</p>
            <div className="sd-btns">
              <button type="button" className="sd-btn-primary" onClick={handleResume}>继续</button>
              <Link to="/" className="sd-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* over 遮罩 */}
      {screen === 'over' && (
        <div className="sd-overlay">
          <div className={`sd-overlay-card${finalResult === 'win' ? ' sd-overlay-win' : ''}`}>
            <h2>{finalResult === 'win' ? '恭喜通关！' : finalResult === 'timeout' ? '时间到' : '错误满 3 次'}</h2>
            <p>
              {finalResult === 'win'
                ? `你完成了${TIERS[finalLevel]?.label}难度数独。`
                : finalResult === 'timeout'
                  ? `限时 ${TIERS[finalLevel]?.limitSec} 秒内未完成，本局结束。`
                  : '填入错误已满 3 次，本局失败。'}
            </p>
            <div className="sd-summary">
              <div><span>难度</span><strong>{TIERS[finalLevel]?.label}</strong></div>
              <div><span>基准分</span><strong>{TIERS[finalLevel]?.baseScore}</strong></div>
              <div><span>时间扣</span><strong>-{Math.floor(finalElapsed) * SUDOKU.SEC_PENALTY}</strong></div>
              <div><span>错误扣</span><strong>-{finalErrors * SUDOKU.ERROR_PENALTY}</strong></div>
              <div><span>提示扣</span><strong>-{finalHints * SUDOKU.HINT_PENALTY}</strong></div>
              <div><span>用时</span><strong>{fmtTime(finalElapsed)}</strong></div>
              <div><span>得分</span><strong>{finalScore}</strong></div>
              <div><span>最佳</span><strong>{bestOfLevel(finalLevel) ?? '—'}</strong></div>
            </div>
            {finalResult === 'win' && (
              <div className="sd-quote" aria-live="polite">
                {quoteLoading
                  ? '正在生成通关寄语…'
                  : quote
                    ? <>“{quote.text}”{quote.source ? ` —— ${quote.source}` : ''}{quote.fallback && <span className="sd-quote-offline">（离线寄语）</span>}</>
                    : '已通关'}
              </div>
            )}
            {saveError && <p className="sd-save-err">本局成绩未保存，本地存储不可用</p>}
            <div className="sd-btns">
              <button type="button" className="sd-btn-primary" onClick={() => handleStart(finalLevel)}>再来一局</button>
              <Link to="/" className="sd-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 按行渲染：行 role=row，格 div[role=gridcell]（roving tabindex 跟随选中格） */
function renderRows(snapshot, selected, selValue, errorIdx, onSelect) {
  const { givens, values, confirmed, notes } = snapshot
  const out = []
  for (let r = 0; r < 9; r++) {
    const cells = []
    for (let c = 0; c < 9; c++) {
      const idx = r * 9 + c
      const v = values[idx]
      const isGiven = givens[idx]
      const isSelected = selected === idx
      const isRelated = isPeer(selected, idx)
      const isSame = selValue !== 0 && v === selValue && !isSelected
      const isError = errorIdx === idx
      const cls = [
        'sd-cell',
        c % 3 === 2 && c < 8 ? 'sd-box-r' : '',
        r % 3 === 2 && r < 8 ? 'sd-box-b' : '',
        isGiven ? 'sd-given' : '',
        !isGiven && confirmed[idx] ? 'sd-confirmed' : '',
        isSelected ? 'sd-selected' : '',
        isRelated ? 'sd-related' : '',
        isSame ? 'sd-same' : '',
        isError ? 'sd-error' : '',
      ].filter(Boolean).join(' ')
      const stateText = isGiven ? `已知 ${v}` : confirmed[idx] ? `已确认 ${v}` : notes[idx].length ? `空格，候选 ${notes[idx].join('、')}` : '空格'
      cells.push(
        <div
          key={idx}
          role="gridcell"
          data-idx={idx}
          className={cls}
          tabIndex={isSelected ? 0 : -1}
          aria-selected={isSelected}
          aria-label={`第${r + 1}行第${c + 1}列，${stateText}`}
          onClick={() => onSelect(idx, true)}
        >
          {v !== 0
            ? <span className="sd-num">{v}</span>
            : notes[idx].length > 0 && (
              <span className="sd-notes" aria-hidden="true">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <span key={n} className="sd-note">{notes[idx].includes(n) ? n : ''}</span>
                ))}
              </span>
            )}
        </div>,
      )
    }
    out.push(<div key={r} role="row" className="sd-row">{cells}</div>)
  }
  return out
}

export default SudokuPage
