/**
 * 数回（Slitherlink）引擎 — 纯逻辑，无定时器，由页面 rAF 驱动 tick。
 *
 * 核心规则：点阵网格（rows+1 × cols+1 个点），每格给一个 clue（0-3 或 null），
 * clue = 该格 4 条邻边中被画的数量；所有画的边必须形成**唯一闭合环**
 * （连通 + 每端点度数恰好为 2；允许边界端点度数 ≤ 2）。
 *
 * 数据结构：
 *   edges: 一维数组 [0..rows*(cols+1) + (rows+1)*cols - 1]
 *     前 rows*(cols+1) 是纵向边：(r, c) 和 (r+1, c) 之间，索引 = r*(cols+1) + c
 *     后 cols*(rows+1) 是横向边：(r, c) 和 (r, c+1) 之间，索引 = (rows+1)*(cols+1) + c*(rows+1) + r
 *     （或更简单：分开 horizontal / vertical 两个数组）
 *   clues: rows × cols，每格 0-3 或 null
 *
 * 反向生成：先生成简单闭合环（不自交），再数每格被环覆盖的边数作为 clue；
 * 25% clue 随机置 null（空格 = 不限），保证有解（但不一定唯一解）。
 *
 * 用法：
 *   const engine = new SlitherlinkEngine({ difficulty: 'easy', onState, onWin, onPause });
 *   engine.start();          // 随机生成关卡
 *   engine.startFrom(clues); // 外部指定关卡（每日轮换）
 *   engine.toggleEdge(idx);  // 三态循环
 *   engine.undo(); engine.hint(); engine.clear();
 *   engine.getSnapshot(); engine.restore(save);
 *   engine.pause(); engine.resume(); engine.dispose();
 */

export const SLITHER = Object.freeze({
  DIFFICULTIES: {
    easy: { rows: 5, cols: 5, label: '入门 5×5' },
    normal: { rows: 7, cols: 7, label: '进阶 7×7' },
    hard: { rows: 9, cols: 9, label: '专家 9×9' },
  },
  EDGE_NONE: 0,
  EDGE_LINE: 1,
  EDGE_CROSS: 2,
  STATE: { IDLE: 'idle', PLAYING: 'playing', PAUSED: 'paused', WON: 'won' },
  MAX_UNDO: 300,
  MAX_HINT: 3,
  SAVE_MAX_CHARS: 1024,
  SAVE_TTL_MS: 86400000, // 24h
  DAILY_CACHE_KEY: 'game-slitherlink-daily-v1',
  SAVE_KEY: 'game-slitherlink-save-v1',
  BEST_KEY: 'game-slitherlink-best-v1',
  STATS_KEY: 'game-slitherlink-stats-v1',
  POMODORO_MIN: 120,
});

export const DIFFICULTY_LIST = ['easy', 'normal', 'hard'];

/** 边索引工具：把 (r, c, orientation) 映射到 edges 数组下标 */
function edgeIdx(r, c, orient, rows, cols) {
  // orient 'v' = vertical（纵向边，(r,c)-(r+1,c)）
  // orient 'h' = horizontal（横向边，(r,c)-(r,c+1)）
  if (orient === 'v') return r * (cols + 1) + c;
  // horizontal 在纵向边之后
  return rows * (cols + 1) + c * (rows + 1) + r;
}

/** edgeIdx → (r, c, orient) 反向
 * 纵向边：r ∈ [0, rows-1], c ∈ [0, cols]，两个端点 (r,c) - (r+1,c)
 * 横向边：c ∈ [0, cols-1], r ∈ [0, rows]，两个端点 (r,c) - (r,c+1)
 * 索引总顺序：先 rows*(cols+1) 条纵向边，再 (rows+1)*cols 条横向边。
 */
