# 数织（Nonogram）新增功能 需求文档
> 随机生成于 2026-11-17，规模：大型，类型：新增功能

## 1. 背景与目标

项目已上线 17 款小游戏（含五子棋、接水管等纯逻辑益智类），但缺少**基于逻辑推理**而非操作反应的游戏类型。数织（Nonogram / Picross）以「根据行列数字提示还原隐藏图案」为核心，规则简洁、难度曲线平缓，且非常适合键盘操作与无障碍设计。

目标：新增第 18 款小游戏 `/nonogram`，提供三档难度（5×5 / 10×10 / 15×15），支持填格与叉格两种标记、撤销、每局 3 次提示、进度自动保存与恢复，并在首页与技术文档中心完成入口与文档登记。

## 2. 与基线的关系

| 基线现状 | 本次动作 |
|---------|---------|
| 1.4 路由与加载策略：已有 `/gomoku`、`/pipe` 等 lazy 懒加载路由 | 【新增】追加 `/nonogram`，`lazy(() => import('./pages/Nonogram'))`，独立分包 |
| 3.1 首页「作品入口」：22 张 `CardLayout` 卡片 | 【修改】追加第 23 张卡「数织」→ `/nonogram`；统计条「N 个功能模块」由 `ENTRIES.length` 驱动，自动变为 23 |
| 3.5 技术文档中心：`src/docs/registry.js` 登记全部 PRD | 【新增】登记 `nonogram-game` 文档条目 |
| 3.23 / 3.24 五子棋、接水管：六屏遮罩 + 双路暂停 + 番茄钟 session 联动 | 【新增】沿用同一交互范式，新增 3.25 数织小节 |
| 第 4 节存储键一览 | 【新增】登记 3 个 localStorage 键 |

## 3. 页面结构

```
┌─ nav：← 返回首页 | 数织 · Nonogram ────────────────┐
├─ 开始屏（start）                                    │
│   ├─ 标题 + 规则简介                                │
│   ├─【恢复卡片】发现未完成对局 → 继续 / 放弃         │
│   ├─ 难度选择：入门 5×5 / 进阶 10×10 / 专家 15×15   │
│   ├─ 开始游戏按钮                                    │
│   └─ 操作方式说明（含键盘快捷键）                    │
├─ 游戏屏（playing / paused / over）                  │
│   ├─ HUD：计时 / 剩余格数 / 难度标签 / 撤销·提示·清空·暂停·重开
│   ├─ 棋盘：左上角空位 + 顶部列提示 + 左侧行提示 + 格子网格
│   ├─ 操作提示条
│   ├─ 暂停遮罩（含自动暂停原因）
│   └─ 通关遮罩（用时 / 步数 / 新纪录标记）
└─ aria-live 播报区（视觉隐藏）
```

棋盘采用 CSS Grid：`grid-template-columns: auto repeat(cols, minmax(18px, 1fr))`，左侧行提示列宽自适应内容。每 5 格绘制一条紫色分组线（15×15 下形成 3×3 大区块，便于计数）。

## 4. 功能点明细

