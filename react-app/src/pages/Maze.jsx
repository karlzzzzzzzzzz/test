import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MazeEngine, TIERS, MAZE } from '../game/MazeEngine'
import './Maze.css'

const BEST_KEY = 'game-maze-best-v1'
const STATS_KEY = 'game-maze-stats-v1'
const LEVELS = ['easy', 'normal', 'hard']
const DIR_LABEL = { up: '上', right: '右', down: '下', left: '左' }

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
          steps: Number.isFinite(r.steps) ? r.steps : 0,
          time: Number.isFinite(r.time) ? r.time : 0,
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
    plays: {}, wins: {}, timeouts: {}, resets: 0, steps: 0, timeByLevel: {}, updatedAt: 0,
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
      timeouts: { ...(data.timeouts || {}) },
      timeByLevel: { ...(data.timeByLevel || {}) },
    }
  } catch {
    return empty
  }
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** 按墙体位掩码给出可通行方向文案（读屏用） */
function openDirsText(walls) {
  const dirs = []
  if (!(walls & MAZE.WALL_N)) dirs.push('上')
  if (!(walls & MAZE.WALL_E)) dirs.push('右')
  if (!(walls & MAZE.WALL_S)) dirs.push('下')
  if (!(walls & MAZE.WALL_W)) dirs.push('左')
  return dirs.length ? `可走${dirs.join('、')}` : '四面是墙'
}

/**
 * 迷宫寻路页面壳
 * 架构对齐 Sokoban.jsx：四态 UI + 引擎回调 + visibility/blur 双路去重暂停；
 * 额外提供加载（生成中）与错误（生成失败）两态，start 屏无记录时显示空态提示。
 * 无障碍：role=grid + roving tabindex + aria-live 播报；触控：点按相邻格 + 单指滑动。
 */