function edgePos(idx, rows, cols) {
  const totalV = rows * (cols + 1);
  if (idx < totalV) {
    const r = Math.floor(idx / (cols + 1));
    const c = idx - r * (cols + 1);
    return { r, c, orient: 'v', p1: [r, c], p2: [r + 1, c] };
  }
  const h = idx - totalV;
  // 横向边：先按 c 分组（每组 rows+1 条），再按 r 组内偏移
  const c = Math.floor(h / (rows + 1));
  const r = h - c * (rows + 1);
  return { r, c, orient: 'h', p1: [r, c], p2: [r, c + 1] };
}

/** 某格 (gr, gc) 的 4 条边索引（左上点格坐标） */
function cellEdges(gr, gc, rows, cols) {
  return [
    edgeIdx(gr, gc, 'h', rows, cols),        // 上边
    edgeIdx(gr, gc + 1, 'h', rows, cols),    // 下边
    edgeIdx(gr, gc, 'v', rows, cols),        // 左边
    edgeIdx(gr + 1, gc, 'v', rows, cols),    // 右边
  ];
}

/** 反向生成：随机走一条不自交的闭合环，返回画边集合 Set */
function generateSimpleLoop(rows, cols, maxRetries = 50) {
  const MAX_STEPS = Math.min(rows * cols * 2, 80);

  // 方向表：[dc, dr, dir]（0=上,1=右,2=下,3=左）
  const DIRS = [[0, -1, 0], [1, 0, 1], [0, 1, 2], [-1, 0, 3]];

  function edgeIndexForMove(r, c, dir) {
    // dir 0/2（上下）→ 纵向边 orient 'v'
    // dir 1/3（左右）→ 横向边 orient 'h'
    const orient = dir === 0 || dir === 2 ? 'v' : 'h';
    if (orient === 'v') {
      // 纵向边在点 (r,c) 与 (r+1,c) 之间；从 dir 0(上) 或 dir 2(下) 进入
      // dir 2(下)：从 (r,c) 走到 (r+1,c) → 边 (r, c, 'v')
      // dir 0(上)：从 (r,c) 走到 (r-1,c) → 边 (r-1, c, 'v')
      const er = dir === 2 ? r : r - 1;
      return edgeIdx(er, c, 'v', rows, cols);
    } else {
      // 横向边在点 (r,c) 与 (r,c+1) 之间
      // dir 1(右)：从 (r,c) 走到 (r,c+1) → 边 (r, c, 'h')
      // dir 3(左)：从 (r,c) 走到 (r,c-1) → 边 (r, c-1, 'h')
      const ec = dir === 1 ? c : c - 1;
      return edgeIdx(r, ec, 'h', rows, cols);
    }
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const startR = 1 + Math.floor(Math.random() * (rows - 1));
    const startC = 1 + Math.floor(Math.random() * (cols - 1));
    let [r, c] = [startR, startC];
    let lastDir = -1;
    const path = [];
    const reached = new Set(); // 已访问的点（key = "r,c"）

    for (let step = 0; step < MAX_STEPS; step++) {
      reached.add(`${r},${c}`);
      const candidates = [];

      for (const [dc, dr, dir] of DIRS) {
        if ((dir + 2) % 4 === lastDir) continue; // 不能立刻掉头
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr > rows || nc < 0 || nc > cols) continue;
        const ei = edgeIndexForMove(r, c, dir);
        if (path.includes(ei)) continue; // 已走边

        // 判断是否回到起点：步数≥8 + 到达起点 → 成功闭合
        if (nr === startR && nc === startC && path.length >= 6) {
          path.push(ei);
          break; // 成功闭合
        }
        // 不能走到已访问点（除了回到起点的情况已单独处理）
        if (reached.has(`${nr},${nc}`)) continue;
        candidates.push({ nr, nc, dir, ei });
      }

      if (path.length >= 6 && path[path.length - 1] === edgeIndexForMove(r, c, -1)) {
        // 上一轮 break 了，闭合成功
        break;
      }

      if (candidates.length === 0) break; // 死胡同
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      path.push(pick.ei);
      r = pick.nr;
      c = pick.nc;
      lastDir = pick.dir;
    }

    // 验证闭合：path 最后一条边的终点应该是起点
    if (path.length >= 6) {
      const lastIdx = path[path.length - 1];
      const ep = edgePos(lastIdx, rows, cols);
      // path 最后一条边是从 (r,c) 出发走 dir 画的；终点应该是 start
      // 我们从 (r,c) 走 dir 到达的点 = (r+dr, c+dc) 其中 dr/dc 是 lastDir 对应的
      const lastMove = DIRS.find((d) => (d[2] + 2) % 4 === lastDir) || DIRS[lastDir];
      // 等下更简单：用 edgePos 的两个端点，一个是当前 (r,c)，一个是下一个点
      // path 是 push 顺序：从 startPos 出发，第1步边连接 startPos 和点1；第2步连接点1和点2...
      // 所以 path 最后一条边连接的是当前点和起点
      const k1 = `${ep.p1[0]},${ep.p1[1]}`;
      const k2 = `${ep.p2[0]},${ep.p2[1]}`;
      if ((k1 === `${startR},${startC}` && k2 === `${r},${c}`) ||
          (k2 === `${startR},${startC}` && k1 === `${r},${c}`)) {
        // 不自交验证：端点度数
        const degree = new Map();
        for (const ei of path) {
          const e2 = edgePos(ei, rows, cols);
          const kk1 = `${e2.p1[0]},${e2.p1[1]}`;
          const kk2 = `${e2.p2[0]},${e2.p2[1]}`;
          degree.set(kk1, (degree.get(kk1) || 0) + 1);
          degree.set(kk2, (degree.get(kk2) || 0) + 1);
        }
        let ok = true;
        for (const [k, d] of degree) {
          const [pr, pc] = k.split(',').map(Number);
          const isBoundary = pr === 0 || pr === rows || pc === 0 || pc === cols;
          if (isBoundary && d > 2) { ok = false; break; }
          if (!isBoundary && d !== 2) { ok = false; break; }
        }
        if (ok) {
          return new Set(path);
        }
      }
    }
  }
  return null;
}

