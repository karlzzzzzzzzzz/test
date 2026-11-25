import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import TicTacToeEngine, { TTT, validateTTTSave } from '../game/TicTacToeEngine'
import './TicTacToe.css'

const SAVE_KEY = TTT.SAVE_KEY
const STATS_KEY = TTT.STATS_KEY
const SAVE_DEBOUNCE_MS = 800
const STAT_DEBOUNCE_MS = 1000

function fmtElapsed(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw || raw.length > TTT.SAVE_MAX_CHARS) { if (raw) localStorage.removeItem(SAVE_KEY); return null }
    const data = JSON.parse(raw)
    if (!validateTTTSave(data)) return null
    if (Date.now() - data.ts > TTT.SAVE_TTL_MS) { localStorage.removeItem(SAVE_KEY); return null }
    return data
  } catch { try { localStorage.removeItem(SAVE_KEY) } catch { /* ignore */ }; return null }
}

function loadStats() {
  const empty = { plays: 0, wins: 0, losses: 0, draws: 0, updatedAt: 0 }
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return empty
    return {
      plays: Math.max(0, Math.floor(Number(data.plays) || 0)),
      wins: Math.max(0, Math.floor(Number(data.wins) || 0)),
      losses: Math.max(0, Math.floor(Number(data.losses) || 0)),
      draws: Math.max(0, Math.floor(Number(data.draws) || 0)),
      updatedAt: Number(data.updatedAt) || 0,
    }
  } catch { return empty }
}

function persistSnapshot(engine, elapsed) {
  try {
    const snap = engine.getSnapshot()
    snap.elapsed = Math.max(0, Math.floor(elapsed))
    const str = JSON.stringify(snap)
    if (str.length > TTT.SAVE_MAX_CHARS) return
    localStorage.setItem(SAVE_KEY, str)
  } catch { /* quota/privacy */ }
}

function clearSave() { try { localStorage.removeItem(SAVE_KEY) } catch { /* ignore */ } }

