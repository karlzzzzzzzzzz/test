import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { TetrisEngine, TETRIS } from '../game/TetrisEngine'
import { createLeaderboard } from '../api/leaderboard'
import './Tetris.css'

const { COLS, ROWS, SHAPES } = TETRIS
const CELL = 24 // 棋盘逻辑格 px（Canvas 内部坐标系）
const SWIPE_CELL = 24 // 触控：每 24px 映射 1 格（阈值对齐 2048）
const TAP_MAX_MS = 200 // 点按判定：时长上限
const TAP_MAX_DIST = 10 // 点按判定：位移上限
const SOFT_DROP_DIST = 24 // 下滑进入软降的位移阈值
const HARD_FLICK_DIST = 48 // 下甩硬降：位移阈值
const HARD_FLICK_SPEED = 0.5 // 下甩硬降：速度阈值 px/ms

// 俄罗斯方块排行榜（leaderboard.js 参数化改造后按游戏指定键）
const tetrisLeaderboard = createLeaderboard('game-tetris-leaderboard-v1')

// 天气主题调色板：7 色/套，索引对应方块类型 I/J/L/O/S/T/Z（联动 3.1.2 Open-Meteo 数据源）
const THEMES = {
  default: {
    label: '',
    colors: ['#66f7ff', '#4f8ef7', '#f7a54f', '#ffe066', '#5ef79a', '#c97bf7', '#ff6b81'],
  },
  clear: {
    label: '晴 · 暖橙',
    colors: ['#ffd166', '#ff9f6e', '#ff7b54', '#ffe8a3', '#ffb35c', '#ff8c69', '#f4845f'],
  },
  cloudy: {
    label: '多云 · 灰蓝',
    colors: ['#a8c3e0', '#8ba7c7', '#b9c9d9', '#94a9be', '#aebdcf', '#7f9ab5', '#c3cfe0'],
  },
  rain: {
    label: '雨 · 冷蓝',
    colors: ['#4fc3f7', '#3d9be9', '#5ac8fa', '#2f80ed', '#6bb8ff', '#4a90d9', '#79c7ff'],
  },
  snow: {
    label: '雪 · 白青',
    colors: ['#e8f6f8', '#c5e8ee', '#d6f0f5', '#b2dfe8', '#cdeef3', '#a8d8e5', '#9fd4e0'],
  },
}

// WMO 天气码 → 主题（未知码返回 null，走默认深空配色）
function themeForWmo(code) {
  if (code === 0 || code === 1) return THEMES.clear
  if ([2, 3, 45, 48].includes(code)) return THEMES.cloudy
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code))
    return THEMES.rain
  if ([71, 73, 75, 77, 85, 86].includes(code)) return THEMES.snow
  return null
}

/**
 * 俄罗斯方块页面壳
 * 架构参照基线 Game.jsx / Game2048.jsx：UI 状态机 + 引擎 + 回调通信
 * 状态：start | playing | paused | over
 */
