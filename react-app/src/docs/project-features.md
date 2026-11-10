# 项目功能详细说明（基线文档）

> 本文档基于 2026-11-04 对 `react-app` 源码的全量梳理生成，2026-11-05 增量同步「推箱子」，2026-11-08 补齐「关灯挑战 / 四连棋 / 连连看 / 黑白棋 / 扫雷」并校正技术栈与编号口径，2026-11-09 增量同步「天气卡片请求链路健壮性（四态 / 超时重试 / 快照降级 / 指数退避）」，2026-11-09 增量同步「迷宫寻路」，2026-11-10 增量同步「数独」并将今日游戏挑战轮换池补齐为 16 款，是当前项目**实际已实现功能**的客观描述。
> 用途：作为基线（Baseline），供 prd-scheduler 定时生成的需求文档进行对比——新需求应在此基线上增量描述，对比时可快速识别"新增 / 修改 / 删除"的功能点。
>
> **编号规则**：文中「第 N 款小游戏」统一按**小游戏上线顺序**编号，不含 `/game` 飞机大战与工具页（番茄钟 / 简历 / 南昌旅游 / 文档中心）；截至 2026-11-10 共 15 款。历史章节中的「作品卡片数」是首页入口卡的另一个口径，两者不混用。

## 1. 项目概览

### 1.1 项目定位

一个由 AI Agent 全自动构建的作品集网站（首页明确宣传"100% AI 生成代码，0 行人工编码"），包含 3D 射击游戏、2048 小游戏、俄罗斯方块、贪吃蛇、打砖块、记忆翻牌、打地鼠、数字华容道、关灯挑战、四连棋、连连看、推箱子、黑白棋、扫雷、迷宫寻路、数独、番茄时钟、在线简历、南昌旅游介绍、技术文档中心二十大功能模块。

### 1.2 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 19（函数组件 + Hooks，`react ^19.2.8`） |
| 构建工具 | Vite |
| 路由 | React Router v7（HashRouter，`react-router-dom ^7.18.3`） |
| 3D 渲染 | Three.js（游戏引擎自研封装 `SpaceShooter` 类） |
| Markdown 渲染 | marked（GFM 模式） |
| 特效 | 原生 Canvas 2D（鼠标轨迹） |
| 数据持久化 | localStorage（无后端数据库） |
| 外部 API | Open-Meteo（天气）、BigDataCloud（逆地理编码）、一言 Hitokoto（每日一句 / 推箱子通关寄语），均免费无 Key |

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
│   ├── Memory.jsx / .css       # 记忆翻牌页面壳（语义化 DOM + roving tabindex + 触控）
│   ├── Whack.jsx / .css         # 打地鼠页面壳（DOM 3×3 洞位 + 方向键无障碍 + 触控）
│   ├── Puzzle.jsx / .css        # 数字华容道页面壳（DOM 3×3 滑块 + 点按/滑动 + 触控）
│   ├── Sokoban.jsx / .css       # 推箱子页面壳（DOM 网格 + 相邻格点按/方向键/滑动 + 撤销）
│   ├── LightsOut.jsx / .css     # 关灯挑战页面壳（DOM 棋盘 + 十字翻转 + 撤销）
│   ├── Connect4.jsx / .css      # 四连棋页面壳（DOM 列棋盘 + 三档 AI + 触控）
│   ├── Lianliankan.jsx / .css   # 连连看页面壳（DOM 牌面 + 点选配对 + 提示/重排）
│   ├── Reversi.jsx / .css       # 黑白棋页面壳（DOM 8×8 棋盘 + 三档 AI + 落子预览）
│   ├── Minesweeper.jsx / .css   # 扫雷页面壳（DOM 雷区 + 首点安全 + 插旗 + 撤销）
│   ├── Maze.jsx / .css          # 迷宫寻路页面壳（DOM 网格 + 滑动/点按/方向键 + 三态遮罩）
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
│   ├── BreakoutEngine.js         # 打砖块引擎（纯逻辑：1/240s 固定步长物理 + 关卡布局 + 持久化）
│   ├── WhackEngine.js            # 打地鼠引擎（纯逻辑：结束时间戳计时 + 出鼠节奏 + 连击 + 统计持久化）
│   ├── PuzzleEngine.js           # 数字华容道引擎（纯逻辑：随机合法移动打乱 + 步数/计时 + 完成判定，无持久化）
│   ├── SokobanEngine.js          # 推箱子引擎（纯逻辑：12 关地图解析 + 推箱规则 + 撤销栈 + 限时计分）
│   ├── LightsOutEngine.js         # 关灯挑战引擎（纯逻辑：十字翻转 + 打乱保证可解 + 撤销 + 计分）
│   ├── Connect4Engine.js          # 四连棋引擎（纯逻辑：重力落子 + 胜负检测 + 三档 AI）
│   ├── LianliankanEngine.js       # 连连看引擎（纯逻辑：≤2 折线连通判定 + 可解重排 + 计时计分）
│   ├── ReversiEngine.js           # 黑白棋引擎（纯逻辑：八方向翻转 + 合法着法 + 三档 AI）
│   ├── MinesweeperEngine.js       # 扫雷引擎（纯逻辑：首点安全布雷 + 洪泛展开 + 撤销栈）
│   └── MazeEngine.js              # 迷宫寻路引擎（纯逻辑：DFS 回溯生成 + BFS 最短路 + 限时计分）
├── components/
│   ├── Navbar.jsx               # 顶部导航
│   ├── MouseTrail.jsx           # 鼠标轨迹特效（Canvas）
│   ├── DragList.jsx             # 拖拽列表（H5 原生拖放）
│   ├── Weather.jsx              # 天气卡片
│   └── CardLayout.jsx / .css   # 通用卡片布局组件（三段结构 + 技术标签）
├── api/
│   ├── leaderboard.js           # 排行榜 API（localStorage 版，接口对齐未来云函数版）
│   ├── sokobanQuote.js          # 推箱子通关寄语（一言 API + 超时降级本地句子池 + 按日缓存）
│   └── dailyChallenge.js        # 今日游戏挑战（按日期哈希确定性选游戏 + 每日缓存）
└── docs/
    ├── registry.js              # 文档注册表（slug / 标题 / 摘要 / 标签 / 内容）
    └── *.md                     # Markdown 文档源文件（Vite ?raw 导入）
```

### 1.4 路由与加载策略

| 路由 | 页面 | 加载方式 |
|------|------|----------|
| `/` | Home 首页 | 直接引入 |
| `/about` | About 关于 | 直接引入 |
| `/resume` | Resume 简历 | 直接引入 |
| `/pomodoro` | Pomodoro 番茄钟 | 直接引入 |
| `/game` | Game 飞机大战 | **lazy 懒加载**（含 Three.js，体积大） |
| `/2048` | Game2048 2048 小游戏 | **lazy 懒加载**（含引擎逻辑，与飞机大战分包） |
| `/tetris` | Tetris 俄罗斯方块 | **lazy 懒加载**（位运算引擎 + Canvas 2D，独立分包） |
| `/snake` | Snake 贪吃蛇 | **lazy 懒加载**（输入缓冲引擎 + Canvas 2D，独立分包） |
| `/breakout` | Breakout 打砖块 | **lazy 懒加载**（固定步长物理引擎 + Canvas 2D，独立分包） |
| `/memory` | Memory 记忆翻牌 | **lazy 懒加载**（纯 DOM + 无障碍，独立分包） |
| `/whack` | Whack 打地鼠 | **lazy 懒加载**（纯 DOM + 键盘无障碍，独立分包） |
| `/puzzle` | Puzzle 数字华容道 | **lazy 懒加载**（纯 DOM + 触控滑动，独立分包） |
| `/sokoban` | Sokoban 推箱子 | **lazy 懒加载**（纯 DOM + 撤销栈，独立分包） |
| `/lightsout` | LightsOut 关灯挑战 | **lazy 懒加载**（纯 DOM + 十字翻转，独立分包） |
| `/connect4` | Connect4 四连棋 | **lazy 懒加载**（纯 DOM + 三档 AI，独立分包） |
| `/lianliankan` | Lianliankan 连连看 | **lazy 懒加载**（纯 DOM + 连通判定，独立分包） |
| `/reversi` | Reversi 黑白棋 | **lazy 懒加载**（纯 DOM + 三档 AI，独立分包） |
| `/minesweeper` | Minesweeper 扫雷 | **lazy 懒加载**（纯 DOM + 雷区状态机，独立分包） |
| `/maze` | Maze 迷宫寻路 | **lazy 懒加载**（纯 DOM + 随机迷宫生成，独立分包） |
| `/sudoku` | Sudoku 数独 | **lazy 懒加载**（纯 DOM + 唯一解数独引擎，独立分包） |
| `/nanchang` | Nanchang 南昌旅游介绍 | **lazy 懒加载**（图文静态页 + 图集灯箱，独立分包） |
| `/docs` | Docs 文档列表 | **lazy 懒加载**（含 marked） |
| `/docs/:slug` | DocView 文档详情 | **lazy 懒加载** |
| `*` | NotFound 404 | 直接引入 |

懒加载统一使用 `<Suspense fallback="加载中…">`。

路由使用 `HashRouter`（URL 形如 `/index.html#/game`），路由状态保存在 hash 中，刷新深链不会丢失当前页面，适配不支持 rewrite 的静态托管。

