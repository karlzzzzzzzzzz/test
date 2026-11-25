/**
 * 井字棋（Tic-Tac-Toe）引擎 — 纯逻辑，同步执行 AI，页面 rAF 驱动计时。
 *
 * 三档 AI：
 *   easy:   随机空位（至少 10% 非最优）
 *   normal: Minimax + alpha-beta，10% 概率退回随机（制造破绽）
 *   hard:   Minimax + alpha-beta 全胜率
 *
 * Minimax 深度限制：3×3 无限制（最多 9 层），4×4 5 层上限防组合爆炸。
 *
 * 撤销栈：玩家每次 play 入栈 { row, col, player }；AI 落子也入栈。
 *         undo() 弹出两步（玩家 + AI），栈 < 2 时只弹 1 步（AI 先手场景）。
 *
 * 外部 API 种子：date-seed 用于 normal 难度随机扰动判断；失败降级 Math.random()。
 */

export const TTT = Object.freeze({
  DIFFICULTIES: {
    easy:   { label: '简单（随机）',     ai: 'random' },
    normal: { label: '中等（Minimax + 10% 随机）', ai: 'minimax-random' },
    hard:   { label: '困难（Minimax 全胜率）',       ai: 'minimax' },
  },
  SIZES: {
    3: { label: '3×3', },
    4: { label: '4×4', },
  },
  PLAYER: 'X',
  AI: 'O',
  STATE: { IDLE: 'idle', PLAYING: 'playing', PAUSED: 'paused', WON: 'won', DRAW: 'draw' },
  MAX_UNDO: 100,
  SAVE_MAX_CHARS: 4096,
  SAVE_TTL_MS: 86400000,
  SAVE_KEY: 'game-ttt-save-v1',
  BEST_KEY: 'game-ttt-best-v1',
  STATS_KEY: 'game-ttt-stats-v1',
  POMODORO_MIN: 120,
});

/** 预计算所有胜利线（rows × cols 棋盘的行 / 列 / 对角 / 反对角） */
function allWinLines(size) {
  const lines = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) row.push([r, c]);
    lines.push(row);
  }
  for (let c = 0; c < size; c++) {
    const col = [];
    for (let r = 0; r < size; r++) col.push([r, c]);
    lines.push(col);
  }
  const diag = [];
  for (let i = 0; i < size; i++) diag.push([i, i]);
  lines.push(diag);
  const adiag = [];
  for (let i = 0; i < size; i++) adiag.push([i, size - 1 - i]);
  lines.push(adiag);
  return lines;
}

export default class TicTacToeEngine {
  constructor({ size = 3, difficulty = 'hard', playerSide = 'X', onState, onGameOver, onPause } = {}) {
    this.size = size === 4 ? 4 : 3;
    this.difficulty = difficulty;
    this.playerSide = playerSide === 'O' ? 'O' : 'X';
    this.aiSide = this.playerSide === 'X' ? 'O' : 'X';
    this._winLines = allWinLines(this.size);

    this._board = Array.from({ length: this.size }, () => Array(this.size).fill(null));
    this._current = 'X';
    this._undo = [];
    this._moves = 0;
    this._state = TTT.STATE.IDLE;
    this._winner = null;
    this._winLine = null;
    this._aiThinking = false;

    this.onState = onState || null;
    this.onGameOver = onGameOver || null;
    this.onPause = onPause || null;
  }

  get state() { return this._state; }
  get board() { return this._board; }
  get currentPlayer() { return this._current; }
  get moves() { return this._moves; }
  get isAIThinking() { return this._aiThinking; }

  /** 开局 */
  start() {
    this._board = Array.from({ length: this.size }, () => Array(this.size).fill(null));
    this._undo = [];
    this._moves = 0;
    this._winner = null;
    this._winLine = null;
    this._current = 'X'; // X 先手（规则统一：X 先手）
    this._state = TTT.STATE.PLAYING;

    // 若玩家选了 O（后手），AI 先手落一子
    if (this.playerSide === 'O') this._aiMove();
    this._emitState();
  }