| 模块 | 交互 | 规则/逻辑 | 异常处理 |
|------|------|-----------|----------|
| `NonogramEngine._generate` | 开局生成 | 按难度密度（easy 0.54 / normal 0.52 / hard 0.50）随机布点，最多重试 60 次直到每行每列都至少有一个填充块 | 60 次仍不满足时接受当前结果，不阻塞开局 |
| `NonogramEngine._computeClues` | 提示计算 | 行/列分别扫描连续填充块长度；全空行/列提示为 `[0]` | — |
| `Nonogram.jsx` 开始屏 | 选择难度 | 三档互斥单选，默认 `easy`；显示该档历史最佳用时 | localStorage 不可用时最佳区显示「暂无记录」 |
| `NonogramEngine.cycle` | 点击格子 | 空 → 填 → 叉 → 空 循环；每次变更入撤销栈 | 非 `playing` 态直接返回 false；非法索引忽略 |
| `NonogramEngine.setCell` | X 键标叉 | 叉格仅在 `MARKED` 与 `EMPTY` 间切换 | 与当前值相同时不记历史 |
| `NonogramEngine.undo` | 撤销按钮 / Z 键 | 弹出撤销栈顶恢复上一状态，`moves` 减 1 | 栈空时按钮禁用 |
| `NonogramEngine.hint` | 提示按钮 / H 键 | 从「答案=1 但未填」的格中随机揭示 1 格，每局 3 次 | 次数耗尽后按钮禁用；无候选格返回 false |
| `NonogramEngine.clearAll` | 清空按钮 | 清空全部标记并清空撤销栈，`moves` 归零 | `moves === 0` 时按钮禁用 |
| `NonogramEngine._checkWin` | 胜利判定 | 用玩家填格重算行列提示，与目标提示逐行逐列完全一致即胜利（支持多解） | 叉格按空格计入，不参与填充统计 |
| `Nonogram.jsx` 进度恢复 | 继续按钮 | 24h 内且难度一致且序列化长度 ≤400 字符才恢复 | 任一条件不满足则丢弃进度并按新局开始 |
| `Nonogram.jsx` 自动保存 | 每 2s + 每次操作 | `exportProgress()` 序列化为 0/1/2 字符串写入 `game-nonogram-progress-v1` | 写入失败（配额/隐私模式）静默忽略 |
| `Nonogram.jsx` 最佳记录 | 通关时 | 同难度用时更短者入榜；同用时步数更少优先，写 `game-nonogram-best-v1` | 读写异常回退空对象 |
| `Nonogram.jsx` 埋点 | 通关时 | `plays / wins / timeByLevel / hintsUsed` 累加，脏标记 + `pagehide` 落盘写 `game-nonogram-stats-v1` | 写入失败静默忽略 |
| `Nonogram.jsx` 键盘 | 方向键 / Enter / Space / X / Z / H / R / Esc | 方向键移动焦点（roving tabindex）、Enter/Space 循环、X 标叉、Z 撤销、H 提示、R 重开、Esc 暂停/继续 | 焦点在边界时不越界 |
| `Nonogram.jsx` 自动暂停 | visibilitychange / blur | 页面隐藏或窗口失焦自动暂停并落盘进度；恢复需手动点「继续」 | 双路触发去重，已在 paused 态不重复暂停 |
| `Nonogram.jsx` 番茄钟联动 | 通关时 | 对局时长 ≥120s 才追加 `pomodoro-sessions-v1`（`game:'nonogram'`） | 时长不足 120s 不写入 |
| `Home.jsx` ENTRIES | 首页入口 | 追加「数织」卡 → `/nonogram`，`span: '3'` | — |
| `App.jsx` 路由 | 访问 `/nonogram` | lazy 懒加载 + Suspense 兜底「加载中…」 | 分包加载失败由 ErrorBoundary 承接 |

## 5. 状态说明

**加载**：路由懒加载期间显示全局 `pageLoading`（「加载中…」）。

**空**：最佳记录为空时开始屏显示「暂无记录」；无未完成进度时不渲染恢复卡片。

**错误**：
- localStorage 读写抛异常（隐私模式 / 配额耗尽）→ 全部 catch 后静默降级为内存态，游戏可正常玩但不持久化。
- 进度序列化长度 >400 字符 → 不写入，避免撑爆配额。
- 进度数据损坏（长度不符 / 含非 0-2 字符 / 难度不匹配）→ 丢弃并按新局开始。

**边界情况**：
1. 15×15 棋盘在 320px 视口下格子最小 18px，行提示列自适应压缩。
2. 撤销栈上限 200，超出后丢弃最早记录（`shift`）。
3. 提示次数 3 次耗尽后按钮禁用且 H 键播报「提示次数已用完」。
4. 24h 前的旧进度视为过期，不展示恢复卡片。
5. 暂停中点击格子 / 撤销 / 提示均被引擎忽略。
6. 通关瞬间自动清除进度键，避免下次进入误弹恢复卡片。

## 6. 非功能需求

