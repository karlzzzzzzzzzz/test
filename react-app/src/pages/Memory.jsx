import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MemoryEngine, DIFFICULTY, ICON_POOL } from '../game/MemoryEngine'
import { createLeaderboard } from '../api/leaderboard'
import './Memory.css'

// 排行榜（复用 leaderboard.js 参数化 API，不改该文件）
const memoryLeaderboard = createLeaderboard('game-memory-leaderboard-v1')

const KEY = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Home: 'home', End: 'end',
}

/**
 * 记忆翻牌页面壳
 * 架构对齐 Snake.jsx：UI 四态状态机 + 引擎 + 回调通信；visibility/blur 双路去重暂停。
 * 无障碍：棋盘 role=grid/row/gridcell，roving tabindex，aria-live polite 播报配对结果。
 */
function MemoryPage() {
  const engineRef = useRef(null)
  const stateRef = useRef('start')
  const pausedByVisibilityRef = useRef(false)
  const autoPauseRef = useRef(false)

  const [screen, setScreen] = useState('start') // start | playing | paused | over
  const [snapshot, setSnapshot] = useState(null)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(0) // roving tabindex：仅这一张 tabindex=0
  const [liveAnnounce, setLiveAnnounce] = useState('') // aria-live polite 播报内容
  const [boardRect, setBoardRect] = useState(null) // 缓存棋盘布局用于移动端触控转 idx

  const [playerName, setPlayerName] = useState('')
  const [submitState, setSubmitState] = useState('idle')
  const [myRank, setMyRank] = useState(null)
  const [finalScore, setFinalScore] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState(0)
  const [finalDifficulty, setFinalDifficulty] = useState('easy')

  const changeScreen = (s) => {
    stateRef.current = s
    setScreen(s)
  }

  // 引擎生命周期
  useEffect(() => {
    const engine = new MemoryEngine({
      onState: (snap) => {
        setSnapshot(snap)
        if (snap.state !== stateRef.current) {
          stateRef.current = snap.state
          setScreen(snap.state)
        }
        // 触发 aria-live 播报配对结果
        if (snap.matchResult === 'match') {
          const remain = snap.pairsTotal - snap.pairsMatched
          setLiveAnnounce(`配对成功，还有 ${remain} 对`)
        } else if (snap.matchResult === 'mismatch') {
          setLiveAnnounce('未配对，已翻回')
        }
      },
      onGameOver: (score, elapsed) => {
        setFinalScore(score)
        setFinalElapsed(elapsed)
        // 从引擎拿最终难度
        const e = engineRef.current
        setFinalDifficulty(e ? e.difficulty : 'easy')
        changeScreen('over')
      },
      onPause: () => {
        setPausedAuto(autoPauseRef.current)
        if (stateRef.current === 'playing') changeScreen('paused')
      },
    })
    engineRef.current = engine

    // 开局从 localStorage 回填昵称
    try {
      const name = localStorage.getItem('game-player-name')
      if (name) setPlayerName(name)
    } catch { /* 忽略 */ }

    return () => engine.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 切后台/失焦暂停（visibilitychange + blur 双触发去重，对齐 Snake 3.6）
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

  // 翻牌（点按 / 回车 / 空格 / 触控）
  const doFlip = (idx) => {
    if (engineRef.current?.flip(idx)) {
      // 配对后焦点自动跳到下一张未配对
      if (engineRef.current.state === 'playing') {
        _focusNextUnmatched(engineRef.current.cards, idx)
      }
    }
  }

  /** 焦点在配对成功后跳到下一张未配对（同行优先，其次下一行） */
  const _focusNextUnmatched = (cards, afterIdx) => {
    if (!cards) return
    const rows = engineRef.current?.rows || 4
    const cols = engineRef.current?.cols || 4
    // 找到第一张未配对且未翻开的
    for (let i = afterIdx + 1; i < cards.length; i++) {
      if (!cards[i].matched && !cards[i].flipped) { setFocusedIdx(i); return }
    }
    for (let i = 0; i <= afterIdx; i++) {
      if (!cards[i].matched && !cards[i].flipped) { setFocusedIdx(i); return }
    }
    // 全配对了（over 态），focus 已落到 DOM 按钮处理
  }

  // 棋盘布局信息（供移动端触控坐标 → idx 使用）
  useEffect(() => {
    const el = document.querySelector('.mem-board')
    if (!el) return
    const rect = el.getBoundingClientRect()
    setBoardRect({ width: rect.width, height: rect.height })
  }, [snapshot?.cards.length])

  // 键盘导航（方向键 / Home / End）— 作用于整个棋盘容器
  const handleBoardKeyDown = (e) => {
    if (!snapshot || snapshot.state !== 'playing') return
    const cfg = DIFFICULTY[snapshot.difficulty]
    const { rows, cols } = cfg
    const { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End } = KEY
    const key = e.key

    if (key === ArrowUp || key === ArrowDown || key === ArrowLeft || key === ArrowRight || key === Home || key === End) {
      e.preventDefault()
      const r = Math.floor(focusedIdx / cols)
      const c = focusedIdx % cols
      let nr = r, nc = c
      if (key === ArrowUp) nr = Math.max(0, r - 1)
      else if (key === ArrowDown) nr = Math.min(rows - 1, r + 1)
      else if (key === ArrowLeft) nc = Math.max(0, c - 1)
      else if (key === ArrowRight) nc = Math.min(cols - 1, c + 1)
      else if (key === Home) nc = 0
      else if (key === End) nc = cols - 1
      setFocusedIdx(nr * cols + nc)
      return
    }

    if (key === 'Enter' || key === ' ') {
      e.preventDefault()
      // 焦点所在牌被配对则自动跳到下一张
      const card = snapshot.cards[focusedIdx]
      if (card && card.matched) {
        _focusNextUnmatched(snapshot.cards, focusedIdx)
        return
      }
      doFlip(focusedIdx)
    }
  }

  // 移动端触控：touch 位置 → idx → doFlip
  const handleBoardTouchEnd = (e) => {
    if (!snapshot || snapshot.state !== 'playing') return
    const t = e.changedTouches[0]
    const el = e.currentTarget.getBoundingClientRect()
    const relX = t.clientX - el.left
    const relY = t.clientY - el.top
    const cfg = DIFFICULTY[snapshot.difficulty]
    const colW = el.width / cfg.cols
    const rowH = el.height / cfg.rows
    const c = Math.floor(relX / colW)
    const r = Math.floor(relY / rowH)
    if (c < 0 || c >= cfg.cols || r < 0 || r >= cfg.rows) return
    const idx = r * cfg.cols + c
    doFlip(idx)
  }

  // 结算页：提交分数
  const handleSubmit = async () => {
    if (!finalScore || finalScore <= 0) return
    setSubmitState('submitting')
    try {
      const rank = await memoryLeaderboard.submitScore(playerName || '无名飞侠', finalScore, finalElapsed)
      try { localStorage.setItem('game-player-name', playerName || '') } catch { /* 配额满忽略 */ }
      setMyRank(rank.rank)
      setSubmitState('done')
    } catch (err) {
      setSubmitState('fail')
    }
  }

  const rankList = useLeaderboard()

  // 开局按钮
  const handleStart = (difficulty) => {
    engineRef.current?.start(difficulty)
    changeScreen('playing')
    setFocusedIdx(0)
    setTimeout(() => {
      const btn = document.querySelector('.mem-board .mem-card')
      btn?.focus()
    }, 0)
  }

  const handlePause = () => {
    autoPauseRef.current = false
    engineRef.current?.pause()
  }
  const handleResume = () => {
    autoPauseRef.current = false
    engineRef.current?.resume()
    changeScreen('playing')
  }
  const handleBackHome = () => {
    engineRef.current?.pause()
    window.location.href = '/index.html'
  }

  return (
    <div className="mem-page" role="application" aria-label="记忆翻牌小游戏">
      <header className="mem-top">
        <Link to="/index.html" className="mem-back" onClick={handleBackHome} aria-label="返回首页">← 首页</Link>
        <h1 className="mem-title">记忆翻牌</h1>
        {screen !== 'start' && (
          <button type="button" className="mem-pause-btn" onClick={screen === 'paused' ? handleResume : handlePause}
            aria-label={screen === 'paused' ? '继续游戏' : '暂停游戏'}>
            {screen === 'paused' ? '继续' : '暂停'}
          </button>
        )}
      </header>

      {/* 控制面板 */}
      <div className="mem-controls" aria-label="游戏信息">
        {snapshot && snapshot.state !== 'start' ? (
          <>
            <div className="mem-stat">
              <span className="mem-stat-label">难度</span>
              <span className="mem-stat-val">{snapshot.difficulty === 'hard' ? '5×4' : '4×4'}</span>
            </div>
            <div className="mem-stat">
              <span className="mem-stat-label">计时</span>
              <span className="mem-stat-val mem-timer" role="timer" aria-live="off">
                {_fmtTime(snapshot.elapsed)}
              </span>
            </div>
            <div className="mem-stat">
              <span className="mem-stat-label">步数</span>
              <span className="mem-stat-val">{snapshot.steps}</span>
            </div>
            <div className="mem-stat">
              <span className="mem-stat-label">得分</span>
              <span className="mem-stat-val">{snapshot.liveScore ?? '—'}</span>
            </div>
          </>
        ) : (
          <div className="mem-diff-picker" role="radiogroup" aria-label="选择难度">
            <button type="button" role="radio" aria-checked="false" onClick={() => handleStart('easy')}>4×4 · 8 对</button>
            <button type="button" role="radio" aria-checked="false" onClick={() => handleStart('hard')}>5×4 · 10 对</button>
          </div>
        )}
      </div>

      {/* aria-live 播报配对结果（对读屏不可见，纯播报） */}
      <div aria-live="polite" aria-atomic="true" className="mem-live-region">{liveAnnounce}</div>

      {/* 棋盘 */}
      {snapshot && snapshot.cards?.length > 0 && screen !== 'over' && (
        <div
          className="mem-board-wrap"
          aria-hidden={screen === 'paused'}
          style={{ pointerEvents: screen === 'paused' ? 'none' : 'auto' }}
        >
          <div
            className={`mem-board mem-board-${snapshot.difficulty}`}
            role="grid"
            aria-label={`${snapshot.rows}行${snapshot.cols}列棋盘`}
            tabIndex={-1}
            onKeyDown={handleBoardKeyDown}
            onTouchEnd={handleBoardTouchEnd}
          >
            {_renderRows(snapshot, focusedIdx, doFlip)}
          </div>
        </div>
      )}

      {/* start 遮罩：默认显示，点难度即开局 */}
      {screen === 'start' && (
        <div className="mem-overlay">
          <div className="mem-overlay-card">
            <h2>记忆翻牌</h2>
            <p>翻开两张相同的图标即配对成功。步数越少、用时越短，得分越高。</p>
            <p className="mem-overlay-hint">支持方向键导航 + Enter/Space 翻牌。</p>
            <div className="mem-start-btns">
              <button type="button" className="mem-btn-primary" onClick={() => handleStart('easy')}>开始 4×4（8 对）</button>
              <button type="button" className="mem-btn" onClick={() => handleStart('hard')}>开始 5×4（10 对）</button>
            </div>
          </div>
        </div>
      )}

      {/* paused 遮罩 */}
      {screen === 'paused' && (
        <div className="mem-overlay">
          <div className="mem-overlay-card">
            <h2>{pausedAuto ? '已自动暂停' : '已暂停'}</h2>
            <p>{pausedAuto ? '检测到页面切走或窗口失焦' : '手动暂停中'}</p>
            <div className="mem-start-btns">
              <button type="button" className="mem-btn-primary" onClick={handleResume}>继续</button>
              <button type="button" className="mem-btn" onClick={handleBackHome}>返回首页</button>
            </div>
          </div>
        </div>
      )}

      {/* over 遮罩：结算 + 排行 */}
      {screen === 'over' && (
        <div className="mem-overlay">
          <div className="mem-overlay-card mem-overlay-win">
            <h2>配对完成！</h2>
            <div className="mem-summary">
              <div><span>难度</span><strong>{finalDifficulty === 'hard' ? '5×4' : '4×4'}</strong></div>
              <div><span>用时</span><strong>{_fmtTime(finalElapsed)}</strong></div>
              <div><span>步数</span><strong>{snapshot?.steps ?? '—'}</strong></div>
              <div><span>得分</span><strong>{finalScore}</strong></div>
            </div>

            {myRank ? (
              <p className="mem-rank-msg">你在本地排行榜中排第 <strong>{myRank}</strong> 名！</p>
            ) : submitState !== 'done' ? (
              <div className="mem-submit">
                <label htmlFor="mem-name">你的昵称（可选）</label>
                <input id="mem-name" type="text" maxLength={12} value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)} placeholder="无名飞侠" />
                <button type="button" className="mem-btn-primary"
                  disabled={submitState === 'submitting'}
                  onClick={handleSubmit}>
                  {submitState === 'submitting' ? '提交中…' : '提交成绩'}
                </button>
                {submitState === 'fail' && <p className="mem-submit-err">提交失败，请重试（可能本地存储不可用）</p>}
              </div>
            ) : null}

            <div className="mem-leaderboard">
              <h3>本地排行榜 TOP 10</h3>
              {rankList.length === 0 ? (
                <p className="mem-empty">虚位以待，等你上榜</p>
              ) : (
                <ol>
                  {rankList.map((r, i) => (
                    <li key={i} className={i < 3 ? `mem-top-${i + 1}` : ''}>
                      <span className="mem-rank-num">{i + 1}</span>
                      <span className="mem-rank-name">{r.name}</span>
                      <span className="mem-rank-score">{r.score} · {_fmtTime(r.elapsed)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="mem-start-btns">
              <button type="button" className="mem-btn-primary"
                onClick={() => handleStart(finalDifficulty)}>再来一局</button>
              <button type="button" className="mem-btn" onClick={handleBackHome}>返回首页</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 棋盘渲染：按快照行/列分组，每张牌是 button，roving tabindex */
function _renderRows(snapshot, focusedIdx, doFlip) {
  const { rows, cols, cards } = snapshot
  const out = []
  for (let r = 0; r < rows; r++) {
    const cells = []
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const card = cards[idx]
      cells.push(
        <CardCell
          key={card.id}
          card={card}
          row={r + 1}
          col={c + 1}
          tabIndex={focusedIdx === idx ? 0 : -1}
          onActivate={() => doFlip(idx)}
        />
      )
    }
    out.push(
      <div key={r} role="row" className="mem-row">{cells}</div>
    )
  }
  return out
}

/** 单张牌 */
function CardCell({ card, row, col, tabIndex, onActivate }) {
  const revealed = card.flipped || card.matched
  const cls = [
    'mem-card',
    revealed ? 'mem-card-flipped' : '',
    card.matched ? 'mem-card-matched' : '',
  ].filter(Boolean).join(' ')

  const ariaLabel = card.matched
    ? `第${row}行第${col}列，已配对：${card.icon}`
    : revealed
      ? `第${row}行第${col}列，已翻开：${card.icon}`
      : `第${row}行第${col}列，未翻开`

  return (
    <div role="gridcell" className={cls}>
      <button
        type="button"
        className="mem-card-inner"
        tabIndex={tabIndex}
        aria-label={ariaLabel}
        disabled={card.matched}
        onClick={onActivate}
      >
        <span className="mem-face mem-face-back" aria-hidden="true">?</span>
        <span className="mem-face mem-face-front" aria-hidden="true">{card.icon}</span>
      </button>
    </div>
  )
}

/** 排行榜本地 hook：每次屏幕变 over 时 fetch 一次 */
function useLeaderboard() {
  const [rows, setRows] = useState([])
  useEffect(() => {
    let mounted = true
    memoryLeaderboard.fetchTopScores().then((items) => {
      if (mounted) setRows(items || [])
    })
    return () => { mounted = false }
  }, [])
  return rows
}

function _fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export default MemoryPage
