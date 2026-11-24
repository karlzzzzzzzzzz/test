import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import SlitherlinkEngine, { SLITHER, DIFFICULTY_LIST, validateSlitherlinkSave } from '../game/SlitherlinkEngine'
import './Slitherlink.css'

const SAVE_KEY = SLITHER.SAVE_KEY
const STATS_KEY = SLITHER.STATS_KEY
const DAILY_KEY = SLITHER.DAILY_CACHE_KEY
const SAVE_DEBOUNCE_MS = 800
const STAT_DEBOUNCE_MS = 1000

function fmtElapsed(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw || raw.length > SLITHER.SAVE_MAX_CHARS) {
      if (raw) localStorage.removeItem(SAVE_KEY); return null
    }
    const data = JSON.parse(raw)
    if (!validateSlitherlinkSave(data)) return null
    if (Date.now() - data.ts > SLITHER.SAVE_TTL_MS) {
      localStorage.removeItem(SAVE_KEY); return null
    }
    return data
  } catch { try { localStorage.removeItem(SAVE_KEY) } catch { /* ignore */ }; return null }
}

function loadStats() {
  const empty = { plays: 0, wins: 0, timeByLevel: {}, hintsUsed: 0, updatedAt: 0 }
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return empty
    return {
      plays: Math.max(0, Math.floor(Number(data.plays) || 0)),
      wins: Math.max(0, Math.floor(Number(data.wins) || 0)),
      timeByLevel: data.timeByLevel || {},
      hintsUsed: Math.max(0, Math.floor(Number(data.hintsUsed) || 0)),
      updatedAt: Number(data.updatedAt) || 0,
    }
  } catch { return empty }
}

function persistSnapshot(engine, elapsed) {
  try {
    const snap = engine.getSnapshot()
    snap.elapsed = Math.max(0, Math.floor(elapsed))
    const str = JSON.stringify(snap)
    if (str.length > SLITHER.SAVE_MAX_CHARS) return
    localStorage.setItem(SAVE_KEY, str)
  } catch { /* quota exceeded / privacy mode */ }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY) } catch { /* ignore */ }
}

