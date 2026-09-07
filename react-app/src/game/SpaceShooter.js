import * as THREE from 'three'

// ===== 可调参数 =====
const PLAYER_Z = 12 // 玩家所在 z 平面
const CAMERA_Z = 32 // 相机 z 位置
const BULLET_SPEED = 75 // 子弹速度
const FIRE_INTERVAL = 0.16 // 自动射击间隔（秒）
const ENEMY_SPEED_BASE = 9 // 敌机基础速度
const PLAYER_SPEED = 24 // 键盘移动速度
const BOUND_Y = 11 // 纵向移动边界

/**
 * 单人飞机大战（Three.js）
 * 粒子效果：星空拖尾、引擎尾焰、击毁爆炸
 */
export class SpaceShooter {
  constructor(container, callbacks = {}) {
    this.container = container
    this.cb = callbacks
    this.running = false
    this.over = false

    // 游戏数据
    this.bullets = []
    this.enemies = []
    this.particles = []
    this.keys = {}
    this.pointer = { x: 0, y: 0 }
    this.fireTimer = 0
    this.spawnTimer = 0
    this.trailTimer = 0
    this.score = 0
    this.health = 3
    this.elapsed = 0
    this.shake = 0

    this._initScene()
    this._initPlayer()
    this._initStars()
    this._initSharedAssets()
    this._bindEvents()

    this.clock = new THREE.Clock()
    this._loop = this._loop.bind(this)
    this.rafId = requestAnimationFrame(this._loop)
  }

