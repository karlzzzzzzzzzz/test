# 五子棋 新增小游戏 需求文档

> 随机生成于 2026-11-12，规模：大型，类型：新增功能
> 第 16 款小游戏 · 路由 `/gomoku` · 纯逻辑引擎 `src/game/GomokuEngine.js` · 页面壳 `src/pages/Gomoku.jsx`

## 1. 背景与目标

现有 15 款小游戏覆盖动作、消除、棋类（黑白棋/四连棋）、寻路与数字逻辑，但缺少经典的 15×15 连珠玩法。五子棋以极简规则（先成五者胜）支撑双人本地对战与"弱 AI"挑战两种模式，落点清晰、节奏紧凑，每局平均 3~5 分钟，天然适合番茄钟的"专注回合"场景。目标：**引擎与 UI 解耦、AI 至少具备启发式评估、双人与单人 AI 共用状态机、回合计时在暂停/后台切换时不丢步、可访问性完整（键盘方向键落子 + aria 播报）**。

## 2. 与基线的关系

- 【新增】基线 1.4 路由表新增一行：`/gomoku` → Gomoku 五子棋，lazy 懒加载独立分包。
- 【新增】基线 3.1 首页作品入口新增第 21 张卡片「五子棋」→ `/gomoku`；统计条保持 `ENTRIES.length` 驱动自动变为 21。
- 【新增】基线 3.9 技术文档中心新增 `gomoku-game` 文档（本文档），按注册表机制登记。
- 【新增】基线第 3 节新增「五子棋（/gomoku）」章节，实现完成后由 requirement-impl 补写。
- 【修改】基线第 5 节已知不一致点第 1 条「番茄钟「今日」统计为累计值、无按天重置」：**改前** `Pomodoro.jsx` 的统计用 `pomodoro-count`（自增整数），只记录"累计完成数量"，无 session 数组与"今日"口径；**改后** 五子棋对局结算页将把本局对局时长写入番茄钟的 `pomodoro-sessions-v1` session 数组（含起始时间戳，便于按"最近 24h"窗口过滤），番茄钟自身的今日计数同时切换为滚动窗口口径；此修改落在番茄钟逻辑扩展（新增 session 数组读取器），**不是**强制重构番茄钟全部 UI，番茄钟的"累计总数"仍保留，"今日 N 个番茄钟"改为"N 个番茄钟 / 最近 24h"。
- 【修改】基线第 5 节剩余一条「拖拽为交换语义」**不改动**；本轮只处理番茄钟联动。

## 3. 页面结构

1. **顶部栏**：返回首页链接（≥40px）、标题「五子棋」、暂停/继续按钮（仅对局中显示）。
2. **HUD**：当前执子方（黑/白 + 颜色圆点 + 角色 黑/白/AI）、回合倒计时（`role=timer`，不逐秒播报）、总对局数（累计）、按钮区（悔棋/认输）。
3. **盘面**：`role=grid` → 15 行 `role=row` → 225 格 `div[role=gridcell]`；棋盘背景网格线 + 正中央天元加粗；已落子用 CSS 圆点（黑/白），最后一手高亮红圈；连珠完成时五颗成线同色发光描边。
4. **AI 模式下的"当前步数指示"**：当 AI 正在思考时，在回合指示器上展示「AI 思考中…」+ 小点脉冲，页面禁止继续落子。
5. **遮罩**：start（模式 + AI 难度）/ loading（AI 随机开局准备）/ playing / paused（**冻结回合计时，但棋盘可见**）/ over（胜负 + 落子数 + 总用时 + AI 难度）。
6. **结算屏**：胜/负/平手标题、详细得分（落子数 / 总用时 / AI 难度）、**新会话入口**、返回首页、**自动把本局时长写入番茄钟滚动窗口**（约束卡②联动）。
7. **底部说明条**：15×15 棋盘，横/竖/两斜线任一方向五连即胜；黑先白后。

## 4. 功能点明细

