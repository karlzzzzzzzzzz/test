# 西蒙记忆（Simon Says）需求文档
> 随机生成于 2026-11-26，规模：大型，类型：新增功能

## 1. 背景与目标

项目已上线 26 款小游戏，其中「记忆翻牌」考空间记忆、「数回/数织」考逻辑推理，但缺少**序列记忆 + 节奏反应**类玩法。西蒙记忆（Simon Says）四色按钮按序闪烁、玩家复现序列，是经典短时记忆训练玩法，也是本项目第一款强节奏音游雏形。

目标：新增第 27 款 `/simon-says`，四色按钮序列逐轮加长，速度随关卡递增，3 点生命、双路自动暂停、24h 进度存档、埋点统计与番茄钟联动，并满足键盘可访问性与 320px 窄屏触控要求。

## 2. 与基线的关系

| 基线现状 | 本次动作 |
|---------|---------|
| 1.4 路由表 35 行（含 `/tic-tac-toe`） | 【新增】追加 `/simon-says`，`lazy(() => import('./pages/SimonSays'))` 独立分包 |
| 3.1 首页作品入口 30 张卡片 | 【修改】追加第 31 张卡「西蒙记忆」→ `/simon-says` |
| 3.5 技术文档中心 registry 23 篇 | 【新增】登记 `simon-says` 文档 |
| 第 4 节存储键一览 | 【新增】3 个 `game-simon-says-*` 键 |
| 3.x 小节 33 个 | 【新增】3.34 西蒙记忆小节 |

## 3. 页面结构

```
┌─ nav：← 返回首页 | 西蒙记忆 · Simon Says ──────────┐
├─ 开始屏：规则说明 / 恢复卡片 / 音效开关 / 历史最佳 / 开始游戏
├─ 游戏屏（playing / paused / over）
│   ├─ HUD：关卡 / 生命（♥×3）/ 最佳关卡 / 用时 / 状态提示
│   ├─ 2×2 四色按钮盘（红/绿/蓝/黄），回放时依次高亮
│   ├─ 操作：重开 · 暂停 · 返回菜单
│   ├─ 暂停遮罩（含自动暂停原因）
│   └─ 结束遮罩（关卡 / 复现成功次数 / 新纪录）
└─ aria-live 播报区（关卡开始 / 序列播放 / 输入正确 / 失误）
```

## 4. 功能点明细

| 模块 | 交互 | 规则/逻辑 | 异常处理 |
|------|------|-----------|----------|
| `SimonSaysEngine.start` | 开局 | 序列 = 1 个随机 pad（0-3），round=1，lives=3，state='showing'，回放从头开始 | 重复 start 先重置全部状态 |
| `Engine.tick(dtMs)` | 页面 rAF 驱动 | 仅 'showing' 态推进回放时钟：flashOn → gap → 下一个 pad；序列播完 → state='input'；dt 单次上限 100ms 防跳帧 | dt ≤ 0 或非有限值忽略 |
| `Engine.currentFlash` | UI 高亮 | 'showing' 且处于 flashOn 相位时返回当前 pad 索引，否则 null | — |
| `Engine.input(pad)` | 点击/键盘 | 'input' 态校验 sequence[inputIndex]：命中 → inputIndex+1，播完 → 下一关（追加随机 pad，speedFactor 递减）；错误 → lives-1，重置 inputIndex 并重播序列；lives=0 → 'over' | 非 'input' 态返回 `{ok:false, reason:'not-input'}`；pad 越界忽略 |
| `Engine.speedFactor` | 难易曲线 | `max(0.45, 1 - (round-1) * 0.05)`，即每关快 5%，最低 45% 时长 | — |
| `Engine.pause/resume` | 暂停 | 暂停冻结回放时钟与输入；恢复从暂停点继续，不跳帧 | 非 playing 相关态忽略 |
| `SimonSays.jsx` 音效 | 点击开关 | WebAudio 方波短音（4 个音高），默认关闭，设置持久化 `game-simon-says-settings-v1` | AudioContext 不可用静默降级 |
| `SimonSays.jsx` 键盘 | 1/2/3/4 或方向键 | 1=左上、2=右上、3=左下、4=右下；方向键映射同上方向；Esc 暂停；R 重开；Tab 可聚焦四个 pad 后 Enter 触发 | 回放期间按键忽略并 aria-live 提示「请等待序列播放」 |
| `SimonSays.jsx` 自动暂停 | 后台/失焦 | `visibilitychange(hidden)` + `window blur` 双路去重，仅 playing 触发一次；恢复手动继续 | 已暂停不重复触发 |
| `SimonSays.jsx` 存档 | 800ms 防抖 | `game-simon-says-save-v1`：`{v:1, sequence, inputIndex, round, lives, elapsed, ts}`，序列上限 60，≤4096 字符，24h TTL，结束/重开/放弃即删，坏档清理 | 写入失败静默降级 |
| `SimonSays.jsx` 埋点 | 1s 防抖 + pagehide | `game-simon-says-stats-v1`：`{plays, gamesOver, bestRound, totalRounds, wrongPresses, updatedAt}` | 写入失败静默 |
| `SimonSays.jsx` 最佳记录 | 结束时 | `game-simon-says-best-v1`：`{bestRound, date}`，仅更高关卡覆盖 | 损坏回退空对象 |
| `SimonSays.jsx` 番茄钟 | 对局 ≥120s | 追加 `pomodoro-sessions-v1`，`game:'simon-says'`，`win: round>=10`，`level:'第${round}关'`，同局仅结算一次 | 时长不足跳过 |
| `Home.jsx` ENTRIES | 首页入口 | 追加「西蒙记忆」卡 → `/simon-says`，span 3 | — |
| `App.jsx` 路由 | 访问 `/simon-says` | lazy + Suspense 兜底 | ErrorBoundary 承接 |

