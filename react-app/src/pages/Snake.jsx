import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SnakeEngine, DIR, SNAKE } from '../game/SnakeEngine'
import { createLeaderboard } from '../api/leaderboard'
import './Snake.css'

const { COLS, ROWS } = SNAKE
const CELL = 24 // 棋盘逻辑格 px（Canvas 内部坐标系）
const SWIPE_DIST = 24 // 触控转向位移阈值（对齐 2048）
const TAP_MAX_MS = 200 // 点按判定：时长上限
const TAP_MAX_DIST = 10 // 点按判定：位移上限

// 贪吃蛇排行榜（复用 leaderboard.js 参数化 API，不改该文件）
const snakeLeaderboard = createLeaderboard('game-snake-leaderboard-v1')

// 键盘 → 方向（↑↓←→ / WASD）
const KEY_DIRS = {
  ArrowUp: DIR.up, w: DIR.up, W: DIR.up,
  ArrowDown: DIR.down, s: DIR.down, S: DIR.down,
  ArrowLeft: DIR.left, a: DIR.left, A: DIR.left,
  ArrowRight: DIR.right, d: DIR.right, D: DIR.right,
}

/**
 * 贪吃蛇页面壳
 * 架构参照基线 Game.jsx / Game2048.jsx / Tetris.jsx：UI 状态机 + 引擎 + 回调通信
 * 状态：start | playing | paused | over
 */
