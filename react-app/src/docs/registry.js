// 技术文档注册表
// 新增文档：把 .md 放入 src/docs/，用 Vite 的 ?raw 导入，然后在此登记一条
import promptEngineering from './prompt-engineering.md?raw'
import projectFeatures from './project-features.md?raw'
import memoryGame from './memory-game.md?raw'

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
]

export const getDoc = (slug) => docs.find((d) => d.slug === slug)
