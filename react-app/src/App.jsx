import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import Home from './pages/Home'
import About from './pages/About'
import Resume from './pages/Resume'
import Pomodoro from './pages/Pomodoro'
import NotFound from './pages/NotFound'
import './App.css'

// 游戏页含 three.js，体积较大，按需加载以减小首屏体积
const Game = lazy(() => import('./pages/Game'))
// 2048 小游戏，按需加载（与飞机大战引擎解耦，避免互相影响）
const Game2048 = lazy(() => import('./pages/Game2048'))
// 俄罗斯方块（位运算引擎 + Canvas 2D），按需加载
const Tetris = lazy(() => import('./pages/Tetris'))
// 贪吃蛇（输入缓冲引擎 + Canvas 2D），按需加载（独立分包）
const Snake = lazy(() => import('./pages/Snake'))
// 打砖块（固定步长物理引擎 + Canvas 2D），按需加载（独立分包）
const Breakout = lazy(() => import('./pages/Breakout'))
// 记忆翻牌（纯 DOM + 无障碍 + 触控），按需加载（独立分包）
const Memory = lazy(() => import('./pages/Memory'))
// 打地鼠（纯 DOM + 键盘无障碍 + 触控），按需加载（独立分包）
const Whack = lazy(() => import('./pages/Whack'))
// 数字华容道（纯 DOM + 触控滑动 + 时间戳计时），按需加载（独立分包）
const Puzzle = lazy(() => import('./pages/Puzzle'))
// 关灯挑战（纯 DOM + 触控点按 + 可解性打乱），按需加载（独立分包）
const LightsOut = lazy(() => import('./pages/LightsOut'))
// 四连棋（纯 DOM + 触控点按 + 三档 AI），按需加载（独立分包）
const Connect4 = lazy(() => import('./pages/Connect4'))
// 南昌旅游介绍页（图文静态页 + 图集灯箱），按需加载
const Nanchang = lazy(() => import('./pages/Nanchang'))
// 文档页依赖 marked 解析 markdown，按需加载
const Docs = lazy(() => import('./pages/Docs'))
const DocView = lazy(() => import('./pages/DocView'))

const pageLoading = <div className="game-loading">加载中…</div>

function App() {
  return (
    <HashRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/resume" element={<Resume />} />
        <Route path="/pomodoro" element={<Pomodoro />} />
        <Route
          path="/game"
          element={
            <Suspense fallback={pageLoading}>
              <Game />
            </Suspense>
          }
        />
        <Route
          path="/2048"
          element={
            <Suspense fallback={pageLoading}>
              <Game2048 />
            </Suspense>
          }
        />
        <Route
          path="/tetris"
          element={
            <Suspense fallback={pageLoading}>
              <Tetris />
            </Suspense>
          }
        />
        <Route
          path="/snake"
          element={
            <Suspense fallback={pageLoading}>
              <Snake />
            </Suspense>
          }
        />
        <Route
          path="/breakout"
          element={
            <Suspense fallback={pageLoading}>
              <Breakout />
            </Suspense>
          }
        />
        <Route
          path="/memory"
          element={
            <Suspense fallback={pageLoading}>
              <Memory />
            </Suspense>
          }
        />
        <Route
          path="/whack"
          element={
            <Suspense fallback={pageLoading}>
              <Whack />
            </Suspense>
          }
        />
        <Route
          path="/puzzle"
          element={
            <Suspense fallback={pageLoading}>
              <Puzzle />
            </Suspense>
          }
        />
        <Route
          path="/lightsout"
          element={
            <Suspense fallback={pageLoading}>
              <LightsOut />
            </Suspense>
          }
        />
        <Route
          path="/connect4"
          element={
            <Suspense fallback={pageLoading}>
              <Connect4 />
            </Suspense>
          }
        />
        <Route
          path="/nanchang"
          element={
            <Suspense fallback={pageLoading}>
              <Nanchang />
            </Suspense>
          }
        />
        <Route
          path="/docs"
          element={
            <Suspense fallback={pageLoading}>
              <Docs />
            </Suspense>
          }
        />
        <Route
          path="/docs/:slug"
          element={
            <Suspense fallback={pageLoading}>
              <DocView />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </HashRouter>
  )
}

export default App
