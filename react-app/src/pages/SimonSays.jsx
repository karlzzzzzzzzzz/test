import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import SimonSaysEngine, { SIMON, validateSimonSave } from '../game/SimonSaysEngine'
import './SimonSays.css'

const PADS = [
  { id: 0, name: '红', freq: 329.63, cls: 'simon-pad-red' },
  { id: 1, name: '绿', freq: 392.0, cls: 'simon-pad-green' },
  { id: 2, name: '蓝', freq: 440.0, cls: 'simon-pad-blue' },
  { id: 3, name: '黄', freq: 523.25, cls: 'simon-pad-yellow' },
]

const SAVE_DEBOUNCE_MS = 800
const STAT_DEBOUNCE_MS = 1000

function fmtElapsed(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(SIMON.SAVE_KEY)
    if (!raw || raw.length > SIMON.SAVE_MAX_CHARS) {
      if (raw) localStorage.removeItem(SIMON.SAVE_KEY)
      return null
    }
    const data = JSON.parse(raw)
    if (!validateSimonSave(data)) return null
    if (Date.now() - data.ts > SIMON.SAVE_TTL_MS) {
      localStorage.removeItem(SIMON.SAVE_KEY)
      return null
    }
    return data
  } catch {
    try { localStorage.removeItem(SIMON.SAVE_KEY) } catch { /* ignore */ }
    return null
  }
}

function loadBest() {
  try {
    const data = JSON.parse(localStorage.getItem(SIMON.BEST_KEY) || 'null')
    if (!data || typeof data !== 'object') return { bestRound: 0, date: '' }
    return { bestRound: Math.max(0, Math.floor(Number(data.bestRound) || 0)), date: String(data.date || '') }
  } catch {
    return { bestRound: 0, date: '' }
  }
}

function loadStats() {
  const empty = { plays: 0, gamesOver: 0, bestRound: 0, totalRounds: 0, wrongPresses: 0, updatedAt: 0 }
  try {
    const data = JSON.parse(localStorage.getItem(SIMON.STATS_KEY) || 'null')
    if (!data || typeof data !== 'object') return empty
    const num = (v) => Math.max(0, Math.floor(Number(v) || 0))
    return {
      plays: num(data.plays),
      gamesOver: num(data.gamesOver),
      bestRound: num(data.bestRound),
      totalRounds: num(data.totalRounds),
      wrongPresses: num(data.wrongPresses),
      updatedAt: num(data.updatedAt),
    }
  } catch {
    return empty
  }
}

function loadSettings() {
  try {
    const data = JSON.parse(localStorage.getItem(SIMON.SETTINGS_KEY) || 'null')
    return { sound: !!(data && data.sound) }
  } catch {
    return { sound: false }
  }
}

function clearSave() {
  try { localStorage.removeItem(SIMON.SAVE_KEY) } catch { /* ignore */ }
}

