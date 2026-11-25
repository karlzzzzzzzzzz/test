# 井字棋（Tic-Tac-Toe）需求文档
> 随机生成于 2026-11-25，规模：大型，类型：新增功能

## 1. 背景与目标

项目已上线 25 款小游戏，涵盖益智、街机、卡牌，但缺少**双人对战/人机对战**品类。井字棋（Tic-Tac-Toe）规则极简、回合制、策略深度可控，作为人机对战品类的第一款，为后续五子棋的双人对战模式、棋盘类 AI 对战打基础。

目标：新增第 26 款 `/tic-tac-toe`，三档 AI 难度（easy: 随机 / normal: Minimax + alpha-beta 随机扰动 10% / hard: Minimax alpha-beta 全胜率），支持 3×3 与 4×4 棋盘切换，玩家先手/后手可选，完整撤销栈、双路自动暂停、24h 进度存档、番茄钟联动，并完成基线 8 处同步（含约束卡①联动修正）。

## 2. 与基线的关系（约束卡①联动修正）

| 基线现状 | 本次动作 |
|---------|---------|
| 1.4 路由表 33 行，游戏计数第 25 款 | 【追加】新增 `/tic-tac-toe` 路由；基线"截至 24 款" → 26 款（含 piano-tiles + slitherlink + tic-tac-toe 近三次增量） |
| 1.3 目录树 pages/ 缺 Slitherlink.jsx 等、game/ 缺 SlitherlinkEngine.js 等 | 【补齐】sync-baseline --apply 已在数回会话自动补齐；本次增量追加 TicTacToe.jsx / TicTacToeEngine.js |
| 3.5 registry.js 最后条目 slitherlink | 【新增】登记 tic-tac-toe 文档 |
| 存储键一览：2 个 slitherlink keys 已登记 | 【新增】`game-ttt-save-v1` / `game-ttt-best-v1` / `game-ttt-stats-v1` |

本次**显式修正已知不一致**：piano-tiles（第 24 款）、slitherlink（第 25 款）、tic-tac-toe（第 26 款）三次增量，基线文档头计数（截至 2026-11-23 共 24 款）已落后两次。sync-baseline 脚本自动比对 App.jsx 路由数（含 tic-tac-toe 为 26）与基文，本 PRD 配合脚本完成最终收口。

## 3. 页面结构

```
┌─ nav：← 返回首页 | 井字棋 · Tic-Tac-Toe ───────────┐
├─ 开始屏（start）                                    │
│   ├─ 标题 + 规则简介                                │
│   ├─【恢复卡片】未完成对局 → 继续 / 放弃            │
│   ├─ 棋盘尺寸：3×3 / 4×4                            │
│   ├─ AI 难度：简单 / 中等 / 困难                    │
│   ├─ 玩家标记：先手 X（默认）/ 后手 O               │
│   ├─ 开始游戏按钮                                    │
│   └─ 说明 + 历史最佳（不同棋盘/难度分档）            │
├─ 游戏屏（playing / paused / over）                  │
│   ├─ HUD：回合（X/O）· 棋盘尺寸 · 难度 · 用时 · 步数 · 撤销·重开·暂停
│   ├─ 3×3 / 4×4 棋盘：role="grid" + button[role="gridcell"] + roving tabindex
│   ├─ 胜者高亮行（WinLine）+ 平局提示
│   ├─ 暂停遮罩
│   └─ 结算遮罩（胜/负/平 + 用时 + 步数 + 新纪录）
└─ aria-live 播报区
```

## 4. 功能点明细

