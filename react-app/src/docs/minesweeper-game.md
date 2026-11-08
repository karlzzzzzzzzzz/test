# 扫雷（Minesweeper）新增小游戏 需求文档

> 随机生成于 2026-11-08，规模：大型，类型：新增功能
>
> 抽取来源：`node .trae/skills/random-prd/scripts/pick.js --target new-game`
> 抽取结果：页面「扫雷」，主题「翻开/标记、雷数提示、首点安全」，联动「首页 + 技术文档中心」，规模「大型」，约束卡 3 张（localStorage 持久化、切后台/失焦行为、撤销/回退上一次操作）；`corrected: false`，`conflicts: []`（无冲突纠正记录）。

## 1. 背景与目标

首页已有 17 张作品入口卡（其中 13 款小游戏），现有玩法覆盖射击、消除、棋类、推箱与滑块，但缺少「概率推理 + 标记」的经典单人解谜。本次新增第 18 张入口卡「扫雷」：三档雷区（7×7 / 8×8 / 8×10），首次翻开保证首点及其八邻域无雷，数字提示相邻雷数，空白格自动洪泛展开，触屏用「标记模式」插旗，支持最多 3 次撤销，单局限时 180 秒。

目标：新增 `/minesweeper` 路由与首页第 18 张卡；单局 1~3 分钟；320~1024 九档宽度下热区 ≥40px、无横向溢出；引擎纯逻辑可单测，页面与引擎解耦。

## 2. 与基线的关系

| 基线现状 | 本次变更 |
|----------|----------|
| 1.4 路由与加载策略：游戏页均为 `lazy` 独立分包 | **新增** `/minesweeper` 懒加载路由与 `<Suspense fallback="加载中…">` |
| 3.1 首页 · 作品入口（ENTRIES）：`CardLayout` 渲染，路由唯一，`span='3'` | **新增** 第 18 张「扫雷」卡片（`to:'/minesweeper'`、`footer` 带「开始挑战」） |
| 3.1 首页 · 统计条：模块数由 `ENTRIES.length` 驱动 | **保持** 动态驱动，新增卡后自动显示 18，不手写数字 |
| 3.9 技术文档中心：`src/docs/*.md` + `?raw` 导入 + `registry.js` 登记 | **新增** `minesweeper-game.md` 与 registry 条目 |
| 3.11~3.14 纯 DOM 游戏页约定：四态、双路暂停、`role=grid` + roving tabindex + `aria-live`、100svh、`overflow-x:hidden`、reduced-motion | **沿用** 同一套页面壳约定；不修改既有游戏页面 |
| 第 4 节数据与存储一览 | **新增** 2 个 `game-minesweeper-*` 键，登记入表 |

## 3. 页面结构

```
/minesweeper（Minesweeper.jsx）
├── 顶部：← 首页 / 标题「扫雷」/ 暂停·继续
├── HUD：已翻开（安全格/总数） · 剩余雷 · 撤销次数 · 倒计时
├── 模式条：翻开模式 / 标记模式（aria-pressed）+ 当前模式说明
├── 雷区：role=grid（每行 role=row，格 role=gridcell + 原生 button）
│   ├── 未翻开格（凸起）
│   ├── 已翻开格：数字 1~8（按数字配色）/ 空白格
│   ├── 插旗格（旗形图标）
│   ├── 局末公开雷位 + 踩中格高亮
│   └── 本步翻开格轻微弹入
├── 动作区：撤销一步（剩余次数）/ 重新开局 / 返回首页
├── 提示条：首点八邻域无雷、数字含义、标记模式用法
└── 遮罩：start（三档难度 + 各档最佳）/ paused / over（win·lose·timeout）
```

新增区块：全部为本次新增；不改变首页其他区块与既有 17 张卡片。

## 4. 功能点明细

