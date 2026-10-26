# 项目功能详细说明（基线文档）

> 本文档基于 2026-10-26 对 `react-app` 源码的全量梳理生成，是当前项目**实际已实现功能**的客观描述。
> 用途：作为基线（Baseline），供 prd-scheduler 定时生成的需求文档进行对比——新需求应在此基线上增量描述，对比时可快速识别"新增 / 修改 / 删除"的功能点。

## 1. 项目概览

### 1.1 项目定位

一个由 AI Agent 全自动构建的作品集网站（首页明确宣传"100% AI 生成代码，0 行人工编码"），包含 3D 射击游戏、2048 小游戏、俄罗斯方块、贪吃蛇、打砖块、记忆翻牌、番茄时钟、在线简历、南昌旅游介绍、技术文档中心十大功能模块。

### 1.2 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 18（函数组件 + Hooks） |
| 构建工具 | Vite |
| 路由 | React Router v6（BrowserRouter） |
| 3D 渲染 | Three.js（游戏引擎自研封装 `SpaceShooter` 类） |
| Markdown 渲染 | marked（GFM 模式） |
| 特效 | 原生 Canvas 2D（鼠标轨迹） |
| 数据持久化 | localStorage（无后端数据库） |
| 外部 API | Open-Meteo（天气）、BigDataCloud（逆地理编码），均免费无 Key |

### 1.3 目录结构

```
react-app/src/
├── main.jsx                 # 入口
├── App.jsx                  # 路由定义 + 全局布局（Navbar）
├── pages/
│   ├── Home.jsx / Home.css      # 首页（Bento 网格）
│   ├── Game.jsx / Game.css      # 飞机大战页面壳（UI + 状态）
│   ├── Game2048.jsx / .css      # 2048 小游戏页面壳（UI + 状态）
│   ├── Tetris.jsx / .css        # 俄罗斯方块页面壳（UI + 状态 + Canvas 2D 渲染）
│   ├── Snake.jsx / .css         # 贪吃蛇页面壳（UI + 状态 + Canvas 2D 渲染）
│   ├── Breakout.jsx / .css      # 打砖块页面壳（UI + 状态 + Canvas 2D 渲染）
│   ├── Pomodoro.jsx / .css      # 番茄时钟
│   ├── Nanchang.jsx / .css      # 南昌旅游介绍（手账风图文页 + 攻略图集灯箱）
│   ├── Resume.jsx / .css        # 在线简历
│   ├── Docs.jsx / .css          # 文档列表页
│   ├── DocView.jsx              # 文档详情页
│   ├── About.jsx                # 关于页
│   └── NotFound.jsx             # 404 页
├── game/
│   ├── SpaceShooter.js          # Three.js 飞机大战引擎（纯逻辑，与 UI 解耦）
│   ├── Game2048Engine.js         # 2048 引擎（纯逻辑：滑动/合并/撤销/持久化）
│   ├── TetrisEngine.js           # 俄罗斯方块引擎（位运算核心：10bit 行棋盘 + 16bit 方块查表）
│   ├── SnakeEngine.js            # 贪吃蛇引擎（纯逻辑：固定节拍 + 容量 2 方向输入缓冲队列）
│   └── BreakoutEngine.js         # 打砖块引擎（纯逻辑：1/240s 固定步长物理 + 关卡布局 + 持久化）
├── components/
│   ├── Navbar.jsx               # 顶部导航
│   ├── MouseTrail.jsx           # 鼠标轨迹特效（Canvas）
│   ├── DragList.jsx             # 拖拽列表（H5 原生拖放）
│   ├── Weather.jsx              # 天气卡片
│   └── CardLayout.jsx / .css   # 通用卡片布局组件（三段结构 + 技术标签）
├── api/
│   └── leaderboard.js           # 排行榜 API（localStorage 版，接口对齐未来云函数版）
└── docs/
    ├── registry.js              # 文档注册表（slug / 标题 / 摘要 / 标签 / 内容）
    └── *.md                     # Markdown 文档源文件（Vite ?raw 导入）
```

### 1.4 路由与加载策略

| 路由 | 页面 | 加载方式 |
|------|------|----------|
| `/index.html` | Home 首页 | 直接引入 |
| `/about` | About 关于 | 直接引入 |
| `/resume` | Resume 简历 | 直接引入 |
| `/pomodoro` | Pomodoro 番茄钟 | 直接引入 |
| `/game` | Game 飞机大战 | **lazy 懒加载**（含 Three.js，体积大） |
| `/2048` | Game2048 2048 小游戏 | **lazy 懒加载**（含引擎逻辑，与飞机大战分包） |
| `/tetris` | Tetris 俄罗斯方块 | **lazy 懒加载**（位运算引擎 + Canvas 2D，独立分包） |
| `/snake` | Snake 贪吃蛇 | **lazy 懒加载**（输入缓冲引擎 + Canvas 2D，独立分包） |
| `/breakout` | Breakout 打砖块 | **lazy 懒加载**（固定步长物理引擎 + Canvas 2D，独立分包） |
| `/memory` | Memory 记忆翻牌 | **lazy 懒加载**（纯 DOM + 无障碍，独立分包） |
| `/nanchang` | Nanchang 南昌旅游介绍 | **lazy 懒加载**（图文静态页 + 图集灯箱，独立分包） |
| `/docs` | Docs 文档列表 | **lazy 懒加载**（含 marked） |
| `/docs/:slug` | DocView 文档详情 | **lazy 懒加载** |
| `*` | NotFound 404 | 直接引入 |

懒加载统一使用 `<Suspense fallback="加载中…">`。

## 2. 全局功能

### 2.1 导航栏（Navbar）

- 左侧品牌区：Vite logo + "React App" 文字，点击跳转 `/`。
- 右侧导航链接 7 项：首页（`/index.html`）、飞机大战（`/game`）、俄罗斯方块（`/tetris`）、番茄钟（`/pomodoro`）、简历（`/resume`）、南昌旅游（`/nanchang`）、技术文档（`/docs`）。
- 当前路由高亮（NavLink active 态）。
- 移动端：汉堡按钮（aria-expanded 无障碍标注）展开/收起菜单；点击任意链接自动收起菜单。
- **移动端响应式**：断点对齐统一三级体系；汉堡菜单触发点 <768（767px）；收起态链接 <768 字号 15px、padding 10px 12px。

### 2.2 已知路由怪癖

- 根路径 `/` **没有**对应路由，会命中 `*` 通配符显示 404 页；首页实际挂载在 `/index.html`。
- 导航栏品牌 Logo 链接指向 `/`，因此点击 Logo 会进入 404 页（与首页文案中的跳转行为不一致）。

## 3. 页面功能明细

### 3.1 首页（/index.html）

Bento Grid 网格布局，自上而下：

1. **项目定位大卡**（占 8/12 宽）：宣传语"自动化构建部署"，两个 CTA 按钮 → `/game`、`/docs`。
2. **右侧栏**（4/12 宽）：
   - **AI 技术栈卡片**：11 个技能标签（VibeCode、AgentCode、RAG、React 等），包裹在**可拖拽排序**的 DragList 中（支持 Alt+↑/↓ 键盘交换，见 3.1.3）。
   - **本地天气卡片**（见 3.1.1）。
