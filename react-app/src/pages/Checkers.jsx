import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckersEngine, PIECE, SIDE, LEVELS, CHECKERS, isRedPiece, isKingPiece,
} from '../game/CheckersEngine'
import './Checkers.css'

const STATS_KEY = 'game-checkers-stats-v1'
const DAILY_KEY = 'game-checkers-daily-v1'
const POMODORO_KEY = 'pomodoro-sessions-v1'
const LEVEL_KEYS = ['easy', 'normal', 'hard']
const MOVE_THROTTLE_MS = 300
const DAILY_THROTTLE_MS = 30000
const DAILY_API = 'https://worldtimeapi.org/api/ip'

// 模块级时间戳：每日残局刷新 30 秒内不重复请求（约束卡② 节流）
let dailyFetchedAt = 0

function pad2(n) {
  return String(n).padStart(2, '0')
}

function localDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function loadStats() {
  const empty = {
    plays: 0, wins: 0, losses: 0, draws: 0,
    captures: 0, promotions: 0, aiMs: 0,
    dailyPlays: 0, dailyWins: 0, updatedAt: 0,
  }
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return empty
    const out = { ...empty }
    for (const k of Object.keys(empty)) {
      if (k === 'updatedAt') out[k] = Number(data[k]) || 0
      else if (Number.isFinite(data[k])) out[k] = Math.max(0, Math.floor(data[k]))
    }
    return out
  } catch { return empty }
}

