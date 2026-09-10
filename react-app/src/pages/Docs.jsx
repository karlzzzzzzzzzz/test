import { Link } from 'react-router-dom'
import { docs } from '../docs/registry'
import './Docs.css'

// 技术文档中心：文档列表
export default function Docs() {
  return (
    <div className="page docs-page">
      <header className="docs-header">
        <p className="docs-eyebrow">TECH DOCS</p>
        <h1>技术文档</h1>
        <p className="docs-subtitle">学习笔记与实战手册，持续更新</p>
      </header>

      <div className="docs-list">
        {docs.map((doc) => (
          <Link key={doc.slug} to={`/docs/${doc.slug}`} className="doc-card">
            <div className="doc-card-meta">
              <span className="doc-card-date">{doc.date}</span>
              <span className="doc-card-dot">·</span>
              <span className="doc-card-read">{doc.readTime}</span>
            </div>
            <h2 className="doc-card-title">{doc.title}</h2>
            <p className="doc-card-summary">{doc.summary}</p>
            <div className="doc-card-footer">
              <div className="doc-card-tags">
                {doc.tags.map((tag) => (
                  <span key={tag} className="doc-tag">
                    {tag}
                  </span>
                ))}
              </div>
              <span className="doc-card-link">
                阅读全文 <span aria-hidden>→</span>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
