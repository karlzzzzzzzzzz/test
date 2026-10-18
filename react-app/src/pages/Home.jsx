import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import MouseTrail from '../components/MouseTrail'
import Weather, { useWeather } from '../components/Weather'
import DragList from '../components/DragList'
import CardLayout from '../components/CardLayout'
import Loading from '../components/Loading'
import './Home.css'

const SKILLS = [
  'VibeCode', 'AgentCode', 'CodeGen', 'PromptEng',
  'CtxEng', 'RAG', 'MultiAgent', 'CLIAgent',
  'React', 'Three.js', 'Vite',
]

// 作品入口（合并原「精选作品」与「技术实践」两区块，路由去重，统一用 CardLayout 渲染）
// 每项 to 唯一；practice 为原技术实践卡的技术描述，融入 children 内容区
const ENTRIES = [
  {
    title: '飞机大战',
    techTags: ['Three.js', 'AgentCode', 'Game'],
    keywords: ['Three.js', '引擎', '碰撞', '粒子', '星空', '弹幕'],
    to: '/game',
    span: '3',
    desc: 'AI Agent 从零构建的 Three.js 3D 射击游戏，含粒子爆炸、星空穿梭、切页自动暂停修复',
    practice: '自研 900 粒星空穿梭背景 + 粒子爆炸系统，支持相机震动与场景雾效。切页自动暂停、WebGL 上下文丢失自恢复。',
    footer: { meta: ['2026-10-10', '8 min'], link: '查看演示' },
  },
  {
    title: '番茄时钟',
    techTags: ['React', 'Hooks', 'localStorage'],
    keywords: ['React', 'Hooks', '专注', '计时', '节奏', '休息'],
    to: '/pomodoro',
    span: '3',
    desc: 'Agent 生成的番茄工作法计时器，含模式自动流转与完成数持久化',
    practice: '基于结束时间戳驱动的计时器，切后台恢复仍准确。完成计数采用脏标记延迟持久化，值域 0~99999 自愈。',
    footer: null,
  },
  {
    title: '在线简历',
    techTags: ['CSS Grid', 'A4'],
    keywords: ['CSS', 'Grid', 'A4', '打印', '排版', '简历'],
    to: '/resume',
    span: '3',
    desc: 'A4 尺寸个人简历，打印适配',
    practice: null,
    footer: null,
  },
  {
    title: '提示词工程文档',
    techTags: ['Markdown', 'Docs', 'Vite'],
    keywords: ['Prompt', 'Markdown', 'Docs', '手册', 'LLM', '实战'],
    to: '/docs',
    span: '3',
    desc: 'Agent 检索网络资料后撰写并渲染的 Prompt Engineering 实战手册',
    practice: '从零搭建基于 Vite + React 18 的工程化脚手架，含路由懒加载、代码分割与环境变量注入。构建产物分包优化，首屏加载 < 1.2s（4G 网络）。',
    footer: { meta: ['2026-10-12', '5 min'], link: '阅读全文' },
  },
  {
    title: '2048 小游戏',
    techTags: ['Canvas2D', 'React Hooks'],
    keywords: ['2048', 'puzzle', 'canvas', '滑动', '合并', '撤销'],
    to: '/2048',
    span: '3',
    desc: 'Canvas 2D + 触控/键盘双输入的轻量级 2048，含切后台自动暂停与进度恢复、3 次撤销',
    practice: '引擎与页面壳解耦（参照飞机大战架构），脏标记延迟持久化到 localStorage；切后台/失焦双路去重暂停，回前台从快照恢复棋盘。',
    footer: null,
  },
  {
    title: '俄罗斯方块',
    techTags: ['BitOps', 'Canvas2D', 'React Hooks'],
    keywords: ['Tetris', '位运算', 'bitmask', 'canvas', '消行', '踢墙'],
    to: '/tetris',
    span: '3',
    desc: '位运算驱动的经典俄罗斯方块，10bit 行棋盘 + 16bit 方块查表，含天气联动配色主题',
    practice: '碰撞检测、旋转踢墙、消行判定全部通过整数位运算完成，单帧逻辑 <1ms；7-bag 随机序列，切后台自动暂停，方块配色随 Open-Meteo 天气码切换。',
    footer: null,
  },
  {
    title: '更多',
    techTags: null,
    keywords: [],
    to: null,
    span: '3',
    desc: '更多作品正在生成中，敬请期待',
    practice: null,
    content: <Loading />,
    footer: null,
  },
]