  /** 落子（玩家） */
  play(row, col) {
    if (this._state !== TTT.STATE.PLAYING) return { ok: false, reason: 'not-playing' };
    if (this._aiThinking) return { ok: false, reason: 'ai-thinking' };
    if (this._board[row][col]) return { ok: false, reason: 'occupied' };
    if (this._current !== this.playerSide) return { ok: false, reason: 'not-your-turn' };

    this._place(row, col, this._current);
    if (this._checkEnd()) return { ok: true, ended: true };
    this._current = this.aiSide;

    // AI 回合（同步）
    this._aiThinking = true;
    this._emitState();
    const moved = this._aiMove();
    this._aiThinking = false;
    if (!moved) {
      // 意外：AI 没走（棋盘满了？）
      if (this._isDraw()) { this._end('draw'); }
    }
    this._emitState();
    return { ok: true };
  }

  _place(row, col, player) {
    this._board[row][col] = player;
    this._undo.push({ row, col, player });
    if (this._undo.length > TTT.MAX_UNDO) this._undo.shift();
    this._moves++;
  }

  /** 判胜 */
  _checkEnd() {
    for (const line of this._winLines) {
      const first = this._board[line[0][0]][line[0][1]];
      if (!first) continue;
      if (line.every(([r, c]) => this._board[r][c] === first)) {
        this._winner = first;
        this._winLine = line;
        this._end('win');
        return true;
      }
    }
    if (this._isDraw()) { this._end('draw'); return true; }
    return false;
  }

  _isDraw() {
    for (const row of this._board) for (const cell of row) if (!cell) return false;
    return true;
  }

  _end(reason) {
    this._state = reason === 'draw' ? TTT.STATE.DRAW : TTT.STATE.WON;
    this._emitState();
    if (this.onGameOver) {
      this.onGameOver({
        reason,
        winner: this._winner,
        winLine: this._winLine,
        moves: this._moves,
        winForHuman: this._winner === this.playerSide,
      });
    }
  }

  /** AI 落子（同步） */
  _aiMove() {
    if (this._state !== TTT.STATE.PLAYING) return false;
    if (this._isDraw()) return false;

    const empty = [];
    for (let r = 0; r < this.size; r++) for (let c = 0; c < this.size; c++) if (!this._board[r][c]) empty.push([r, c]);
    if (!empty.length) return false;

    let choice;
    if (this.difficulty === 'easy') {
      choice = empty[Math.floor(Math.random() * empty.length)];
    } else if (this.difficulty === 'normal') {
      // 10% 退回随机，其余 Minimax
      if (Math.random() < 0.1) {
        choice = empty[Math.floor(Math.random() * empty.length)];
      } else {
        choice = this._bestMove();
      }
    } else {
      choice = this._bestMove();
    }

    if (!choice) choice = empty[Math.floor(Math.random() * empty.length)];
    this._place(choice[0], choice[1], this.aiSide);
    if (this._checkEnd()) return true;
    this._current = this.playerSide;
    return true;
  }

