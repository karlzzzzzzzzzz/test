// 技术文档注册表
// 新增文档：把 .md 放入 src/docs/，用 Vite 的 ?raw 导入，然后在此登记一条
import promptEngineering from './prompt-engineering.md?raw'
import projectFeatures from './project-features.md?raw'
import memoryGame from './memory-game.md?raw'
import lightsoutGame from './lightsout-game.md?raw'
import connect4Game from './connect4-game.md?raw'
import lianliankanGame from './lianliankan-game.md?raw'

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
      '第 12 款小游戏的需求文档：玩法规则、点按翻转与可解性打乱、三档难度与倒计时计分、页面结构与交互、移动端适配与键盘无障碍要求、验收标准，以及最佳记录与埋点的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Puzzle'],
    readTime: '约 8 分钟',
    content: lightsoutGame,
  },
  {
    slug: 'connect4-game',
    title: '四连棋（Connect Four）需求文档与实现说明',
    summary:
      '第 13 款小游戏的需求文档：6×7 棋盘与落子重力、四方向成四判定、三档 AI（随机/1 层评估/alpha-beta 搜索）、限时 180 秒的计分规则、页面结构与交互、移动端适配与键盘无障碍要求、验收标准，以及最佳记录与埋点的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Board Game'],
    readTime: '约 9 分钟',
    content: connect4Game,
  },
  {
    slug: 'lianliankan-game',
    title: '连连看（Link-Link）需求文档与实现说明',
    summary:
      '第 14 款小游戏的需求文档：≤2 转弯连通判定（支持绕出棋盘边界）、成对牌面生成与可解性校验、提示/洗牌次数、三档难度与限时计分、页面结构与交互、移动端适配与键盘无障碍要求、验收标准，以及最佳记录与埋点的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Puzzle'],
    readTime: '约 8 分钟',
    content: lianliankanGame,
  },
]

export const getDoc = (slug) => docs.find((d) => d.slug === slug)