export default function TicTacToe() {
  const [screen, setScreen] = useState('start')
  const [size, setSize] = useState(3)
  const [difficulty, setDifficulty] = useState('hard')
  const [playerSide, setPlayerSide] = useState('X')
  const [engineState, setEngineState] = useState({ state: 'idle', current: 'X', moves: 0, aiThinking: false })
  const [elapsed, setElapsed] = useState(0)
  const [hasSave, setHasSave] = useState(null)
  const [stats, setStats] = useState(loadStats)
  const [overInfo, setOverInfo] = useState(null)

  const engineRef = useRef(null)
  const rafRef = useRef(null)
  const lastTsRef = useRef(0)
  const saveTimerRef = useRef(null)
  const statDirtyRef = useRef(false)
  const statTimerRef = useRef(null)
  const sessionSettledRef = useRef(false)
  const focusCellRef = useRef(null)

  useEffect(() => {
    const save = loadSaved()
    if (save) {
      setHasSave(save)
      if (save.size === 3 || save.size === 4) setSize(save.size)
      if (save.difficulty) setDifficulty(save.difficulty)
      if (save.playerSide) setPlayerSide(save.playerSide)
    }
  }, [])

  const startGame = useCallback(() => {
    engineRef.current?.dispose?.()
    const eng = new TicTacToeEngine({
      size, difficulty, playerSide,
      onState: (s) => setEngineState({ ...s }),
      onGameOver: (info) => {
        // 通关处理：引擎内部，页面 watch engineState.state
        clearSave()
        setOverInfo(info)
      },
      onPause: () => {},
    })
    engineRef.current = eng
    eng.start()
    setElapsed(0)
    sessionSettledRef.current = false
    setOverInfo(null)
    setScreen('playing')
    // 设置焦点到初始 cell
    focusCellRef.current = '0,0'
  }, [size, difficulty, playerSide])

  const resumeGame = useCallback(() => {
    const save = loadSaved()
    if (!save) return
    engineRef.current?.dispose?.()
    const eng = new TicTacToeEngine({
      size: save.size, difficulty: save.difficulty, playerSide: save.playerSide,
      onState: (s) => setEngineState({ ...s }),
      onGameOver: () => clearSave(),
    })
    engineRef.current = eng
    if (eng.restore(save)) {
      setScreen('paused')
      setElapsed(save.elapsed || 0)
    }
  }, [])

  // ---- 主循环 ----
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

  // ---- 存档防抖 ----
  useEffect(() => {
    if (screen !== 'playing' || !engineRef.current) return
    statDirtyRef.current = true
    saveTimerRef.current && clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { persistSnapshot(engineRef.current, elapsed) }, SAVE_DEBOUNCE_MS)
    return () => { saveTimerRef.current && clearTimeout(saveTimerRef.current) }
  }, [engineState.moves, elapsed, screen])

  // ---- pagehide ----
  useEffect(() => {
    const flush = () => {
      if (engineRef.current && engineState.state === TTT.STATE.PLAYING) {
        engineRef.current.pause()
      }
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [engineState.state])

  // ---- 自动暂停 ----
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && engineRef.current && engineState.state === TTT.STATE.PLAYING) {
        engineRef.current.pause(); setScreen('paused')
      }
    }
    const onBlur = () => {
      if (engineRef.current && engineState.state === TTT.STATE.PLAYING) {
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

  // ---- 通关检测 ----
  useEffect(() => {
    if ((engineState.state === TTT.STATE.WON || engineState.state === TTT.STATE.DRAW) && screen === 'playing') {
      clearSave()
      setScreen('over')
      // 统计 + 番茄钟
      try {
        const isWin = overInfo?.winForHuman
        const s = {
          plays: stats.plays + 1,
          wins: stats.wins + (isWin ? 1 : 0),
          losses: stats.losses + (isWin === false && engineState.state === TTT.STATE.WON ? 1 : 0),
          draws: stats.draws + (engineState.state === TTT.STATE.DRAW ? 1 : 0),
          updatedAt: Date.now(),
        }
        localStorage.setItem(STATS_KEY, JSON.stringify(s))
        setStats(s)
        if (!sessionSettledRef.current && elapsed >= TTT.POMODORO_MIN) {
          sessionSettledRef.current = true
          try {
            const raw = localStorage.getItem('pomodoro-sessions-v1')
            const arr = raw ? JSON.parse(raw) : []
            arr.push({ startTs: Date.now() - Math.floor(elapsed) * 1000, endTs: Date.now(), durSec: Math.floor(elapsed), game: 'tic-tac-toe', win: !!isWin, level: difficulty, mode: 'focus' })
            const cutoff = Date.now() - 14 * 86400000
            localStorage.setItem('pomodoro-sessions-v1', JSON.stringify(arr.filter((x) => x.endTs > cutoff)))
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }
  }, [engineState.state, screen]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlay = (r, c) => { engineRef.current?.play(r, c) }
  const handleUndo = () => { engineRef.current?.undo() }
  const handlePause = () => { if (engineState.state === TTT.STATE.PLAYING) { engineRef.current?.pause(); setScreen('paused') } }
  const handleResume = () => { if (engineState.state === TTT.STATE.PAUSED) { engineRef.current?.resume(); setScreen('playing'); lastTsRef.current = 0 } }
  const handleRestart = () => { startGame() }
  const handleBack = () => {
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
      const total = size * size
      if (!focusCellRef.current) focusCellRef.current = '0,0'
      let [r, c] = focusCellRef.current.split(',').map(Number)
      if (e.key === 'ArrowRight') c = Math.min(size - 1, c + 1)
      if (e.key === 'ArrowLeft') c = Math.max(0, c - 1)
      if (e.key === 'ArrowDown') r = Math.min(size - 1, r + 1)
      if (e.key === 'ArrowUp') r = Math.max(0, r - 1)
      focusCellRef.current = `${r},${c}`
      if ((e.key === 'Enter' || e.key === ' ') && !engineState.aiThinking) { e.preventDefault(); handlePlay(r, c) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen, size, engineState.aiThinking]) // eslint-disable-line

  const board = engineRef.current?.board || Array.from({ length: size }, () => Array(size).fill(null))
  const winLine = overInfo?.winLine || null

  return (
    <div className="ttt-wrap">
      <header className="ttt-header">
        <Link to="/" className="ttt-back">← 返回首页</Link>
        <h1>井字棋 · Tic-Tac-Toe</h1>
      </header>

      {screen === 'start' && (
        <div className="ttt-start">
          <h2>人机对战</h2>
          <p className="ttt-rule">
            回合制三连线即胜；先手 X。AI 难度：简单（随机）/ 中等（Minimax + 10% 破绽）/ 困难（Minimax 全胜率）。
          </p>
          {hasSave && (
            <div className="ttt-save-card">
              <span>发现未完成对局（{hasSave.size}×{hasSave.size}，{TTT.DIFFICULTIES[hasSave.difficulty]?.label || ''}）</span>
              <button onClick={resumeGame}>继续上次</button>
              <button onClick={() => { clearSave(); setHasSave(null) }}>放弃</button>
            </div>
          )}
          <div className="ttt-options">
            <div className="ttt-option-group">
              <label>棋盘尺寸</label>
              <div className="ttt-option-btns">
                <button className={size === 3 ? 'active' : ''} onClick={() => setSize(3)}>3×3</button>
                <button className={size === 4 ? 'active' : ''} onClick={() => setSize(4)}>4×4</button>
              </div>
            </div>
            <div className="ttt-option-group">
              <label>AI 难度</label>
              <div className="ttt-option-btns">
                {Object.entries(TTT.DIFFICULTIES).map(([k, v]) => (
                  <button key={k} className={difficulty === k ? 'active' : ''} onClick={() => setDifficulty(k)}>{v.label}</button>
                ))}
              </div>
            </div>
            <div className="ttt-option-group">
              <label>玩家标记</label>
              <div className="ttt-option-btns">
                <button className={playerSide === 'X' ? 'active' : ''} onClick={() => setPlayerSide('X')}>X（先手）</button>
                <button className={playerSide === 'O' ? 'active' : ''} onClick={() => setPlayerSide('O')}>O（后手）</button>
              </div>
            </div>
          </div>
          <button className="ttt-primary" onClick={startGame}>开始游戏</button>
          <div className="ttt-hint">
            <p>键盘：方向键移动焦点 · Enter 落子 · Z 撤销 · R 重开 · Esc 暂停</p>
            <p>累计：{stats.plays} 局 · 胜 {stats.wins} · 负 {stats.losses} · 平 {stats.draws}</p>
          </div>
        </div>
      )}

      {(screen === 'playing' || screen === 'paused' || screen === 'over') && (
        <>
          <div className="ttt-hud">
            <span className="hud-label">回合</span><span>{engineState.current} {engineState.aiThinking && '（AI 思考中…）'}</span>
            <span className="hud-label">用时</span><span>{fmtElapsed(elapsed)}</span>
            <span className="hud-label">步数</span><span>{engineState.moves}</span>
            <span className="hud-label">难度</span><span>{TTT.DIFFICULTIES[difficulty]?.label?.split('（')[0]}</span>
          </div>

          <TicTacToeBoard
            size={size}
            board={board}
            winLine={winLine}
            onPlay={handlePlay}
            focusCell={focusCellRef.current}
            disabled={engineState.aiThinking || engineState.state !== TTT.STATE.PLAYING}
          />

          <div className="ttt-actions">
            <button onClick={handleUndo}>撤销 (Z)</button>
            {screen === 'playing' && <button onClick={handlePause}>暂停 (Esc)</button>}
            <button onClick={handleRestart}>重开 (R)</button>
            <button onClick={handleBack}>返回菜单</button>
          </div>
        </>
      )}

      {screen === 'paused' && (
        <div className="ttt-overlay">
          <div className="ttt-overlay-card">
            <h3>已暂停</h3>
            <button onClick={handleResume} className="ttt-primary">继续</button>
            <button onClick={handleBack}>放弃并返回菜单</button>
          </div>
        </div>
      )}

      {screen === 'over' && overInfo && (
        <div className="ttt-overlay">
          <div className="ttt-overlay-card">
            <h3>{overInfo.reason === 'draw' ? '平局' : overInfo.winForHuman ? '胜利！' : '失败'}</h3>
            <p>用时 {fmtElapsed(elapsed)}，步数 {overInfo.moves}</p>
            <button onClick={() => startGame()} className="ttt-primary">再来一局</button>
            <button onClick={handleBack}>返回菜单</button>
          </div>
        </div>
      )}

      <div aria-live="polite" className="sr-only">
        {screen === 'playing' ? `回合 ${engineState.current}，步数 ${engineState.moves}` : ''}
        {screen === 'over' && overInfo?.reason === 'draw' ? '平局' : ''}
        {screen === 'over' && overInfo?.winner ? `${overInfo.winner} 获胜` : ''}
      </div>
    </div>
  )
}

// ---- 棋盘 ----

function TicTacToeBoard({ size, board, winLine, onPlay, focusCell, disabled }) {
  const cellStyle = {
    gridTemplateColumns: `repeat(${size}, 1fr)`,
    aspectRatio: '1',
    width: '100%',
    maxWidth: size === 3 ? 320 : 400,
  }

  const winSet = winLine ? new Set(winLine.map(([r, c]) => `${r},${c}`)) : new Set()

  return (
    <div className="ttt-board" style={cellStyle} role="grid" aria-label={`井字棋棋盘 ${size}×${size}`}>
      {board.map((row, r) =>
        row.map((cell, c) => {
          const key = `${r},${c}`
          const isWin = winSet.has(key)
          const isFocus = focusCell === key
          return (
            <button
              key={key}
              role="gridcell"
              tabIndex={isFocus ? 0 : -1}
              className={`ttt-cell ${cell ? 'ttt-filled' : ''} ${isWin ? 'ttt-win' : ''} ${isFocus ? 'ttt-focus' : ''}`}
              onClick={() => !disabled && !cell && onPlay(r, c)}
              disabled={disabled || !!cell}
              aria-label={`格子 第${r + 1}行 第${c + 1}列${cell ? ' 已填 ' + cell : ' 空'}`}
            >
              <span className={`ttt-mark ttt-mark-${cell}`}>{cell}</span>
            </button>
          )
        })
      )}
    </div>
  )
}