3. **Agent 工作流**：4 张流程卡（需求理解 → 代码生成 → 浏览器自测 → 构建部署），可 Tab 聚焦（tabindex=0 + role="group"）。
4. **作品入口**（原「精选作品」+「技术实践」两区块合并，路由去重）：9 张由 `CardLayout` 渲染的卡片（飞机大战→/game、2048 小游戏→/2048、俄罗斯方块→/tetris、贪吃蛇→/snake、打砖块→/breakout、记忆翻牌→/memory、番茄时钟→/pomodoro、在线简历→/resume、提示词工程文档→/docs），每条路由唯一（2026-10-22 打砖块替换原"更多"占位卡；2026-10-26 新增记忆翻牌卡）。卡片 `children` 内容区为作品描述 + 原「技术实践」对应卡的技术描述（`.cl-practice` 段落）；`footer` 为 meta + `Link` 跳转（点击计数写入 `home-entry-clicks`，约束卡①）。`data-keywords` 经 `...rest` 透传供 MouseTrail 切换粒子词库（见 3.1.4）。原 `bento-work` 卡片样式（13 个 `.bento-work*` 选择器）与「03 技术实践」独立区块已移除。
5. **统计条**：100% AI 生成代码 / 0 行人工编码 / 9 个功能模块（进入视口时 800ms 数字滚动动画，reduced-motion 直接显示；2026-10-26 由 3 修正为 9，与作品入口卡片数对齐）/ 实时天气摘要格（与天气卡片共享 useWeather 状态，点击平滑滚动并聚焦天气卡）/ mailto 联系链接。
- **键盘可达性**：Bento 内全部可交互元素支持 Tab 聚焦 + Enter/Space 激活，统一 `:focus-visible` 紫色焦点环（2px #aa3bff）。
- **移动端响应式**：断点对齐统一三级体系（≥1024 / 768~1023 / <768 / <480）；Bento 网格 <1024 改 6 列过渡、<768 改单列；`.home-page` <768 padding 降为 24px 16px 48px；`.bento-about`/`.bento-skills` <768 `min-height: auto`；统计条 `.bento-stat-num` <768 24px、<480 统计条改纵向堆叠。

#### 3.1.1 鼠标轨迹特效（MouseTrail，仅首页挂载）

- 独立全屏 Canvas，`pointer-events: none` 不影响交互，`aria-hidden`。
- **光晕**：径向渐变圆形，rAF 缓动（系数 0.12）跟随鼠标。
- **关键词粒子**：鼠标移动时在周围随机位置生成 AI 关键词文字粒子，带初速度和"重力"向下坠落，逐渐淡出；生成节流 66ms，上限 40 个，18 个关键词随机取。
- **hover 反馈**：悬停 `a/button/[role="button"]` 时光晕半径 150→220、颜色变紫、粒子变紫；悬停带 `data-keywords` 的精选作品卡时粒子改用该卡主题词表（6 词/卡）；键盘 `:focus-visible` 聚焦与 hover 等效联动（focusin/focusout 监听）。
- 支持窗口 resize（devicePixelRatio 上限 2）、鼠标离开窗口隐藏光晕。

#### 3.1.2 天气卡片（Weather）

- 数据源 Open-Meteo 免费接口（当前温度/湿度/体感/风速/天气代码 + 今日最高最低温），无需 API Key。
- **状态提升**：数据逻辑抽为 `useWeather()` hook 导出，由 Home 持有，天气卡片与统计条天气摘要格共享同一份状态（不重复请求）。
- 定位：优先浏览器 Geolocation（8s 超时、10min 缓存），失败/拒绝/不支持时回退北京坐标并标注"北京（默认）"；**拒绝授权时卡片顶部显示"已使用北京默认位置"提示条 + "重试定位"按钮**（自动加载每会话最多提示 1 次，sessionStorage 标记；手动重试被拒总是复现）。
- 地名：通过 BigDataCloud 逆地理接口补全，失败静默降级显示"当前位置"。
- 天气代码：WMO 标准码映射为中文描述 + 白天/夜间两套 emoji 图标，未知码显示"未知 🌡️"。
- 刷新：每 10 分钟自动刷新；右上角 ↻ 按钮手动刷新（**30s 节流**，节流命中时 title 提示"刷新过于频繁，请稍后再试"；节流时间戳为模块级变量，页面刷新即重置）。
- 状态：loading 骨架屏 / error 显示"天气获取失败 + 重试按钮" / 成功展示数据；卸载时通过 mountedRef 防止内存泄漏 setState。

#### 3.1.3 拖拽列表（DragList）

- 基于 HTML5 原生拖放 API 的极简实现（非第三方库）。
- 交互：按住拖动 → dragEnter 确定目标位 → 松手时**两元素互换位置**（注意：是交换，不是插入式重排序）。
- **键盘交换**：列表项可聚焦（tabindex=0），Alt+↑/↓ 与相邻项交换位置（与鼠标交换语义一致），首项按↑/末项按↓无操作；焦点跟随被移动项，`aria-live="polite"` 播报交换结果。

#### 3.1.4 通用卡片布局组件（CardLayout）

- 位置：`src/components/CardLayout.jsx` + `CardLayout.css`，样式类名 `cl-` 前缀隔离。
- **三段结构**：标题区（`cl-head`，含标题 h3 + 技术标签）→ 内容区（`cl-body`，flex-grow 撑满）→ 底部区（`cl-foot`，仅 `footer` prop 非空时渲染），区域间 1px 分隔线。
- **Props**：`title`（必填 string）/ `techTags`（可选 string[]，默认 []）/ `children`（内容区 ReactNode）/ `footer`（底部区 ReactNode，null 则不渲染）/ `span`（'3'|'4'|'6'|'8'|'12'，默认 '4'，非法值降级 '4'）/ `className` / `...rest`（透传 data-* 等属性至根 article）。
- **技术标签**：渲染在标题区第二行，圆角 999px 胶囊样式，等宽字体，紫色描边 + 10% 紫色背景；hover 变实色紫 + 白字 + 上移 1px。`techTags` 为空数组或全空字符串时不渲染标签容器 DOM。
- **降级与异常**：`title` 未传时控制台警告 + 占位"未命名卡片"；`techTags` 过滤空字符串项后为空则降级；`footer` 为 null/undefined 时不渲染底部区；不支持 `backdrop-filter` 时降级实色背景；`prefers-reduced-motion` 禁用入场动画和 hover 位移。
- **视觉**：玻璃拟态（surface 80% + blur 12px），圆角 16px，入场动画 `bento-fade-up`（fill-mode backwards），hover 上移 4px + 紫色阴影，复用首页 `--home-*` CSS 变量。
- **无障碍**：根 article `role="group" aria-label={title}`；技术标签 `aria-hidden="true"`（视觉辅助，不可单独聚焦）；`...rest` 透传 `data-keywords` 供 MouseTrail 切换粒子词库。

### 3.2 飞机大战（/game）

#### 3.2.1 架构

- 页面壳 `Game.jsx` 管理 UI 状态机（start / playing / paused / over 四屏）与 HUD；引擎 `SpaceShooter.js` 纯 Three.js 逻辑，通过回调（onScore / onHealth / onGameOver / onPause）与 UI 通信；组件卸载时 `engine.dispose()` 释放全部资源。

#### 3.2.2 玩法规则

- **控制**：鼠标移动（映射到玩家平面）或键盘 WASD / 方向键（速度 18 单位/秒）；移动端单指触摸拖拽（`touchstart`/`touchmove` 经同一 `_mapPointer` 映射，多点触摸仅跟踪首指 `touchId`）；三者都写入 `pointer` 目标点，飞机带缓动跟随（dt*12）与转向倾斜手感。`touch-action: none` + `preventDefault` 阻止页面滚动/缩放。
- **射击**：自动双发子弹（间隔 0.7s，弹速 75），无需手动操作。
- **敌机**：红色八面体，从 z=-75 处生成，基础速度 36 + 分数/600 + 随机扰动，带正弦左右摆动与自旋；生成间隔随分数缩短（0.7s → 最低 0.25s）。
- **得分**：击毁 1 架敌机 +100 分（子弹与敌机球心距离 < 1.4 判定命中）。
- **生命**：初始 3 点（2026-10-22 修正：`start()` 由 2 改 3，与 UI 文案/HUD 3 心一致，原已知不一致点 1 已消除）；敌机与玩家距离 < 1.7 判定撞击，损失 1 点生命并触发相机震动（0.35）。
- **结束**：生命归零时游戏结束，播放爆炸粒子（90 粒）并隐藏玩家飞机。

#### 3.2.3 视觉效果

- 星空背景：900 个粒子向上穿梭，游戏运行时速度 26，空闲时 8。
- 粒子系统：击毁爆炸（40 粒橙）、玩家死亡爆炸（90 粒）、引擎尾焰（每 0.05s 4 粒，寿命 0.45s），均带速度阻尼与淡出。
- 相机：FOV 60，游戏结束震动 0.6，场景雾效（0x05060f，45~110）。
- 玩家飞机：锥体机身 + 机翼 + 尾翼 + 引擎光球，自带蓝色点光源。

#### 3.2.4 屏幕与 HUD