function loadDailyRecords() {
  try {
    const raw = localStorage.getItem(DAILY_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return {}
    const out = {}
    for (const [date, rec] of Object.entries(data)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      if (!rec || typeof rec !== 'object') continue
      if (!['win', 'lose', 'draw'].includes(rec.result)) continue
      out[date] = {
        result: rec.result,
        elapsed: Number(rec.elapsed) || 0,
        level: rec.level || 'normal',
        ts: Number(rec.ts) || 0,
      }
    }
    return out
  } catch { return {} }
}

function appendPomodoroSession(startTs, endTs, info) {
  try {
    const raw = localStorage.getItem(POMODORO_KEY)
    const sessions = raw ? JSON.parse(raw) : []
    if (!Array.isArray(sessions)) return
    sessions.push({
      startTs,
      endTs,
      durSec: Math.round((endTs - startTs) / 1000),
      game: 'checkers',
      win: info.result === 'win',
      level: info.level,
    })
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000
    localStorage.setItem(POMODORO_KEY, JSON.stringify(sessions.filter((s) => s.endTs >= cutoff)))
  } catch { /* 存储不可用时静默忽略 */ }
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`
}

const RESULT_TEXT = { win: '胜利', lose: '失败', draw: '和棋' }

function pieceText(piece) {
  if (piece === PIECE.RED) return '红棋'
  if (piece === PIECE.RED_KING) return '红王'
  if (piece === PIECE.BLACK) return '黑棋'
  if (piece === PIECE.BLACK_KING) return '黑王'
  return '空格'
}

/**
 * 跳棋页面壳 —— 8×8 西洋跳棋，强制吃子 + 连跳 + 升王，三档 AI。
 *
 * 六屏：start / playing / paused / over
 * 约束卡① 外部 API 取权威日期生成每日残局，失败降级本地日期
 * 约束卡② 落子 300ms 防连点 + 每日残局刷新 30s 模块级节流
 * 约束卡③ 埋点写 game-checkers-stats-v1，切后台/失焦双路自动暂停
 */
export default function CheckersPage() {
  const engineRef = useRef(null)
  const snapshotRef = useRef(null)
  const statsRef = useRef(loadStats())
  const dailyRecordsRef = useRef(loadDailyRecords())
  const moveLockRef = useRef(0)
  const gameStartRef = useRef(0)
  const focusIdxRef = useRef(0)
  const aiTimerRef = useRef(null)
  const dailyCtrlRef = useRef(null)

  const [screen, setScreen] = useState('start')
  const [level, setLevel] = useState('normal')
  const [snapshot, setSnapshot] = useState(null)
  const [selected, setSelected] = useState(null)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [stats, setStats] = useState(statsRef.current)
  const [finalInfo, setFinalInfo] = useState(null)

  const [dailyDate, setDailyDate] = useState(localDateStr)
  const [dailySource, setDailySource] = useState('local')
  const [dailyLoading, setDailyLoading] = useState(false)
  const [dailyNote, setDailyNote] = useState('')
  const [dailyRecords, setDailyRecords] = useState(dailyRecordsRef.current)

  const flushStats = (next) => {
    statsRef.current = next
    setStats(next)
    try { localStorage.setItem(STATS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const saveDailyRecord = (date, record) => {
    const next = { ...dailyRecordsRef.current, [date]: record }
    dailyRecordsRef.current = next
    setDailyRecords(next)
    try { localStorage.setItem(DAILY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  // ===== 引擎初始化 =====
  useEffect(() => {
    const engine = new CheckersEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state === 'playing') setScreen('playing')
        else if (snap.state === 'paused') setScreen('paused')
        else if (snap.state === 'over') setScreen('over')
      },
      onGameOver: (info) => {
        const s = { ...statsRef.current }
        s.plays += 1
        if (info.result === 'win') s.wins += 1
        else if (info.result === 'lose') s.losses += 1
        else s.draws += 1
        s.captures += info.captures || 0
        s.promotions += info.promotions || 0
        s.aiMs += Math.round(info.aiMs || 0)
        if (info.mode === 'daily') {
          s.dailyPlays += 1
          if (info.result === 'win') s.dailyWins += 1
        }
        s.updatedAt = Date.now()
        flushStats(s)

        if (info.mode === 'daily' && info.dailyDate) {
          saveDailyRecord(info.dailyDate, {
            result: info.result,
            elapsed: info.elapsed,
            level: info.level,
            ts: Date.now(),
          })
        }

        const durSec = Math.round(info.elapsed)
        if (gameStartRef.current && durSec >= 120) {
          appendPomodoroSession(gameStartRef.current, Date.now(), info)
        }

        setFinalInfo(info)
        setLiveAnnounce(`对局结束，${RESULT_TEXT[info.result] || '已结束'}`)
        setScreen('over')
      },
    })
    engineRef.current = engine
    snapshotRef.current = engine.getSnapshot()

    const tickTimer = setInterval(() => {
      if (engineRef.current && engineRef.current.state === 'playing') engineRef.current.tick()
    }, 500)

    return () => {
      clearInterval(tickTimer)
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current)
      dailyCtrlRef.current?.abort()
      engine.dispose()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== 每日残局：权威日期 + 失败降级 =====
  async function refreshDaily() {
    const now = Date.now()
    if (now - dailyFetchedAt < DAILY_THROTTLE_MS) {
      setDailyNote('刷新过于频繁，30 秒内不重复请求')
      return
    }
    dailyFetchedAt = now
    dailyCtrlRef.current?.abort()
    const ctrl = new AbortController()
    dailyCtrlRef.current = ctrl
    const timer = setTimeout(() => ctrl.abort(), 6000)
    setDailyLoading(true)
    setDailyNote('')
    try {
      const res = await fetch(DAILY_API, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const date = typeof data?.datetime === 'string' ? data.datetime.slice(0, 10) : ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('返回格式异常')
      setDailyDate(date)
      setDailySource('api')
      setDailyNote('已同步网络日期')
    } catch (err) {
      setDailyDate(localDateStr())
      setDailySource('fallback')
      setDailyNote(err?.name === 'AbortError'
        ? '时间服务超时，已按本地日期生成残局'
        : '时间服务不可用，已按本地日期生成残局')
    } finally {
      clearTimeout(timer)
      setDailyLoading(false)
    }
  }

  useEffect(() => {
    refreshDaily()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== 自动暂停（双路去重） =====
  useEffect(() => {
    const pauseIfPlaying = () => {
      const e = engineRef.current
      if (e && e.state === 'playing') {
        if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null }
        setPausedAuto(true)
        e.pause()
      }
    }
    const onHide = () => { if (document.visibilityState === 'hidden') pauseIfPlaying() }
    const onBlur = () => pauseIfPlaying()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // ===== AI 走子调度（思考延迟 + 连跳续走） =====
  function scheduleAiIfNeeded() {
    const e = engineRef.current
    if (!e || e.state !== 'playing' || e.turn !== SIDE.BLACK) return
    if (aiTimerRef.current) return
    aiTimerRef.current = setTimeout(() => {
      aiTimerRef.current = null
      const eng = engineRef.current
      if (!eng || eng.state !== 'playing' || eng.turn !== SIDE.BLACK) return
      eng.playAiMove()
      if (eng.state === 'playing' && eng.turn === SIDE.BLACK) scheduleAiIfNeeded()
    }, 340)
  }

  function handleStart(lv, mode = 'classic') {
    const e = engineRef.current
    if (!e) return
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null }
    setLevel(lv)
    setSelected(null)
    setFocusedIdx(0)
    focusIdxRef.current = 0
    setPausedAuto(false)
    setFinalInfo(null)
    setLiveAnnounce(mode === 'daily' ? `每日残局开始，日期 ${dailyDate}` : '对局开始，你执红先行')
    gameStartRef.current = Date.now()
    moveLockRef.current = 0
    setScreen('playing')
    e.start(lv, { mode, dailyDate: mode === 'daily' ? dailyDate : '' })
  }

  function handleRestart() {
    handleStart(level, snapshotRef.current?.mode === 'daily' ? 'daily' : 'classic')
  }

  function handlePause() {
    const e = engineRef.current
    if (!e || e.state !== 'playing') return
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null }
    e.pause()
    setPausedAuto(false)
  }

  function handleResume() {
    const e = engineRef.current
    if (!e || e.state !== 'paused') return
    e.resume()
    setPausedAuto(false)
    scheduleAiIfNeeded()
  }

  function announceCell(idx) {
    const snap = snapshotRef.current
    if (!snap || !snap.board.length) return
    const r = (idx >> 3) + 1
    const c = (idx & 7) + 1
    const targets = engineRef.current?.movesForPiece(idx) || []
    const tail = targets.length ? `，可走 ${targets.length} 处` : ''
    setLiveAnnounce(`第 ${r} 行第 ${c} 列，${pieceText(snap.board[idx])}${tail}`)
  }

  function activateCell(cellIdx) {
    const e = engineRef.current
    const snap = snapshotRef.current
    if (!e || !snap || !snap.board.length || e.state !== 'playing') return
    if (snap.turn !== SIDE.RED) {
      setLiveAnnounce('AI 正在思考，请稍候')
      return
    }

    const targets = selected != null ? e.movesForPiece(selected) : []
    const hit = targets.find((m) => m.to === cellIdx)

    if (hit) {
      const now = Date.now()
      if (now - moveLockRef.current < MOVE_THROTTLE_MS) return
      moveLockRef.current = now
      const res = e.tryMove(selected, cellIdx)
      if (!res.ok) {
        setLiveAnnounce(res.reason || '无法走子')
        return
      }
      const nextSelected = res.chain ? e.chainFrom : null
      setSelected(nextSelected)
      focusIdxRef.current = cellIdx
      setFocusedIdx(cellIdx)
      const nextSnap = e.getSnapshot()
      const chainText = res.chain ? '，必须继续连跳' : ''
      const captureCount = hit.captures.length
      setLiveAnnounce(
        `${captureCount ? `吃子 ${captureCount} 枚` : '移动'}到第 ${(cellIdx >> 3) + 1} 行第 ${(cellIdx & 7) + 1} 列${chainText}`
      )
      if (!res.chain) scheduleAiIfNeeded()
      else if (nextSnap.turn !== SIDE.RED) setSelected(null)
      return
    }

    if (isRedPiece(snap.board[cellIdx])) {
      if (e.chainFrom >= 0 && cellIdx !== e.chainFrom) {
        setLiveAnnounce('必须继续使用同一枚棋子连跳')
        return
      }
      setSelected(cellIdx)
      focusIdxRef.current = cellIdx
      setFocusedIdx(cellIdx)
      const options = e.movesForPiece(cellIdx)
      setLiveAnnounce(options.length
        ? `已选中棋子，可走 ${options.length} 处`
        : '这枚棋子当前没有合法走法')
      return
    }

    if (selected != null) setLiveAnnounce('这不是合法的落点')
    else if (snap.mustCapture) setLiveAnnounce('有可吃子的走法，请先吃子')
    else setLiveAnnounce('请先选中自己的红棋')
  }

  // ===== 键盘（方向键移动焦点 + Enter/Space 操作 + Esc 暂停） =====
  useEffect(() => {
    const onKey = (ev) => {
      const e = engineRef.current
      if (!e) return
      if (ev.key === 'Escape') {
        if (e.state === 'playing') handlePause()
        else if (e.state === 'paused') handleResume()
        ev.preventDefault()
        return
      }
      if (e.state !== 'playing') return

      let r = focusIdxRef.current >> 3
      let c = focusIdxRef.current & 7
      let moved = false
      if (ev.key === 'ArrowUp' && r > 0) { r -= 1; moved = true }
      else if (ev.key === 'ArrowDown' && r < 7) { r += 1; moved = true }
      else if (ev.key === 'ArrowLeft' && c > 0) { c -= 1; moved = true }
      else if (ev.key === 'ArrowRight' && c < 7) { c += 1; moved = true }
      if (moved) {
        const next = r * 8 + c
        focusIdxRef.current = next
        setFocusedIdx(next)
        announceCell(next)
        ev.preventDefault()
        return
      }
      if (ev.key === 'Enter' || ev.key === ' ') {
        activateCell(focusIdxRef.current)
        ev.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  // ===== 渲染 =====
  const snap = snapshot
  const targetSet = new Set(
    selected != null && engineRef.current ? engineRef.current.movesForPiece(selected).map((m) => m.to) : []
  )
  const todayRecord = dailyRecords[dailyDate]
  const activeDaily = snap?.mode === 'daily'

  return (
    <div className="chk-page">
      <nav className="chk-nav">
        <Link to="/" className="chk-nav-back">← 返回首页</Link>
        <h1 className="chk-nav-title">跳棋 · Checkers</h1>
        <div className="chk-nav-spacer" />
      </nav>

      {/* ===== 开始屏 ===== */}
      {screen === 'start' && (
        <div className="chk-screen">
          <div className="chk-card">
            <h2 className="chk-title">跳棋</h2>
            <p className="chk-desc">
              8×8 西洋跳棋：红棋只能斜向前进，跳过相邻黑棋即可吃掉它。
              <strong>有吃子机会就必须吃</strong>，一次跳完还能继续跳时必须连跳；走到对方底线升王，王可四向行走。
              吃光对方棋子或让对方无路可走即获胜。
            </p>

            <div className="chk-levels">
              {LEVEL_KEYS.map((lv) => (
                <button
                  key={lv}
                  className={`chk-level-btn ${level === lv ? 'active' : ''}`}
                  onClick={() => setLevel(lv)}
                >
                  <span className="chk-level-label">{LEVELS[lv].label}</span>
                  <span className="chk-level-sub">{LEVELS[lv].blurb}</span>
                </button>
              ))}
            </div>

            <button className="chk-start-btn" onClick={() => handleStart(level)}>开始对局（你执红先行）</button>

            <div className="chk-daily">
              <div className="chk-daily-head">
                <strong>每日残局</strong>
                <span className={`chk-daily-badge ${dailySource === 'api' ? 'api' : 'local'}`}>
                  {dailySource === 'api' ? '网络日期' : '本地日期'}
                </span>
              </div>
              <div className="chk-daily-date">
                {dailyDate}
                {dailyLoading ? ' · 同步中…' : ''}
              </div>
              <p className="chk-daily-note">
                {dailyNote || `双方各 ${CHECKERS.DAILY_PIECES} 枚棋子，同一日期盘面固定，可反复挑战刷新成绩。`}
              </p>
              {todayRecord && (
                <p className={`chk-daily-result ${todayRecord.result}`}>
                  今日战绩：{RESULT_TEXT[todayRecord.result]} · 用时 {fmtTime(todayRecord.elapsed)}
                </p>
              )}
              <div className="chk-daily-actions">
                <button className="chk-btn" onClick={refreshDaily} disabled={dailyLoading}>刷新日期</button>
                <button className="chk-btn chk-btn-primary" onClick={() => handleStart(level, 'daily')}>
                  开始每日残局
                </button>
              </div>
            </div>

            <div className="chk-stats-line">
              累计 {stats.plays} 局 · 胜 {stats.wins} · 和 {stats.draws} · 负 {stats.losses}
            </div>

            <div className="chk-rules">
              <h3>操作方式</h3>
              <ul>
                <li>点击自己的红棋选中，再点高亮落点走子</li>
                <li>方向键移动焦点 · Enter/空格 选中或落子</li>
                <li>Esc 暂停 / 继续 · 切后台或窗口失焦自动暂停</li>
                <li>连续吃子时必须用同一枚棋子继续跳</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ===== 游戏主界面 ===== */}
      {snap && snap.board.length > 0 && screen !== 'start' && (
        <div className="chk-main">
          <div className="chk-hud">
            <div className="chk-hud-left">
              <span className="chk-timer">⏱ {fmtTime(snap.elapsed)}</span>
              <span className={`chk-turn ${snap.turn}`}>
                {snap.turn === SIDE.RED ? '你的回合' : 'AI 思考中'}
                {snap.chainFrom >= 0 ? ' · 连跳' : ''}
              </span>
              {snap.mustCapture && snap.turn === SIDE.RED && (
                <span className="chk-force-tag">必须吃子</span>
              )}
            </div>
            <div className="chk-hud-right">
              <span className="chk-level-tag">
                {LEVELS[snap.level]?.label || snap.level}
                {activeDaily ? ' · 每日' : ''}
              </span>
              {screen === 'playing' && <button className="chk-btn" onClick={handlePause}>暂停</button>}
              {screen === 'paused' && <button className="chk-btn chk-btn-primary" onClick={handleResume}>继续</button>}
              <button className="chk-btn" onClick={handleRestart}>重开</button>
              <button className="chk-btn" onClick={() => { setScreen('start'); setSelected(null) }}>菜单</button>
            </div>
          </div>

          <div className="chk-scoreline">
            <span className="chk-side red">
              <i className="chk-dot red" aria-hidden="true" />
              你（红）{snap.playerPieces}
            </span>
            <span className="chk-side black">
              <i className="chk-dot black" aria-hidden="true" />
              AI（黑）{snap.aiPieces}
            </span>
            <span className="chk-move-count">第 {snap.moves} 手 · 吃子 {snap.captures}</span>
          </div>

          <div className="chk-board-wrap">
            <div className="chk-board" role="grid" aria-label="跳棋棋盘 8 行 8 列">
              {Array.from({ length: 64 }).map((_, idx) => {
                const r = idx >> 3
                const c = idx & 7
                const dark = (r + c) % 2 === 1
                const piece = snap.board[idx]
                const isSelected = selected === idx
                const isTarget = targetSet.has(idx)
                const isLast = snap.lastMove && (snap.lastMove.from === idx || snap.lastMove.to === idx)
                const classes = [
                  'chk-cell',
                  dark ? 'dark' : 'light',
                  isSelected ? 'selected' : '',
                  isTarget ? 'target' : '',
                  isLast ? 'last' : '',
                  focusedIdx === idx ? 'focused' : '',
                ].filter(Boolean).join(' ')
                return (
                  <div
                    key={idx}
                    role="gridcell"
                    className={classes}
                    aria-label={`第 ${r + 1} 行第 ${c + 1} 列，${pieceText(piece)}${isTarget ? '，可落子' : ''}`}
                    aria-selected={isSelected}
                    tabIndex={focusedIdx === idx ? 0 : -1}
                    data-idx={idx}
                    onClick={dark ? () => activateCell(idx) : undefined}
                    onFocus={() => { focusIdxRef.current = idx; setFocusedIdx(idx) }}
                  >
                    {piece !== PIECE.EMPTY && (
                      <span
                        className={`chk-piece ${isRedPiece(piece) ? 'red' : 'black'} ${isKingPiece(piece) ? 'king' : ''}`}
                        aria-hidden="true"
                      >
                        {isKingPiece(piece) ? '♛' : ''}
                      </span>
                    )}
                    {isTarget && <span className="chk-target-dot" aria-hidden="true" />}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="chk-hint-bar">
            点击红棋选中 → 点落点走子 · 方向键移动 · Enter/空格 操作 · Esc 暂停
          </div>

          {/* 暂停遮罩 */}
          {screen === 'paused' && (
            <div className="chk-overlay">
              <div className="chk-overlay-card">
                <h3>⏸ 对局暂停</h3>
                {pausedAuto && <p className="chk-paused-reason">已自动暂停（页面隐藏或窗口失焦）</p>}
                <div className="chk-overlay-actions">
                  <button className="chk-btn chk-btn-primary big" onClick={handleResume}>继续对局</button>
                  <button className="chk-btn" onClick={handleRestart}>重新开始</button>
                  <button className="chk-btn" onClick={() => setScreen('start')}>返回菜单</button>
                </div>
              </div>
            </div>
          )}

          {/* 结束遮罩 */}
          {screen === 'over' && finalInfo && (
            <div className="chk-overlay">
              <div className={`chk-overlay-card chk-overlay-${finalInfo.result}`}>
                <h3>{finalInfo.result === 'win' ? '🎉 你赢了！' : finalInfo.result === 'lose' ? '💀 你输了' : '🤝 和棋'}</h3>
                <div className="chk-win-stats">
                  <div className="chk-win-big">{fmtTime(finalInfo.elapsed)}</div>
                  <div className="chk-win-sub">
                    {LEVELS[finalInfo.level]?.label || finalInfo.level}
                    {finalInfo.mode === 'daily' ? ' · 每日残局' : ''}
                    {' · '}{finalInfo.moves} 手 · 吃子 {finalInfo.captures} · 升王 {finalInfo.promotions}
                  </div>
                </div>
                {finalInfo.mode === 'daily' && finalInfo.dailyDate && (
                  <p className="chk-daily-settled">今日残局已记录：{RESULT_TEXT[finalInfo.result]}</p>
                )}
                <div className="chk-overlay-actions">
                  <button className="chk-btn chk-btn-primary big" onClick={handleRestart}>再来一局</button>
                  <button className="chk-btn" onClick={() => setScreen('start')}>返回菜单</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div aria-live="polite" aria-atomic="true" className="chk-sr-only">{liveAnnounce}</div>
    </div>
  )
}