export default function Slitherlink() {
  const [screen, setScreen] = useState('start') // start / playing / paused / over
  const [difficulty, setDifficulty] = useState('easy')
  const [engineState, setEngineState] = useState({ state: 'idle', moves: 0, hintLeft: SLITHER.MAX_HINT })
  const [elapsed, setElapsed] = useState(0)
  const [hasSave, setHasSave] = useState(null)
  const [stats, setStats] = useState(loadStats)
  const [wins, setWins] = useState({ time: 0, moves: 0 })
  const [apiNote, setApiNote] = useState('')

  const engineRef = useRef(null)
  const rafRef = useRef(null)
  const lastTsRef = useRef(0)
  const saveTimerRef = useRef(null)
  const statDirtyRef = useRef(false)
  const statTimerRef = useRef(null)
  const sessionSettledRef = useRef(false)
  const startTsRef = useRef(0)
  const focusEdgeRef = useRef(null) // keyboard focus current edge

  // ---- 初始化：尝试读取存档 ----
  useEffect(() => {
    const save = loadSaved()
    if (save) {
      const diffFromSave = Object.entries(SLITHER.DIFFICULTIES).find(([_, v]) => v.rows === save.rows && v.cols === save.cols)
      setHasSave({ ...save, difficulty: diffFromSave ? diffFromSave[0] : 'easy' })
      if (diffFromSave) setDifficulty(diffFromSave[0])
    }
  }, [])

  // ---- 每日关卡获取（timeapi.io + 降级） ----
  const fetchDailyLevel = useCallback(async () => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 6000)
      const res = await fetch('https://timeapi.io/api/Time/current/zone?timeZone=Asia/Shanghai', { signal: controller.signal })
      clearTimeout(timeout)
      if (!res.ok) throw new Error('bad status')
      const data = await res.json()
      return { date: data.date || new Date().toISOString().slice(0, 10), source: 'api' }
    } catch {
      return { date: new Date().toISOString().slice(0, 10), source: 'fallback' }
    }
  }, [])

  const startGame = useCallback(async (fromDaily = false) => {
    const dims = SLITHER.DIFFICULTIES[difficulty]
    engineRef.current?.dispose?.()
    const eng = new SlitherlinkEngine({
      difficulty,
      onState: (s) => setEngineState({ ...s }),
      onWin: ({ moves }) => {
        // 引擎内部已处理，页面 watch engineState.state
        clearSave()
        setWins((w) => ({ ...w, moves }))
      },
      onPause: () => { /* screen watch */ },
    })
    engineRef.current = eng

    // 每日关卡模式：API 取日期 + 本地降级关卡池
    if (fromDaily) {
      const daily = await fetchDailyLevel()
      const fb = SLITHER._fallbackLevels || []
      const pool = fb.filter((l) => l.rows === dims.rows && l.cols === dims.cols)
      const idx = Math.abs(hashString(daily.date)) % Math.max(1, pool.length)
      if (pool.length && pool[idx]) {
        eng.startFrom(pool[idx].clues)
        setApiNote(daily.source === 'api' ? '' : '今日关卡使用本地缓存')
      } else {
        eng.start()
      }
    } else {
      eng.start()
    }

    setElapsed(0)
    startTsRef.current = performance.now()
    lastTsRef.current = 0
    sessionSettledRef.current = false
    setScreen('playing')
  }, [difficulty, fetchDailyLevel])

  const resumeGame = useCallback(() => {
    const save = loadSaved()
    if (!save) return
    engineRef.current?.dispose?.()
    const eng = new SlitherlinkEngine({
      difficulty: save.difficulty || difficulty,
      onState: (s) => setEngineState({ ...s }),
      onWin: ({ moves }) => { clearSave(); setWins((w) => ({ ...w, moves })) },
    })
    engineRef.current = eng
    if (eng.restore(save)) {
      setDifficulty(save.difficulty || difficulty)
      setElapsed(save.elapsed || 0)
      setScreen('paused')
    }
  }, [difficulty])

  // ---- 主循环：rAF 计时 ----
  useEffect(() => {
    if (screen !== 'playing') { if (rafRef.current) cancelAnimationFrame(rafRef.current); return }
    const tick = (ts) => {
      if (!lastTsRef.current) lastTsRef.current = ts
      const dt = (ts - lastTsRef.current) / 1000
      lastTsRef.current = ts
      setElapsed((e) => Math.max(0, e + dt))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [screen])

  // ---- 通关检测 ----
  useEffect(() => {
    if (engineState.state === SLITHER.STATE.WON && screen === 'playing') {
      setWins((w) => ({ ...w, time: elapsed }))
      setScreen('over')
      // 结算存储 + 番茄钟
      try {
        const s = { plays: stats.plays + 1, wins: stats.wins + 1, timeByLevel: { ...stats.timeByLevel, [difficulty]: [...(stats.timeByLevel[difficulty] || []), Math.floor(elapsed)].slice(-10) }, hintsUsed: stats.hintsUsed, updatedAt: Date.now() }
        statDirtyRef.current = true
        statTimerRef.current && clearTimeout(statTimerRef.current)
        statTimerRef.current = setTimeout(() => { try { localStorage.setItem(STATS_KEY, JSON.stringify({ ...s, updatedAt: Date.now() })) } catch { /* ignore */ } }, STAT_DEBOUNCE_MS)
        // 番茄钟
        if (!sessionSettledRef.current && elapsed >= SLITHER.POMODORO_MIN) {
          sessionSettledRef.current = true
          try {
            const raw = localStorage.getItem('pomodoro-sessions-v1')
            const arr = raw ? JSON.parse(raw) : []
            arr.push({ startTs: Date.now() - Math.floor(elapsed) * 1000, endTs: Date.now(), durSec: Math.floor(elapsed), game: 'slitherlink', win: true, level: difficulty, mode: 'focus' })
            const cutoff = Date.now() - 14 * 86400000
            const trimmed = arr.filter((s) => s.endTs > cutoff)
            localStorage.setItem('pomodoro-sessions-v1', JSON.stringify(trimmed))
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      clearSave()
    }
  }, [engineState.state, screen, elapsed, stats, difficulty])

  // ---- 自动保存（防抖） ----
  useEffect(() => {
    if (screen !== 'playing' || !engineRef.current) return
    statDirtyRef.current = true
    saveTimerRef.current && clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { persistSnapshot(engineRef.current, elapsed) }, SAVE_DEBOUNCE_MS)
    return () => { saveTimerRef.current && clearTimeout(saveTimerRef.current) }
  }, [engineState.moves, engineState.hintLeft, elapsed, screen])

  // ---- pagehide 冲刷统计 ----
  useEffect(() => {
    const flush = () => {
      if (statDirtyRef.current) {
        // 简化：直接读取写回当前累计
        try {
          const raw = localStorage.getItem(STATS_KEY)
          if (raw) localStorage.setItem(STATS_KEY, raw)
        } catch { /* ignore */ }
      }
      if (engineRef.current && engineState.state === SLITHER.STATE.PLAYING) {
        engineRef.current.pause()
      }
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [engineState.state])

  // ---- 双路自动暂停 ----
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && engineRef.current && engineState.state === SLITHER.STATE.PLAYING) {
        engineRef.current.pause(); setScreen('paused')
      }
    }
    const onBlur = () => {
      if (engineRef.current && engineState.state === SLITHER.STATE.PLAYING) {
        engineRef.current.pause(); setScreen('paused')
      }
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', onBlur)
    }
  }, [engineState.state])

  const handleToggleEdge = (idx) => { engineRef.current?.toggleEdge(idx) }
  const handleUndo = () => { engineRef.current?.undo() }
  const handleHint = () => { engineRef.current?.hint() }
  const handleClear = () => { engineRef.current?.clear() }
  const handlePause = () => { if (engineState.state === SLITHER.STATE.PLAYING) { engineRef.current?.pause(); setScreen('paused') } }
  const handleResume = () => {
    if (engineRef.current && engineState.state === SLITHER.STATE.PAUSED) {
      engineRef.current.resume(); setScreen('playing'); lastTsRef.current = 0
    }
  }
  const handleRestart = () => { startGame(false) }
  const handleBackToStart = () => {
    clearSave()
    setScreen('start')
    engineRef.current?.dispose?.(); engineRef.current = null
    setElapsed(0)
  }

  // ---- 键盘 ----
  useEffect(() => {
    if (screen !== 'playing') return
    const onKey = (e) => {
      if (e.key === 'Escape') { handlePause(); return }
      if (e.key === 'r' || e.key === 'R') { handleRestart(); return }
      if (e.key === 'z' || e.key === 'Z') { handleUndo(); return }
      if (e.key === 'h' || e.key === 'H') { handleHint(); return }
      if (e.key === ' ' || e.key === 'Spacebar') { handlePause(); return }
      if (e.key === 'Enter' || e.key === 'x' || e.key === 'X') { /* 三态由 focusEdgeRef 决定 */ }
      // 方向键移动焦点边
      const dims = SLITHER.DIFFICULTIES[difficulty]
      const totalV = dims.rows * (dims.cols + 1)
      const totalH = dims.cols * (dims.rows + 1)
      const totalE = totalV + totalH
      if (!focusEdgeRef.current) focusEdgeRef.current = 0
      if (e.key === 'ArrowRight') focusEdgeRef.current = (focusEdgeRef.current + 1) % totalE
      if (e.key === 'ArrowLeft') focusEdgeRef.current = (focusEdgeRef.current - 1 + totalE) % totalE
      if (e.key === 'ArrowDown') focusEdgeRef.current = (focusEdgeRef.current + Math.max(1, dims.cols + 1)) % totalE
      if (e.key === 'ArrowUp') focusEdgeRef.current = (focusEdgeRef.current - Math.max(1, dims.cols + 1) + totalE) % totalE
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); engineRef.current?.toggleEdge(focusEdgeRef.current) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen, difficulty]) // eslint-disable-line react-hooks/exhaustive-deps

  const dims = SLITHER.DIFFICULTIES[difficulty]
  const rows = engineRef.current?.rows ?? dims.rows
  const cols = engineRef.current?.cols ?? dims.cols
  const edges = engineRef.current?.edges ?? []
  const clues = engineRef.current?.clues ?? []
  const conflicts = engineRef.current?.getConflicts?.() ?? []
  const conflictSet = new Set(conflicts.map((c) => `${c.r},${c.c}`))

  return (
    <div className="slitherlink-wrap">
      <header className="slitherlink-header">
        <Link to="/" className="slitherlink-back">← 返回首页</Link>
        <h1>数回 · Slitherlink</h1>
      </header>

      {/* 开始屏 */}
      {screen === 'start' && (
        <div className="slitherlink-start">
          <h2>点阵网格逻辑谜题</h2>
          <p className="slitherlink-rule">
            每格的数字表示它周围 4 条边中有几条被画。所有画的边必须形成唯一闭合环（连通、每端点度数=2）。
            空格 = 不限。点击边三态切换：无画 → 画边 → 否定。
          </p>
          {hasSave && (
            <div className="slitherlink-save-card">
              <span>发现未完成对局（{SLITHER.DIFFICULTIES[hasSave.difficulty || 'easy'].label}，已用 {fmtElapsed(hasSave.elapsed)}）</span>
              <button onClick={resumeGame}>继续上次</button>
              <button onClick={() => { clearSave(); setHasSave(null) }}>放弃</button>
            </div>
          )}
          <div className="slitherlink-diff">
            {DIFFICULTY_LIST.map((d) => (
              <label key={d} className={difficulty === d ? 'active' : ''}>
                <input type="radio" name="diff" checked={difficulty === d} onChange={() => setDifficulty(d)} />
                {SLITHER.DIFFICULTIES[d].label}
              </label>
            ))}
          </div>
          <div className="slitherlink-start-btns">
            <button className="slitherlink-primary" onClick={() => startGame(false)}>开始游戏</button>
            <button onClick={() => startGame(true)}>今日关卡</button>
          </div>
          <div className="slitherlink-hint">
            <p>键盘：方向键移动焦点 · Enter 画边 · X 否定 · Z 撤销 · H 提示 · R 重开 · Esc 暂停</p>
            <p>最佳记录：</p>
            <ul>
              {DIFFICULTY_LIST.map((d) => {
                const arr = stats.timeByLevel[d] || []
                const best = arr.length ? Math.min(...arr) : null
                return <li key={d}>{SLITHER.DIFFICULTIES[d].label}：{best ? fmtElapsed(best) : '暂无'}</li>
              })}
            </ul>
          </div>
        </div>
      )}

      {/* 游戏屏 */}
      {(screen === 'playing' || screen === 'paused' || screen === 'over') && (
        <>
          <div className="slitherlink-hud">
            <span className="hud-label">难度</span><span>{SLITHER.DIFFICULTIES[difficulty].label}</span>
            <span className="hud-label">用时</span><span>{fmtElapsed(elapsed)}</span>
            <span className="hud-label">步数</span><span>{engineState.moves}</span>
            <span className="hud-label">提示</span><span>{engineState.hintLeft}/{SLITHER.MAX_HINT}</span>
          </div>

          {apiNote && <div className="slitherlink-api-note">{apiNote}</div>}

          <SlitherlinkBoard
            rows={rows} cols={cols} edges={edges} clues={clues}
            conflicts={conflictSet} onToggle={handleToggleEdge}
            focusEdge={focusEdgeRef.current}
          />

          <div className="slitherlink-actions">
            <button onClick={handleUndo} disabled={!engineState.moves}>撤销 (Z)</button>
            <button onClick={handleHint} disabled={engineState.hintLeft <= 0}>提示 (H)</button>
            <button onClick={handleClear}>清空</button>
            {screen === 'playing' && <button onClick={handlePause}>暂停 (Esc)</button>}
            <button onClick={handleRestart}>重开 (R)</button>
            <button onClick={handleBackToStart}>返回菜单</button>
          </div>
        </>
      )}

      {/* 暂停遮罩 */}
      {screen === 'paused' && (
        <div className="slitherlink-overlay">
          <div className="slitherlink-overlay-card">
            <h3>已暂停</h3>
            <button onClick={handleResume} className="slitherlink-primary">继续</button>
            <button onClick={handleBackToStart}>放弃并返回菜单</button>
          </div>
        </div>
      )}

      {/* 通关遮罩 */}
      {screen === 'over' && (
        <div className="slitherlink-overlay">
          <div className="slitherlink-overlay-card">
            <h3>完成！</h3>
            <p>用时 {fmtElapsed(wins.time)}，步数 {wins.moves}</p>
            <p>难度 {SLITHER.DIFFICULTIES[difficulty].label} · 第 {stats.wins + 1} 次通关</p>
            <button onClick={() => startGame(false)} className="slitherlink-primary">再来一局</button>
            <button onClick={handleBackToStart}>返回菜单</button>
          </div>
        </div>
      )}

      {/* aria-live */}
      <div aria-live="polite" className="sr-only">
        {screen === 'playing' ? `游戏中，步数 ${engineState.moves}，提示 ${engineState.hintLeft}` : ''}
        {screen === 'over' ? `通关！用时 ${fmtElapsed(wins.time)} 秒，步数 ${wins.moves}` : ''}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// SVG 棋盘渲染
// --------------------------------------------------------------------------

function SlitherlinkBoard({ rows, cols, edges, clues, conflicts, onToggle, focusEdge }) {
  // SVG viewBox 让点阵居中。每格 cell 32px（9×9 时 288px，320px 视口也够）
  const CELL = Math.max(24, Math.min(36, 288 / Math.max(rows, cols)))
  const PAD = CELL // 外边距
  const W = cols * CELL + PAD * 2
  const H = rows * CELL + PAD * 2

  const points = []
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      points.push({ r, c, x: PAD + c * CELL, y: PAD + r * CELL })
    }
  }

  // 纵向边：(r,c)-(r+1,c)，索引 r*(cols+1)+c
  const vertEdges = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const idx = r * (cols + 1) + c
      const x = PAD + c * CELL
      const y1 = PAD + r * CELL, y2 = y1 + CELL
      vertEdges.push({ idx, x, y1, y2, state: edges[idx] ?? 0 })
    }
  }
  // 横向边：(r,c)-(r,c+1)
  const hOff = rows * (cols + 1)
  const horiEdges = []
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      // engine: idx = rows*(cols+1) + c*(rows+1) + r
      const idx = rows * (cols + 1) + c * (rows + 1) + r
      const y = PAD + r * CELL
      const x1 = PAD + c * CELL, x2 = x1 + CELL
      horiEdges.push({ idx, y, x1, x2, state: edges[idx] ?? 0 })
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="slitherlink-board" role="img" aria-label="数回棋盘">
      {/* clue 格子 */}
      {clues.map((row, r) => row.map((v, c) => {
        if (v === null) return null
        const conflict = conflicts.has(`${r},${c}`)
        const cx = PAD + c * CELL + CELL / 2
        const cy = PAD + r * CELL + CELL / 2
        return (
          <g key={`cell-${r}-${c}`} className={conflict ? 'slitherlink-conflict' : ''}>
            <rect x={PAD + c * CELL} y={PAD + r * CELL} width={CELL} height={CELL}
                  fill="none" stroke="rgba(0,0,0,0.06)" />
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                  fontSize={Math.floor(CELL * 0.45)} fontWeight="700">
              {v}
            </text>
          </g>
        )
      }))}

      {/* 纵向边（点击覆盖层 + 可视化） */}
      {vertEdges.map((e) => (
        <EdgeSegment key={`v-${e.idx}`} orient="v" {...e} onClick={() => onToggle(e.idx)}
                     focused={focusEdge === e.idx} />
      ))}
      {/* 横向边 */}
      {horiEdges.map((e) => (
        <EdgeSegment key={`h-${e.idx}`} orient="h" {...e} onClick={() => onToggle(e.idx)}
                     focused={focusEdge === e.idx} />
      ))}

      {/* 点阵圆点（最后画，覆盖在边之上） */}
      {points.map((p) => (
        <circle key={`p-${p.r}-${p.c}`} cx={p.x} cy={p.y} r={Math.max(2, CELL * 0.08)}
                fill="#444" />
      ))}
    </svg>
  )
}