| 模块 | 交互 | 规则/逻辑 | 异常处理 |
| --- | --- | --- | --- |
| `src/game/GomokuEngine.js` 棋盘与状态机 | 开局时触发 | 15×15 数组，落子位置 0=空、1=黑、2=白；黑方先手；支持双人与单人 AI 两种模式共用状态机 | 非法位置/空位置落子返回 rejected，不修改棋盘 |
| `src/game/GomokuEngine.js` 成五判定 | 每次落子后执行 | 四方向（横、竖、正斜、反斜）检查；连续同色 ≥5 即获胜；返回获胜方 + 获胜五颗格子索引 | 平手（棋盘填满仍未成五）返回 draw |
| `src/game/GomokuEngine.js` AI（启发式评估） | AI 回合时自动调用 | 难度 easy：合法位置随机；medium：评估函数 = 己方五连 ×10⁶ + 活四 ×10⁵ + 活三 ×10³ + 活二 ×10 + 阻四 ×10⁴ + 阻活三 ×10²，取最大值位置；hard：在 medium 评估之上加 α-β 搜索，深度 4（15×15 棋盘 4 层约 5⁴≈625 节点，可接受） | AI 回合超时（>3s）自动回退 medium 评估并在 HUD 标记"AI 超时" |
| `src/pages/Gomoku.jsx` 落子 | 点按 / 方向键 | 选中格高亮；点按有效位置落子，自动切换执子方；双人模式轮流；AI 模式下 AI 回合期间禁用落子 | 选中格已有子、棋盘已满、AI 思考中 → 拦截并播报 |
| `src/pages/Gomoku.jsx` 悔棋 | 点击悔棋按钮 | 撤销栈 ≤30 步；双人模式连续撤销最近两步（回到对手落子前）；AI 模式撤销最后两步（己方 + AI 对弈）；撤销后重新评估局面并恢复 AI 思考状态（如适用） | 栈空按钮禁用并播报；撤销不重开回合计时、不从 0 开始 |
| `src/game/GomokuEngine.js` 回合计时 | 执子方切换时启动 | 双方各自独立回合倒计时；单人 AI 模式 AI 不计时（仅给玩家计时）；双人模式黑白各 60s/回合；总对局不设限时（回合结束剩余时间累加到下回合作为"缓冲"）；回合归 0 判负 | 暂停期间冻结双方计时 |
| `src/game/GomokuEngine.js` 双路暂停 | `visibilitychange(hidden)` + `window blur` | 标记位去重只暂停一次；恢复以当时刻为新基准继续累计 | 暂停期间 AI 不思考、输入被拦截 |
| `src/pages/Gomoku.jsx` 结算联动番茄钟（约束卡②） | 胜利/失败/平手时触发 | 读取 `pomodoro-sessions-v1`（不存在则创建空数组），追加 `{ startTs, endTs, durSec, game: 'gomoku', win: true/false }`；番茄钟自身 UI 的「今日 N 个番茄钟」文案自动切换为"N 个番茄钟 / 最近 24h"（读取同一数组 `durSec ≥ 120s` 条目） | 番茄钟存储键不可用时，五子棋自身仍正常结算，不阻塞 |
| `src/game/GomokuEngine.js` 埋点（约束卡①） | 落子 / 悔棋 / 胜负 / AI 回合 | `game-gomoku-stats-v1`：plays / wins / draws / losses（按难度分类）/ moves / thinkingMs / timeByLevel；脏标记 + 1s 防抖 + pagehide 落盘；0~99999 封顶 | 不可用时仅内存累计 |
| `src/pages/Gomoku.jsx` keyboard | 方向键 / 回车 / 空格 | 方向键移动选中格（焦点跟随）；Enter/Space 在选中格落子；Esc 暂停；H 悔棋；R 认输 | 非 playing 状态忽略 |
| `src/pages/Gomoku.jsx` 可达性 | aria + roving tabindex | 盘面 role=grid；格子 role=gridcell + aria-label 含行列坐标与当前内容；选中格 roving tabIndex=0；aria-live polite 播报落子结果 / AI 回合切换 / 获胜与落子坐标 | 方向键移动选中时同步播报"行 X 列 Y，空/黑/白" |
| `src/pages/Gomoku.jsx` 移动端热区 | 全部写入 | 9 列棋盘在 320px 下每格约 34px（同扫雷/数独策略），格子用 `div[role=gridcell]`，落子按钮用 Enter/Space 或数字面板（40px+ 单独显示） | 同数独：审计选择器不含 gridcell，不产生小热区违规 |

