# 钢琴块（Piano Tiles / 别踩白块）需求文档

> 需求类型：新增功能（新增一个小游戏）· 规模：大型 · 目标路由：`/piano-tiles`
> 关联页面：首页作品入口、技术文档中心
> 实现日期：2026-11-23 · 小游戏上线顺序：第 24 款 · 首页作品入口：第 29 张卡

## 1. 需求背景与目标

首页作品入口已有 28 张卡片，棋类、解谜、动作、消除、模拟与递归均有覆盖，但缺少以「节奏反应 + 实时下落」为核心的街机玩法。新增第 24 款小游戏**钢琴块（别踩白块）**，补齐反应类玩法，并复用既有工程约定（引擎与页面壳解耦、状态机、双路自动暂停、键盘可达、番茄钟联动）。

目标：

1. 实现 4 轨道、黑块连续下落的街机模式：在底部判定线附近点中黑块 +1 分。
2. 失败条件清晰：点到白块（wrong-tap）或漏点黑块越过底线（missed）即结束。
3. 速度随得分递增（初速 2.0 行高/秒，每命中 +0.08，上限 8.0），形成难度曲线。
4. 切后台 / 窗口失焦时自动暂停，恢复不跳帧；当前进度本地持久化，容量 ≤4096 字符、24h TTL，结束 / 重开 / 放弃即清理。
5. 埋点累计关键行为：游玩次数、结束局数、累计点中、最高连击、最高分、失误（漏点 / 点白）。
6. 移动端 320px 窄屏不横向溢出，所有热区 ≥44px，字号 ≥0.75rem。

## 2. 与基线的关系

- 【新增】基线 1.4 路由表新增一行：`/piano-tiles` → PianoTiles 钢琴块，lazy 懒加载独立分包。
- 【新增】基线 3.1 首页作品入口新增第 29 张卡片「钢琴块」→ `/piano-tiles`；统计条由 `ENTRIES.length` 驱动自动变为 29。
- 【新增】基线 3.5 技术文档中心新增 `piano-tiles` 文档（本文档），登记 `src/docs/registry.js`。
- 【新增】基线第 3 节新增「钢琴块（/piano-tiles）」小节（3.31）；第 4 节存储一览新增 2 个键。
- 【修改】`pomodoro-sessions-v1` 使用方扩展：结束且有效时长 ≥120s 时追加 `game:'piano-tiles'` 的 session。
- 【无变更】不新增外部 API；不改动每日挑战轮换池（与汉诺塔等后续游戏一致，维持精选 16 款）；不改动既有游戏与首页其他区块。

## 3. 页面结构

1. **顶部栏**：返回首页链接（≥44px 热区）、标题「钢琴块」、模式徽标「街机模式」。
2. **开始屏**：玩法说明 → 最高分 / 累计点中 / 最高连击 / 游玩次数 → 规则 →「继续上次」卡片（有合法存档时）→「开始游戏」→ 操作说明。
3. **对局 HUD**：得分、最高分、连击、速度、用时、暂停按钮（≥44px）。
4. **棋盘**：竖版 4 轨道；黑块自顶部下落，底部红色判定线；判定窗口内的当前黑块高亮；4 条整列可点按的轨道按钮覆盖全场，每条有 `aria-label`。
5. **遮罩**：暂停（区分手动 / 自动，含继续、重开、结束、返回菜单）。
6. **结束屏**：本局得分、最高分、最高连击、用时；破纪录提示「新纪录！」；再来一局 / 返回菜单。
7. **状态提示**：`aria-live` 播报开局、每 10 分里程碑、点白 / 漏点结束原因、自动暂停。

## 4. 功能明细

