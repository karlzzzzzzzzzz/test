# 数回（Slitherlink）需求文档
> 随机生成于 2026-11-24，规模：大型，类型：新增功能

## 1. 背景与目标

项目已上线 24 款小游戏，其中数织、跳棋、一笔画为纯逻辑益智类，但缺少「边闭合环」形态的网格谜题。数回（Slitherlink）以「根据每格数字提示在点阵邻边连线，形成唯一闭合环」为核心，规则简洁、考验纯逻辑推理，且与已有的一笔画（欧拉路径）、数织（行列推理）构成互补的益智品类矩阵。

目标：新增第 25 款小游戏 `/slitherlink`，三档难度（5×5 / 7×7 / 9×9 点阵），支持三态边标记（无画/画边/否定）、撤销、提示、进度自动保存与恢复，外部 API 每日关卡轮换，并在首页与技术文档中心完成入口与文档登记。

## 2. 与基线的关系

| 基线现状 | 本次动作 |
|---------|---------|
| 1.4 路由与加载策略：已有 `/nonogram`、`/checkers` 等 lazy 懒加载路由 | 【新增】追加 `/slitherlink`，`lazy(() => import('./pages/Slitherlink'))`，独立分包 |
| 3.1 首页「作品入口」：29 张 CardLayout 卡片 | 【修改】追加第 30 张卡「数回」→ `/slitherlink`；统计条由 ENTRIES.length 驱动自动变为 30 |
| 3.5 技术文档中心：registry.js 登记全部 PRD | 【新增】登记 `slitherlink` 文档条目 |
| 3.30 汉诺塔：六屏遮罩 + 双路自动暂停 + 番茄钟联动 | 【新增】沿用同一交互范式，新增 3.32 数回小节 |
| 第 4 节存储键一览 | 【新增】登记 2 个 localStorage 键 + 1 个每日关卡缓存键 |

## 3. 页面结构

```
┌─ nav：← 返回首页 | 数回 · Slitherlink ───────────────┐
├─ 开始屏（start）                                    │
│   ├─ 标题 + 规则简介                                │
│   ├─【恢复卡片】发现未完成对局 → 继续 / 放弃         │
│   ├─ 难度选择：入门 5×5 / 进阶 7×7 / 专家 9×9       │
│   ├─ 开始游戏按钮                                    │
│   └─ 操作方式说明（含键盘快捷键 + 边三态切换图示）    │
├─ 游戏屏（playing / paused / over）                  │
│   ├─ HUD：计时 / 步数 / 难度标签 / 撤销·提示·清空·暂停·重开·每日关卡
│   ├─ 棋盘：点阵 + 横向纵向边 + 格子 clue 数字提示     │
│   ├─ 错误标记（实时显示 clue 不匹配的格子）          │
│   ├─ 暂停遮罩（含自动暂停原因）                      │
│   └─ 通关遮罩（用时 / 步数 / 提示次数 / 新纪录标记）  │
└─ aria-live 播报区（视觉隐藏）
```

棋盘用 SVG 绘制：点阵圆点 + 横向/纵向线段（三态：灰色虚线=未画、黑色实线=已画、红色×=否定）。格子 clue 数字置于格子中心。每 5 格绘制紫色分组线（9×9 下形成 2×2 大区块）。

## 4. 功能点明细

