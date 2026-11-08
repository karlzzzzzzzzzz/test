# 黑白棋（Reversi）新增小游戏 需求文档

> 随机生成于 2026-11-07，规模：大型，类型：新增功能
>
> 抽取来源：`node .trae/skills/random-prd/scripts/pick.js --target new-game`
> 抽取结果：页面「黑白棋」，主题「夹吃翻转、合法位提示、终局计子」，联动「首页 + 技术文档中心」，规模「大型」，约束卡 3 张（切后台/失焦行为、键盘可访问性与 aria、防抖/节流频率控制）；`corrected: false`，`conflicts: []`（无冲突纠正记录）。

## 1. 背景与目标

首页已有 16 张作品入口卡，现有 11 款小游戏里只有四连棋是棋类，缺少「夹吃翻转 + 位置权衡」的经典棋类玩法。本次新增第 17 张入口卡、第 12 款小游戏「黑白棋」：8×8 棋盘、黑棋先手、八方向夹吃翻转、对手无子可落时自动跳过、双方都无子可落时按棋子数定胜负；三档 AI（随机走神 / 贪心抢角 / 向前算 3 步），单局限时 180 秒。

目标：首页新增第 17 张入口卡与 `/reversi` 路由；单局 1~3 分钟；320~1024 九档宽度下热区 ≥40px、无横向溢出；引擎纯逻辑可单测，页面与引擎解耦。

## 2. 与基线的关系

| 基线现状 | 本次变更 |
|----------|----------|
| 1.4 路由与加载策略：游戏页均为 `lazy` 独立分包 | **新增** `/reversi` 懒加载路由与 `<Suspense fallback="加载中…">` |
| 3.1 首页 · 作品入口（ENTRIES）：`CardLayout` 渲染，路由唯一，`span='3'` | **新增** 第 17 张「黑白棋」卡片（`to:'/reversi'`、`footer` 带「开始挑战」） |
| 3.1 首页 · 统计条：模块数由 `ENTRIES.length` 驱动 | **保持** 动态驱动，新增卡后自动显示 17，不手写数字 |
| 3.9 技术文档中心：`src/docs/*.md` + `?raw` 导入 + `registry.js` 登记 | **新增** `reversi-game.md` 与 registry 条目 |
| 3.11~3.14 纯 DOM 游戏页约定：四态、双路暂停、`role=grid` + roving tabindex + `aria-live`、100svh、`overflow-x:hidden`、reduced-motion | **沿用** 同一套页面壳约定；不修改既有游戏页面 |
| 第 4 节数据与存储一览 | **新增** 2 个 `game-reversi-*` 键，登记入表 |

## 3. 页面结构

```
/reversi（Reversi.jsx）
├── 顶部：← 首页 / 标题「黑白棋」/ 暂停·继续
├── HUD：步数 · 黑子 · 白子 · 倒计时
├── 回合条：轮到你落子 / 电脑思考中… / 已暂停 / 本局结束
├── 棋盘：role=grid（8 行 role=row，格 role=gridcell + 原生 button）
│   ├── 空位（可落子时显示小圆点提示）
│   ├── 黑子（玩家）/ 白子（电脑）
│   ├── 最后一手标记 + 最近翻色高亮
│   └── 位置权重不展示，仅用于 AI 评估
├── 动作区：重新开局 / 返回首页
├── 提示条：点按合法位置，夹住的白子会翻成黑子
└── 遮罩：start（三档难度 + 各档最佳）/ paused / over（win·lose·draw·timeout）
```

新增区块：全部为本次新增；不改变首页其他区块与既有 16 张卡片。

## 4. 功能点明细