  /** Minimax + alpha-beta：返回最佳 [row, col] */
  _bestMove() {
    let bestScore = -Infinity;
    let bestMove = null;
    let alpha = -Infinity;
    const beta = Infinity;
    const depthLimit = this.size === 4 ? 5 : Infinity;

    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this._board[r][c]) continue;
        this._board[r][c] = this.aiSide;
        const score = this._minimax(false, depthLimit === Infinity ? 9 : depthLimit, alpha, beta);
        this._board[r][c] = null;
        if (score > bestScore) {
          bestScore = score;
          bestMove = [r, c];
        }
        alpha = Math.max(alpha, bestScore);
      }
    }
    return bestMove;
  }

  _minimax(isMax, depth, alpha, beta) {
    // 终止：判胜
    for (const line of this._winLines) {
      const first = this._board[line[0][0]][line[0][1]];
      if (!first) continue;
      if (line.every(([r, c]) => this._board[r][c] === first)) {
        const score = first === this.aiSide ? 10 + depth : -10 - depth;
        return score;
      }
    }
    // 终止：平局
    let full = true;
    for (const row of this._board) for (const cell of row) if (!cell) { full = false; break; }
    if (full) return 0;
    // 终止：深度限制（4×4）
    if (depth <= 0) return 0;

    if (isMax) {
      let best = -Infinity;
      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          if (this._board[r][c]) continue;
          this._board[r][c] = this.aiSide;
          const val = this._minimax(false, depth - 1, alpha, beta);
          this._board[r][c] = null;
          best = Math.max(best, val);
          alpha = Math.max(alpha, best);
          if (beta <= alpha) break;
        }
        if (beta <= alpha) break;
      }
      return best;
    } else {
      let best = Infinity;
      const opp = this.aiSide === 'X' ? 'O' : 'X';
      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          if (this._board[r][c]) continue;
          this._board[r][c] = opp;
          const val = this._minimax(true, depth - 1, alpha, beta);
          this._board[r][c] = null;
          best = Math.min(best, val);
          beta = Math.min(beta, best);
          if (beta <= alpha) break;
        }
        if (beta <= alpha) break;
      }
      return best;
    }
  }

  /** 撤销：弹出两步（玩家 + AI），栈 < 2 时只弹 1 步 */
  undo() {
    if (this._state !== TTT.STATE.PLAYING && this._state !== TTT.STATE.WON && this._state !== TTT.STATE.DRAW) return false;
    if (this._undo.length === 0) return false;

    // 通关后撤销回到 playing
    if (this._state !== TTT.STATE.PLAYING) {
      this._state = TTT.STATE.PLAYING;
      this._winner = null;
      this._winLine = null;
    }

    // 正常撤销：回退两步（玩家 + AI）；若只剩 1 步（AI 先手场景下第一步），只退 1
    const popCount = Math.min(2, this._undo.length);
    for (let i = 0; i < popCount; i++) {
      const last = this._undo.pop();
      this._board[last.row][last.col] = null;
      if (this._moves > 0) this._moves--;
    }
    // 回合切换：撤销后轮到玩家
    this._current = this.playerSide;
    this._emitState();
    return true;
  }

  pause() {
    if (this._state === TTT.STATE.PLAYING) {
      this._state = TTT.STATE.PAUSED;
      this._emitState();
      if (this.onPause) this.onPause({ reason: 'manual' });
    }
  }

  resume() {
    if (this._state === TTT.STATE.PAUSED) {
      this._state = TTT.STATE.PLAYING;
      this._emitState();
    }
  }

  _emitState() {
    if (this.onState) {
      this.onState({ state: this._state, current: this._current, moves: this._moves, aiThinking: this._aiThinking });
    }
  }

  dispose() {
    this.onState = null; this.onGameOver = null; this.onPause = null;
  }

  /** 存档序列化 */
  getSnapshot() {
    return {
      v: 1,
      size: this.size,
      difficulty: this.difficulty,
      playerSide: this.playerSide,
      board: this._board.map((row) => row.map((c) => c || '-').join('')).join('|'),
      currentPlayer: this._current,
      moves: this._moves,
      ts: Date.now(),
    };
  }

  restore(save) {
    if (!save || save.v !== 1) return false;
    if (save.size !== this.size) return false;
    const rows = save.board.split('|');
    if (rows.length !== this.size) return false;
    const board = rows.map((row) => row.split('').map((c) => c === '-' ? null : c));
    // 校验每个 cell 是 X/O/null
    for (const row of board) for (const c of row) if (c && c !== 'X' && c !== 'O') return false;
    if (save.currentPlayer !== 'X' && save.currentPlayer !== 'O') return false;

    this._board = board;
    this._current = save.currentPlayer;
    this._moves = Number(save.moves) || 0;
    this._undo = [];
    this._state = TTT.STATE.PAUSED;
    this._emitState();
    return true;
  }
}

/** 存档校验器 */
export function validateTTTSave(save) {
  if (!save || typeof save !== 'object') return false;
  if (save.v !== 1) return false;
  if (save.size !== 3 && save.size !== 4) return false;
  if (!['easy', 'normal', 'hard'].includes(save.difficulty)) return false;
  if (save.playerSide !== 'X' && save.playerSide !== 'O') return false;
  if (typeof save.board !== 'string') return false;
  return true;
}
