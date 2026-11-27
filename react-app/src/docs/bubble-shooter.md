# 泡泡龙（Bubble Shooter）需求文档
> 随机生成于 2026-11-27，规模：大型，类型：新增功能

## 1. 背景与目标

项目已上线 27 款小游戏，其中「消消乐」考三消匹配、「打砖块」考弹射手感，但缺少**瞄准 + 弹射 + 同色成组消除**的街机玩法。泡泡龙（Bubble Shooter）以六边形蜂窝盘面、角度发射、三连消除与悬空气泡坠落为核心循环，是本项目第一款带连续弹道物理的消除类游戏。

目标：新增第 28 款 `/bubble-shooter`，8 列蜂窝盘面 + 角度瞄准 + 同色 3 连消除 + 悬空坠落 + 每 8 发顶部下压一行，含加载/空/错误三态、瞄准节流、双路自动暂停、24h 进度存档、埋点统计与番茄钟联动，并满足键盘可访问性与 320px 窄屏触控要求。

## 2. 与基线的关系

| 基线现状 | 本次动作 |
|---------|---------|
| 1.4 路由表 36 行（含 `/simon-says`） | 【新增】追加 `/bubble-shooter`，`lazy(() => import('./pages/BubbleShooter'))` 独立分包 |
| 3.1 首页作品入口 32 张卡片 | 【修改】追加第 33 张卡「泡泡龙」→ `/bubble-shooter` |
| 3.5 技术文档中心 registry 24 篇 | 【新增】登记 `bubble-shooter` 文档 |
| 第 4 节存储键一览 | 【新增】3 个 `game-bubble-shooter-*` 键 |
| 3.x 小节 34 个 | 【新增】3.35 泡泡龙小节 |

## 3. 页面结构

```
┌─ nav：← 返回首页 | 泡泡龙 · Bubble Shooter ─────────┐
├─ 开始屏：规则说明 / 恢复卡片 / 历史最佳 / 累计统计 / 开始游戏
├─ 游戏屏（playing / paused / over）
│   ├─ HUD：得分 / 已发射 / 距下压 / 当前颜色 / 状态
│   ├─ Canvas 盘面：蜂窝气泡、瞄准虚线（最多 2 次折返）、危险线、发射器与待发气泡
│   ├─ 操作：瞄准 ← / 发射 / 瞄准 → · 暂停 · 重开 · 返回菜单
│   ├─ 暂停遮罩（含自动暂停原因）
│   └─ 结束遮罩（清空全盘 / 气泡触底 / 得分 / 新纪录）
└─ aria-live 播报区（消除结果 / 得分变化 / 结束原因）
```

## 4. 功能点明细

