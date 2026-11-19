import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  LifeEngine, LIFE, SPEEDS, SPEED_KEYS, PRESETS, PRESET_KEYS, parseRLE,
} from '../game/LifeEngine'
import './Life.css'

const STATS_KEY = 'game-life-stats-v1'
const POMODORO_KEY = 'pomodoro-sessions-v1'
const STATS_DEBOUNCE_MS = 1000
const STATS_KEYS = [
  'runs', 'generations', 'maxPopulation', 'maxGeneration',
  'extinctions', 'randomizes', 'imports', 'importErrors', 'speedChanges',
]

function loadStats() {
  const empty = {
    runs: 0, generations: 0, maxPopulation: 0, maxGeneration: 0,
    extinctions: 0, randomizes: 0, imports: 0, importErrors: 0,
    speedChanges: 0, updatedAt: 0,
  }
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (!data || typeof data !== 'object') return empty
    const out = { ...empty }
    for (const key of STATS_KEYS) {
      out[key] = Number.isFinite(data[key]) ? Math.max(0, Math.floor(data[key])) : 0
    }
    out.updatedAt = Number(data.updatedAt) || 0
    return out
  } catch { return empty }
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
      game: 'life',
      win: (info.population || 0) > 0,
      level: info.speed || 'normal',
    })
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000
    localStorage.setItem(POMODORO_KEY, JSON.stringify(sessions.filter((s) => s.endTs >= cutoff)))
  } catch { /* 存储不可用时静默忽略 */ }
}