function EdgeSegment({ orient, state, onClick, focused, ...pos }) {
  let stroke = '#bbb', width = 1
  if (state === 1) { stroke = '#111'; width = Math.max(2, 3) }
  if (state === 2) { stroke = '#d33'; width = 1 }

  const thickness = 12 // 点击热区宽度
  const isV = orient === 'v'
  const cx = isV ? pos.x : (pos.x1 + pos.x2) / 2
  const cy = isV ? (pos.y1 + pos.y2) / 2 : pos.y
  const x1 = isV ? pos.x : pos.x1, x2 = isV ? pos.x : pos.x2
  const y1 = isV ? pos.y1 : pos.y, y2 = isV ? pos.y2 : pos.y

  return (
    <g>
      {/* 点击覆盖（透明粗条） */}
      <line x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="transparent" strokeWidth={thickness}
            style={{ cursor: 'pointer' }} onClick={onClick}
            tabIndex={-1} />
      {/* 可视化线段 */}
      <line x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={stroke} strokeWidth={width}
            strokeDasharray={state === 2 ? '4 3' : undefined} />
      {/* 否定态 × 标记 */}
      {state === 2 && (
        <g stroke="#d33" strokeWidth="1.5" strokeLinecap="round">
          <line x1={cx - 4} y1={cy - 4} x2={cx + 4} y2={cy + 4} />
          <line x1={cx + 4} y1={cy - 4} x2={cx - 4} y2={cy + 4} />
        </g>
      )}
      {focused && (
        <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="#4d7cff" strokeWidth={width + 2}
              strokeDasharray="2 2" />
      )}
    </g>
  )
}

function hashString(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