- **开始屏**：玩法说明 + "开始游戏"按钮 + 排行榜面板（TOP 10）；若存在 30 分钟内的中断快照，额外展示"上次战斗中断"卡片（得分/生命/中断时间 + "继续上局"）。
- **游戏中 HUD**：左上"← 返回首页"链接、得分实时显示、右侧 3 颗红心生命值 + "⏸ 暂停"按钮（仅 playing 态）。
- **暂停屏**：按原因展示文案（手动/切后台/失焦/WebGL 上下文丢失），含本局数据条（得分/剩余生命/本局时长/已暂停时长，按真实时间差每秒刷新）、排行榜 TOP 3 三态摘要卡、"继续游戏（3s 倒计时）"/"重新开始"/"返回首页"，以及 Esc/P 与 Tab 键位提示。
- **结束屏**：最终得分 + 排行榜提交（见 3.2.5）+ "再来一局"。

#### 3.2.5 排行榜（api/leaderboard.js，localStorage 版）

- 2026-10-18 改造：`createLeaderboard(storageKey)` 工厂函数按游戏指定存储键；顶层 `fetchTopScores`/`submitScore` 仍绑定默认键 `game-leaderboard-v1`，飞机大战既有调用与数据不受影响。
- 默认存储键 `game-leaderboard-v1`，结构 `[{ name, score, elapsed, createdAt }]`，最多保留 50 条。
- 排序规则：分数降序，同分先提交者靠前。
- 展示 TOP 10，前三名有特殊样式（top-1/2/3）。
- 提交：昵称输入框（maxlength 12，空则默认"无名飞侠"），分数 > 0 才可提交；提交后显示"已上榜，当前排名：第 N 名"；昵称持久化到 `game-player-name`，下次自动填充。
- 提交失败显示"提交失败，请重试"（本地版实际不会失败，接口为未来云函数版预留）。
- 空榜单显示"虚位以待，等你上榜"。
- 2026-10-26 新增 `loadTopScoresSafe({ timeout = 3000 })`：3s 超时包装、离线直读缓存、失败时读 `game-pause-board-cache-v1`（5 分钟 TTL）并返回 `{ items, source: 'remote'|'cache'|'error', cachedAt? }`；成功响应写缓存（TOP 10）。仅供暂停页使用，`fetchTopScores`/`submitScore` 签名与默认键不变。

#### 3.2.6 后台与异常处理（重要设计）

- **暂停来源与优先级**：`visibilitychange`（切后台）、`window.blur`（失焦）、`webglcontextlost`（WebGL 上下文丢失）与手动（HUD 暂停按钮 / `Esc` / `P`）四类；自动源优先级 `contextlost(3) > visibility(2) > blur(1)`，首次触发即锁定原因，引擎 `pause(reason)` 在 `running && !over` 时才生效，重复调用幂等。暂停时清空 `keys` 与触摸跟踪态 `touchId`。
- **暂停屏**：UI 依据 `onPause(reason)` 切 paused，展示对应原因文案、本局统计与排行榜摘要；每次暂停写入中断快照并累计 `game-pause-events-v1`（自动暂停同局累计 ≥3 次追加「建议使用 Esc 主动暂停」提示）。
- **恢复**：不再自动恢复。玩家点击「继续游戏」/按 Enter 后进入 3→2→1 倒计时（再次切后台或上下文丢失会取消倒计时），归零后 `resume()`：清空输入态、指针回中心、重置时钟基准（防 getDelta 超大步长跳帧），并给予 0.3s 无敌缓冲。`document.hidden` 或 `glLost` 时 `resume()` 拒绝执行。
- **WebGL 上下文**：丢失即 `onGlLost` + 暂停，恢复后重建视口尺寸与像素比并回调 `onGlRestored`，但不自动开战；UI 侧 5 秒未恢复显示「图形恢复失败，请重开一局」并禁用继续。
- **中断快照**：暂停或 `pagehide` 时写入 `game-pause-snapshot-v1`（`{ v:1, score, health, elapsed, pausedAt, reason }`），30 分钟 TTL；开始屏据此展示「继续上局」，经 `engine.restore(snapshot)` 恢复得分/生命/时长（越界钳制）。存储失败时顶部提示「暂停快照无法保存，刷新后本局进度将丢失」，暂停流程不受影响。
- **键盘与无障碍**：`Esc`/`P` 暂停或继续；暂停弹窗 `role="dialog" aria-modal="true"`，初始焦点落「继续游戏」，Tab/Shift+Tab 在弹窗内闭环，关闭后焦点回 HUD 暂停按钮；原因标题 `aria-live="assertive"`，倒计时与图形错误经 `aria-live="polite"` 播报。
- 窗口 resize 自适应；容器尺寸为 0（隐藏态）时跳过避免画布塌陷。

#### 3.2.7 移动端响应式

- HUD 字号 <768 降为 14px、生命心 18px、padding 10px 14px、暂停按钮 14px；<480 返回链接 13px、得分 15px、`.game-panel` padding 32px 24px、`h1` 32px、`.game-tip` 14px。
- 暂停弹窗宽度 `min(92vw, 460px)`；<768 padding 26px 22px、标题 30px；<480 宽 `calc(100vw - 24px)`、标题 26px、操作按钮纵排占满整行。

### 3.3 2048 小游戏（/2048）

#### 3.3.1 架构

- 页面壳 `Game2048.jsx` 管理 UI 状态机（idle / playing / paused / over / win 五屏）与 HUD；引擎 `Game2048Engine.js` 纯逻辑（无 Three.js），通过回调（onState / onScore / onBest / onWin / onGameOver / onPause / onPersistError）与 UI 通信；组件卸载时 `engine.dispose()` 持久化并清理定时器。架构模式参照飞机大战 3.2.1。

#### 3.3.2 玩法规则

- **棋盘**：4×4 网格，开局在空格随机生成 2 个方块（数字 2 占 90% / 数字 4 占 10%）。
- **控制**：键盘 ↑↓←→ 或 WASD（约束卡 2 键盘可达）；移动端单指触摸滑动（touchstart/touchend 计算位移向量，水平/垂直分量较大者判定方向，阈值 24px；多点触摸仅跟踪首指；`touch-action: none` + `preventDefault` 阻止页面滚动/缩放，约束卡 1 移动端兼容）。
- **合并规则**：每次滑动每行/列至多合并 1 次（避免连锁）；合并产生的新数字累加到本局得分；同一次滑动内已合并过的方块不可再合并。
- **新方块**：每次有效移动后（棋盘发生位置变化或合并）在随机空格生成 1 个新方块（2 或 4，比例同上）；滑动方向无可移动方块时不生成新方块、不消耗撤销次数。
- **得分与最高分**：合并产生的新数字累加到本局 `score`；当 `score > bestScore` 时实时覆盖最高分并触发 HUD 数字 bump 动画（300ms）。
- **胜利判定**：棋盘出现 2048 方块时切到 win 状态，弹胜利遮罩；点击「继续挑战」回到 playing 不重复弹（仅首次 2048 弹窗，由 `won` 标记锁）。
- **结束判定**：棋盘填满且无任何相邻同值方块时切到 over 状态；棋盘满但仍存在可合并方块时不进入 over，允许继续滑动。
- **撤销**：每局初始 3 次，每次有效移动前快照（board/score/undosLeft）入历史栈（容量 5）；撤销时回退到上一快照，undosLeft - 1；次数为 0 时按钮置灰 `aria-disabled="true"` + 禁用点击；win/over 状态下也允许撤销回到 playing。

#### 3.3.3 视觉与无障碍

- **棋盘**：CSS Grid 4×4 布局，浅米色 `#bbada0` 底（贴经典 2048 风格），方块用 grid-column/row 定位（不做滑动动画，仅 spawn + pop 动画）。
- **主题色映射**：2=#eee4da、4=#ede0c8、8=#f2b179、16=#f59563、32=#f67c5f、64=#f65e3b、128=#edcf72、256=#edcc61、512=#edc850、1024=#edc53f、2048=#edc22e（金色描边 + 发光）；数字超过 2048 复用 2048 样式 + 字号自动缩放防溢出。
- **动画**：新方块 spawn（scale 0→1，180ms ease-out）；合并方块 pop（scale 1→1.2→1，220ms）；`prefers-reduced-motion` 时全部禁用。
- **无障碍**：棋盘 `role="grid" aria-label="2048 棋盘"` `aria-rowcount=4 aria-colcount=4` `tabindex=0`；方块 `role="gridcell" aria-label="第 R 行 第 C 列，值 N"`；`aria-live="polite"` 区播报得分变化与最高分；撤销/重新开始按钮 `role="button"`；焦点环 2px #aa3bff（参照首页 3.1 焦点环规范）；玩法说明折叠面板 `aria-expanded` + `aria-controls` 联动（约束卡 2）。