function SnakePage() {
  const engineRef = useRef(null)
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const boardWrapRef = useRef(null)
  const gestureRef = useRef(null) // 触控手势跟踪态
  const stateRef = useRef('start')
  const pausedByVisibilityRef = useRef(false) // visibility/blur 去重标志（参照 2048）
  const autoPauseRef = useRef(false) // 本次暂停是否由切后台/失焦触发（区分暂停屏文案）
  const elapsedRef = useRef(0)

  const [screen, setScreen] = useState('start')
  const [snapshot, setSnapshot] = useState(null)
  const [pausedAuto, setPausedAuto] = useState(false) // 暂停屏文案：自动/手动
  const [board, setBoard] = useState([])
  const [boardLoading, setBoardLoading] = useState(true)
  const [playerName, setPlayerName] = useState('')
  const [submitState, setSubmitState] = useState('idle')
  const [myRank, setMyRank] = useState(null)
  const [finalScore, setFinalScore] = useState(0)
  const [finalWin, setFinalWin] = useState(false)

  const changeScreen = (s) => {
    stateRef.current = s
    setScreen(s)
  }

  // 引擎生命周期
  useEffect(() => {
    const engine = new SnakeEngine({
      onState: (snap) => {
        setSnapshot(snap)
        if (snap.state !== stateRef.current) {
          stateRef.current = snap.state
          setScreen(snap.state)
        }
      },
      onGameOver: (score, elapsed, win) => {
        setFinalScore(score)
        setFinalWin(win)
        elapsedRef.current = elapsed
        changeScreen('over')
      },
      // 暂停（切后台/失焦/P 键/点按共用引擎 pause）
      onPause: () => {
        setPausedAuto(autoPauseRef.current)
        if (stateRef.current === 'playing') changeScreen('paused')
      },
    })
    engineRef.current = engine
    return () => engine.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Canvas 初始化（devicePixelRatio 上限 2，对齐 MouseTrail/Tetris 策略）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = COLS * CELL * dpr
    canvas.height = ROWS * CELL * dpr
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctxRef.current = ctx
  }, [])

  // Canvas 渲染：快照变化时整盘重绘（20×20=400 格，远低于 Canvas 2D 瓶颈）
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const W = COLS * CELL
    const H = ROWS * CELL
    // 背景
    ctx.fillStyle = '#0a0e1c'
    ctx.fillRect(0, 0, W, H)
    // 网格线
    ctx.strokeStyle = 'rgba(120, 170, 255, 0.07)'
    ctx.lineWidth = 1
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath()
      ctx.moveTo(c * CELL + 0.5, 0)
      ctx.lineTo(c * CELL + 0.5, H)
      ctx.stroke()
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.beginPath()
      ctx.moveTo(0, r * CELL + 0.5)
      ctx.lineTo(W, r * CELL + 0.5)
      ctx.stroke()
    }
    if (!snapshot) return
    // 食物（金色高亮块 + 光晕）
    if (snapshot.food) {
      const { x, y } = snapshot.food
      ctx.shadowColor = 'rgba(255, 209, 102, 0.8)'
      ctx.shadowBlur = 10
      ctx.fillStyle = '#ffd166'
      ctx.fillRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4)
      ctx.shadowBlur = 0
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)' // 顶部高光
      ctx.fillRect(x * CELL + 2, y * CELL + 2, CELL - 4, 4)
    }
    // 蛇体：头亮尾暗渐进色（头 → 尾 亮度递减）
    const len = snapshot.snake.length
    for (let i = len - 1; i >= 0; i--) {
      const seg = snapshot.snake[i]
      const ratio = len > 1 ? i / (len - 1) : 0
      const light = 62 - ratio * 32 // 62% → 30%
      ctx.fillStyle = `hsl(152, 68%, ${light}%)`
      ctx.fillRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2)
      if (i === 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.28)' // 蛇头顶部高光
        ctx.fillRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, 4)
      }
    }
  }, [snapshot])

  // 排行榜与昵称（复用 game-player-name，对齐 3.2.5）
  const loadBoard = async () => {
    setBoardLoading(true)
    try {
      setBoard(await snakeLeaderboard.fetchTopScores())
    } catch {
      setBoard([])
    } finally {
      setBoardLoading(false)
    }
  }

  useEffect(() => {
    setPlayerName(localStorage.getItem('game-player-name') || '')
    loadBoard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 切后台 / 失焦暂停（约束卡②，visibilitychange + blur 双触发去重，参照 2048）
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        pausedByVisibilityRef.current = true
        autoPauseRef.current = true
        engineRef.current?.pause()
      } else {
        pausedByVisibilityRef.current = false
      }
    }
    const onBlur = () => {
      if (pausedByVisibilityRef.current) return
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

  // 键盘控制：↑↓←→ / WASD 转向，P 或空格暂停/恢复（失焦清键由 blur 暂停路径覆盖，无长按连发状态）
  useEffect(() => {
    const onKeyDown = (e) => {
      const s = stateRef.current
      if (s === 'playing' || s === 'paused') {
        if (e.key === 'p' || e.key === 'P' || e.key === ' ') {
          e.preventDefault()
          if (s === 'playing') {
            autoPauseRef.current = false
            engineRef.current?.pause()
          } else {
            handleResume()
          }
          return
        }
      }
      if (s !== 'playing') return // over/start 态按键全部忽略
      const d = KEY_DIRS[e.key]
      if (d) {
        e.preventDefault()
        engineRef.current?.enqueue(d) // 缓冲过滤同向/反向，repeat 连发自然去重
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 触控控制（约束卡①）：滑动 ≥24px 转向（主轴判定）/ 点按切换暂停恢复
  const onTouchStart = (e) => {
    const s = stateRef.current
    if (s !== 'playing' && s !== 'paused') return // 点按恢复需在 paused 态也能起手势
    const t = e.touches[0]
    if (!t) return
    gestureRef.current = {
      id: t.identifier, // 多点触摸仅跟踪首指
      x0: t.clientX,
      y0: t.clientY,
      t0: performance.now(),
      startState: s,
    }
  }
  const onTouchMove = (e) => {
    const g = gestureRef.current
    if (!g || g.startState !== 'playing' || stateRef.current !== 'playing') return
    e.preventDefault() // 阻止页面滚动/缩放
    const t = [...e.touches].find((x) => x.identifier === g.id)
    if (!t) return
    const dx = t.clientX - g.x0
    const dy = t.clientY - g.y0
    // 位移 ≥24px 判定转向：水平/垂直取分量较大者（斜向取主轴，无对角移动）
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_DIST) {
      const d =
        Math.abs(dx) > Math.abs(dy)
          ? dx > 0 ? DIR.right : DIR.left
          : dy > 0 ? DIR.down : DIR.up
      engineRef.current?.enqueue(d)
      g.x0 = t.clientX // 重置起点：继续拖动可再次累积转向
      g.y0 = t.clientY
    }
  }
  const onTouchEnd = (e) => {
    const g = gestureRef.current
    if (!g) return
    const t = [...e.changedTouches].find((x) => x.identifier === g.id)
    gestureRef.current = null
    if (!t) return
    // 点按（<200ms 且位移 <10px）：playing → 暂停；paused → 恢复
    const dt = performance.now() - g.t0
    const dist = Math.hypot(t.clientX - g.x0, t.clientY - g.y0)
    if (dt < TAP_MAX_MS && dist < TAP_MAX_DIST) {
      if (g.startState === 'playing' && stateRef.current === 'playing') {
        autoPauseRef.current = false
        engineRef.current?.pause()
      } else if (g.startState === 'paused' && stateRef.current === 'paused') {
        handleResume()
      }
    }
  }
  const onTouchCancel = () => {
    gestureRef.current = null // 清空跟踪态（对齐 3.4.4）
  }

  const handleStart = () => {
    setSubmitState('idle')
    setMyRank(null)
    engineRef.current?.start()
    changeScreen('playing')
  }

  const handleResume = () => {
    engineRef.current?.resume()
    changeScreen('playing')
  }

  const handleSubmitScore = async () => {
    if (submitState === 'sending' || submitState === 'done') return
    const name = (playerName.trim() || '无名飞侠').slice(0, 12)
    try {
      localStorage.setItem('game-player-name', name)
    } catch {
      // localStorage 不可用时昵称不持久化，不影响提交
    }
    setSubmitState('sending')
    try {
      const { rank } = await snakeLeaderboard.submitScore(name, finalScore, elapsedRef.current)
      setMyRank(rank)
      setSubmitState('done')
      loadBoard()
    } catch {
      setSubmitState('error')
    }
  }

  const score = snapshot?.score ?? 0
  const length = snapshot?.length ?? 0
  const bestScore = board[0]?.score ?? 0 // 最高分 = 排行榜第一名，不单设存储键

  return (
    <div className="snake-page">
      {/* 顶部 HUD */}
      <div className="snake-hud">
        <Link to="/index.html" className="snake-back">
          ← 返回首页
        </Link>
        <div className="snake-scores">
          <div className="snake-score-box">
            <span className="snake-score-label">得分</span>
            <span className="snake-score-value" key={score /* 强制重渲染触发 bump 动画 */}>
              {score}
            </span>
          </div>
          <div className="snake-score-box">
            <span className="snake-score-label">最高分</span>
            <span className="snake-score-value snake-best">{bestScore}</span>
          </div>
          <div className="snake-score-box">
            <span className="snake-score-label">长度</span>
            <span className="snake-score-value">{length}</span>
          </div>
        </div>
      </div>

      {/* 游戏区 */}
      <div
        ref={boardWrapRef}
        className="snake-board-wrap"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        <canvas ref={canvasRef} className="snake-canvas" aria-label="贪吃蛇棋盘" />
      </div>

      {/* 移动端操作提示条（<768 显示，约束卡①） */}
      <p className="snake-touch-tip">滑动转向 · 点按暂停</p>

      {/* 开始屏 */}
      {screen === 'start' && (
        <div className="snake-overlay">
          <div className="snake-panels">
            <div className="snake-panel">
              <h1>贪吃蛇</h1>
              <p className="snake-tip">
                方向键 / WASD 转向，P 或空格暂停。
                <br />
                吃食物 +10 分，每 50 分提速 1 档（150ms → 60ms/格）。
                <br />
                <span className="snake-tip-tech">
                  输入缓冲引擎：方向输入经容量 2 缓冲队列逐拍消费，快速连按不自杀
                </span>
              </p>
              <button type="button" className="snake-btn" onClick={handleStart}>
                开始游戏
              </button>
            </div>
            <LeaderboardPanel board={board} loading={boardLoading} />
          </div>
        </div>
      )}

      {/* 暂停屏（切后台/失焦自动暂停 与 P 键/点按手动暂停 共用，文案区分） */}
      {screen === 'paused' && (
        <div className="snake-overlay">
          <div className="snake-panel">
            <h1>已暂停</h1>
            <p className="snake-tip">
              {pausedAuto ? (
                <>
                  检测到你切换了页面，游戏已自动暂停。
                  <br />
                  点击继续回到棋局。
                </>
              ) : (
                <>
                  游戏已暂停。
                  <br />
                  点击继续回到棋局。
                </>
              )}
            </p>
            <button type="button" className="snake-btn" onClick={handleResume}>
              继续游戏
            </button>
            <Link to="/index.html" className="snake-home-link">
              返回首页
            </Link>
          </div>
        </div>
      )}

      {/* 结束屏 */}
      {screen === 'over' && (
        <div className="snake-overlay">
          <div className="snake-panels">
            <div className="snake-panel">
              <h1>{finalWin ? '通关！' : '游戏结束'}</h1>
              <p className="snake-final">
                {finalWin ? `蛇占满整个棋盘，最终得分：${finalScore}` : `最终得分：${finalScore}`}
              </p>
              {finalScore > 0 && (
                <div className="snake-submit">
                  {submitState === 'done' ? (
                    <p className="snake-rank-line">已上榜，当前排名：第 {myRank} 名</p>
                  ) : (
                    <>
                      <input
                        className="snake-name-input"
                        value={playerName}
                        maxLength={12}
                        placeholder="输入昵称上榜"
                        onChange={(e) => setPlayerName(e.target.value)}
                      />
                      <button
                        type="button"
                        className="snake-btn snake-btn-ghost"
                        onClick={handleSubmitScore}
                        disabled={submitState === 'sending'}
                      >
                        {submitState === 'sending' ? '提交中…' : '提交排行榜'}
                      </button>
                    </>
                  )}
                  {submitState === 'error' && (
                    <p className="snake-submit-error">提交失败，请重试</p>
                  )}
                </div>
              )}
              <button type="button" className="snake-btn" onClick={handleStart}>
                再来一局
              </button>
              <Link to="/index.html" className="snake-home-link">
                返回首页
              </Link>
            </div>
            <LeaderboardPanel board={board} loading={boardLoading} />
          </div>
        </div>
      )}
    </div>
  )
}

/** 排行榜面板（结构对齐基线 Tetris LeaderboardPanel，TOP 10 + 前三名特殊样式） */
function LeaderboardPanel({ board, loading }) {
  return (
    <div className="snake-panel snake-board-panel">
      <h2>排行榜 TOP 10</h2>
      {loading ? (
        <p className="snake-board-empty">加载中…</p>
      ) : board.length === 0 ? (
        <p className="snake-board-empty">虚位以待，等你上榜</p>
      ) : (
        <ol className="snake-board-list">
          {board.map((row, i) => (
            <li key={row.createdAt ?? i} className={i < 3 ? `top top-${i + 1}` : ''}>
              <span className="rank">{i + 1}</span>
              <span className="name">{row.name}</span>
              <span className="score">{row.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default SnakePage
