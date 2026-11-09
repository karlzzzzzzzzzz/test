# 本地天气卡片 请求链路健壮性与失败回退 需求文档

> 随机生成于 2026-11-09，规模：大型，类型：兼容性与健壮性

## 1. 背景与目标

天气卡片当前只区分 loading / ok / error 三态，任何一次 Open-Meteo 请求失败都会让卡片从"有数据"直接掉进"天气获取失败"，首页统计条摘要格同时变空，用户无法判断是网络抖动还是接口故障。本需求把天气数据链路从"单次请求成功即展示"升级为"可超时、可去重、可退避、可回退"的健壮链路。目标：接口连续失败场景下，60 分钟内仍能展示上一次成功数据并明确标注数据年龄；同一时刻最多 1 个 in-flight 请求；手动刷新触发的无效请求数下降为 0。

## 2. 与基线的关系

| 基线现状（第 3 节） | 本次变更类型 | 改前 → 改后 |
|------------------|------------|------------|
| 3.1.2 天气卡片：`useWeather().load()` 单次 `fetch`，无超时、无去重，失败直接 `status='error'` | 【修改】 | 单发请求 → AbortController 10s 超时 + in-flight 共享 + 最多 2 次退避重试 |
| 3.1.2 状态：loading / error / ok 三态 | 【修改】 | 新增 `stale` 降级态（展示上次成功快照 + 数据年龄徽标），原三态语义不变 |
| 3.1.2 刷新：每 10 分钟 `setInterval` 自动刷新，手动刷新 30s 节流 | 【修改】 | 自动刷新失败后按 20 / 40 / 60 分钟指数退避，成功后回到 10 分钟；手动刷新 30s 节流保留 |
| 3.1.2 定位：Geolocation 8s 超时、拒绝回退杭州、提示条 + 重试定位 | 【修改】 | 流程保留；错误文案区分"定位失败"与"天气获取失败"，两类失败都计入连续失败计数 |
| 3.1.2 适配检测 `useAdaptiveProbe`：300ms 防抖、200ms 复检、500ms 埋点节流 | 【新增】 | 复用其签名去重 + 节流机制，新增 `weather:state` 状态事件（500ms 节流）供首页与 MouseTrail 消费 |
| 3.1 首页统计条「实时天气摘要格」：与卡片共享 `useWeather`，三态 + 点击滚动聚焦 | 【修改】 | `summary.kind` 增加 `'stale'`，成功态文案增加「N 分钟前」后缀；错误态按钮「重试」→「重试天气」 |
| 3.1.1 MouseTrail：悬停带 `data-keywords` 元素时切换粒子词库 | 【新增】 | 天气卡片根节点按当前天气动态生成 `data-keywords`（6 词）；stale 态悬停光晕改琥珀色 #d97706，其余保持紫色 |
| 3.1.2 存储：仅用 `sessionStorage` 的 `weather-geo-denied-tip`，无天气数据持久化 | 【新增】 | 新增 `weather-last-ok`、`weather-auto-backoff` 两个 localStorage 键（见第 8 节） |

## 3. 页面结构

首页右侧栏「本地天气卡片」（`.bento-weather`）自上而下：

1. **卡片头**（`.weather-head`，现有）：标题 + ↻ 刷新按钮 — 不变。
2. **降级徽标行**（新增 `.weather-stale-tip`）：仅在 `stale` 态渲染，格式「数据为 N 分钟前 · 离线缓存」，右侧内联「重试」与「回退」两个按钮；`role="status" aria-live="polite"`。
3. **定位提示条**（`.weather-denied-tip`，现有）：文案沿用"已使用杭州默认位置" + 「重试定位」。
4. **主体区**（`.weather-body` / `.weather-meta` / `.weather-place`，现有）：数据展示结构不变，`stale` 时数字加 60% 透明度并用虚线边框标识非实时。
5. **错误态**（`.weather-error`，修改文案）：主文案按失败来源显示「定位失败」或「天气获取失败」，按钮为「重试」。
6. **适配异常提示**（`.weather-adapt-tip`，现有）：不变。