## 5. 状态说明

| 状态 | 触发时机 | 界面表现 | 可用操作 |
| --- | --- | --- | --- |
| loading | 选择难度后 150ms 内 | 全屏遮罩「AI 准备中…」+ 旋转指示器 | 无 |
| 空 | 本机无对局记录 | 开始页难度列表下方虚线框「暂无对局记录，下局结算自动保存」 | 选择难度开始 |
| 暂停 | 手动暂停 / 切后台 / 失焦 | 遮罩**不遮蔽棋盘**（区别数独，五子棋回合计时是核心节奏，可允许看棋），计时冻结 | 继续 / 返回首页 |
| over | 胜负/平手 | 结算屏展示 + 自动向番茄钟 session 数组追加一条 | 再来一局 / 返回首页 |

边界情况：

1. **AI 超时**（≥3s）：自动回退 medium 评估，HUD 显示「AI 超时，用启发式」，本局继续，该次 AI 思考时间记入埋点。
2. **番茄钟 session 数组损坏**：五子棋读取失败时静默跳过追加，只在页面控制台告警一次，不影响五子棋自身结算。
3. **番茄钟统计不可用**：`localStorage` 配额满导致追加失败时，五子棋仍正常结算，session 数组只在内存中继续累计（下次结算前 flush），pagehide 再尝试一次持久化。
4. **回合计时 + 暂停**：暂停期间计时冻结，AI 不思考；恢复时双方各自从暂停时刻继续累计，AI 重新评估局面（若 AI 正被"超时回退"状态污染，恢复时回退 hard 难度）。
5. **悔棋连续两步（双人/AI 模式）**：撤销栈 ≤30 步，每次点击悔棋撤销两步（回到己方落子前），栈空禁用并播报。
6. **平手**：棋盘填满仍未成五时返回 draw，结算屏「平手」文案，不计入 wins/losses，单独记 draws。

## 6. 非功能需求

- **性能**：AI hard 模式 α-β 搜索深度 4，单步评估 ≤800ms（3s 超时保护）；medium 评估函数单步 ≤80ms。
- **兼容**：无后端；15×15 棋盘纯 DOM（div + 圆点）；页面 `min-height: 100svh` + `overflow-x: hidden`；`prefers-reduced-motion` 关闭脉冲/发光动画。
- **移动端热区策略（对齐扫雷/数独）**：9 列以上 15×15 棋盘在 320px 视口下单格约 18px（极端小），但五子棋落子是单次低成本操作（可点相邻空格纠正 / 悔棋），审计选择器不含 gridcell，不产生小热区违规；全部写入入口（回车/空格）与悔棋/认输按钮 ≥40px。
- **埋点**：`game-gomoku-stats-v1` 脏标记 + 1s 防抖 + pagehide flush；字段：`{ v:1, plays, wins, draws, losses, winsByDifficulty:{easy,medium,hard}, lossesByDifficulty:{easy,medium,hard}, moves, thinkingMs, timeByDifficulty, updatedAt }`。
- **约束卡①（埋点统计关键行为）**：每一步落子（含 AI）、悔棋、AI 思考耗时、胜负/平手结果都写入 `game-gomoku-stats-v1`；AI 超时回退计数单独记录 `aiTimeouts`。
- **约束卡②（番茄钟「今日」统计口径修正）**：读取并扩展 `pomodoro-sessions-v1` session 数组（含 `startTs / endTs / durSec / game / win`）；番茄钟统计条"今日 N 个番茄钟"切换为"最近 24h N 个"，其中 `durSec ≥ 120s` 才算有效番茄钟；累计总数 `pomodoro-count` 仍保留，双口径并存。
- **约束卡③（切后台/失焦行为）**：visibilitychange + blur 双路去重暂停；**恢复时回合计时从暂停时刻继续累计**（不是重新从 60s 开始）；若 AI 正处于"超时回退"状态，恢复时重置 AI 难度到用户选择的 hard/medium。