/** 从画边集合反推 clue（clue ∈ {0,1,2,3} 或 null） */
function buildCluesFromLoop(lines, rows, cols, nullRatio = 0.25) {
  const clues = [];
  for (let r = 0; r < rows; r++) {
    clues[r] = [];
    for (let c = 0; c < cols; c++) {
      const eids = cellEdges(r, c, rows, cols);
      let count = 0;
      for (const ei of eids) if (lines.has(ei)) count++;
      // 数回 clue 不允许 4（0-3 或 null）
      if (count > 3) count = 3;
      clues[r][c] = count;
    }
  }
  // 随机置 null
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() < nullRatio) clues[r][c] = null;
    }
  }
  return clues;
}

/** 简单关卡池（反向生成失败时的降级） */
const FALLBACK_LEVELS = [
  // 5×5 预设关卡（clues 数组）
  { rows: 5, cols: 5, clues: [
    [1, 1, null, 2, 1],
    [null, null, null, null, 1],
    [2, null, 3, null, 2],
    [1, null, null, null, null],
    [1, 2, null, 2, 1],
  ] },
  { rows: 7, cols: 7, clues: [
    [null, 2, null, 1, null, 2, null],
    [1, null, 2, null, 3, null, 1],
    [null, 3, null, null, null, 1, null],
    [null, null, null, 2, null, null, null],
    [null, 2, null, null, null, 3, null],
    [1, null, 1, null, 2, null, 1],
    [null, 2, null, 1, null, 2, null],
  ] },
  { rows: 9, cols: 9, clues: [
    [null, null, 2, null, 1, null, 2, null, null],
    [null, 2, null, null, null, null, null, 2, null],
    [2, null, null, 2, null, 2, null, null, 2],
    [null, null, 2, null, 1, null, 2, null, null],
    [1, null, null, 1, null, 1, null, null, 1],
    [null, null, 2, null, 1, null, 2, null, null],
    [2, null, null, 2, null, 2, null, null, 2],
    [null, 2, null, null, null, null, null, 2, null],
    [null, null, 2, null, 1, null, 2, null, null],
  ] },
];