首页统计条摘要格在成功态右侧追加 `.bento-stat-weather-age`（「N 分钟前」），仅 `stale` 时渲染。MouseTrail 不新增 DOM，沿用 `data-keywords` 机制。

## 4. 功能点明细

| 模块 | 交互 | 规则/逻辑 | 异常处理 |
|------|------|----------|---------|
| 天气卡片 | 任意入口触发加载 | `useWeather` 内维护 `inFlightRef`，并发调用共享同一 Promise，同一时刻最多 1 个请求（落点 `src/components/Weather.jsx` `useWeather().load`） | 共享调用的第二个调用方只挂回调，不重复发请求 |
| 天气卡片 | 请求超时 | 每次 `fetch` 挂 `AbortController`，10s 未返回即 abort 并按失败处理（落点 `Weather.jsx` 新增 `fetchWithTimeout`） | abort 归为 `timeout`，与 HTTP 非 2xx、网络错误区分为不同 `reason` |
| 天气卡片 | 自动重试 | 首次失败后 1s 重试，二次失败后 3s 重试，最多 2 次；手动刷新与定位重试重置计数（落点 `Weather.jsx` `load`） | 3 次全失败进入降级分支，不再无限制重试 |
| 天气卡片 | 成功快照落盘 | 成功时写 `weather-last-ok`：`{ current, daily, place, ts }`，单条覆盖写，序列化 >500KB 则放弃写入（落点 `Weather.jsx` `load` 成功分支） | `localStorage` 抛 QuotaExceededError 时清空该键并静默继续正常展示 |
| 天气卡片 | 失败降级展示 | 全部重试失败且快照年龄 ≤60 分钟 → `status='stale'`，继续渲染快照数据并显示「数据为 N 分钟前」徽标（落点 `Weather.jsx` 错误分支 + 渲染层） | 快照缺失或 >60 分钟 → 保持 `status='error'`，不展示旧数据 |
| 天气卡片 | 撤销上一次刷新 | `stale`/`error` 态提供「回退」按钮，把 `data/place` 恢复为内存 `prevSnapshot`（仅保留 1 级），回退后置 `stale` 并刷新徽标时间（落点 `Weather.jsx` 新增 `rollback`） | 无 `prevSnapshot`（首次加载即失败）时按钮不渲染 |
| 天气卡片 | 手动刷新 | 保留基线 30s 节流；命中节流时 title 提示"刷新过于频繁，请稍后再试"（落点 `Weather.jsx` `refresh`） | 节流命中不发请求、不改变 `status` |
| 天气卡片 | 连点保护 | 重试/回退按钮点击后 5s 内 `disabled`，避免连点打穿退避策略（落点 `Weather.jsx` 两个新按钮） | 禁用期用 `aria-disabled` + `aria-busy` 同步状态 |
| 天气卡片 | 自动刷新退避 | 连续失败 1 次 → 20 分钟、2 次 → 40 分钟、≥3 次 → 60 分钟；任意成功清零并回到 10 分钟（落点 `Weather.jsx` `REFRESH_INTERVAL` 改为动态 `nextDelay`） | 退避计时器在组件卸载时清理，重挂按持久化的 `nextAt` 续算 |
| 天气卡片 | 切后台暂停 | `visibilitychange` + `blur` 双路监听去重暂停自动刷新（落点 `Weather.jsx` 新增监听 effect） | 回前台 5s 内若距上次刷新 > 当前 `nextDelay` 则补一次，否则不补 |
| 天气卡片 | 失败计数持久化 | `weather-auto-backoff` 写 `{ failCount, nextAt }`，跨页面刷新恢复退避窗口（落点 `Weather.jsx`） | 键解析失败按 `failCount=0` 起始，并覆盖写回合法值 |
| 天气卡片 | 定位失败 | 保留 8s 超时、10 分钟缓存、拒绝回退杭州；错误文案显示「定位失败」，计入连续失败计数（落点 `Weather.jsx` `getCoords`） | 定位失败但天气请求成功时仍展示数据，仅提示条标注默认位置 |
| 天气卡片 | 键盘与读屏 | 徽标 `role="status" aria-live="polite"`，重试/回退按钮 `aria-label` 明确（如"回退到 12 分钟前的天气数据"），焦点环 2px #aa3bff（落点 `Weather.css`） | 焦点环复用 `:focus-visible`，reduced-motion 下不加入场动画 |
| 首页 | 统计条摘要格四态 | `summary.kind` 新增 `'stale'`，展示 `temp + icon` 与「N 分钟前」后缀；点击仍 `scrollIntoView` 聚焦 `#weather-card`（落点 `src/pages/Home.jsx` `WeatherStatCell`） | `stale` 无温度数据时降级为 `kind='error'` 样式 |
| 首页 | 状态事件消费 | `useWeather` 派发 `weather:state`（`{ status, stale, failCount, ts }`），首页统计条与卡片读同一份状态，不重复请求；事件 500ms 节流 + 签名去重（落点 `Home.jsx` + `Weather.jsx`） | 无监听者时派发无副作用，不抛错 |
| 鼠标轨迹特效 | 卡片悬停词库 | 卡片根节点按当前天气 `desc` 生成 `data-keywords`（6 词，如"晴"→晴空/阳光/紫外线/防晒/气温/晾晒），MouseTrail 沿用现有读取逻辑（落点 `Weather.jsx` 根节点 + `src/components/MouseTrail.jsx`） | `loading` / `error` / 未知 WMO 码使用默认 6 词，不出现空词表 |
| 鼠标轨迹特效 | stale 视觉反馈 | 卡片 `data-weather-stale="true"` 时 MouseTrail 悬停光晕色由紫色改琥珀 `#d97706`，半径仍 150→220（落点 `MouseTrail.jsx` hover 分支） | 状态恢复后下次 hover 立即回紫色，无残留配色 |