export default function SimonSays() {
  const [engineState, setEngineState] = useState({ state: SIMON.STATE.IDLE, round: 1, lives: SIMON.LIVES, inputIndex: 0, flash: null, seqLen: 1 })
  const [elapsed, setElapsed] = useState(0)
  const [hasSave, setHasSave] = useState(null)
  const [best, setBest] = useState(loadBest)
  const [stats, setStats] = useState(loadStats)
  const [settings, setSettings] = useState(loadSettings)
  const [overInfo, setOverInfo] = useState(null)
  const [note, setNote] = useState('')

  const engineRef = useRef(null)
  const rafRef = useRef(null)
  const lastTsRef = useRef(0)
  const saveTimerRef = useRef(null)
  const statDirtyRef = useRef(false)
  const statTimerRef = useRef(null)
  const sessionSettledRef = useRef(false)
  const wrongRef = useRef(0)
  const audioRef = useRef(null)

  const screen = useMemo(() => {
    const s = engineState.state
    if (s === SIMON.STATE.SHOWING || s === SIMON.STATE.INPUT) return 'playing'
    if (s === SIMON.STATE.PAUSED) return 'paused'
    if (s === SIMON.STATE.OVER) return 'over'
    return 'start'
  }, [engineState.state])

  useEffect(() => {
    const save = loadSaved()
    if (save) setHasSave(save)
  }, [])

  // ---- 音效 ----
  const playTone = useCallback((pad) => {
    if (!settings.sound) return
    try {
      if (!audioRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext
        if (!Ctx) return
        audioRef.current = new Ctx()
      }
      const ctx = audioRef.current
      if (ctx.state === 'suspended') ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = PADS[pad]?.freq || 440
      gain.gain.setValueAtTime(0.06, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22)
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.24)
    } catch { /* 音频不可用静默降级 */ }
  }, [settings.sound])

  // 回放高亮时出声
  useEffect(() => {
    if (engineState.flash !== null && engineState.flash !== undefined) playTone(engineState.flash)
  }, [engineState.flash, playTone])

  useEffect(() => () => { try { audioRef.current?.close() } catch { /* ignore */ } }, [])

  // ---- 开局 ----
  const startGame = useCallback(() => {
    engineRef.current?.dispose?.()
    const eng = new SimonSaysEngine({
      onState: (s) => setEngineState({ ...s }),
      onGameOver: ({ round }) => {
        clearSave()
        setOverInfo({ round })
      },
    })
    engineRef.current = eng
    eng.start()
    wrongRef.current = 0
    setElapsed(0)
    setOverInfo(null)
    lastTsRef.current = 0
    sessionSettledRef.current = false
    setNote('')
    setStats((prev) => {
      const next = { ...prev, plays: prev.plays + 1, updatedAt: Date.now() }
      try { localStorage.setItem(SIMON.STATS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const resumeGame = useCallback(() => {
    const save = loadSaved()
    if (!save) return
    engineRef.current?.dispose?.()
    const eng = new SimonSaysEngine({
      onState: (s) => setEngineState({ ...s }),
      onGameOver: ({ round }) => { clearSave(); setOverInfo({ round }) },
    })
    engineRef.current = eng
    if (eng.restore(save)) {
      setElapsed(save.elapsed || 0)
      wrongRef.current = 0
      sessionSettledRef.current = false
      lastTsRef.current = 0
    }
  }, [])

  // ---- 主循环：rAF 驱动引擎回放 + 计时 ----
  useEffect(() => {
    if (screen !== 'playing') {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }
    const tick = (ts) => {
      if (!lastTsRef.current) lastTsRef.current = ts
      const dt = ts - lastTsRef.current
      lastTsRef.current = ts
      engineRef.current?.tick(dt)
      setElapsed((e) => Math.max(0, e + dt / 1000))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [screen])

  // ---- 存档防抖 ----
  useEffect(() => {
    if (screen !== 'playing' && screen !== 'paused') return
    const eng = engineRef.current
    if (!eng) return
    saveTimerRef.current && clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      try {
        const snap = eng.getSnapshot()
        snap.elapsed = Math.max(0, Math.floor(elapsed))
        const str = JSON.stringify(snap)
        if (str.length <= SIMON.SAVE_MAX_CHARS) localStorage.setItem(SIMON.SAVE_KEY, str)
      } catch { /* ignore */ }
    }, SAVE_DEBOUNCE_MS)
    return () => { saveTimerRef.current && clearTimeout(saveTimerRef.current) }
  }, [engineState.round, engineState.lives, screen, elapsed])

  // ---- 结束结算：最佳记录 / 埋点 / 番茄钟 ----
  useEffect(() => {
    if (screen !== 'over' || !overInfo) return
    const round = overInfo.round
    // 最佳
    setBest((prev) => {
      if (round > prev.bestRound) {
        const next = { bestRound: round, date: new Date().toISOString().slice(0, 10) }
        try { localStorage.setItem(SIMON.BEST_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        return next
      }
      return prev
    })
    // 埋点
    setStats((prev) => {
      const next = {
        ...prev,
        gamesOver: prev.gamesOver + 1,
        bestRound: Math.max(prev.bestRound, round),
        totalRounds: prev.totalRounds + Math.max(0, round - 1),
        wrongPresses: prev.wrongPresses + wrongRef.current,
        updatedAt: Date.now(),
      }
      statDirtyRef.current = true
      statTimerRef.current && clearTimeout(statTimerRef.current)
      statTimerRef.current = setTimeout(() => {
        try { localStorage.setItem(SIMON.STATS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        statDirtyRef.current = false
      }, STAT_DEBOUNCE_MS)
      return next
    })
    // 番茄钟
    if (!sessionSettledRef.current && elapsed >= SIMON.POMODORO_MIN) {
      sessionSettledRef.current = true
      try {
        const arr = JSON.parse(localStorage.getItem('pomodoro-sessions-v1') || '[]')
        arr.push({
          startTs: Date.now() - Math.floor(elapsed) * 1000,
          endTs: Date.now(),
          durSec: Math.floor(elapsed),
          game: 'simon-says',
          win: round >= 10,
          level: `第${round}关`,
          mode: 'focus',
        })
        const cutoff = Date.now() - 14 * 86400000
        localStorage.setItem('pomodoro-sessions-v1', JSON.stringify(arr.filter((x) => x.endTs > cutoff)))
      } catch { /* ignore */ }
    }
    clearSave()
  }, [screen, overInfo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- pagehide 冲刷 ----
  useEffect(() => {
    const flush = () => {
      const eng = engineRef.current
      if (eng && (eng.state === SIMON.STATE.SHOWING || eng.state === SIMON.STATE.INPUT)) eng.pause()
      if (statDirtyRef.current) {
        try {
          const raw = localStorage.getItem(SIMON.STATS_KEY)
          if (raw) localStorage.setItem(SIMON.STATS_KEY, raw)
        } catch { /* ignore */ }
      }
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  // ---- 双路自动暂停 ----
  useEffect(() => {
    const autoPause = () => {
      const eng = engineRef.current
      if (!eng) return
      if (eng.state === SIMON.STATE.SHOWING || eng.state === SIMON.STATE.INPUT) {
        eng.pause()
        setNote('已自动暂停：离开页面')
      }
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') autoPause() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', autoPause)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', autoPause)
    }
  }, [])

  // ---- 操作 ----
  const handlePad = useCallback((pad) => {
    const eng = engineRef.current
    if (!eng) return
    if (eng.state === SIMON.STATE.SHOWING) { setNote('序列播放中，请稍候'); return }
    if (eng.state !== SIMON.STATE.INPUT) return
    setNote('')
    const r = eng.input(pad)
    if (r.ok) playTone(pad)
    if (r.ok && !r.hit) wrongRef.current += 1
  }, [playTone])

  const handlePause = () => { engineRef.current?.pause() }
  const handleResume = () => { setNote(''); engineRef.current?.resume(); lastTsRef.current = 0 }
  const handleRestart = () => startGame()
  const handleBack = () => {
    clearSave()
    engineRef.current?.dispose?.()
    engineRef.current = null
    setEngineState({ state: SIMON.STATE.IDLE, round: 1, lives: SIMON.LIVES, inputIndex: 0, flash: null, seqLen: 1 })
    setElapsed(0)
    setOverInfo(null)
    setNote('')
  }

  const toggleSound = () => {
    setSettings((prev) => {
      const next = { ...prev, sound: !prev.sound }
      try { localStorage.setItem(SIMON.SETTINGS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  // ---- 键盘：1-4 / 方向键映射 / Esc / R ----
  useEffect(() => {
    if (screen !== 'playing' && screen !== 'paused') return
    const KEYMAP = {
      '1': 0, '2': 1, '3': 2, '4': 3,
      ArrowLeft: 0, ArrowUp: 1, ArrowRight: 3, ArrowDown: 2,
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); if (screen === 'playing') handlePause(); else handleResume(); return }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); handleRestart(); return }
      const pad = KEYMAP[e.key]
      if (pad !== undefined) { e.preventDefault(); if (screen === 'playing') handlePad(pad) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen, handlePad]) // eslint-disable-line react-hooks/exhaustive-deps

  const lives = engineState.lives
  const round = engineState.round
  const remaining = Math.max(0, engineState.seqLen - engineState.inputIndex)

  return (
    <div className="simon-wrap">
      <header className="simon-header">
        <Link to="/" className="simon-back">← 返回首页</Link>
        <h1>西蒙记忆 · Simon Says</h1>
      </header>

      {screen === 'start' && (
        <div className="simon-start">
          <h2>看序列 · 按顺序复现</h2>
          <p className="simon-rule">
            四个色块会依次亮起（并发出不同音高）。请按相同顺序点击/按键复现；每过一关序列加长一位、节奏加快。
            共 3 点生命，按错一次扣 1 点并重播本关序列。
          </p>

          {hasSave && (
            <div className="simon-save-card">
              <span>发现未完成对局（第 {hasSave.round} 关，生命 {hasSave.lives}）</span>
              <button onClick={resumeGame}>继续上次</button>
              <button onClick={() => { clearSave(); setHasSave(null) }}>放弃</button>
            </div>
          )}

          <div className="simon-settings">
            <button className={`simon-toggle ${settings.sound ? 'on' : ''}`} onClick={toggleSound} aria-pressed={settings.sound}>
              音效：{settings.sound ? '开' : '关'}
            </button>
            <span className="simon-best">最佳关卡：{best.bestRound > 0 ? `第 ${best.bestRound} 关` : '暂无记录'}</span>
          </div>

          <button className="simon-primary" onClick={startGame}>开始游戏</button>

          <div className="simon-hint">
            <p>键盘：1/2/3/4 或方向键触发对应色块 · Esc 暂停 · R 重开</p>
            <p>累计：{stats.plays} 局 · 最高第 {stats.bestRound} 关 · 按错 {stats.wrongPresses} 次</p>
          </div>
        </div>
      )}

      {screen !== 'start' && (
        <>
          <div className="simon-hud">
            <div className="simon-hud-item"><span className="label">关卡</span><span className="value">{round}</span></div>
            <div className="simon-hud-item"><span className="label">生命</span><span className="value simon-lives">{'♥'.repeat(lives)}{'♡'.repeat(Math.max(0, SIMON.LIVES - lives))}</span></div>
            <div className="simon-hud-item"><span className="label">用时</span><span className="value">{fmtElapsed(elapsed)}</span></div>
            <div className="simon-hud-item"><span className="label">状态</span><span className="value">{engineState.state === SIMON.STATE.SHOWING ? '观看序列' : `轮到你${remaining > 0 ? `（剩 ${remaining} 步）` : ''}`}</span></div>
          </div>

          <div className="simon-board" role="group" aria-label="西蒙记忆四色按钮盘">
            {PADS.map((p) => {
              const lit = engineState.flash === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`simon-pad ${p.cls} ${lit ? 'lit' : ''}`}
                  onClick={() => handlePad(p.id)}
                  aria-label={`${p.name}色按钮，快捷键 ${p.id + 1}`}
                  aria-pressed={lit}
                  disabled={screen !== 'playing'}
                >
                  <span className="simon-pad-key">{p.id + 1}</span>
                  <span className="simon-pad-name">{p.name}</span>
                </button>
              )
            })}
          </div>

          {note && <p className="simon-note" role="status">{note}</p>}

          <div className="simon-actions">
            {screen === 'playing' && <button onClick={handlePause}>暂停 (Esc)</button>}
            {screen === 'paused' && <button onClick={handleResume}>继续</button>}
            <button onClick={handleRestart}>重开 (R)</button>
            <button onClick={handleBack}>返回菜单</button>
          </div>
        </>
      )}

      {screen === 'paused' && (
        <div className="simon-overlay">
          <div className="simon-overlay-card">
            <h3>已暂停</h3>
            <p>恢复后将从本关开头重新播放序列</p>
            <button className="simon-primary" onClick={handleResume}>继续</button>
            <button onClick={handleBack}>放弃并返回菜单</button>
          </div>
        </div>
      )}

      {screen === 'over' && overInfo && (
        <div className="simon-overlay">
          <div className="simon-overlay-card">
            <h3>游戏结束</h3>
            <p>到达第 {overInfo.round} 关</p>
            {overInfo.round > best.bestRound && <p className="simon-new-record">新纪录！</p>}
            <p>下次目标：第 {Math.max(overInfo.round, best.bestRound) + 1} 关</p>
            <button className="simon-primary" onClick={handleRestart}>再来一局</button>
            <button onClick={handleBack}>返回菜单</button>
          </div>
        </div>
      )}

      <div aria-live="polite" className="sr-only">
        {screen === 'playing' && engineState.state === SIMON.STATE.SHOWING ? `第 ${round} 关，正在播放序列` : ''}
        {screen === 'playing' && engineState.state === SIMON.STATE.INPUT ? `轮到你，还需复现 ${remaining} 步` : ''}
        {screen === 'over' && overInfo ? `游戏结束，到达第 ${overInfo.round} 关` : ''}
      </div>
    </div>
  )
}
