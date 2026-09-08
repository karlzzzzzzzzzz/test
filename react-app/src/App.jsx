import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import Home from './pages/Home'
import About from './pages/About'
import Resume from './pages/Resume'
import Pomodoro from './pages/Pomodoro'
import NotFound from './pages/NotFound'
import './App.css'

// 游戏页含 three.js，体积较大，按需加载以减小首屏体积
const Game = lazy(() => import('./pages/Game'))

function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/index.html" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/resume" element={<Resume />} />
        <Route path="/pomodoro" element={<Pomodoro />} />
        <Route
          path="/game"
          element={
            <Suspense fallback={<div className="game-loading">加载中…</div>}>
              <Game />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