## 5. 状态说明

主流程四态：

| 状态 | 触发 | 展示 |
|------|------|------|
| loading | 首次加载或缓存缺失后的重试 | 现有骨架屏；细则：有快照但在请求中时不显示骨架屏，保留旧数据直至结果返回 |
| ok | 请求成功 | 实时数据 + 天气主题词库 |
| stale | 最终失败且快照 ≤60 分钟 | 快照数据 + 「数据为 N 分钟前」徽标 + 重试/回退按钮 + 琥珀光晕联动 |
| error | 最终失败且快照缺失或 >60 分钟 | 「定位失败」/「天气获取失败」+ 重试按钮；无回退按钮 |

边界情况（≥4）：

1. **首次加载即失败且无任何快照**：只有 error 态，无回退按钮，统计条摘要格走 error 样式。
2. **快照刚好 60 分钟**：按 `<= 60 分钟` 判定为 stale；61 分钟起转 error 且不展示旧数据。
3. **定位被拒但天气成功**：展示杭州数据 + 定位提示条，状态为 ok（非 stale），失败计数不增加。
4. **天气失败但定位成功**：进入 stale/error 分支，错误文案为「天气获取失败」，不回退到杭州坐标。
5. **断网后恢复**：回前台或网络恢复（`online` 事件）时若 `nextAt` 已过则立即补一次请求，成功后清零退避。
6. **快速连点刷新**：30s 节流命中 + 按钮 5s 禁用，除首次外全部不发请求。
7. **localStorage 不可用/配额溢出**：静默降级为纯内存快照，页面行为与可用时一致，仅跨刷新丢失缓存。

## 6. 非功能需求

