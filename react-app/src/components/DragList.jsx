import { useState } from 'react';

export default function DragContainer(props) {
  const [list, setList] = useState([...props.children]);
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
  return (
    <div {...props}>
      {list.map((child, index) =>
        <div key={child.key} onDragEnter={(e)=>{e.preventDefault();hoverIndex = index}} onDragOver={(e)=>e.preventDefault()} className='cursor-grab-hover' draggable onDragStart={(e) => handleDragStart(e, index)} onDragEnd={handleDragEnd}>
          {child}
        </div>
      )}
    </div>
  )
}