| 模块 | 触发 | 行为 | 边界/异常 |
| --- | --- | --- | --- |
| `PianoTilesEngine.js` 初始化 | `start()` | 生成从顶部到 `VISIBLE-1.5` 的传送带行（间距恒为 1 行高），清零计数，状态 playing | 行轨道随机 0~3 |
| `PianoTilesEngine.js` 速度 | `_speed()` | `min(MAX, BASE + hits*0.08)`，随命中线性增长并封顶 | 命中数大时取上限 |
| `PianoTilesEngine.js` 推进 | `tick(dtMs)` | 每行 `y += speed*dt`；未命中行越过 `MISS_Y` → 结束（missed）；清理离场行并补顶部新行 | dt 上限 100ms，防切后台恢复跳帧 |
| `PianoTilesEngine.js` 点按 | `tap(lane)` | 取判定窗口 `[JUDGE-TOL, JUDGE+TOL]` 内最低未命中行：轨道对 → 命中 +1、连击 +1；轨道错 → 结束（wrong-tap）；窗口无行 → 忽略 | 非 playing 或非法轨道号拒绝 |
| `PianoTilesEngine.js` 暂停 | `pause()` / `resume()` | playing ⇄ paused，暂停冻结位置与计时 | 非 playing 态 pause 无副作用 |
| `PianoTilesEngine.js` 手动结束 | `stop()` | 进入 over，回调 `result:'stopped'` | 已结束 / 开局前返回 false |
| `PianoTilesEngine.js` 存档恢复 | `restore(save)` | 经 `validateSave` 校验行 id / 轨道 / 坐标 / 计数后恢复为 paused | 行非数组、id/轨道越界、坐标非有限、计数为负均拒绝 |
| `PianoTiles.jsx` 主循环 | rAF | 仅 playing 时 `tick(dt)`；每帧刷新时间基准，恢复不跳帧 | 组件卸载取消 rAF |
| `PianoTiles.jsx` 点按轨道 | 指针 / 触控 / 键盘 1-4 | 调用 `tap(lane)`；命中每 10 分播报 | 非 playing 忽略 |
| `PianoTiles.jsx` 键盘 | 1/2/3/4、Space、P、Esc | 数字键点对应轨道，Space/P 切换暂停，Esc 暂停 | 输入框 / 文本域内不拦截 |
| `PianoTiles.jsx` 自动暂停（约束卡①） | `visibilitychange(hidden)` + `blur` | 双路去重，仅 playing 暂停一次；立即写存档与统计 | 回来保持暂停，不自动继续 |
| `PianoTiles.jsx` 进度存档（约束卡③） | 状态变化 / 暂停 / pagehide | 写 `game-piano-tiles-save-v1`：行、得分、连击、命中、失误、用时、ts | JSON >4096 不写；24h TTL；坏档自动删除；结束 / 重开 / 放弃即清理 |
| `PianoTiles.jsx` 埋点统计（约束卡②） | 开始 / 结束 / pagehide | 更新 `game-piano-tiles-stats-v1`：plays/gamesOver/totalTiles/maxCombo/bestScore/misses/wrongTaps | 脏标记 + 1s 防抖 + pagehide 冲刷；读取逐字段归一为非负整数 |
| `PianoTiles.jsx` 番茄钟 | 结束且 ≥120s | 追加 `pomodoro-sessions-v1`（`game:'piano-tiles'`、win=false、level=得分） | 不足 120s 不写；同一局只结算一次 |
| `PianoTiles.jsx` 移动端适配 | 窄屏 / 触控 | 竖版棋盘按视口缩放；轨道整列可点；320px 不横向滚动 | 按钮 ≥44px；字号 ≥0.75rem |

## 5. 状态说明

- **加载**：路由懒加载显示全局「加载中…」；开始屏同步读取本地存档与统计，无额外骨架屏。
- **空**：无存档时隐藏「继续上次」；无最高分时显示 0；统计初始为 0。
- **错误**：存档 JSON 损坏、TTL 过期、行数据非法时自动删除并安静回到开始屏；`localStorage` 不可用时仅内存统计，不阻塞玩法。
- **进行中**：判定窗口内最低黑块高亮，所在轨道底色微亮；点按命中后该块消失，顶部不断补入新块。
- **暂停**：手动 / 自动暂停均显示遮罩；自动暂停说明切后台或失焦不会继续下落。
- **结束**：点白显示「点到了白块」，漏点显示「漏点了黑块」；破纪录时高亮本局得分。

## 6. 非功能与约束

