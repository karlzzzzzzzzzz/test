import { NavLink, Link } from 'react-router-dom'
import viteLogo from '../assets/vite.svg'

function Navbar() {
  return (
    <header className="navbar">
      <Link to="/" className="brand">
        <img src={viteLogo} alt="Vite logo" />
        <span>React App</span>
      </Link>
      <nav className="nav-links">
        <NavLink to="/index.html" end>
          首页
        </NavLink>
        <NavLink to="/game">飞机大战</NavLink>
        <NavLink to="/resume">简历</NavLink>
        <NavLink to="/about">关于</NavLink>
      </nav>
    </header>
  )
}

export default Navbar