#### 3.3.4 屏幕与 HUD

- **顶部 HUD**：左「← 返回首页」（指向 `/index.html`）、右两个得分框（当前得分 + 最高分，最高分金色高亮）。
- **工具条**：重新开始按钮、撤销按钮（角标显示剩余次数）、玩法说明折叠按钮（点击展开说明 panel）。
- **暂停遮罩**（切后台触发）：提示"检测到你切换了页面，游戏已自动暂停并保存进度" + 继续按钮 + 返回首页链接。
- **胜利遮罩**：标题"达成 2048！" + 当前得分 + 「继续挑战」/「重新开始」。
- **结束遮罩**：标题"游戏结束" + 最终得分 + 最高分 + 「再来一局」+ 返回首页。

#### 3.3.5 持久化与恢复

- **存储键 `game-2048-state`**（localStorage）：`{ v:1, board:number[4][4], score, bestScore, undosLeft(0~3), history:Array<{board,score,undosLeft}>≤5, won:boolean, ts:number }`。
  - 版本校验：`v` 不符时清旧值回退新开局。
  - 写入策略：脏标记延迟持久化（参照番茄钟 3.5 计时模式），在 move / reset / undo / pause / dispose / pagehide 时统一落盘，运行中 1 秒兜底写一次。
  - 容错：`JSON.stringify` 长度 >5000B 时丢弃 history 压缩；`QuotaExceededError` 降级内存（顶部红色提示条"存储配额已满，进度仅本次会话有效"，onPersistError 回调通知 UI）；localStorage 完全不可用同样降级。
- **存储键 `game-2048-touch-starts`**（localStorage）：触摸操作启动累计次数，每局仅记 1 次（参照飞机大战 `game-touch-starts` 模式），0~99999 封顶。
- **开局策略**：访问 `/2048` 时优先从 localStorage 恢复上次棋盘快照；无快照或版本不符时新开局（生成 2 个初始方块）。

#### 3.3.6 后台与异常处理（参照飞机大战 3.2.6，去掉 WebGL 路径）

- **自动暂停**：`visibilitychange`（切后台）与 `window.blur`（失焦）双触发；与 visibility 同步标志 `pausedByVisibilityRef` 去重——visibility 已触发则忽略 blur；UI 切到 paused 状态、立即 persist 写入完整快照。
- **恢复**：回前台点击「继续游戏」从快照重建棋盘与得分；状态机从 paused 切回 playing。
- **组件卸载**：`engine.dispose()` 调用 `persist()` 落盘 + 清理 persistTimer。
- **窗口 resize**：棋盘尺寸由 CSS 三级断点响应式自动适配，无 JS 监听。

#### 3.3.7 移动端响应式

- 棋盘边长三级断点：≥768 480px（cell 108px / gap 12px / pad 12px）、768~481 360px（cell 78px / gap 10px / pad 10px）、<480 `min(90vw, 320px)` 自适应（cell 由 CSS calc 计算）。
- HUD 字号 <768 降为 18px、按钮 padding 8px 16px；<480 返回链接 13px、得分框 min-width 78px、按钮 padding 8px 16px、tile 字号降至 26px / 128-512 降至 20px / 1024+ 降至 18px。
- 大数字（128+）字号自动缩放防溢出棋格。

### 3.4 俄罗斯方块（/tetris）

#### 3.4.1 架构

- 页面壳 `Tetris.jsx` 管理 UI 状态机（start / playing / paused / over 四屏）与 HUD；引擎 `TetrisEngine.js` 纯逻辑（位运算核心，无渲染依赖），通过回调（onState / onGameOver / onPause）与 UI 通信；组件卸载时 `engine.dispose()` 清理重力定时器。架构模式参照飞机大战 3.2.1。
- 渲染：Canvas 2D（无 WebGL，无上下文丢失路径），快照变化或主题变化时整盘重绘（10×20=200 格）；devicePixelRatio 上限 2。

#### 3.4.2 位运算核心

- **棋盘**：长度 20 的整数数组，每行 10 bit（bit9=左墙列0 … bit0=列9；空行 0，满行 1023=0b1111111111）。
- **方块**：7 种（I/J/L/O/S/Z/T）× 4 旋转态共 28 个 16bit 整数预计算查表（4×4 网格，每行 4bit，行内 bit3=左列），不做运行时旋转计算。
- **碰撞检测**：方块 16bit 按 (x,y) 拆 4 个行位段，与对应棋盘行做 `&` 运算；左右移等价于位段 `<<`/`>>` 后重检；越界由墙掩码判定（左移后位超 bit9 为左越界，右移丢失低位为右越界）。
- **旋转踢墙**：查表切下一旋转态 → 碰撞检测，失败依次尝试左移 1 列、右移 1 列，仍失败保持原态。
- **消行**：行值 ===1023 纯位比较判定，数组 splice/unshift 消行；颜色网格（20×10 Uint8Array，值为 type+1）与占用棋盘同步消行，仅用于渲染配色。
- **随机序列**：7-bag 算法（每袋 7 种各 1 个洗牌），避免单一方块长时间不出现。

#### 3.4.3 玩法规则

- **计分**：单次锁定消 1/2/3/4 行分别得 100/300/500/800 分 × 当前等级；硬降 +2 分/格。
- **等级与重力**：等级 = floor(累计消行/10)+1；重力间隔 = max(100, 1000−(等级−1)×80) ms；基于结束时间戳驱动（参照番茄钟 3.5 计时模式），切后台恢复不跳帧。
- **结束**：新方块在生成位（x=3, y=0）即碰撞 → over；onGameOver 回调恰好触发一次。
- **键盘**：←→ 移动（长按 repeat 连发）、↓ 软降（间隔临时 40ms，keyup 恢复）、↑/X 旋转、空格硬降（立即落底锁定）、P 暂停/恢复；仅 playing 态响应。

#### 3.4.4 触控与移动端（约束卡①）

- 单指手势：水平滑动跟手移动（每 24px 映射 1 格，阈值对齐 2048）；点按（<200ms 且位移 <10px）旋转；下滑 >24px 进入软降（回滑取消）；快速下甩（速度 >0.5px/ms 且位移 >48px）硬降。
- 多点触摸仅跟踪首指 identifier；`touch-action: none` + `preventDefault` 阻止页面滚动/缩放；touchcancel 清空跟踪态并退出软降。
- 棋盘尺寸三级断点：≥768 宽 240px（cell 24px）、768~481 宽 200px（cell 20px）、<480 `min(90vw, 320px)` 自适应（`aspect-ratio: 1/2`）；<320px 超窄屏按 90vw 收缩不溢出。
- <768 信息栏（next 预览 + 天气主题标签）移至棋盘下方横排；操作提示条（"左右滑移动 · 点按旋转 · 下滑软降 · 下甩硬降"）<768 显示；HUD 字号 <768 18px、<480 13px 返回链接。

#### 3.4.5 屏幕与 HUD

- **顶部 HUD**：左「← 返回首页」（指向 `/index.html`）、右三个数据框（得分 / 等级 / 消行数，得分 bump 动画 300ms，`prefers-reduced-motion` 禁用）。
- **开始屏**：玩法说明（含位运算技术标注）+「开始游戏」+ 排行榜面板（TOP 10）。
- **暂停屏**（切后台/失焦/P 键触发）：提示"检测到你切换了页面，游戏已自动暂停" +「继续游戏」+ 返回首页链接。
- **结束屏**：最终得分 + 排行榜提交（见 3.4.7）+「再来一局」+ 排行榜面板。
- **信息栏**：下一个方块预览（4×4 CSS 网格渲染 16bit 查表值）+ 天气主题标签（仅主题非默认时显示）。