- **性能**：15×15 共 225 格，DOM 节点上限 225（格子）+ 40（提示），首次渲染 <50ms；`tick` 每 500ms 仅更新计时，不重建棋盘（React 按 key 复用）。进度落盘用 2s 定时器而非每次点击写，避免 localStorage 同步写阻塞输入。
- **兼容**：Chrome / Edge / Safari / Firefox 最新两个大版本；CSS Grid、`aspect-ratio`、`backdrop-filter` 均为基线已用特性。
- **（约束卡 1）键盘可访问性与 aria 无障碍**：棋盘 `role="grid"`、格子 `role="gridcell"` + `aria-selected`、roving tabindex（仅 1 格 `tabIndex=0`）；方向键移动焦点、Enter/Space 填格、X 标叉、Z 撤销、H 提示、R 重开、Esc 暂停；每次移动与操作通过 `aria-live="polite"` 播报「第 r 行第 c 列，状态。行提示 x，列提示 y」。所有按钮 `min-height: 32px`，遮罩内按钮 44px；焦点环统一 `:focus-visible` + outline。
- **（约束卡 2）localStorage 持久化与容量策略**：3 个键 `game-nonogram-best-v1` / `game-nonogram-stats-v1` / `game-nonogram-progress-v1`；进度**只保留单条**（新局覆盖旧局），序列化上限 400 字符（15×15 为 225 字符），超限拒写；超过 24h 的进度读取时直接丢弃；埋点采用脏标记 + `pagehide`/`beforeunload` 落盘，避免高频写；所有读写均 try/catch 静默降级。
- **（约束卡 3）切后台/失焦行为**：`visibilitychange(hidden)` 与 `window blur` 双路触发自动暂停（去重：仅 `playing` 态响应），暂停时计时冻结并立即落盘进度；恢复前台后**不自动继续**，需玩家手动点「继续」，防止离开期间误触或计时被占用。
- **埋点**：`game-nonogram-stats-v1` 记录 `plays / wins / timeByLevel / hintsUsed / updatedAt`，全部数值 0~99999 封顶。

## 7. 验收标准

1. **Given** 首页作品入口 **When** 滚动到第 23 张卡 **Then** 显示「数织」且点击跳转 `/nonogram`。
2. **Given** 开始屏 **When** 选择「进阶 10×10」并点击开始 **Then** 棋盘为 10×10，行提示 10 组、列提示 10 组。
3. **Given** 游戏中 **When** 点击同一格三次 **Then** 依次变为「填 → 叉 → 空」。
4. **Given** 游戏中 **When** 按 Z 键 **Then** 最近一次标记被撤销且 `moves` 减 1。
5. **Given** 游戏中 **When** 按 H 键三次后第四次 **Then** 播报「提示次数已用完」且不再揭示格子。
6. **Given** 玩家填出满足全部行列提示的图案 **When** 落下最后一格 **Then** 弹出通关遮罩并显示用时与步数。
7. **Given** 通关用时优于历史最佳 **When** 打开通关遮罩 **Then** 显示「新的最佳记录」且 `game-nonogram-best-v1` 已更新。
8. **Given** 游戏进行中且已标记若干格 **When** 切到其他标签页 3 秒后返回 **Then** 处于暂停态、计时未增长、进度已写入 `game-nonogram-progress-v1`（异常）。
9. **Given** 存在 24h 内的未完成进度 **When** 重新进入 `/nonogram` **Then** 开始屏显示恢复卡片，点「继续」后棋盘恢复原标记（异常）。
10. **Given** 进度数据被篡改为非法字符 **When** 进入页面 **Then** 不展示恢复卡片且不抛异常（异常）。
11. **Given** 键盘用户 **When** 用方向键移动并 Enter 填格 **Then** 焦点跟随且 `aria-live` 播报当前行列与提示（异常）。
12. **Given** 对局时长超过 120s **When** 通关 **Then** `pomodoro-sessions-v1` 追加一条 `game:'nonogram'` 记录（异常）。
13. **Given** 320px 视口 **When** 进入 15×15 专家局 **Then** 无横向溢出，格子可点按，字号 ≥12px。

## 8. 存储变更

| 键名 | 用途 | 生命周期 |
|------|------|----------|
| `game-nonogram-best-v1` | 分档最佳用时 `{ easy:{elapsed,moves}, normal:{...}, hard:{...} }` | 持久 |
| `game-nonogram-stats-v1` | 累计埋点 `{ plays, wins, timeByLevel, hintsUsed, updatedAt }` | 持久 |
| `game-nonogram-progress-v1` | 当前未完成对局 `{ level, grid, elapsed, ts }`，单条、≤400 字符、24h 过期 | 持久（24h 自动失效） |
