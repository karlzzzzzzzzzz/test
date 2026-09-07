import { Link } from 'react-router-dom'
import reactLogo from '../assets/react.svg'
import viteLogo from '../assets/vite.svg'

function About() {
  return (
    <section className="page">
      <h1>关于本项目</h1>
      <p className="page-desc">
        本项目使用以下技术栈搭建，路由由 React Router 管理。
      </p>
      <div className="card-grid">
        <div className="card">
          <img src={viteLogo} alt="Vite logo" className="card-logo" />
          <h2>Vite</h2>
          <p>下一代前端构建工具，提供极速的开发服务器和 HMR。</p>
        </div>
        <div className="card">
          <img src={reactLogo} alt="React logo" className="card-logo" />
          <h2>React</h2>
          <p>用于构建用户界面的 JavaScript 库。</p>
        </div>
        <div className="card">
          <h2>React Router</h2>
          <p>React 应用的声明式路由库，支持嵌套路由与动态参数。</p>
        </div>
      </div>
      <Link to="/index.html" className="cta-link">
        ← 返回首页
      </Link>
    </section>
  )
}

export default About