| 模块 | 交互 | 规则/逻辑 | 异常处理 |
|------|------|-----------|----------|
| `BubbleShooterEngine.start` | 开局 | 生成 5 行蜂窝盘面（偶数行 8 格 / 奇数行 7 格），随机 5 色；score=0、shotsFired=0、aim=0，state='playing' | 重复 start 先重置全部状态 |
| `Engine.aimAt(x,y)` | 指针/触控瞄准 | 由发射器指向目标点求角度，限制 ±75°；重算瞄准虚线缓存 | 非 playing 或飞行中忽略 |
| `Engine.nudgeAim(delta)` | 键盘微调 | 角度 ±3° 步进并夹紧到 ±75° | 同上 |
| `Engine.shoot()` | 发射 | 从发射器生成气泡，速度 26 单位/s，沿当前角度向上；state 内 `shot` 非空即飞行中 | 飞行中重复发射返回 false |
| `Engine.tick(dtMs)` | 页面 rAF 驱动 | 仅飞行中推进：16ms 子步积分、墙面反弹、触顶或碰到已有气泡即落位；单帧上限 50ms 防跳帧 | dt ≤ 0 或非有限值忽略 |
| `Engine` 落位与消除 | 自动 | 吸附到距离弹着点最近的合法空格（第 0 行或与已有气泡相邻）；同色 BFS ≥3 个消除，每消除 1 个 +10 分；消除后从顶行 BFS，未连通的气泡整组坠落，每坠落 1 个 +20 分 | 找不到合法空格 → 结束（盘面挤满） |
| `Engine` 顶部下压 | 每 8 发 | `shotsFired % 8 === 0` 时在顶部插入一行（偏移与首行相反），行索引整体下移 | 下压后最大行号 ≥12 → 触底结束 |
| `Engine` 结束 | 自动 | 清空全盘 → over（cleared）；最大行号 ≥12 → over（overflow）；盘面挤满 → over（crowded） | 结束时保留盘面供结束屏展示 |
| `Engine.pause/resume` | 暂停 | 暂停冻结 tick（含飞行中的气泡）与输入；恢复继续 | 非 playing 相关态忽略 |
| `Engine.getSnapshot/restore` | 存档 | `{v:1, rows:[{o,c:[]}], score, shotsFired, current, next, aim, elapsed, ts}`，空格存 -1；行数 ≤20，≤4096 字符 | 坏档校验失败返回 false |
| `BubbleShooter.jsx` 渲染 | Canvas 2D | 逻辑坐标 16×26.6，`devicePixelRatio` 上限 2；rAF 按需重绘（快照写 ref，不逐帧 setState） | 2D 上下文不可用 → 错误态提示 |
| `BubbleShooter.jsx` 指针 | 按下/拖动/抬起 | 按下与拖动改角度（40ms 节流），抬起发射；触控 `touch-action: none` 防页面滚动 | 暂停/结束态忽略 |
| `BubbleShooter.jsx` 键盘 | ←/→、空格、Esc、R | ←/→ 微调角度、空格/Enter 发射、Esc 暂停、R 重开；瞄准按钮可 Tab 聚焦 | 战斗态外按键忽略 |
| `BubbleShooter.jsx` 自动暂停 | 后台/失焦 | `visibilitychange(hidden)` + `window blur` 双路去重，仅 playing 触发一次 | 已暂停不重复触发 |
| `BubbleShooter.jsx` 存档 | 800ms 防抖 | `game-bubble-shooter-save-v1`：快照 + elapsed，24h TTL，结束/重开/放弃即删，坏档清理 | 写入失败静默降级 |
| `BubbleShooter.jsx` 埋点 | 1s 防抖 + pagehide | `game-bubble-shooter-stats-v1`：`{plays, gamesOver, clears, bestScore, totalPops, totalShots, updatedAt}` | 写入失败静默 |
| `BubbleShooter.jsx` 最佳记录 | 结束时 | `game-bubble-shooter-best-v1`：`{bestScore, date}`，仅更高分覆盖 | 损坏回退空对象 |
| `BubbleShooter.jsx` 番茄钟 | 对局 ≥120s | 追加 `pomodoro-sessions-v1`，`game:'bubble-shooter'`，`win: reason==='cleared'`，`level:'得分${score}'`，同局仅结算一次 | 时长不足跳过 |
| `Home.jsx` ENTRIES | 首页入口 | 追加「泡泡龙」卡 → `/bubble-shooter`，span 3 | — |
| `App.jsx` 路由 | 访问 `/bubble-shooter` | lazy + Suspense 兜底 | ErrorBoundary 承接 |

## 5. 状态说明

**加载**：路由懒加载显示「加载中…」；进入页面首帧 canvas 尚未挂载时 HUD 显示 0 分占位。

**空**：无存档不渲染恢复卡片；无最佳记录显示「暂无记录」；累计统计全为 0 时正常展示 0。

**错误**：
- localStorage 读写失败（隐私模式/配额）→ catch 静默降级内存态
- 存档损坏（v≠1、行列数不符、颜色越界、分数为负、盘面全空、超过 20 行）→ 丢弃并新局
- Canvas 2D 上下文获取失败（极老浏览器）→ 显示「当前浏览器不支持画布」错误态与返回首页入口
- AudioContext 不涉及（本作无音效），无音频降级链路