#### 3.4.6 天气主题联动（3.1.2 数据源）

- 进入 /tetris 时请求 Open-Meteo 当前 `weather_code`（定位策略对齐天气卡片：Geolocation 8s 超时、10min 缓存，失败/拒绝回退北京坐标，**不显示定位提示条**）。
- WMO 码映射 4 套方块配色：晴(0,1)→暖橙系 / 多云(2,3,45,48)→灰蓝系 / 雨(51~67,80~82,95~99)→冷蓝系 / 雪(71~77,85,86)→白青系；信息栏显示主题名（如"晴 · 暖橙"）。
- 定位失败、API 超时（8s AbortController）、非 2xx、解析失败、未知 WMO 码 → 一律静默降级默认深空配色，不显示主题标签，不阻断游戏。

#### 3.4.7 排行榜与后台处理

- **存储键 `game-tetris-leaderboard-v1`**：通过 `createLeaderboard(storageKey)` 绑定（见 3.2.5 参数化改造），结构、50 条上限、TOP 10 展示、前三名样式、昵称规则（maxlength 12 默认"无名飞侠"）、`game-player-name` 自动填充全部对齐 3.2.5。
- 损坏 JSON → 读取回退空数组显示"虚位以待，等你上榜"；localStorage 完全不可用 → 提交显示"提交失败，请重试"，游戏本体不受影响。
- **自动暂停**：`visibilitychange`（切后台）与 `window.blur`（失焦）双触发 + `pausedByVisibilityRef` 去重（参照 2048 的 3.3.6）；仅 playing 态生效；恢复时重置时钟基准防大步长跳帧；暂停时清空触摸跟踪态与软降状态。

### 3.5 番茄时钟（/pomodoro）

- **三模式**：专注 25min（红）/ 短休息 5min（绿）/ 长休息 15min（蓝），主题色随模式切换（CSS 变量 `--accent`）。
- **周期规则**：每完成 4 个专注番茄自动进入长休息，否则短休息；休息结束自动切回专注但**不自动开始**（给用户准备时间）。
- **计时实现**：基于结束时间戳（`Date.now() + remaining`）驱动，250ms 轮询——切到后台/系统休眠后恢复仍准确，不依赖 setInterval 累减；秒值去重，仅秒数变化时才触发状态更新（每秒 ≤1 次实际渲染）。
- **控制**：开始/暂停、重置（回到当前模式满时长）、跳过（跳过专注视为完成一个番茄并推进周期；跳过休息直接回专注）。
- **完成提示音**：Web Audio API 合成 C5-E5-G5 三连音（无音频文件），AudioContext 模块级单例复用（全程 ≤1 个实例），音频不可用时静默。
- **进度展示**：SVG 圆环进度（半径 130）+ 中心倒计时 MM:SS + 模式标签；本轮周期完成数圆点（4 个，完成的实心）。
- **统计**："已完成 N 个番茄钟"计数，localStorage 键 `pomo-completed` 持久化（刷新不丢失）。值域收敛为 0~99999 整数：读取时非法值回退 0 并清除原值，计数达 99999 封顶不再增长。写入采用脏标记延迟持久化——完成/跳过仅置脏标记，在页面隐藏（visibilitychange）、pagehide/beforeunload、组件卸载时统一写入，运行中每 30 秒兜底写一次；localStorage 不可用时仅内存计数。
- **标签页标题**：运行中显示 `MM:SS 模式名 - 番茄钟`，停止时恢复"番茄时钟"。
- **移动端响应式**：断点对齐统一三级体系；`.pomo-card` <768 `width:100%`、padding 28px 24px；`.pomo-ring` <768 缩至 260px、倒计时字号 48px；<480 `.pomo-ring` 240px、字号 44px。

### 3.6 贪吃蛇（/snake）

#### 3.6.1 架构

- 页面壳 `Snake.jsx` 管理 UI 状态机（start / playing / paused / over 四屏）与 HUD；引擎 `SnakeEngine.js` 纯逻辑（网格/节拍/输入缓冲/碰撞，无渲染依赖），通过回调（onState / onGameOver / onPause）与 UI 通信；组件卸载时 `engine.dispose()` 清理节拍定时器。架构模式参照俄罗斯方块 3.4.1。
- 渲染：Canvas 2D（无 WebGL，无上下文丢失路径），快照变化时整盘重绘（20×20=400 格：网格底色 + 蛇体头亮尾暗渐进色 + 食物金色高亮块）；devicePixelRatio 上限 2；窗口 resize 自适应重设画布。

#### 3.6.2 引擎核心（输入缓冲）

- **网格与蛇体**：20×20 网格；蛇体为坐标队列（头在前），初始长度 3，位于棋盘中部向右移动。
- **输入缓冲队列**：方向输入进入容量 2 的缓冲队列，每个节拍消费 1 个；入队过滤与队尾（队列空时与当前方向）**相同或相反（180°，点积 ±1）**的输入——一拍内快速连按两键在相邻两拍依次转向，不会同帧反向自杀；队列满时丢弃新输入。
- **节拍驱动**：基于结束时间戳（setTimeout 链），初始 150ms/格；速度档位 = min(9, floor(score/50))，节拍 = 150 − 档位×10 ms（档 0~9 → 150~60ms 封底）；切后台恢复重置时钟基准，超大 dt 吸收为单拍推进 1 格，不跳帧不瞬移。
- **碰撞**：撞墙（新蛇头越界）或撞身（与蛇体任一节重合，**从紧判定含本拍即将移出的尾节**）→ over；onGameOver 回调恰好触发一次。
- **得分与食物**：吃食物 +10 分、长度 +1（本拍不移除尾节）；食物随机生成于空格（排除蛇体全部坐标）；蛇占满全图（400 节）无空格生成食物 → 判通关结束，分数有效。

#### 3.6.3 操作与触控（约束卡①）

- **键盘**：↑↓←→ / WASD 转向（keydown repeat 由缓冲"过滤同向"自然去重）；P / 空格暂停/恢复；仅 playing 态响应转向，over 态按键全部忽略。
- **触控**：滑动位移 ≥24px 判定转向方向（水平/垂直取分量较大主轴，无对角移动；阈值对齐 2048），判定后重置起点支持连续滑动多次转向；点按（<200ms 且位移 <10px）切换暂停/恢复；多点触摸仅跟踪首指 identifier；`touch-action: none` + `preventDefault` 阻止滚动缩放；touchcancel 清空跟踪态。

#### 3.6.4 屏幕与 HUD

- **顶部 HUD**：左「← 返回首页」（指向 `/index.html`）、右三个数据框（得分 / 最高分 / 长度）；得分 bump 动画 300ms（`prefers-reduced-motion` 禁用）；**最高分 = 排行榜第一名分数**（不单设存储键），排行榜空时显示 0。
- **开始屏**：玩法说明（含输入缓冲技术标注）+「开始游戏」+ 排行榜面板（TOP 10）。
- **暂停屏**：切后台/失焦触发显示"检测到你切换了页面，游戏已自动暂停"；P 键/点按手动暂停显示"游戏已暂停"；均配「继续游戏」。
- **结束屏**：标题（通关显示"通关！"）+ 最终得分 + 排行榜提交（见 3.6.5，分数 >0 才显示提交表单）+「再来一局」+ 排行榜面板。
- **操作提示条**："滑动转向 · 点按暂停"，<768 显示于棋盘下方。

#### 3.6.5 排行榜与后台处理（约束卡②）

- **存储键 `game-snake-leaderboard-v1`**：通过 `createLeaderboard(storageKey)` 绑定（见 3.2.5 参数化改造），结构、50 条上限、TOP 10 展示、前三名样式、昵称规则（maxlength 12 默认"无名飞侠"）、`game-player-name` 自动填充全部对齐 3.2.5。
- 损坏 JSON → 读取回退空数组显示"虚位以待，等你上榜"；localStorage 完全不可用 → 提交显示"提交失败，请重试"，游戏本体不受影响。
- **自动暂停**：`visibilitychange`（切后台）与 `window.blur`（失焦）双触发 + `pausedByVisibilityRef` 去重（参照 2048 的 3.3.6）；仅 playing 态生效；暂停时清空触摸跟踪态；恢复时重置时钟基准防大步长跳帧。

