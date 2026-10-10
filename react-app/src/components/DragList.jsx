import { useRef, useState } from 'react';

export default function DragContainer(props) {
  const [list, setList] = useState([...props.children]);
  const [announce, setAnnounce] = useState('');
  const listRef = useRef(null);
  let hoverIndex = null, dragIndex = null
  const handleDragEnd = (e) => {
    // e.target.classList.remove('cursor-move');
    typeof hoverIndex === 'number' && typeof dragIndex === 'number' && hoverIndex !== dragIndex &&
      setList((preList) => {
        const next = [...preList];
        [next[dragIndex], next[hoverIndex]] = [next[hoverIndex], next[dragIndex]];
        return next;
      });
  }
  const handleDragStart = (e, index) => {
    e.dataTransfer.effectAllowed = "move";
    dragIndex = index;
  }
  // 键盘交换：Alt+↑/↓ 与相邻项交换位置（与鼠标拖拽的"交换"语义一致）
  const handleKeyDown = (e, index) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const targetIndex = e.key === 'ArrowUp' ? index - 1 : index + 1
    // 首项按↑ / 末项按↓：无操作
    if (targetIndex < 0 || targetIndex >= list.length) return
    const next = [...list];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setList(next)
    setAnnounce(`${list[index].key} 与 ${list[targetIndex].key} 已交换`)
    // 焦点跟随被移动的项
    requestAnimationFrame(() => {
      const node = listRef.current && listRef.current.children[targetIndex]
      node && node.focus()
    })
  }
  return (
    <div {...props} ref={listRef}>
      {list.map((child, index) =>
        <div key={child.key} tabIndex={0} onKeyDown={(e) => handleKeyDown(e, index)} onDragEnter={(e)=>{e.preventDefault();hoverIndex = index}} onDragOver={(e)=>e.preventDefault()} className='cursor-grab-hover' draggable onDragStart={(e) => handleDragStart(e, index)} onDragEnd={handleDragEnd}>
          {child}
        </div>
      )}
      {/* 读屏播报区：交换结果对视觉隐藏 */}
      <span className="sr-only" role="status" aria-live="polite">{announce}</span>
    </div>
  )
}