/** 通关判定：所有 clue 匹配 + 所有画边构成单一闭合环 */
function checkWin(edges, clues, rows, cols) {
  // 1. clue 匹配
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (clues[r][c] === null) continue;
      let count = 0;
      for (const ei of cellEdges(r, c, rows, cols)) if (edges[ei] === SLITHER.EDGE_LINE) count++;
      if (count !== clues[r][c]) return { won: false, reason: 'clue-mismatch' };
    }
  }

  // 2. 提取画边
  const lines = [];
  for (let i = 0; i < edges.length; i++) if (edges[i] === SLITHER.EDGE_LINE) lines.push(i);
  if (lines.length < 4) return { won: false, reason: 'too-few-lines' };

  // 3. 端点度数检查
  const degree = new Map();
  for (const ei of lines) {
    const ep = edgePos(ei, rows, cols);
    const k1 = `${ep.p1[0]},${ep.p1[1]}`;
    const k2 = `${ep.p2[0]},${ep.p2[1]}`;
    degree.set(k1, (degree.get(k1) || 0) + 1);
    degree.set(k2, (degree.get(k2) || 0) + 1);
  }
  for (const [k, d] of degree) {
    const [pr, pc] = k.split(',').map(Number);
    const isBoundary = pr === 0 || pr === rows || pc === 0 || pc === cols;
    if (!isBoundary && d !== 2) return { won: false, reason: `degree-mismatch-${k}-${d}` };
    if (isBoundary && d > 2) return { won: false, reason: `degree-mismatch-boundary-${k}` };
  }

  // 4. 连通性（单一环）
  const adj = new Map(); // key = "r,c" → neighbors Set
  for (const ei of lines) {
    const ep = edgePos(ei, rows, cols);
    const k1 = `${ep.p1[0]},${ep.p1[1]}`;
    const k2 = `${ep.p2[0]},${ep.p2[1]}`;
    if (!adj.has(k1)) adj.set(k1, new Set());
    if (!adj.has(k2)) adj.set(k2, new Set());
    adj.get(k1).add(k2);
    adj.get(k2).add(k1);
  }
  const allNodes = [...adj.keys()];
  if (allNodes.length === 0) return { won: false, reason: 'no-nodes' };
  // BFS 从第一个节点出发
  const visited = new Set([allNodes[0]]);
  const queue = [allNodes[0]];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of adj.get(cur)) {
      if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
    }
  }
  if (visited.size !== allNodes.length) return { won: false, reason: 'multi-loop' };

  return { won: true };
}

export default class SlitherlinkEngine {
  constructor({ difficulty = 'easy', rows, cols, clues, onState, onWin, onPause } = {}) {
    const dims = rows && cols ? { rows, cols } : SLITHER.DIFFICULTIES[difficulty] || SLITHER.DIFFICULTIES.easy;
    this._rows = dims.rows;
    this._cols = dims.cols;
    this._difficulty = difficulty;
    this._edgesTotal = this._rows * (this._cols + 1) + this._cols * (this._rows + 1);

    this._edges = new Array(this._edgesTotal).fill(SLITHER.EDGE_NONE);
    this._clues = clues ? clues.map((r) => [...r]) : [];
    this._undo = []; // 每次变更入栈：[{ ei, prev }]
    this._moves = 0;
    this._state = SLITHER.STATE.IDLE;
    this._hintLeft = SLITHER.MAX_HINT;
    this._hasDaily = false;

    this.onState = onState || null;
    this.onWin = onWin || null;
    this.onPause = onPause || null;
  }

