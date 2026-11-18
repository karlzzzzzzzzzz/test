import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Match3Engine, MATCH3, LEVELS } from '../game/Match3Engine'
import './Match3.css'

const STATS_KEY = 'game-match3-stats-v1'
const BEST_KEY = 'game-match3-best-v1'
const SAVE_KEY = 'game-match3-save-v1'
const POMODORO_KEY = 'pomodoro-sessions-v1'
const LEVEL_KEYS = ['easy', 'normal', 'hard']
const SAVE_TTL_MS = 24 * 3600 * 1000
const SAVE_MAX_CHARS = 4096

const GEMS = {
  1: { name: '红宝石', glyph: '◆', cls: 'ruby' },
  2: { name: '蓝宝石', glyph: '●', cls: 'sapphire' },
  3: { name: '绿宝石', glyph: '▲', cls: 'emerald' },
  4: { name: '黄水晶', glyph: '★', cls: 'amber' },
  5: { name: '紫水晶', glyph: '■', cls: 'violet' },
  6: { name: '青金石', glyph: '⬢', cls: 'cyan' },
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`
}

function loadStats() {
  const empty = {
    plays: 0, wins: 0, losses: 0, swaps: 0, matches: 0,
    cascades: 0, maxCombo: 0, bestScore: 0,
    timeByLevel: { easy: 0, normal: 0, hard: 0 },
    updatedAt: 0,
  }
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return empty
    const out = { ...empty, timeByLevel: { ...empty.timeByLevel } }
    for (const key of Object.keys(empty)) {
      if (key === 'timeByLevel' || key === 'updatedAt') continue
      out[key] = Number.isFinite(data[key]) ? Math.max(0, Math.floor(data[key])) : 0
    }
    out.updatedAt = Number(data.updatedAt) || 0
    if (data.timeByLevel && typeof data.timeByLevel === 'object') {
      for (const key of LEVEL_KEYS) {
        out.timeByLevel[key] = Math.max(0, Number(data.timeByLevel[key]) || 0)
      }
    }
    return out
  } catch { return empty }
}

function loadBest() {
  const empty = { easy: null, normal: null, hard: null }
  try {
    const raw = localStorage.getItem(BEST_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return empty
    const out = { ...empty }
    for (const key of LEVEL_KEYS) {
      const rec = data[key]
      if (!rec || typeof rec !== 'object') continue
      if (!Number.isFinite(rec.score)) continue
      out[key] = { score: Math.max(0, Math.floor(rec.score)), ts: Number(rec.ts) || 0 }
    }
    return out
  } catch { return empty }
}

/** 读取未完成对局：>4KB / 超 24h / 字段非法直接丢弃并清理 */
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    if (raw.length > SAVE_MAX_CHARS) {
      localStorage.removeItem(SAVE_KEY)
      return null
    }
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    if (!Number.isFinite(data.ts) || Date.now() - data.ts > SAVE_TTL_MS) {
      localStorage.removeItem(SAVE_KEY)
      return null
    }
    if (!(data.level in LEVELS)) return null
    if (!Array.isArray(data.board) || data.board.length !== MATCH3.ROWS * MATCH3.COLS) return null
    if (!Number.isFinite(data.movesLeft) || data.movesLeft <= 0) return null
    return data
  } catch { return null }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY) } catch { /* ignore */ }
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
      game: 'match3',
      win: info.result === 'win',
      level: info.level,
    })
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000
    localStorage.setItem(POMODORO_KEY, JSON.stringify(sessions.filter((s) => s.endTs >= cutoff)))
  } catch { /* 存储不可用时静默忽略 */ }
}

function gemLabel(value) {
  return GEMS[value]?.name || '未知方块'
}

/**
 * 消消乐页面壳 —— 8×8 三消，限步达标，连锁计分。
 *
 * 六屏：start / playing / paused / over
 * 约束卡① 埋点写 game-match3-stats-v1：脏标记 + 1s 防抖 + pagehide 落盘
 * 约束卡② localStorage 持久化：局中存档 ≤4KB、24h TTL、通关/失败即清理
 * 约束卡③ 与基线已知不一致点联动：DragList 改为插入式排序（见 3.1.3）
 */
export default function Match3Page() {
  const engineRef = useRef(null)
  const snapshotRef = useRef(null)
  const statsRef = useRef(loadStats())
  const bestRef = useRef(loadBest())
  const gameStartRef = useRef(0)
  const focusRef = useRef(0)
  const selectedRef = useRef(null)
  const flashTimerRef = useRef(null)
  const statsTimerRef = useRef(null)
  const statsDirtyRef = useRef(false)

  const [screen, setScreen] = useState('start')
  const [level, setLevel] = useState('normal')
  const [snapshot, setSnapshot] = useState(null)
  const [selected, setSelected] = useState(null)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [stats, setStats] = useState(statsRef.current)
  const [best, setBest] = useState(bestRef.current)
  const [finalInfo, setFinalInfo] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [flash, setFlash] = useState(() => new Set())
  const [saveInfo, setSaveInfo] = useState(loadSave)
  const [saveNote, setSaveNote] = useState('')

  const flushStatsNow = () => {
    if (statsTimerRef.current) {
      clearTimeout(statsTimerRef.current)
      statsTimerRef.current = null
    }
    if (!statsDirtyRef.current) return
    statsDirtyRef.current = false
    try { localStorage.setItem(STATS_KEY, JSON.stringify(statsRef.current)) } catch { /* ignore */ }
  }

  const markStatsDirty = () => {
    statsDirtyRef.current = true
    if (statsTimerRef.current) return
    statsTimerRef.current = setTimeout(() => {
      statsTimerRef.current = null
      flushStatsNow()
    }, 1000)
  }

  const saveBest = (next) => {
    bestRef.current = next
    setBest(next)
    try { localStorage.setItem(BEST_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const persistSave = (snap) => {
    if (!snap || snap.state !== 'playing' || !snap.board.length) return
    const payload = {
      v: 1,
      level: snap.level,
      board: snap.board,
      movesLeft: snap.movesLeft,
      score: snap.score,
      swaps: snap.swaps,
      matches: snap.matches,
      cascades: snap.cascades,
      maxCombo: snap.maxCombo,
      elapsed: Math.round(snap.elapsed),
      ts: Date.now(),
    }
    const raw = JSON.stringify(payload)
    if (raw.length > SAVE_MAX_CHARS) return
    try { localStorage.setItem(SAVE_KEY, raw) } catch { /* 配额满时放弃存档 */ }
  }

  // ===== 引擎初始化 =====
  useEffect(() => {
    const engine = new Match3Engine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.state === 'playing') setScreen('playing')
        else if (snap.state === 'paused') setScreen('paused')
        else if (snap.state === 'over') setScreen('over')
      },
      onGameOver: (info) => {
        const s = { ...statsRef.current, timeByLevel: { ...statsRef.current.timeByLevel } }
        s.plays += 1
        if (info.result === 'win') s.wins += 1
        else s.losses += 1
        s.swaps += info.swaps || 0
        s.matches += info.matches || 0
        s.cascades += info.cascades || 0
        s.maxCombo = Math.max(s.maxCombo, info.maxCombo || 0)
        s.bestScore = Math.max(s.bestScore, info.score || 0)
        s.timeByLevel[info.level] = Math.round((s.timeByLevel[info.level] || 0) + info.elapsed)
        s.updatedAt = Date.now()
        statsRef.current = s
        setStats(s)
        statsDirtyRef.current = true
        markStatsDirty()

        if (info.result === 'win') {
          const prev = bestRef.current[info.level]
          if (!prev || info.score > prev.score) {
            saveBest({ ...bestRef.current, [info.level]: { score: info.score, ts: Date.now() } })
          }
        }

        clearSave()
        setSaveInfo(null)

        const durSec = Math.round(info.elapsed)
        if (gameStartRef.current && durSec >= 120) {
          const endTs = Date.now()
          appendPomodoroSession(endTs - durSec * 1000, endTs, info)
        }

        setFinalInfo(info)
        setLiveAnnounce(info.result === 'win' ? '目标达成，胜利！' : '步数用尽，挑战失败')
      },
    })
    engineRef.current = engine
    snapshotRef.current = engine.getSnapshot()

    const tickTimer = setInterval(() => {
      if (engineRef.current && engineRef.current.state === 'playing') engineRef.current.tick()
    }, 500)

    return () => {
      clearInterval(tickTimer)
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
      flushStatsNow()
      engine.dispose()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // pagehide 单独注册，确保统计落盘（约束卡①）
  useEffect(() => {
    const onPageHide = () => flushStatsNow()
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== 自动暂停（双路去重） =====
  useEffect(() => {
    const pauseIfPlaying = () => {
      const e = engineRef.current
      if (e && e.state === 'playing') {
        setPausedAuto(true)
        e.pause()
        persistSave(e.getSnapshot())
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleStart(lv) {
    const e = engineRef.current
    if (!e) return
    setLevel(lv)
    setSelected(null)
    selectedRef.current = null
    focusRef.current = 0
    setFocusedIdx(0)
    setPausedAuto(false)
    setFinalInfo(null)
    setLastResult(null)
    setFlash(new Set())
    setSaveNote('')
    gameStartRef.current = Date.now()
    e.start(lv)
    clearSave()
    setSaveInfo(null)
    setLiveAnnounce(`消消乐开始，目标 ${LEVELS[lv].target} 分`)
  }

  function handleResumeSave() {
    const e = engineRef.current
    const data = saveInfo
    if (!e || !data) return
    if (!e.restore(data)) {
      clearSave()
      setSaveInfo(null)
      setSaveNote('存档已失效，已自动清除')
      return
    }
    setLevel(data.level)
    setSelected(null)
    selectedRef.current = null
    setPausedAuto(false)
    setFinalInfo(null)
    setLastResult(null)
    setFlash(new Set())
    setSaveNote('')
    gameStartRef.current = Date.now() - (Number(data.elapsed) || 0) * 1000
    setLiveAnnounce('已恢复上次对局')
  }

  function handleRestart() {
    handleStart(level)
  }

  function handlePause() {
    const e = engineRef.current
    if (!e || e.state !== 'playing') return
    e.pause()
    persistSave(e.getSnapshot())
    setPausedAuto(false)
  }

  function handleResume() {
    const e = engineRef.current
    if (!e || e.state !== 'paused') return
    e.resume()
    setPausedAuto(false)
  }

  const handleMenu = () => {
    const e = engineRef.current
    if (e && e.state === 'playing') {
      e.pause()
      persistSave(e.getSnapshot())
    }
    setSaveInfo(loadSave())
    setSelected(null)
    selectedRef.current = null
    setPausedAuto(false)
    setFinalInfo(null)
    setScreen('start')
  }

  function announceSwap(res) {
    if (!res.ok) {
      setLiveAnnounce(res.reason || '无法交换')
      return
    }
    const combo = res.cascades > 0 ? `，连锁 ${res.cascades + 1} 段` : ''
    const shuffle = res.reshuffled ? '，棋盘已自动重排' : ''
    setLiveAnnounce(`消除 ${res.cleared} 个，获得 ${res.gained} 分${combo}${shuffle}`)
  }

  function activateCell(idx) {
    const e = engineRef.current
    const snap = snapshotRef.current
    if (!e || !snap || snap.state !== 'playing') return
    if (selectedRef.current == null) {
      selectedRef.current = idx
      setSelected(idx)
      focusRef.current = idx
      setFocusedIdx(idx)
      setLiveAnnounce(`已选中${gemLabel(snap.board[idx])}，请选择相邻方块`)
      return
    }
    if (selectedRef.current === idx) {
      selectedRef.current = null
      setSelected(null)
      setLiveAnnounce('已取消选择')
      return
    }
    const a = selectedRef.current
    const ra = Math.floor(a / snap.cols)
    const ca = a % snap.cols
    const rb = Math.floor(idx / snap.cols)
    const cb = idx % snap.cols
    if (Math.abs(ra - rb) + Math.abs(ca - cb) !== 1) {
      selectedRef.current = idx
      setSelected(idx)
      focusRef.current = idx
      setFocusedIdx(idx)
      setLiveAnnounce(`已改选${gemLabel(snap.board[idx])}，请选择相邻方块`)
      return
    }

    const before = snap.board.slice()
    const res = e.trySwap(a, idx)
    selectedRef.current = null
    setSelected(null)
    focusRef.current = idx
    setFocusedIdx(idx)
    if (!res.ok) {
      announceSwap(res)
      return
    }

    const after = snapshotRef.current?.board || []
    const changed = []
    for (let i = 0; i < after.length; i++) {
      if (before[i] !== after[i]) changed.push(i)
    }
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    setFlash(new Set(changed))
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null
      setFlash(new Set())
    }, 420)

    setLastResult({ gained: res.gained, cascades: res.cascades, reshuffled: res.reshuffled })
    announceSwap(res)
    if (!res.win && !res.lose) persistSave(e.getSnapshot())
  }

  // ===== 键盘：方向键移动焦点 + Enter/空格 选择或交换 + Esc 暂停 =====
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
      const cols = snapshotRef.current?.cols || MATCH3.COLS
      let r = Math.floor(focusRef.current / cols)
      let c = focusRef.current % cols
      let moved = false
      if (ev.key === 'ArrowUp' && r > 0) { r -= 1; moved = true }
      else if (ev.key === 'ArrowDown' && r < MATCH3.ROWS - 1) { r += 1; moved = true }
      else if (ev.key === 'ArrowLeft' && c > 0) { c -= 1; moved = true }
      else if (ev.key === 'ArrowRight' && c < cols - 1) { c += 1; moved = true }
      if (moved) {
        focusRef.current = r * cols + c
        setFocusedIdx(focusRef.current)
        ev.preventDefault()
        return
      }
      if (ev.key === 'Enter' || ev.key === ' ') {
        activateCell(focusRef.current)
        ev.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== 渲染 =====
  const snap = snapshot
  const progress = snap ? Math.min(100, Math.round((snap.score / snap.target) * 100)) : 0
  const bestRec = best[level]

  return (
    <div className="m3-page">
      <nav className="m3-nav">
        <Link to="/" className="m3-nav-back">← 返回首页</Link>
        <h1 className="m3-nav-title">消消乐 · Match 3</h1>
        <div className="m3-nav-spacer" />
      </nav>

      {/* ===== 开始屏 ===== */}
      {screen === 'start' && (
        <div className="m3-screen">
          <div className="m3-card">
            <h2 className="m3-title">消消乐</h2>
            <p className="m3-desc">
              交换相邻的两个宝石，让横排或竖排出现<strong>三个及以上同色</strong>即可消除。
              消除后宝石下落、顶部补充，连续触发会形成连锁加分。在限定步数内达到目标分即通关。
            </p>

            <div className="m3-levels">
              {LEVEL_KEYS.map((lv) => (
                <button
                  key={lv}
                  className={`m3-level-btn ${level === lv ? 'active' : ''}`}
                  onClick={() => setLevel(lv)}
                >
                  <span className="m3-level-label">{LEVELS[lv].label}</span>
                  <span className="m3-level-sub">{LEVELS[lv].blurb}</span>
                  <span className="m3-level-goal">目标 {LEVELS[lv].target} 分</span>
                </button>
              ))}
            </div>

            <button className="m3-start-btn" onClick={() => handleStart(level)}>开始挑战</button>

            <div className="m3-resume">
              <div className="m3-resume-head">
                <strong>未完成对局</strong>
                {saveInfo && <span className="m3-resume-badge">可继续</span>}
              </div>
              {saveInfo ? (
                <>
                  <p className="m3-resume-meta">
                    {LEVELS[saveInfo.level].label} · {saveInfo.score} 分 · 剩余 {saveInfo.movesLeft} 步
                    {' · '}{fmtTime(saveInfo.elapsed)}
                  </p>
                  <button className="m3-btn m3-btn-primary" onClick={handleResumeSave}>继续上次对局</button>
                </>
              ) : (
                <p className="m3-resume-empty">
                  {saveNote || '暂无存档：对局中断后会自动保存，24 小时内可继续。'}
                </p>
              )}
            </div>

            <div className="m3-stats-line">
              累计 {stats.plays} 局 · 胜 {stats.wins} · 负 {stats.losses} · 最高分 {stats.bestScore}
              {bestRec ? ` · ${LEVELS[level].label}最佳 ${bestRec.score}` : ''}
            </div>

            <div className="m3-rules">
              <h3>操作方式</h3>
              <ul>
                <li>点击一个宝石选中，再点相邻宝石交换；无法三消会弹回</li>
                <li>方向键移动焦点 · Enter/空格 选中或交换</li>
                <li>Esc 暂停 / 继续 · 切后台或窗口失焦自动暂停并保存</li>
                <li>每步消耗 1 次移动，连锁得分按段数倍增</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ===== 游戏主界面 ===== */}
      {snap && snap.board.length > 0 && screen !== 'start' && (
        <div className="m3-main">
          <div className="m3-hud">
            <div className="m3-hud-left">
              <span className="m3-timer">⏱ {fmtTime(snap.elapsed)}</span>
              <span className="m3-score">{snap.score} / {snap.target}</span>
              <span className={`m3-moves ${snap.movesLeft <= 3 ? 'low' : ''}`}>剩余 {snap.movesLeft} 步</span>
            </div>
            <div className="m3-hud-right">
              <span className="m3-level-tag">{LEVELS[snap.level]?.label || snap.level}</span>
              {screen === 'playing' && <button className="m3-btn" onClick={handlePause}>暂停</button>}
              {screen === 'paused' && <button className="m3-btn m3-btn-primary" onClick={handleResume}>继续</button>}
              <button className="m3-btn" onClick={handleRestart}>重开</button>
              <button className="m3-btn" onClick={handleMenu}>菜单</button>
            </div>
          </div>

          <div className="m3-progress" aria-hidden="true">
            <div className="m3-progress-bar" style={{ width: `${progress}%` }} />
          </div>

          <div className="m3-scoreline">
            <span>交换 {snap.swaps} 次 · 消除 {snap.matches} 个</span>
            {lastResult ? (
              <span className="m3-last-gain">
                本次 +{lastResult.gained}
                {lastResult.cascades > 0 ? ` · 连锁 ${lastResult.cascades + 1} 段` : ''}
                {lastResult.reshuffled ? ' · 已重排' : ''}
              </span>
            ) : (
              <span className="m3-last-gain muted">选中宝石后点相邻格交换</span>
            )}
          </div>

          <div className="m3-board-wrap">
            <div
              className="m3-board"
              role="grid"
              aria-label={`消消乐棋盘 ${snap.rows} 行 ${snap.cols} 列`}
              aria-rowcount={snap.rows}
              aria-colcount={snap.cols}
            >
              {snap.board.map((value, idx) => {
                const gem = GEMS[value] || GEMS[1]
                const classes = [
                  'm3-cell',
                  selected === idx ? 'selected' : '',
                  focusedIdx === idx ? 'focused' : '',
                  flash.has(idx) ? 'flash' : '',
                ].filter(Boolean).join(' ')
                return (
                  <button
                    key={idx}
                    type="button"
                    role="gridcell"
                    className={classes}
                    aria-label={`第 ${Math.floor(idx / snap.cols) + 1} 行第 ${(idx % snap.cols) + 1} 列，${gem.name}${selected === idx ? '，已选中' : ''}`}
                    aria-selected={selected === idx}
                    tabIndex={focusedIdx === idx ? 0 : -1}
                    onClick={() => activateCell(idx)}
                    onFocus={() => { focusRef.current = idx; setFocusedIdx(idx) }}
                  >
                    <span className={`m3-gem ${gem.cls}`} aria-hidden="true">{gem.glyph}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="m3-hint-bar">
            点选相邻宝石交换 · 方向键移动 · Enter/空格 选择或交换 · Esc 暂停
          </div>

          {/* 暂停遮罩 */}
          {screen === 'paused' && (
            <div className="m3-overlay">
              <div className="m3-overlay-card">
                <h3>⏸ 已暂停</h3>
                {pausedAuto && <p className="m3-paused-reason">已自动暂停（页面隐藏或窗口失焦），进度已保存</p>}
                <div className="m3-overlay-actions">
                  <button className="m3-btn m3-btn-primary big" onClick={handleResume}>继续挑战</button>
                  <button className="m3-btn" onClick={handleRestart}>重新开始</button>
                  <button className="m3-btn" onClick={handleMenu}>返回菜单</button>
                </div>
              </div>
            </div>
          )}

          {/* 结算遮罩 */}
          {screen === 'over' && finalInfo && (
            <div className="m3-overlay">
              <div className={`m3-overlay-card m3-overlay-${finalInfo.result}`}>
                <h3>{finalInfo.result === 'win' ? '🎉 目标达成！' : '💥 步数用尽'}</h3>
                <div className="m3-win-stats">
                  <div className="m3-win-big">{finalInfo.score}</div>
                  <div className="m3-win-sub">
                    目标 {finalInfo.target} · {LEVELS[finalInfo.level]?.label}
                    {' · '}交换 {finalInfo.swaps} 次 · 连锁 {finalInfo.cascades} 次
                    {' · '}最高 {finalInfo.maxCombo} 段
                  </div>
                </div>
                {best[finalInfo.level] && best[finalInfo.level].score === finalInfo.score && (
                  <p className="m3-new-record">新纪录！</p>
                )}
                <div className="m3-overlay-actions">
                  <button className="m3-btn m3-btn-primary big" onClick={handleRestart}>再来一局</button>
                  <button className="m3-btn" onClick={handleMenu}>返回菜单</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div aria-live="polite" aria-atomic="true" className="m3-sr-only">{liveAnnounce}</div>
    </div>
  )
}