## 2. 全局功能

### 2.1 导航栏（Navbar）

- 左侧品牌区：Vite logo + "React App" 文字，点击跳转 `/`。
- 右侧导航链接 7 项：首页（`/`）、飞机大战（`/game`）、俄罗斯方块（`/tetris`）、番茄钟（`/pomodoro`）、简历（`/resume`）、南昌旅游（`/nanchang`）、技术文档（`/docs`）。
- 当前路由高亮（NavLink active 态）。
- 移动端：汉堡按钮（aria-expanded 无障碍标注）展开/收起菜单；点击任意链接自动收起菜单。
- **移动端响应式**：断点对齐统一三级体系；汉堡菜单触发点 <768（767px）；收起态链接 <768 字号 15px、padding 10px 12px。

### 2.2 路由模式

- 使用 `HashRouter`，URL 形如 `/index.html#/game`；hash 变化不触发服务端请求，因此刷新任意页面都能停留在当前路由。
- 根路径 `/` 对应首页，导航栏品牌 Logo 与「首页」链接均指向 `/`。

## 3. 页面功能明细

### 3.1 首页（/）

Bento Grid 网格布局，自上而下：

1. **项目定位大卡**（占 8/12 宽）：宣传语"自动化构建部署"，两个 CTA 按钮 → `/game`、`/docs`。
2. **右侧栏**（4/12 宽）：
   - **AI 技术栈卡片**：11 个技能标签（VibeCode、AgentCode、RAG、React 等），包裹在**可拖拽排序**的 DragList 中（支持 Alt+↑/↓ 键盘交换，见 3.1.3）。
   - **本地天气卡片**（见 3.1.1）。
3. **Agent 工作流**：4 张流程卡（需求理解 → 代码生成 → 浏览器自测 → 构建部署），可 Tab 聚焦（tabindex=0 + role="group"）。
4. **作品入口**（原「精选作品」+「技术实践」两区块合并，路由去重）：20 张由 `CardLayout` 渲染的卡片（飞机大战→/game、番茄时钟→/pomodoro、在线简历→/resume、南昌旅游→/nanchang、提示词工程文档→/docs、2048 小游戏→/2048、俄罗斯方块→/tetris、贪吃蛇→/snake、打砖块→/breakout、记忆翻牌→/memory、打地鼠→/whack、数字华容道→/puzzle、关灯挑战→/lightsout、连连看→/lianliankan、四连棋→/connect4、推箱子→/sokoban、黑白棋→/reversi、扫雷→/minesweeper、迷宫寻路→/maze、数独→/sudoku），每条路由唯一（2026-10-22 打砖块替换原"更多"占位卡；2026-10-26 新增记忆翻牌卡；2026-10-30 新增打地鼠卡；2026-11-01 新增数字华容道卡；2026-11-03 新增关灯挑战/连连看/四连棋卡；2026-11-05 新增推箱子卡；2026-11-07 新增黑白棋卡；2026-11-08 新增扫雷卡；2026-11-09 新增迷宫寻路卡；2026-11-10 新增数独卡）。卡片 `children` 内容区为作品描述 + 原「技术实践」对应卡的技术描述（`.cl-practice` 段落）；`footer` 为 meta + `Link` 跳转（点击计数写入 `home-entry-clicks`，约束卡①）。`data-keywords` 经 `...rest` 透传供 MouseTrail 切换粒子词库（见 3.1.4）。原 `bento-work` 卡片样式（13 个 `.bento-work*` 选择器）与「03 技术实践」独立区块已移除。
5. **统计条**：100% AI 生成代码 / 0 行人工编码 / 20 个功能模块（`ENTRIES.length` 驱动，无手写数字；进入视口时 800ms 数字滚动动画，reduced-motion 直接显示；2026-11-09 随作品入口增至 19、2026-11-10 随作品入口增至 20）/ 实时天气摘要格（与天气卡片共享 useWeather 状态，四态含 stale 降级：缓存温度 + 「N 分钟前」后缀；点击平滑滚动并聚焦天气卡）/ mailto 联系链接。
- **键盘可达性**：Bento 内全部可交互元素支持 Tab 聚焦 + Enter/Space 激活，统一 `:focus-visible` 紫色焦点环（2px #aa3bff）。
- **移动端响应式**：断点对齐统一三级体系（≥1024 / 768~1023 / <768 / <480）；Bento 网格 <1024 改 6 列过渡、<768 改单列；`.home-page` <768 padding 降为 24px 16px 48px；`.bento-about`/`.bento-skills` <768 `min-height: auto`；统计条 `.bento-stat-num` <768 24px、<480 统计条改纵向堆叠。

#### 3.1.1 鼠标轨迹特效（MouseTrail，仅首页挂载）

- 独立全屏 Canvas，`pointer-events: none` 不影响交互，`aria-hidden`。
- **光晕**：径向渐变圆形，rAF 缓动（系数 0.12）跟随鼠标。
- **关键词粒子**：鼠标移动时在周围随机位置生成 AI 关键词文字粒子，带初速度和"重力"向下坠落，逐渐淡出；生成节流 66ms，上限 40 个，18 个关键词随机取。
- **hover 反馈**：悬停 `a/button/[role="button"]` 时光晕半径 150→220、颜色变紫、粒子变紫；悬停带 `data-keywords` 的精选作品卡时粒子改用该卡主题词表（6 词/卡）；键盘 `:focus-visible` 聚焦与 hover 等效联动（focusin/focusout 监听）。
- 支持窗口 resize（devicePixelRatio 上限 2）、鼠标离开窗口隐藏光晕。
- 天气联动（2026-11-09）：悬停/聚焦天气卡片时粒子词库按当前天气切换（晴/雨/雪/雾/雷/云各 6 词，未知码回退默认 6 词）；卡片降级态（`data-weather-stale="true"`）时光晕改琥珀 `#d97706`，恢复后立即回紫。

#### 3.1.2 天气卡片（Weather）

- 数据源 Open-Meteo 免费接口（当前温度/湿度/体感/风速/天气代码 + 今日最高最低温），无需 API Key。
- **状态提升**：数据逻辑抽为 `useWeather()` hook 导出，由 Home 持有，天气卡片与统计条天气摘要格共享同一份状态（不重复请求）。
- 定位：优先浏览器 Geolocation（8s 超时、10min 缓存），失败/拒绝/不支持时回退杭州坐标并标注"杭州（默认）"；**拒绝授权时卡片顶部显示"已使用杭州默认位置"提示条 + "重试定位"按钮**（自动加载每会话最多提示 1 次，sessionStorage 标记；手动重试被拒总是复现）。
- 地名：通过 BigDataCloud 逆地理接口补全，失败静默降级显示"当前位置"。
- 天气代码：WMO 标准码映射为中文描述 + 白天/夜间两套 emoji 图标，未知码显示"未知 🌡️"。
- 刷新：每 10 分钟自动刷新；右上角 ↻ 按钮手动刷新（**30s 节流**，节流命中时 title 提示"刷新过于频繁，请稍后再试"；节流时间戳为模块级变量，页面刷新即重置）。
- 状态：loading 骨架屏 / error 显示"天气获取失败 + 重试按钮" / 成功展示数据；卸载时通过 mountedRef 防止内存泄漏 setState。
- **请求链路健壮性（2026-11-09 新增）**：
  - 单次请求 10s 超时（AbortController，不支持时降级 Promise.race），同一时刻最多 1 个 in-flight 请求（并发调用共享同一 Promise），失败后按 1s / 3s 各重试 1 次。
  - 成功时把 `{ current, daily, place, ts }` 写入 `weather-last-ok`（序列化 >500KB 或配额满则放弃写入/清空后静默降级）；失败且快照年龄 ≤60 分钟进入 **stale 降级态**：继续展示快照数据 + 表头"离线 · N 分钟前"徽标 + `weather-place` 行内「回退」「重试」按钮，正文 `opacity 0.6` + 卡片琥珀虚线 outline；快照缺失或 >60 分钟进入 error 态。
  - 自动刷新失败按 20 / 40 / 60 分钟指数退避并写 `weather-auto-backoff`（`{ failCount, nextAt }`），任一成功清零回到 10 分钟；`visibilitychange` + `blur` 双路暂停，回前台 / `online` 时若 `nextAt` 已过则补一次请求。
  - 重试与回退按钮点击后冻结 5s；回退只保留 1 级内存快照（`prevSnapshot`），回退后置 stale 并同步覆盖 `weather-last-ok`，无快照时不渲染回退按钮。
  - 状态事件 `weather:state`（`{ status, stale, failCount, reason, ts }`）签名去重 + 500ms 节流，`window.__weatherStateStats` 内存计数，不写存储。
  - 错误文案区分「定位失败，无法获取天气」（定位与天气均失败）与「天气获取失败」。