| 模块 | 交互 | 规则/逻辑 | 异常处理 |
|------|------|-----------|----------|
| 路由（`App.jsx`） | 访问 `#/minesweeper` | `lazy(() => import('./pages/Minesweeper'))` 独立分包，Suspense 回退「加载中…」 | 分包加载失败沿用既有 loading 文案，不阻塞其他路由 |
| 首页入口（`Home.jsx` ENTRIES） | 点击「开始挑战 →」 | 新增第 18 项：`to:'/minesweeper'`、`span:'3'`、`techTags:['DOM','React Hooks','Puzzle']`，描述写明「7×7 / 8×8 / 8×10 三档雷区、首点安全、撤销 3 次」 | 字段缺失沿用 `CardLayout` 既有降级；不改既有 17 项 |
| 首页统计（`Home.jsx`） | 进入视口 | 模块数继续由 `ENTRIES.length` 驱动（变为 18），无手写数字 | `AnimatedNumber` 在 reduced-motion 下直接显示终值 |
| 技术文档中心（`registry.js`） | 打开 `/docs/minesweeper-game` | 新增 `minesweeper-game.md` 的 `?raw` 导入与 docs 条目（slug/title/summary/date/tags/readTime/content） | slug 不存在时 `DocView` 既有「文档未找到」空态 |
| 引擎 · 三档几何（`MinesweeperEngine.js`） | `start(level)` | 轻松 7×7/8 雷、挑战 8×8/12 雷、专家 8 列×10 行/20 雷；安全格数 = 行×列 − 雷数 | 难度 key 非法回退 `easy`；`start` 可反复调用并完全重置 |
| 引擎 · 首点安全 | 首次 `reveal(idx)` | 首次翻开时才布雷，随机池排除首点及其八邻域；候选不足时退回仅排除首点 | 首点必为安全格，不会首翻即负 |
| 引擎 · 数字与洪泛 | `reveal(idx)` | 翻开后显示相邻雷数；相邻 0 雷的空白格向八方向洪泛，直到遇到数字格或边界；已插旗格不自动翻开 | 已翻开 / 已插旗 / 越界 / 非整数 → 返回 `false`，状态不变 |
| 引擎 · 插旗 | `toggleFlag(idx)` | 仅未翻开格可插旗；再次点按撤旗；旗子总数上限等于雷数 | 旗子用完再插返回 `false`；已翻开格返回 `false` |
| 引擎 · 撤销 | `undo()` | 撤销栈记录「翻开（含洪泛格）」与「插旗/撤旗」；翻开回退把本步格子盖回，旗子回退恢复原状态；回退首次翻开会重置雷区、计时与安全计数，允许换首点重开 | 最多 3 次；局末、次数用尽、栈空时返回 `false` |
| 引擎 · 踩雷 | 翻开到雷 | `over/lose`，公开全部雷位并标出踩中格，得分 0 | 局末不可撤销；倒计时冻结 |
| 引擎 · 胜利 | 所有安全格翻开 | `over/win`，公开剩余雷位，按公式计分 | 插旗错误不影响胜负判定（只看安全格是否翻完） |
| 引擎 · 计时 | 页面每 250ms `tick()` | 首次翻开启动计时；`elapsedBase + resumeAt` 双字段冻结暂停时长；达到 180 秒 → `over/timeout` | 未翻开不启动、不超时；暂停期间计时不增长 |
| 引擎 · 计分 | 胜利时 | `max(100, baseScore − floor(elapsed)×2)`；base 轻松 600 / 挑战 900 / 专家 1200 | 分数下限 100；失败/超时不计分 |
| 引擎 · 节流 | 连续点按 | 120ms 内的重复翻开/插旗/撤销一律忽略，避免双击造成误操作 | 节流命中返回 `false`，由页面播报「操作过快」 |
| 页面 · 四态 | start / playing / paused / over | 四态遮罩 + HUD；start 展示三档难度与各档最佳；over 展示结果、用时、已翻开、标记、撤销剩余、得分、最佳 | 引擎快照缺失时 HUD 显示「—」，不进入 playing |
| 页面 · 触控与模式 | 点按格子 / 切换模式按钮 | 翻开模式点按翻开；标记模式点按插旗/撤旗；按钮 `aria-pressed` 反映当前模式；开局默认翻开模式 | `touch-action:manipulation` 关闭双击缩放；长按不出菜单 |
| 页面 · 键盘与读屏 | Tab / 方向键 / Enter·Space / F | 棋盘 `role=grid`、行 `role=row`、格 `role=gridcell`；roving tabindex 仅焦点格 `tabIndex=0`；方向键/Home/End 移动焦点并 `preventDefault`；Enter/Space 按当前模式执行，`F` 直接插旗/撤旗；`aria-live=polite` 播报翻开、洪泛、插旗、撤销、胜负；计时器 `aria-live=off` | 焦点格越界时夹在 0~行×列−1；同一动作只播报一次（tick 复用 lastAction 去重） |
| 页面 · 双路暂停 | 手动暂停 / 切后台 / 失焦 | `visibilitychange` + `window.blur` 双路 + `pausedByVisibilityRef` 去重；仅 playing 生效；暂停冻结计时并禁用盘面（`pointer-events:none` + `aria-hidden`） | 恢复需手动点击；`document.hidden` 时拒绝恢复 |
| 存储 · 最佳（`game-minesweeper-best-v1`） | 胜利结算 | `{ [level]: {score, time, undoLeft} }`；仅更高分覆盖 | JSON 损坏/不可用回退空对象；写入失败 → 结算页提示「本局成绩未保存」 |
| 存储 · 埋点（`game-minesweeper-stats-v1`） | 开局/结算 | `{ plays, wins, losses, timeouts, timeByLevel, reveals, updatedAt }` 全生命周期累计；脏标记 + 1s 兜底 + `pagehide` 落盘 | 写入失败静默跳过，不阻断游戏 |