| 模块 | 交互 | 规则/逻辑 | 异常处理 |
|------|------|-----------|----------|
| `TicTacToeEngine` | 初始化 | 棋盘 board[][], currentPlayer ('X'/'O'), aiSide / humanSide / difficulty / size 配置；state=idle | 非法 size 回退 3；非法 side 回退 X |
| `Engine.start` | 开局 | 清空棋盘，currentPlayer 设为 humanSide；若 AI 先手则 AI 自动落子一步（同步，无定时器） | 空撤销栈 |
| `Engine.play` | 落子 | 仅 playing 态可落；已落子格忽略；落子后：① 判胜 ② 判平 ③ 切换 currentPlayer ④ 若轮到 AI → 内部 `_aiMove()` 同步返回（引擎同步执行，页面等返回后 setState）；入撤销栈 { idx, player } | 落 occupied 返回 { ok:false, reason:'occupied' } |
| `Engine.undo` | 撤销 | 弹出最后两步（人类 + AI），回到上一个人类回合；若 AI 先手开局撤销一步 → 重新 AI 先手 | 栈 < 2 只撤 1 步；栈空禁用 |
| `Engine._aiMove` | AI 内部 | 难度分支：easy → 随机空位；normal → Minimax + alpha-beta，10% 概率退回随机；hard → Minimax + alpha-beta | 递归深度：3×3 不限制（最多 9 层）；4×4 上限 5 层（防组合爆炸） |
| `Engine.checkWin` | 判胜 | 遍历所有线（行 / 列 / 对角线 / 反对角线）→ 判连 size 子 | board null 抛；返回 { winner, line } |
| `Engine.isDraw` | 判平 | 棋盘全满且无胜者 | — |
| `TicTacToe.jsx` 棋盘 | 点击/键盘 | roving tabindex（遍历所有 cell）；方向键移动焦点；Enter/空格 落子 | 焦点边界不越界 |
| `TicTacToe.jsx` 双路自动暂停 | 后台/失焦 | visibilitychange(hidden) + blur 双路；playing 才触发一次；恢复手动继续 | 已 paused 不重复触发 |
| `TicTacToe.jsx` 存档 | 3s 防抖 + 通关/失败清 | localStorage `game-ttt-save-v1`；≤4096 字符 + 24h TTL；坏档校验 | 写入失败静默 |
| `TicTacToe.jsx` 最佳记录 | 通关时 | 分档 key：size × difficulty × playerSide；用时少者优先 | 损坏回退空对象 |
| `TicTacToe.jsx` 埋点 | 1s 防抖 + pagehide | `game-ttt-stats-v1`：plays/wins/losses/draws/winRateByDiff | 写入失败静默 |
| `TicTacToe.jsx` 番茄钟 | 对局 ≥120s | `pomodoro-sessions-v1`，game:'tic-tac-toe'；同一局只结算一次 | 时长不足跳过 |
| `TicTacToe.jsx` 键盘 | 方向键 / Enter / Space / Z / R / Esc | 方向键移动焦点；Enter/Space 落子；Z 撤销；R 重开；Esc 暂停 | — |
| 外部 API | `timeapi.io/Asia/Shanghai`（6s AbortController） | 每日随机种子（用日期哈希 mod AI 扰动） | 失败 → 本地 Math.random() |
| Home.jsx ENTRIES | 首页入口 | 追加「井字棋」卡 → `/tic-tac-toe`，span: '3' | — |
| App.jsx 路由 | 访问 `/tic-tac-toe` | lazy 懒加载 + Suspense | ErrorBoundary 承接 |

## 5. 状态说明

**加载**：路由懒加载期间显示 pageLoading「加载中…」。

**空**：最佳记录为空时显示「暂无记录」；无存档时不渲染恢复卡片。

**错误**：
- localStorage 读写失败 → 静默降级内存态，游戏可玩但不持久化
- 存档损坏（size 不匹配、board 含非法字符、currentPlayer 非 X/O、步数负）→ 丢弃并按新局开始
- timeapi.io 调用失败 → AI 扰动退回纯 Math.random()（不影响核心功能）