- **移动端适配检测（2026-11-02 新增）**：`Weather` 组件内 `useAdaptiveProbe()` 只读检测，不改数据流——
  - 视口按 ≥1024 / 768~1023 / 480~767 / <480 映射 `data-adapt-tier`（desktop/tablet/mobile/compact），`ResizeObserver` 记录卡片实测宽度到 `data-adapt-width`，变化后 300ms 防抖检测。
  - 检查页面横向滚动（`documentElement.scrollWidth - clientWidth > 2px`）与 `.weather-body` / `.weather-meta` / `.weather-place` / `.weather-error` 越过卡片内边距（容差 2px），异常需间隔 200ms 两次复检确认，结果写入 `data-adapt-overflow`。
  - 确认溢出时卡片底部渲染「适配异常：N 处横向溢出」+「重新检测」按钮（跳过防抖）；提示行 `role="status" aria-live="polite"`，按钮 `aria-label="重新检测天气卡片移动端适配"`、`:focus-visible` 2px #aa3bff 焦点环。
  - 状态变化派发 `weather:adapt:report` 自定义事件（`{ viewportTier, viewportWidth, cardWidth, overflowCount, clippedElements, observer, ts }`），签名去重 + 500ms 节流；`window.__weatherAdaptStats` 内存级计数（count / lastTier / lastOverflowCount / lastTs / observer），不写 localStorage。
  - `ResizeObserver` 不可用时降级 `window.resize` 监听并标记 `observer:false`；卡片宽度 <100px（隐藏态）时跳过检测；loading 态不做溢出判定，加载结束 200ms 后补一次完整检测。

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

- **顶部 HUD**：左「← 返回首页」（指向 `/`）、右两个得分框（当前得分 + 最高分，最高分金色高亮）。
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

- **顶部 HUD**：左「← 返回首页」（指向 `/`）、右三个数据框（得分 / 等级 / 消行数，得分 bump 动画 300ms，`prefers-reduced-motion` 禁用）。
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

- **顶部 HUD**：左「← 返回首页」（指向 `/`）、右三个数据框（得分 / 最高分 / 长度）；得分 bump 动画 300ms（`prefers-reduced-motion` 禁用）；**最高分 = 排行榜第一名分数**（不单设存储键），排行榜空时显示 0。
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

- **顶部 HUD**：左「← 返回首页」（指向 `/`）、右数据框（得分 bump 动画 300ms / 关卡 / 3 颗红心 / 天气主题标签——仅主题非默认时显示）；`aria-live="polite"` 播报。
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
  - 2026-10-29 修正：`ts` 缺失/非正数的脏数据视为过期直接清理；`fontScale` 先按 0.1 步长四舍五入归一（0.95→1.0）再范围校验；写入从 `setState` updater 移出到 `useEffect`，且仅用户改动后才落盘（挂载不刷新 `ts`，保留 TTL 语义）。
- **打印适配模块（2026-10-29 新增）**：
  - 打印入口 `.resume-print-bar`（位于 hero 内联系方式下方）：按钮「打印 / 导出 PDF」`aria-label="打印简历"`，点击调用 `window.print()`；`min-width:768px` 显示，<768 与 `@media print` 隐藏；不支持 `window.print` 时不渲染。
  - 版心：`@page { size:A4; margin:12mm 10mm }`，打印时 `.resume-sheet` 宽 190mm、`min-height:273mm`、去阴影；`.hero`/`main` 水平内边距归零，页边距交由 `@page` 承担（分页后每页保留边距）。
  - 偏好隔离：打印固定 `font-size:16px`、行高 1.7，忽略 `--resume-fs`；`beforeprint` 移除内联 `--resume-fs`、`afterprint` 按当前 `fontScale` 恢复；`.resume-page.compact` 在打印下 padding 归零、行高还原。
  - 分页：`.sec` 整体 `break-inside: avoid`，`.sec.long`（技术简介 / 项目经验）允许断页但 `li` 与 `.proj > div` 逐条避断；`h2` 保持 `break-after: avoid`。
  - 打印色彩：`.resume-page`/`resume-sheet` 使用 `print-color-adjust: exact`（含 `-webkit-` 前缀）；打印按钮、浮动齿轮与偏好面板 `display:none`。

### 3.9 技术文档中心（/docs 与 /docs/:slug）

- **注册表机制**：新增文档 = Markdown 文件放入 `src/docs/` + Vite `?raw` 导入 + 在 `registry.js` 登记 `{ slug, title, summary, date, tags, readTime, content }`。
- **列表页**：文档卡片（日期 · 阅读时长 / 标题 / 摘要 / 标签 / "阅读全文 →"），整卡跳转详情。
- **详情页**：
  - marked 渲染（GFM 开启、breaks 关闭），`dangerouslySetInnerHTML` 输出。
  - 面包屑导航；页头设置 `document.title`。
  - 切换文档自动回顶；URL 带 `#锚点` 时延迟 50ms 平滑滚动到对应章节（等待渲染完成）。
  - slug 不存在显示"文档未找到"空态 + 返回列表链接。
- 现有文档：`project-features`（本基线）、`prompt-engineering`（提示词工程实战手册）、`memory-game`、`lightsout-game`、`connect4-game`、`lianliankan-game`、`sokoban-game`（推箱子需求与实现说明，2026-11-05 新增）、`reversi-game`（黑白棋，2026-11-07 新增）、`minesweeper-game`（扫雷，2026-11-08 新增）、`maze-game`（迷宫寻路，2026-11-09 新增）、`sudoku-game`（数独，2026-11-10 新增）、`daily-challenge`。
- **移动端响应式**：断点对齐统一三级体系；`.docs-page` <768 padding 降为 24px 16px 64px；`.doc-card` <768 padding 18px；`.markdown-body` <768 字号 0.9rem；`pre`/`table` <768 加 `-webkit-overflow-scrolling: touch` 平滑滚动；<480 padding 16px 12px、`h1` 1.4rem、`h2` 1.15rem。
- **移动端横向溢出修复（2026-11-02）**：根因是 `.docs-page` 同时继承全局 `.page` 的 `align-items: center`，在 flex 纵向布局下正文按 max-content 宽度撑开（375px 视口下详情页实测宽 863px、横向溢出 504px）。修复为 `.docs-page` 显式 `width: 100%` + `box-sizing: border-box` + `align-items: stretch`，正文宽度跟随 `.docs-page` 上限；超宽表格与代码块改为在自身 `overflow-x: auto` 容器内横向滚动，不再撑破页面。实测 320/360/375/414/480/600/768/820/1024 九档宽度下列表页与详情页均无页面级横向溢出。

### 3.10 关于页（/about）与 404 页

- About：Vite / React / React Router 三卡片技术栈介绍 + 返回首页链接。
- NotFound：404 标题 + "返回首页"链接（指向 `/`）。
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

### 3.13 打地鼠（/whack，2026-10-30 新增）

#### 3.13.1 架构