function TetrisPage() {
  const engineRef = useRef(null)
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const boardWrapRef = useRef(null)
  const gestureRef = useRef(null) // 触控手势跟踪态
  const stateRef = useRef('start')
  const pausedByVisibilityRef = useRef(false) // visibility/blur 去重标志（参照 2048）
  const elapsedRef = useRef(0)

  const [screen, setScreen] = useState('start')
  const [snapshot, setSnapshot] = useState(null)
  const [theme, setTheme] = useState(THEMES.default)
  const [board, setBoard] = useState([])
  const [boardLoading, setBoardLoading] = useState(true)
  const [playerName, setPlayerName] = useState('')
  const [submitState, setSubmitState] = useState('idle')
  const [myRank, setMyRank] = useState(null)
  const [finalScore, setFinalScore] = useState(0)

  const changeScreen = (s) => {
    stateRef.current = s
    setScreen(s)
  }

  // 引擎生命周期
  useEffect(() => {
    const engine = new TetrisEngine({
      onState: (snap) => {
        setSnapshot(snap)
        if (snap.state !== stateRef.current) {
          stateRef.current = snap.state
          setScreen(snap.state)
        }
      },
      onGameOver: (score, elapsed) => {
        setFinalScore(score)
        elapsedRef.current = elapsed
        changeScreen('over')
      },
      // 切后台 / 窗口失焦自动暂停（约束卡②）
      onPause: () => {
        if (stateRef.current === 'playing') changeScreen('paused')
      },
    })
    engineRef.current = engine
    return () => engine.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Canvas 初始化（devicePixelRatio 上限 2，对齐 MouseTrail 策略）
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

  // Canvas 渲染：快照或主题变化时整盘重绘（10×20=200 格，远低于 Canvas 2D 瓶颈）
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const palette = theme.colors
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
    const fillCell = (c, r, color) => {
      ctx.fillStyle = color
      ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)' // 顶部高光
      ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, 4)
    }
    if (!snapshot) return
    // 已锁定方块（位段展开：bit9=列0 … bit0=列9）
    for (let r = 0; r < ROWS; r++) {
      const v = snapshot.board[r]
      if (!v) continue
      for (let c = 0; c < COLS; c++) {
        if ((v >> (9 - c)) & 1) {
          const typeIdx = (snapshot.cells[r][c] || 1) - 1
          fillCell(c, r, palette[typeIdx] || palette[0])
        }
      }
    }
    // 当前活动方块（16bit 查表展开）
    const piece = snapshot.piece
    if (piece && snapshot.state !== 'over') {
      const bits = SHAPES[piece.type][piece.rot]
      for (let r = 0; r < 4; r++) {
        const seg = (bits >> (12 - r * 4)) & 0xf
        if (!seg) continue
        for (let c = 0; c < 4; c++) {
          if ((seg >> (3 - c)) & 1) {
            const row = piece.y + r
            if (row >= 0) fillCell(piece.x + c, row, palette[piece.type])
          }
        }
      }
    }
  }, [snapshot, theme])

  // 排行榜与昵称（复用 game-player-name，对齐 3.2.5）
  const loadBoard = async () => {
    setBoardLoading(true)
    try {
      setBoard(await tetrisLeaderboard.fetchTopScores())
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

  // 天气主题（联动 3.1.2：同一定位回退策略，失败静默降级默认配色）
  useEffect(() => {
    let cancelled = false
    const locate = () =>
      new Promise((resolve) => {
        const fallback = { lat: 39.9042, lon: 116.4074 } // 北京（默认），与天气卡片一致
        if (!('geolocation' in navigator)) return resolve(fallback)
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          () => resolve(fallback), // 拒绝/失败回退北京，无提示条
          { timeout: 8000, maximumAge: 600000 },
        )
      })
    const fetchTheme = async () => {
      try {
        const { lat, lon } = await locate()
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 8000)
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
            '&current=weather_code&timezone=auto',
          { signal: ctrl.signal },
        )
        clearTimeout(timer)
        if (!res.ok) return
        const data = await res.json()
        const t = themeForWmo(data?.current?.weather_code)
        if (!cancelled && t) setTheme(t)
      } catch {
        // 定位失败 / 超时 / 解析失败：静默保持默认深空配色，不阻断游戏
      }
    }
    fetchTheme()
    return () => {
      cancelled = true
    }
  }, [])

  // 切后台 / 失焦暂停（约束卡②，visibilitychange + blur 双触发去重，参照 2048）
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        pausedByVisibilityRef.current = true
        engineRef.current?.pause()
      } else {
        pausedByVisibilityRef.current = false
      }
    }
    const onBlur = () => {
      if (pausedByVisibilityRef.current) return
      engineRef.current?.pause()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // 键盘控制：←→ 移动 / ↓ 软降 / ↑ 或 X 旋转 / 空格硬降 / P 暂停恢复
  useEffect(() => {
    const onKeyDown = (e) => {
      const s = stateRef.current
      if (e.key === 'p' || e.key === 'P') {
        if (s === 'playing') engineRef.current?.pause()
        else if (s === 'paused') handleResume()
        return
      }
      if (s !== 'playing') return
      const engine = engineRef.current
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          engine?.move(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          engine?.move(1)
          break
        case 'ArrowDown':
          e.preventDefault()
          engine?.softDrop(true)
          break
        case 'ArrowUp':
        case 'x':
        case 'X':
          e.preventDefault()
          engine?.rotate()
          break
        case ' ':
          e.preventDefault()
          engine?.hardDrop()
          break
        default:
      }
    }
    const onKeyUp = (e) => {
      if (e.key === 'ArrowDown') engineRef.current?.softDrop(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 触控控制（约束卡①）：水平滑动跟手移动 / 点按旋转 / 下滑软降 / 快速下甩硬降
  const onTouchStart = (e) => {
    if (stateRef.current !== 'playing') return
    const t = e.touches[0]
    if (!t) return
    gestureRef.current = {
      id: t.identifier, // 多点触摸仅跟踪首指
      x0: t.clientX,
      y0: t.clientY,
      lastX: t.clientX,
      accX: 0,
      t0: performance.now(),
      hardDropped: false,
      softOn: false,
    }
  }
  const onTouchMove = (e) => {
    const g = gestureRef.current
    if (!g || stateRef.current !== 'playing') return
    e.preventDefault() // 阻止页面滚动/缩放
    const t = [...e.touches].find((x) => x.identifier === g.id)
    if (!t) return
    // 水平：每 24px 映射 1 格
    g.accX += t.clientX - g.lastX
    g.lastX = t.clientX
    while (Math.abs(g.accX) >= SWIPE_CELL) {
      const dir = g.accX > 0 ? 1 : -1
      engineRef.current?.move(dir)
      g.accX -= dir * SWIPE_CELL
    }
    // 垂直：快速下甩硬降优先，其次下滑软降
    const dy = t.clientY - g.y0
    const dt = performance.now() - g.t0
    if (!g.hardDropped && dy > HARD_FLICK_DIST && dy / dt > HARD_FLICK_SPEED) {
      engineRef.current?.hardDrop()
      g.hardDropped = true
      if (g.softOn) {
        engineRef.current?.softDrop(false)
        g.softOn = false
      }
      return
    }
    if (!g.hardDropped) {
      if (dy > SOFT_DROP_DIST && !g.softOn) {
        engineRef.current?.softDrop(true)
        g.softOn = true
      } else if (dy <= SOFT_DROP_DIST && g.softOn) {
        engineRef.current?.softDrop(false)
        g.softOn = false
      }
    }
  }
  const onTouchEnd = (e) => {
    const g = gestureRef.current
    if (!g) return
    const t = [...e.changedTouches].find((x) => x.identifier === g.id)
    gestureRef.current = null
    if (g.softOn) engineRef.current?.softDrop(false)
    if (!t || stateRef.current !== 'playing') return
    // 点按旋转：<200ms 且位移 <10px，且未触发过硬降
    const dt = performance.now() - g.t0
    const dist = Math.hypot(t.clientX - g.x0, t.clientY - g.y0)
    if (!g.hardDropped && dt < TAP_MAX_MS && dist < TAP_MAX_DIST) {
      engineRef.current?.rotate()
    }
  }
  const onTouchCancel = () => {
    const g = gestureRef.current
    if (g?.softOn) engineRef.current?.softDrop(false)
    gestureRef.current = null
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
      const { rank } = await tetrisLeaderboard.submitScore(name, finalScore, elapsedRef.current)
      setMyRank(rank)
      setSubmitState('done')
      loadBoard()
    } catch {
      setSubmitState('error')
    }
  }

  const score = snapshot?.score ?? 0
  const level = snapshot?.level ?? 1
  const lines = snapshot?.lines ?? 0

  return (
    <div className="tetris-page">
      {/* 顶部 HUD */}
      <div className="tetris-hud">
        <Link to="/index.html" className="tetris-back">
          ← 返回首页
        </Link>
        <div className="tetris-scores">
          <div className="tetris-score-box">
            <span className="tetris-score-label">得分</span>
            <span className="tetris-score-value" key={score /* 强制重渲染触发 bump 动画 */}>
              {score}
            </span>
          </div>
          <div className="tetris-score-box">
            <span className="tetris-score-label">等级</span>
            <span className="tetris-score-value">{level}</span>
          </div>
          <div className="tetris-score-box">
            <span className="tetris-score-label">消行</span>
            <span className="tetris-score-value">{lines}</span>
          </div>
        </div>
      </div>

      {/* 游戏区 */}
      <div className="tetris-main">
        <div
          ref={boardWrapRef}
          className="tetris-board-wrap"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
        >
          <canvas ref={canvasRef} className="tetris-canvas" aria-label="俄罗斯方块棋盘" />
        </div>

        {/* 信息栏：<768 移至棋盘下方横排 */}
        <aside className="tetris-side">
          <div className="tetris-side-box">
            <span className="tetris-score-label">下一个</span>
            <NextPreview next={snapshot?.next} palette={theme.colors} />
          </div>
          {theme.label && (
            <div className="tetris-side-box tetris-theme-tag" title="主题随当前天气切换">
              <span className="tetris-score-label">天气主题</span>
              <span className="tetris-theme-name">{theme.label}</span>
            </div>
          )}
        </aside>
      </div>

      {/* 移动端操作提示条（<768 显示，约束卡①） */}
      <p className="tetris-touch-tip">左右滑移动 · 点按旋转 · 下滑软降 · 下甩硬降</p>

      {/* 开始屏 */}
      {screen === 'start' && (
        <div className="tetris-overlay">
          <div className="tetris-panels">
            <div className="tetris-panel">
              <h1>俄罗斯方块</h1>
              <p className="tetris-tip">
                方向键 ←→ 移动，↑ 旋转，↓ 软降，空格硬降，P 暂停。
                <br />
                消行得分：1/2/3/4 行 = 100/300/500/800 × 等级，每 10 行升 1 级。
                <br />
                <span className="tetris-tip-tech">
                  位运算引擎：棋盘每行 10bit 整数，方块 16bit 查表，碰撞与消行全位运算
                </span>
              </p>
              <button type="button" className="tetris-btn" onClick={handleStart}>
                开始游戏
              </button>
            </div>
            <LeaderboardPanel board={board} loading={boardLoading} />
          </div>
        </div>
      )}

      {/* 暂停屏（切后台/失焦/P 键触发） */}
      {screen === 'paused' && (
        <div className="tetris-overlay">
          <div className="tetris-panel">
            <h1>已暂停</h1>
            <p className="tetris-tip">
              检测到你切换了页面，游戏已自动暂停。
              <br />
              点击继续回到棋局。
            </p>
            <button type="button" className="tetris-btn" onClick={handleResume}>
              继续游戏
            </button>
            <Link to="/index.html" className="tetris-home-link">
              返回首页
            </Link>
          </div>
        </div>
      )}

      {/* 结束屏 */}
      {screen === 'over' && (
        <div className="tetris-overlay">
          <div className="tetris-panels">
            <div className="tetris-panel">
              <h1>游戏结束</h1>
              <p className="tetris-final">最终得分：{finalScore}</p>
              {finalScore > 0 && (
                <div className="tetris-submit">
                  {submitState === 'done' ? (
                    <p className="tetris-rank-line">已上榜，当前排名：第 {myRank} 名</p>
                  ) : (
                    <>
                      <input
                        className="tetris-name-input"
                        value={playerName}
                        maxLength={12}
                        placeholder="输入昵称上榜"
                        onChange={(e) => setPlayerName(e.target.value)}
                      />
                      <button
                        type="button"
                        className="tetris-btn tetris-btn-ghost"
                        onClick={handleSubmitScore}
                        disabled={submitState === 'sending'}
                      >
                        {submitState === 'sending' ? '提交中…' : '提交排行榜'}
                      </button>
                    </>
                  )}
                  {submitState === 'error' && (
                    <p className="tetris-submit-error">提交失败，请重试</p>
                  )}
                </div>
              )}
              <button type="button" className="tetris-btn" onClick={handleStart}>
                再来一局
              </button>
              <Link to="/index.html" className="tetris-home-link">
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

/** 下一个方块预览：4×4 CSS 网格渲染 16bit 查表值 */
function NextPreview({ next, palette }) {
  const bits = typeof next === 'number' ? SHAPES[next][0] : 0
  return (
    <div className="tetris-next" role="img" aria-label="下一个方块预览">
      {Array.from({ length: 16 }, (_, i) => {
        const on = (bits >> (15 - i)) & 1
        return (
          <span
            key={i}
            className="tetris-next-cell"
            style={on ? { background: palette[next] } : undefined}
            data-on={on || undefined}
          />
        )
      })}
    </div>
  )
}

/** 排行榜面板（结构对齐基线 Game.jsx LeaderboardPanel，TOP 10 + 前三名特殊样式） */
function LeaderboardPanel({ board, loading }) {
  return (
    <div className="tetris-panel tetris-board-panel">
      <h2>排行榜 TOP 10</h2>
      {loading ? (
        <p className="tetris-board-empty">加载中…</p>
      ) : board.length === 0 ? (
        <p className="tetris-board-empty">虚位以待，等你上榜</p>
      ) : (
        <ol className="tetris-board-list">
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

export default TetrisPage