const PIPELINE = [
  { num: '01', title: '需求理解', desc: 'Agent 解析自然语言指令，拆解为可执行子任务' },
  { num: '02', title: '代码生成', desc: '自动创建/修改组件、样式、路由，热更新即时验证' },
  { num: '03', title: '浏览器自测', desc: 'Headless 浏览器逐页点击，截图像素级校验渲染结果' },
  { num: '04', title: '构建部署', desc: '一键打包、分包优化、Nginx 配置，产物可直接上线' },
]

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/**
 * 统计条数字滚动：50% 进入视口时 800ms ease-out 从 0 滚至目标值，仅触发 1 次
 * prefers-reduced-motion 或值为 0 时直接显示终值
 */
function AnimatedNumber({ value, suffix = '' }) {
  const ref = useRef(null)
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia(REDUCED_MOTION).matches || value === 0) {
      setDisplay(value)
      return
    }
    let played = false
    let rafId = 0
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || played) return
        played = true
        observer.disconnect()
        const start = performance.now()
        const DURATION = 800
        const tick = (now) => {
          const t = Math.min((now - start) / DURATION, 1)
          const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
          setDisplay(Math.round(value * eased))
          if (t < 1) rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
      },
      { threshold: 0.5 },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(rafId)
    }
  }, [value])

  return (
    <span ref={ref} className="bento-stat-num">
      {display}
      {suffix}
    </span>
  )
}

/**
 * 统计条天气摘要格：与天气卡片共享同一份 useWeather 状态
 * 三态：loading "…"占位（不可点击）/ error 提示（可点击定位）/ ok 温度+图标+城市
 */
function WeatherStatCell({ weather }) {
  const { summary } = weather

  const handleClick = () => {
    const el = document.getElementById('weather-card')
    if (!el) return // 目标不存在时静默忽略
    el.scrollIntoView({
      behavior: window.matchMedia(REDUCED_MOTION).matches ? 'auto' : 'smooth',
      block: 'nearest',
    })
    el.focus({ preventScroll: true })
  }

  if (summary.kind === 'loading') {
    return (
      <div className="bento-stat bento-stat-weather">
        <span className="bento-stat-num bento-weather-loading" aria-hidden="true">…</span>
        <span className="bento-stat-label" aria-hidden="true">实时天气</span>
        <span className="sr-only">天气加载中</span>
      </div>
    )
  }

  if (summary.kind === 'error') {
    return (
      <div className="bento-stat bento-stat-weather">
        <button
          type="button"
          className="bento-stat-weather-btn"
          onClick={handleClick}
          aria-label="天气暂不可用，点击定位到天气卡片"
        >
          <span className="bento-stat-num" aria-hidden="true">–</span>
          <span className="bento-stat-label" aria-hidden="true">天气暂不可用</span>
        </button>
      </div>
    )
  }

  return (
    <div className="bento-stat bento-stat-weather">
      <button
        type="button"
        className="bento-stat-weather-btn"
        onClick={handleClick}
        aria-label={`当前天气 ${summary.temp}°C ${summary.desc}${summary.city ? ' ' + summary.city : ''}，点击查看天气详情`}
      >
        <span className="bento-stat-num" aria-hidden="true">
          {summary.temp}°C {summary.icon}
        </span>
        <span className="bento-stat-label" aria-hidden="true">
          {summary.city || '实时天气'}
        </span>
      </button>
    </div>
  )
}

