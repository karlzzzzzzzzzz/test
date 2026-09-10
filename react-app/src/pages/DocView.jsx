import { useEffect, useMemo } from 'react'
import { Link, useParams, useLocation } from 'react-router-dom'
import { marked } from 'marked'
import { getDoc } from '../docs/registry'
import './Docs.css'

marked.setOptions({ gfm: true, breaks: false })

// 技术文档详情：渲染 Markdown
export default function DocView() {
  const { slug } = useParams()
  const location = useLocation()
  const doc = getDoc(slug)

  const html = useMemo(() => (doc ? marked.parse(doc.content) : ''), [doc])

  useEffect(() => {
    document.title = doc ? `${doc.title} - 技术文档` : '文档未找到'
    return () => {
      document.title = '我的作品集'
    }
  }, [doc])

  // 切换文档滚到顶部；带锚点时滚动到对应章节
  useEffect(() => {
    if (location.hash) {
      const id = location.hash.slice(1)
      // 等待 markdown 渲染完成
      const timer = setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
      }, 50)
      return () => clearTimeout(timer)
    }
    window.scrollTo(0, 0)
  }, [slug, location.hash])

  if (!doc) {
    return (
      <div className="page docs-page">
        <div className="doc-notfound">
          <h1>文档未找到</h1>
          <p>该文档不存在或已被移动。</p>
          <Link to="/docs" className="doc-back-link">
            ← 返回文档列表
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page docs-page doc-view-page">
      <nav className="doc-breadcrumb">
        <Link to="/docs">技术文档</Link>
        <span aria-hidden>/</span>
        <span>{doc.title}</span>
      </nav>

      <article
        className="markdown-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <div className="doc-footer">
        <Link to="/docs" className="doc-back-link">
          ← 返回文档列表
        </Link>
      </div>
    </div>
  )
}
