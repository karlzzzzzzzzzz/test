// 技术文档注册表
// 新增文档：把 .md 放入 src/docs/，用 Vite 的 ?raw 导入，然后在此登记一条
import promptEngineering from './prompt-engineering.md?raw'
import projectFeatures from './project-features.md?raw'
import memoryGame from './memory-game.md?raw'
import lightsoutGame from './lightsout-game.md?raw'
import connect4Game from './connect4-game.md?raw'
import lianliankanGame from './lianliankan-game.md?raw'
import sokobanGame from './sokoban-game.md?raw'
import reversiGame from './reversi-game.md?raw'
import minesweeperGame from './minesweeper-game.md?raw'
import mazeGame from './maze-game.md?raw'
import dailyChallenge from './daily-challenge.md?raw'
import weatherRobustness from './weather-robustness.md?raw'

export const docs = [
  {
    slug: 'project-features',
    title: '项目功能详细说明（基线文档）',
    summary:
      '当前项目已实现功能的基线描述：技术栈、路由、全部页面与组件的功能明细、数据存储、已知不一致点，用于后续需求文档生成时做增量对比。',
    date: '2026-10',
    tags: ['基线', '需求', '全项目'],
    readTime: '约 12 分钟',
    content: projectFeatures,
  },
  {
    slug: 'prompt-engineering',
    title: '提示词工程（Prompt Engineering）学习与使用文档',
    summary:
      '面向互联网从业者的大模型提示词工程实战指南：ICIO/RTF 等框架、思维链/ReAct/思维树、上下文工程、提示词安全，以及产品、运营、开发等 7 个岗位实战模板。',
    date: '2026-09',
    tags: ['AI', 'Prompt', 'LLM'],
    readTime: '约 25 分钟',
    content: promptEngineering,
  },
  {
    slug: 'memory-game',
    title: '记忆翻牌：可访问性小游戏实现笔记',
    summary:
      '为纯键盘用户与读屏用户设计的记忆配对小游戏实现要点：玩法与计分公式、role=grid + roving tabindex + aria-live polite 的无障碍方案、localStorage 存储结构与降级行为。',
    date: '2026-10',
    tags: ['Game', 'A11y', 'React'],
    readTime: '约 6 分钟',
    content: memoryGame,
  },
  {
    slug: 'lightsout-game',
    title: '关灯挑战（Lights Out）需求文档与实现说明',
    summary:
      '第 8 款小游戏的需求文档：玩法规则、点按翻转与可解性打乱、三档难度与倒计时计分、页面结构与交互、移动端适配与键盘无障碍要求、验收标准，以及最佳记录与埋点的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Puzzle'],
    readTime: '约 8 分钟',
    content: lightsoutGame,
  },
  {
    slug: 'connect4-game',
    title: '四连棋（Connect Four）需求文档与实现说明',
    summary:
      '第 9 款小游戏的需求文档：6×7 棋盘与落子重力、四方向成四判定、三档 AI（随机/1 层评估/alpha-beta 搜索）、限时 180 秒的计分规则、页面结构与交互、移动端适配与键盘无障碍要求、验收标准，以及最佳记录与埋点的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Board Game'],
    readTime: '约 9 分钟',
    content: connect4Game,
  },
  {
    slug: 'lianliankan-game',
    title: '连连看（Link-Link）需求文档与实现说明',
    summary:
      '第 10 款小游戏的需求文档：≤2 转弯连通判定（支持绕出棋盘边界）、成对牌面生成与可解性校验、提示/洗牌次数、三档难度与限时计分、页面结构与交互、移动端适配与键盘无障碍要求、验收标准，以及最佳记录与埋点的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Puzzle'],
    readTime: '约 8 分钟',
    content: lianliankanGame,
  },
  {
    slug: 'sokoban-game',
    title: '推箱子（Sokoban）需求文档与实现说明',
    summary:
      '第 11 款小游戏的需求文档：12 个手工关卡与三档限时、网格推箱与目标点判定、无限撤销与重开、计分公式、四态页面与双路暂停、触控/键盘无障碍、一言通关寄语降级，以及三个 localStorage 键的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Puzzle'],
    readTime: '约 9 分钟',
    content: sokobanGame,
  },
  {
    slug: 'reversi-game',
    title: '黑白棋（Reversi）需求文档与实现说明',
    summary:
      '第 12 款小游戏的需求文档：8×8 棋盘夹吃翻转、合法位提示、对手无子自动跳过、终局计子、三档 AI（随机/贪心/alpha-beta 深度 3）、180 秒限时与计分公式、四态页面与双路暂停、键盘与 aria 无障碍，以及两个 localStorage 键的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Board Game'],
    readTime: '约 9 分钟',
    content: reversiGame,
  },
  {
    slug: 'minesweeper-game',
    title: '扫雷（Minesweeper）需求文档与实现说明',
    summary:
      '第 13 款小游戏的需求文档：7×7 / 8×8 / 8×10 三档雷区、首点安全布雷、数字提示与空白格洪泛展开、触屏标记插旗、撤销最多 3 次、180 秒限时与计分公式、四态页面与双路暂停、键盘与 aria 无障碍，以及两个 localStorage 键的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Puzzle'],
    readTime: '约 9 分钟',
    content: minesweeperGame,
  },
  {
    slug: 'maze-game',
    title: '迷宫寻路（Maze）需求文档与实现说明',
    summary:
      '第 14 款小游戏的需求文档：DFS 回溯生成保证全连通的完美迷宫、BFS 最短路作参考步数、四方向移动与 60ms 节流、3 次提示与扣分、三档尺寸与限时计分、加载/空/错误三态、四态页面与双路暂停、触控滑动与键盘无障碍，以及两个 localStorage 键的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Puzzle'],
    readTime: '约 9 分钟',
    content: mazeGame,
  },
  {
    slug: 'daily-challenge',
    title: '首页「今日游戏挑战」需求文档与实现说明',
    summary:
      '首页新增每日挑战区块的需求文档：按日期确定性从 11 款小游戏轮换一款（连续两天不重复）、一言 API 今日一句（10s 超时 + 本地降级池）、加载/成功/降级三态、切后台暂停换日检查、键盘与 aria 无障碍，以及两个 localStorage 键的存储设计。',
    date: '2026-11',
    tags: ['首页', 'Daily', 'A11y'],
    readTime: '约 8 分钟',
    content: dailyChallenge,
  },
  {
    slug: 'weather-robustness',
    title: '首页本地天气卡片 请求链路健壮性与失败回退 需求文档',
    summary:
      '天气卡片健壮性需求文档：AbortController 10s 超时与并发去重、最多 2 次退避重试、上次成功快照的 stale 降级态（60 分钟有效）、1 级回退与重试按钮 5s 冻结、自动刷新 20/40/60 分钟指数退避、切后台双路暂停、首页统计条 stale 摘要格与 MouseTrail 天气词库联动，以及两个 localStorage 键的存储设计。',
    date: '2026-11',
    tags: ['首页', '天气', '健壮性'],
    readTime: '约 9 分钟',
    content: weatherRobustness,
  },
]

export const getDoc = (slug) => docs.find((d) => d.slug === slug)
