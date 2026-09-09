import { Link } from 'react-router-dom'
import MouseTrail from '../components/MouseTrail'
import './Home.css'

const SKILLS = [
  'React', 'Vue', 'TypeScript', 'JavaScript',
  'Three.js', 'Vite', 'Node.js', 'CSS', 'Webpack',
]

const WORKS = [
  {
    title: '飞机大战',
    desc: '基于 Three.js 的 3D 射击游戏，含粒子爆炸、星空穿梭、尾焰特效',
    tags: ['Three.js', 'Canvas', 'Game'],
    to: '/game',
    span: 'bento-span-6',
  },
  {
    title: '番茄时钟',
    desc: '番茄工作法计时器，专注/短休/长休循环',
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
]

function Home() {
  return (
    <div className="home-page">
      <MouseTrail />

      <div className="bento-grid">
        {/* 关于我（大卡） */}
        <section className="bento-card bento-about bento-span-8">
          <p className="bento-eyebrow">你好，我是</p>
          <h1 className="bento-name">前端工程师</h1>
          <p className="bento-tagline">
            专注 Web 交互与可视化，把想法变成可点击、可游玩、可打印的东西
          </p>
          <div className="bento-cta">
            <Link to="/resume" className="bento-btn bento-btn-primary">
              查看简历 →
            </Link>
            <Link to="/game" className="bento-btn">
              开始游戏
            </Link>
          </div>
        </section>

        {/* 技术栈（小卡） */}
        <section className="bento-card bento-skills bento-span-4">
          <h2 className="bento-card-title">
            <span className="bento-card-num">01</span> 技术栈
          </h2>
          <div className="bento-skill-list">
            {SKILLS.map((s) => (
              <span key={s} className="bento-skill">{s}</span>
            ))}
          </div>
        </section>

        {/* 精选作品标题 */}
        <div className="bento-section-title bento-span-12">
          <span className="bento-card-num">02</span> 精选作品
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
            <span className="bento-stat-num">3</span>
            <span className="bento-stat-label">个作品</span>
          </div>
          <div className="bento-stat-divider" />
          <div className="bento-stat">
            <span className="bento-stat-num">1</span>
            <span className="bento-stat-label">个游戏</span>
          </div>
          <div className="bento-stat-divider" />
          <div className="bento-stat">
            <span className="bento-stat-num">1</span>
            <span className="bento-stat-label">份简历</span>
          </div>
          <div className="bento-stat-divider" />
          <div className="bento-stat bento-stat-contact">
            <a href="mailto:hello@example.com" className="bento-stat-mail">
              hello@example.com →
            </a>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default Home
