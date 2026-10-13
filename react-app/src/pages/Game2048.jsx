import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Game2048 } from '../game/Game2048Engine'
import './Game2048.css'

const SWIPE_THRESHOLD = 24 // 触控滑动方向判定阈值 px
const FOCUS_RING_COLOR = '#aa3bff'

/**
 * 2048 小游戏页面壳
 * 架构参照基线 Game.jsx：UI 状态机 + 引擎 + 回调通信
 * 状态：idle | playing | paused | over | win
 */
function Game2048Page() {
  const engineRef = useRef(null)
  const boardWrapRef = useRef(null) // 棋盘容器，用于挂接触摸事件 + 键盘焦点
  const touchStartRef = useRef(null) // { x, y, t } 触摸起点
  const stateRef = useRef('idle') // 同步 state 供事件回调使用
  const touchCountedRef = useRef(false) // 本局触摸启动是否已计入 game-2048-touch-starts（每局 1 次）
  const pausedByVisibilityRef = useRef(false) // visibility/blur 去重标志

  const [screen, setScreen] = useState('idle')
  const [snapshot, setSnapshot] = useState(null) // 引擎 onState 推送的渲染快照
  const [persistError, setPersistError] = useState(null) // 'unavailable' | 'quota' | null
  const [showHelp, setShowHelp] = useState(false)
  const [announce, setAnnounce] = useState('') // aria-live 文本

  const changeScreen = (s) => {
    stateRef.current = s
    setScreen(s)
  }

  // 引擎回调
  useEffect(() => {
    const engine = new Game2048({
      onState: (snap) => {
        setSnapshot(snap)
        // 引擎状态同步到 UI 状态机（start / move / undo / pause 等都靠这里驱动）
        if (snap.state !== stateRef.current) {
          stateRef.current = snap.state
          setScreen(snap.state)
        }
      },
      onScore: (score) => setAnnounce(`得分 ${score}`),
      onBest: (best) => setAnnounce(`新最高分 ${best}`),
      onUndos: () => {}, // 由 snapshot 推送，无需单独处理
      onWin: () => {
        changeScreen('win')
        setAnnounce('达成 2048，胜利')
      },
      onGameOver: () => {
        changeScreen('over')
        setAnnounce('无可移动方块，游戏结束')
      },
      onPause: () => {
        if (stateRef.current === 'playing') changeScreen('paused')
      },
      onPersistError: (kind) => setPersistError(kind),
    })
    engineRef.current = engine
    engine.start()
    return () => engine.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 切后台 / 失焦暂停（约束卡 3）
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
      // 与 visibilitychange 去重：visibility 已触发则忽略 blur
      if (pausedByVisibilityRef.current) return
      engineRef.current?.pause()
    }
    const onPageHide = () => engineRef.current?.persist()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])

  // 键盘控制（约束卡 2：键盘可达）
  useEffect(() => {
    const onKey = (e) => {
      const s = stateRef.current
      if (s !== 'playing') return
      let dir = null
      const k = e.key
      if (k === 'ArrowUp' || k === 'w' || k === 'W') dir = 'up'
      else if (k === 'ArrowDown' || k === 's' || k === 'S') dir = 'down'
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') dir = 'left'
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') dir = 'right'
      if (!dir) return
      e.preventDefault()
      engineRef.current?.move(dir)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 触控控制（约束卡 1：移动端兼容）
  const onTouchStart = (e) => {
    if (stateRef.current !== 'playing') return
    const t = e.touches[0]
    if (!t) return
    touchStartRef.current = { x: t.clientX, y: t.clientY }
    // 每局仅记 1 次触摸启动累计（参照基线 game-touch-starts 模式）
    if (!touchCountedRef.current) {
      Game2048.bumpTouchStarts()
      touchCountedRef.current = true
    }
  }
  const onTouchEnd = (e) => {
    const start = touchStartRef.current
    if (!start || stateRef.current !== 'playing') return
    const t = e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    touchStartRef.current = null
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return
    let dir
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'right' : 'left'
    else dir = dy > 0 ? 'down' : 'up'
    engineRef.current?.move(dir)
  }
  const onTouchMove = (e) => {
    // 阻止页面滚动/缩放
    if (stateRef.current === 'playing') e.preventDefault()
  }

  // 控制按钮
  const handleReset = () => {
    touchCountedRef.current = false
    engineRef.current?.reset()
    changeScreen('playing')
  }
  const handleUndo = () => {
    if (snapshot?.undosLeft <= 0) return
    engineRef.current?.undo()
    changeScreen('playing')
  }
  const handleResume = () => {
    engineRef.current?.resume()
    changeScreen('playing')
  }
  const handleContinueAfterWin = () => {
    engineRef.current?.continueAfterWin()
    changeScreen('playing')
  }

  // 渲染棋盘方块
  const board = snapshot?.board || Array.from({ length: 4 }, () => Array(4).fill(0))
  const lastSpawn = snapshot?.lastSpawn
  const lastMerged = snapshot?.lastMerged
  const undosLeft = snapshot?.undosLeft ?? 3
  const score = snapshot?.score ?? 0
  const best = snapshot?.bestScore ?? 0

  return (
    <div className="g2048-page">
      {/* 顶部 HUD */}
      <div className="g2048-hud">
        <Link to="/index.html" className="g2048-back">
          ← 返回首页
        </Link>
        <div className="g2048-scores">
          <div className="g2048-score-box">
            <span className="g2048-score-label">当前得分</span>
            <span className="g2048-score-value" key={score /* 强制重渲染触发动画 */}>
              {score}
            </span>
          </div>
          <div className="g2048-score-box g2048-best">
            <span className="g2048-score-label">最高分</span>
            <span className="g2048-score-value">{best}</span>
          </div>
        </div>
      </div>

      {/* 持久化降级提示 */}
      {persistError && (
        <div className="g2048-persist-tip" role="alert">
          {persistError === 'quota'
            ? '存储配额已满，进度仅本次会话有效'
            : '本地存储不可用，进度仅本次会话有效'}
        </div>
      )}

      {/* 控制条 */}
      <div className="g2048-toolbar">
        <button
          type="button"
          className="g2048-btn"
          onClick={handleReset}
          aria-label="重新开始游戏"
        >
          重新开始
        </button>
        <button
          type="button"
          className={`g2048-btn g2048-btn-ghost${undosLeft <= 0 ? ' is-disabled' : ''}`}
          onClick={handleUndo}
          aria-disabled={undosLeft <= 0 ? 'true' : 'false'}
          aria-label={`撤销上一步，剩余 ${undosLeft} 次`}
          disabled={undosLeft <= 0}
        >
          撤销 <span className="g2048-undo-count">{undosLeft}</span>
        </button>
        <button
          type="button"
          className="g2048-help-toggle"
          aria-expanded={showHelp ? 'true' : 'false'}
          aria-controls="g2048-help-panel"
          onClick={() => setShowHelp((v) => !v)}
        >
          {showHelp ? '收起玩法' : '玩法说明'}
        </button>
      </div>

      {showHelp && (
        <div id="g2048-help-panel" className="g2048-help" role="region" aria-label="玩法说明">
          <ul>
            <li>使用 ↑ ↓ ← → 或 WASD 控制方块滑动方向。</li>
            <li>移动端在棋盘上滑动手指，水平/垂直分量较大者判定方向。</li>
            <li>相同数字方块相撞会合并为 2 倍值，合并的数字累加到本局得分。</li>
            <li>每次有效移动后会在空格随机生成 1 个新方块（2 或 4）。</li>
            <li>出现 2048 即胜利，可选择继续挑战更大数字。</li>
            <li>棋盘填满且无相邻同值方块时游戏结束。</li>
            <li>每局可撤销 3 次，撤销不会消耗最高分。</li>
          </ul>
        </div>
      )}

      {/* 棋盘：role=grid + tabindex，键盘可达 */}
      <div
        ref={boardWrapRef}
        className="g2048-grid"
        role="grid"
        aria-label="2048 棋盘"
        aria-rowcount={4}
        aria-colcount={4}
        tabIndex={0}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchMove}
        style={{ '--g2048-focus': FOCUS_RING_COLOR }}
      >
        {/* 背景空格 */}
        {board.map((row, r) =>
          row.map((_, c) => (
            <div
              key={`cell-${r}-${c}`}
              className="g2048-cell"
              role="gridcell"
              aria-hidden="true"
            />
          )),
        )}
        {/* 方块 */}
        {board.map((row, r) =>
          row.map((value, c) => {
            if (!value) return null
            const isNew = lastSpawn && lastSpawn.r === r && lastSpawn.c === c
            const isMerged = lastMerged && lastMerged[r] && lastMerged[r][c]
            const cls = [
              'g2048-tile',
              `g2048-tile-${Math.min(value, 2048)}`,
              isNew ? 'is-new' : '',
              isMerged ? 'is-merged' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <div
                key={`tile-${r}-${c}-${value}`}
                className={cls}
                style={{
                  '--g2048-r': r,
                  '--g2048-c': c,
                }}
                role="gridcell"
                aria-label={`第 ${r + 1} 行 第 ${c + 1} 列，值 ${value}`}
              >
                <span className="g2048-tile-num">{value}</span>
              </div>
            )
          }),
        )}

        {/* 暂停遮罩（切后台触发） */}
        {screen === 'paused' && (
          <div className="g2048-overlay" role="dialog" aria-label="游戏已暂停">
            <div className="g2048-overlay-panel">
              <h2>已暂停</h2>
              <p>检测到你切换了页面，游戏已自动暂停并保存进度。</p>
              <button type="button" className="g2048-btn" onClick={handleResume}>
                继续游戏
              </button>
              <Link to="/index.html" className="g2048-home-link">
                返回首页
              </Link>
            </div>
          </div>
        )}

        {/* 胜利遮罩 */}
        {screen === 'win' && (
          <div className="g2048-overlay g2048-overlay-win" role="dialog" aria-label="达成 2048 胜利">
            <div className="g2048-overlay-panel">
              <h2>达成 2048！</h2>
              <p>恭喜，本局得分 {score}。</p>
              <button type="button" className="g2048-btn" onClick={handleContinueAfterWin}>
                继续挑战
              </button>
              <button type="button" className="g2048-btn g2048-btn-ghost" onClick={handleReset}>
                重新开始
              </button>
            </div>
          </div>
        )}

        {/* 结束遮罩 */}
        {screen === 'over' && (
          <div className="g2048-overlay g2048-overlay-over" role="dialog" aria-label="游戏结束">
            <div className="g2048-overlay-panel">
              <h2>游戏结束</h2>
              <p className="g2048-final">最终得分：{score}</p>
              <p className="g2048-best-line">最高分：{best}</p>
              <button type="button" className="g2048-btn" onClick={handleReset}>
                再来一局
              </button>
              <Link to="/index.html" className="g2048-home-link">
                返回首页
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* aria-live 播报区 */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
    </div>
  )
}

export default Game2048Page