function MazePage() {
  const engineRef = useRef(null)
  const snapshotRef = useRef(null)
  const stateRef = useRef('start')
  const pausedByVisibilityRef = useRef(false)
  const autoPauseRef = useRef(false)
  const announceKeyRef = useRef('')
  const statsRef = useRef(null)
  const dirtyRef = useRef(false)
  const writeTimerRef = useRef(null)
  const genTimerRef = useRef(null)
  const hintTimerRef = useRef(null)
  const lastTierRef = useRef('easy')
  const touchRef = useRef(null)
  if (statsRef.current === null) statsRef.current = loadStats()

  const [screen, setScreen] = useState('start')
  const [snapshot, setSnapshot] = useState(null)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [hintIdx, setHintIdx] = useState(-1)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [best, setBest] = useState(loadBest)
  const [saveError, setSaveError] = useState(false)
  const [engineError, setEngineError] = useState(false)

  const [finalResult, setFinalResult] = useState('win')
  const [finalScore, setFinalScore] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState(0)
  const [finalSteps, setFinalSteps] = useState(0)
  const [finalPar, setFinalPar] = useState(0)
  const [finalLevel, setFinalLevel] = useState('easy')
  const [finalHints, setFinalHints] = useState(0)

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
    const engine = new MazeEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state !== stateRef.current) changeScreen(snap.state)

        // aria-live：同一动作只播报一次（tick 每 250ms 复用同一 lastAction）
        const key = `${snap.lastAction}:${snap.steps}:${snap.player}:${snap.hintsLeft}:${snap.state}`
        if (key === announceKeyRef.current) return
        announceKeyRef.current = key
        if (snap.lastAction === 'start' || snap.lastAction === 'new') {
          setLiveAnnounce(`迷宫已生成，从左上角走到右下角，参考最短 ${snap.par} 步`)
        } else if (snap.lastAction === 'move') {
          setLiveAnnounce(`已走 ${snap.steps} 步，距终点最短 ${snap.distance} 步`)
        } else if (snap.lastAction === 'blocked') {
          setLiveAnnounce('前方是墙，换个方向')
        } else if (snap.lastAction === 'hint') {
          setLiveAnnounce(`提示：向${DIR_LABEL[snap.lastHint?.dir] || '前'}走一步，剩余提示 ${snap.hintsLeft} 次`)
        } else if (snap.lastAction === 'reset') {
          setLiveAnnounce('本局已重置，回到起点重新出发')
        } else if (snap.lastAction === 'win') {
          setLiveAnnounce(`到达终点，用了 ${snap.steps} 步，得分 ${snap.score}`)
        } else if (snap.lastAction === 'timeout') {
          setLiveAnnounce('时间到，挑战失败')
        } else if (snap.lastAction === 'pause') {
          setLiveAnnounce('已暂停')
        } else if (snap.lastAction === 'resume') {
          setLiveAnnounce('继续游戏')
        }
      },
      onGameOver: (score, elapsed, result) => {
        const snap = snapshotRef.current
        const level = snap?.tier || 'easy'
        setFinalLevel(level)
        setFinalElapsed(elapsed)
        setFinalResult(result)
        setFinalScore(score)
        setFinalSteps(snap?.steps || 0)
        setFinalPar(snap?.par || 0)
        setFinalHints(snap?.hintUsed || 0)

        if (result === 'win') {
          bumpStats((s) => {
            s.wins[level] = (s.wins[level] || 0) + 1
            s.steps = (s.steps || 0) + (snap?.steps || 0)
            s.timeByLevel[level] = Math.round(((s.timeByLevel[level] || 0) + elapsed) * 10) / 10
          })
          // 仅在分数更高时覆盖最佳记录；读取/写入失败降级为仅内存展示
          const current = loadBest()
          const cur = current[level]
          if (!cur || cur.score < score) {
            const next = {
              ...current,
              [level]: {
                score,
                steps: snap?.steps || 0,
                time: Math.round(elapsed * 10) / 10,
                hints: snap?.hintUsed || 0,
              },
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
        } else if (result === 'timeout') {
          bumpStats((s) => { s.timeouts[level] = (s.timeouts[level] || 0) + 1 })
        }

        changeScreen('over')
        setTimeout(() => {
          document.querySelector('.mz-overlay-card .mz-btn-primary')?.focus()
        }, 0)
      },
      onPause: () => {
        setPausedAuto(autoPauseRef.current)
        if (stateRef.current === 'playing') changeScreen('paused')
      },
    })
    engineRef.current = engine
    return () => {
      clearTimeout(genTimerRef.current)
      clearTimeout(hintTimerRef.current)
      engine.dispose()
    }
  }, [])

  // ---------- 倒计时驱动 ----------
  useEffect(() => {
    if (screen !== 'playing') return
    const timer = setInterval(() => engineRef.current?.tick(), MAZE.TICK_MS)
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

  const focusCell = () => {
    setTimeout(() => {
      document.querySelector('.mz-board .mz-cell[tabindex="0"]')?.focus({ preventScroll: true })
    }, 0)
  }

  // ---------- 开局：先进入 loading 态，下一帧再生成，保证「生成中」可见 ----------
  const handleStart = (level) => {
    const tier = level in TIERS ? level : 'easy'
    lastTierRef.current = tier
    clearTimeout(genTimerRef.current)
    clearTimeout(hintTimerRef.current)
    setHintIdx(-1)
    setEngineError(false)
    setPausedAuto(false)
    changeScreen('loading')
    genTimerRef.current = setTimeout(() => {
      try {
        engineRef.current?.start(tier, 'new')
      } catch {
        setEngineError(true)
        changeScreen('error')
        return
      }
      bumpStats((s) => { s.plays[tier] = (s.plays[tier] || 0) + 1 })
      announceKeyRef.current = ''
      setFocusedIdx(0)
      changeScreen('playing')
      focusCell()
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
    focusCell()
  }

  const handleReset = () => {
    if (stateRef.current !== 'playing') return
    engineRef.current?.reset()
    bumpStats((s) => { s.resets = (s.resets || 0) + 1 })
    setFocusedIdx(0)
    setHintIdx(-1)
    focusCell()
  }

  // ---------- 移动 ----------
  const moveByDir = (dir) => {
    if (stateRef.current !== 'playing') return
    engineRef.current?.move(dir)
    const snap = snapshotRef.current
    if (snap) setFocusedIdx(snap.player)
    focusCell()
  }

  const handleCellClick = (idx) => {
    const snap = snapshotRef.current
    if (!snap || snap.state !== 'playing') return
    if (idx === snap.player) {
      setLiveAnnounce(`当前位置：第 ${Math.floor(idx / snap.size) + 1} 行第 ${(idx % snap.size) + 1} 列，距终点最短 ${snap.distance} 步`)
      return
    }
    const pr = Math.floor(snap.player / snap.size)
    const pc = snap.player % snap.size
    const dr = Math.floor(idx / snap.size) - pr
    const dc = (idx % snap.size) - pc
    if (Math.abs(dr) + Math.abs(dc) !== 1) {
      setLiveAnnounce('只能点按当前位置上下左右的相邻格')
      return
    }
    if (dr === -1) moveByDir('up')
    else if (dr === 1) moveByDir('down')
    else if (dc === -1) moveByDir('left')
    else moveByDir('right')
  }

  // ---------- 键盘：方向键直接移动（roving tabindex 跟随玩家），Enter/Space 播报当前格 ----------
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
      e.preventDefault()
      const walls = snap.walls[focusedIdx] ?? 0
      setLiveAnnounce(`第 ${Math.floor(focusedIdx / snap.size) + 1} 行第 ${(focusedIdx % snap.size) + 1} 列，${openDirsText(walls)}`)
    }
  }

  // ---------- 单指滑动 ----------
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
    if (Math.max(ax, ay) < MAZE.SWIPE_MIN) return
    if (ax >= ay) moveByDir(dx > 0 ? 'right' : 'left')
    else moveByDir(dy > 0 ? 'down' : 'up')
  }

  const handleHint = () => {
    if (stateRef.current !== 'playing') return
    const dir = engineRef.current?.hint()
    if (!dir) {
      setLiveAnnounce('提示次数已用完')
      return
    }
    const to = snapshotRef.current?.lastHint?.to ?? -1
    setHintIdx(to)
    clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHintIdx(-1), 1400)
  }

  const bestOfLevel = (level) => best[level]?.score
  const hasAnyBest = LEVELS.some((lv) => best[lv])
  const showBoard = snapshot && snapshot.size > 0 && (screen === 'playing' || screen === 'paused' || screen === 'over')

  return (
    <div className="mz-page" role="application" aria-label="迷宫寻路小游戏">
      <header className="mz-top">
        <Link to="/" className="mz-back" aria-label="返回首页">← 首页</Link>
        <h1 className="mz-title">迷宫寻路</h1>
        {(screen === 'playing' || screen === 'paused') && (
          <button
            type="button"
            className="mz-pause-btn"
            onClick={screen === 'paused' ? handleResume : handlePause}
            aria-label={screen === 'paused' ? '继续游戏' : '暂停游戏'}
          >
            {screen === 'paused' ? '继续' : '暂停'}
          </button>
        )}
      </header>

      {/* HUD */}
      <div className="mz-hud" aria-label="游戏信息">
        <div className="mz-stat">
          <span className="mz-stat-label">步数</span>
          <span className="mz-stat-val">{snapshot?.state === 'start' ? '—' : snapshot?.steps ?? '—'}</span>
        </div>
        <div className="mz-stat">
          <span className="mz-stat-label">参考</span>
          <span className="mz-stat-val">{snapshot?.state === 'start' ? '—' : snapshot?.par ?? '—'}</span>
        </div>
        <div className="mz-stat">
          <span className="mz-stat-label">提示</span>
          <span className="mz-stat-val">{snapshot?.state === 'start' ? '—' : snapshot?.hintsLeft ?? '—'}</span>
        </div>
        <div className="mz-stat">
          <span className="mz-stat-label">倒计时</span>
          <span className="mz-stat-val mz-timer" role="timer" aria-live="off">
            {snapshot && snapshot.state !== 'start' ? fmtTime(snapshot.remaining) : '—'}
          </span>
        </div>
      </div>

      {/* 读屏播报（视觉隐藏） */}
      <div aria-live="polite" aria-atomic="true" className="mz-live">{liveAnnounce}</div>

      {/* 迷宫盘面 */}
      {showBoard && (
        <div
          className="mz-board-wrap"
          style={{ pointerEvents: screen === 'paused' ? 'none' : 'auto' }}
          aria-hidden={screen === 'paused'}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="mz-board"
            role="grid"
            aria-label={`${snapshot.size} 行 ${snapshot.size} 列迷宫，从左上角走到右下角`}
            tabIndex={-1}
            onKeyDown={handleBoardKeyDown}
            style={{ '--mz-cols': snapshot.size }}
          >
            {renderRows(snapshot, focusedIdx, hintIdx, handleCellClick)}
          </div>
        </div>
      )}

      {/* 底部动作区 */}
      {(screen === 'playing' || screen === 'paused') && (
        <div className="mz-actions">
          <button
            type="button"
            className="mz-btn"
            onClick={handleHint}
            disabled={screen === 'paused' || !snapshot?.hintsLeft}
          >
            提示 ({snapshot?.hintsLeft ?? 0})
          </button>
          <button
            type="button"
            className="mz-btn"
            onClick={handleReset}
            disabled={screen === 'paused'}
          >
            重走本局
          </button>
          <button
            type="button"
            className="mz-btn"
            onClick={() => handleStart(snapshot?.tier || 'easy')}
            disabled={screen === 'paused'}
          >
            换新迷宫
          </button>
        </div>
      )}

      <p className="mz-hint">点按当前位置上下左右的格子、在盘面上滑动或按方向键移动；步数越少、用时越短，得分越高。</p>

      {/* start 遮罩 */}
      {screen === 'start' && (
        <div className="mz-overlay">
          <div className="mz-overlay-card mz-start-card">
            <h2>迷宫寻路</h2>
            <p>从左上角走到右下角，撞墙不计步。每局随机生成一张全连通的迷宫，步数越少、用时越短，得分越高。</p>
            <p className="mz-overlay-hint">单指滑动、点按相邻格或方向键移动；每局有 3 次提示，使用提示会扣分。</p>
            <div className="mz-diff-list" aria-label="选择难度">
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className="mz-diff-btn"
                  onClick={() => handleStart(lv)}
                  aria-label={`${TIERS[lv].label}难度，${TIERS[lv].desc}，限时 ${TIERS[lv].limitSec} 秒${bestOfLevel(lv) ? `，最佳 ${bestOfLevel(lv)} 分` : ''}`}
                >
                  <span className="mz-diff-name">{TIERS[lv].label}</span>
                  <span className="mz-diff-meta">
                    {TIERS[lv].desc} · 限时 {TIERS[lv].limitSec}s · {bestOfLevel(lv) ? `最佳 ${bestOfLevel(lv)}` : '暂无记录'}
                  </span>
                </button>
              ))}
            </div>
            {!hasAnyBest && (
              <p className="mz-empty">暂无最佳记录，完成一局后自动保存在本机。</p>
            )}
          </div>
        </div>
      )}

      {/* loading 遮罩（生成中） */}
      {screen === 'loading' && (
        <div className="mz-overlay">
          <div className="mz-overlay-card" role="status" aria-live="polite">
            <div className="mz-spinner" aria-hidden="true" />
            <h2>正在生成迷宫…</h2>
            <p>随机凿开通道，并校验起点到终点的连通性。</p>
          </div>
        </div>
      )}

      {/* error 遮罩（生成失败） */}
      {screen === 'error' && (
        <div className="mz-overlay">
          <div className="mz-overlay-card">
            <h2>迷宫生成失败</h2>
            <p>{engineError ? '本次随机生成未能得到连通迷宫，请重试。' : '未知错误，请重试。'}</p>
            <div className="mz-btns">
              <button type="button" className="mz-btn-primary" onClick={() => handleStart(lastTierRef.current)}>
                重试
              </button>
              <Link to="/" className="mz-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* paused 遮罩 */}
      {screen === 'paused' && (
        <div className="mz-overlay">
          <div className="mz-overlay-card">
            <h2>{pausedAuto ? '已自动暂停' : '已暂停'}</h2>
            <p>{pausedAuto ? '检测到页面切走或窗口失焦，计时已冻结。' : '手动暂停中，计时已冻结。'}</p>
            <div className="mz-btns">
              <button type="button" className="mz-btn-primary" onClick={handleResume}>继续</button>
              <Link to="/" className="mz-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* over 遮罩 */}
      {screen === 'over' && (
        <div className="mz-overlay">
          <div className={`mz-overlay-card${finalResult === 'win' ? ' mz-overlay-win' : ''}`}>
            <h2>{finalResult === 'win' ? '到达终点！' : '时间到'}</h2>
            <p>
              {finalResult === 'win'
                ? `你用了 ${finalSteps} 步走完迷宫，参考最短 ${finalPar} 步。`
                : `限时 ${TIERS[finalLevel]?.limitSec} 秒内未到达终点，本局结束。`}
            </p>
            <div className="mz-summary">
              <div><span>难度</span><strong>{TIERS[finalLevel]?.label}</strong></div>
              <div><span>步数</span><strong>{finalSteps}</strong></div>
              <div><span>参考</span><strong>{finalPar}</strong></div>
              <div><span>提示</span><strong>{finalHints} 次</strong></div>
              <div><span>用时</span><strong>{fmtTime(finalElapsed)}</strong></div>
              <div><span>得分</span><strong>{finalScore}</strong></div>
            </div>
            <p className="mz-best">
              历史最佳：<strong>{bestOfLevel(finalLevel) ?? '—'}</strong>
              {saveError && <span className="mz-save-err">（本局成绩未保存，本地存储不可用）</span>}
            </p>
            <div className="mz-btns">
              <button type="button" className="mz-btn-primary" onClick={() => handleStart(finalLevel)}>再来一局</button>
              <Link to="/" className="mz-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 按行渲染：行 role=row，格 role=gridcell，内部原生 button（roving tabindex 跟随玩家） */
function renderRows(snapshot, focusedIdx, hintIdx, onCellClick) {
  const { size, walls, player, goal, visited } = snapshot
  const out = []
  for (let r = 0; r < size; r++) {
    const cells = []
    for (let c = 0; c < size; c++) {
      const idx = r * size + c
      const w = walls[idx] ?? 0
      const isPlayer = player === idx
      const isGoal = goal === idx
      const isVisited = Boolean(visited[idx])
      const label = isPlayer ? '，你的位置' : isGoal ? '，终点' : isVisited ? '，已走过' : ''
      cells.push(
        <div key={idx} role="gridcell" className="mz-cell-wrap">
          <button
            type="button"
            data-idx={idx}
            className={`mz-cell${isVisited ? ' mz-visited' : ''}${isPlayer ? ' mz-here' : ''}${isGoal ? ' mz-goal' : ''}${hintIdx === idx ? ' mz-hint-cell' : ''}`}
            tabIndex={focusedIdx === idx ? 0 : -1}
            aria-label={`第${r + 1}行第${c + 1}列${label}，${openDirsText(w)}`}
            onClick={() => onCellClick(idx)}
          >
            {w & MAZE.WALL_N ? <span className="mz-wall mz-wall-n" aria-hidden="true" /> : null}
            {w & MAZE.WALL_E ? <span className="mz-wall mz-wall-e" aria-hidden="true" /> : null}
            {w & MAZE.WALL_S ? <span className="mz-wall mz-wall-s" aria-hidden="true" /> : null}
            {w & MAZE.WALL_W ? <span className="mz-wall mz-wall-w" aria-hidden="true" /> : null}
            {isGoal && !isPlayer && <span className="mz-goal-dot" aria-hidden="true" />}
            {isPlayer && <span className="mz-player-dot" aria-hidden="true" />}
          </button>
        </div>
      )
    }
    out.push(<div key={r} role="row" className="mz-row">{cells}</div>)
  }
  return out
}

export default MazePage
