import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import MouseTrail from '../components/MouseTrail'
import Weather, { useWeather } from '../components/Weather'
import DragList from '../components/DragList'
import CardLayout from '../components/CardLayout'
import DailyChallenge from '../components/DailyChallenge'
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
    title: '南昌旅游',
    techTags: ['React', 'Gallery', 'A11y'],
    keywords: ['Nanchang', '南昌', '旅游', '攻略', '灯箱', '行程'],
    to: '/nanchang',
    span: '3',
    desc: '三日行程 + 景点速查 + 交通住宿攻略，12 张手账风攻略图支持灯箱浏览',
    practice: '图集由 GALLERY 常量驱动，图片 loading="lazy"；灯箱 role="dialog" aria-modal="true"，Esc 关闭、←/→ 切换、打开时焦点落入关闭按钮并按需锁定背景滚动。',
    footer: { meta: ['2026-10-26', '图文页'], link: '查看攻略' },
  },
  {
    title: '提示词工程文档',
    techTags: ['Markdown', 'Docs', 'Prompt'],
    keywords: ['Prompt', 'Markdown', 'Docs', '手册', 'LLM', '实战'],
    to: '/docs',
    span: '3',
    desc: 'Agent 检索网络资料后撰写并渲染的 Prompt Engineering 实战手册',
    practice: '围绕角色设定、结构化输出、上下文管理与提示链组织实战示例，每类手法配可复用的模板；文档以 Markdown 维护，经 React 19 + Vite 的 raw 导入通道渲染，与本站示例同一套构建流程。',
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
    title: '贪吃蛇',
    techTags: ['Canvas2D', 'InputBuffer', 'React Hooks'],
    keywords: ['Snake', '贪吃蛇', 'canvas', '节拍', '缓冲队列', '街机'],
    to: '/snake',
    span: '3',
    desc: '经典贪吃蛇重制：固定节拍 + 方向输入缓冲队列，快速连按不反向自杀',
    practice: '移动节拍由结束时间戳驱动，切后台恢复不跳帧；方向输入经容量 2 缓冲队列逐拍消费，杜绝 180° 反向自杀；撞墙/撞身判定 O(蛇长)。',
    footer: null,
  },
  {
    title: '打砖块',
    techTags: ['Canvas2D', 'Physics', 'React Hooks'],
    keywords: ['Breakout', '打砖块', '物理', '弹射', '关卡', '街机'],
    to: '/breakout',
    span: '3',
    desc: '固定步长物理引擎驱动的打砖块：240Hz 定步积分防穿透，5 关布局 + 无尽挑战',
    practice: '1/240s 固定步长积分 + 单 rAF 渲染循环；切后台自动暂停并快照，7 天内可续玩；砖块配色随 Open-Meteo 天气码切换。',
    footer: null,
  },
  {
    title: '记忆翻牌',
    techTags: ['React', 'Hooks', 'A11y'],
    keywords: ['Memory', '翻牌', '配图', '无障碍', '键盘', 'aria'],
    to: '/memory',
    span: '3',
    desc: '16 张牌 8 对图标，纯键盘也能玩的记忆配对',
    practice: '引擎与页面壳解耦 + Fisher–Yates 洗牌 + 800ms 翻回锁定窗口；棋盘 role=grid + roving tabindex，方向键导航 + Enter/Space 翻牌，aria-live polite 播报配对结果。',
    footer: { meta: ['2026-10-26', '4 min'], link: '开始挑战' },
  },
  {
    title: '打地鼠',
    techTags: ['DOM', 'React Hooks', 'A11y'],
    keywords: ['Whack', '地鼠', '连击', '30秒', '点按', '街机'],
    to: '/whack',
    span: '3',
    desc: '30 秒限时打地鼠：3×3 洞位随机出鼠，金鼠 3 倍分，连击 4 次起额外加分',
    practice: '纯 DOM 实现（不用 Canvas，读屏可解释）：结束时间戳驱动倒计时，切后台冻结；棋盘 role=grid + roving tabindex，方向键导航 + Enter/Space 敲击；统计与最佳分脏标记延迟落盘。',
    footer: { meta: ['2026-10-30', '3 min'], link: '开始挑战' },
  },
  {
    title: '数字华容道',
    techTags: ['DOM', 'React Hooks', 'Puzzle'],
    keywords: ['Puzzle', '华容道', '滑块', '触控', '计时', '益智'],
    to: '/puzzle',
    span: '3',
    desc: '3×3 数字滑块拼图：点按空格相邻方块或滑动换位，排好 1~8 记录步数与用时',
    practice: '打乱从完成态随机合法移动 80 次保证可解，禁止即时反向撤回；计时首次有效移动启动、Date.now 双字段驱动，切后台冻结不跳秒；本页不写任何存储键。',
    footer: { meta: ['2026-11-01', '3 min'], link: '开始挑战' },
  },
  {
    title: '关灯挑战',
    techTags: ['DOM', 'React Hooks', 'Puzzle'],
    keywords: ['LightsOut', '关灯', '翻转', '解谜', '触控', '逻辑'],
    to: '/lightsout',
    span: '3',
    desc: '点按一格翻转它和上下左右的灯，把所有灯熄灭即过关，4×4 / 5×5 / 6×6 三档限时挑战',
    practice: '从「全灭」态施加 N 次合法翻转生成棋盘，因此必然可解；限时倒计时由页面 tick 驱动、切后台冻结；撤销回退灯态但不返还步数，每局 3 次；最佳记录与累计埋点脏标记延迟落盘。',
    footer: { meta: ['2026-11-02', '3 min'], link: '开始挑战' },
  },
  {
    title: '连连看',
    techTags: ['DOM', 'React Hooks', 'Puzzle'],
    keywords: ['LinkLink', '连连看', '配对', '连通', '触控', '消除'],
    to: '/lianliankan',
    span: '3',
    desc: '点两张相同的图案，路径不超过两次转弯即可消除，6×6 / 6×7 / 6×8 三档限时清盘',
    practice: '引擎与页面壳解耦：BFS 判定 ≤2 转弯连通（支持绕出棋盘边界）、成对生成与可解性校验、无解自动洗牌；倒计时由页面 tick 驱动、切后台冻结；最佳记录与累计埋点脏标记延迟落盘。',
    footer: { meta: ['2026-11-03', '3 min'], link: '开始挑战' },
  },
  {
    title: '四连棋',
    techTags: ['DOM', 'React Hooks', 'AI'],
    keywords: ['Connect4', '四连棋', '棋盘', 'AI', '连子', '对战'],
    to: '/connect4',
    span: '3',
    desc: '6×7 棋盘轮流落子，先连成四子一线者获胜；轻松 / 挑战 / 专家三档 AI，3 分钟限时',
    practice: '引擎与页面壳解耦：每步在 6×7 棋盘上枚举 69 个四连窗口判胜负，AI 按难度分级决策（专家档向前算 4 步），电脑落子前有思考延迟；倒计时由页面 tick 驱动、切后台冻结；最佳记录按难度分别落盘。',
    footer: { meta: ['2026-11-03', '3 min'], link: '开始挑战' },
  },
  {
    title: '推箱子',
    techTags: ['DOM', 'React Hooks', 'Puzzle'],
    keywords: ['Sokoban', '推箱子', '网格', '撤销', '滑动', '益智'],
    to: '/sokoban',
    span: '3',
    desc: '12 关网格推箱：三档限时 120 / 150 / 180 秒，把箱子推到目标点过关，支持无限撤销与重开',
    practice: '引擎与页面壳解耦：12 关均经独立 BFS 求解器验证可通关，par 即最小步数；每次有效移动入撤销栈并完整回退玩家/箱子/步数/推箱数；倒计时由页面 tick 驱动、切后台冻结；通关寄语走一言 API，超时降级本地句子池并按日缓存；最佳记录与累计埋点脏标记延迟落盘。',
    footer: { meta: ['2026-11-05', '3 min'], link: '开始挑战' },
  },
  {
    title: '黑白棋',
    techTags: ['DOM', 'React Hooks', 'Board Game'],
    keywords: ['Reversi', '黑白棋', '翻转', '夹吃', '棋盘', '对战'],
    to: '/reversi',
    span: '3',
    desc: '8×8 黑白棋：点按合法空格夹吃翻转，终局子多者胜；轻松 / 挑战 / 专家三档 AI，3 分钟限时',
    practice: '引擎与页面壳解耦：八方向夹吃扫描、对手无子自动跳过、双方无子按棋子数结算；AI 按难度分级（专家档 alpha-beta 向前算 3 步），电脑落子前有 520ms 思考延迟；150ms 落子节流；倒计时由页面 tick 驱动、切后台冻结；最佳记录按难度分别落盘。',
    footer: { meta: ['2026-11-07', '3 min'], link: '开始挑战' },
  },
  {
    title: '扫雷',
    techTags: ['DOM', 'React Hooks', 'Puzzle'],
    keywords: ['Minesweeper', '扫雷', '雷区', '插旗', '撤销', '逻辑'],
    to: '/minesweeper',
    span: '3',
    desc: '7×7 / 8×8 / 8×10 三档雷区（8~20 颗雷）：首点安全、数字提示、触屏标记插旗，撤销最多 3 次',
    practice: '引擎与页面壳解耦：首次翻开排除首点及其八邻域后才布雷，空白格洪泛展开；翻开/插旗操作入撤销栈，回退首次翻开会重置雷区与计时；倒计时由页面 tick 驱动、切后台冻结；最佳记录与累计埋点脏标记延迟落盘。',
    footer: { meta: ['2026-11-08', '3 min'], link: '开始挑战' },
  },
  {
    title: '迷宫寻路',
    techTags: ['DOM', 'React Hooks', 'Puzzle'],
    keywords: ['Maze', '迷宫', '寻路', '滑动', '步数', '随机'],
    to: '/maze',
    span: '3',
    desc: '每局随机生成 5×5 / 6×6 / 7×7 完美迷宫：单指滑动、点按相邻格或方向键移动，步数越少分越高',
    practice: '引擎与页面壳解耦：DFS 回溯生成保证全格连通的完美迷宫，BFS 最短路作为参考步数 par；四方向移动 60ms 节流，撞墙不计步；每局 3 次提示并扣分；生成中 / 无记录 / 生成失败三态完整；倒计时由页面 tick 驱动、切后台冻结；最佳记录与累计埋点脏标记延迟落盘。',
    footer: { meta: ['2026-11-09', '3 min'], link: '开始挑战' },
  },
]

