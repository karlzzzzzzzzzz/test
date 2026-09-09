import { useEffect, useRef } from 'react'

/**
 * 鼠标轨迹特效：
 * - 光晕：径向渐变圆形，rAF 缓动跟随鼠标（背景氛围）
 * - 关键词粒子：鼠标移动时在周围随机位置冒出 AI Coding 关键词，
 *   大小/位置/内容随机，向上飘动并逐渐淡出消失
 * - hover 到可交互元素时光晕放大、文字变紫色
 * 全部绘制在一个独立 canvas 上，pointer-events:none，不影响页面交互
 */
const KEYWORDS = [
  'VibeCode', 'AgentCode', 'CodeGen', 'Complete',
  'PromptEng', 'CtxEng', 'Harness', 'LoopEng',
  'RAG', 'MultiAgent', 'AST', 'CtxWin',
  'IDEPlugin', 'CLIAgent', 'Copilot', 'Cursor',
  'ClaudeCode', 'CodeReview',
]

function MouseTrail() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = window.innerWidth
    let height = window.innerHeight

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    // 鼠标目标位置
    const target = { x: width / 2, y: height / 2 }
    // 光晕缓动位置
    const glow = { x: target.x, y: target.y }
    const GLOW_EASE = 0.12

    // 文字粒子
    const particles = []
    const MAX_PARTICLES = 40

    // 粒子生成节流：最小间隔（毫秒），降低频率避免过密
    const EMIT_INTERVAL = 66
    let lastEmit = 0

    // 当前是否 hover 在可交互元素上
    let hovering = false

    const pickKeyword = () =>
      KEYWORDS[Math.floor(Math.random() * KEYWORDS.length)]

    const onMove = (e) => {
      target.x = e.clientX
      target.y = e.clientY

      // 按时间间隔节流：每隔 EMIT_INTERVAL 才生成一个粒子
      const now = performance.now()
      if (now - lastEmit < EMIT_INTERVAL) return
      if (particles.length >= MAX_PARTICLES) return
      lastEmit = now

      // 在鼠标周围随机偏移位置生成
      const offsetX = (Math.random() - 0.5) * 60
      const offsetY = (Math.random() - 0.5) * 30
      // 朝随机方向抛出（随机角度 + 随机初速度）
      const angle = Math.random() * Math.PI * 2
      const speed = 1.2 + Math.random() * 2.8
      particles.push({
        x: e.clientX + offsetX,
        y: e.clientY + offsetY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.2,
        life: 1,
        text: pickKeyword(),
        fontSize: 8 + Math.random() * 10,
        rotation: (Math.random() - 0.5) * 0.4,
      })

      const el = e.target
      hovering = !!(el && el.closest && el.closest('a, button, [role="button"]'))
    }

    const onLeave = () => {
      target.x = -9999
      target.y = -9999
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('mouseleave', onLeave)
    window.addEventListener('resize', resize)

    let rafId

    const render = () => {
      ctx.clearRect(0, 0, width, height)

      // 光晕缓动跟随
      glow.x += (target.x - glow.x) * GLOW_EASE
      glow.y += (target.y - glow.y) * GLOW_EASE

      const glowRadius = hovering ? 220 : 150
      const gradient = ctx.createRadialGradient(
        glow.x, glow.y, 0,
        glow.x, glow.y, glowRadius,
      )
      gradient.addColorStop(0, hovering ? 'rgba(170, 59, 255, 0.16)' : 'rgba(170, 59, 255, 0.09)')
      gradient.addColorStop(0.4, 'rgba(170, 59, 255, 0.04)')
      gradient.addColorStop(1, 'rgba(170, 59, 255, 0)')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(glow.x, glow.y, glowRadius, 0, Math.PI * 2)
      ctx.fill()

      // 关键词文字粒子
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.vy += 0.09 // 重力加速度，使关键词向下坠落
        p.x += p.vx
        p.y += p.vy
        p.life -= 0.008 // 淡出速度（值越小存活越久）

        if (p.life <= 0) {
          particles.splice(i, 1)
          continue
        }

        ctx.save()
        ctx.globalAlpha = p.life * 0.85
        ctx.font = `600 ${p.fontSize}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = hovering ? '#aa3bff' : '#6a5cff'
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        ctx.fillText(p.text, 0, 0)
        ctx.restore()
      }
      ctx.globalAlpha = 1

      rafId = requestAnimationFrame(render)
    }
    rafId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="mouse-trail"
      aria-hidden="true"
    />
  )
}

export default MouseTrail