#### 3.6.6 移动端响应式

- 棋盘三级断点：≥768 边长 480px（cell 24px）、768~481 宽 360px（cell 18px）、<480 `min(90vw, 340px)` 自适应；`aspect-ratio: 1/1`；<320px 超窄屏按 90vw 收缩不溢出。
- HUD 字号 <768 18px、<480 13px；返回链接与提示条 <480 纵向堆叠不遮挡棋盘。

### 3.7 打砖块（/breakout）

#### 3.7.1 架构

- 页面壳 `Breakout.jsx` 管理 UI 状态机（start / playing / paused / over / win 五屏）与 HUD；引擎 `BreakoutEngine.js` 纯逻辑（物理/碰撞/关卡/持久化，无渲染依赖），通过回调（onState / onGameOver / onWin / onPause / onPersistError）与 UI 通信；组件卸载时 `engine.dispose()` 落盘并清理定时器。架构模式参照贪吃蛇 3.6.1。
- 渲染：Canvas 2D（无 WebGL，无上下文丢失路径），引擎快照写入 ref + 单 rAF 渲染循环按需重绘（480×640 逻辑坐标），不对 React setState 高频施压；devicePixelRatio 上限 2；显示尺寸由 CSS 三级断点自适应，无 JS resize 监听。

#### 3.7.2 固定步长物理

- **定步积分**：步长 1/240s（封顶球速 720px/s 单步仅 3px < 挡板厚度 12px，杜绝隧道穿透）；8ms setTimeout 节拍链驱动（对齐 SnakeEngine 结束时间戳模式），单拍步数上限 12（≈50ms 吸收窗口），超大 dt 钳制吸收，切后台恢复不跳帧。
- **发球**：待发态球停挡板中心，空格/点击/点按发球，角度 90°±15° 随机。
- **反射**：挡板反射角 = 击中点相对中心偏移（∈[−1,1]）× 60°；砖块碰撞按最近点判定入射轴镜像反弹，**每步最多处理 1 次砖块碰撞**，物理结果确定。
- **快照节流**：常规推送 ≤16ms/次（≈60/s），击砖/掉命/过关等事件强制立即推送。

#### 3.7.3 玩法规则

- **砖块**：10 列 × 6 行共 60 块（砖高 20、间距 4）；普通砖 1 击 +50 分；坚固砖 2 击（首击 +20、击碎再 +80，配色区分）；L1~L5 预定义布局表。
- **关卡**：清空本关砖块进入下一关，球速 ×1.08（封顶 720px/s），挡板宽 96 起每关 −8（封底 64）；完成 L5 触发 win 遮罩「通关！」（`won` 标记锁仅首次弹出，对齐 3.3.2），「继续挑战」无尽循环 L3~L5 布局且球速继续 +8%（仍封顶）。
- **生命**：共 3 点（HUD 3 颗红心）；小球落底 −1 并复位挡板待发；归零 → over。

#### 3.7.4 操作与触控（约束卡①）

- **键盘**：←→ / AD 按住移动（540px/s，keyup 停止）；空格在待发态发球、飞行中暂停；P 暂停/恢复；仅 playing 态响应方向键。
- **鼠标**：mousemove 映射挡板中心 X（钳制画布内）；点击画布在待发态发球。
- **触控**：单指拖拽跟手（多点仅跟踪首指 identifier）；点按（<200ms 且位移 <10px）待发态发球；`touch-action: none` + `preventDefault` 阻止页面滚动/缩放；touchcancel 清空跟踪态。

#### 3.7.5 屏幕与 HUD

- **顶部 HUD**：左「← 返回首页」（指向 `/index.html`）、右数据框（得分 bump 动画 300ms / 关卡 / 3 颗红心 / 天气主题标签——仅主题非默认时显示）；`aria-live="polite"` 播报。
- **开始屏**：玩法说明（含固定步长物理技术标注）+「开始游戏」+ 条件显示「继续游戏（第 N 关）」（存在合法快照时）+ 排行榜面板（TOP 10）。
- **暂停屏**：切后台/失焦显示"检测到你切换了页面，游戏已自动暂停"；P 键手动暂停显示"游戏已暂停"；均配「继续游戏」。
- **通关屏**：标题"通关！"+ 当前得分 +「继续挑战」/「重新开始」。
- **结束屏**：最终得分 + 排行榜提交（分数 >0 才显示表单）+「再来一局」+ 排行榜面板。
- **操作提示条**："滑动移动挡板 · 点按发球"，<768 显示于画布下方。

#### 3.7.6 天气主题联动（3.1.2 数据源，策略对齐 3.4.6）

- 进入 /breakout 时请求 Open-Meteo 当前 `weather_code`（Geolocation 8s 超时、10min 缓存，失败/拒绝回退北京坐标，**不显示定位提示条**）。
- WMO 码映射 4 套砖块/小球配色：晴(0,1)→暖橙系 / 多云(2,3,45,48)→灰蓝系 / 雨(51~67,80~82,95~99)→冷蓝系 / 雪(71~77,85,86)→白青系；HUD 显示主题名（如"晴 · 暖橙"）。
- 定位失败、API 超时（8s AbortController）、非 2xx、解析失败、未知 WMO 码 → 一律静默降级默认深空配色，不显示主题标签，不阻断游戏。

#### 3.7.7 持久化与排行榜

- **存储键 `game-breakout-state`**（localStorage）：`{ v:1, level, score, lives, bricks:number[](每砖剩余击打数 0/1/2), won, ts }`——不存球/挡板瞬时值，恢复时球复位挡板待发。
  - 校验：版本不符、JSON 损坏、`ts` 超 7 天 TTL、命数/砖数越界、无剩余砖 → 清除旧值新开局。
  - 写入：脏标记延迟持久化，在关卡切换/生命变化/暂停/over/win/dispose 统一落盘，运行中 5 秒兜底写一次。
  - 容错：`JSON.stringify` >4000B 丢弃快照；`QuotaExceededError`/localStorage 不可用 → 降级内存 + 顶部红色提示条"存储配额已满，进度仅本次会话有效"（onPersistError 回调）。
- **存储键 `game-breakout-leaderboard-v1`**：通过 `createLeaderboard(storageKey)` 绑定（见 3.2.5），结构、50 条上限、TOP 10、前三名样式、昵称规则（maxlength 12 默认"无名飞侠"）、`game-player-name` 自动填充全部对齐 3.2.5；损坏 JSON 回退空数组显示"虚位以待，等你上榜"。
- **存储键 `game-breakout-touch-starts`**：触摸操作启动累计次数，每局仅记 1 次（参照 `game-2048-touch-starts` 模式），0~99999 封顶。

#### 3.7.8 后台与移动端

- **自动暂停**：`visibilitychange`（切后台）与 `window.blur`（失焦）双触发 + `pausedByVisibilityRef` 去重（对齐 3.3.6）；仅 playing 态（含待发子态）生效；暂停时立即落盘并清空按键状态；恢复时重置时钟基准防大步长跳帧。
- **画布三级断点**：≥768 480×640 / 768~481 360×480 / <480 `min(94vw, 340px)` 宽自适应（`aspect-ratio: 3/4`）；HUD 字号 <768 18px、<480 13px；<320px 超窄屏按 94vw 收缩不溢出。

### 3.8 在线简历（/resume）

- A4 尺寸纸张样式（`resume-sheet`，宽 794px），打印适配；<768 改流式 `width:100%`、去阴影。
- 挂载时设置 `document.title = '个人简历 - 邵凯'`，卸载恢复。
- 内容模块：顶部 hero（姓名/电话/邮箱/地址/GitHub 链接/二维码）→ 个人信息 → 教育经历 → 技术获奖 → 技术简介 → 工作经历 → 项目经验（3 个项目：金融贷支付宝小程序、租赁/仓储管理系统、阿里妈妈运营工作台，含"项目介绍/职责/技术描述/难点"结构）→ 自我评价。
- 简历内容为静态 JSX 硬编码，无数据驱动；部分历史条目以注释保留。
- **移动端响应式（三级断点 768/480）**：
  - `resume-sheet` ≥768 固定 794px 居中，<768 流式 100%、去阴影、`border-radius:0`。
  - `.hero` ≥768 两列 grid（info / qr），<768 改单列堆叠（info → qr → meta），<480 padding 降为 28px 16px、h1 22px。
  - `.qr img` 128px / <768 96px / <480 80px。
  - `.grid3` ≥768 三列 / <768 两列 / <480 单列；`.row4` / `.row3` 同理降到 2 列、1 列。
  - `.proj` 长文本 <480 `word-break: break-all` 防 URL 撑破布局。