| 模块 | 交互 | 规则/逻辑 | 异常处理 |
|------|------|-----------|----------|
| 路由（`App.jsx`） | 访问 `#/reversi` | `lazy(() => import('./pages/Reversi'))` 独立分包，Suspense 回退「加载中…」 | 分包加载失败沿用既有 loading 文案，不阻塞其他路由 |
| 首页入口（`Home.jsx` ENTRIES） | 点击「开始挑战 →」 | 新增第 17 项：`to:'/reversi'`、`span:'3'`、`techTags:['DOM','React Hooks','Board Game']`，描述写明「8×8 夹吃翻转 / 三档 AI / 3 分钟」 | 字段缺失沿用 `CardLayout` 既有降级；不改既有 16 项 |
| 首页统计（`Home.jsx`） | 进入视口 | 模块数继续由 `ENTRIES.length` 驱动（变为 17），无手写数字 | `AnimatedNumber` 在 reduced-motion 下直接显示终值 |
| 技术文档中心（`registry.js`） | 打开 `/docs/reversi-game` | 新增 `reversi-game.md` 的 `?raw` 导入与 docs 条目（slug/title/summary/date/tags/readTime/content） | slug 不存在时 `DocView` 既有「文档未找到」空态 |
| 引擎 · 初始盘面（`ReversiEngine.js`） | `start(level)` | 8×8 全空 + 中心四子：黑 d5/e4（35/28）、白 d4/e5（27/36）；黑先手；初始合法点固定 4 个：c4/d3/e6/f5（26/19/44/37） | 难度 key 非法回退 `easy`；`start` 可反复调用并完全重置 |
| 引擎 · 落子与翻色 | `tap(idx)` | 仅玩家回合、空格、且八方向中至少一条能夹住对手棋子时生效；被夹住的对手棋子全部翻成玩家色；`moves+1` | 已占位 / 无夹吃 / 越界 / 非整数 / 非玩家回合 → 返回 `false`，步数不变 |
| 引擎 · 自动跳过 | 每次切换回合 | 对手无合法点时：若自己仍有合法点 → 回合留在自己、`passBy` 记录对手、`passes+1`、`lastAction='pass'` | 双方都无合法点 → 直接按棋子数结算，不进入死循环 |
| 引擎 · 终局计子 | 棋盘落满或双方无子可落 | `player > ai` → `win`；`player < ai` → `lose`；相等 → `draw`；触发 `onGameOver(score, elapsed, result)` | 只有 `win` 计分，其余分数为 0 |
| 引擎 · 计时 | 页面每 250ms `tick()` | 首次有效落子启动计时；`elapsedBase + resumeAt` 双字段冻结暂停时长；达到 180 秒 → `over/timeout` | 未落子不启动、不超时；暂停期间计时不增长 |
| 引擎 · 计分 | 胜利时 | `max(100, baseScore − moves×12 − floor(elapsed)×2 + (黑子−白子)×20)`；base 轻松 600 / 挑战 900 / 专家 1200 | 分数下限 100；失败/平局/超时不计分 |
| 引擎 · AI 三档 | 页面在 520ms 思考延迟后调用 `aiTurn()` | 轻松：30% 概率随机合法点，否则贪心；挑战：翻子数 + 位置权重贪心；专家：alpha-beta 向前算 3 步 | 电脑无合法点时按终局计子收尾；暂停/非电脑回合调用返回 -1 |
| 引擎 · 频率控制 | 连续点按 | 150ms 内的重复 `tap` 一律忽略，避免双击/连点造成重复落子 | 节流命中返回 `false`，由页面播报「操作过快」 |
| 页面 · 四态 | start / playing / paused / over | 四态遮罩 + HUD；start 展示三档难度与各档最佳；over 展示结果、步数、双方棋子数、用时、得分、最佳 | 引擎快照缺失时 HUD 显示「—」，不进入 playing |
| 页面 · 触控 | 点按棋盘格 | 空格且合法 → 落子并翻色；非法格 → 播报「该位置不能落子」；点按即落子，无滑动依赖 | `touch-action:manipulation` 关闭双击缩放；长按不出菜单 |
| 页面 · 键盘与读屏 | Tab / 方向键 / Enter·Space | 棋盘 `role=grid`、行 `role=row`、格 `role=gridcell`；roving tabindex 仅焦点格 `tabIndex=0`；方向键/Home/End 移动焦点并 `preventDefault`；`aria-live=polite` 播报落子、翻子数、跳过、胜负；计时器 `aria-live=off` | 焦点格越界时夹在 0~63；同一动作只播报一次（tick 复用 lastAction 去重） |
| 页面 · 双路暂停 | 手动暂停 / 切后台 / 失焦 | `visibilitychange` + `window.blur` 双路 + `pausedByVisibilityRef` 去重；仅 playing 生效；暂停冻结计时并禁用棋盘（`pointer-events:none` + `aria-hidden`） | 恢复需手动点击；`document.hidden` 时拒绝恢复 |
| 存储 · 最佳（`game-reversi-best-v1`） | 胜利结算 | `{ [level]: {score, moves, time} }`；仅更高分覆盖；无需其他键 | JSON 损坏/不可用回退空对象；写入失败 → 结算页提示「本局成绩未保存」 |
| 存储 · 埋点（`game-reversi-stats-v1`） | 开局/结算 | `{ plays, wins, losses, draws, moves, timeByLevel, updatedAt }` 全生命周期累计；脏标记 + 1s 兜底 + `pagehide` 落盘 | 写入失败静默跳过，不阻断游戏 |

