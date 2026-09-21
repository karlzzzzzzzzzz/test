import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SpaceShooter } from '../game/SpaceShooter'
import { fetchTopScores, submitScore } from '../api/leaderboard'
import './Game.css'

function Game() {
  const mountRef = useRef(null)
  const engineRef = useRef(null)
  const [screen, setScreen] = useState('start') // start | playing | paused | over
  const [score, setScore] = useState(0)
  const [health, setHealth] = useState(3)
  const [finalScore, setFinalScore] = useState(0)
  const [board, setBoard] = useState([])
  const [boardLoading, setBoardLoading] = useState(true)
  const [playerName, setPlayerName] = useState('')
  const [submitState, setSubmitState] = useState('idle')
  const [myRank, setMyRank] = useState(null)
  const screenRef = useRef('start')
  const elapsedRef = useRef(0)

  const changeScreen = (s) => {
    screenRef.current = s
    setScreen(s)
  }

  useEffect(() => {
    const engine = new SpaceShooter(mountRef.current, {
      onScore: (s) => setScore(s),
      onHealth: (h) => setHealth(h),
      onGameOver: (s, elapsed) => {
        setFinalScore(s)
        elapsedRef.current = elapsed
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

  const loadBoard = async () => {
    setBoardLoading(true)
    try {
      setBoard(await fetchTopScores())
    } catch {
      setBoard([])
    } finally {
      setBoardLoading(false)
    }
  }

  useEffect(() => {
    setPlayerName(localStorage.getItem('game-player-name') || '')
    loadBoard()
  }, [])

  const handleSubmitScore = async () => {
    if (submitState === 'sending' || submitState === 'done') return
    const name = (playerName.trim() || '无名飞侠').slice(0, 12)
    localStorage.setItem('game-player-name', name)
    setSubmitState('sending')
    try {
      const { rank } = await submitScore(name, finalScore, elapsedRef.current)
      setMyRank(rank)
      setSubmitState('done')
      loadBoard()
    } catch {
      setSubmitState('error')
    }
  }

  const handleStart = () => {
    engineRef.current?.start()
    setSubmitState('idle')
    setMyRank(null)
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
          <div className="game-panels">
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
            <LeaderboardPanel board={board} loading={boardLoading} />
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
          <div className="game-panels">
            <div className="game-panel">
              <h1>游戏结束</h1>
              <p className="game-final">最终得分：{finalScore}</p>
              {finalScore > 0 && (
                <div className="game-submit">
                  {submitState === 'done' ? (
                    <p className="game-rank-line">
                      已上榜，当前排名：第 {myRank} 名
                    </p>
                  ) : (
                    <>
                      <input
                        className="game-name-input"
                        value={playerName}
                        maxLength={12}
                        placeholder="输入昵称上榜"
                        onChange={(e) => setPlayerName(e.target.value)}
                      />
                      <button
                        type="button"
                        className="game-btn game-btn-ghost"
                        onClick={handleSubmitScore}
                        disabled={submitState === 'sending'}
                      >
                        {submitState === 'sending' ? '提交中…' : '提交排行榜'}
                      </button>
                    </>
                  )}
                  {submitState === 'error' && (
                    <p className="game-submit-error">提交失败，请重试</p>
                  )}
                </div>
              )}
              <button type="button" className="game-btn" onClick={handleStart}>
                再来一局
              </button>
              <Link to="/index.html" className="game-home-link">
                返回首页
              </Link>
            </div>
            <LeaderboardPanel board={board} loading={boardLoading} />
          </div>
        </div>
      )}
    </div>
  )
}

function LeaderboardPanel({ board, loading }) {
  return (
    <div className="game-panel game-board-panel">
      <h2>排行榜 TOP 10</h2>
      {loading ? (
        <p className="game-board-empty">加载中…</p>
      ) : board.length === 0 ? (
        <p className="game-board-empty">虚位以待，等你上榜</p>
      ) : (
        <ol className="game-board-list">
          {board.map((row, i) => (
            <li key={row._id ?? i} className={i < 3 ? `top top-${i + 1}` : ''}>
              <span className="rank">{i + 1}</span>
              <span className="name">{row.name}</span>
              <span className="score">{row.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default Game