  // ---------- 场景初始化 ----------
  _initScene() {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0x05060f, 45, 110)

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 220)
    this.camera.position.set(0, 0, CAMERA_Z)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(w, h)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.container.appendChild(this.renderer.domElement)

    // 灯光
    this.scene.add(new THREE.AmbientLight(0x8899ff, 0.55))
    const dir = new THREE.DirectionalLight(0xffffff, 1.2)
    dir.position.set(5, 10, 20)
    this.scene.add(dir)
    this.playerLight = new THREE.PointLight(0x33ccff, 12, 30)
    this.scene.add(this.playerLight)

    this._updateBounds()
  }

  _initSharedAssets() {
    // 子弹：共享几何体与材质
    this.bulletGeo = new THREE.SphereGeometry(0.22, 8, 8)
    this.bulletMat = new THREE.MeshBasicMaterial({ color: 0x66f7ff })
    // 敌机：共享几何体与材质
    this.enemyGeo = new THREE.OctahedronGeometry(1.15, 0)
    this.enemyMat = new THREE.MeshStandardMaterial({
      color: 0xff4455,
      emissive: 0xff2233,
      emissiveIntensity: 0.7,
      roughness: 0.4,
      metalness: 0.3,
    })
  }

  // ---------- 玩家飞机 ----------
  _initPlayer() {
    this.player = new THREE.Group()

    // 机身（锥体，尖头朝 -z 即屏幕深处）
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x4fc3f7,
      emissive: 0x1a6fae,
      emissiveIntensity: 0.5,
      metalness: 0.6,
      roughness: 0.3,
    })
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.4, 12), bodyMat)
    body.rotation.x = -Math.PI / 2
    this.player.add(body)

    // 机翼
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x29b6f6,
      emissive: 0x0d47a1,
      emissiveIntensity: 0.4,
      metalness: 0.5,
      roughness: 0.4,
    })
    const wings = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.15, 0.9), wingMat)
    wings.position.z = 0.4
    this.player.add(wings)

    // 尾翼
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.1, 0.7), wingMat)
    tail.position.set(0, 0.55, 0.7)
    this.player.add(tail)

    // 引擎光球
    const engine = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffcc55 })
    )
    engine.position.z = 1.3
    this.player.add(engine)

    this.player.position.set(0, 0, PLAYER_Z)
    this.scene.add(this.player)
  }

  // ---------- 星空粒子背景 ----------
  _initStars() {
    const count = 900
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 90
      positions[i * 3 + 1] = (Math.random() - 0.5) * 55
      positions[i * 3 + 2] = -90 + Math.random() * 115
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({
      color: 0xbfd8ff,
      size: 0.32,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.stars = new THREE.Points(geo, mat)
    this.scene.add(this.stars)
    this.starCount = count
  }

  // ---------- 事件 ----------
  _bindEvents() {
    this._onPointerMove = (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect()
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
      const dist = CAMERA_Z - PLAYER_Z
      const halfH = Math.tan(THREE.MathUtils.degToRad(30)) * dist
      const halfW = halfH * this.camera.aspect
      this.pointer.x = THREE.MathUtils.clamp(ndcX * halfW, -this.boundX, this.boundX)
      this.pointer.y = THREE.MathUtils.clamp(ndcY * halfH, -BOUND_Y, BOUND_Y)
    }
    this._onKeyDown = (e) => {
      this.keys[e.key.toLowerCase()] = true
    }
    this._onKeyUp = (e) => {
      this.keys[e.key.toLowerCase()] = false
    }
    this._onResize = () => {
      const w = this.container.clientWidth || window.innerWidth
      const h = this.container.clientHeight || window.innerHeight
      if (!w || !h) return // 隐藏状态下容器尺寸可能为 0，跳过避免画布塌陷
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(w, h)
      this._updateBounds()
    }

    window.addEventListener('pointermove', this._onPointerMove)
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('resize', this._onResize)

    // 切到后台/窗口失焦：自动暂停；WebGL 上下文丢失/恢复处理
    this._onVisibilityChange = () => {
      if (document.hidden) this.pause()
      else this._resetClock()
    }
    this._onBlur = () => this.pause()
    this._onContextLost = (e) => {
      e.preventDefault()
      this.glLost = true
      this.pause()
    }
    this._onContextRestored = () => {
      this.glLost = false
      // 上下文恢复后强制重建视口尺寸，three 会在下次 render 自动重建 GPU 资源
      const w = this.container.clientWidth || window.innerWidth
      const h = this.container.clientHeight || window.innerHeight
      if (w > 0 && h > 0) {
        this.camera.aspect = w / h
        this.camera.updateProjectionMatrix()
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        this.renderer.setSize(w, h)
        this._updateBounds()
      }
      this._resetClock()
    }
    document.addEventListener('visibilitychange', this._onVisibilityChange)
    window.addEventListener('blur', this._onBlur)
    this.renderer.domElement.addEventListener(
      'webglcontextlost',
      this._onContextLost
    )
    this.renderer.domElement.addEventListener(
      'webglcontextrestored',
      this._onContextRestored
    )
  }

  _updateBounds() {
    const dist = CAMERA_Z - PLAYER_Z
    const halfH = Math.tan(THREE.MathUtils.degToRad(30)) * dist
    const halfW = halfH * this.camera.aspect
    this.boundX = Math.max(8, Math.min(21, halfW - 2))
  }

  // ---------- 游戏控制 ----------
  /** 重置时钟基准，避免后台恢复后 getDelta 出现超大步长 */
  _resetClock() {
    this.clock.start()
  }

  /** 暂停（切后台 / 窗口失焦 / 上下文丢失时触发） */
  pause() {
    if (!this.running || this.over) return
    this.running = false
    this.paused = true
    this.keys = {} // 防止按键卡住
    this.cb.onPause?.()
  }

  /** 从暂停恢复（玩家点击继续） */
  resume() {
    if (!this.paused || this.over) return
    this.paused = false
    this.running = true
    this.keys = {}
    this._resetClock()
    this.cb.onResume?.()
  }

  start() {
    // 清空残留对象
    this._clearEntities()
    this.score = 0
    this.health = 3
    this.elapsed = 0
    this.fireTimer = 0
    this.spawnTimer = 1.2
    this.pointer.x = 0
    this.pointer.y = 0
    this.player.position.set(0, 0, PLAYER_Z)
    this.player.visible = true
    this.over = false
    this.paused = false
    this.running = true
    this.keys = {}
    this._resetClock()
    this.cb.onScore?.(0)
    this.cb.onHealth?.(3)
  }

  _gameOver() {
    this.running = false
    this.over = true
    this.shake = 0.6
    this._spawnExplosion(this.player.position.clone(), 0xff8833, 90, 20)
    this.player.visible = false
    this.cb.onGameOver?.(this.score)
  }

  _clearEntities() {
    for (const b of this.bullets) this.scene.remove(b)
    for (const e of this.enemies) this.scene.remove(e.mesh)
    for (const p of this.particles) {
      this.scene.remove(p.points)
      p.geometry.dispose()
      p.material.dispose()
    }
    this.bullets = []
    this.enemies = []
    this.particles = []
  }

  // ---------- 发射 / 生成 ----------
  _fire() {
    const m1 = new THREE.Mesh(this.bulletGeo, this.bulletMat)
    m1.position.set(this.player.position.x - 0.9, this.player.position.y, PLAYER_Z - 1)
    const m2 = new THREE.Mesh(this.bulletGeo, this.bulletMat)
    m2.position.set(this.player.position.x + 0.9, this.player.position.y, PLAYER_Z - 1)
    this.scene.add(m1, m2)
    this.bullets.push(m1, m2)
  }

  _spawnEnemy() {
    const mesh = new THREE.Mesh(this.enemyGeo, this.enemyMat)
    const x = (Math.random() - 0.5) * 2 * (this.boundX - 1)
    const y = (Math.random() - 0.5) * 2 * (BOUND_Y - 2)
    mesh.position.set(x, y, -75)
    const speed = ENEMY_SPEED_BASE + this.score / 600 + Math.random() * 3
    this.enemies.push({
      mesh,
      speed,
      baseX: x,
      wobbleAmp: 1.5 + Math.random() * 2.5,
      wobbleFreq: 1 + Math.random() * 1.5,
      phase: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 3,
    })
    this.scene.add(mesh)
  }

  // ---------- 粒子系统 ----------
  /**
   * 爆炸粒子：在 pos 处生成 count 个向四周扩散的发光点
   */
  _spawnExplosion(pos, color, count = 45, speed = 14) {
    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x
      positions[i * 3 + 1] = pos.y
      positions[i * 3 + 2] = pos.z
      // 球面随机方向
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const v = speed * (0.4 + Math.random() * 0.6)
      velocities[i * 3] = v * Math.sin(phi) * Math.cos(theta)
      velocities[i * 3 + 1] = v * Math.sin(phi) * Math.sin(theta)
      velocities[i * 3 + 2] = v * Math.cos(phi)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      color,
      size: 0.45,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const points = new THREE.Points(geometry, material)
    this.scene.add(points)
    this.particles.push({
      points,
      geometry,
      material,
      velocities,
      life: 0,
      maxLife: 0.9,
    })
  }

  /**
   * 引擎尾焰粒子
   */
  _spawnTrail() {
    const count = 4
    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] =
        this.player.position.x + (Math.random() - 0.5) * 0.5
      positions[i * 3 + 1] =
        this.player.position.y + (Math.random() - 0.5) * 0.5
      positions[i * 3 + 2] = PLAYER_Z + 1.4
      velocities[i * 3] = (Math.random() - 0.5) * 1.5
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 1.5
      velocities[i * 3 + 2] = 6 + Math.random() * 3
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      color: 0x66ccff,
      size: 0.3,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const points = new THREE.Points(geometry, material)
    this.scene.add(points)
    this.particles.push({
      points,
      geometry,
      material,
      velocities,
      life: 0,
      maxLife: 0.45,
    })
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life += dt
      const attr = p.geometry.attributes.position
      const arr = attr.array
      for (let j = 0; j < arr.length; j += 3) {
        arr[j] += p.velocities[j] * dt
        arr[j + 1] += p.velocities[j + 1] * dt
        arr[j + 2] += p.velocities[j + 2] * dt
        // 阻尼
        p.velocities[j] *= 0.96
        p.velocities[j + 1] *= 0.96
        p.velocities[j + 2] *= 0.96
      }
      attr.needsUpdate = true
      p.material.opacity = Math.max(0, 1 - p.life / p.maxLife)
      if (p.life >= p.maxLife) {
        this.scene.remove(p.points)
        p.geometry.dispose()
        p.material.dispose()
        this.particles.splice(i, 1)
      }
    }
  }

  // ---------- 主循环 ----------
  _loop() {
    this.rafId = requestAnimationFrame(this._loop)
    const dt = Math.min(this.clock.getDelta(), 0.05)

    this._updateStars(dt)
    this._updateParticles(dt)

    if (this.running) {
      this.elapsed += dt
      this._updatePlayer(dt)
      this._updateBullets(dt)
      this._updateEnemies(dt)
      this._checkCollisions()

      // 自动射击
      this.fireTimer -= dt
      if (this.fireTimer <= 0) {
        this._fire()
        this.fireTimer = FIRE_INTERVAL
      }
      // 敌机生成（随分数提速）
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0) {
        this._spawnEnemy()
        this.spawnTimer = Math.max(0.45, 1.3 - this.score / 5000)
      }
      // 尾焰
      this.trailTimer -= dt
      if (this.trailTimer <= 0) {
        this._spawnTrail()
        this.trailTimer = 0.05
      }
    }

    // 相机震动
    if (this.shake > 0) {
      this.shake -= dt
      this.camera.position.x = (Math.random() - 0.5) * this.shake * 2
      this.camera.position.y = (Math.random() - 0.5) * this.shake * 2
    } else {
      this.camera.position.x = 0
      this.camera.position.y = 0
    }

    this.renderer.render(this.scene, this.camera)
  }

  _updateStars(dt) {
    const arr = this.stars.geometry.attributes.position.array
    const speed = this.running ? 26 : 8
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 2] += speed * dt
      if (arr[i + 2] > CAMERA_Z + 5) {
        arr[i + 2] = -90
        arr[i] = (Math.random() - 0.5) * 90
        arr[i + 1] = (Math.random() - 0.5) * 55
      }
    }
    this.stars.geometry.attributes.position.needsUpdate = true
  }

  _updatePlayer(dt) {
    // 键盘控制（直接移动目标点）
    if (this.keys['arrowleft'] || this.keys['a'])
      this.pointer.x -= PLAYER_SPEED * dt
    if (this.keys['arrowright'] || this.keys['d'])
      this.pointer.x += PLAYER_SPEED * dt
    if (this.keys['arrowup'] || this.keys['w'])
      this.pointer.y += PLAYER_SPEED * dt
    if (this.keys['arrowdown'] || this.keys['s'])
      this.pointer.y -= PLAYER_SPEED * dt
    this.pointer.x = THREE.MathUtils.clamp(this.pointer.x, -this.boundX, this.boundX)
    this.pointer.y = THREE.MathUtils.clamp(this.pointer.y, -BOUND_Y, BOUND_Y)

    const prevX = this.player.position.x
    this.player.position.x += (this.pointer.x - this.player.position.x) * Math.min(1, dt * 12)
    this.player.position.y += (this.pointer.y - this.player.position.y) * Math.min(1, dt * 12)
    this.player.position.z = PLAYER_Z

    // 倾斜手感
    const vx = (this.player.position.x - prevX) / Math.max(dt, 0.001)
    this.player.rotation.z = THREE.MathUtils.clamp(-vx * 0.012, -0.6, 0.6)
    this.player.rotation.y = THREE.MathUtils.clamp(-vx * 0.006, -0.4, 0.4)

    this.playerLight.position.set(
      this.player.position.x,
      this.player.position.y,
      PLAYER_Z + 1
    )
  }

  _updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]
      b.position.z -= BULLET_SPEED * dt
      if (b.position.z < -90) {
        this.scene.remove(b)
        this.bullets.splice(i, 1)
      }
    }
  }

  _updateEnemies(dt) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      e.mesh.position.z += e.speed * dt
      e.mesh.position.x =
        e.baseX + Math.sin(this.elapsed * e.wobbleFreq + e.phase) * e.wobbleAmp
      e.mesh.rotation.x += e.spin * dt
      e.mesh.rotation.y += e.spin * 0.7 * dt
      // 越过玩家，移除
      if (e.mesh.position.z > PLAYER_Z + 6) {
        this.scene.remove(e.mesh)
        this.enemies.splice(i, 1)
      }
    }
  }

  _checkCollisions() {
    // 子弹 vs 敌机（球心距离碰撞）
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      const ep = e.mesh.position
      for (let j = this.bullets.length - 1; j >= 0; j--) {
        const bp = this.bullets[j].position
        const dist = Math.hypot(ep.x - bp.x, ep.y - bp.y, ep.z - bp.z)
        if (dist < 1.4) {
          this._spawnExplosion(ep.clone(), 0xffaa33, 40, 13)
          this.scene.remove(e.mesh)
          this.scene.remove(this.bullets[j])
          this.enemies.splice(i, 1)
          this.bullets.splice(j, 1)
          this.score += 100
          this.cb.onScore?.(this.score)
          break
        }
      }
    }

    // 敌机 vs 玩家
    if (this.player.visible) {
      const pp = this.player.position
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const ep = this.enemies[i].mesh.position
        const dist = Math.hypot(ep.x - pp.x, ep.y - pp.y, ep.z - pp.z)
        if (dist < 1.7) {
          this._spawnExplosion(ep.clone(), 0xff5533, 50, 15)
          this.scene.remove(this.enemies[i].mesh)
          this.enemies.splice(i, 1)
          this.health -= 1
          this.shake = 0.35
          this.cb.onHealth?.(this.health)
          if (this.health <= 0) {
            this._gameOver()
            break
          }
        }
      }
    }
  }

  // ---------- 销毁 ----------
  dispose() {
    cancelAnimationFrame(this.rafId)
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('resize', this._onResize)
    document.removeEventListener(
      'visibilitychange',
      this._onVisibilityChange
    )
    window.removeEventListener('blur', this._onBlur)
    this.renderer.domElement.removeEventListener(
      'webglcontextlost',
      this._onContextLost
    )
    this.renderer.domElement.removeEventListener(
      'webglcontextrestored',
      this._onContextRestored
    )
    this._clearEntities()
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        Array.isArray(obj.material)
          ? obj.material.forEach((m) => m.dispose())
          : obj.material.dispose()
      }
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