## 5. 状态说明

- **加载**：`/reversi` 分包加载期间显示「加载中…」。
- **空**：start 态各档无记录时显示「暂无记录」；HUD 在 start 态显示「—」。
- **错误**：
  1. localStorage 不可用/配额满 → 游戏继续，结算页提示「本局成绩未保存」。
  2. 快照缺失（引擎未就绪）→ HUD 占位，不渲染棋盘。
- **边界情况（≥4）**：
  1. 玩家点按后对手无子可落 → 自动跳过并回到玩家，HUD 回合条提示「对手跳过」。
  2. 双方都无子可落时棋盘未满 → 立即按棋子数结算，不要求落满 64 格。
  3. 150ms 内连点两个不同空格 → 第二次被节流忽略，只落第一手。
  4. 暂停期间点按棋盘 / 电脑思考计时到点 → 均不执行，恢复后重新调度。
  5. 首手落在非法位置 → 计时不启动，避免「未开局先倒计时」。
  6. 专家档 AI 搜索时棋盘已接近满盘 → 仍只遍历合法点，非法点为 0，不出现空指针。

## 6. 非功能需求

- **（约束卡① 切后台/失焦）** 页面监听 `visibilitychange` 与 `window.blur` 双路，用 `pausedByVisibilityRef` 去重，保证一次切后台只触发一次暂停；暂停必须冻结计时（`elapsedBase + resumeAt`），恢复后不补扣时间。
- **（约束卡② 键盘与 aria）** 棋盘 `role=grid` + 行 `role=row` + 格 `role=gridcell`，roving tabindex 仅一个 0；方向键/Home/End 移动焦点且不滚动页面；`aria-live=polite` 播报落子与结果，`aria-atomic=true`；焦点环 2px `#aa3bff`。
- **（约束卡③ 防抖/节流）** 玩家落子 150ms 节流；电脑落子统一经 520ms 延迟调度，暂停时清理定时器；倒计时 tick 250ms，不触发额外 AI 调度。
- **移动端**：320px 下棋盘横向铺满（8×40px，零间距零内边距），单格热区恰好 40×40；≥480px 恢复 6px 间距与 10px 内边距；页面 `min-height:100svh`、`overflow-x:hidden`、`touch-action:manipulation`；`prefers-reduced-motion` 关闭位移/过渡/落子动画。
- **性能**：引擎纯逻辑无 DOM；单次落子 O(64×8)；专家档搜索深度 3 且 alpha-beta 剪枝，单步 <20ms；页面 DOM 64 格 + 遮罩，无 Canvas/无 rAF 常驻。
- **兼容**：HashRouter 深链 `#/reversi` 可直达；键盘与触屏语义一致；不新增第三方依赖。
- **埋点**：`game-reversi-stats-v1` 仅本地累计，不上报远端。