## 7. 验收标准

1. **Given** 开始页选择单人 AI + hard，**When** 点击开始，**Then** 先出现 loading 遮罩（150ms 内），随后盘面出现且已落子（黑方或 AI 黑先）。
2. **Given** 双人模式，**When** 白方在合法空格落子，**Then** 执子方指示切换为黑方，最后一手高亮红圈跟随白方；连续五颗同色成线后立即判胜（Given-When-Then 覆盖四方向任一）。
3. **Given** AI medium 模式，**When** AI 回合，**Then** 玩家落子后 AI 自动思考并落子；AI 回合期间玩家禁止继续落子（已落子位置不变），HUD 显示「AI 思考中」。
4. **Given** AI hard 模式，**When** 某一步 AI 思考时长超过 3s，**Then** 自动回退 medium 评估并落子；HUD 提示「AI 超时，用启发式」，本局继续，埋点 `aiTimeouts += 1`。
5. **Given** 悔棋按钮，**When** 连续落子若干步后点击悔棋，**Then** 撤销两步（己方 + AI/对手），回到自己落子前的状态，回合计时保持当前值（不从 60s 重开）；栈空后按钮禁用并播报（异常）。
6. **Given** 双人模式黑方回合，**When** 切后台（visibilitychange=hidden），**Then** 引擎进入 paused，计时冻结；恢复时双方各自从暂停时刻继续累计（异常）。
7. **Given** 双人模式，**When** 黑方回合倒计时归零，**Then** 黑方判负（超时失败），进入结算屏，黑方 `role=timer` 显示为 0。
8. **Given** 任意一方获胜进入结算屏，**When** 读取番茄钟 session 数组，**Then** 追加一条 `{startTs, endTs, durSec, game:'gomoku', win}`；番茄钟自身 UI 文案变为"N 个番茄钟 / 最近 24h"（异常：番茄钟存储损坏时跳过追加，五子棋仍正常结算）。
9. **Given** 胜利结算，**When** 本机已有对局记录，**Then** 写入 `game-gomoku-stats-v1`（plays / wins / moves 累加）并 1s 防抖落盘；下次进入开始页时显示「累计对局 N 局」。
10. **Given** 320/360/375/414/480/600/768/820/1024 九档视口，**When** 审计开始态与对局中态，**Then** 无横向溢出、无 <12px 字号、悔棋/认输/开始按钮热区 ≥40px；reduced-motion 下无脉冲动画；Tab 进入盘面后焦点停在默认选中格。
11. **Given** AI 模式，**When** 棋盘填满仍未成五，**Then** 返回 draw（平手），结算屏「平手」，单独记 `draws += 1`（异常分支）。
12. **Given** 首页，**When** 查看作品入口与统计条，**Then** 出现第 21 张「五子棋」卡并可跳转 `/gomoku`，统计条显示 21；**When** 查看技术文档中心，**Then** 列表含 `gomoku-game` 文档（对齐 registry 登记）。

## 8. 存储变更

| 键名 | 用途 | 生命周期（会话级/持久） |
| --- | --- | --- |
| `game-gomoku-stats-v1` | 累计埋点：plays/wins/draws/losses/winsByDifficulty/lossesByDifficulty/moves/thinkingMs/timeByDifficulty/aiTimeouts | 持久（脏标记 + 1s 防抖 + pagehide 落盘） |
| `pomodoro-sessions-v1` | **新增**（番茄钟联动）：番茄钟 session 数组 `[{ startTs, endTs, durSec, game, win }]`，用于"最近 24h"滚动窗口计数；五子棋对局结算时自动追加一条；番茄钟 UI 同时切换为读取此数组 | 持久 |
| `game-gomoku-best-v1` | 每难度最佳：单局落子数最少、用时最短、胜率最高（三项指标）；仅更优成绩覆盖 | 持久 |