- **性能**：传送带行数组长度恒 ≤12（命中行维持间距直到离场后清理），每次 tick 仅一次线性扫描；rAF 每帧 setState 的组件树很小（<10 个色块 + 4 个按钮），60fps 无压力。
- **移动端**：棋盘 `width: min(90vw, 360px)`、`height: min(68vh, 540px)`；黑块宽高各 25%；4 条轨道按钮满高覆盖；`touch-action: manipulation`；320px 断点收窄内边距与棋盘尺寸，不横向溢出。
- **兼容**：无后端；`min-height: 100vh`；按钮统一 `:focus-visible` 焦点环；`aria-live` 播报关键状态。
- **约束卡①（切后台 / 失焦行为）**：`visibilitychange(hidden)` 与 `window blur` 双路监听，以 `engine.state === 'playing'` 去重，只暂停一次；暂停时冻结色块位置与计时，刷新 `last` 时间基准使恢复首帧 dt 不跳变；引擎侧 `tick` 再以 100ms 上限兜底；回到页面保持暂停，由玩家手动继续。
- **约束卡②（埋点统计关键行为）**：`game-piano-tiles-stats-v1` 累计 plays（开局）、gamesOver（结束）、totalTiles（累计点中）、maxCombo、bestScore（单调最大）、misses、wrongTaps；采用脏标记 + 1s 防抖定时器 + `pagehide` 同步冲刷，避免高频写入；读取时逐字段 `Math.max(0, Math.floor(...))` 归一，防脏数据。
- **约束卡③（localStorage 持久化，含容量与清理）**：`game-piano-tiles-save-v1` 单条 JSON ≤4096 字符，24h TTL；读取时经 `validateSave` 校验 `v=1`、行结构、轨道范围、坐标有限、计数非负，坏档自动删除；命中数为 0 不写（避免无意义存档）；结束 / 重开 / 放弃 / 返回菜单即清理；`pagehide` / 卸载时冲刷。

## 7. 验收标准

1. **Given** 进入 `/piano-tiles`，**When** 页面加载完成，**Then** 显示开始屏、规则说明与累计统计，无 console 错误。
2. **Given** 点击开始游戏，**When** 进入对局，**Then** 棋盘显示下落黑块，HUD 得分 0、速度 2.0、用时 0:00。
3. **Given** 黑块进入判定窗口，**When** 点按其所在轨道或按对应数字键，**Then** 得分 +1、连击 +1，该黑块消失。
4. **Given** 判定窗口内黑块在第 1 轨道，**When** 点按第 2 轨道，**Then** 提示「点到了白块」，游戏结束，wrongTaps +1。
5. **Given** 不做任何操作，**When** 黑块越过底部判定线，**Then** 提示「漏点了黑块」，游戏结束，misses +1。
6. **Given** 得分持续增长，**When** 观察 HUD 速度，**Then** 速度从 2.0 逐步上升且不超过 8.0。
7. **Given** 对局进行中，**When** 暂停，**Then** 色块停止下落、计时停止；恢复后继续累计，暂停期间点按无效。
8. **Given** 对局进行中，**When** 切换到其他标签页或窗口失焦，**Then** 只自动暂停一次并写入存档，回到页面保持暂停。
9. **Given** 已有得分，**When** 刷新页面后重新进入，**Then** 开始屏出现「继续上次」，点击后恢复到暂停态，得分与用时正确。
10. **Given** 存档超过 24h，**When** 进入开始屏，**Then** 不显示「继续上次」，存档被清理（异常）。
11. **Given** 存档行轨道越界或坐标非法，**When** 读取，**Then** 判定为坏档并删除，不阻塞新局（异常）。
12. **Given** 连续命中 10 块，**When** 结算，**Then** 最高连击 ≥10，累计点中 +10，最高分取历史最大。
13. **Given** 一局有效时长 ≥120s，**When** 结束，**Then** `pomodoro-sessions-v1` 追加一条 `game:'piano-tiles'`，同一局不重复写入。
14. **Given** 在 320px 视口，**When** 进入对局并操作，**Then** 棋盘与 HUD 完整显示、无横向滚动，轨道按钮 ≥44px，字号 ≥0.75rem。

## 8. 存储变更

| 键名 | 用途 | 生命周期 |
| --- | --- | --- |
| `game-piano-tiles-save-v1` | 未完成对局 `{ v:1, rows:[{id,lane,y,hit}], score, combo, maxCombo, hits, misses, wrongTaps, elapsed, ts }` | ≤4096 字符；24h TTL；命中 0 不写；结束 / 重开 / 放弃 / 菜单即删；坏档自动清理 |
| `game-piano-tiles-stats-v1` | 累计统计 `{ plays, gamesOver, totalTiles, maxCombo, bestScore, misses, wrongTaps, updatedAt }` | 持久；脏标记 + 1s 防抖 + pagehide 写入，读取逐字段归一为非负整数 |
| `pomodoro-sessions-v1` | **扩展**：结束且 ≥120s 追加 `{ startTs, endTs, durSec, game:'piano-tiles', win:false, level }` | 持久（仅保留最近 14 天） |
