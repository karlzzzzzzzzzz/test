import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PuzzleEngine, SOLVED_BOARD } from '../game/PuzzleEngine'
import './Puzzle.css'

const SIZE = 3

/**
 * 数字华容道页面壳
 * 架构对齐 Whack.jsx / Memory.jsx：UI 四态状态机（idle / playing / paused / over）
 * + 纯逻辑引擎 + 回调通信；visibilitychange / blur 双路去重暂停。
 */
function PuzzlePage() {
  const engineRef = useRef(null)
  const stateRef = useRef('idle')
  const pausedByVisibilityRef = useRef(false)
  const startLockRef = useRef(0)
  const boardRef = useRef(null)
  const touchRef = useRef({ id: null, x: 0, y: 0 })
  const dragRef = useRef({ active: false, x: 0, y: 0 })

  const [screen, setScreen] = useState('idle')
  const [snapshot, setSnapshot] = useState(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [final, setFinal] = useState(null)
  const [bootError, setBootError] = useState(false)
  const [liveAnnounce, setLiveAnnounce] = useState('')

  const changeScreen = (s) => {
    stateRef.current = s
    setScreen(s)
  }

  // 引擎创建（供首次挂载与「重试」复用）；构造异常时显示错误态而非白屏
  const createEngine = () => {
    try {
      const engine = new PuzzleEngine({
        onState: (snap) => {
          setSnapshot(snap)
          if (snap.state !== stateRef.current) {
            stateRef.current = snap.state
            setScreen(snap.state)
          }
        },
        onElapsed: (ms) => setElapsedSec(Math.round(ms / 100) / 10),
        onWin: (res) => setFinal(res),
        onPause: (reason) => setPausedAuto(reason !== 'manual'),
      })
      engineRef.current = engine
      setSnapshot(engine.getSnapshot())
      setBootError(false)
    } catch {
      engineRef.current = null
      setBootError(true)
    }
  }

  useEffect(() => {
    createEngine()
    const onPageHide = () => engineRef.current?.pause('manual')
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      engineRef.current?.dispose()
    }
  }, [])

  // 切后台 / 失焦自动暂停（visibilitychange + blur 双触发去重，对齐 3.3.6）
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        pausedByVisibilityRef.current = true
        engineRef.current?.pause('auto')
      }
    }
    const onBlur = () => {
      if (pausedByVisibilityRef.current) {
        pausedByVisibilityRef.current = false
        return
      }
      engineRef.current?.pause('auto')
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // 棋盘内 touchmove 需非 passive 监听才能阻止页面滚动/缩放
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const onTouchMove = (e) => {
      if (touchRef.current.id !== null) e.preventDefault()
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  // 鼠标拖动：按下记录起点，抬起按位移判定方向（与触控语义一致）
  const applySwipe = (dx, dy) => {
    if (stateRef.current !== 'playing') return
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    if (Math.max(ax, ay) < 24) return
    // 主轴分量占比 >70% 才判定方向，斜向忽略
    if (Math.max(ax, ay) / (ax + ay) <= 0.7) return
    const dir = ax > ay ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
    engineRef.current?.move(dir)
  }

  useEffect(() => {
    const onMouseUp = (e) => {
      if (!dragRef.current.active) return
      dragRef.current.active = false
      applySwipe(e.clientX - dragRef.current.x, e.clientY - dragRef.current.y)
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [])

  const handleTouchStart = (e) => {
    if (stateRef.current !== 'playing') return
    const t = e.changedTouches[0]
    touchRef.current = { id: t.identifier, x: t.clientX, y: t.clientY }
  }

  const handleTouchEnd = (e) => {
    const start = touchRef.current
    touchRef.current = { id: null, x: 0, y: 0 }
    if (start.id === null) return
    const t = Array.from(e.changedTouches).find((item) => item.identifier === start.id)
    if (!t) return
    applySwipe(t.clientX - start.x, t.clientY - start.y)
  }

  const handleTouchCancel = () => {
    touchRef.current = { id: null, x: 0, y: 0 }
  }

  const handleMouseDown = (e) => {
    if (stateRef.current !== 'playing' || e.button !== 0) return
    dragRef.current = { active: true, x: e.clientX, y: e.clientY }
  }

  const handleStart = () => {
    if (!engineRef.current) {
      createEngine()
      return
    }
    const now = Date.now()
    if (now - startLockRef.current < 300) return // 300ms 连点防抖，仅接受首次
    startLockRef.current = now
    setFinal(null)
    setElapsedSec(0)
    engineRef.current.start()
    changeScreen('playing')
    setLiveAnnounce('游戏开始，点按空格相邻方块或滑动棋盘移动')
    window.setTimeout(() => {
      boardRef.current?.querySelector('.pz-tile')?.focus()
    }, 0)
  }

  const handlePause = () => {
    engineRef.current?.pause('manual')
  }

  const handleResume = () => {
    if (document.hidden) return // 页面不可见时拒绝恢复
    engineRef.current?.resume()
    changeScreen('playing')
  }

  const board = snapshot?.board ?? SOLVED_BOARD
  const locked = screen !== 'playing'

  return (
    <div className="pz-page" role="application" aria-label="数字华容道小游戏">
      <header className="pz-top">
        <Link to="/" className="pz-back" onClick={() => engineRef.current?.pause('manual')} aria-label="返回首页">
          ← 首页
        </Link>
        <h1 className="pz-title">数字华容道</h1>
        {(screen === 'playing' || screen === 'paused') && (
          <button
            type="button"
            className="pz-pause-btn"
            onClick={screen === 'paused' ? handleResume : handlePause}
            aria-label={screen === 'paused' ? '继续游戏' : '暂停游戏'}
          >
            {screen === 'paused' ? '继续' : '暂停'}
          </button>
        )}
      </header>

      {/* HUD：步数 / 用时 */}
      <div className="pz-hud" aria-label="游戏数据">
        <div className="pz-stat">
          <span className="pz-stat-label">步数</span>
          <span className="pz-stat-val">{snapshot?.steps ?? 0}</span>
        </div>
        <div className="pz-stat">
          <span className="pz-stat-label">用时</span>
          <span className="pz-stat-val pz-timer" role="timer" aria-live="off">
            {elapsedSec.toFixed(1)}s
          </span>
        </div>
      </div>

      <div aria-live="polite" aria-atomic="true" className="pz-live-region">{liveAnnounce}</div>

      {/* 3×3 棋盘：空格相邻方块可点按，也可滑动整盘 */}
      <div className="pz-board-wrap">
        <div
          ref={boardRef}
          className={`pz-board${locked ? ' pz-locked' : ''}${screen === 'over' ? ' pz-board-done' : ''}`}
          role="grid"
          aria-label="3行3列数字华容道棋盘"
          aria-rowcount={SIZE}
          aria-colcount={SIZE}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          onMouseDown={handleMouseDown}
        >
          {Array.from({ length: SIZE }, (_, r) => (
            <div key={r} role="row" className="pz-row">
              {Array.from({ length: SIZE }, (_, c) => {
                const idx = r * SIZE + c
                const value = board[idx]
                const moved = snapshot?.lastMovedIdx === idx
                return (
                  <div key={idx} role="gridcell" className="pz-cell">
                    {value === 0 ? (
                      <span className="pz-blank" aria-hidden="true" />
                    ) : (
                      <button
                        type="button"
                        className={`pz-tile${moved ? ' pz-tile-moved' : ''}`}
                        aria-label={`第${r + 1}行第${c + 1}列，数字${value}`}
                        onClick={() => engineRef.current?.tap(idx)}
                      >
                        {value}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="pz-hint">点按空格相邻方块 · 滑动棋盘换位</p>

      {/* idle 遮罩：玩法说明 + 开始 */}
      {screen === 'idle' && !bootError && (
        <div className="pz-overlay">
          <div className="pz-overlay-card">
            <h2>数字华容道</h2>
            <p>把 1~8 按顺序排好，空格留在右下角。点按空格上下左右的方块，或在棋盘上滑动让空格移动一格。</p>
            <p className="pz-overlay-hint">支持点按、鼠标拖动、单指滑动与键盘焦点 + Enter/Space。</p>
            <p className="pz-best">
              本会话最佳：<strong>{snapshot?.hasBest ? `${snapshot.bestSteps} 步` : '—（暂无记录）'}</strong>
            </p>
            <div className="pz-btns">
              <button type="button" className="pz-btn-primary" onClick={handleStart}>开始挑战</button>
            </div>
          </div>
        </div>
      )}

      {/* 错误态：引擎初始化失败 */}
      {bootError && (
        <div className="pz-overlay">
          <div className="pz-overlay-card" role="dialog" aria-modal="true" aria-label="棋盘加载失败">
            <h2>棋盘加载失败，请重试</h2>
            <p>引擎未能初始化，点击下方按钮重建棋盘。</p>
            <div className="pz-btns">
              <button type="button" className="pz-btn-primary" onClick={createEngine}>重试</button>
              <Link to="/" className="pz-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* paused 遮罩 */}
      {screen === 'paused' && (
        <div className="pz-overlay">
          <div className="pz-overlay-card" role="dialog" aria-modal="true" aria-label="游戏已暂停">
            <h2>{pausedAuto ? '已自动暂停' : '已暂停'}</h2>
            <p>{pausedAuto ? '检测到页面切走或窗口失焦，计时已冻结' : '手动暂停中，计时已冻结'}</p>
            <div className="pz-btns">
              <button type="button" className="pz-btn-primary" onClick={handleResume}>继续游戏</button>
              <Link to="/" className="pz-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* over 遮罩：结算 */}
      {screen === 'over' && (
        <div className="pz-overlay">
          <div className="pz-overlay-card" role="dialog" aria-modal="true" aria-label="本局结算">
            <h2>全部归位！</h2>
            {final?.newRecord && <p className="pz-record">新纪录！</p>}
            <div className="pz-summary">
              <div><span>步数</span><strong>{final?.steps ?? 0}</strong></div>
              <div><span>用时</span><strong>{((final?.elapsedMs ?? 0) / 1000).toFixed(1)}s</strong></div>
              <div><span>最佳步数</span><strong>{final?.bestSteps ?? 0}</strong></div>
            </div>
            <div className="pz-btns">
              <button type="button" className="pz-btn-primary" onClick={handleStart}>再来一局</button>
              <Link to="/" className="pz-btn">返回首页</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PuzzlePage