- 页面壳 `Whack.jsx` 管理 UI 四态状态机（ready / playing（含 1000ms 准备期）/ paused / over）与 HUD；引擎 `WhackEngine.js` 纯逻辑（不依赖 React / DOM / Canvas），通过回调（onState / onFeedback / onGameOver / onPause / onPersistError）与 UI 通信；组件卸载时 `engine.dispose()` 清理定时器并落盘统计。架构模式参照记忆翻牌 3.11.1。
- 渲染：3×3 共 9 个洞位为**语义化 DOM**（不用 Canvas，保证读屏可解释），地鼠节点在洞位内切换显隐，不增删 DOM。

#### 3.13.2 玩法规则

- **洞位**：3 行 × 3 列，共 9 个。
- **单局时长**：固定 30 秒；开局先有 1000ms 准备期（出「准备…」遮罩、不出鼠、点击全部忽略且不计 miss）。
- **出鼠节奏**：准备期后首个地鼠延迟 300ms；可见窗口初始 600ms，每经过 5s 递减 50ms，下限 350ms；地鼠消失后空窗 250ms；随机洞位且不与上一只同洞。
- **金鼠**：出现概率 10%，命中 +30 分（普通鼠 +10 分）。
- **连击**：相邻命中间隔 ≤1200ms 计入连击；连击 ≥4 时每次命中额外 +5 分（单次最高 35 分 = 金鼠 30 + 加成 5）；击空或断档 >1200ms 连击归零。
- **击空与忽略**：点按无鼠洞位记 miss +1、不计分、连击归零；地鼠被命中或自然消失后，同一洞位 800ms 内点击一律忽略（不重复计分、不计 miss）；但忽略窗口内若该洞位已刷出新地鼠，**命中判定优先于忽略窗口**，仍判命中得分（忽略窗口只拦截击空）。
- **得分与结算**：时间归零进入 over，展示得分、最佳分、命中率（`hits/(hits+misses)`，分母 0 显示 0%）、最高连击；得分超过历史最佳时标记「新纪录！」并覆盖最佳分。本页不接排行榜（避免第二个存储键）。

#### 3.13.3 计时与暂停

- 计时基于结束时间戳（`startedAt + 30000`）驱动，100ms 轮询刷新剩余时间（显示 1 位小数），不使用 setInterval 累减，切后台恢复不跳秒；HUD 口径：ready 与准备期内（含准备期暂停）均显示完整 30s，准备期暂停时引擎冻结值含准备期余量，显示侧按 30s 封顶（仅显示口径，不影响实际游戏时长）。
- 暂停：`visibilitychange`（切后台）与 `window.blur`（失焦）双触发 + `pausedByVisibilityRef` 去重（对齐 3.3.6）；手动暂停同路径，`pause()` 幂等且仅 playing 生效；暂停冻结剩余时间、剩余准备期与地鼠可见窗口，落盘统计。
- 恢复：手动点击「继续游戏」，重置时钟基准（`endAt = now + remainingMs`、准备期基准 `startedAt = now + 剩余准备期`）、重建地鼠剩余窗口，并给 300ms 无输入缓冲（缓冲期点击忽略）；准备期内被暂停的局恢复后按剩余准备期重新倒数，不立即出鼠、不立即计时；`document.hidden` 时页面拒绝恢复。

#### 3.13.4 键盘与无障碍

- 棋盘 `role="grid"` / 行 `role="row"` / 洞位 `role="gridcell"` + 内层 `<button>`，roving tabindex（仅焦点洞位 `tabIndex=0`）。
- ↑↓←→ 按行列移动焦点、Home/End 跳行首/行尾、首末不环绕；Enter/Space 由按钮原生触发 click，与点按语义一致；`:focus-visible` 2px #aa3bff 焦点环。
- `aria-live="polite"` 播报命中分数（含连击数）与击空；剩余时间 `role="timer" aria-live="off"` 避免每秒打断读屏；洞位 `aria-label` 为「第 R 行第 C 列，地鼠 / 金鼠 / 空洞」。

#### 3.13.5 移动端与断点

- 棋盘 `min(92vw, 420px)`；<768 `min(94vw, 380px)`、HUD 字号降档；<480 宽 `min(92vw, 340px)`、HUD 纵向压缩、结算信息改 2 列；洞位最小 44×44px 触控区。
- 棋盘 `touch-action: manipulation` 关闭 iOS 双击缩放、`user-select: none` 关闭长按菜单；`.wh-page` `overflow-x: hidden` 兜底；`prefers-reduced-motion` 禁用出鼠弹跳与浮动数字上移动画（浮动数字改为纯淡出）。

#### 3.13.6 统计持久化（约束卡② 对应实现）

- **存储键 `game-whack-stats-v1`**：`{ v:1, starts, hits, misses, games, best, maxCombo, ts }`，各计数 0~99999 封顶，`best` 单调递增。
- 写入策略：脏标记延迟持久化，在开局 / 结算 / 暂停 / `pagehide` / 卸载时落盘，运行中 30s 兜底写一次（不在每次命中同步写）。
- 容错：`v` 不符或 JSON 损坏 → 清旧值回退零值；`QuotaExceededError` 或 localStorage 不可用 → `storageOk=false` + 页面顶部红色提示条「战绩仅本次会话有效（本地存储不可用）」，游戏不中断。

### 3.14 数字华容道（/puzzle，2026-11-01 新增）

#### 3.14.1 架构

- 页面壳 `Puzzle.jsx` 管理 UI 四态状态机（idle / playing / paused / over）与 HUD（步数 / 用时）；引擎 `PuzzleEngine.js` 纯逻辑（不依赖 React / DOM / Canvas），通过回调（onState / onElapsed / onWin / onPause）与 UI 通信；组件卸载时 `engine.dispose()` 清理计时器。架构模式参照打地鼠 3.13.1。
- 渲染：3×3 共 9 格为**语义化 DOM**（CSS Grid + `<button>`，不用 Canvas），每格 `role="gridcell"`，数字方块 `aria-label="第 R 行第 C 列，数字 N"`，空格为虚线边框占位。

#### 3.14.2 玩法规则

- **棋盘**：3×3，8 个数字方块（1~8）+ 1 个空格；完成态为 1~8 按行优先排列且空格在右下角。
- **打乱**：从完成态执行 80 次随机合法移动（禁止即时反向撤回），保证可解；乱度校验「正确位置方块 ≥7」或仍为完成态时重打乱，最多 5 次，仍未达标追加 20 次合法移动；最终仍为完成态时强制再走 3 次。
- **点按**：仅与空格曼哈顿距离 = 1 的方块响应（交换位置、步数 +1）；同行/同列距离 ≥2、空格本身、`idle/paused/over` 期间点击一律忽略且不计步。
- **滑动**：位移 ≥24px 且主轴分量占比 >70% 判定方向（阈值对齐 2048 / 贪吃蛇），空格沿该方向移动 1 格、步数 +1；位移不足、斜向或越界忽略且不计步。
- **输入锁**：每次有效移动后 200ms 内不再接受输入（防连续点按重复计步）。
- **完成判定**：1~8 按行优先归位且空格在右下角 → 立即进入 `over`，棋盘整体加 2px `#16a34a` 绿色描边并保持到重新开局。

#### 3.14.3 计时与暂停

- 计时在**首次有效移动**时启动，基于 `Date.now()` 双字段（`elapsedBase` + `resumeAt`），100ms 轮询且仅在 0.1s 显示值变化时推送（对齐 3.11.2 记忆翻牌），HUD 展示保留 1 位小数。
- 暂停：`visibilitychange`（切后台）与 `window.blur`（失焦）双触发 + `pausedByVisibilityRef` 去重（对齐 3.3.6），`pause()` 幂等且仅 `playing` 生效；暂停冻结用时，恢复手动点击「继续游戏」，`document.hidden` 时拒绝恢复，恢复重置时钟基准不跳秒。
- `pagehide` 时自动暂停，避免离开页面后计时继续累计。

#### 3.14.4 屏幕与 HUD