## 7. 验收标准

1. **Given** 首页已加载，**When** 滚动到作品入口，**Then** 看到第 17 张「黑白棋」卡，点击进入 `#/reversi`，统计条模块数显示 17。
2. **Given** 打开 `/docs`，**When** 点击「黑白棋」文档卡，**Then** 进入 `/docs/reversi-game` 且正文渲染成功。
3. **Given** 开始「轻松」档，**When** 棋盘出现，**Then** 中心四子为黑 d5/e4、白 d4/e5，且 c4/d3/e6/f5 四个空格显示合法提示。
4. **Given** 轮到玩家，**When** 点按 c4，**Then** d4 白子翻成黑子、黑子 4 白子 1、步数 1，回合切到电脑并显示「电脑思考中…」。
5. **Given** 玩家回合，**When** 点按已有棋子或无夹吃的空格，**Then** 不落子、不增步数，`aria-live` 播报「该位置不能落子」。
6. **Given** 150ms 内连续点按两个不同合法空格，**When** 第二次触发，**Then** 只落第一手，第二手被节流忽略。
7. **Given** 电脑回合，**When** 520ms 思考延迟结束，**Then** 电脑落在合法点并翻色，回合回到玩家。
8. **Given** 对手无合法点，**When** 玩家完成落子，**Then** 自动跳过对手并回到玩家，`passes+1`，回合条提示「对手跳过」。
9. **Given** 棋盘落满或双方都无合法点，**When** 结算，**Then** 按黑/白棋子数给出 win/lose/draw；仅 win 计分。
10. **Given** 一局进行中，**When** 切到后台或窗口失焦，**Then** 自动暂停并冻结计时，双路事件不重复暂停；恢复后继续且电脑重新调度。
11. **Given** 倒计时归零，**When** 达到 180 秒，**Then** 进入 over/timeout 屏，得分 0，可再来一局。
12. **Given** 仅键盘操作，**When** 用方向键在 8×8 棋盘移动并按 Enter，**Then** 焦点跟随、方向键不滚动页面、合法点落子并播报翻子数。
13. **Given** 320/360/375/414/480/600/768/820/1024 九档宽度，**When** 分别审计开始态与游戏中态，**Then** 0 横向溢出、0 越界、0 热区 <40px、0 字号 <12px。
14. **Given** 任意一档胜利后刷新页面，**When** 再进入 start 屏，**Then** 该档最佳分仍在；localStorage 损坏时回退「暂无记录」且不报错。

## 8. 存储变更

| 键名 | 用途 | 生命周期 |
|------|------|----------|
| `game-reversi-best-v1` | 每档最佳 `{ [level]: {score, moves, time} }` | 持久（胜利时同步写入，仅更高分覆盖） |
| `game-reversi-stats-v1` | 累计 `plays/wins/losses/draws/moves/timeByLevel` | 持久（脏标记 + 1s 兜底 + pagehide） |

共 2 个键，符合大型需求 ≤3 的上限。

## 9. 难度与数值一览

| 档位 | 名称 | 电脑策略 | 限时 | 基准分 | 最佳记录 |
|------|------|----------|------|--------|----------|
| easy | 轻松 | 30% 随机 + 贪心 | 180s | 600 | 按档独立 |
| normal | 挑战 | 翻子数 + 位置权重贪心 | 180s | 900 | 按档独立 |
| hard | 专家 | alpha-beta 深度 3 | 180s | 1200 | 按档独立 |

计分：`max(100, baseScore − moves×12 − floor(elapsed)×2 + max(0, 黑子−白子)×20)`。

频率参数：落子节流 150ms、电脑思考延迟 520ms、倒计时 tick 250ms。
