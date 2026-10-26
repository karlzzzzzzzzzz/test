# 记忆翻牌：可访问性小游戏实现笔记

一款为纯键盘用户与读屏用户设计的记忆配对小游戏，作为作品集网站 `/memory` 路由下的第 6 款游戏。本文档记录实现要点，便于 AI Agent 或人类开发者快速接手维护。

## 玩法与计分

- **难度**：4×4（8 对，基准分 800，最少步数 8）、5×4（10 对，基准分 1200，最少步数 10）。
- **图标池**：`React / Vite / LLM / Deploy / Debug / NPM / Cloud / Test / UI / Perf`（10 个品牌感图标，风格对齐项目定位）。
- **洗牌**：Fisher–Yates 算法在开局时执行一次，每对图标复制后整体洗牌。
- **翻牌规则**：每次仅能翻开 2 张；同一张牌重复点击、已翻开或已配对的牌点击、翻回窗口期（800ms）内额外翻牌，一律忽略且不计步。
- **配对结果**：相同 → 两张保持正面并标记 `matched: true`；不同 → 800ms 后自动翻回。
- **计分公式**：`max(100, 基准 − (步数 − 最少步数) × 15 − 用时秒数 × 3)`，用时跨过 600s 后分数锁定为 100 不再下探。
- **计时起点**：翻开第一张未配对的牌时才启动（切后台/失焦不累积暂停时段，恢复时重置时钟基准）。
- **暂停**：`visibilitychange`（切后台）与 `window.blur`（失焦）双触发 + 去重标志；暂停时冻结计时、禁用翻牌、显示遮罩；恢复需手动继续。
- **结束**：全部配对自动进入结算屏，无手动结算入口（避免用户漏提交排行）。

## 键盘与 aria 实现

棋盘采用语义化 HTML 构建，**不使用 Canvas**（Canvas 画面无法被读屏解释）：

| 元素 | ARIA / 键盘约定 |
|------|----------------|
| 棋盘容器 | `role="grid"`，额外加 `tabIndex={-1}` 让方向键事件冒泡到此容器统一处理 |
| 行 | `role="row"` |
| 牌 | 外层 `role="gridcell"` + 内层 `<button role="button">`；roving tabindex（仅焦点所在的那一张 `tabIndex={0}`） |
| 焦点导航 | ↑↓←→ 按行列移动，首末行/列不环绕；Home/End 跳到本行首/尾 |
| 翻牌 | Enter / Space |
| 焦点环 | 统一 `:focus-visible { outline: 2px solid #aa3bff; outline-offset: 2px }` |

**配对后焦点管理**：当焦点所在的牌被配对成功后，自动跳到下一张未配对且未翻开的牌（同行优先，其次下一行循环）；全部配对后自动进入 over 屏，焦点落到「再来一局」按钮。

**读屏播报**：页面侧有一个 `aria-live="polite"` + `aria-atomic="true"` 的不可见 `<div>`，引擎触发 `onState` 时携带 `matchResult: 'match' | 'mismatch' | null` 字段，页面据此更新播报文案：

- 配对成功 → `配对成功，还有 N 对`
- 未配对 → `未配对，已翻回`

计时器单独加 `aria-live="off"`，避免每秒刷新打断读屏节奏。

**触控**：移动端以 `touch-action: manipulation` 关闭 iOS 双击缩放，`user-select: none` 关闭长按菜单；牌面最小触控区 44×44px（CSS `min-width/min-height` 兜底）；棋盘宽度 `min(94vw, 420px)` 居中。

**reduced-motion**：`prefers-reduced-motion: reduce` 时翻牌动画 0ms（`transition: none !important`），配对高亮改为静态 2px 绿色描边。

## 存储结构

| 键名 | 结构 | 生命周期 | 说明 |
|------|------|----------|------|
| `game-memory-leaderboard-v1` | `[{ name, score, elapsed, createdAt }]` | 持久 | 通过 `createLeaderboard(storageKey)` 绑定，与飞机大战/俄罗斯方块/贪吃蛇/打砖块排行榜 API 完全一致；50 条上限，TOP 10 展示；昵称默认取 `game-player-name`（复用），为空则「无名飞侠」 |

引擎本身**不持久化局中状态**——刷新页面或关闭 Tab 即重新开局。这是刻意的取舍：记忆翻牌单局耗时通常在 1 分钟以内，恢复快照的价值远低于实现复杂度（快照要序列化 `cards[]` 数组 + 焦点位置 + 翻回窗口期剩余时间 + 难度 + 步数 + 计时基点）。

**已知降级行为**：
- `localStorage` 配额满 / 不可用 → 榜单降级为内存数组 + 结算屏顶部红色提示条，不阻断游戏流程。
- 榜单 JSON 损坏 → `loadRows()` 回退空数组，显示「虚位以待，等你上榜」空态。

## 文件与依赖

```
src/
├── game/MemoryEngine.js   # 纯逻辑（不依赖 React）：洗牌、翻牌状态机、计分、计时、暂停
├── pages/Memory.jsx       # 页面壳：UI 四态、棋盘 aria、键盘/触控输入、暂停/恢复、排行
├── pages/Memory.css       # 样式：翻牌动画、移动端断点、reduced-motion 分支、焦点环
```

引擎与页面壳完全解耦，架构对齐贪吃蛇/俄罗斯方块/打砖块（constructor 接收 `{ onState, onGameOver, onPause }` 回调 + `dispose()` 清理）。排行榜复用 `src/api/leaderboard.js` 的参数化接口 `createLeaderboard(storageKey)`，不修改该文件。
