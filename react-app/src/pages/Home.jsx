import { Link } from 'react-router-dom'
import MouseTrail from '../components/MouseTrail'
import Weather from '../components/Weather'
import './Home.css'

const SKILLS = [
  'VibeCode', 'AgentCode', 'CodeGen', 'PromptEng',
  'CtxEng', 'RAG', 'MultiAgent', 'CLIAgent',
  'React', 'Three.js', 'Vite',
]

const WORKS = [
  {
    title: '飞机大战',
    desc: 'AI Agent 从零构建的 Three.js 3D 射击游戏，含粒子爆炸、星空穿梭、切页自动暂停修复',
    tags: ['Three.js', 'AgentCode', 'Game'],
    to: '/game',
    span: 'bento-span-6',
  },
  {
    title: '番茄时钟',
    desc: 'Agent 生成的番茄工作法计时器，含模式自动流转与完成数持久化',
    tags: ['React', 'Hooks'],
    to: '/pomodoro',
    span: 'bento-span-3',
  },
  {
    title: '在线简历',
    desc: 'A4 尺寸个人简历，打印适配',
    tags: ['CSS Grid', 'A4'],
    to: '/resume',
    span: 'bento-span-3',
  },
  {
    title: '提示词工程文档',
    desc: 'Agent 检索网络资料后撰写并渲染的 Prompt Engineering 实战手册',
    tags: ['Markdown', 'Docs'],
    to: '/docs',
    span: 'bento-span-6',
  },
]

const PIPELINE = [
  { num: '01', title: '需求理解', desc: 'Agent 解析自然语言指令，拆解为可执行子任务' },
  { num: '02', title: '代码生成', desc: '自动创建/修改组件、样式、路由，热更新即时验证' },
  { num: '03', title: '浏览器自测', desc: 'Headless 浏览器逐页点击，截图像素级校验渲染结果' },
  { num: '04', title: '构建部署', desc: '一键打包、分包优化、Nginx 配置，产物可直接上线' },
]

function Home() {
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
            <Link to="/about" className="bento-btn">
              关于本项目
            </Link>
          </div>
        </section>

        {/* 右列：技术栈 + 本地天气 */}
        <div className="bento-span-4 bento-side-col">
          <section className="bento-card bento-skills">
            <h2 className="bento-card-title">
              <span className="bento-card-num">AI</span> 技术栈
            </h2>
            <div className="bento-skill-list">
              {SKILLS.map((s) => (
                <span key={s} className="bento-skill">{s}</span>
              ))}
            </div>
          </section>

          <Weather />
        </div>

        {/* Agent 工作流 */}
        <div className="bento-section-title bento-span-12">
          <span className="bento-card-num">01</span> Agent 工作流
        </div>

        {PIPELINE.map((p) => (
          <div key={p.num} className="bento-card bento-pipeline bento-span-3">
            <span className="bento-pipeline-num">{p.num}</span>
            <h3 className="bento-pipeline-title">{p.title}</h3>
            <p className="bento-pipeline-desc">{p.desc}</p>
          </div>
        ))}

        {/* 精选作品标题 */}
        <div className="bento-section-title bento-span-12">
          <span className="bento-card-num">02</span> Agent 生成的作品
        </div>

        {/* 作品卡片 */}
        {WORKS.map((w) => (
          <Link key={w.title} to={w.to} className={`bento-card bento-work ${w.span}`}>
            <div className="bento-work-top">
              <span className="bento-work-icon">◯</span>
              <span className="bento-work-arrow">→</span>
            </div>
            <h3 className="bento-work-title">{w.title}</h3>
            <p className="bento-work-desc">{w.desc}</p>
            <div className="bento-work-tags">
              {w.tags.map((t) => (
                <span key={t} className="bento-work-tag">{t}</span>
              ))}
            </div>
          </Link>
        ))}

        {/* 统计条 */}
        <footer className="bento-card bento-stats bento-span-12">
          <div className="bento-stat">
            <span className="bento-stat-num">100%</span>
            <span className="bento-stat-label">AI 生成代码</span>
          </div>
          <div className="bento-stat-divider" />
          <div className="bento-stat">
            <span className="bento-stat-num">0</span>
            <span className="bento-stat-label">行人工编码</span>
          </div>
          <div className="bento-stat-divider" />
          <div className="bento-stat">
            <span className="bento-stat-num">3</span>
            <span className="bento-stat-label">个功能模块</span>
          </div>
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