- **性能**：同一时刻 in-flight 请求 ≤1；`weather-last-ok` 序列化 ≤500KB；新增监听器（`visibilitychange` / `blur` / `online`）随组件卸载全部移除。
- **兼容**：`AbortController` 不可用时降级为 `Promise.race` + 10s 定时器；`ResizeObserver` 降级逻辑（基线已有）保持不变；320~1024 各档不出现横向溢出，热区 ≥40px，字号 ≥12px。
- **埋点**：`weather:state` 事件带 `status / stale / failCount / reason(timeout|http|network|geo) / ts`，500ms 节流 + 签名去重；`window.__weatherStateStats` 内存计数（count / lastStatus / lastReason），不写存储。
- **（约束卡 1）防抖/节流频率控制**：刷新 30s 节流（现有）、重试与回退按钮 5s 冻结、`weather:state` 事件 500ms 节流、自动刷新退避 20/40/60 分钟、回前台补刷 5s 判定窗口；落点 `src/components/Weather.jsx` 与 `src/pages/Home.jsx`。
- **（约束卡 2）撤销/回退**：仅保留 1 级 `prevSnapshot`，回退只影响当前展示并同步覆盖 `weather-last-ok`，不提供多级历史栈；无快照时按钮不渲染；落点 `Weather.jsx` `rollback`。
- **（约束卡 3）外部 API 失败降级**：Open-Meteo 失败 → 快照 stale → 过期后 error；BigDataCloud 逆地理失败 → 静默显示"当前位置"（基线行为）；两类请求各自独立超时，单点失败不阻塞另一段；落点 `Weather.jsx` `load` / `reverseGeocode`。

## 7. 验收标准

1. **Given** 有成功数据、网络中断，**When** 自动刷新触发并 3 次重试全部失败，**Then** 卡片进入 stale 态展示上次数据 + 「数据为 N 分钟前」，统计条摘要格同步展示缓存温度与「N 分钟前」后缀。
2. **Given** 卡在 stale 态，**When** 点击「回退」，**Then** 展示立即切换为 `prevSnapshot` 数据、徽标时间刷新，且按钮变为禁用 5s。（异常分支）
3. **Given** 首次加载即失败且 `weather-last-ok` 不存在，**When** 加载结束，**Then** 渲染 error 态「天气获取失败」且不出现回退按钮。（异常）
4. **Given** 连续 3 次自动刷新失败，**When** 观察下一次请求时间，**Then** 间隔为 60 分钟；一次成功后自动刷新间隔恢复 10 分钟。
5. **Given** 30s 内已手动刷新一次，**When** 再次点击 ↻，**Then** 不发新请求，title 显示"刷新过于频繁，请稍后再试"。
6. **Given** 页面加载后未进行交互，**When** 快速连续点击刷新与重试共 6 次，**Then** 实际发出的网络请求 ≤2 个（首次 + 1 次重试）。
7. **Given** 定位被拒绝，**When** 天气请求成功，**Then** 状态为 ok、展示杭州数据与定位提示条，失败计数保持 0。（异常）
8. **Given** 快照时间戳距当前 61 分钟，**When** 请求失败，**Then** 进入 error 态而非 stale，旧数据不再渲染。（异常）
9. **Given** 页面切到后台 15 分钟，**When** 回到前台且 `nextAt` 已过，**Then** 5s 内补一次请求且仅一次，无重复请求。
10. **Given** 天气为「晴」，**When** 鼠标悬停天气卡片，**Then** MouseTrail 粒子使用 6 个晴天主题词；stale 态悬停光晕为 #d97706，恢复 ok 后回到紫色。
11. **Given** 键盘用户 Tab 到徽标行的按钮，**When** 聚焦并按 Enter，**Then** 触发回退/重试，焦点环 2px #aa3bff 可见，读屏播报 `aria-label` 内容。

## 8. 存储变更

| 键名 | 用途 | 生命周期 |
|------|------|---------|
| `weather-last-ok` | 上次成功天气快照 `{ current, daily, place, ts }`，单条覆盖写，>500KB 放弃写入，超 7 天自动清理 | 持久（localStorage） |
| `weather-auto-backoff` | 连续失败计数与下次允许刷新时间 `{ failCount, nextAt }`，成功清零，超 7 天清理 | 持久（localStorage） |

- 沿用现有 `sessionStorage` 键 `weather-geo-denied-tip`（定位提示会话标记），语义不变，不计入 localStorage 新增。
- 无其他存储键新增；内存级 `prevSnapshot`、`inFlightRef`、`__weatherStateStats` 不落盘。