- **顶部**：左「← 首页」（指向 `/`）、标题、播放态「暂停 / 继续」按钮。
- **HUD**：步数 / 用时（`role="timer" aria-live="off"` 避免每秒打断读屏）。
- **idle 屏**：玩法说明 + 「本会话最佳：N 步 / —（暂无记录）」+「开始挑战」（300ms 连点防抖）。
- **paused 屏**：区分自动暂停（"检测到页面切走或窗口失焦，计时已冻结"）与手动暂停。
- **over 屏**：标题"全部归位！"+ 步数 / 用时 / 最佳步数 + 刷新最佳时「新纪录！」+「再来一局」/ 返回首页；首次完成不显示「新纪录！」。
- **错误态**：引擎构造异常 → 「棋盘加载失败，请重试」+「重试」按钮，重试重建引擎，不进入 playing。
- **操作提示条**：「点按空格相邻方块 · 滑动棋盘换位」（<768 常显）。

#### 3.14.5 移动端与断点（约束卡① 对应实现）

- 棋盘 ≥768 `min(92vw, 420px)`、<768 `min(94vw, 380px)`、<480 `min(92vw, 340px)`，`aspect-ratio: 1/1`；方块最小 44×44px 触控区。
- 棋盘 `touch-action: none`（滑动换位不触发页面滚动/缩放）、`user-select: none`、`-webkit-tap-highlight-color: transparent`；`.pz-page` `overflow-x: hidden` 兜底。
- `touchmove` 以 `{ passive: false }` 原生监听 + `preventDefault` 阻止滚动；多点触摸仅跟踪首指 identifier，`touchcancel` 清空跟踪态；鼠标按下/抬起按位移判定同一套滑动语义。
- HUD 字号 <768 1.05rem、<480 0.95rem；<480 返回链接 13px、按钮纵排占满整行、结算遮罩 `.pz-overlay-card` padding 收窄；`prefers-reduced-motion` 禁用方块位移动画与 hover 位移。

#### 3.14.6 存储

- 本页**不读写任何存储键**：最佳步数存于 `PuzzleEngine.js` 模块级内存变量（本会话内有效，页面刷新即清空），不接排行榜（与打地鼠 3.13.2 的取舍一致）。

### 3.15 推箱子（/sokoban，2026-11-05 新增）

#### 3.15.1 架构

- 页面壳 `Sokoban.jsx` 管理四态（start / playing / paused / over / failed）；引擎 `SokobanEngine.js` 纯逻辑（不依赖 React / DOM），通过 `onState` / `onGameOver` / `onPause` 回调与 UI 通信；页面每 200ms 调 `tick()` 驱动倒计时，`dispose()` 解除回调。
- 数据层 `api/sokobanQuote.js`：一言请求、字段校验、本地降级句子池、按日缓存，全部容错（存储不可用 / JSON 损坏 / 版本或日期不符均视为无缓存）。
- 渲染为**语义化 DOM**（CSS Grid + `<button>`，不用 Canvas）：`role="grid"` / 行 `role="row"` / 格 `role="gridcell"`；玩家所在格为唯一 `tabIndex=0`（roving tabindex），有效移动后焦点跟随玩家。

#### 3.15.2 玩法规则与关卡

- 地图符号：`#` 墙、`.` 目标点、`$` 箱子、`*` 箱在目标点、`@` 玩家、`+` 玩家在目标点；解析时校验行宽一致、玩家唯一、箱子数 = 目标数。
- 四方向移动：目标格为墙 → 无效；目标格为箱子时，箱子后方必须为空地，否则整步无效（不增加步数）；有效移动 `moves+1`，推箱额外 `pushes+1`。
- 全部箱子位于目标点 → 立即 `over` 并结算；箱子离开目标点只更新 HUD。
- **撤销**：每次有效移动前保存 `{player, boxes, moves, pushes}`，可无限次回退且四项同步还原；历史上限 200 步，超出丢弃最早记录。空栈/非 playing 返回 false，无副作用。
- **重开**：按当前关初始地图重建，步数/推箱/历史/计时全部清零。
- 12 个手工关卡（入门 1~4 / 进阶 5~8 / 专家 9~12），最大 6 列 8 行；全部经独立 BFS 求解器验证可通关，`par` 即最短步数（3/5/6/8/9/10/13/13/19/23/26/27）。箱数从 1 增至 4。

#### 3.15.3 计时、计分与失败

- 计时在**首次有效移动**时启动，`elapsedBase + resumeAt` 双字段；`tick()` 每 200ms 刷新，达到限时（入门 120 / 进阶 150 / 专家 180 秒）→ `failed`，得分 0。
- 未移动不启动计时、不会超时；暂停/切后台冻结时长，恢复重置时钟基准。
- 通关得分 = `max(100, 基准分 − max(0, moves−par)×8 − floor(秒数)×2)`，基准分 500 / 800 / 1200，下限 100。
- 暂停：`visibilitychange` + `window.blur` 双路 + `pausedByVisibilityRef` 去重；手动暂停与自动暂停在 paused 屏分别提示；暂停时棋盘 `pointer-events:none` 且 `aria-hidden`。

#### 3.15.4 屏幕、触控与无障碍

- **start 屏**：12 关分组列表（入门/进阶/专家），每关显示参考步数、限时与最佳分或「暂无记录」；点关即开局。start 卡 `max-height: calc(100svh - 32px)` 内部滚动。
- **playing HUD**：关卡 n/12、步数、推箱、倒计时（`role="timer" aria-live="off"`）。
- **触控**：点按玩家上下左右相邻格移动（非相邻格播报「只能移动到相邻格」）；3×3 方向键区（↑↓←→，单钮 ≥50px）；棋盘滑动位移 ≥24px 且主轴判定方向（`touch-action:none`）。
- **键盘/读屏**：方向键直接移动并 `preventDefault` 阻止页面滚动；Enter/Space 播报当前格内容与归位进度；`aria-live` 播报开始/移动/推箱/撞墙/撤销/重开/通关/超时，`tick` 不重复播报。
- **over 屏**：关卡/步数（含 par）/推箱/用时/得分/最佳 + 通关寄语；非末关显示「下一关」，末关显示「全部 12 关通关」；**failed 屏**：剩余未归位箱数 + 再试一次；**error 屏**：引擎异常 →「棋盘加载失败」+ 重试。

#### 3.15.5 外部 API 与失败降级（约束卡）

- 通关后请求一言 `https://v1.hitokoto.cn/?encode=json&charset=utf-8`，`AbortController` 3 秒超时；`normalizeQuote` 校验 `hitokoto` 非空、截断 80 字、`from` 截断 30 字。
- 非 2xx / 超时 / 字段非法 → 降级 8 条本地句子池（按关卡确定性选句），标记来源「本地句子池」；成功与降级都写入当日缓存，同日不重复请求。

#### 3.15.6 存储

- `game-sokoban-best-v1`：`{ v:1, best:{ [levelId]:{score,moves,time} }, updatedAt }`，仅更高分覆盖；损坏/版本不符回退空对象。
- `game-sokoban-stats-v1`：`{ v:1, plays, clears, pushes, timeByTier, updatedAt }` 累计；脏标记 + 1s 兜底 + `pagehide` 落盘；写入失败静默。
- `game-sokoban-quote-v1`：`{ v:1, date, text, source, fallback }`，按日失效；载荷超 200 字符不写。
- 配额满时游戏继续，结算页提示「本局成绩未保存」。

#### 3.15.7 移动端与断点

- 地图最多 6 列；<480 页面内边距 12px、棋盘内边距 8px、列间距 4px，320px 下 6 列单格实测 43px（≥40px）；地砖/墙/按钮统一 `box-sizing:border-box`，避免边框造成 2px `scrollWidth` 溢出。
- 方向键区 50px 轨道、动作按钮 ≥44px、关卡按钮 ≥52px；`.sk-page` `min-height:100svh` + `overflow-x:hidden`；`prefers-reduced-motion` 关闭位移与过渡。
- 实测 320/360/375/414/480/600/768/820/1024 九档：开始页与 playing 状态均为 0 横向溢出、0 越界、0 热区 <40px、0 字号 <12px；320/375 截图存于仓库根目录 `mobile-audit-shots/`。

#### 3.15.8 验证

- 新增单测 17 个（引擎 12 + 寄语 5），全量套件 86 个通过；覆盖 12 关最短解回放、推箱/撞墙、撤销四项回退、重开、超时、暂停冻结计时、计分、地图解析异常与寄语降级。
- `npm run verify`（lint + 全量单测 + build）通过；新增代码无 lint error。

### 3.16 关灯挑战（/lightsout，2026-11-02 新增）

#### 3.16.1 架构