| 模块 | 交互 | 规则/逻辑 | 异常处理 |
|------|------|-----------|----------|
| `SlitherlinkEngine.generate` | 开局生成 | 反向生成：先生成闭合环（沿格边走，随机方向但保证不交叉、不回到已走边），再数每格被环经过的边数作为 clue；空格（null）占比约 25% | 最多重试 50 次直到环闭合；50 次仍不闭合时降级为预设经典关卡 |
| `SlitherlinkEngine.edgeState` | 点击边 | 三态循环：none → line → cross → none；每次变更入撤销栈 | 非 playing 态直接返回 false；非法 edgeIndex 忽略 |
| `SlitherlinkEngine.undo` | 撤销按钮 / Z | 弹出撤销栈顶恢复上一状态，moves 减 1 | 栈空时按钮禁用 |
| `SlitherlinkEngine.hint` | 提示按钮 / H | 从"当前 clue 不匹配"或"当前画边导致冲突"的格子中随机揭示 1 条边的正确状态，每局 3 次 | 次数耗尽后按钮禁用；无候选边返回 false |
| `SlitherlinkEngine.clearAll` | 清空按钮 | 清空全部画边与否定标记，撤销栈清零，moves 归零 | moves === 0 时按钮禁用 |
| `SlitherlinkEngine.check` | 实时检查 | 所有 clue 格子的边数匹配；所有 line 边构成连通且每端点度数 = 2 的单一闭合环（允许环与边界端点度数 ≤ 2） | 空画边集合返回 false |
| `SlitherlinkEngine.getConflicts` | 冲突高亮 | 实时返回 clue 不匹配的格子列表（红色标记）；返回违反闭合环约束的边（端点度数 ≠ 2） | 无冲突返回空数组 |
| `Slitherlink.jsx` 开始屏 | 选择难度 | 三档互斥单选，默认 easy；显示该档历史最佳用时；勾选「使用今日关卡」则从每日轮换池取 | localStorage 不可用时最佳区显示「暂无记录」 |
| `Slitherlink.jsx` 每日关卡 | API + 缓存 | 调 `timeapi.io/api/Asia/Shanghai/date?key=<date>` 获取当日日期 → 日期哈希 mod 关卡池大小 → 选关卡；失败降级本地关卡池并标记当日降级 | 6s AbortController 超时 + 降级；缓存到 localStorage `game-slitherlink-daily-v1` 按日失效 |
| `Slitherlink.jsx` 进度恢复 | 继续按钮 | 24h 内且难度一致且序列化长度 ≤1024 字符才恢复 | 任一条件不满足则丢弃进度并按新局开始 |
| `Slitherlink.jsx` 自动保存 | 每 3s + 每次操作后 | 序列化 edges（三态编码 0/1/2）+ clues + moves + elapsed + difficulty 写 `game-slitherlink-save-v1` | 写入失败静默忽略；通关/放弃/重开即删 |
| `Slitherlink.jsx` 最佳记录 | 通关时 | 同难度用时更短者入榜；同用时步数更少优先，写 `game-slitherlink-best-v1` | 读写异常回退空对象 |
| `Slitherlink.jsx` 埋点 | 通关时 | plays / wins / timeByLevel / hintsUsed 累加，脏标记 + pagehide 落盘写 `game-slitherlink-stats-v1` | 写入失败静默忽略 |
| `Slitherlink.jsx` 键盘 | 方向键 / Tab / Enter / Space / X / Z / H / R / Esc | 方向键移动焦点（roving tabindex 遍历 4×5 / 6×7 / 8×9 边网格）、Enter/Space 循环、X 否定、Z 撤销、H 提示、R 重开、Esc 暂停/继续 | 焦点在边界时不越界 |
| `Slitherlink.jsx` 自动暂停 | visibilitychange / blur | 页面隐藏或窗口失焦自动暂停并落盘进度；恢复需手动点「继续」 | 双路触发去重，已在 paused 态不重复暂停 |
| `Slitherlink.jsx` 番茄钟联动 | 通关时 | 对局时长 ≥120s 才追加 `pomodoro-sessions-v1`（`game:'slitherlink'`、level=难度） | 时长不足 120s 不写入 |
| `Home.jsx` ENTRIES | 首页入口 | 追加「数回」卡 → `/slitherlink`，`span: '3'` | — |
| `App.jsx` 路由 | 访问 `/slitherlink` | lazy 懒加载 + Suspense 兜底「加载中…」 | 分包加载失败由 ErrorBoundary 承接 |

## 5. 状态说明

**加载**：路由懒加载期间显示全局 pageLoading（「加载中…」）。

**空**：最佳记录为空时开始屏显示「暂无记录」；无未完成进度时不渲染恢复卡片。

**错误**：
- localStorage 读写抛异常（隐私模式 / 配额耗尽）→ catch 后静默降级为内存态，游戏可玩但不持久化（约束卡③）
- 进度序列化长度 >1024 字符 → 不写入，避免撑爆配额
- 进度数据损坏（边数不符 / 含非 0-2 字符 / 难度不匹配 / 步数为负）→ 丢弃并按新局开始（约束卡③ 坏档自动清理）
- timeapi.io API 调用失败（超时 / 网络不可达 / 返回格式异常）→ 降级本地关卡池（约束卡②）

**边界情况**：
1. 9×9 棋盘在 320px 视口下边间距缩至 3px、格子缩至 24px，SVG viewBox 自适应。
2. 撤销栈上限 300，超出后丢弃最早记录（shift）。
3. 提示次数 3 次耗尽后按钮禁用且 H 键 aria-live 播报「提示次数已用完」。
4. 24h 前的旧进度视为过期，不展示恢复卡片。
5. 暂停中点击边 / 撤销 / 提示均被引擎忽略。
6. 空棋盘（0 条画边）检查返回 false，提示「至少画一条边」。
7. 关卡 clue 里若 clue 为 null（空格），该格不参与 clue 匹配检查。

