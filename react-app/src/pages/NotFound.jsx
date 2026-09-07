import { Link } from 'react-router-dom'

function NotFound() {
  return (
    <section className="page">
      <h1>404</h1>
      <p className="page-desc">抱歉，你访问的页面不存在。</p>
      <Link to="/index.html" className="cta-link">
        ← 返回首页
      </Link>
    </section>
  )
}

export default NotFound