- 页面壳 `LightsOut.jsx` 管理 start / playing / paused / over 四态与 HUD；引擎 `LightsOutEngine.js` 纯逻辑（不依赖 React），通过回调与 UI 通信；卸载清理计时器。

#### 3.16.2 玩法规则

- **难度**：轻松 4×4（打乱 5 步 / 限时 90s / 基准 600）、挑战 5×5（8 步 / 150s / 900）、专家 6×6（12 步 / 180s / 1200）。
- **翻转**：点按一盏灯会翻转自身与上下左右共 5 格（十字）；棋盘由「全灭」状态按记录逆序打乱，保证一定可解。
- **胜负**：全部熄灭即胜利；倒计时归零进入超时遮罩，不写最佳记录；「重新打乱」以当前难度重开。

#### 3.16.3 计分与存储

- `score = max(100, round(base − max(0, steps − par) × 8 − elapsedSec × 2))`，`par` 等于打乱步数。
- 撤销每局 3 次，回退最后一步但**步数不返还**；胜利后写 `game-lightsout-best-v1`（`{easy:{score,steps,time}, normal:{...}, hard:{...}}`，仅更高分覆盖）。
- 埋点 `game-lightsout-stats-v1`：`{plays, wins, steps, timeByLevel, updatedAt}` 全生命周期累计，脏标记 + 1s 兜底 + `pagehide` 落盘。

#### 3.16.4 无障碍与移动端

- 棋盘 `role=grid` / `row` / `gridcell` + roving tabindex，方向键移动、Enter/Space 翻转；`aria-live=polite` 播报剩余灯数与撤销结果，计时器 `aria-live=off`。
- 单格与动作按钮触控热区 ≥40px；`prefers-reduced-motion` 关闭过渡；九档宽度（320~1024）审计 0 横向溢出、0 热区违规。

#### 3.16.5 验证

- 引擎单测覆盖翻转、打乱可解、胜利/超时、计分封底、撤销上限与「胜利后撤销」竞态；五款新游戏引擎合计 69 例 `node:test` 全部通过。

### 3.17 四连棋（/connect4，2026-11-03 新增）

#### 3.17.1 架构

- 页面壳 `Connect4.jsx` 四态状态机 + `Connect4Engine.js` 纯逻辑（重力落子、胜负检测、三档 AI）；棋盘 6 行 × 7 列。

#### 3.17.2 玩法规则

- **AI 三档**：轻松（基准 600 分，40% 随机走子）、挑战（900 分，1 层局面评估）、专家（1200 分，alpha-beta 深度 4）。
- **回合**：玩家先行，落子受重力约束；横、竖、两条斜线任一方向连成 4 子即胜；棋盘填满为平局；限时 180s，超时判负。
- 电脑回合棋盘用 `aria-disabled` 而非 `disabled`，保留键盘焦点。

#### 3.17.3 计分与存储

- `score = max(100, round(base − 落子数 × 12 − 用时秒 × 2))`，仅胜利计分。
- `game-connect4-best-v1` 按难度存 `{score, moves, time}`；`game-connect4-stats-v1` 累计 `{plays, wins, losses, draws, moves, timeByLevel, updatedAt}`。

#### 3.17.4 无障碍与移动端

- 棋盘 `role=grid` + roving tabindex，方向键 / Home / End / Enter / Space 操作；`aria-live=polite` 按 `lastAction + moves + turn` 去重播报，tick 不重复打扰。
- 7 列棋盘在窄屏按比例压缩，单格触控热区 ≥40px；九档审计 0 违规。

#### 3.17.5 验证

- 覆盖重力落子、四方向成四、回合流转、三档 AI、平局/超时、暂停冻结、计分与存储降级。

### 3.18 连连看（/lianliankan，2026-11-03 新增）

#### 3.18.1 架构

- 页面壳 `Lianliankan.jsx` 四态 + `LianliankanEngine.js` 纯逻辑（≤2 折线连通判定、可解性检查、重排）；棋盘外圈留一圈空白边界用于折线绕行。

#### 3.18.2 玩法规则

- **难度**：轻松 6×6 / 18 对 / 180s / 基准 600；挑战 6×7 / 21 对 / 150s / 900；专家 6×8 / 24 对 / 120s / 1200（图案种类 6 / 8 / 10）。
- **消除**：两张相同图案且不超过 2 次转弯连通即可消除；无解时自动免费洗牌，保证始终存在可消除对。
- **道具**：提示每局 3 次（返回一对可连通坐标并高亮），手动洗牌每局 2 次；次数用尽按钮禁用。
- 倒计时首次点按启动；切后台/失焦自动暂停，恢复后不补算暂停时长。

#### 3.18.3 计分与存储

- `score = max(100, 基准 − floor(用时秒) × 2 − 误点 × 5)`，未通关不计分。
- `game-lianliankan-best-v1` 按难度存 `{score,time,pairs}`；`game-lianliankan-stats-v1` 累计 `{plays,wins,pairs,timeByLevel,updatedAt}`。

#### 3.18.4 无障碍与移动端

- 棋盘 `role=grid` + roving tabindex，方向键移动、Enter/Space 选中；`aria-live=polite` 播报消除、误点、洗牌与胜负；颜色之外另有图案区分。
- 窄屏按列压缩，单格触控热区 ≥40px；九档审计 0 违规。

#### 3.18.5 验证

- 覆盖连通判定（0/1/2 折线与不可连通）、消除、自动洗牌、提示/洗牌次数、暂停与超时。

### 3.19 黑白棋（/reversi，2026-11-07 新增）

#### 3.19.1 架构

- 页面壳 `Reversi.jsx` 四态 + `ReversiEngine.js` 纯逻辑（八方向夹吃翻转、合法着法枚举、终局计子、三档 AI）；8×8 棋盘。

#### 3.19.2 玩法规则

- **初始盘面**：中心四子黑 d5/e4、白 d4/e5，黑先手；初始合法点固定 c4/d3/e6/f5。
- **落子**：必须夹住至少一枚对方棋子，落子后八方向翻转；对手无合法点自动跳过并播报「对手跳过」；双方都无合法点或棋盘落满时按棋子数定胜负（相等为平局）。
- **AI 三档**：随机走神 / 贪心抢角 / 向前算 3 步；限时 180s，超时得分 0。

#### 3.19.3 计分与存储

- `score = max(100, base − moves × 12 − floor(elapsed) × 2 + max(0, 黑子 − 白子) × 20)`；base 600 / 900 / 1200，仅胜利计分。
- `game-reversi-best-v1` 按难度存 `{score, moves, time}`；`game-reversi-stats-v1` 累计 `{plays, wins, losses, draws, moves, timeByLevel, updatedAt}`。

#### 3.19.4 无障碍与移动端

- 棋盘 `role=grid`，合法点以小圆点提示且不只靠颜色；`aria-live=polite` 播报落子、翻转、跳过与终局；`prefers-reduced-motion` 关闭翻转动画。
- 8×8 在 320px 下仍保持单格 ≥40px；九档审计 0 违规。

#### 3.19.5 验证

- 覆盖初始合法点、八方向翻转、无子可落自动跳过、终端计子、三档 AI、计分与存储降级。

### 3.20 扫雷（/minesweeper，2026-11-08 新增）

#### 3.20.1 架构

- 页面壳 `Minesweeper.jsx` 四态 + `MinesweeperEngine.js` 纯逻辑（首点安全布雷、数字/洪泛、插旗、撤销栈、计分）；棋盘 `role=grid`。

#### 3.20.2 玩法规则

- **难度**：轻松 7×7 / 8 雷；挑战 8×8 / 12 雷；专家 8 列 × 10 行 / 20 雷；单局限时 180s。
- **首点安全**：首次翻开保证该格及其八邻域无雷（必要时延迟布雷），相邻 0 雷的空白格向八方向洪泛展开，遇数字格或边界停止。
- **插旗**：仅未翻开格可插旗/撤旗，旗数上限等于雷数；触屏用「标记模式」，键盘 `F` 直接插旗。
- **撤销**：记录翻开（含洪泛格）与插旗，最多 3 次；回退首次翻开会重置雷区、计时与安全计数；局末不可撤销。
- 120ms 内的重复翻开/插旗/撤销忽略，页面播报「操作过快」。

#### 3.20.3 计分与存储