- **移动端阅读偏好面板**（<768 显示，≥768 隐藏）：
  - 浮动齿轮按钮（`position:fixed; right:12px; bottom:12px`，触控区 ≥44×44px），`aria-expanded` 联动面板展开。
  - 面板 `role="dialog" aria-label="阅读偏好"`；含**紧凑模式开关**（`role="switch" aria-checked`）与**字体缩放滑块**（`role="slider" aria-valuemin="90" aria-valuemax="130"`，90%~130% 步长 10%）。
  - 字体缩放通过 CSS 变量 `--resume-fs`（默认 16px）驱动根 `font-size`；滑块 `onChange` 用 `requestAnimationFrame` 节流防重排抖动。
  - 紧凑模式（`.resume-page.compact`）将移动端 `--content-padding` 与 `.resume-page` padding 降为 8px 4px、行高 1.6；不影响 ≥768 桌面端。
  - `prefers-reduced-motion` 时禁用面板过渡动画。
  - 持久化键 `mobile-layout-pref`（见第 4 节），含版本校验 `v:1`、30 天 TTL 自动清理、`fontScale` 越界回退 1.0、`JSON.stringify` 长度 >200B 时截断、`QuotaExceededError` 降级内存（面板顶部显示"偏好仅本次会话有效"提示条）。

### 3.9 技术文档中心（/docs 与 /docs/:slug）

- **注册表机制**：新增文档 = Markdown 文件放入 `src/docs/` + Vite `?raw` 导入 + 在 `registry.js` 登记 `{ slug, title, summary, date, tags, readTime, content }`。
- **列表页**：文档卡片（日期 · 阅读时长 / 标题 / 摘要 / 标签 / "阅读全文 →"），整卡跳转详情。
- **详情页**：
  - marked 渲染（GFM 开启、breaks 关闭），`dangerouslySetInnerHTML` 输出。
  - 面包屑导航；页头设置 `document.title`。
  - 切换文档自动回顶；URL 带 `#锚点` 时延迟 50ms 平滑滚动到对应章节（等待渲染完成）。
  - slug 不存在显示"文档未找到"空态 + 返回列表链接。
- 现有文档：`prompt-engineering`（提示词工程实战手册，2026-09）。
- **移动端响应式**：断点对齐统一三级体系；`.docs-page` <768 padding 降为 24px 16px 64px；`.doc-card` <768 padding 18px；`.markdown-body` <768 字号 0.9rem；`pre`/`table` <768 加 `-webkit-overflow-scrolling: touch` 平滑滚动；<480 padding 16px 12px、`h1` 1.4rem、`h2` 1.15rem。

### 3.10 关于页（/about）与 404 页

- About：Vite / React / React Router 三卡片技术栈介绍 + 返回首页链接。
- NotFound：404 标题 + "返回首页"链接（指向 `/index.html`）。
- **移动端响应式**：断点对齐统一三级体系；`.page` <768 padding 降为 24px 16px；<480 `.page h1` 28px、`.card` padding 20px 16px。

### 3.11 记忆翻牌（/memory，2026-10-26 新增）

#### 3.11.1 架构

- 页面壳 `Memory.jsx` 管理 UI 四态状态机（start / playing / paused / over 四屏）与 HUD；引擎 `MemoryEngine.js` 纯逻辑（不依赖 React），通过回调（onState / onGameOver / onPause）与 UI 通信；组件卸载时 `engine.dispose()` 清理定时器；引擎/页面壳解耦对齐 Snake/Tetris/Breakout 架构。

#### 3.11.2 玩法规则

- **难度**：4×4=16 张·8 对，5×4=20 张·10 对（图标池 10 个品牌词：React/Vite/LLM/Deploy/Debug/NPM/Cloud/Test/UI/Perf）。
- **洗牌**：Fisher–Yates 算法开局时执行一次（每对图标复制后整体洗牌）。
- **翻牌**：每次最多翻开 2 张；同一张牌重复点击、已翻开或已配对的牌点击、翻回窗口期（800ms）内额外翻牌一律忽略且不计步；800ms 锁定窗口内棋盘输入被引擎 `busy` 标志位禁锁。
- **配对**：相同图标保持正面并标记 `matched: true`（绿色描边 + ✓），不同图标 800ms 后自动翻回。
- **计时**：翻开第一张未配对的牌时启动（切后台/失焦不累积暂停时段，恢复时重置时钟基准——`elapsedBase` + `resumeAt` 双字段对齐 SnakeEngine 模式）。定时器精度 100ms，展示到秒。
- **得分公式**：`max(100, 基准分 − (步数 − 最少步数) × 15 − 用时秒数 × 3)`；4×4 基准 800 / 最少步数 8，5×4 基准 1200 / 最少步数 10；用时跨过 600s 后分数锁定为 100 不再下探。
- **结束**：全部配对自动进入结算屏，无手动结算入口。

#### 3.11.3 暂停机制

- `visibilitychange`（切后台）与 `window.blur`（失焦）双触发 + `pausedByVisibilityRef` 去重（对齐 3.3.6 番茄钟 / 3.6 贪吃蛇惯例）；仅 playing 态生效。
- 暂停时计时冻结、棋盘通过 `aria-hidden` 遮罩 + `pointer-events: none` 禁用翻牌；遮罩文案区分自动暂停（检测到页面切走）与手动暂停（暂停中）。
- 恢复时手动触发（引擎 `resume()` 重置 `resumeAt = Date.now()`），不按墙钟补算。

#### 3.11.4 排行榜

- 通过 `createLeaderboard('game-memory-leaderboard-v1')` 参数化绑定，不改 `leaderboard.js`。
- 50 条上限、TOP 10 展示、昵称 `maxlength=12` 默认取 `game-player-name`（无值则「无名飞侠」），提交成功后自动写回 `game-player-name`。
- **降级行为**：`localStorage` 配额满 / 不可用 → 榜单降级为内存数组 + 结算屏顶部红色提示条，不阻断游戏流程；JSON 损坏 → `loadRows()` 回退空数组，显示「虚位以待，等你上榜」空态。

#### 3.11.5 键盘与 aria 无障碍（约束卡②）

- 棋盘采用语义化 DOM（不使用 Canvas，Canvas 画面无法被读屏解释）：外层 `role="grid"`、行 `role="row"`、牌 `role="gridcell"` + 内层 `<button>`；按钮使用 **roving tabindex**（仅焦点所在的那一张 `tabIndex={0}`，其余 `-1`）。
- **焦点导航**：↑↓←→ 按行列移动，Home/End 跳到本行首/尾，首末行/列不环绕；翻牌使用 Enter / Space；焦点环统一 `:focus-visible { outline: 2px solid #aa3bff; outline-offset: 2px }`（不覆盖卡片圆角）。
- **配对后焦点管理**：当焦点所在的牌被配对成功后，自动跳到下一张未配对且未翻开的牌（同行优先，其次下一行循环）。
- **读屏播报**：页面侧有 `aria-live="polite"` + `aria-atomic="true"` 的不可见 `<div>`；引擎触发 `onState` 时携带 `matchResult: 'match' | 'mismatch' | null` 字段，页面据此更新播报文案（配对成功 → "配对成功，还有 N 对"；未配对 → "未配对，已翻回"）。计时器单独加 `aria-live="off"`，避免每秒刷新打断读屏节奏。
- 单张牌 `aria-label`：未翻开 → "第{r}行第{c}列，未翻开"；已翻开 → "第{r}行第{c}列，已翻开：{icon}"；已配对 → "第{r}行第{c}列，已配对：{icon}"。

#### 3.11.6 移动端触控与断点（约束卡①）

