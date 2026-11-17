# 跳棋（Checkers）需求文档

> 需求类型：新增功能（新增一个小游戏）· 规模：大型 · 目标路由：`/checkers`
> 关联页面：首页作品入口、技术文档中心
> 实现日期：2026-11-17 · 小游戏上线顺序：第 19 款

## 1. 需求背景与目标

首页作品入口已收录 23 个入口，其中棋类只有四连棋、黑白棋、五子棋，缺少「有吃子与连跳」的经典棋种。新增第 19 款小游戏**跳棋（English Draughts / 西洋跳棋）**，补齐棋类玩法谱系，并复用既有工程约定（引擎与页面壳解耦、六屏状态机、双路自动暂停、键盘可达、番茄钟联动）。

目标：

1. 完整实现 8×8 西洋跳棋规则：斜向走子、强制吃子、连跳、升王、无子/无着法判负、长局面判和。
2. 提供三档 AI 难度，所有难度都严格遵守强制吃子，避免出现「AI 不按规则走」的观感。
3. 在经典对局之外提供「每日残局」：按权威日期确定性生成盘面，同一天所有人看到同一局面。
4. 全程可键盘操作与读屏播报，移动端 320px 起不横向溢出。

## 2. 与基线的关系

- 【新增】基线 1.4 路由表新增一行：`/checkers` → Checkers 跳棋，lazy 懒加载独立分包。
- 【新增】基线 3.1 首页作品入口新增第 24 张卡片「跳棋」→ `/checkers`；统计条由 `ENTRIES.length` 驱动自动变为 24。
- 【新增】基线 3.5 技术文档中心新增 `checkers-game` 文档（本文档），登记 `src/docs/registry.js`。
- 【新增】基线第 3 节新增「跳棋（/checkers）」小节；第 4 节存储一览新增 2 个键。
- 【修改】`pomodoro-sessions-v1` 使用方扩展：跳棋对局 ≥120s 时追加 `game: 'checkers'` 的 session。
- 不改动既有游戏与首页其他区块的行为。

## 3. 页面结构

1. **顶部栏**：返回首页链接（≥44px 热区）、标题「跳棋 · Checkers」。
2. **开始屏**：规则说明 → 三档难度选择（轻松 / 标准 / 困难，含最佳说明）→「开始对局（你执红先行）」→「每日残局」面板（日期、来源徽标、今日战绩、刷新日期、开始每日残局）→ 累计战绩行 → 操作说明。
3. **游戏主界面 HUD**：计时器、回合计（你的回合 / AI 思考中 / 连跳）、必须吃子标记、难度与模式标签、暂停/继续、重开、菜单。
4. **计分行**：红方剩余子数、黑方剩余子数、手数与吃子数。
5. **棋盘**：8×8 CSS Grid，浅色格纯装饰，深色格可交互；红/黑棋子用圆形区分，王棋带内圈虚线 + 皇冠符号；选中格琥珀描边、可落点显示圆点、最近一手蓝色描边。
6. **提示条**：操作方式速查。
7. **遮罩**：暂停（可标注自动暂停原因）、结算（胜/负/和 + 用时 + 手数 + 吃子 + 升王 + 每日残局记录提示）。

## 4. 功能明细

