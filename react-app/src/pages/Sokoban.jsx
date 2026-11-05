import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SokobanEngine, LEVELS, TIERS, SOKOBAN } from '../game/SokobanEngine'
import {
  dateKeyOf,
  pickFallbackQuote,
  readCachedQuote,
  requestQuote,
  writeCachedQuote,
} from '../api/sokobanQuote'
import './Sokoban.css'

const BEST_KEY = 'game-sokoban-best-v1'
const STATS_KEY = 'game-sokoban-stats-v1'

/** 读取每关最佳（损坏/不可用时降级为空对象） */
function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY)
    const data = raw ? JSON.parse(raw) : null
    const src = data && data.v === 1 && data.best && typeof data.best === 'object' ? data.best : null
    if (!src) return {}
    const out = {}
    for (const level of LEVELS) {
      const r = src[String(level.id)]
      if (r && Number.isFinite(r.score)) {
        out[level.id] = {
          score: r.score,
          moves: Number.isFinite(r.moves) ? r.moves : 0,
          time: Number.isFinite(r.time) ? r.time : 0,
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
  const empty = { v: 1, plays: 0, clears: 0, pushes: 0, timeByTier: {}, updatedAt: 0 }
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object' || data.v !== 1) return empty
    return {
      ...empty,
      plays: Number.isFinite(data.plays) ? data.plays : 0,
      clears: Number.isFinite(data.clears) ? data.clears : 0,
      pushes: Number.isFinite(data.pushes) ? data.pushes : 0,
      timeByTier: { ...(data.timeByTier || {}) },
    }
  } catch {
    return empty
  }
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function cellLabel(snap, idx) {
  const r = Math.floor(idx / snap.cols) + 1
  const c = (idx % snap.cols) + 1
  if (snap.walls[idx]) return `第${r}行第${c}列，墙`
  if (snap.player === idx) return `第${r}行第${c}列，玩家${snap.goals[idx] ? '在目标点上' : ''}`
  if (snap.boxes[idx]) return `第${r}行第${c}列，箱子${snap.goals[idx] ? '已归位' : ''}`
  if (snap.goals[idx]) return `第${r}行第${c}列，目标点`
  return `第${r}行第${c}列，地面`
}

/**
 * 推箱子页面壳
 * 架构对齐 LightsOut.jsx：四态 UI + 引擎回调 + visibility/blur 双路去重暂停；
 * 无障碍：role=grid + roving tabindex + aria-live；触控：相邻格点按 + 方向键区 + 滑动。
 */
function SokobanPage() {
  const engineRef = useRef(null)
  const snapshotRef = useRef(null)
  const stateRef = useRef('start')
  const pausedByVisibilityRef = useRef(false)
  const autoPauseRef = useRef(false)
  const announceKeyRef = useRef('')
  const statsRef = useRef(null)
  const dirtyRef = useRef(false)
  const writeTimerRef = useRef(null)
  const aliveRef = useRef(true)
  const touchRef = useRef(null)
  if (statsRef.current === null) statsRef.current = loadStats()

  const [screen, setScreen] = useState('start')
  const [snapshot, setSnapshot] = useState(null)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [best, setBest] = useState(loadBest)
  const [saveError, setSaveError] = useState(false)
  const [engineError, setEngineError] = useState(false)
  const [final, setFinal] = useState(null)
  const [quote, setQuote] = useState(null)
  const [quoteLoading, setQuoteLoading] = useState(false)

  const changeScreen = (s) => {
    stateRef.current = s
    setScreen(s)
  }

  // ---------- 埋点：脏标记 + 1s 兜底 + pagehide 落盘 ----------
  const flushStats = () => {
    if (!dirtyRef.current || !statsRef.current) return
    try {
      statsRef.current.v = 1
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

  // ---------- 通关寄语：缓存优先 → 一言 → 本地降级 ----------
  const loadQuote = async (levelId) => {
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
    const next = remote || pickFallbackQuote(levelId)
    setQuote(next)
    setQuoteLoading(false)
    writeCachedQuote(localStorage, day, next, !remote)
  }

  // ---------- 引擎生命周期 ----------
  useEffect(() => {
    aliveRef.current = true
    const engine = new SokobanEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state !== stateRef.current) changeScreen(snap.state)

        // aria-live：同一动作只播报一次（tick 复用 lastAction / 步数 / 玩家位）
        const key = `${snap.lastAction}:${snap.moves}:${snap.player}:${snap.state}`
        if (key === announceKeyRef.current) return
        announceKeyRef.current = key
        if (snap.lastAction === 'start') setLiveAnnounce(`第 ${snap.levelId} 关「${snap.name}」开始，限时 ${snap.limitSec} 秒`)
        else if (snap.lastAction === 'move') setLiveAnnounce(`移动成功，已走 ${snap.moves} 步`)
        else if (snap.lastAction === 'push') setLiveAnnounce(`推动箱子，${snap.boxesOnGoal}/${snap.totalBoxes} 个已归位`)
        else if (snap.lastAction === 'blocked') setLiveAnnounce('前方被挡住，换个方向试试')
        else if (snap.lastAction === 'undo') setLiveAnnounce(`已撤销，回到第 ${snap.moves} 步`)
        else if (snap.lastAction === 'restart') setLiveAnnounce('本关已重开，计时重置')
        else if (snap.lastAction === 'win') setLiveAnnounce(`第 ${snap.levelId} 关通关，得分 ${snap.score}`)
        else if (snap.lastAction === 'timeout') setLiveAnnounce('时间到，挑战失败')
      },
      onGameOver: (score, elapsed, result) => {
        const snap = snapshotRef.current
        if (!snap) return
        setFinal({
          score,
          elapsed,
          moves: snap.moves,
          pushes: snap.pushes,
          levelId: snap.levelId,
          levelIndex: snap.levelIndex,
          name: snap.name,
          tier: snap.tier,
          limitSec: snap.limitSec,
        })

        if (result === 'win') {
          bumpStats((s) => {
            s.clears += 1
            s.pushes += snap.pushes
            s.timeByTier[snap.tier] = Math.round(((s.timeByTier[snap.tier] || 0) + elapsed) * 10) / 10
          })
          const stored = loadBest()
          const prev = stored[snap.levelId]
          if (!prev || prev.score < score) {
            const next = {
              ...stored,
              [snap.levelId]: { score, moves: snap.moves, time: Math.round(elapsed * 10) / 10 },
            }
            try {
              localStorage.setItem(BEST_KEY, JSON.stringify({ v: 1, best: next, updatedAt: Date.now() }))
              setSaveError(false)
            } catch {
              setSaveError(true)
            }
            setBest(next)
          } else {
            setBest(stored)
          }
          loadQuote(snap.levelId)
        } else {
          setQuote(null)
          setQuoteLoading(false)
        }

        changeScreen(result === 'win' ? 'over' : 'failed')
        setTimeout(() => document.querySelector('.sk-overlay-card .sk-btn-primary')?.focus(), 0)
      },
      onPause: () => {
        setPausedAuto(autoPauseRef.current)
        if (stateRef.current === 'playing') changeScreen('paused')
      },
    })
    engineRef.current = engine
    return () => {
      aliveRef.current = false
      engine.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 倒计时驱动 ----------
  useEffect(() => {
    if (screen !== 'playing') return
    const timer = setInterval(() => engineRef.current?.tick(), SOKOBAN.TICK_MS)
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

  const focusPlayer = () => {
    setTimeout(() => {
      document.querySelector('.sk-board .sk-tile[tabindex="0"]')?.focus({ preventScroll: true })
    }, 0)
  }

  // ---------- 开局 ----------
  const handleStart = (levelIndex) => {
    try {
      engineRef.current?.start(levelIndex)
    } catch {
      setEngineError(true)
      changeScreen('error')
      return
    }
    bumpStats((s) => { s.plays += 1 })
    announceKeyRef.current = ''
    setEngineError(false)
    setFinal(null)
    setQuote(null)
    setQuoteLoading(false)
    setPausedAuto(false)
    setFocusedIdx(snapshotRef.current?.player ?? 0)
    changeScreen('playing')
    focusPlayer()
  }

  const handlePause = () => {
    autoPauseRef.current = false
    engineRef.current?.pause()
  }

  const handleResume = () => {
    autoPauseRef.current = false
    engineRef.current?.resume()
    changeScreen('playing')
    focusPlayer()
  }

  // ---------- 移动 ----------
  const moveByDir = (dir) => {
    if (stateRef.current !== 'playing') return
    engineRef.current?.move(dir)
    const snap = snapshotRef.current
    if (snap) {
      setFocusedIdx(snap.player)
      focusPlayer()
    }
  }

  const handleCellClick = (idx) => {
    const snap = snapshotRef.current
    if (!snap || snap.state !== 'playing') return
    if (idx === snap.player) {
      setLiveAnnounce(`当前位置：第 ${Math.floor(idx / snap.cols) + 1} 行第 ${(idx % snap.cols) + 1} 列`)
      return
    }
    const pr = Math.floor(snap.player / snap.cols)
    const pc = snap.player % snap.cols
    const dr = Math.floor(idx / snap.cols) - pr
    const dc = (idx % snap.cols) - pc
    if (Math.abs(dr) + Math.abs(dc) !== 1) {
      setLiveAnnounce('只能移动到相邻格，请点玩家上下左右相邻的格子')
      return
    }
    if (dr === -1) moveByDir('up')
    else if (dr === 1) moveByDir('down')
    else if (dc === -1) moveByDir('left')
    else moveByDir('right')
  }

  const handleBoardKeyDown = (e) => {
    const snap = snapshotRef.current
    if (!snap || snap.state !== 'playing') return
    const key = e.key
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault()
      moveByDir({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[key])
      return
    }
    if (key === 'Enter' || key === ' ') {
      // 读屏辅助：播报当前焦点格内容与归位进度
      e.preventDefault()
      setLiveAnnounce(`${cellLabel(snap, focusedIdx)}；已归位 ${snap.boxesOnGoal}/${snap.totalBoxes} 个箱子`)
    }
  }

  // ---------- 滑动 ----------
  const handleTouchStart = (e) => {
    const t = e.changedTouches?.[0]
    if (!t) return
    touchRef.current = { x: t.clientX, y: t.clientY }
  }
  const handleTouchEnd = (e) => {
    const start = touchRef.current
    touchRef.current = null
    const t = e.changedTouches?.[0]
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    if (Math.max(ax, ay) < 24) return
    if (ax >= ay) moveByDir(dx > 0 ? 'right' : 'left')
    else moveByDir(dy > 0 ? 'down' : 'up')
  }

  const bestOfLevel = (levelId) => best[levelId]?.score

  return (
    <div className="sk-page" role="application" aria-label="推箱子小游戏">
      <header className="sk-top">
        <Link to="/" className="sk-back" aria-label="返回首页">← 首页</Link>
        <h1 className="sk-title">推箱子</h1>
        {(screen === 'playing' || screen === 'paused') && (
          <button
            type="button"
            className="sk-pause-btn"
            onClick={screen === 'paused' ? handleResume : handlePause}
            aria-label={screen === 'paused' ? '继续游戏' : '暂停游戏'}
          >
            {screen === 'paused' ? '继续' : '暂停'}
          </button>
        )}
      </header>

      {/* HUD */}
      <div className="sk-hud" aria-label="游戏信息">
        <div className="sk-stat">
          <span className="sk-stat-label">关卡</span>
          <span className="sk-stat-val">{snapshot?.state === 'start' ? '—' : `${snapshot?.levelId ?? '—'}/12`}</span>
        </div>
        <div className="sk-stat">
          <span className="sk-stat-label">步数</span>
          <span className="sk-stat-val">{snapshot?.state === 'start' ? '—' : snapshot?.moves ?? '—'}</span>
        </div>
        <div className="sk-stat">
          <span className="sk-stat-label">推箱</span>
          <span className="sk-stat-val">{snapshot?.state === 'start' ? '—' : snapshot?.pushes ?? '—'}</span>
        </div>
        <div className="sk-stat">
          <span className="sk-stat-label">倒计时</span>
          <span className="sk-stat-val sk-timer" role="timer" aria-live="off">
            {snapshot && snapshot.state !== 'start' ? fmtTime(snapshot.remaining) : '—'}
          </span>
        </div>
      </div>

      {/* 读屏播报（视觉隐藏） */}
      <div aria-live="polite" aria-atomic="true" className="sk-live">{liveAnnounce}</div>

      {/* 棋盘 */}
      {snapshot && snapshot.walls.length > 0 && screen !== 'start' && screen !== 'error' && (
        <div
          className="sk-board-wrap"
          style={{ pointerEvents: screen === 'paused' ? 'none' : 'auto' }}
          aria-hidden={screen === 'paused'}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="sk-board"
            role="grid"
            aria-label={`${snapshot.rows} 行 ${snapshot.cols} 列推箱子棋盘，已归位 ${snapshot.boxesOnGoal}/${snapshot.totalBoxes} 个箱子`}
            tabIndex={-1}
            onKeyDown={handleBoardKeyDown}
            style={{ '--sk-cols': snapshot.cols }}
          >
            {renderRows(snapshot, focusedIdx, handleCellClick)}
          </div>
        </div>
      )}

      {/* 方向键区：触屏主输入 */}
      {(screen === 'playing' || screen === 'paused') && (
        <div className="sk-dpad" aria-label="方向键操作区">
          <button type="button" className="sk-dpad-btn sk-dpad-up" onClick={() => moveByDir('up')} disabled={screen === 'paused'} aria-label="向上移动">↑</button>
          <button type="button" className="sk-dpad-btn sk-dpad-left" onClick={() => moveByDir('left')} disabled={screen === 'paused'} aria-label="向左移动">←</button>
          <span className="sk-dpad-center" aria-hidden="true">●</span>
          <button type="button" className="sk-dpad-btn sk-dpad-right" onClick={() => moveByDir('right')} disabled={screen === 'paused'} aria-label="向右移动">→</button>
          <button type="button" className="sk-dpad-btn sk-dpad-down" onClick={() => moveByDir('down')} disabled={screen === 'paused'} aria-label="向下移动">↓</button>
        </div>
      )}

      {/* 动作区 */}
      {(screen === 'playing' || screen === 'paused') && (
        <div className="sk-actions">
          <button
            type="button"
            className="sk-btn"
            onClick={() => {
              engineRef.current?.undo()
              const snap = snapshotRef.current
              if (snap) { setFocusedIdx(snap.player); focusPlayer() }
            }}
            disabled={screen === 'paused' || !snapshot?.canUndo}
          >
            撤销{snapshot?.undoCount ? ` (${snapshot.undoCount})` : ''}
          </button>
          <button
            type="button"
            className="sk-btn"
            onClick={() => handleStart(snapshot?.levelIndex ?? 0)}
            disabled={screen === 'paused'}
          >
            重开本关
          </button>
        </div>
      )}

      <p className="sk-hint">点按玩家上下左右的格子、按方向键或在棋盘上滑动即可移动；把箱子推到目标点即过关。</p>

      {/* start 遮罩 */}
      {screen === 'start' && (
        <div className="sk-overlay">
          <div className="sk-overlay-card sk-start-card">
            <h2>推箱子</h2>
            <p>12 个手工关卡，三档限时（120 / 150 / 180 秒）。把每个箱子推到目标点即过关，可无限撤销、随时重开。</p>
            <p className="sk-overlay-hint">点按玩家相邻格、方向键区或滑动移动；键盘方向键同样可用。</p>
            <div className="sk-level-groups">
              {['easy', 'normal', 'hard'].map((tier) => (
                <section key={tier} className="sk-level-group" aria-label={`${TIERS[tier].label}关卡`}>
                  <h3 className="sk-level-group-title">
                    {TIERS[tier].label}
                    <span className="sk-level-group-meta">限时 {TIERS[tier].limitSec} 秒</span>
                  </h3>
                  {LEVELS.filter((lv) => lv.tier === tier).map((lv) => (
                    <button
                      key={lv.id}
                      type="button"
                      className="sk-level-btn"
                      onClick={() => handleStart(lv.id - 1)}
                    >
                      <span className="sk-level-name">第 {lv.id} 关 · {lv.name}</span>
                      <span className="sk-level-meta">
                        参考 {lv.par} 步 · {bestOfLevel(lv.id) ? `最佳 ${bestOfLevel(lv.id)} 分` : '暂无记录'}
                      </span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* paused 遮罩 */}
      {screen === 'paused' && (
        <div className="sk-overlay">
          <div className="sk-overlay-card">
            <h2>{pausedAuto ? '已自动暂停' : '已暂停'}</h2>
            <p>{pausedAuto ? '检测到页面切走或窗口失焦，计时已冻结。' : '手动暂停中，计时已冻结。'}</p>
            <div className="sk-btns">
              <button type="button" className="sk-btn-primary" onClick={handleResume}>继续</button>
              <Link to="/" className="sk-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* over 遮罩 */}
      {screen === 'over' && (
        <div className="sk-overlay">
          <div className="sk-overlay-card sk-overlay-win">
            <h2>第 {final?.levelId} 关通关！</h2>
            <div className="sk-summary">
              <div><span>关卡</span><strong>{final?.levelId} · {final?.name}</strong></div>
              <div><span>步数</span><strong>{final?.moves}（参考 {snapshot?.par}）</strong></div>
              <div><span>推箱</span><strong>{final?.pushes}</strong></div>
              <div><span>用时</span><strong>{fmtTime(final?.elapsed)}</strong></div>
              <div><span>得分</span><strong>{final?.score}</strong></div>
              <div><span>最佳</span><strong>{bestOfLevel(final?.levelId)}</strong></div>
            </div>
            <div className="sk-quote" aria-live="polite">
              {quoteLoading
                ? '正在生成通关寄语…'
                : quote
                  ? `“${quote.text}”${quote.source ? ` —— ${quote.source}` : ''}`
                  : '已通关'}
            </div>
            {saveError && <p className="sk-save-err">本局成绩未保存，本地存储不可用</p>}
            <div className="sk-btns">
              {(final?.levelIndex ?? 0) < LEVELS.length - 1 && (
                <button type="button" className="sk-btn-primary" onClick={() => handleStart((final?.levelIndex ?? 0) + 1)}>
                  下一关
                </button>
              )}
              <button type="button" className="sk-btn" onClick={() => handleStart(final?.levelIndex ?? 0)}>重玩本关</button>
              <Link to="/" className="sk-btn">返回首页</Link>
            </div>
            {(final?.levelIndex ?? 0) === LEVELS.length - 1 && (
              <p className="sk-all-clear">全部 12 关通关，感谢游玩。</p>
            )}
          </div>
        </div>
      )}

      {/* failed 遮罩（超时） */}
      {screen === 'failed' && (
        <div className="sk-overlay">
          <div className="sk-overlay-card">
            <h2>时间到</h2>
            <p>第 {final?.levelId} 关「{final?.name}」限时 {final?.limitSec} 秒，还差 {snapshot?.boxesOnGoal === snapshot?.totalBoxes ? 0 : (snapshot?.totalBoxes ?? 0) - (snapshot?.boxesOnGoal ?? 0)} 个箱子未归位。</p>
            <div className="sk-summary">
              <div><span>步数</span><strong>{final?.moves}</strong></div>
              <div><span>推箱</span><strong>{final?.pushes}</strong></div>
              <div><span>用时</span><strong>{fmtTime(final?.limitSec)}</strong></div>
            </div>
            <div className="sk-btns">
              <button type="button" className="sk-btn-primary" onClick={() => handleStart(final?.levelIndex ?? 0)}>再试一次</button>
              <Link to="/" className="sk-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* error 遮罩 */}
      {screen === 'error' && (
        <div className="sk-overlay">
          <div className="sk-overlay-card">
            <h2>棋盘加载失败</h2>
            <p>{engineError ? '关卡数据异常，请重试。' : '未知错误，请重试。'}</p>
            <div className="sk-btns">
              <button type="button" className="sk-btn-primary" onClick={() => handleStart(0)}>重试</button>
              <Link to="/" className="sk-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 按行渲染：行 role=row，格 role=gridcell，内部原生 button（roving tabindex 跟随玩家） */
function renderRows(snapshot, focusedIdx, onCellClick) {
  const { rows, cols, walls, goals, boxes, player } = snapshot
  const out = []
  for (let r = 0; r < rows; r++) {
    const cells = []
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const isWall = Boolean(walls[idx])
      const isGoal = Boolean(goals[idx])
      const isBox = Boolean(boxes[idx])
      const isPlayer = player === idx
      cells.push(
        <div key={idx} role="gridcell" className={`sk-cell${isWall ? ' sk-cell-wall' : ''}`}>
          {isWall ? (
            <span className="sk-wall" aria-hidden="true" />
          ) : (
            <button
              type="button"
              className={`sk-tile${isGoal ? ' sk-tile-goal' : ''}`}
              tabIndex={focusedIdx === idx ? 0 : -1}
              aria-label={cellLabel(snapshot, idx)}
              onClick={() => onCellClick(idx)}
            >
              {isGoal && !isBox && !isPlayer && <span className="sk-goal-dot" aria-hidden="true" />}
              {isBox && <span className={`sk-box${isGoal ? ' sk-box-done' : ''}`} aria-hidden="true" />}
              {isPlayer && <span className="sk-player" aria-hidden="true" />}
            </button>
          )}
        </div>
      )
    }
    out.push(<div key={r} role="row" className="sk-row">{cells}</div>)
  }
  return out
}

export default SokobanPage
