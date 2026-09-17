import { useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import viteLogo from '../assets/vite.svg'

function Navbar() {
  const [open, setOpen] = useState(false)

  const close = () => setOpen(false)

  return (
    <header className="navbar">
      <Link to="/" className="brand" onClick={close}>
        <img src={viteLogo} alt="Vite logo" />
        <span>React App</span>
      </Link>

      <button
        className="nav-toggle"
        aria-label="菜单"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="nav-toggle-bar" />
        <span className="nav-toggle-bar" />
        <span className="nav-toggle-bar" />
      </button>

      <nav className={`nav-links ${open ? 'nav-open' : ''}`}>
        <NavLink to="/index.html" end onClick={close}>首页</NavLink>
        <NavLink to="/game" onClick={close}>飞机大战</NavLink>
        <NavLink to="/pomodoro" onClick={close}>番茄钟</NavLink>
        <NavLink to="/resume" onClick={close}>简历</NavLink>
        <NavLink to="/docs" onClick={close}>技术文档</NavLink>
        <NavLink to="/about" onClick={close}>关于</NavLink>
      </nav>
    </header>
  )
}

export default Navbar