| 模块 | 触发 | 行为 | 边界/异常 |
| --- | --- | --- | --- |
| `CheckersEngine.js` 开局 | `start(level, opts)` | 经典模式生成标准 12v12 开局；红方（玩家）先手 | 非法难度回退 `normal` |
| `CheckersEngine.js` 走子生成 | 每次请求合法着法 | 深色格斜向一步；王可四向；存在吃子时只返回吃子着法 | 非法索引、非本方回合返回空 |
| `CheckersEngine.js` 吃子 | 跳过相邻敌子落到其后空格 | 立即移除被吃子；连跳期间只允许同一枚棋继续吃 | 落点被占、越过己方子、越界均不生成 |
| `CheckersEngine.js` 连跳 | 一次吃子后可继续吃 | 回合并未切换，`chainFrom` 锁定该子；终跳后才切换 | 升王当回合立即结束，不再连跳 |
| `CheckersEngine.js` 升王 | 普通棋子走到对方底线 | 变为王棋；红王可四向走/吃 | 王棋不会二次升王 |
| `CheckersEngine.js` 胜负 | 每次着法结算 | 对方无子或无合法着法即判负；连续 80 个半回合无吃子/升王判和 | 连跳中途不结算 |
| `CheckersEngine.js` AI | `chooseAiMove()` | easy 随机；normal α-β 深度 2（预算 260ms）；hard 深度 4（预算 900ms） | 超出预算立即用已评估结果回退，不阻塞 UI |
| `CheckersEngine.js` 评估 | 搜索叶节点 | 子力（兵 100 / 王 180）+ 推进度 + 中路倾向，同分随机打散 | 无合法着法返回大负分 |
| `Checkers.jsx` 选子与落子 | 点击深色格 / Enter / 空格 | 选中己方红棋 → 高亮可落点 → 再点落点走子 | 非本方回合、非法落点、连跳期间换子均拦截并 aria 播报 |
| `Checkers.jsx` 落子节流（约束卡②） | 走子提交 | 两次提交间隔 <300ms 的重复输入直接丢弃 | 仅节流「提交」，选子/暂停不受影响 |
| `Checkers.jsx` AI 调度 | 玩家走完后 | 延迟 340ms 落子，模拟思考；连跳自动续走 | 暂停/切后台时清理定时器，恢复后按需重排 |
| `Checkers.jsx` 每日残局（约束卡①） | 进入页面 / 点刷新 | 请求 `timeapi.io` 的 `Asia/Shanghai` 当前时间（AbortController 6s 超时）取权威日期；失败/超时降级本地日期 | 30s 内重复刷新直接提示「刷新过于频繁」；接口返回格式异常按失败处理 |
| `CheckersEngine.js` 每日盘面 | 每日模式开局 | 以日期字符串哈希 + mulberry32 生成确定性盘面，双方各 6 枚，保证各有合法着法 | 同日期结果完全一致；不同日期不同 |
| `Checkers.jsx` 自动暂停 | `visibilitychange(hidden)` + `window blur` | 双路去重，仅在 playing 时暂停一次；清空 AI 定时器 | 恢复需手动点「继续」，不自动续走 |
| `Checkers.jsx` 键盘 | 方向键 / Enter / 空格 / Esc | 方向键移动焦点（roving tabindex），Enter/Space 操作，Esc 暂停/继续 | 非 playing 状态忽略；边界不越界 |
| `Checkers.jsx` 可达性 | 全流程 | 棋盘 `role=grid`，格子 `role=gridcell` + 行列与内容 aria-label；选中态 `aria-selected`；`aria-live polite` 播报选子、吃子、连跳、胜负 | 播报不逐秒刷屏（计时器不进 live 区） |
| `Checkers.jsx` 埋点（约束卡③） | 对局结束 | 写 `game-checkers-stats-v1`：plays/wins/losses/draws/captures/promotions/aiMs/dailyPlays/dailyWins | 存储不可用时仅内存累计，不阻塞结算 |
| `Checkers.jsx` 每日战绩 | 每日残局结束 | 写 `game-checkers-daily-v1` 按日期记录 result/elapsed/level/ts | 只保留合法日期与合法结果 |
| `Checkers.jsx` 番茄钟联动 | 对局结束且用时 ≥120s | 追加 `pomodoro-sessions-v1`：`{ startTs, endTs, durSec, game:'checkers', win, level }` | 不足 120s 不写入；存储异常静默忽略 |

## 5. 状态说明

- **加载**：路由懒加载期间显示全局「加载中…」；每日残局面板在请求期间显示「同步中…」，按钮禁用但不阻塞经典对局。
- **成功**：每日日期来源为网络时显示绿色「网络日期」徽标；对局结束后按 result 显示胜/负/和结算卡。
- **降级**：时间接口超时或不可用时回退本地日期，显示琥珀色「本地日期」徽标与说明文案；残局生成不依赖网络，仍可正常开局。
- **空**：尚无战绩时开始屏显示「累计 0 局」；每日面板无今日记录时不显示战绩行。
- **错误**：所有 localStorage 写入用 try/catch 包裹，失败静默降级为内存态；AI 超出预算回退当前最优着法。