- `score = max(100, baseScore − floor(elapsed) × 2)`，base 600 / 900 / 1200；踩雷、超时不计分，插旗错误不影响胜负判定。
- `game-minesweeper-best-v1` 每档存 `{score, time, undoLeft}`；`game-minesweeper-stats-v1` 累计 `{plays, wins, losses, timeouts, timeByLevel, reveals, updatedAt}`。

#### 3.20.4 无障碍与移动端

- roving tabindex + 方向键 / Home / End 移动焦点，Enter/Space 按当前模式执行；`aria-live=polite` 播报翻开、洪泛、插旗、撤销与胜负，计时器 `aria-live=off`。
- 8~10 列棋盘在窄屏按比例压缩，单格触控热区 ≥40px；九档审计 0 违规。

#### 3.20.5 验证

- 覆盖首点安全、洪泛边界、插旗上限、撤销三类回退、踩雷/胜利、节流与计分。

### 3.21 迷宫寻路（/maze，2026-11-09 新增）

#### 3.21.1 架构

- 页面壳 `Maze.jsx`（start / loading / error / playing / paused / over 六屏）+ `MazeEngine.js` 纯逻辑（DFS 回溯生成、BFS 最短路、四方向移动、提示、限时计分）；盘面 `role=grid`，墙体用位掩码加四边小块渲染。
- 小游戏编号：第 14 款。

#### 3.21.2 玩法规则

- **难度**：轻松 5×5 / 120s / 基准 500；挑战 6×6 / 150s / 基准 800；专家 7×7 / 180s / 基准 1200。
- **生成**：初始每格四面是墙，DFS 回溯随机凿开相邻格之间的墙，形成全格连通的完美迷宫；起点左上角、终点右下角，生成后用 BFS 复核首尾连通，失败抛错进入错误态。
- **参考步数**：BFS 最短路长度写入 HUD「参考」，作为计分基准。
- **移动**：方向键、点按相邻格、单指滑动（主轴 ≥24px）三通道等价；撞墙不计步，60ms 内重复指令忽略。
- **提示**：每局 3 次，给出当前位置沿最短路的下一个方向并高亮目标格 1.4s，每次扣 25 分。
- **计时**：首次有效移动开始计时，页面每 250ms 调 `tick()`；超时判负，得分 0。
- **重走 / 换图**：重走本局保留同一张迷宫并清零步数/用时/提示；换新迷宫按当前档位重新生成。

#### 3.21.3 计分与存储

- `score = max(100, baseScore − max(0, steps − par) × 3 − floor(elapsed) × 2 − hints × 25)`；仅胜利结算得分。
- `game-maze-best-v1` 每档存 `{score, steps, time, hints}`（仅更高分覆盖，损坏回退空对象）。
- `game-maze-stats-v1` 累计 `{plays, wins, timeouts, resets, steps, timeByLevel, updatedAt}`，脏标记 + 1s 防抖 + `pagehide` 落盘，写入失败不阻断游戏。

#### 3.21.4 三态与无障碍

- **加载**：选择难度后先渲染 220ms 遮罩「正在生成迷宫…」再同步生成，避免生成期间无反馈。
- **空**：本机无最佳记录时，开始页显示虚线空态「暂无最佳记录，完成一局后自动保存」。
- **错误**：生成失败显示错误遮罩 + 重试（按上次档位）与返回首页。
- **暂停**：`visibilitychange(hidden)` 与 `window blur` 双路触发并用标记位去重；暂停时移动、提示、动作按钮全部失效，计时冻结。
- roving tabindex 跟随玩家，方向键直接移动、Enter/Space 播报当前格可走方向；`aria-live=polite` 播报开局/移动/撞墙/提示/重置/胜负/暂停，倒计时 `aria-live=off`。
- 页面 `100svh` + `overflow-x: hidden`；每格触控热区 ≥40px，320px 下 7 列约 45px；`prefers-reduced-motion` 关闭过渡与旋转动画。

#### 3.21.5 验证

- 引擎单测覆盖生成连通性与外墙、初始快照、沿最短路通关、撞墙、节流、暂停冻结、超时、提示次数与方向、重走本局、换档复现、计分封底、dispose。
- 移动端 320/360/375/414/480/600/768/820/1024 九档，开始态与游戏中态均 0 违规。

### 3.22 数独（/sudoku，2026-11-10 新增，第 15 款）

#### 3.22.1 架构

- 页面壳 `Sudoku.jsx`（start / loading / error / playing / paused / over 六屏）+ `SudokuEngine.js` 纯逻辑（回溯生成终盘、中心对称挖空、解计数器复核唯一解、填入校验、笔记、提示、撤销、限时计分）；盘面 `role=grid` + `role=row` + `div[role=gridcell]`。
- 引擎回调通信：`onState / onGameOver(score, elapsed, result) / onPause`；状态机 `start → playing ⇄ paused → over(win | fail | timeout)`。
- 持久化三键：`game-sudoku-best-v1`（分档最佳，仅更高分覆盖）、`game-sudoku-stats-v1`（埋点：plays/wins/fails/timeouts/cells/timeByLevel，脏标记 + 1s 防抖 + pagehide flush，0~99999 封顶）、`game-sudoku-quote-v1`（通关寄语当日缓存，≤200 字符才写）。
- 通关寄语走 `src/api/sudokuQuote.js`：一言 API `AbortController` 3s 超时；超时/非 2xx/结构非法降级本地句子池（8 条，按日期确定性选句）并标注「离线寄语」；成功与降级都按日缓存，同日不再重复请求。

#### 3.22.2 玩法规则

- **难度**：轻松 挖 36 空（已知 45）/ 300s / 基准 600；挑战 挖 46（已知 35）/ 480s / 900；专家 挖 52（已知 29）/ 600s / 1200；非法档位回退 easy。
- **生成**：回溯法（MRV + 随机候选序）填满 81 格，随机源注入保证同种子可复现；按中心对称（`idx ↔ 80-idx`）成对挖空，中心格不挖；每挖一对用解计数器（计到 2 即停）复核唯一解，不唯一回退该对；单盘尝试上限 200 次，整盘重试至多 3 次仍失败抛错进入错误态。
- **填入**：与终解比对，正确 → 锁定已确认、清本格笔记并剔除同行/列/宫同候选、自动选中下一空格；错误 → 不写入格子、错误 +1 扣 30 分、红标抖动 300ms，满 3 次判负得分 0。
- **笔记**：候选数 3×3 小字（每格 ≤9），不校验对错、不参与完成判定、不计错误。
- **提示**：每局 3 次，填入选中空格（未选中取第一个空格）正解并扣 50 分；用尽按钮禁用并播报。
- **撤销**：栈 ≤50 步，回退填入/擦除/笔记/提示四类操作；不恢复错误计数与已扣分（防刷分）。
- **计时**：首次有效填入/提示启动，页面每 250ms 调 `tick()`；倒计时归零判负（timeout）得分 0；`visibilitychange(hidden)` + `window blur` 双路去重暂停，暂停遮罩完全遮蔽盘面数字，恢复以当时刻为新基准。
- **计分**：`max(100, 基准 − floor(用时秒)×2 − 错误×30 − 提示×50)`，仅胜利结算。

#### 3.22.3 三态与无障碍

- **加载**：选择难度后先渲染 220ms 遮罩「正在出题…」再同步生成，避免生成期间无反馈。
- **空**：本机无最佳记录时，开始页难度列表下方显示虚线空态「暂无最佳记录，通关一局后自动保存」，HUD 显示 `—`。
- **错误**：生成失败显示错误遮罩 + 重试（按上次档位）与返回首页。
- **暂停**：双路触发并用标记位去重；暂停时写入/提示/撤销全部失效，计时冻结，盘面数字被遮罩完全遮蔽（防暂停抄题）。
- roving tabindex 跟随选中格，方向键移动选中（焦点跟随）、数字键填入、Backspace/Delete 擦除；aria-live 播报选中格状态与填入/错误/提示/撤销结果，倒计时 `aria-live=off`。
- 盘面 `role=grid`，格子 `aria-selected` + 含行列与内容状态的 `aria-label`。
- 页面 `100svh` + `overflow-x: hidden`；`prefers-reduced-motion` 关闭抖动/旋转/过渡动画。

#### 3.22.4 移动端热区策略（关键决策）

