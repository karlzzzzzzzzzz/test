import { useRef, useState } from 'react'

/**
 * 拖拽列表：松手后把拖拽项插入到目标位置（插入式排序，非两两交换）。
 * 键盘 Alt+↑/↓ 上移 / 下移一位，焦点跟随被移动项，结果通过 aria-live 播报。
 */
export default function DragContainer(props) {
  const [list, setList] = useState([...props.children])
  const [announce, setAnnounce] = useState('')
  const listRef = useRef(null)
  const dragIndexRef = useRef(-1)
  const hoverIndexRef = useRef(-1)

  const moveItem = (from, to) => {
    if (from < 0 || to < 0 || from === to || to >= list.length) return
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setList(next)
    setAnnounce(`${list[from]?.key ?? '项目'} 已移动到第 ${to + 1} 位`)
    requestAnimationFrame(() => {
      const node = listRef.current && listRef.current.children[to]
      if (node) node.focus()
    })
  }

  const handleDragStart = (e, index) => {
    e.dataTransfer.effectAllowed = 'move'
    dragIndexRef.current = index
  }

  const handleDragEnd = () => {
    const from = dragIndexRef.current
    const to = hoverIndexRef.current
    dragIndexRef.current = -1
    hoverIndexRef.current = -1
    moveItem(from, to)
  }

  // 键盘：Alt+↑/↓ 上移 / 下移一位（与拖拽的插入式排序一致）
  const handleKeyDown = (e, index) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    moveItem(index, e.key === 'ArrowUp' ? index - 1 : index + 1)
  }

  return (
    <div {...props} ref={listRef}>
      {list.map((child, index) => (
        <div
          key={child.key}
          tabIndex={0}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onDragEnter={(e) => { e.preventDefault(); hoverIndexRef.current = index }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
          className="cursor-grab-hover"
          draggable
          onDragStart={(e) => handleDragStart(e, index)}
          onDragEnd={handleDragEnd}
        >
          {child}
        </div>
      ))}
      {/* 读屏播报区：移动结果对视觉隐藏 */}
      <span className="sr-only" role="status" aria-live="polite">{announce}</span>
    </div>
  )
}