## 5. 状态说明

- **加载**：`/minesweeper` 分包加载期间显示「加载中…」。
- **空**：start 态各档无记录时显示「暂无记录」；HUD 在 start 态显示「—」。
- **错误**：
  1. localStorage 不可用/配额满 → 游戏继续，结算页提示「本局成绩未保存」。
  2. 快照缺失（引擎未就绪）→ HUD 占位，不渲染盘面。
- **边界情况（≥4）**：
  1. 首点落在角落 → 八邻域仅 3 格，随机池仍排除这些格子，首翻必安全。
  2. 首次翻开后立即撤销 → 雷区、计时、安全计数全部清零，换首点重新布雷，撤销次数 −1。
  3. 洪泛遇到已插旗格 → 跳过该格，不自动翻开，旗子保留。
  4. 旗子数达到雷数后再插旗 → 返回 `false`，页面播报「旗子已用完」。
  5. 120ms 内连点两个格子 → 第二次被节流忽略，只执行第一次。
  6. 暂停期间点按盘面 / 计时到点 → 均不执行，恢复后继续；暂停不补扣时间。
  7. 胜利时仍有旗子插在雷上 → 直接按安全格翻完结算，旗子不回退。

## 6. 非功能需求

- **（约束卡① localStorage）** 仅写 2 个键：`game-minesweeper-best-v1`（每档最佳，胜利时同步写入且仅更高分覆盖）与 `game-minesweeper-stats-v1`（累计埋点，脏标记 + 1s 兜底 + `pagehide` 落盘）；读取均做结构校验与 try/catch 降级，不因存储异常阻断游戏。
- **（约束卡② 切后台/失焦）** 页面监听 `visibilitychange` 与 `window.blur` 双路，用 `pausedByVisibilityRef` 去重，保证一次切后台只触发一次暂停；暂停必须冻结计时（`elapsedBase + resumeAt`），恢复后不补扣时间。
- **（约束卡③ 撤销/回退）** 引擎内置撤销栈，记录翻开（含洪泛展开的全部格子）与插旗动作；最多 3 次；回退首次翻开时重置雷区与计时，保证「换首点重开」不带上旧雷。
- **移动端**：320px 下盘面横向铺满（8 列 × 40px，零间距零内边距），单格热区恰好 40×40；7 列档单格更宽；≥480px 恢复 6px 间距与 10px 内边距；页面 `min-height:100svh`、`overflow-x:hidden`、`touch-action:manipulation`；`prefers-reduced-motion` 关闭过渡与翻开动画。
- **性能**：引擎纯逻辑无 DOM；单次翻开洪泛 O(行×列)，最坏 80 格；页面 DOM 最多 80 格 + 遮罩，无 Canvas/无 rAF 常驻；tick 250ms 仅刷新快照。
- **兼容**：HashRouter 深链 `#/minesweeper` 可直达；键盘与触屏语义一致；不新增第三方依赖。
- **埋点**：`game-minesweeper-stats-v1` 仅本地累计，不上报远端。

