import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SpaceShooter } from '../game/SpaceShooter'
import {
  fetchTopScores,
  submitScore,
  loadTopScoresSafe,
} from '../api/leaderboard'
import './Game.css'

const SNAPSHOT_KEY = 'game-pause-snapshot-v1'
const PAUSE_EVENTS_KEY = 'game-pause-events-v1'
const SNAPSHOT_TTL = 30 * 60 * 1000 // 中断快照 30 分钟有效
const RESUME_SECONDS = 3
const GL_TIMEOUT = 5000

const PAUSE_TEXTS = {
  visibility: '检测到你切换了页面，游戏已自动暂停',
  blur: '窗口失去焦点，游戏已暂停',
  contextlost: '图形渲染中断，已为你暂停',
  manual: '游戏已暂停',
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatAgo(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000))
  return `${minutes} 分钟前`
}

function readSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    const valid =
      data &&
      data.v === 1 &&
      Number.isFinite(data.pausedAt) &&
      Date.now() - data.pausedAt <= SNAPSHOT_TTL &&
      Number.isFinite(data.score) &&
      data.score >= 0 &&
      data.score <= 999999 &&
      Number.isFinite(data.health) &&
      data.health >= 1 &&
      data.health <= 3
    if (!valid) {
      localStorage.removeItem(SNAPSHOT_KEY)
      return null
    }
    return data
  } catch {
    try {
      localStorage.removeItem(SNAPSHOT_KEY)
    } catch {
      // localStorage 不可用：忽略清理
    }
    return null
  }
}

function clearSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY)
  } catch {
    // localStorage 不可用：忽略
  }
}

/** 记录暂停来源计数（手动也记录，自动提示只看非手动次数） */
function bumpPauseEvent(reason) {
  try {
    const raw = localStorage.getItem(PAUSE_EVENTS_KEY)
    let base = {}
    try {
      base = raw ? JSON.parse(raw) : {}
    } catch {
      base = {}
    }
    const cap = (n) => Math.max(0, Math.min(999, Number(n) || 0))
    const data = {
      manual: 0,
      visibility: 0,
      blur: 0,
      contextlost: 0,
      total: 0,
      ...(base && typeof base === 'object' ? base : {}),
    }
    data[reason] = cap(data[reason] + 1)
    data.total = cap(data.total + 1)
    localStorage.setItem(PAUSE_EVENTS_KEY, JSON.stringify(data))
  } catch {
    // 存储不可用时不阻断暂停
  }
}

