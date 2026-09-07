import { useState } from 'react'
import { Link } from 'react-router-dom'
import heroImg from '../assets/hero.png'
import reactLogo from '../assets/react.svg'
import viteLogo from '../assets/vite.svg'

function Home() {
  const [count, setCount] = useState(0)

  return (
    <>
      <section id="center">
        <div className="hero">
          <img src={heroImg} className="base" width="170" height="179" alt="" />
          <img src={reactLogo} className="framework" alt="React logo" />
          <img src={viteLogo} className="vite" alt="Vite logo" />
        </div>
        <div>
          <h1>欢迎来到首页</h1>
          <p>
            这是一个基于 <code>Vite</code> + <code>React</code> +{' '}
            <code>React Router</code> 的项目
          </p>
        </div>
        <button
          type="button"
          className="counter"
          onClick={() => setCount((count) => count + 1)}
        >
          Count is {count}
        </button>
        <div className="home-actions">
          <Link to="/game" className="cta-link cta-primary">
            开始游戏 →
          </Link>
          <Link to="/resume" className="cta-link">
            在线简历
          </Link>
          <Link to="/about" className="cta-link">
            了解更多
          </Link>
        </div>
      </section>

      <div className="ticks"></div>

      <section id="next-steps">
        <div id="docs">
          <h2>快速开始</h2>
          <p>编辑 src/pages/Home.jsx 即可修改本页</p>
          <ul>
            <li>
              <a href="https://vite.dev/" target="_blank" rel="noreferrer">
                <img className="logo" src={viteLogo} alt="" />
                探索 Vite
              </a>
            </li>
            <li>
              <a href="https://react.dev/" target="_blank" rel="noreferrer">
                <img className="button-icon" src={reactLogo} alt="" />
                React 文档
              </a>
            </li>
          </ul>
        </div>
        <div id="social">
          <h2>小游戏</h2>
          <p>Three.js 打造，带粒子爆炸特效的飞机大战</p>
          <ul>
            <li>
              <Link to="/game" className="router-link">
                玩「飞机大战」
              </Link>
            </li>
            <li>
              <Link to="/not-exist" className="router-link">
                触发 404 页
              </Link>
            </li>
          </ul>
        </div>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}

export default Home
