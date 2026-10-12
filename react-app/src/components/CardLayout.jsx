import './CardLayout.css'

const VALID_SPANS = ['3', '4', '6', '8', '12']

/**
 * CardLayout —— 通用卡片布局组件
 * 三段结构：标题区（含技术标签）→ 内容区 → 底部区
 *
 * Props:
 *   title     string    必填，卡片标题（渲染为 h3）
 *   techTags  string[] 可选，技术标签数组，渲染在标题区第二行
 *   children  ReactNode 可选，内容区内容
 *   footer    ReactNode 可选，底部区内容；不传则不渲染底部区
 *   span      string    可选，Bento 网格占位宽度 '3'|'4'|'6'|'8'|'12'，默认 '4'
 *   className string    可选，附加类名
 */
export default function CardLayout({
  title,
  techTags = [],
  children,
  footer,
  span = '4',
  className = '',
  ...rest
}) {
  const safeTitle = title || '未命名卡片'
  const validSpan = VALID_SPANS.includes(span) ? span : '4'
  // 过滤空字符串标签项
  const tags = Array.isArray(techTags)
    ? techTags.filter((t) => typeof t === 'string' && t.trim() !== '')
    : []

  if (!title) {
    console.warn('CardLayout requires a title prop')
  }

  return (
    <article
      className={`cl-card bento-span-${validSpan} ${className}`.trim()}
      role="group"
      aria-label={safeTitle}
      {...rest}
    >
      {/* ===== 标题区 ===== */}
      <div className="cl-head" role="group" aria-label={safeTitle}>
        <div className="cl-head-row">
          <h3 className="cl-title">{safeTitle}</h3>
          <span className="cl-icon" aria-hidden="true">◆</span>
        </div>
        {tags.length > 0 && (
          <div className="cl-tech-tags">
            {tags.map((tag) => (
              <span key={tag} className="cl-tech-tag" aria-hidden="true">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ===== 内容区 ===== */}
      <div className="cl-body">{children}</div>

      {/* ===== 底部区（footer 不传则不渲染） ===== */}
      {footer != null && <div className="cl-foot">{footer}</div>}
    </article>
  )
}