- 牌面最小触控区 44×44px（CSS `min-width/min-height` 兜底）。
- 棋盘宽度 `min(94vw, 420px)` 居中，4×4 与 5×4 均不产生横向滚动；`touch-action: manipulation` 关闭 iOS 双击缩放；`user-select: none` 关闭长按菜单；`overflow-x: hidden` 兜底。
- 断点沿用统一三级体系：<768 面板 padding 降为 16px 14px、棋盘宽度缩为 `min(94vw, 380px)`；<480 控制面板纵向堆叠、牌面圆角 8px、字号 1rem、结算 summary 改 2 列。
- 触控坐标 → idx：`touchEnd` 事件取 `changedTouches[0]` 位置，按棋盘相对宽度 / 高度反算行列索引。

#### 3.11.7 数据文档联动

- 新增 `src/docs/memory-game.md`（含「玩法与计分」「键盘与 aria 实现」「存储结构」3 个二级标题），并在 `src/docs/registry.js` 登记 `{ slug: 'memory-game', title: '记忆翻牌：可访问性小游戏实现笔记', date: '2026-10', tags: ['Game','A11y','React'], readTime: '约 6 分钟' }`。

### 3.12 南昌旅游介绍（/nanchang，2026-10-26 新增）

- **页面性质**：纯静态图文页（无存储键、无外部 API），手账纸感视觉风格（米白底 #f5f2ec、红色主题 #8f2f1d/#c94f2e、虚线边框卡片）。
- **结构**：「← 返回首页」链接 → Hero（标题/简介/4 个城市关键词标签）→ 三日行程推荐（3 张卡片，Day1 寻味老城 / Day2 历史与现代交织 / Day3 地标打卡）→ 景点速览（12 张卡片：名称 + 标签 + 门票预约信息 + 描述，含滕王阁背序免票、海昏侯博物馆、绿地双子塔等）→ 网红打卡墙（4 项：万寿宫花墙 / 珠宝街晴天墙 / 大士院老巷文化墙 / 滕王阁序灯笼墙）→ 必吃美食（8 项，含老三样、打平伙/堂瓦里、蛤蟆街夜宵）→ 交通与住宿（双栏面板）→ 手绘攻略图集 → 页脚小贴士（背序免票 / 周一闭馆 / 喷泉场次 / 摩天轮末班等实用信息）。
- **图集灯箱**：12 张素材图（`public/nanchang/nanchang-01~12.jpg`，由用户上传的 13 张手账风攻略图去重而来），`GALLERY` 常量数组驱动；图片 `loading="lazy"`，点击按钮打开灯箱，`role="dialog" aria-modal="true"`，Esc 关闭、←/→ 切换，打开时焦点落入关闭按钮，点击遮罩关闭、点击图片不关闭；打开期间锁定 body 滚动（`overflow:hidden`，关闭恢复）。
- **文档标题**：挂载时 `document.title = '南昌旅游介绍 - 天下英雄城'`，卸载恢复 'React App'。
- **无障碍**：灯箱/链接/图集按钮统一 `:focus-visible` 紫色焦点环（2px #aa3bff）；图集按钮带 `aria-label`。
- **移动端响应式**（2026-10-26 强化）：断点对齐统一三级体系；行程卡 <1024 改单列；<768 hero padding 32px 20px、标题 30px、交通住宿改单列、hero kicker 字距收紧 3px、禁用卡片 hover 位移；<480 hero 标题 26px、卡片 padding 16px 14px、标签 pill 缩小。景点/美食/图集三个 auto-fill 网格改用 `minmax(min(100%, N), 1fr)`，≤340px 窄屏不再横向溢出。灯箱移动端适配：新增 ‹ › 左右切换按钮（44×56 触控目标、safe-area 内边距）、水平滑动手势切换（位移 >50px 且水平占优）、`overscroll-behavior:contain` 防滚动穿透、说明文字避开按钮区。交互元素统一 `-webkit-tap-highlight-color: transparent`；`prefers-reduced-motion` 禁用 hover 位移。

## 4. 数据与存储一览

| 键 / 来源 | 位置 | 用途 |
|-----------|------|------|
| `game-leaderboard-v1` | localStorage | 飞机大战排行榜记录（≤50 条） |
| `game-player-name` | localStorage | 游戏玩家昵称（飞机大战/俄罗斯方块/贪吃蛇/打砖块共用，下次自动填充） |
| `game-2048-state` | localStorage | 2048 完整状态（`{ v:1, board, score, bestScore, undosLeft(0~3), history≤5, won, ts }`；版本校验、QuotaExceededError 降级内存、>5000B 丢弃 history 压缩；1s 兜底写入） |
| `game-2048-touch-starts` | localStorage | 2048 触摸操作启动累计次数（0~99999 封顶，每局 1 次） |
| `game-tetris-leaderboard-v1` | localStorage | 俄罗斯方块排行榜记录（≤50 条，`createLeaderboard` 参数化绑定，结构对齐 `game-leaderboard-v1`） |
| `game-snake-leaderboard-v1` | localStorage | 贪吃蛇排行榜记录（≤50 条，`createLeaderboard` 参数化绑定，结构对齐 `game-leaderboard-v1`） |
| `game-breakout-leaderboard-v1` | localStorage | 打砖块排行榜记录（≤50 条，`createLeaderboard` 参数化绑定，结构对齐 `game-leaderboard-v1`） |
| `game-breakout-state` | localStorage | 打砖块局中快照（`{ v:1, level, score, lives, bricks, won, ts }`；版本校验、7 天 TTL 自动清理、>4000B 丢弃、配额满降级内存；5s 兜底写入） |
| `game-breakout-touch-starts` | localStorage | 打砖块触摸操作启动累计次数（0~99999 封顶，每局 1 次） |
| `game-memory-leaderboard-v1` | localStorage | 记忆翻牌排行榜记录（≤50 条，`createLeaderboard` 参数化绑定，结构对齐 `game-leaderboard-v1`） |
| `pomo-completed` | localStorage | 番茄钟累计完成数 |
| `home-entry-clicks` | localStorage | 首页各作品入口点击次数（JSON，轻量行为统计，0~99999 封顶） |
| `game-touch-starts` | localStorage | 飞机大战触摸操作启动累计次数（0~99999 封顶，每局1次） |
| `game-pause-snapshot-v1` | localStorage | 飞机大战中断快照（`{ v:1, score, health, elapsed, pausedAt, reason }`；30 分钟 TTL，新开局/结束/过期清除） |
| `game-pause-board-cache-v1` | localStorage | 飞机大战暂停页排行榜降级缓存（`{ ts, items≤10 }`；TTL 5 分钟，成功响应覆盖） |
| `game-pause-events-v1` | localStorage | 飞机大战暂停来源计数（`{ manual, visibility, blur, contextlost, total }`，0~999 封顶，仅本地累计） |
| `mobile-layout-pref` | localStorage | 简历页移动端阅读偏好（`{ v:1, compact:boolean, fontScale:number(0.9~1.3), ts:number }`；30 天 TTL 自动清理；版本不符重置；fontScale 越界回退 1.0；>200B 截断；配额满降级内存） |
| `weather-geo-denied-tip` | sessionStorage | 定位拒绝提示的会话标记（自动提示每会话最多 1 次） |
| Open-Meteo API | 外部 | 天气实况与今日温度 |
| BigDataCloud API | 外部 | 坐标 → 城市名逆地理编码 |

## 5. 已知不一致点（对比需求文档时需注意）

这些是源码中实际存在的"实现与文案不一致"，生成/评审需求文档时应作为已确认的现状：

1. **番茄钟"今日"统计**：文案为"今日已完成 N 个番茄钟"，但计数是**累计值**，无按天重置逻辑。
2. **根路径 404**：访问 `/` 显示 404，首页实际在 `/index.html`；导航 Logo 点击会落到 404。
3. **拖拽为交换语义**：DragList 松手后两个元素互换，而非插入式排序。

## 6. 基线对比使用方式

1. 生成新需求文档后，逐节与本文档第 3 节对应页面比对。
2. 标记三类变更：**新增**（基线中不存在的功能）、**修改**（与基线行为不一致的描述）、**删除**（基线有但需求中移除的功能）。
3. 第 5 节的已知不一致点如需求中要求"修正"，属于变更；如需求照抄了错误文案，应标记为需求缺陷。
4. 本文档基于代码事实编写；代码变更后应同步更新本文档，保持基线有效。