function Home() {
  const weather = useWeather()

  // 入口点击计数（约束卡①：localStorage 轻量行为统计，脏标记 + 隐藏/卸载/1s 兜底延迟写入）
  const clicksRef = useRef({})
  const dirtyRef = useRef(false)
  const writeTimerRef = useRef(null)

  const flushClicks = () => {
    if (!dirtyRef.current) return
    try {
      const raw = localStorage.getItem('home-entry-clicks')
      const base = raw ? JSON.parse(raw) : {}
      if (typeof base !== 'object' || base === null) throw new Error('bad json')
      for (const [k, v] of Object.entries(clicksRef.current)) {
        base[k] = Math.min(99999, (Number(base[k]) || 0) + v)
      }
      localStorage.setItem('home-entry-clicks', JSON.stringify(base))
    } catch {
      // localStorage 不可用或 JSON 异常：仅内存计数，不阻断主功能
    } finally {
      clicksRef.current = {}
      dirtyRef.current = false
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current)
        writeTimerRef.current = null
      }
    }
  }

  const trackEntryClick = (to) => {
    clicksRef.current[to] = (clicksRef.current[to] || 0) + 1
    dirtyRef.current = true
    if (writeTimerRef.current) return
    writeTimerRef.current = setTimeout(flushClicks, 1000)
  }

  useEffect(() => {
    const onVisibilityHidden = () => { if (document.hidden) flushClicks() }
    window.addEventListener('pagehide', flushClicks)
    document.addEventListener('visibilitychange', onVisibilityHidden)
    return () => {
      flushClicks()
      window.removeEventListener('pagehide', flushClicks)
      document.removeEventListener('visibilitychange', onVisibilityHidden)
    }
  }, [])

  return (
    <div className="home-page">
      <MouseTrail />

      <div className="bento-grid">
        {/* 项目定位（大卡） */}
        <section className="bento-card bento-about bento-span-8">
          <p className="bento-eyebrow">AI AGENT AUTOMATED</p>
          <h1 className="bento-name">自动化构建部署</h1>
          <p className="bento-tagline">
            这个网站本身由 AI Agent 自主完成：需求理解 → 代码生成 → 浏览器自测 → 构建打包 → 部署上线，全程零人工编码
          </p>
          <div className="bento-cta">
            <Link to="/game" className="bento-btn bento-btn-primary">
              体验 Agent 产物 →
            </Link>
            <Link to="/docs" className="bento-btn">
              技术文档
            </Link>
          </div>
        </section>

        {/* 右列：技术栈 + 本地天气 */}
        <div className="bento-span-4 bento-side-col">
          <section className="bento-card bento-skills">
            <h2 className="bento-card-title">
              <span className="bento-card-num">AI</span> 技术栈
            </h2>
            <DragList className="bento-skill-list">
              {SKILLS.map((s) => (
                <div key={s} className="bento-skill">{s}</div>
              ))}
            </DragList>
          </section>

          <Weather weather={weather} />
        </div>

        {/* Agent 工作流 */}
        <div className="bento-section-title bento-span-12">
          <span className="bento-card-num">01</span> Agent 工作流
        </div>

        {PIPELINE.map((p) => (
          <div
            key={p.num}
            className="bento-card bento-pipeline bento-span-3"
            tabIndex={0}
            role="group"
            aria-label={`Agent 工作流第 ${p.num} 步：${p.title}`}
          >
            <span className="bento-pipeline-num">{p.num}</span>
            <h3 className="bento-pipeline-title">{p.title}</h3>
            <p className="bento-pipeline-desc">{p.desc}</p>
          </div>
        ))}

        {/* 作品入口标题（原「精选作品」+「技术实践」两区块合并，路由去重，统一用 CardLayout） */}
        <div className="bento-section-title bento-span-12">
          <span className="bento-card-num">02</span> Agent 生成的作品
        </div>

        {/* 作品入口卡片（data-keywords 供 MouseTrail hover/聚焦时切换粒子主题词；
            footer Link 点击计数写入 home-entry-clicks，约束卡①） */}
        {ENTRIES.map((c) => (
          <CardLayout
            key={c.title}
            title={c.title}
            techTags={c.techTags}
            span={c.span}
            data-keywords={c.keywords.join(',')}
            footer={
              c.footer ? (
                <>
                  <div className="cl-foot-meta">
                    {c.footer.meta.join(' · ')}
                  </div>
                  <Link
                    to={c.to}
                    className="cl-link"
                    onClick={() => trackEntryClick(c.to)}
                  >
                    {c.footer.link} →
                  </Link>
                </>
              ) : c.to && (
                <Link
                  to={c.to}
                  className="cl-link"
                  onClick={() => trackEntryClick(c.to)}
                >
                  查看详情 →
                </Link>
              )
            }
          >
            {c.desc && <p>{c.desc}</p>}
            {c.practice && <p className="cl-practice">{c.practice}</p>}
            {c.content}
          </CardLayout>
        ))}

        {/* 统计条 */}
        <footer className="bento-card bento-stats bento-span-12">
          <div className="bento-stat">
            <AnimatedNumber value={100} suffix="%" />
            <span className="bento-stat-label">AI 生成代码</span>
          </div>
          <div className="bento-stat-divider" />
          <div className="bento-stat">
            <AnimatedNumber value={0} />
            <span className="bento-stat-label">行人工编码</span>
          </div>
          <div className="bento-stat-divider" />
          <div className="bento-stat">
            <AnimatedNumber value={3} />
            <span className="bento-stat-label">个功能模块</span>
          </div>
          <div className="bento-stat-divider" />
          <WeatherStatCell weather={weather} />
          <div className="bento-stat-divider" />
          <div className="bento-stat bento-stat-contact">
            <a href="mailto:hello@example.com" className="bento-stat-mail">
              由 AI Agent 构建并部署 →
            </a>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default Home