function Game() {
  const mountRef = useRef(null)
  const engineRef = useRef(null)
  const screenRef = useRef('start')
  const elapsedRef = useRef(0)
  const pauseReasonRef = useRef('manual')
  const pausedAtRef = useRef(0)
  const countdownRef = useRef(null)
  const countdownValueRef = useRef(0)
  const autoPauseCountRef = useRef(0)
  const boardSeqRef = useRef(0)
  const retryCountRef = useRef(0)
  const retryLockRef = useRef(false)
  const pauseButtonRef = useRef(null)
  const dialogRef = useRef(null)
  const resumeButtonRef = useRef(null)
  const enterPauseRef = useRef(null)
  const beginResumeRef = useRef(null)
  const glLostRef = useRef(false)

  const [screen, setScreen] = useState('start') // start | playing | paused | over
  const [score, setScore] = useState(0)
  const [health, setHealth] = useState(3)
  const [finalScore, setFinalScore] = useState(0)
  const [board, setBoard] = useState([])
  const [boardLoading, setBoardLoading] = useState(true)
  const [playerName, setPlayerName] = useState('')
  const [submitState, setSubmitState] = useState('idle')
  const [myRank, setMyRank] = useState(null)
  const [touchHint, setTouchHint] = useState(false)

  const [pauseReason, setPauseReason] = useState('manual')
  const [pauseElapsed, setPauseElapsed] = useState(0)
  const [pauseSeconds, setPauseSeconds] = useState(0)
  const [resumeCountdown, setResumeCountdown] = useState(null)
  const [glLost, setGlLost] = useState(false)
  const [glTimeout, setGlTimeout] = useState(false)
  const [autoPauseTip, setAutoPauseTip] = useState(false)
  const [storageWarn, setStorageWarn] = useState(false)
  const [snapshot, setSnapshot] = useState(null)
  const [snapshotNotice, setSnapshotNotice] = useState('')
  const [pauseBoard, setPauseBoard] = useState({
    items: [],
    source: '',
    cachedAt: 0,
  })
  const [pauseBoardState, setPauseBoardState] = useState('idle')
  const [retryCooldown, setRetryCooldown] = useState(0)

  const changeScreen = useCallback((next) => {
    screenRef.current = next
    setScreen(next)
  }, [])

  const cancelResumeCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = null
    countdownValueRef.current = 0
    setResumeCountdown(null)
  }, [])

  const loadPauseBoard = async () => {
    const seq = ++boardSeqRef.current
    setPauseBoardState('loading')
    const startedAt = Date.now()
    let result
    try {
      result = await loadTopScoresSafe({ timeout: 3000 })
    } catch {
      result = { items: [], source: 'error' }
    }
    // 骨架最少展示 300ms，避免快速返回时闪跳
    const remain = 300 - (Date.now() - startedAt)
    if (remain > 0) await new Promise((resolve) => setTimeout(resolve, remain))
    if (seq !== boardSeqRef.current) return 'stale'
    if (result.source === 'error') {
      setPauseBoardState('error')
      return 'error'
    }
    if (!result.items.length) {
      setPauseBoard({
        items: [],
        source: result.source,
        cachedAt: result.cachedAt || 0,
      })
      setPauseBoardState('empty')
      return 'empty'
    }
    setPauseBoard({
      items: result.items.slice(0, 3),
      source: result.source,
      cachedAt: result.cachedAt || 0,
    })
    setPauseBoardState('ready')
    return 'ready'
  }

  const enterPause = (reason) => {
    if (screenRef.current !== 'playing') return
    const nextReason = PAUSE_TEXTS[reason] ? reason : 'manual'
    cancelResumeCountdown()
    pauseReasonRef.current = nextReason
    pausedAtRef.current = Date.now()
    setPauseReason(nextReason)
    setPauseSeconds(0)
    setAutoPauseTip(false)
    changeScreen('paused')

    bumpPauseEvent(nextReason)
    if (nextReason !== 'manual') {
      autoPauseCountRef.current += 1
      if (autoPauseCountRef.current >= 3) setAutoPauseTip(true)
    }

    const snap = engineRef.current?.getSnapshot?.()
    if (snap) {
      setPauseElapsed(snap.elapsed)
      try {
        localStorage.setItem(
          SNAPSHOT_KEY,
          JSON.stringify({
            v: 1,
            ...snap,
            pausedAt: Date.now(),
            reason: nextReason,
          })
        )
        setStorageWarn(false)
      } catch {
        setStorageWarn(true)
      }
    }

    retryCountRef.current = 0
    retryLockRef.current = false
    setRetryCooldown(0)
    loadPauseBoard()
  }
  enterPauseRef.current = enterPause

  const finishResume = () => {
    cancelResumeCountdown()
    const ok = engineRef.current?.resume()
    if (!ok) return
    changeScreen('playing')
  }

  const beginResume = () => {
    if (screenRef.current !== 'paused') return
    if (glLostRef.current || glTimeout || countdownRef.current) return
    countdownValueRef.current = RESUME_SECONDS
    setResumeCountdown(RESUME_SECONDS)
    countdownRef.current = setInterval(() => {
      countdownValueRef.current -= 1
      if (countdownValueRef.current <= 0) {
        finishResume()
      } else {
        setResumeCountdown(countdownValueRef.current)
      }
    }, 1000)
  }
  beginResumeRef.current = beginResume

  useEffect(() => {
    const engine = new SpaceShooter(mountRef.current, {
      onScore: (s) => setScore(s),
      onHealth: (h) => setHealth(h),
      onGameOver: (s, elapsed) => {
        setFinalScore(s)
        elapsedRef.current = elapsed
        clearSnapshot()
        setSnapshot(null)
        cancelResumeCountdown()
        changeScreen('over')
      },
      onPause: (reason) => enterPauseRef.current?.(reason),
      onResume: () => {},
      onGlLost: () => {
        glLostRef.current = true
        setGlLost(true)
        cancelResumeCountdown()
      },
      onGlRestored: () => {
        glLostRef.current = false
        setGlLost(false)
        setGlTimeout(false)
      },
    })
    engineRef.current = engine
    return () => engine.dispose()
  }, [cancelResumeCountdown, changeScreen])

  const loadBoard = async () => {
    setBoardLoading(true)
    try {
      setBoard(await fetchTopScores())
    } catch {
      setBoard([])
    } finally {
      setBoardLoading(false)
    }
  }

  useEffect(() => {
    setPlayerName(localStorage.getItem('game-player-name') || '')
    setSnapshot(readSnapshot())
    loadBoard()
  }, [])

  useEffect(() => {
    // 触摸能力检测（约束卡②三态）：maxTouchPoints>0 且 coarse 指针视为移动端
    const hasTouch =
      (navigator.maxTouchPoints || 0) > 0 &&
      (window.matchMedia
        ? window.matchMedia('(pointer: coarse)').matches
        : false)
    setTouchHint(!!hasTouch)
  }, [])

  // 页面卸载前若仍在战斗，补写一份中断快照
  useEffect(() => {
    const onPageHide = () => {
      const engine = engineRef.current
      if (!engine || screenRef.current !== 'playing') return
      const snap = engine.getSnapshot?.()
      if (!snap) return
      try {
        localStorage.setItem(
          SNAPSHOT_KEY,
          JSON.stringify({
            v: 1,
            ...snap,
            pausedAt: Date.now(),
            reason: 'pagehide',
          })
        )
      } catch {
        // 卸载阶段无法提示，忽略
      }
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])

  // 倒计时期间切后台 → 取消倒计时，保持暂停
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && screenRef.current === 'paused') {
        cancelResumeCountdown()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [cancelResumeCountdown])

  // Esc / P 暂停或继续
  useEffect(() => {
    let lastKeyAt = 0
    const onKeyDown = (e) => {
      const key = e.key.toLowerCase()
      if (key !== 'escape' && key !== 'p') return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (screenRef.current !== 'playing' && screenRef.current !== 'paused') return
      e.preventDefault()
      const now = Date.now()
      if (now - lastKeyAt < 300) return
      lastKeyAt = now
      if (screenRef.current === 'playing') {
        engineRef.current?.pause('manual')
      } else if (countdownRef.current) {
        cancelResumeCountdown()
      } else {
        beginResumeRef.current?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancelResumeCountdown])

  // 暂停计时（用真实时间差校正，避免后台定时器节流）
  useEffect(() => {
    if (screen !== 'paused') return
    setPauseSeconds(Math.floor((Date.now() - pausedAtRef.current) / 1000))
    const timer = setInterval(() => {
      setPauseSeconds(Math.floor((Date.now() - pausedAtRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [screen])

  // WebGL 上下文 5 秒未恢复 → 错误态
  useEffect(() => {
    if (!glLost) {
      setGlTimeout(false)
      return
    }
    const timer = setTimeout(() => setGlTimeout(true), GL_TIMEOUT)
    return () => clearTimeout(timer)
  }, [glLost])

  // 重试冷却倒计时
  useEffect(() => {
    if (retryCooldown <= 0) return
    const timer = setTimeout(
      () => setRetryCooldown((value) => Math.max(0, value - 1)),
      1000
    )
    return () => clearTimeout(timer)
  }, [retryCooldown])

  // 暂停弹窗焦点闭环
  useEffect(() => {
    if (screen !== 'paused') return
    const dialog = dialogRef.current
    if (!dialog) return
    const getFocusables = () =>
      Array.from(
        dialog.querySelectorAll(
          'button, a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.disabled)
    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return
      const list = getFocusables()
      if (!list.length) return
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === dialog) {
          e.preventDefault()
          last.focus()
        }
      } else if (
        document.activeElement === last ||
        document.activeElement === dialog
      ) {
        e.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => {
      dialog.removeEventListener('keydown', onKeyDown)
      pauseButtonRef.current?.focus()
    }
  }, [screen])

  // 初始焦点：正常态落「继续游戏」，倒计时/渲染异常时落弹窗容器
  useEffect(() => {
    if (screen !== 'paused') return
    if (resumeCountdown !== null || glLost || glTimeout) {
      dialogRef.current?.focus()
    } else {
      resumeButtonRef.current?.focus()
    }
  }, [screen, resumeCountdown, glLost, glTimeout])

  // 回到战斗时焦点落到 HUD 暂停按钮
  useEffect(() => {
    if (screen === 'playing') pauseButtonRef.current?.focus()
  }, [screen])

  const handleSubmitScore = async () => {
    if (submitState === 'sending' || submitState === 'done') return
    const name = (playerName.trim() || '无名飞侠').slice(0, 12)
    localStorage.setItem('game-player-name', name)
    setSubmitState('sending')
    try {
      const { rank } = await submitScore(name, finalScore, elapsedRef.current)
      setMyRank(rank)
      setSubmitState('done')
      loadBoard()
    } catch {
      setSubmitState('error')
    }
  }

  const handleStart = () => {
    cancelResumeCountdown()
    engineRef.current?.start()
    clearSnapshot()
    setSnapshot(null)
    setSnapshotNotice('')
    setSubmitState('idle')
    setMyRank(null)
    setAutoPauseTip(false)
    autoPauseCountRef.current = 0
    setGlTimeout(false)
    changeScreen('playing')
  }

  const handleContinueSnapshot = () => {
    if (!snapshot) return
    const ok = engineRef.current?.restore(snapshot)
    if (!ok) {
      clearSnapshot()
      setSnapshot(null)
      setSnapshotNotice('上局进度已失效，请重新开始')
      return
    }
    clearSnapshot()
    setSnapshot(null)
    setSnapshotNotice('')
    setSubmitState('idle')
    setMyRank(null)
    setAutoPauseTip(false)
    autoPauseCountRef.current = 0
    changeScreen('playing')
  }

  const handleManualPause = () => {
    engineRef.current?.pause('manual')
  }

  const handleRetryBoard = async () => {
    if (retryLockRef.current || pauseBoardState !== 'error') return
    if (retryCountRef.current >= 2) {
      retryLockRef.current = true
      setRetryCooldown(3)
      setTimeout(() => {
        retryLockRef.current = false
        retryCountRef.current = 0
      }, 3000)
      return
    }
    retryCountRef.current += 1
    const state = await loadPauseBoard()
    if (state === 'error' && retryCountRef.current >= 2) {
      retryLockRef.current = true
      setRetryCooldown(3)
      setTimeout(() => {
        retryLockRef.current = false
        retryCountRef.current = 0
      }, 3000)
    }
  }

  const resumeLabel = glTimeout
    ? '无法继续'
    : glLost
      ? '图形恢复中…'
      : resumeCountdown !== null
        ? `继续游戏（${resumeCountdown}s）`
        : '继续游戏'
  const resumeDisabled = resumeCountdown !== null || glLost || glTimeout

  return (
    <div className="game-page">
      <div ref={mountRef} className="game-canvas" />

      {/* 顶部 HUD */}
      <div className="game-hud">
        <Link to="/index.html" className="game-back">
          ← 返回首页
        </Link>
        <div className="game-score">得分：{score}</div>
        <div className="game-hud-right">
          <div className="game-health" aria-label={`剩余生命 ${health}/3`}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={i < health ? 'heart on' : 'heart'}
                aria-hidden="true"
              >
                ♥
              </span>
            ))}
          </div>
          {screen === 'playing' && (
            <button
              type="button"
              className="game-pause-btn"
              ref={pauseButtonRef}
              onClick={handleManualPause}
              aria-label="暂停游戏"
            >
              ⏸ 暂停
            </button>
          )}
        </div>
      </div>

      {storageWarn && (
        <div className="game-storage-warn" role="status">
          暂停快照无法保存，刷新后本局进度将丢失
        </div>
      )}

      {/* 开始界面 */}
      {screen === 'start' && (
        <div className="game-overlay">
          <div className="game-start-wrap">
            {snapshot && (
              <div className="game-panel game-snapshot">
                <h2>上次战斗中断</h2>
                <p className="game-snapshot-meta">
                  得分 {snapshot.score} · 生命 {snapshot.health} ·{' '}
                  {formatAgo(snapshot.pausedAt)}中断
                </p>
                <button
                  type="button"
                  className="game-btn"
                  onClick={handleContinueSnapshot}
                >
                  继续上局
                </button>
              </div>
            )}
            {snapshotNotice && (
              <p className="game-snapshot-notice" role="status">
                {snapshotNotice}
              </p>
            )}
            <div className="game-panels">
              <div className="game-panel">
                <h1>飞机大战</h1>
                <p className="game-tip">
                  {touchHint
                    ? '单指拖动屏幕控制飞机，飞机会自动射击。'
                    : '移动鼠标（或方向键 / WASD）控制飞机，飞机会自动射击。'}
                  <br />
                  击毁敌机得分；敌机撞到你或突破防线都会损失生命，共 3 点生命。
                </p>
                <button
                  type="button"
                  className="game-btn"
                  onClick={handleStart}
                >
                  开始游戏
                </button>
              </div>
              <LeaderboardPanel board={board} loading={boardLoading} />
            </div>
          </div>
        </div>
      )}

      {/* 暂停界面 */}
      {screen === 'paused' && (
        <div className="game-overlay">
          <div
            className="game-pause-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pause-title"
            tabIndex={-1}
            ref={dialogRef}
          >
            <h1 id="pause-title" aria-live="assertive">
              已暂停
            </h1>
            <p className="game-pause-reason">
              {PAUSE_TEXTS[pauseReason] || PAUSE_TEXTS.manual}
            </p>
            <p className="game-pause-sub">当前进度已保存</p>

            <dl className="game-pause-stats">
              <div>
                <dt>得分</dt>
                <dd>{score}</dd>
              </div>
              <div>
                <dt>剩余生命</dt>
                <dd>
                  {health} / 3
                </dd>
              </div>
              <div>
                <dt>本局时长</dt>
                <dd>{formatDuration(pauseElapsed)}</dd>
              </div>
              <div>
                <dt>已暂停</dt>
                <dd>{formatDuration(pauseSeconds)}</dd>
              </div>
            </dl>

            {autoPauseTip && (
              <p className="game-pause-tip" role="status">
                你已连续切出 3 次，建议使用 Esc 主动暂停
              </p>
            )}

            <section
              className="game-pause-board"
              aria-busy={pauseBoardState === 'loading'}
            >
              <h2>
                排行榜 TOP 3
                {pauseBoard.source === 'cache' &&
                  pauseBoardState !== 'error' && (
                    <span className="game-board-cache">
                      {pauseBoard.cachedAt > 0
                        ? `缓存 · ${formatAgo(pauseBoard.cachedAt)}`
                        : '缓存'}
                    </span>
                  )}
              </h2>
              {pauseBoardState === 'loading' && (
                <>
                  <div className="game-board-skeleton" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <p className="game-board-empty">加载中…</p>
                </>
              )}
              {pauseBoardState === 'empty' && (
                <p className="game-board-empty">榜单还空着，回来再战</p>
              )}
              {pauseBoardState === 'error' && (
                <div className="game-board-error">
                  <p>排行榜加载失败</p>
                  <button
                    type="button"
                    className="game-btn game-btn-ghost game-board-retry"
                    onClick={handleRetryBoard}
                    disabled={retryCooldown > 0}
                  >
                    {retryCooldown > 0 ? `重试（${retryCooldown}s）` : '重试'}
                  </button>
                </div>
              )}
              {pauseBoardState === 'ready' && (
                <ol className="game-board-list">
                  {pauseBoard.items.map((row, i) => (
                    <li
                      key={row._id ?? i}
                      className={i < 3 ? `top top-${i + 1}` : ''}
                    >
                      <span className="rank">{i + 1}</span>
                      <span className="name">{row.name}</span>
                      <span className="score">{row.score}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {glTimeout && (
              <p className="game-submit-error">图形恢复失败，请重开一局</p>
            )}

            <div className="game-pause-actions">
              <button
                type="button"
                className="game-btn"
                ref={resumeButtonRef}
                onClick={beginResume}
                disabled={resumeDisabled}
              >
                {resumeLabel}
              </button>
              <button
                type="button"
                className="game-btn game-btn-ghost"
                onClick={handleStart}
              >
                重新开始
              </button>
              <Link to="/index.html" className="game-home-link">
                返回首页
              </Link>
            </div>

            <p className="game-pause-keys">
              Esc / P 暂停或继续 · Tab 在弹窗内切换焦点
            </p>
            <p className="game-sr-only" aria-live="polite">
              {glTimeout
                ? '图形恢复失败，请重开一局'
                : resumeCountdown !== null
                  ? `${resumeCountdown} 秒后恢复游戏`
                  : ''}
            </p>
          </div>
        </div>
      )}

      {/* 结束界面 */}
      {screen === 'over' && (
        <div className="game-overlay">
          <div className="game-panels">
            <div className="game-panel">
              <h1>游戏结束</h1>
              <p className="game-final">最终得分：{finalScore}</p>
              {finalScore > 0 && (
                <div className="game-submit">
                  {submitState === 'done' ? (
                    <p className="game-rank-line">
                      已上榜，当前排名：第 {myRank} 名
                    </p>
                  ) : (
                    <>
                      <input
                        className="game-name-input"
                        value={playerName}
                        maxLength={12}
                        placeholder="输入昵称上榜"
                        onChange={(e) => setPlayerName(e.target.value)}
                      />
                      <button
                        type="button"
                        className="game-btn game-btn-ghost"
                        onClick={handleSubmitScore}
                        disabled={submitState === 'sending'}
                      >
                        {submitState === 'sending' ? '提交中…' : '提交排行榜'}
                      </button>
                    </>
                  )}
                  {submitState === 'error' && (
                    <p className="game-submit-error">提交失败，请重试</p>
                  )}
                </div>
              )}
              <button type="button" className="game-btn" onClick={handleStart}>
                再来一局
              </button>
              <Link to="/index.html" className="game-home-link">
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

function LeaderboardPanel({ board, loading }) {
  return (
    <div className="game-panel game-board-panel">
      <h2>排行榜 TOP 10</h2>
      {loading ? (
        <p className="game-board-empty">加载中…</p>
      ) : board.length === 0 ? (
        <p className="game-board-empty">虚位以待，等你上榜</p>
      ) : (
        <ol className="game-board-list">
          {board.map((row, i) => (
            <li key={row._id ?? i} className={i < 3 ? `top top-${i + 1}` : ''}>
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

export default Game
