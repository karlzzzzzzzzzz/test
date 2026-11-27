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
import sudokuGame from './sudoku-game.md?raw'
import gomokuGame from './gomoku-game.md?raw'
import nonogramGame from './nonogram-game.md?raw'
import checkersGame from './checkers-game.md?raw'
import oneStrokeGame from './one-stroke-game.md?raw'
import match3Game from './match3-game.md?raw'
import lifeGame from './life-game.md?raw'
import hanoiGame from './hanoi-game.md?raw'
import pianoTiles from './piano-tiles.md?raw'
import slitherlink from './slitherlink.md?raw'
import ticTacToe from './tic-tac-toe.md?raw'
import simonSays from './simon-says.md?raw'
import bubbleShooter from './bubble-shooter.md?raw'

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
  {
    slug: 'sudoku-game',
    title: '数独（Sudoku）需求文档',
    summary:
      '第 15 款小游戏的需求文档：9×9 回溯生成与唯一解复核、三档挖空与限时判负、错误 3 次判负与提示/撤销/笔记、数字面板主输入与 320px 热区策略、六屏状态机与双路暂停盘面遮蔽、一言通关寄语降级、每日挑战轮换池 11→16 款联动修正，以及三个 localStorage 键的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Puzzle'],
    readTime: '约 9 分钟',
    content: sudokuGame,
  },
  {
    slug: 'gomoku-game',
    title: '五子棋（Gomoku）需求文档',
    summary:
      '第 16 款小游戏的需求文档：15×15 棋盘、横/竖/两斜线四向成五判定、单人 AI（随机/启发式/α-β 深度 4）+ 双人本地对战、回合计时与悔棋栈、六屏状态机、番茄钟「今日」统计口径修正联动（新增 pomodoro-sessions-v1 session 数组）、AI 超时回退与 3 个 localStorage 键的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Board Game'],
    readTime: '约 10 分钟',
    content: gomokuGame,
  },
  {
    slug: 'nonogram-game',
    title: '数织（Nonogram）需求文档',
    summary:
      '第 18 款小游戏的需求文档：行列提示推理、填格/叉格循环标记、三档难度（5×5 / 10×10 / 15×15）、每局 3 次提示与撤销栈、行列提示匹配式胜利判定（支持多解）、进度自动保存与 24h 恢复、键盘无障碍与切后台自动暂停、3 个 localStorage 键的容量策略。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Puzzle'],
    readTime: '约 11 分钟',
    content: nonogramGame,
  },
  {
    slug: 'checkers-game',
    title: '跳棋（Checkers）需求文档',
    summary:
      '第 19 款小游戏的需求文档：8×8 西洋跳棋、强制吃子与连跳、底线升王、无子/无着法判负与长局面判和、三档 AI（随机/两层/四层 α-β）、每日残局（权威日期 + 失败降级本地）、落子 300ms 与刷新 30s 节流、键盘无障碍与双路暂停、2 个 localStorage 键的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Board Game'],
    readTime: '约 10 分钟',
    content: checkersGame,
  },
  {
    slug: 'one-stroke-game',
    title: '一笔画（One Stroke）需求文档',
    summary:
      '第 20 款小游戏的需求文档：网格欧拉路径、每条边恰好走一次、三档手工关卡与关卡可解性校验、每日关卡（权威日期 + 失败降级）、加载/空/错误三态、撤销与重置、键盘无障碍，以及 3 个 localStorage 键的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Puzzle'],
    readTime: '约 9 分钟',
    content: oneStrokeGame,
  },
  {
    slug: 'match3-game',
    title: '消消乐（Match 3）需求文档',
    summary:
      '第 21 款小游戏的需求文档：8×8 三消判定、连锁下落与倍增计分、三档限步目标分、无解自动重排、局中存档（≤4KB / 24h TTL / 即时清理）、埋点脏标记 + 1s 防抖 + pagehide 落盘、键盘无障碍，以及 3 个 localStorage 键的存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Puzzle'],
    readTime: '约 9 分钟',
    content: match3Game,
  },
  {
    slug: 'life-game',
    title: '生命游戏（Game of Life）需求文档',
    summary:
      '第 22 款小游戏的需求文档：40×24 网格 B3/S23 演化、环绕/固定边界、7 种内置图案与 RLE 导入（加载/空/错误/成功四态）、四档速度与画布编辑、切后台双路自动暂停、埋点脏标记 + 1s 防抖 + pagehide 落盘，以及统计存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Simulation'],
    readTime: '约 9 分钟',
    content: lifeGame,
  },
  {
    slug: 'hanoi-game',
    title: '汉诺塔（Tower of Hanoi）需求文档',
    summary:
      '第 23 款小游戏的需求文档：3~8 盘六档难度、三柱点选 / 键盘操作、2^n-1 最优步数计分、撤销与失误统计、24h 本地进度存档（≤4096 字符、坏档清理）、移动端整柱触控与窄屏适配，以及统计存储设计。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Puzzle'],
    readTime: '约 9 分钟',
    content: hanoiGame,
  },
  {
    slug: 'piano-tiles',
    title: '钢琴块（Piano Tiles）需求文档',
    summary:
      '第 24 款小游戏的需求文档：4 轨道黑块连续下落、底部判定线点中得分、点白 / 漏点结束、速度随得分递增、双路自动暂停与恢复不跳帧、24h 本地进度存档（≤4096 字符、坏档清理）、埋点脏标记 + 1s 防抖 + pagehide 落盘，以及统计与番茄钟联动。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Arcade'],
    readTime: '约 9 分钟',
    content: pianoTiles,
  },
  {
    slug: 'slitherlink',
    title: '数回（Slitherlink）需求文档',
    summary:
      '第 25 款小游戏的需求文档：点阵网格逻辑谜题，每格 clue 为 0-3 的边数约束，所有画边必须形成单一闭合环；三态边标记、撤销、提示、每日关卡轮换（timeapi.io + 降级池）、双路自动暂停、24h 本地进度存档、埋点防抖与番茄钟联动。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Puzzle'],
    readTime: '约 10 分钟',
    content: slitherlink,
  },
  {
    slug: 'tic-tac-toe',
    title: '井字棋（Tic-Tac-Toe）需求文档',
    summary:
      '第 26 款小游戏的需求文档：3×3 / 4×4 人机对战，Minimax AI 三档难度（easy 随机/normal Minimax + 10% 随机/hard Minimax 全胜率）；完整撤销栈、双路自动暂停、24h 本地进度存档、分档最佳记录、每日 API 种子、番茄钟联动。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Board'],
    readTime: '约 8 分钟',
    content: ticTacToe,
  },
  {
    slug: 'simon-says',
    title: '西蒙记忆（Simon Says）需求文档',
    summary:
      '第 27 款小游戏的需求文档：四色按钮序列逐轮加长，rAF 驱动回放时钟，3 点生命与节奏加速曲线；键盘 1-4 与触控双操作、aria-live 无障碍播报、双路自动暂停、24h 进度存档、埋点统计与番茄钟联动。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Memory'],
    readTime: '约 8 分钟',
    content: simonSays,
  },
  {
    slug: 'bubble-shooter',
    title: '泡泡龙（Bubble Shooter）需求文档',
    summary:
      '第 28 款小游戏的需求文档：8 列蜂窝盘面角度发射、同色 3 连消除与悬空气泡坠落、每 8 发顶部下压一行；Canvas 2D 按需重绘、瞄准 40ms 节流、双路自动暂停、24h 进度存档、埋点统计与番茄钟联动。',
    date: '2026-11',
    tags: ['Game', 'PRD', 'Arcade'],
    readTime: '约 9 分钟',
    content: bubbleShooter,
  },
]

export const getDoc = (slug) => docs.find((d) => d.slug === slug)
