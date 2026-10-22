import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BreakoutEngine, BREAKOUT } from '../game/BreakoutEngine'
import { createLeaderboard } from '../api/leaderboard'
import './Breakout.css'

const { W, H, COLS, ROWS, GAP, PADX, TOP, BRICK_W, BRICK_H, PADDLE_H, PADDLE_Y, BALL_R, LIVES0 } =
  BREAKOUT
const TAP_MAX_MS = 200 // 点按判定：时长上限
const TAP_MAX_DIST = 10 // 点按判定：位移上限

// 打砖块排行榜（复用 leaderboard.js 参数化 API，不改该文件）
const breakoutLeaderboard = createLeaderboard('game-breakout-leaderboard-v1')

// 天气主题调色板（联动 3.1.2 Open-Meteo 数据源，WMO 映射对齐 3.4.6）
// rows：6 行砖块配色；hard/hardHit：坚固砖未损/已损；ball：小球
const THEMES = {
  default: {
    label: '',
    rows: ['#66f7ff', '#4f8ef7', '#f7a54f', '#ffe066', '#5ef79a', '#c97bf7'],
    hard: '#8f9bb0',
    hardHit: '#5d6778',
    ball: '#eaf4ff',
  },
  clear: {
    label: '晴 · 暖橙',
    rows: ['#ffd166', '#ff9f6e', '#ff7b54', '#ffe8a3', '#ffb35c', '#ff8c69'],
    hard: '#c98a5a',
    hardHit: '#8f5f3a',
    ball: '#ffd166',
  },
  cloudy: {
    label: '多云 · 灰蓝',
    rows: ['#a8c3e0', '#8ba7c7', '#b9c9d9', '#94a9be', '#aebdcf', '#7f9ab5'],
    hard: '#6e7f96',
    hardHit: '#4d5a6e',
    ball: '#d7e6ff',
  },
  rain: {
    label: '雨 · 冷蓝',
    rows: ['#4fc3f7', '#3d9be9', '#5ac8fa', '#2f80ed', '#6bb8ff', '#4a90d9'],
    hard: '#3f6f9e',
    hardHit: '#2c4f73',
    ball: '#79c7ff',
  },
  snow: {
    label: '雪 · 白青',
    rows: ['#e8f6f8', '#c5e8ee', '#d6f0f5', '#b2dfe8', '#cdeef3', '#a8d8e5'],
    hard: '#9fc3cf',
    hardHit: '#6f96a3',
    ball: '#ffffff',
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
 * 打砖块页面壳
 * 架构参照基线 Snake.jsx / Tetris.jsx：UI 状态机 + 引擎 + 回调通信
 * 状态：start | playing | paused | over | win
 * 渲染：引擎快照写入 ref，单 rAF 渲染循环按需重绘（不对 React setState 高频施压）
 */
function BreakoutPage() {
  const engineRef = useRef(null)
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const snapRef = useRef(null) // 引擎最新快照（rAF 绘制数据源）
  const redrawRef = useRef(false) // rAF 重绘标志
  const themeRef = useRef(THEMES.default)
  const gestureRef = useRef(null) // 触控手势跟踪态
  const stateRef = useRef('start')
  const pausedByVisibilityRef = useRef(false) // visibility/blur 去重标志（参照 2048）
  const autoPauseRef = useRef(false) // 本次暂停是否由切后台/失焦触发
  const elapsedRef = useRef(0)
  const touchCountedRef = useRef(false) // 本局触摸启动是否已计数（每局 1 次）

  const [screen, setScreen] = useState('start')
  const [hud, setHud] = useState({ score: 0, level: 1, lives: LIVES0 })
  const [pausedAuto, setPausedAuto] = useState(false)
  const [board, setBoard] = useState([])
  const [boardLoading, setBoardLoading] = useState(true)
  const [playerName, setPlayerName] = useState('')
  const [submitState, setSubmitState] = useState('idle')
  const [myRank, setMyRank] = useState(null)
  const [finalScore, setFinalScore] = useState(0)
  const [persistError, setPersistError] = useState(null) // 'unavailable' | 'quota' | null
  const [theme, setTheme] = useState(THEMES.default)
  const [saveInfo, setSaveInfo] = useState(null) // 可恢复进度 { level }

  const changeScreen = (s) => {
    stateRef.current = s
    setScreen(s)
  }

  // 引擎生命周期
  useEffect(() => {
    const engine = new BreakoutEngine({
      onState: (snap) => {
        snapRef.current = snap
        redrawRef.current = true
        setHud((prev) =>
          prev.score === snap.score && prev.level === snap.level && prev.lives === snap.lives
            ? prev
            : { score: snap.score, level: snap.level, lives: snap.lives },
        )
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
      onWin: (score) => {
        setFinalScore(score)
        changeScreen('win')
      },
      onPause: () => {
        setPausedAuto(autoPauseRef.current)
        if (stateRef.current === 'playing') changeScreen('paused')
      },
      onPersistError: (kind) => setPersistError(kind),
    })
    engineRef.current = engine
    if (!engine.persistAvailable) setPersistError('unavailable')
    setSaveInfo(engine.getSaveInfo())
    return () => engine.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Canvas 初始化（逻辑 480×640，devicePixelRatio 上限 2；CSS 控制显示尺寸，无 resize 监听）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctxRef.current = ctx
  }, [])

  // 单 rAF 渲染循环：仅在引擎推送新快照时重绘
  useEffect(() => {
    themeRef.current = theme
  }, [theme])
  useEffect(() => {
    let raf = 0
    const draw = () => {
      const ctx = ctxRef.current
      if (!ctx) return
      const t = themeRef.current
      // 背景
      ctx.fillStyle = '#0a0e1c'
      ctx.fillRect(0, 0, W, H)
      const snap = snapRef.current
      if (snap) {
        // 砖块：普通砖按行配色；坚固砖金属色，已损变暗
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const i = r * COLS + c
            const hits = snap.bricks[i]
            if (hits === 0) continue
            const bx = PADX + c * (BRICK_W + GAP)
            const by = TOP + r * (BRICK_H + GAP)
            ctx.fillStyle =
              snap.brickInit[i] === 2 ? (hits === 2 ? t.hard : t.hardHit) : t.rows[r]
            ctx.fillRect(bx, by, BRICK_W, BRICK_H)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.22)' // 顶部高光
            ctx.fillRect(bx, by, BRICK_W, 3)
          }
        }
        // 挡板
        ctx.fillStyle = '#eaf4ff'
        ctx.fillRect(snap.paddleX - snap.paddleW / 2, PADDLE_Y, snap.paddleW, PADDLE_H)
        ctx.fillStyle = 'rgba(102, 247, 255, 0.6)' // 顶部青色高光
        ctx.fillRect(snap.paddleX - snap.paddleW / 2, PADDLE_Y, snap.paddleW, 3)
        // 小球（主题色 + 光晕）
        ctx.shadowColor = t.ball
        ctx.shadowBlur = 10
        ctx.fillStyle = t.ball
        ctx.beginPath()
        ctx.arc(snap.ball.x, snap.ball.y, BALL_R, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
        // 待发提示
        if (snap.ball.stuck && snap.state === 'playing') {
          ctx.fillStyle = 'rgba(234, 244, 255, 0.55)'
          ctx.font = '14px system-ui, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('点按 / 空格 发球', W / 2, PADDLE_Y - 40)
        }
      }
    }
    const loop = () => {
      if (redrawRef.current) {
        redrawRef.current = false
        draw()
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // 排行榜与昵称（复用 game-player-name，对齐 3.2.5）
  const loadBoard = async () => {
    setBoardLoading(true)
    try {
      setBoard(await breakoutLeaderboard.fetchTopScores())
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

  // 天气主题（联动 3.1.2：同一定位回退策略，失败静默降级默认配色，不显示定位提示条）
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

  // 切后台 / 失焦暂停（visibilitychange + blur 双触发去重，参照 2048）
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

  // 键盘控制：←→/AD 按住移动；空格发球（待发）/暂停（飞行中）；P 暂停/恢复
  useEffect(() => {
    const onKeyDown = (e) => {
      const s = stateRef.current
      if (e.key === 'p' || e.key === 'P' || e.key === ' ') {
        if (s === 'playing' || s === 'paused') e.preventDefault()
        if (s === 'playing') {
          if (e.key === ' ' && snapRef.current?.ball.stuck) {
            engineRef.current?.launch()
            return
          }
          autoPauseRef.current = false
          engineRef.current?.pause()
        } else if (s === 'paused') {
          handleResume()
        }
        return
      }
      if (s !== 'playing') return // over/win/start 态方向键忽略
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        engineRef.current?.setKey('left', true)
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        engineRef.current?.setKey('right', true)
      }
    }
    const onKeyUp = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        engineRef.current?.setKey('left', false)
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        engineRef.current?.setKey('right', false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 画布 CSS 显示尺寸 → 逻辑坐标映射
  const mapClientX = (clientX) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    return ((clientX - rect.left) / rect.width) * W
  }

  // 鼠标：移动映射挡板中心 X；点击（待发态）发球
  const onMouseMove = (e) => {
    if (stateRef.current !== 'playing') return
    const x = mapClientX(e.clientX)
    if (x != null) engineRef.current?.movePaddleTo(x)
  }
  const onClick = () => {
    if (stateRef.current === 'playing' && snapRef.current?.ball.stuck) {
      engineRef.current?.launch()
    }
  }

  // 触控控制（约束卡①）：单指拖拽跟手；点按（<200ms 且位移 <10px）待发态发球
  const onTouchStart = (e) => {
    if (stateRef.current !== 'playing') return
    const t = e.touches[0]
    if (!t) return
    // 每局首次触摸计入行为统计（对齐 game-2048-touch-starts 模式，0~99999 封顶）
    if (!touchCountedRef.current) {
      BreakoutEngine.bumpTouchStarts()
      touchCountedRef.current = true
    }
    gestureRef.current = {
      id: t.identifier, // 多点触摸仅跟踪首指
      x0: t.clientX,
      y0: t.clientY,
      t0: performance.now(),
    }
    const x = mapClientX(t.clientX)
    if (x != null) engineRef.current?.movePaddleTo(x)
  }
  const onTouchMove = (e) => {
    const g = gestureRef.current
    if (!g || stateRef.current !== 'playing') return
    e.preventDefault() // 阻止页面滚动/缩放
    const t = [...e.touches].find((x) => x.identifier === g.id)
    if (!t) return
    const x = mapClientX(t.clientX)
    if (x != null) engineRef.current?.movePaddleTo(x)
  }
  const onTouchEnd = (e) => {
    const g = gestureRef.current
    if (!g) return
    const t = [...e.changedTouches].find((x) => x.identifier === g.id)
    gestureRef.current = null
    if (!t) return
    const dt = performance.now() - g.t0
    const dist = Math.hypot(t.clientX - g.x0, t.clientY - g.y0)
    if (
      dt < TAP_MAX_MS &&
      dist < TAP_MAX_DIST &&
      stateRef.current === 'playing' &&
      snapRef.current?.ball.stuck
    ) {
      engineRef.current?.launch()
    }
  }
  const onTouchCancel = () => {
    gestureRef.current = null // 清空跟踪态（对齐 3.4.4）
  }

  const handleStart = () => {
    setSubmitState('idle')
    setMyRank(null)
    touchCountedRef.current = false // 新一局重置触摸计数标志
    engineRef.current?.start()
    changeScreen('playing')
  }

  const handleContinue = () => {
    setSubmitState('idle')
    setMyRank(null)
    touchCountedRef.current = false
    if (engineRef.current?.restoreSave()) {
      changeScreen('playing')
    } else {
      setSaveInfo(null) // 快照已失效，回退新开局
      handleStart()
    }
  }

  const handleResume = () => {
    engineRef.current?.resume()
    changeScreen('playing')
  }

  const handleChallenge = () => {
    engineRef.current?.continueChallenge()
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
      const { rank } = await breakoutLeaderboard.submitScore(name, finalScore, elapsedRef.current)
      setMyRank(rank)
      setSubmitState('done')
      loadBoard()
    } catch {
      setSubmitState('error')
    }
  }

  return (
    <div className="breakout-page">
      {/* 存储降级提示条（约束卡③：配额满/不可用，进度仅本次会话有效） */}
      {persistError && (
        <div className="breakout-persist-bar" role="alert">
          存储配额已满，进度仅本次会话有效
        </div>
      )}

      {/* 顶部 HUD */}
      <div className="breakout-hud">
        <Link to="/index.html" className="breakout-back">
          ← 返回首页
        </Link>
        <div className="breakout-scores" aria-live="polite">
          <div className="breakout-score-box">
            <span className="breakout-score-label">得分</span>
            <span className="breakout-score-value" key={hud.score /* 强制重渲染触发 bump 动画 */}>
              {hud.score}
            </span>
          </div>
          <div className="breakout-score-box">
            <span className="breakout-score-label">关卡</span>
            <span className="breakout-score-value">{hud.level}</span>
          </div>
          <div className="breakout-score-box breakout-lives-box" aria-label={`生命 ${hud.lives}`}>
            <span className="breakout-score-label">生命</span>
            <span className="breakout-hearts">
              {Array.from({ length: LIVES0 }, (_, i) => (
                <span key={i} className={i < hud.lives ? 'heart on' : 'heart'}>
                  ❤
                </span>
              ))}
            </span>
          </div>
          {theme.label && (
            <div className="breakout-score-box breakout-theme-tag" title="主题随当前天气切换">
              <span className="breakout-score-label">天气主题</span>
              <span className="breakout-theme-name">{theme.label}</span>
            </div>
          )}
        </div>
      </div>

      {/* 游戏区 */}
      <div
        className="breakout-board-wrap"
        onMouseMove={onMouseMove}
        onClick={onClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        <canvas ref={canvasRef} className="breakout-canvas" aria-label="打砖块画布" />
      </div>

      {/* 移动端操作提示条（<768 显示，约束卡①） */}
      <p className="breakout-touch-tip">滑动移动挡板 · 点按发球</p>

      {/* 开始屏 */}
      {screen === 'start' && (
        <div className="breakout-overlay">
          <div className="breakout-panels">
            <div className="breakout-panel">
              <h1>打砖块</h1>
              <p className="breakout-tip">
                ← → / AD / 鼠标 / 单指滑动移动挡板，空格或点按发球，P 暂停。
                <br />
                普通砖 +50 分，坚固砖两击 +100 分；通关 5 关后可无尽挑战。
                <br />
                <span className="breakout-tip-tech">
                  固定步长物理引擎：1/240s 定步积分，高速不穿透；切后台 7 天内可续玩
                </span>
              </p>
              {saveInfo && (
                <button type="button" className="breakout-btn" onClick={handleContinue}>
                  继续游戏（第 {saveInfo.level} 关）
                </button>
              )}
              <button
                type="button"
                className={saveInfo ? 'breakout-btn breakout-btn-ghost' : 'breakout-btn'}
                onClick={handleStart}
              >
                开始游戏
              </button>
            </div>
            <LeaderboardPanel board={board} loading={boardLoading} />
          </div>
        </div>
      )}

      {/* 暂停屏（自动/手动文案区分） */}
      {screen === 'paused' && (
        <div className="breakout-overlay">
          <div className="breakout-panel">
            <h1>已暂停</h1>
            <p className="breakout-tip">
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
            <button type="button" className="breakout-btn" onClick={handleResume}>
              继续游戏
            </button>
            <Link to="/index.html" className="breakout-home-link">
              返回首页
            </Link>
          </div>
        </div>
      )}

      {/* 通关屏 */}
      {screen === 'win' && (
        <div className="breakout-overlay">
          <div className="breakout-panel">
            <h1>通关！</h1>
            <p className="breakout-final">完成全部 5 关，当前得分：{finalScore}</p>
            <button type="button" className="breakout-btn" onClick={handleChallenge}>
              继续挑战
            </button>
            <button
              type="button"
              className="breakout-btn breakout-btn-ghost breakout-btn-gap"
              onClick={handleStart}
            >
              重新开始
            </button>
            <Link to="/index.html" className="breakout-home-link">
              返回首页
            </Link>
          </div>
        </div>
      )}

      {/* 结束屏 */}
      {screen === 'over' && (
        <div className="breakout-overlay">
          <div className="breakout-panels">
            <div className="breakout-panel">
              <h1>游戏结束</h1>
              <p className="breakout-final">最终得分：{finalScore}</p>
              {finalScore > 0 && (
                <div className="breakout-submit">
                  {submitState === 'done' ? (
                    <p className="breakout-rank-line">已上榜，当前排名：第 {myRank} 名</p>
                  ) : (
                    <>
                      <input
                        className="breakout-name-input"
                        value={playerName}
                        maxLength={12}
                        placeholder="输入昵称上榜"
                        onChange={(e) => setPlayerName(e.target.value)}
                      />
                      <button
                        type="button"
                        className="breakout-btn breakout-btn-ghost"
                        onClick={handleSubmitScore}
                        disabled={submitState === 'sending'}
                      >
                        {submitState === 'sending' ? '提交中…' : '提交排行榜'}
                      </button>
                    </>
                  )}
                  {submitState === 'error' && (
                    <p className="breakout-submit-error">提交失败，请重试</p>
                  )}
                </div>
              )}
              <button type="button" className="breakout-btn" onClick={handleStart}>
                再来一局
              </button>
              <Link to="/index.html" className="breakout-home-link">
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

/** 排行榜面板（结构对齐基线 Snake LeaderboardPanel，TOP 10 + 前三名特殊样式） */
function LeaderboardPanel({ board, loading }) {
  return (
    <div className="breakout-panel breakout-board-panel">
      <h2>排行榜 TOP 10</h2>
      {loading ? (
        <p className="breakout-board-empty">加载中…</p>
      ) : board.length === 0 ? (
        <p className="breakout-board-empty">虚位以待，等你上榜</p>
      ) : (
        <ol className="breakout-board-list">
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

export default BreakoutPage