## 6. 非功能需求

- **切后台 / 失焦行为（约束卡①）**：`visibilitychange(hidden)` 与 `window blur` 双路去重，仅 playing 暂停一次；暂停冻结画边状态与计时；回到页面保持暂停，手动继续；恢复不跳帧（同钢琴块 rAF 每帧刷新时间基准）。
- **外部 API 调用与失败降级（约束卡②）**：timeapi.io/Asia/Shanghai（6s AbortController 超时），按日期哈希 mod 本地关卡池大小；缓存 `game-slitherlink-daily-v1` 按日失效；失败降级本地关卡池并标记当日降级。
- **localStorage 持久化（约束卡③）**：存档 `game-slitherlink-save-v1`（单条 JSON ≤1024 字符、24h TTL、通关/重开/放弃/菜单即删）；坏档自动清理（v=1 版本校验、边数合法、步数非负）；读写 try/catch 静默降级。
- **性能**：闭合环连通性检查每 10 次操作节流一次（BFS 遍历），避免实时每次点击都 O(N) 全图扫描。
- **兼容**：纯 DOM + SVG 渲染，无 Canvas 依赖，Safari / Chrome / Firefox 全兼容；320px 视口下布局不溢出。
- **埋点**：`game-slitherlink-stats-v1`（plays / wins / timeByLevel / hintsUsed / updatedAt），脏标记 + 1s 防抖 + pagehide 落盘。
- **无障碍**：SVG 加 role="img" + aria-label 描述棋盘；键盘方向键 roving tabindex 遍历边网格；aria-live 播报 clue 冲突数 / 画边数 / 通关。

## 7. 验收标准

1. Given 新开局 When 点击边 Then 边状态在三态间循环（none→line→cross→none），撤销栈+1。
2. Given 有画边且全部 clue 匹配 When 画边构成单一闭合环 Then 显示通关遮罩（用时 / 步数 / 新纪录）。
3. Given 空格（null clue） When 该格被画任意边数 Then 不参与 clue 匹配检查（异常）。
4. Given 数字 clue 格 When 周围 4 条边的画边数 ≠ clue 值 Then 该格红色标记并 aria-live 播报冲突数。
5. Given 画边构成闭环但有多个独立环 When 调用 check() Then 返回 false 并标记"存在多个环"（异常）。
6. Given 画边构成闭环但有边端点度数 ≠ 2 When 调用 check() Then 返回 false 并标记度数冲突（异常）。
7. Given 有撤销栈 When 按 Z 键 Then 弹出栈顶恢复上一状态，步数-1。
8. Given 提示次数未耗尽 When 按 H 键 Then 随机揭示 1 条边的正确状态，次数-1。
9. Given 未完成对局 When 页面 24h 内刷新 Then 开始屏显示「继续上次」按钮，点击恢复为 paused 态。
10. Given 页面切到后台 When visibilitychange(hidden) Then 自动暂停 + 落盘进度；回到页面需手动继续（约束卡①）。
11. Given timeapi.io API 不可用 When 游戏加载 Then 降级本地关卡池且 aria-live 播报「今日关卡使用本地缓存」（约束卡②）（异常）。
12. Given localStorage 配额耗尽 When 保存进度 Then catch 后静默降级为内存态，UI 显示「进度未保存」小提示（约束卡③）（异常）。

## 8. 存储变更

| 键名 | 用途 | 生命周期 |
|------|------|---------|
| `game-slitherlink-save-v1` | 未完成对局存档：`{ v:1, difficulty, edges(0/1/2字符串), clues, moves, elapsed, ts }`；≤1024 字符、24h TTL、通关/重开/放弃/菜单即删、坏档自动清理 | 持久（TTL 24h） |
| `game-slitherlink-best-v1` | 三档难度最佳记录：`{ easy:{timeSec,moves,date}, normal:{...}, hard:{...} }`；仅用时更少优先、同用时步数更少优先，损坏回退空对象 | 持久（无 TTL） |
| `game-slitherlink-stats-v1` | 累计埋点：`{ plays, wins, timeByLevel:{easy:[],normal:[],hard:[]}, hintsUsed, updatedAt }`；脏标记 + 1s 防抖 + pagehide 落盘 | 持久（无 TTL） |
| `game-slitherlink-daily-v1` | 每日关卡缓存：`{ v:1, date, difficulty, edges, clues, source:'api'|'fallback', ts }`；按日失效，次日重新获取 | 持久（TTL 按日） |