## 5. 状态说明

**加载**：路由懒加载显示「加载中…」。

**空**：无存档不渲染恢复卡片；无最佳记录显示「暂无记录」。

**错误**：
- localStorage 读写失败（隐私模式/配额）→ catch 静默降级内存态
- 存档损坏（v≠1、sequence 含非 0-3、round<1、lives 越界、inputIndex 越界）→ 丢弃并新局
- AudioContext 创建失败 → 音效开关置灰，游戏核心不受影响

**边界情况**：
1. 320px 视口四宫格每格 ≥120px，圆角按钮热区远大于 44px。
2. 序列长度上限 60（远超人类极限），避免存档膨胀。
3. 回放期间按键不计错、不扣生命，只提示等待。
4. 关闭音效时回放仅靠视觉高亮 + aria-live 播报 pad 名称。
5. 暂停中 tick 不推进、input 被忽略。
6. 页面刷新后恢复为 paused 态，需手动继续（不自动播放序列）。
7. 生命耗尽后仍保留本局关卡数据用于结束屏展示与新纪录比较。

## 6. 非功能需求

- **切后台/失焦**：双路去重自动暂停，恢复不跳帧（rAF 每帧刷新时间基准）。
- **键盘与无障碍（约束卡②）**：四个 pad 为原生 `button`，roving tabindex，方向键移动焦点，Enter/空格触发；`aria-label` 标注颜色与音名，`aria-pressed` 表达高亮；`aria-live="polite"` 播报关卡、序列播放、正确/失误、结束原因；焦点环 `:focus-visible` outline。
- **移动端（约束卡③）**：`touch-action: manipulation` 消除 300ms 延迟；四宫格 `aspect-ratio: 1` + `min(88vw, 420px)` 自适应；320px 下字号 ≥0.75rem、无横向滚动。
- **埋点（约束卡①）**：plays/gamesOver/bestRound/totalRounds/wrongPresses；脏标记 + 1s 防抖 + `pagehide` 冲刷。
- **性能**：回放由单一 rAF 循环驱动，无 setTimeout 堆积；序列生成 O(1)/回合。
- **音频**：仅用户手势后创建 AudioContext（浏览器自动播放策略），方波 oscillator + 指数衰减，避免资源泄漏（每次播放后 stop）。

## 7. 验收标准

1. Given 新开局 When 回放结束 Then 4 个 pad 依次高亮一遍，state 从 showing 变 input。
2. Given 玩家按正确顺序复现 When 最后一下命中 Then round+1，序列追加 1 个 pad，重新回放。
3. Given 玩家按错 When 生命 >1 Then lives-1，输入进度重置并重播本关序列。
4. Given 生命归零 When 再次按错 Then state='over'，结束屏显示关卡与新纪录标记。
5. Given 关卡 10 When 回放 Then 单步时长 = 基础时长 × 0.55（速度因子 0.55），不低于 45%。
6. Given 回放中按键 Then 不扣血、不计错，aria-live 提示等待播放。
7. Given 键盘按 1/2/3/4 Then 触发对应 pad，与点击等效。
8. Given 焦点在 pad 上按 Enter Then 触发该 pad。
9. Given 切后台 When visibilitychange(hidden) Then 自动暂停并落盘；返回需手动继续。
10. Given 24h 内未完成对局 When 再次进入 Then 开始屏显示继续卡片，恢复为 paused。
11. Given 320px 视口 Then 四宫格完整可见、无横向滚动、按钮热区 ≥44px。
12. Given 对局 ≥120s When 结束 Then 写入 `pomodoro-sessions-v1` 且同局仅一条。

## 8. 存储变更

| 键名 | 用途 | 生命周期 |
|------|------|---------|
| `game-simon-says-save-v1` | 未完成对局：`{v:1, sequence, inputIndex, round, lives, elapsed, ts}`；序列 ≤60、≤4096 字符、24h TTL、结束/重开/放弃即删、坏档清理 | 持久 TTL 24h |
| `game-simon-says-best-v1` | 最佳关卡：`{bestRound, date}`；仅更高覆盖，损坏回退空对象 | 持久无 TTL |
| `game-simon-says-stats-v1` | 累计埋点：`{plays, gamesOver, bestRound, totalRounds, wrongPresses, updatedAt}`；脏标记 + 1s 防抖 + pagehide | 持久无 TTL |
| `game-simon-says-settings-v1` | 音效开关：`{sound:boolean}` | 持久无 TTL |