## 7. 验收标准

1. **Given** 首页已加载，**When** 滚动到作品入口，**Then** 看到第 18 张「扫雷」卡，点击进入 `#/minesweeper`，统计条模块数显示 18。
2. **Given** 打开 `/docs`，**When** 点击「扫雷」文档卡，**Then** 进入 `/docs/minesweeper-game` 且正文渲染成功。
3. **Given** 开始「轻松」档，**When** 盘面出现，**Then** 为 7 行 7 列、共 8 颗雷、所有格未翻开、撤销显示 3 次、倒计时 03:00。
4. **Given** 首次翻开任意格，**When** 翻开完成，**Then** 首点及其八邻域都无雷，数字/空白格正确显示，洪泛格一并翻开。
5. **Given** 翻开一格后，**When** 切换到「标记模式」并点按未翻开格，**Then** 该格插旗、剩余雷数 −1；再点一次撤旗、剩余雷数恢复。
6. **Given** 标记数与雷数相同，**When** 继续插旗，**Then** 不新增旗子并播报旗子已用完。
7. **Given** 一次翻开操作，**When** 点击「撤销一步」，**Then** 本步展开的格子全部盖回、安全计数回退、撤销次数 −1。
8. **Given** 仅完成首次翻开，**When** 撤销，**Then** 雷区与计时重置、盘面全盖回、可换首点重新布雷。
9. **Given** 已撤销 3 次，**When** 再次点击撤销，**Then** 按钮禁用且不生效。
10. **Given** 翻开地雷，**When** 判定，**Then** 进入 over/lose、公开全部雷位、踩中格高亮、得分 0、不可撤销。
11. **Given** 所有安全格已翻开，**When** 最后一步完成，**Then** 进入 over/win、剩余雷位公开、按 `max(100, base − 用时秒×2)` 计分并写入该档最佳。
12. **Given** 一局进行中，**When** 切到后台或窗口失焦，**Then** 自动暂停并冻结计时，双路事件不重复暂停；恢复后继续。
13. **Given** 倒计时归零，**When** 达到 180 秒，**Then** 进入 over/timeout，得分 0，可再来一局。
14. **Given** 仅键盘操作，**When** 用方向键移动焦点并按 Enter/F，**Then** 焦点跟随、方向键不滚动页面、按模式执行翻开与插旗。
15. **Given** 320/360/375/414/480/600/768/820/1024 九档宽度，**When** 分别审计开始态与游戏中态，**Then** 0 横向溢出、0 越界、0 热区 <40px、0 字号 <12px。
16. **Given** 任意一档胜利后刷新页面，**When** 再进入 start 屏，**Then** 该档最佳分仍在；localStorage 损坏时回退「暂无记录」且不报错。

## 8. 存储变更

| 键名 | 用途 | 生命周期 |
|------|------|----------|
| `game-minesweeper-best-v1` | 每档最佳 `{ [level]: {score, time, undoLeft} }` | 持久（胜利时同步写入，仅更高分覆盖） |
| `game-minesweeper-stats-v1` | 累计 `plays/wins/losses/timeouts/timeByLevel/reveals` | 持久（脏标记 + 1s 兜底 + pagehide） |

共 2 个键，符合大型需求 ≤3 的上限。

## 9. 难度与数值一览

| 档位 | 名称 | 雷区（行×列） | 雷数 | 限时 | 基准分 |
|------|------|----------------|------|------|--------|
| easy | 轻松 | 7×7 | 8 | 180s | 600 |
| normal | 挑战 | 8×8 | 12 | 180s | 900 |
| hard | 专家 | 10 行 × 8 列 | 20 | 180s | 1200 |

计分：`max(100, baseScore − floor(elapsed)×2)`。

频率与上限：操作节流 120ms、撤销 3 次、倒计时 tick 250ms、旗子上限 = 雷数。