## 6. 非功能与约束

- **性能**：AI hard 深度 4，单步预算 900ms（搜索内按 deadline 提前返回）；normal 260ms；easy 即时返回。棋盘 64 格纯 DOM，无 Canvas。
- **移动端**：棋盘宽 100% + `aspect-ratio: 1/1`，320px 视口单格约 34px；棋盘格用 `div[role=gridcell]`（不在审计的按钮/链接选择器内），所有按钮 ≥36px、遮罩按钮 ≥44px；最小字号 0.75rem（12px）。
- **兼容**：无后端；`min-height: 100vh`；`prefers-reduced-motion` 下关闭棋子/按钮过渡。
- **约束卡①（外部 API + 失败降级）**：每日残局日期优先取 `https://timeapi.io/api/Time/current/zone?timeZone=Asia/Shanghai` 的 `dateTime`（6s 超时 + AbortController），失败降级本地日期；降级不影响游戏可玩性。
- **约束卡②（节流/防抖）**：落子提交 300ms 节流防连点；每日残局刷新 30s 模块级节流，重复点击只提示不请求。
- **约束卡③（埋点统计）**：`game-checkers-stats-v1` 累计对局、胜负和、吃子、升王、AI 思考耗时、每日残局参与与胜场；每日残局另有按日期战绩表。

## 7. 验收标准

1. **Given** 进入 `/checkers`，**When** 页面加载完成，**Then** 显示开始屏、三档难度与每日残局面板，且无 console 错误。
2. **Given** 经典模式开局，**When** 点「开始对局」，**Then** 出现 12 枚红棋与 12 枚黑棋的标准开局，红方先行。
3. **Given** 红棋与黑棋斜向相邻且其后为空，**When** 点击红棋再点落点，**Then** 黑棋被移除、吃子数 +1。
4. **Given** 场上存在可吃子着法，**When** 尝试走一步普通移动，**Then** 走子被拒绝并播报「有可吃子的走法，必须吃子」。
5. **Given** 一次吃子后同一枚棋仍可继续吃，**When** 完成第一跳，**Then** 回合仍为红方、只能操作该子继续连跳。
6. **Given** 红棋走到对方底线，**When** 落子完成，**Then** 升为红王，且当回合并未继续连跳，直接切换为 AI 回合。
7. **Given** AI 回合，**When** AI 落子，**Then** AI 同样遵守强制吃子与连跳规则，且 340ms 内不会重复落子。
8. **Given** 对局中切换标签页或窗口失焦，**When** 回到页面，**Then** 已处于暂停态且 AI 未在后台走子，点「继续」后恢复。
9. **Given** 每日残局，**When** 同一天两次生成盘面，**Then** 两次盘面完全一致；**When** 时间接口不可用，**Then** 自动降级本地日期并显示降级说明，仍可开局。
10. **Given** 每日残局面板连点刷新，**When** 距上次请求不足 30 秒，**Then** 不发起新请求并提示「刷新过于频繁」。
11. **Given** 键盘操作，**When** 用方向键移动焦点并 Enter 选中、再移动并 Enter 落子，**Then** 走子成功且焦点环与 aria-live 播报同步更新。
12. **Given** 对局以胜利结束且总时长 ≥120s，**When** 结算，**Then** `game-checkers-stats-v1` 与 `game-checkers-daily-v1`（每日模式）写入正确，且 `pomodoro-sessions-v1` 追加一条 `game: 'checkers'`。

## 8. 存储变更

| 键名 | 用途 | 生命周期 |
| --- | --- | --- |
| `game-checkers-stats-v1` | 累计埋点：plays / wins / losses / draws / captures / promotions / aiMs / dailyPlays / dailyWins / updatedAt | 持久（每次结算写入，失败静默） |
| `game-checkers-daily-v1` | 每日残局战绩表：`{ 'YYYY-MM-DD': { result, elapsed, level, ts } }` | 持久（按日期覆盖当天记录） |
| `pomodoro-sessions-v1` | **扩展**：对局 ≥120s 追加 `{ startTs, endTs, durSec, game: 'checkers', win, level }` | 持久（仅保留最近 14 天） |