function fmtElapsed(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function drawBoard(canvas, snapshot) {
  if (!canvas || !snapshot || !snapshot.board.length) return
  const cell = 16
  const width = snapshot.cols * cell
  const height = snapshot.rows * cell
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#08111f'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.07)'
  ctx.lineWidth = 1
  for (let c = 1; c < snapshot.cols; c++) {
    ctx.beginPath()
    ctx.moveTo(c * cell + 0.5, 0)
    ctx.lineTo(c * cell + 0.5, height)
    ctx.stroke()
  }
  for (let r = 1; r < snapshot.rows; r++) {
    ctx.beginPath()
    ctx.moveTo(0, r * cell + 0.5)
    ctx.lineTo(width, r * cell + 0.5)
    ctx.stroke()
  }
  for (let i = 0; i < snapshot.board.length; i++) {
    if (!snapshot.board[i]) continue
    const row = Math.floor(i / snapshot.cols)
    const col = i % snapshot.cols
    const warm = (row + col) % 7 === 0
    ctx.fillStyle = warm ? '#fbbf24' : '#22d3ee'
    ctx.fillRect(col * cell + 1.5, row * cell + 1.5, cell - 3, cell - 3)
    if (!warm) {
      ctx.fillStyle = 'rgba(34, 211, 238, 0.16)'
      ctx.fillRect(col * cell + 4, row * cell + 4, cell - 8, cell - 8)
    }
  }
}

/**
 * 生命游戏页面壳 —— 康威元胞自动机，内置图案 + RLE 导入 + 速度控制。
 *
 * 六屏：start / playing / paused / over
 * 约束卡① 切后台 / 失焦双路自动暂停，回到页面保持暂停
 * 约束卡② RLE 导入完整覆盖 loading / empty / error / ready 四态
 * 约束卡③ 埋点写 game-life-stats-v1：脏标记 + 1s 防抖 + pagehide 落盘
 */
export default function LifePage() {
  const engineRef = useRef(null)
  const snapshotRef = useRef(null)
  const canvasRef = useRef(null)
  const statsRef = useRef(loadStats())
  const lastGenRef = useRef(0)
  const statsTimerRef = useRef(null)
  const statsDirtyRef = useRef(false)
  const sessionStartRef = useRef(0)
  const sessionSettledRef = useRef(false)
  const paintRef = useRef({ active: false, seen: new Set() })

  const [screen, setScreen] = useState('start')
  const [preset, setPreset] = useState(LIFE.DEFAULT_PRESET)
  const [speed, setSpeed] = useState('normal')
  const [wrap, setWrap] = useState(true)
  const [snapshot, setSnapshot] = useState(null)
  const [pausedAuto, setPausedAuto] = useState(false)
  const [liveAnnounce, setLiveAnnounce] = useState('')
  const [stats, setStats] = useState(statsRef.current)
  const [finalInfo, setFinalInfo] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importStatus, setImportStatus] = useState('idle')
  const [importMessage, setImportMessage] = useState('')
  const [rleText, setRleText] = useState('')

  const flushStatsNow = () => {
    if (statsTimerRef.current) {
      clearTimeout(statsTimerRef.current)
      statsTimerRef.current = null
    }
    if (!statsDirtyRef.current) return
    statsDirtyRef.current = false
    statsRef.current.updatedAt = Date.now()
    try { localStorage.setItem(STATS_KEY, JSON.stringify(statsRef.current)) } catch { /* ignore */ }
  }

  const markStatsDirty = () => {
    statsDirtyRef.current = true
    if (statsTimerRef.current) return
    statsTimerRef.current = setTimeout(() => {
      statsTimerRef.current = null
      flushStatsNow()
    }, STATS_DEBOUNCE_MS)
  }

  const syncStats = (patch) => {
    const next = { ...statsRef.current, ...patch }
    statsRef.current = next
    setStats(next)
    markStatsDirty()
  }

  const settleSession = (info = {}) => {
    if (sessionSettledRef.current) return
    if (!sessionStartRef.current) return
    sessionSettledRef.current = true
    const elapsed = Number.isFinite(info.elapsed) ? info.elapsed : (Date.now() - sessionStartRef.current) / 1000
    if (elapsed < 120) return
    const endTs = Date.now()
    appendPomodoroSession(endTs - elapsed * 1000, endTs, {
      population: info.population ?? snapshotRef.current?.population ?? 0,
      speed: info.speed || speed,
    })
  }

  // ===== 引擎初始化 =====
  useEffect(() => {
    const engine = new LifeEngine({
      onState: (snap) => {
        snapshotRef.current = snap
        setSnapshot(snap)
        if (snap.generation > lastGenRef.current) {
          const delta = snap.generation - lastGenRef.current
          syncStats({
            generations: statsRef.current.generations + delta,
            maxPopulation: Math.max(statsRef.current.maxPopulation, snap.maxPopulation),
            maxGeneration: Math.max(statsRef.current.maxGeneration, snap.generation),
          })
        }
        lastGenRef.current = snap.generation
      },
      onGameOver: (info) => {
        const s = statsRef.current
        syncStats({
          extinctions: s.extinctions + (info.result === 'extinct' ? 1 : 0),
          maxPopulation: Math.max(s.maxPopulation, info.maxPopulation),
          maxGeneration: Math.max(s.maxGeneration, info.generation),
        })
        flushStatsNow()
        settleSession(info)
        setFinalInfo(info)
        setScreen('over')
        setPausedAuto(false)
        setLiveAnnounce(info.result === 'extinct' ? '全部细胞已灭绝' : '观察结束')
      },
    })
    engineRef.current = engine
    snapshotRef.current = engine.getSnapshot()

    return () => {
      flushStatsNow()
      engine.dispose()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 速度由页面驱动，切换速度 / 暂停时重建定时器
  useEffect(() => {
    if (screen !== 'playing') return undefined
    const interval = SPEEDS[speed]?.intervalMs || 400
    const timer = setInterval(() => {
      const engine = engineRef.current
      if (engine && engine.state === 'playing') engine.tick()
    }, interval)
    return () => clearInterval(timer)
  }, [screen, speed])

  useEffect(() => {
    drawBoard(canvasRef.current, snapshot)
  }, [snapshot, screen])

  // ===== 自动暂停（visibilitychange + blur 双路去重） =====
  useEffect(() => {
    const pauseIfPlaying = (reason) => {
      const engine = engineRef.current
      if (!engine || engine.state !== 'playing') return
      engine.pause()
      setScreen('paused')
      setPausedAuto(true)
      setLiveAnnounce(`已自动暂停（${reason}）`)
      flushStatsNow()
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') pauseIfPlaying('切到后台')
    }
    const onBlur = () => pauseIfPlaying('窗口失焦')
    const onPageHide = () => flushStatsNow()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', onPageHide)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== 键盘：空格播放/暂停、N 单步、R 随机、C 清空、Esc 暂停 =====
  useEffect(() => {
    const onKey = (ev) => {
      const tag = ev.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (screen === 'start' || screen === 'over') return
      if (ev.code === 'Space') {
        ev.preventDefault()
        togglePlay()
      } else if (ev.key === 'n' || ev.key === 'N') {
        ev.preventDefault()
        handleStep()
      } else if (ev.key === 'r' || ev.key === 'R') {
        ev.preventDefault()
        handleRandomize()
      } else if (ev.key === 'c' || ev.key === 'C') {
        ev.preventDefault()
        handleClear()
      } else if (ev.key === 'Escape') {
        const engine = engineRef.current
        if (engine && engine.state === 'playing') {
          engine.pause()
          setScreen('paused')
          setPausedAuto(false)
          setLiveAnnounce('已暂停')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])

  // ===== 操作 =====
  const handleStart = () => {
    const engine = engineRef.current
    if (!engine) return
    const snap = engine.start(preset, { speed, wrap })
    snapshotRef.current = snap
    setSnapshot(snap)
    setScreen('playing')
    setPausedAuto(false)
    setFinalInfo(null)
    setImportOpen(false)
    sessionStartRef.current = Date.now()
    sessionSettledRef.current = false
    lastGenRef.current = 0
    syncStats({ runs: statsRef.current.runs + 1 })
    setLiveAnnounce(`${PRESETS[preset]?.label || '自定义图案'}开始演化`)
  }

  const togglePlay = () => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.state === 'playing') {
      engine.pause()
      setScreen('paused')
      setPausedAuto(false)
      setLiveAnnounce('已暂停，可点击棋盘编辑细胞')
    } else if (engine.state === 'paused') {
      engine.resume()
      setScreen('playing')
      setPausedAuto(false)
      setLiveAnnounce('继续演化')
    }
  }

  const pauseForEdit = () => {
    const engine = engineRef.current
    if (!engine) return false
    if (engine.state === 'start' || engine.state === 'over') return false
    if (engine.state === 'playing') {
      engine.pause()
      setPausedAuto(false)
    }
    setScreen('paused')
    return true
  }

  const handleStep = () => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.state === 'playing') engine.pause()
    const ok = engine.step()
    if (!ok) return
    setScreen(engine.state === 'over' ? 'over' : 'paused')
    const snap = engine.getSnapshot()
    setLiveAnnounce(`第 ${snap.generation} 代，${snap.population} 个活细胞`)
  }

  const handleRandomize = () => {
    const engine = engineRef.current
    if (!engine || !pauseForEdit()) return
    engine.randomize()
    lastGenRef.current = 0
    syncStats({ randomizes: statsRef.current.randomizes + 1 })
    setLiveAnnounce('已生成随机细胞，按播放开始演化')
  }

  const handleClear = () => {
    const engine = engineRef.current
    if (!engine || !pauseForEdit()) return
    engine.clear()
    lastGenRef.current = 0
    setLiveAnnounce('棋盘已清空，可点击格子放置细胞')
  }

  const handleStop = () => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.state === 'playing') engine.pause()
    engine.stop()
  }

  const handleMenu = () => {
    const engine = engineRef.current
    if (engine && (engine.state === 'playing' || engine.state === 'paused')) {
      settleSession(snapshotRef.current || {})
      engine.pause()
    }
    setScreen('start')
    setPausedAuto(false)
    setFinalInfo(null)
    setImportOpen(false)
    setLiveAnnounce('已返回开始菜单')
  }

  const handlePresetChange = (event) => {
    const key = event.target.value
    if (!key) return
    const engine = engineRef.current
    if (!engine || !pauseForEdit()) return
    engine.loadPreset(key)
    setPreset(key)
    lastGenRef.current = 0
    setLiveAnnounce(`已载入${PRESETS[key]?.label || key}`)
  }

  const handleSpeedChange = (key) => {
    const engine = engineRef.current
    if (!engine) return
    setSpeed(key)
    engine.setSpeed(key)
    syncStats({ speedChanges: statsRef.current.speedChanges + 1 })
    setLiveAnnounce(`速度切换为${SPEEDS[key].label}`)
  }

  const handleWrapChange = () => {
    setWrap((prev) => {
      const next = !prev
      engineRef.current?.setWrap(next)
      setLiveAnnounce(next ? '边界改为环绕' : '边界改为固定')
      return next
    })
  }

  const openImport = () => {
    setImportOpen(true)
    setImportStatus('idle')
    setImportMessage('')
  }

  const countImportError = () => {
    syncStats({ importErrors: statsRef.current.importErrors + 1 })
  }

  const applyPatternText = async (text) => {
    setImportStatus('loading')
    setImportMessage('正在解析图案…')
    await new Promise((resolve) => setTimeout(resolve, 80))
    try {
      const parsed = parseRLE(text)
      if (!parsed.cells.length) {
        setImportStatus('empty')
        setImportMessage('图案里没有活细胞，请检查 b / o 内容')
        return
      }
      const engine = engineRef.current
      if (!engine) return
      if (engine.state === 'playing') engine.pause()
      if (engine.state === 'start' || engine.state === 'over') {
        engine.start(preset || LIFE.DEFAULT_PRESET, { speed, wrap })
        sessionStartRef.current = Date.now()
        sessionSettledRef.current = false
        lastGenRef.current = 0
        syncStats({ runs: statsRef.current.runs + 1 })
      }
      const result = engine.loadCells(parsed.cells)
      if (!result.ok) {
        setImportStatus('error')
        setImportMessage(result.reason)
        countImportError()
        return
      }
      engine.pause()
      setScreen('paused')
      setPausedAuto(false)
      setFinalInfo(null)
      setPreset('')
      lastGenRef.current = 0
      setImportStatus('ready')
      setImportMessage(`已载入自定义图案：${result.population} 个活细胞`)
      syncStats({ imports: statsRef.current.imports + 1 })
      setLiveAnnounce(`已载入自定义图案，共 ${result.population} 个活细胞`)
    } catch (error) {
      setImportStatus('error')
      setImportMessage(error.message || '图案解析失败')
      countImportError()
    }
  }

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      setImportStatus('empty')
      setImportMessage('未选择文件')
      return
    }
    setImportStatus('loading')
    setImportMessage(`正在读取 ${file.name}…`)
    try {
      const text = await file.text()
      await applyPatternText(text)
    } catch {
      setImportStatus('error')
      setImportMessage('文件读取失败，请重试或改用粘贴文本')
      countImportError()
    }
  }

  const handlePointerDown = (event) => {
    const engine = engineRef.current
    if (!engine || !pauseForEdit()) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    paintRef.current = { active: true, seen: new Set() }
    toggleAtEvent(event)
  }

  const handlePointerMove = (event) => {
    if (!paintRef.current.active) return
    event.preventDefault()
    toggleAtEvent(event)
  }

  const endPaint = () => {
    paintRef.current.active = false
    paintRef.current.seen.clear()
  }

  const toggleAtEvent = (event) => {
    const canvas = canvasRef.current
    const engine = engineRef.current
    if (!canvas || !engine) return
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const col = Math.floor(((event.clientX - rect.left) / rect.width) * engine.cols)
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * engine.rows)
    if (row < 0 || row >= engine.rows || col < 0 || col >= engine.cols) return
    const index = row * engine.cols + col
    if (paintRef.current.seen.has(index)) return
    paintRef.current.seen.add(index)
    const value = engine.toggleCell(index)
    if (value !== null) setLiveAnnounce(`第 ${row + 1} 行第 ${col + 1} 列${value ? '已放置细胞' : '已移除细胞'}`)
  }

  const renderImportPanel = () => (
    <section className="life-import" aria-label="导入 RLE 图案">
      <div className="life-import-head">
        <strong>导入 RLE 图案</strong>
        <button type="button" className="life-link-btn" onClick={() => setImportOpen(false)}>关闭</button>
      </div>
      <p className="life-import-tip">支持标准 RLE（含 <code>x = N, y = N</code> 头信息），图案会自动居中。</p>
      <label className="life-file-label">
        选择 .rle / .txt 文件
        <input type="file" accept=".rle,.txt,text/plain" onChange={handleFileChange} />
      </label>
      <textarea
        className="life-import-textarea"
        value={rleText}
        onChange={(event) => setRleText(event.target.value)}
        placeholder={'#N Glider\nx = 3, y = 3\nbo$2bo$3o!'}
        rows={4}
        aria-label="RLE 文本"
      />
      <div className="life-import-actions">
        <button
          type="button"
          className="life-btn life-btn-primary"
          onClick={() => applyPatternText(rleText)}
          disabled={importStatus === 'loading'}
        >
          解析文本
        </button>
        <button type="button" className="life-btn" onClick={() => setRleText('')}>清空输入</button>
      </div>
      {importStatus !== 'idle' && (
        <p className={`life-import-status is-${importStatus}`} role="status">
          {importStatus === 'loading' ? '加载中：' : ''}
          {importStatus === 'empty' ? '空图案：' : ''}
          {importStatus === 'error' ? '解析失败：' : ''}
          {importStatus === 'ready' ? '导入成功：' : ''}
          {importMessage}
        </p>
      )}
    </section>
  )

  const pageNav = (
    <nav className="life-nav">
      <Link className="life-nav-back" to="/">← 返回首页</Link>
      <h1 className="life-nav-title">生命游戏</h1>
      <span className="life-nav-spacer" />
      {screen !== 'start' && <span className="life-nav-badge">{SPEEDS[speed]?.label}</span>}
    </nav>
  )

  if (screen === 'start') {
    return (
      <div className="life-page">
        {pageNav}
        <main className="life-screen">
          <section className="life-card">
            <h2 className="life-title">康威生命游戏</h2>
            <p className="life-desc">
              每个格子只有生与死两种状态，下一代由周围 8 个邻居决定。
              选择经典图案，观察混沌、振荡与滑翔机如何从简单规则中涌现。
            </p>

            <div className="life-section-head">
              <h3>选择初始图案</h3>
              <span>7 种经典图案</span>
            </div>
            <div className="life-presets" role="group" aria-label="图案库">
              {PRESET_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`life-preset ${preset === key ? 'active' : ''}`}
                  aria-pressed={preset === key}
                  onClick={() => {
                    setPreset(key)
                    setLiveAnnounce(`已选择${PRESETS[key].label}`)
                  }}
                >
                  <strong>{PRESETS[key].label}</strong>
                  <span>{PRESETS[key].blurb}</span>
                </button>
              ))}
            </div>

            <div className="life-section-head">
              <h3>演化速度</h3>
              <span>{SPEEDS[speed].blurb}</span>
            </div>
            <div className="life-speeds" role="group" aria-label="速度">
              {SPEED_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`life-chip ${speed === key ? 'active' : ''}`}
                  aria-pressed={speed === key}
                  onClick={() => setSpeed(key)}
                >
                  {SPEEDS[key].label}
                </button>
              ))}
            </div>

            <div className="life-toggle-row">
              <div>
                <strong>环绕边界</strong>
                <span>上下左右相连，滑翔机可从另一侧穿回</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={wrap}
                aria-label="环绕边界"
                className={`life-switch ${wrap ? 'on' : ''}`}
                onClick={() => setWrap((prev) => !prev)}
              >
                <span />
              </button>
            </div>

            <button type="button" className="life-start-btn" onClick={handleStart}>开始演化</button>
            <div className="life-inline-actions">
              <button type="button" className="life-btn" onClick={openImport}>导入 RLE 图案</button>
            </div>
            {importOpen && renderImportPanel()}

            <p className="life-stats-line">
              累计演化 <strong>{stats.generations}</strong> 代 · 历史最高人口 <strong>{stats.maxPopulation}</strong> ·
              灭绝 <strong>{stats.extinctions}</strong> 次
            </p>

            <ul className="life-rules">
              <li>活细胞周围有 2 或 3 个活邻居时存活，否则死亡。</li>
              <li>死细胞周围恰好有 3 个活邻居时复活。</li>
              <li>演化中点击棋盘会先暂停，再切换该格；按住拖动可连续绘制。</li>
              <li>空格暂停 / 继续，N 单步，R 随机，C 清空，Esc 暂停。</li>
            </ul>
          </section>
        </main>
        <p className="life-live" aria-live="polite">{liveAnnounce}</p>
      </div>
    )
  }

  if (screen === 'over') {
    return (
      <div className="life-page">
        {pageNav}
        <main className="life-screen">
          <section className="life-card life-over-card">
            <div className="life-over-mark" aria-hidden="true" />
            <h2 className="life-title">{finalInfo?.result === 'extinct' ? '宇宙归于寂静' : '观察结束'}</h2>
            <p className="life-desc">
              {finalInfo?.result === 'extinct'
                ? '最后一个细胞也熄灭了。换个图案，再看一次涌现。'
                : '你主动结束了这次观察，下面是这一局的统计。'}
            </p>
            <div className="life-over-stats">
              <div><span>演化代数</span><strong>{finalInfo?.generation ?? 0}</strong></div>
              <div><span>最高人口</span><strong>{finalInfo?.maxPopulation ?? 0}</strong></div>
              <div><span>累计出生</span><strong>{finalInfo?.totalBirths ?? 0}</strong></div>
              <div><span>累计死亡</span><strong>{finalInfo?.totalDeaths ?? 0}</strong></div>
              <div><span>用时</span><strong>{fmtElapsed(finalInfo?.elapsed)}</strong></div>
              <div><span>速度</span><strong>{SPEEDS[finalInfo?.speed]?.label || '常速'}</strong></div>
            </div>
            <div className="life-inline-actions">
              <button type="button" className="life-start-btn" onClick={handleStart}>再来一局</button>
              <button type="button" className="life-btn" onClick={handleMenu}>返回开始菜单</button>
            </div>
          </section>
        </main>
        <p className="life-live" aria-live="polite">{liveAnnounce}</p>
      </div>
    )
  }

  return (
    <div className="life-page">
      {pageNav}
      <main className="life-screen life-screen-wide">
        <section className="life-card life-card-wide">
          <div className="life-hud" aria-label="演化统计">
            <div className="life-stat"><span>代数</span><strong>{snapshot?.generation ?? 0}</strong></div>
            <div className="life-stat"><span>活细胞</span><strong>{snapshot?.population ?? 0}</strong></div>
            <div className="life-stat"><span>本代出生</span><strong>{snapshot?.lastBirths ?? 0}</strong></div>
            <div className="life-stat"><span>本代死亡</span><strong>{snapshot?.lastDeaths ?? 0}</strong></div>
            <div className="life-stat"><span>最高人口</span><strong>{snapshot?.maxPopulation ?? 0}</strong></div>
            <div className="life-stat"><span>用时</span><strong>{fmtElapsed(snapshot?.elapsed)}</strong></div>
          </div>

          <div className="life-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="life-canvas"
              role="img"
              aria-label={`生命游戏棋盘，第 ${snapshot?.generation ?? 0} 代，${snapshot?.population ?? 0} 个活细胞。点击格子可暂停并切换细胞。`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPaint}
              onPointerCancel={endPaint}
              onPointerLeave={endPaint}
            />
            {screen === 'paused' && (
              <div className="life-pause-mask" role="dialog" aria-label="已暂停">
                <div>
                  <p className="life-pause-title">{pausedAuto ? '已自动暂停' : '已暂停'}</p>
                  <p className="life-pause-sub">
                    {pausedAuto ? '切到后台或窗口失焦时自动暂停，回来后不会继续演化。' : '点击棋盘可编辑细胞，或继续演化。'}
                  </p>
                  <div className="life-pause-actions">
                    <button type="button" className="life-btn life-btn-primary" onClick={togglePlay}>继续演化</button>
                    <button type="button" className="life-btn" onClick={handleStep}>单步</button>
                    <button type="button" className="life-btn" onClick={handleStop}>结束观察</button>
                    <button type="button" className="life-btn" onClick={handleMenu}>返回菜单</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="life-toolbar">
            <div className="life-tool-group">
              <button type="button" className="life-btn life-btn-primary" onClick={togglePlay}>
                {screen === 'playing' ? '暂停' : '继续'}
              </button>
              <button type="button" className="life-btn" onClick={handleStep}>单步</button>
              <button type="button" className="life-btn" onClick={handleRandomize}>随机</button>
              <button type="button" className="life-btn" onClick={handleClear}>清空</button>
            </div>
            <div className="life-tool-group">
              <label className="life-select-label">
                图案
                <select value={snapshot?.presetKey || ''} onChange={handlePresetChange}>
                  <option value="">自定义</option>
                  {PRESET_KEYS.map((key) => (
                    <option key={key} value={key}>{PRESETS[key].label}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="life-btn" onClick={openImport}>导入 RLE</button>
              <button type="button" className="life-btn" onClick={handleMenu}>返回菜单</button>
            </div>
          </div>

          <div className="life-settings">
            <div className="life-speeds" role="group" aria-label="速度">
              {SPEED_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`life-chip ${speed === key ? 'active' : ''}`}
                  aria-pressed={speed === key}
                  onClick={() => handleSpeedChange(key)}
                >
                  {SPEEDS[key].label}
                </button>
              ))}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={wrap}
              aria-label="环绕边界"
              className={`life-switch ${wrap ? 'on' : ''}`}
              onClick={handleWrapChange}
            >
              <span />
            </button>
            <span className="life-switch-label">环绕边界</span>
          </div>

          {importOpen && renderImportPanel()}
          <p className="life-live" aria-live="polite">{liveAnnounce}</p>
          {pausedAuto && <p className="life-hint">已自动暂停：切到后台或窗口失焦不会消耗代数。</p>}
        </section>
      </main>
    </div>
  )
}