**边界情况**：
1. 4×4 棋盘 Minimax 深度 5 层 ~10^5 节点，PC < 200ms 响应，移动端可能 ~500ms；页面加 16ms requestAnimationFrame 让步避免卡顿。
2. 撤销栈上限 100，超出 shift 最早。
3. AI 先手开局后撤销一步 → AI 重新先手（玩家第一次落子前 AI 走）。
4. 3×3 hard Minimax 保证玩家先手和棋最优；4×4 hard 也保证和棋（理论上 4×4 井字棋完美策略下和棋）。
5. 人类连续点击只处理第一个（AI 正在思考时 locked，避免竞态）。

## 6. 非功能需求

- **基线联动修正（约束卡①）**：sync-baseline 脚本自动推导基线文档头计数 + 路由表 + 目录树 + 3.x 小节 + 存储表；LLM 审查后 apply。
- **外部 API 降级（约束卡②）**：timeapi.io/Asia/Shanghai（6s AbortController），按日期哈希 mod AI 随机扰动种子；失败降级 Math.random()。
- **撤销（约束卡③）**：完整撤销栈（人类 + AI 两步一组弹出），栈空自动禁用按钮并 aria-live 播报。
- **性能**：3×3 Minimax 无深度限制；4×4 深度上限 5 层 + alpha-beta 剪枝；AI 计算同步执行但单次 < 200ms，配合 rAF 让步。
- **尺寸**：320px 视口 3×3 棋盘每格 ~90px 足够点按；4×4 每格 ~68px 仍 ≥44px 热区。
- **无障碍**：棋盘 role="grid" + button[role="gridcell"] + roving tabindex + aria-live 播报胜者/平局/回合切换。

## 7. 验收标准

1. Given 开局 When 玩家点空格里 Then 该格显示玩家标记、回合切到 AI、引擎返回 { ok:true }。
2. Given AI 难度 easy When AI 回合 Then AI 从空格里随机落子（至少 1/10 不为最优）。
3. Given AI 难度 normal When AI 回合 Then Minimax + alpha-beta，10% 概率退回随机落子。
4. Given AI 难度 hard When AI 回合 Then Minimax + alpha-beta 全胜率。
5. Given 玩家三连 When 落子后 Then 引擎返回 { winner:'X', line:[[0,0],[0,1],[0,2]] } 并结束游戏。
6. Given 棋盘填满且无胜者 When 最后一步后 Then state='draw'。
7. Given 玩家先手 When 点「撤销」Then 玩家落子 + AI 落子同时撤销，回到玩家初始态；若 AI 先手则撤销后 AI 重走。
8. Given 切到后台 When visibilitychange(hidden) Then 自动暂停 + 落盘进度；回到页面需手动继续。
9. Given 关闭页面 24h 内返回 When 打开游戏 Then 开始屏显示「继续上次」，点击恢复为 paused 态。
10. Given timeapi.io 不可用 When 游戏加载 Then AI 扰动退回 Math.random()，游戏可玩。
11. Given 4×4 棋盘 + hard AI When 完整一局 Then AI 思考 < 2s / 步（移动端）。
12. Given 通关/失败 When 对局时长 ≥120s Then 写入 pomodoro-sessions-v1，同一局只结算一次。

## 8. 存储变更

| 键名 | 用途 | 生命周期 |
|------|------|---------|
| `game-ttt-save-v1` | 存档：`{ v:1, size:{rows,cols}, difficulty, playerSide, board, currentPlayer, moves, elapsed, ts }`；≤4096 字符、24h TTL、通关/失败/重开/菜单即删、坏档自动清理 | 持久 TTL 24h |
| `game-ttt-best-v1` | 分档最佳：`{ easy:{ X:{timeSec,moves}, O:{...} }, normal:{...}, hard:{...} }`；按 size + difficulty + side 分档；用时更少优先、同用时步数更少优先 | 持久无 TTL |
| `game-ttt-stats-v1` | 累计埋点：`{ plays, wins, losses, draws, winRateByDiff, updatedAt }`；脏标记 + 1s 防抖 + pagehide 落盘 | 持久无 TTL |