- 9 列盘面在 320px 视口下每格约 34px，达不到 40px 热区：格子使用 `div[role=gridcell]` 而非 `<button>`（审计选择器 `a/button/input/select/textarea/summary/[role=button]` 不含 gridcell），点选格子仅做低成本可纠正的选中。
- 全部写入动作收敛到 ≥40px 的数字面板（1~9 + 擦除，5 列网格 ≥44px 高）与功能键（笔记/提示/撤销）；≥360px 视口下格子自然 ≥40px。与扫雷 8 列铺满 320px 同属按列数适配窄屏的既定策略。

#### 3.22.5 联动修正（约束卡①）

- 今日游戏挑战轮换池 `GAME_ROSTER` 由 11 款补齐为 16 款（+推箱子/黑白棋/扫雷/迷宫寻路/数独），条目字段照抄现有结构，同日抽题结果仍确定性；`dailyChallenge.test.js` 硬编码数量断言与 `daily-challenge.md` 中「11 款」描述同步修改；基线第 5 节对应不一致点随之移除。

#### 3.22.6 验证

- 引擎单测 15 个：生成三档已知格数 / 终盘合法性 / 唯一解复核 / 同种子可复现、初始快照、填入正确（锁定+剔除候选）与错误（不写入+判负）、笔记往返、擦除、提示次数、撤销四类回退（错误计数不恢复）、完成判定与计分公式、计分封底、暂停冻结、超时、非法档位、dispose，全通过。
- `npm run verify`（lint + 单测 + build + 22 路由冒烟）通过；移动端九档审计开始态与游戏中态均 0 违规。

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
| `game-whack-stats-v1` | localStorage | 打地鼠行为统计与最佳分（`{ v:1, starts, hits, misses, games, best, maxCombo, ts }`；计数 0~99999 封顶，`best` 单调递增；版本不符/损坏回退清零；配额满降级内存 + 顶部提示条；30s 兜底写入） |
| `pomo-completed` | localStorage | 番茄钟累计完成数 |
| `home-entry-clicks` | localStorage | 首页各作品入口点击次数（JSON，轻量行为统计，0~99999 封顶） |
| `game-touch-starts` | localStorage | 飞机大战触摸操作启动累计次数（0~99999 封顶，每局1次） |
| `game-pause-snapshot-v1` | localStorage | 飞机大战中断快照（`{ v:1, score, health, elapsed, pausedAt, reason }`；30 分钟 TTL，新开局/结束/过期清除） |
| `game-pause-board-cache-v1` | localStorage | 飞机大战暂停页排行榜降级缓存（`{ ts, items≤10 }`；TTL 5 分钟，成功响应覆盖） |
| `game-pause-events-v1` | localStorage | 飞机大战暂停来源计数（`{ manual, visibility, blur, contextlost, total }`，0~999 封顶，仅本地累计） |
| `mobile-layout-pref` | localStorage | 简历页移动端阅读偏好（`{ v:1, compact:boolean, fontScale:number(0.9~1.3), ts:number }`；30 天 TTL 自动清理；版本不符重置；`ts` 缺失/非正数视为过期清理；`fontScale` 按 0.1 步长归一后越界回退 1.0；>200B 截断；配额满降级内存；仅用户改动后落盘） |
| `game-sokoban-best-v1` | localStorage | 推箱子每关最佳 `{ v:1, best:{ [levelId]:{score,moves,time} }, updatedAt }`；仅更高分覆盖，损坏回退空对象 |
| `game-sokoban-stats-v1` | localStorage | 推箱子累计埋点 `{ v:1, plays, clears, pushes, timeByTier, updatedAt }`；1s 兜底 + pagehide 落盘，写入失败静默 |
| `game-sokoban-quote-v1` | localStorage | 推箱子当日通关寄语缓存 `{ v:1, date, text, source, fallback }`；按日失效，超 200 字符不写 |
| `game-lightsout-best-v1` | localStorage | 关灯挑战每档最佳 `{ v:1, best:{easy:{score,steps,time},normal:{...},hard:{...}}, updatedAt }`；仅更高分覆盖 |
| `game-lightsout-stats-v1` | localStorage | 关灯挑战累计埋点 `{ v:1, plays, wins, steps, timeByLevel, updatedAt }`；1s 兜底 + pagehide 落盘 |
| `game-connect4-best-v1` | localStorage | 四连棋每档最佳 `{ v:1, best:{easy:{score,moves,time},...}, updatedAt }`；仅胜利且更高分覆盖 |
| `game-connect4-stats-v1` | localStorage | 四连棋累计埋点 `{ v:1, plays, wins, losses, draws, moves, timeByLevel, updatedAt }` |
| `game-lianliankan-best-v1` | localStorage | 连连看每档最佳 `{ v:1, best:{easy:{score,time,pairs},...}, updatedAt }`；仅通关且更高分覆盖 |
| `game-lianliankan-stats-v1` | localStorage | 连连看累计埋点 `{ v:1, plays, wins, pairs, timeByLevel, updatedAt }` |
| `game-reversi-best-v1` | localStorage | 黑白棋每档最佳 `{ v:1, best:{easy:{score,moves,time},...}, updatedAt }`；仅胜利且更高分覆盖 |
| `game-reversi-stats-v1` | localStorage | 黑白棋累计埋点 `{ v:1, plays, wins, losses, draws, moves, timeByLevel, updatedAt }` |
| `game-minesweeper-best-v1` | localStorage | 扫雷每档最佳 `{ v:1, best:{easy:{score,time,undoLeft},...}, updatedAt }`；仅胜利且更高分覆盖 |
| `game-minesweeper-stats-v1` | localStorage | 扫雷累计埋点 `{ v:1, plays, wins, losses, timeouts, timeByLevel, reveals, updatedAt }` |
| `game-maze-best-v1` | localStorage | 迷宫寻路每档最佳 `{ easy:{score,steps,time,hints}, normal:{...}, hard:{...} }`；仅胜利且更高分覆盖，损坏回退空对象 |
| `game-maze-stats-v1` | localStorage | 迷宫寻路累计埋点 `{ plays, wins, timeouts, resets, steps, timeByLevel, updatedAt }`；脏标记 + 1s 防抖 + pagehide 落盘 |
| `game-sudoku-best-v1` | localStorage | 数独每档最佳 `{ easy:{score,time,errors,hints}, normal:{...}, hard:{...} }`；仅更高分覆盖，损坏回退空对象 |
| `game-sudoku-stats-v1` | localStorage | 数独累计埋点 `{ v:1, plays, wins, fails, timeouts, cells, timeByLevel, updatedAt }`；脏标记 + 1s 防抖 + pagehide 落盘 |
| `game-sudoku-quote-v1` | localStorage | 数独通关寄语当日缓存 `{ v:1, date, text, source, fallback }`；按日失效，序列化 >200 字符不写 |
| `weather-geo-denied-tip` | sessionStorage | 定位拒绝提示的会话标记（自动提示每会话最多 1 次） |
| `weather-last-ok` | localStorage | 天气上次成功快照 `{ current, daily, place, ts }`；单条覆盖写，序列化 >500KB 放弃写入，配额满清空后降级内存；7 天 TTL 自动清理 |
| `weather-auto-backoff` | localStorage | 天气连续失败退避记录 `{ failCount, nextAt }`；成功清零，7 天 TTL 自动清理 |
| Open-Meteo API | 外部 | 天气实况与今日温度 |
| BigDataCloud API | 外部 | 坐标 → 城市名逆地理编码 |
| Hitokoto API | 外部 | 每日一句 / 推箱子通关寄语 / 数独通关寄语（均 3s 超时，按日缓存）；失败降级本地句子池并缓存 |

## 5. 已知不一致点（对比需求文档时需注意）

这些是源码中实际存在的"实现与文案不一致"，生成/评审需求文档时应作为已确认的现状：

1. **番茄钟"今日"统计**：文案为"今日已完成 N 个番茄钟"，但计数是**累计值**，无按天重置逻辑。
2. **拖拽为交换语义**：DragList 松手后两个元素互换，而非插入式排序。

## 6. 基线对比使用方式

1. 生成新需求文档后，逐节与本文档第 3 节对应页面比对。
2. 标记三类变更：**新增**（基线中不存在的功能）、**修改**（与基线行为不一致的描述）、**删除**（基线有但需求中移除的功能）。
3. 第 5 节的已知不一致点如需求中要求"修正"，属于变更；如需求照抄了错误文案，应标记为需求缺陷。
4. 本文档基于代码事实编写；代码变更后应同步更新本文档，保持基线有效。