  /** 随机生成关卡：反向生成简单闭合环 → 反推 clue */
  start() {
    let lines = generateSimpleLoop(this._rows, this._cols);
    if (!lines) {
      // 降级到预设关卡
      const fb = FALLBACK_LEVELS.find((l) => l.rows === this._rows && l.cols === this._cols);
      if (fb) this._clues = fb.clues.map((r) => [...r]);
      lines = new Set(); // 预设关卡我们不知道解，所以 clues 由预设决定，lines 留空
    } else {
      this._clues = buildCluesFromLoop(lines, this._rows, this._cols, 0.25);
    }
    this._edges.fill(SLITHER.EDGE_NONE);
    this._undo = [];
    this._moves = 0;
    this._hintLeft = SLITHER.MAX_HINT;
    this._state = SLITHER.STATE.PLAYING;
    this._emitState();
  }

  /** 外部指定 clues（每日关卡轮换） */
  startFrom(clues) {
    this._clues = clues.map((r) => [...r]);
    this._edges.fill(SLITHER.EDGE_NONE);
    this._undo = [];
    this._moves = 0;
    this._hintLeft = SLITHER.MAX_HINT;
    this._state = SLITHER.STATE.PLAYING;
    this._hasDaily = true;
    this._emitState();
  }

  get difficulty() { return this._difficulty; }
  get rows() { return this._rows; }
  get cols() { return this._cols; }
  get clues() { return this._clues; }
  get edges() { return this._edges; }
  get state() { return this._state; }
  get moves() { return this._moves; }
  get hintLeft() { return this._hintLeft; }

  /** 点击边：三态循环 none→line→cross→none */
  toggleEdge(idx) {
    if (this._state !== SLITHER.STATE.PLAYING) return false;
    if (idx < 0 || idx >= this._edgesTotal) return false;
    const prev = this._edges[idx];
    const next = (prev + 1) % 3;
    this._edges[idx] = next;
    this._undo.push({ idx, prev, next });
    if (this._undo.length > SLITHER.MAX_UNDO) this._undo.shift();
    this._moves++;

    const result = checkWin(this._edges, this._clues, this._rows, this._cols);
    if (result.won) {
      this._state = SLITHER.STATE.WON;
      this._emitState();
      if (this.onWin) this.onWin({ reason: 'solved', moves: this._moves });
      return true;
    }
    this._emitState();
    return true;
  }

  undo() {
    if (this._state !== SLITHER.STATE.PLAYING) return false;
    if (!this._undo.length) return false;
    const last = this._undo.pop();
    this._edges[last.idx] = last.prev;
    if (this._moves > 0) this._moves--;
    this._emitState();
    return true;
  }

  /** 提示：找一个当前 clue 不匹配的格子，揭示一条正确边的状态 */
  hint() {
    if (this._state !== SLITHER.STATE.PLAYING) return false;
    if (this._hintLeft <= 0) return false;

    // 收集 clue 不匹配的格子
    const conflicts = [];
    for (let r = 0; r < this._rows; r++) {
      for (let c = 0; c < this._cols; c++) {
        if (this._clues[r][c] === null) continue;
        let count = 0;
        for (const ei of cellEdges(r, c, this._rows, this._cols)) if (this._edges[ei] === SLITHER.EDGE_LINE) count++;
        if (count !== this._clues[r][c]) conflicts.push({ r, c, expected: this._clues[r][c], actual: count });
      }
    }
    // 选一个冲突格子，随机揭示一条正确边（用简单策略：期望 - 当前 = 还差几个 → 先不画的边里选一个画）
    if (conflicts.length) {
      const pick = conflicts[Math.floor(Math.random() * conflicts.length)];
      const eids = cellEdges(pick.r, pick.c, this._rows, this._cols);
      const missing = pick.expected - pick.actual; // 还差几条 line
      const noneEdges = eids.filter((ei) => this._edges[ei] === SLITHER.EDGE_NONE || this._edges[ei] === SLITHER.EDGE_CROSS);
      if (noneEdges.length && missing > 0) {
        const target = noneEdges[Math.floor(Math.random() * noneEdges.length)];
        if (this._edges[target] !== SLITHER.EDGE_LINE) {
          const prev = this._edges[target];
          this._edges[target] = SLITHER.EDGE_LINE;
          this._undo.push({ idx: target, prev, next: SLITHER.EDGE_LINE });
          this._moves++;
          this._hintLeft--;
          this._emitState();
          return true;
        }
      }
    }
    return false;
  }