**边界情况**：
1. 320px 视口画布按 92vw 缩放，盘面 8 列气泡完整可见，无横向滚动。
2. 瞄准虚线最多模拟 220 步（约 77 逻辑单位），覆盖 2 次以上墙面折返后仍能终止。
3. 飞行中切后台：引擎冻结，回到前台需手动继续，气泡不跳帧。
4. 单次发射后若盘面清空，立即结束（不执行下压）。
5. 吸附兜底：仅在第 0 行或存在相邻气泡的空格中选最近格，避免悬空落点。
6. 颜色池只取盘面现存颜色，盘面清空时随机兜底（实际不会发生，清空即结束）。
7. 暂停中 tick 不推进、shoot/aim 被忽略。

## 6. 非功能需求

- **切后台/失焦**：双路去重自动暂停，恢复不跳帧（rAF 每帧刷新时间基准）。
- **键盘与无障碍（约束卡②）**：画布整体 `role="img"` + `aria-label` 描述盘面与得分；瞄准/发射/暂停/重开按钮均为原生 `button` 且 ≥44px；方向键微调、空格发射；`aria-live="polite"` 播报消除数量、得分与结束原因；焦点环 `:focus-visible` outline。
- **移动端（约束卡①）**：`touch-action: none` 由指针事件统一处理，画布 `width: min(92vw, 420px)`、`aspect-ratio: 16/26.6`；按钮 ≥44px、最小字号 0.75rem；320px 无横向溢出。
- **频率控制（约束卡③）**：指针瞄准 40ms 节流；存档 800ms 防抖；埋点脏标记 + 1s 防抖 + `pagehide` 冲刷。
- **性能**：飞行积分单帧最多 50ms、16ms 子步；碰撞检测 O(格数)≈110；瞄准虚线仅在角度变化/落位后重算并缓存；渲染走单 rAF 按需重绘。
- **与基线联动（约束卡③）**：同步 1.4 路由表、3.1 首页卡片与统计条、3.5 文档中心 registry、3.35 小节、第 4 节三个存储键与番茄钟 `game` 取值。

## 7. 验收标准

1. Given 新开局 When 盘面生成 Then 5 行蜂窝气泡（8/7 交替），得分为 0，状态 playing。
2. Given 瞄准右侧 When 发射 Then 气泡沿角度飞行，碰墙反弹，触顶或碰到气泡后吸附到最近合法空格。
3. Given 新气泡与同色气泡连成 ≥3 Then 该组消失，得分 +10×数量。
4. Given 消除后存在未连通顶行的气泡 Then 该组整体坠落，得分额外 +20×数量。
5. Given 每发射 8 发 When 第 8 发落位 Then 顶部新增一行，原盘面下移一行。
6. Given 任一气泡行号达到 12 Then 立即结束并显示「气泡触底」。
7. Given 盘面被清空 Then 立即结束并显示「清空全盘」，本局不执行下压。
8. Given 飞行中按 Esc Then 暂停且气泡冻结；继续后从原位置继续飞行。
9. Given 键盘按 ←/→ Then 角度每次变化 3°，按空格发射，与指针操作等效。
10. Given 切后台 When visibilitychange(hidden) Then 自动暂停并落盘；返回需手动继续。
11. Given 24h 内未完成对局 When 再次进入 Then 开始屏显示继续卡片，恢复为 paused。
12. Given 320px 视口 Then 盘面完整可见、无横向滚动、按钮热区 ≥44px。
13. Given 对局 ≥120s When 结束 Then 写入 `pomodoro-sessions-v1` 且同局仅一条。
14. Given Canvas 2D 不可用 Then 显示错误态提示，不抛未捕获异常。

## 8. 存储变更

| 键名 | 用途 | 生命周期 |
|------|------|---------|
| `game-bubble-shooter-save-v1` | 未完成对局：`{v:1, rows, score, shotsFired, current, next, aim, elapsed, ts}`；行数 ≤20、≤4096 字符、24h TTL、结束/重开/放弃即删、坏档清理 | 持久 TTL 24h |
| `game-bubble-shooter-best-v1` | 最佳得分：`{bestScore, date}`；仅更高分覆盖，损坏回退空对象 | 持久无 TTL |
| `game-bubble-shooter-stats-v1` | 累计埋点：`{plays, gamesOver, clears, bestScore, totalPops, totalShots, updatedAt}`；脏标记 + 1s 防抖 + pagehide | 持久无 TTL |