const PIPELINE = [
  { num: '01', title: '需求理解', desc: 'Agent 解析自然语言指令，拆解为可执行子任务' },
  { num: '02', title: '代码生成', desc: '自动创建/修改组件、样式、路由，热更新即时验证' },
  { num: '03', title: '浏览器自测', desc: 'Headless 浏览器逐页点击，截图像素级校验渲染结果' },
  { num: '04', title: '构建部署', desc: '一键打包、分包优化、Nginx 配置，产物可直接上线' },
]

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

// 站点标题：品牌名取自导航栏，后缀为站点定位
const SITE_TITLE = 'React App · 前端作品集'

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
 * 四态：loading "…"占位（不可点击）/ error 提示（可点击定位）/ ok 温度+图标+城市
 *       / stale 缓存温度+图标+城市+「N 分钟前」，与卡片降级态同步
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

  if (summary.kind === 'stale') {
    return (
      <div className="bento-stat bento-stat-weather">
        <button
          type="button"
          className="bento-stat-weather-btn"
          onClick={handleClick}
          aria-label={`缓存天气 ${summary.temp}°C ${summary.desc}，数据为 ${summary.ageMin} 分钟前，点击查看天气详情`}
        >
          <span className="bento-stat-num" aria-hidden="true">
            {summary.temp}°C {summary.icon}
          </span>
          <span className="bento-stat-label" aria-hidden="true">
            {summary.city || '实时天气'}
            <span className="bento-stat-weather-age">{summary.ageMin} 分钟前</span>
          </span>
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

  // 首页标题（与 index.html 保持一致，返回首页时覆盖其他页面留下的 title）
  useEffect(() => {
    document.title = SITE_TITLE
  }, [])

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
        <h2 className="bento-section-title bento-span-12">
          <span className="bento-card-num">01</span> Agent 工作流
        </h2>

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
        <h2 className="bento-section-title bento-span-12">
          <span className="bento-card-num">02</span> Agent 生成的作品
        </h2>

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

        {/* 今日游戏挑战：按日期确定性从已有小游戏轮换一款 + 一言今日一句 */}
        <h2 className="bento-section-title bento-span-12">
          <span className="bento-card-num">03</span> 今日游戏挑战
        </h2>
        <DailyChallenge />

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
            <AnimatedNumber value={ENTRIES.length} />
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