  clear() {
    if (this._state !== SLITHER.STATE.PLAYING) return false;
    this._edges.fill(SLITHER.EDGE_NONE);
    this._undo = [];
    this._moves = 0;
    this._emitState();
    return true;
  }

  /** 实时冲突格（供 UI 红色标记） */
  getConflicts() {
    const conflicts = [];
    for (let r = 0; r < this._rows; r++) {
      for (let c = 0; c < this._cols; c++) {
        if (this._clues[r][c] === null) continue;
        let count = 0;
        for (const ei of cellEdges(r, c, this._rows, this._cols)) if (this._edges[ei] === SLITHER.EDGE_LINE) count++;
        if (count !== this._clues[r][c]) conflicts.push({ r, c, expected: this._clues[r][c], actual: count });
      }
    }
    return conflicts;
  }

  pause() {
    if (this._state !== SLITHER.STATE.PLAYING) return;
    this._state = SLITHER.STATE.PAUSED;
    this._emitState();
    if (this.onPause) this.onPause({ reason: 'manual' });
  }

  resume() {
    if (this._state !== SLITHER.STATE.PAUSED) return;
    this._state = SLITHER.STATE.PLAYING;
    this._emitState();
  }

  _emitState() {
    if (this.onState) this.onState({ state: this._state, moves: this._moves, hintLeft: this._hintLeft });
  }

  dispose() {
    this.onState = null;
    this.onWin = null;
    this.onPause = null;
  }

  /** 存档序列化（0=none/1=line/2=cross 连续字符串） */
  getSnapshot() {
    return {
      v: 1,
      difficulty: this._difficulty,
      rows: this._rows,
      cols: this._cols,
      clues: this._clues.map((r) => r.map((x) => x === null ? '-' : String(x))).join('|'),
      edges: this._edges.join(''),
      moves: this._moves,
      hintLeft: this._hintLeft,
      ts: Date.now(),
    };
  }

  restore(save) {
    if (!save || save.v !== 1) return false;
    if (save.rows !== this._rows || save.cols !== this._cols) return false;
    if (save.edges && save.edges.length !== this._edgesTotal) return false;
    const clues = save.clues.split('|').map((row) => row.split('').map((c) => c === '-' ? null : Number(c)));
    this._clues = clues;
    this._edges = save.edges.split('').map((c) => Number(c));
    this._moves = Number(save.moves) || 0;
    this._hintLeft = Math.min(Number(save.hintLeft) || SLITHER.MAX_HINT, SLITHER.MAX_HINT);
    this._state = SLITHER.STATE.PAUSED;
    this._undo = [];
    this._emitState();
    return true;
  }
}

/** 存档校验器 */
export function validateSlitherlinkSave(save) {
  if (!save || typeof save !== 'object') return false;
  if (save.v !== 1) return false;
  if (!['easy', 'normal', 'hard'].includes(save.difficulty)) return false;
  if (typeof save.rows !== 'number' || typeof save.cols !== 'number') return false;
  const totalE = save.rows * (save.cols + 1) + save.cols * (save.rows + 1);
  if (typeof save.edges !== 'string' || save.edges.length !== totalE) return false;
  if (!/^[012]+$/.test(save.edges)) return false;
  return true;
}

// 工具导出（供测试）
export const _slitherTest = { edgeIdx, edgePos, cellEdges, checkWin, generateSimpleLoop, buildCluesFromLoop, FALLBACK_LEVELS };
