import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SpaceShooter } from '../game/SpaceShooter'
import './Game.css'

function Game() {
  const mountRef = useRef(null)
  const engineRef = useRef(null)
  const [screen, setScreen] = useState('start') // start | playing | paused | over
  const [score, setScore] = useState(0)
  const [health, setHealth] = useState(3)
  const [finalScore, setFinalScore] = useState(0)
  const screenRef = useRef('start')

  const changeScreen = (s) => {
    screenRef.current = s
    setScreen(s)
  }

  useEffect(() => {
    const engine = new SpaceShooter(mountRef.current, {
      onScore: (s) => setScore(s),
      onHealth: (h) => setHealth(h),
      onGameOver: (s) => {
        setFinalScore(s)
        changeScreen('over')
      },
      // 切后台 / 窗口失焦 / WebGL 上下文丢失时自动暂停
      onPause: () => {
        if (screenRef.current === 'playing') changeScreen('paused')
      },
    })
    engineRef.current = engine
    return () => engine.dispose()
  }, [])

  const handleStart = () => {
    engineRef.current?.start()
    changeScreen('playing')
  }

  const handleResume = () => {
    engineRef.current?.resume()
    changeScreen('playing')
  }

  return (
    <div className="game-page">
      <div ref={mountRef} className="game-canvas" />

      {/* 顶部 HUD */}
      <div className="game-hud">
        <Link to="/index.html" className="game-back">
          ← 返回首页
        </Link>
        <div className="game-score">得分：{score}</div>
        <div className="game-health">
          {[0, 1, 2].map((i) => (
            <span key={i} className={i < health ? 'heart on' : 'heart'}>
              ♥
            </span>
          ))}
        </div>
      </div>

      {/* 开始界面 */}
      {screen === 'start' && (
        <div className="game-overlay">
          <div className="game-panel">
            <h1>飞机大战</h1>
            <p className="game-tip">
              移动鼠标（或方向键 / WASD）控制飞机，飞机会自动射击。
              <br />
              击毁敌机得分；敌机撞到你或突破防线都会损失生命，共 3 点生命。
            </p>
            <button type="button" className="game-btn" onClick={handleStart}>
              开始游戏
            </button>
          </div>
        </div>
      )}

      {/* 暂停界面（切回标签页后点击继续） */}
      {screen === 'paused' && (
        <div className="game-overlay">
          <div className="game-panel">
            <h1>已暂停</h1>
            <p className="game-tip">
              检测到你切换了页面，游戏已自动暂停。
              <br />
              点击继续回到战斗。
            </p>
            <button type="button" className="game-btn" onClick={handleResume}>
              继续游戏
            </button>
            <Link to="/index.html" className="game-home-link">
              返回首页
            </Link>
          </div>
        </div>
      )}

      {/* 结束界面 */}
      {screen === 'over' && (
        <div className="game-overlay">
          <div className="game-panel">
            <h1>游戏结束</h1>
            <p className="game-final">最终得分：{finalScore}</p>
            <button type="button" className="game-btn" onClick={handleStart}>
              再来一局
            </button>
            <Link to="/index.html" className="game-home-link">
              返回首页
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

export default Game
