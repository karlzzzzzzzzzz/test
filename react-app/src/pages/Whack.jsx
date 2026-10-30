import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { WhackEngine, WHACK } from '../game/WhackEngine'
import './Whack.css'

const COLS = WHACK.COLS
const ROWS = WHACK.HOLES / COLS
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])

/**
 * 打地鼠页面壳
 * 架构对齐 Memory.jsx：UI 四态状态机 + 纯逻辑引擎 + 回调通信；visibility/blur 双路去重暂停。
 * 无障碍：3×3 语义化 grid + roving tabindex + 方向键导航 + aria-live polite 播报。
 */
function WhackPage() {
  const engineRef = useRef(null)
  const stateRef = useRef('ready')
  const pausedByVisibilityRef = useRef(false)
  const autoPauseRef = useRef(false)
  const floatSeqRef = useRef(0)

  const [screen, setScreen] = useState('ready') // ready | playing | paused | over
  const [snapshot, setSnapshot] = useState(null)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [floats, setFloats] = useState([]) // [{ id, idx, text, gold }]
  const [persistWarn, setPersistWarn] = useState(false)
  const [final, setFinal] = useState(null)

  const changeScreen = (s) => {
    stateRef.current = s
    setScreen(s)
  }

  useEffect(() => {
    const engine = new WhackEngine({
      onState: (snap) => {
        setSnapshot(snap)
        if (snap.state !== stateRef.current) {
          stateRef.current = snap.state
          setScreen(snap.state)
        }
      },
      onFeedback: (fb) => {
        if (fb.type === 'hit') {
          const id = (floatSeqRef.current += 1)
          setFloats((prev) => [...prev.slice(-8), { id, idx: fb.idx, text: `+${fb.gain}`, gold: fb.gold }])
          setLiveAnnounce(`命中 +${fb.gain}${fb.combo >= 2 ? `，连击 ${fb.combo}` : ''}`)
          window.setTimeout(() => {
            setFloats((prev) => prev.filter((f) => f.id !== id))
          }, 600)
        } else if (fb.type === 'miss') {
          setLiveAnnounce('击空')
        }
      },
      onGameOver: (res) => setFinal(res),
      onPause: (reason) => {
        setPausedAuto(reason !== 'manual')
        if (stateRef.current === 'playing') changeScreen('paused')
      },
      onPersistError: () => setPersistWarn(true),
    })
    engineRef.current = engine
    setSnapshot(engine.getSnapshot())

    const onPageHide = () => engine.flush()
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      engine.dispose()
    }
  }, [])

  // 切后台/失焦暂停（visibilitychange + blur 双触发去重，对齐 3.3.6）
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        pausedByVisibilityRef.current = true
        autoPauseRef.current = true
        engineRef.current?.pause('auto')
      }
    }
    const onBlur = () => {
      if (pausedByVisibilityRef.current) {
        pausedByVisibilityRef.current = false
        return
      }
      autoPauseRef.current = true
      engineRef.current?.pause('auto')
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const handleTap = (idx) => {
    engineRef.current?.tap(idx)
  }

  // 方向键导航（Enter/Space 由洞位按钮原生触发 click，语义与点按一致）
  const handleBoardKeyDown = (e) => {
    if (!NAV_KEYS.has(e.key)) return
    if (stateRef.current !== 'playing') return
    e.preventDefault()
    const r = Math.floor(focusedIdx / COLS)
    const c = focusedIdx % COLS
    let nr = r
    let nc = c
    if (e.key === 'ArrowUp') nr = Math.max(0, r - 1)
    else if (e.key === 'ArrowDown') nr = Math.min(ROWS - 1, r + 1)
    else if (e.key === 'ArrowLeft') nc = Math.max(0, c - 1)
    else if (e.key === 'ArrowRight') nc = Math.min(COLS - 1, c + 1)
    else if (e.key === 'Home') nc = 0
    else if (e.key === 'End') nc = COLS - 1
    setFocusedIdx(nr * COLS + nc)
  }

  const handleStart = () => {
    setFinal(null)
    engineRef.current?.start()
    changeScreen('playing')
    setFocusedIdx(0)
    window.setTimeout(() => {
      document.querySelector('.wh-hole')?.focus()
    }, 0)
  }

  const handlePause = () => {
    autoPauseRef.current = false
    engineRef.current?.pause('manual')
  }

  const handleResume = () => {
    if (document.hidden) return // 页面不可见时拒绝恢复
    autoPauseRef.current = false
    engineRef.current?.resume()
    changeScreen('playing')
  }

  const handleBackHome = () => {
    engineRef.current?.pause('manual')
  }

  const preparing = snapshot?.preparing && screen === 'playing'

  return (
    <div className="wh-page" role="application" aria-label="打地鼠小游戏">
      <header className="wh-top">
        <Link to="/" className="wh-back" onClick={handleBackHome} aria-label="返回首页">← 首页</Link>
        <h1 className="wh-title">打地鼠</h1>
        {(screen === 'playing' || screen === 'paused') && (
          <button
            type="button"
            className="wh-pause-btn"
            onClick={screen === 'paused' ? handleResume : handlePause}
            aria-label={screen === 'paused' ? '继续游戏' : '暂停游戏'}
          >
            {screen === 'paused' ? '继续' : '暂停'}
          </button>
        )}
      </header>

      {persistWarn && (
        <div className="wh-warn" role="status">战绩仅本次会话有效（本地存储不可用）</div>
      )}

      {/* HUD：得分 / 剩余时间 / 连击 */}
      <div className="wh-hud" aria-label="游戏数据">
        <div className="wh-stat">
          <span className="wh-stat-label">得分</span>
          <span className="wh-stat-val">{snapshot?.score ?? 0}</span>
        </div>
        <div className="wh-stat">
          <span className="wh-stat-label">剩余时间</span>
          <span className="wh-stat-val wh-timer" role="timer" aria-live="off">
            {(snapshot?.remainingSec ?? 30).toFixed(1)}s
          </span>
        </div>
        <div className="wh-stat">
          <span className="wh-stat-label">连击</span>
          <span className="wh-stat-val">{snapshot?.combo ?? 0}</span>
        </div>
      </div>

      <div aria-live="polite" aria-atomic="true" className="wh-live-region">{liveAnnounce}</div>

      {/* 3×3 洞位棋盘 */}
      <div className="wh-board-wrap">
        <div
          className="wh-board"
          role="grid"
          aria-label="3行3列打地鼠棋盘"
          aria-rowcount={ROWS}
          aria-colcount={COLS}
          onKeyDown={handleBoardKeyDown}
        >
          {Array.from({ length: ROWS }, (_, r) => (
            <div key={r} role="row" className="wh-row">
              {Array.from({ length: COLS }, (_, c) => {
                const idx = r * COLS + c
                const hasMole = snapshot?.mole?.idx === idx
                const gold = hasMole && snapshot.mole.gold
                const holeFloats = floats.filter((f) => f.idx === idx)
                return (
                  <div
                    key={idx}
                    role="gridcell"
                    className={`wh-hole-cell${hasMole ? ' wh-hole-cell-active' : ''}${gold ? ' wh-hole-cell-gold' : ''}`}
                  >
                    <button
                      type="button"
                      className="wh-hole"
                      tabIndex={focusedIdx === idx ? 0 : -1}
                      aria-label={`第${r + 1}行第${c + 1}列${hasMole ? (gold ? '，金鼠' : '，地鼠') : '，空洞'}`}
                      onFocus={() => setFocusedIdx(idx)}
                      onClick={() => handleTap(idx)}
                    >
                      {hasMole && <span className="wh-mole" aria-hidden="true">🐹</span>}
                    </button>
                    {holeFloats.map((f) => (
                      <span
                        key={f.id}
                        className={`wh-float${f.gold ? ' wh-float-gold' : ''}`}
                        aria-hidden="true"
                      >
                        {f.text}
                      </span>
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="wh-hint">点按地鼠得分 · 连击有加成</p>

      {/* ready 遮罩 */}
      {screen === 'ready' && (
        <div className="wh-overlay">
          <div className="wh-overlay-card">
            <h2>打地鼠</h2>
            <p>30 秒内敲中尽可能多的地鼠。普通地鼠 +10 分，金鼠 +30 分；连击 4 次起每次额外 +5 分。</p>
            <p className="wh-overlay-hint">支持点按、单指触控与方向键 + Enter/Space 敲击。</p>
            <p className="wh-best">历史最佳：<strong>{snapshot?.best ?? '—'}</strong></p>
            <div className="wh-btns">
              <button type="button" className="wh-btn-primary" onClick={handleStart}>开始游戏</button>
            </div>
          </div>
        </div>
      )}

      {/* 准备期遮罩 */}
      {preparing && (
        <div className="wh-overlay wh-overlay-light" aria-live="polite">
          <div className="wh-overlay-card wh-ready-card">
            <h2>准备…</h2>
          </div>
        </div>
      )}

      {/* paused 遮罩 */}
      {screen === 'paused' && (
        <div className="wh-overlay">
          <div className="wh-overlay-card" role="dialog" aria-modal="true" aria-label="游戏已暂停">
            <h2>{pausedAuto ? '已自动暂停' : '已暂停'}</h2>
            <p>{pausedAuto ? '检测到页面切走或窗口失焦，倒计时已冻结' : '手动暂停中'}</p>
            <div className="wh-btns">
              <button type="button" className="wh-btn-primary" onClick={handleResume}>继续游戏</button>
              <Link to="/" className="wh-btn" onClick={handleBackHome}>返回首页</Link>
            </div>
          </div>
        </div>
      )}

      {/* over 遮罩：结算 */}
      {screen === 'over' && (
        <div className="wh-overlay">
          <div className="wh-overlay-card" role="dialog" aria-modal="true" aria-label="本局结算">
            <h2>本局结束</h2>
            {final?.newRecord && <p className="wh-record">新纪录！</p>}
            <div className="wh-summary">
              <div><span>得分</span><strong>{final?.score ?? 0}</strong></div>
              <div><span>最佳分</span><strong>{final?.best ?? 0}</strong></div>
              <div><span>命中率</span><strong>{final?.accuracy ?? 0}%</strong></div>
              <div><span>最高连击</span><strong>{final?.maxCombo ?? 0}</strong></div>
            </div>
            <div className="wh-btns">
              <button type="button" className="wh-btn-primary" onClick={handleStart}>再来一局</button>
              <Link to="/" className="wh-btn" onClick={handleBackHome}>返回首页</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default WhackPage
