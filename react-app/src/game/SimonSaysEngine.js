/**
 * 西蒙记忆（Simon Says）引擎 — 纯逻辑，无定时器，回放时钟由页面 rAF 调 tick(dt) 驱动。
 *
 * 状态机：idle → showing（回放序列）→ input（等待玩家复现）
 *          input 命中且序列播完 → 下一关（showing，序列 +1，速度加快）
 *          input 按错 → lives-1；lives 归零 → over
 *          paused 可插入 showing / input 之前，恢复回到原态
 *
 * 关键点：回放时间轴完全由 tick 推进（页面每帧调），暂停时页面不调 tick 即冻结。
 */

export const SIMON = Object.freeze({
  PADS: 4,
  LIVES: 3,
  FLASH_ON_MS: 380,   // 单个 pad 高亮时长
  FLASH_GAP_MS: 160,  // 相邻 pad 间隔
  MAX_SEQ: 60,        // 序列长度上限（防存档膨胀）
  MIN_SPEED: 0.45,    // 速度因子下限
  SPEED_STEP: 0.05,   // 每关加速 5%
  MAX_TICK_MS: 100,   // 单帧推进上限（防切回页面跳帧）
  SAVE_KEY: 'game-simon-says-save-v1',
  BEST_KEY: 'game-simon-says-best-v1',
  STATS_KEY: 'game-simon-says-stats-v1',
  SETTINGS_KEY: 'game-simon-says-settings-v1',
  SAVE_MAX_CHARS: 4096,
  SAVE_TTL_MS: 86400000,
  POMODORO_MIN: 120,
  STATE: { IDLE: 'idle', SHOWING: 'showing', INPUT: 'input', PAUSED: 'paused', OVER: 'over' },
});

const randPad = () => Math.floor(Math.random() * SIMON.PADS);

export default class SimonSaysEngine {
  constructor({ onState, onGameOver, onPause, rng } = {}) {
    this._rng = typeof rng === 'function' ? rng : randPad;
    this._state = SIMON.STATE.IDLE;
    this._sequence = [];
    this._inputIndex = 0;
    this._round = 1;
    this._lives = SIMON.LIVES;
    this._padIndex = 0;
    this._phase = 'on';       // 'on' | 'off'
    this._clock = 0;
    this._resumeState = SIMON.STATE.INPUT;

    this.onState = onState || null;
    this.onGameOver = onGameOver || null;
    this.onPause = onPause || null;
  }

  get state() { return this._state; }
  get sequence() { return this._sequence; }
  get round() { return this._round; }
  get lives() { return this._lives; }
  get inputIndex() { return this._inputIndex; }
  get speedFactor() {
    return Math.max(SIMON.MIN_SPEED, 1 - (this._round - 1) * SIMON.SPEED_STEP);
  }

  /** 当前应高亮的 pad（showing 且处于高亮相位），否则 null */
  get currentFlash() {
    if (this._state !== SIMON.STATE.SHOWING || this._phase !== 'on') return null;
    return this._sequence[this._padIndex] ?? null;
  }

  start() {
    this._sequence = [this._rng()];
    this._inputIndex = 0;
    this._round = 1;
    this._lives = SIMON.LIVES;
    this._padIndex = 0;
    this._phase = 'on';
    this._clock = 0;
    this._state = SIMON.STATE.SHOWING;
    this._emit();
  }

  /** 页面每帧调用，推进回放 */
  tick(dtMs) {
    if (this._state !== SIMON.STATE.SHOWING) return;
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? Math.min(dtMs, SIMON.MAX_TICK_MS) : 0;
    if (!dt) return;

    const step = (this._phase === 'on' ? SIMON.FLASH_ON_MS : SIMON.FLASH_GAP_MS) * this.speedFactor;
    this._clock += dt;
    while (this._clock >= step) {
      this._clock -= step;
      if (this._phase === 'on') {
        this._phase = 'off';
      } else {
        this._padIndex++;
        if (this._padIndex >= this._sequence.length) {
          this._state = SIMON.STATE.INPUT;
          this._inputIndex = 0;
          this._padIndex = 0;
          this._phase = 'on';
          this._clock = 0;
          this._emit();
          return;
        }
        this._phase = 'on';
      }
    }
    this._emit();
  }

  /** 玩家输入 */
  input(pad) {
    if (this._state !== SIMON.STATE.INPUT) return { ok: false, reason: 'not-input' };
    if (!Number.isInteger(pad) || pad < 0 || pad >= SIMON.PADS) return { ok: false, reason: 'bad-pad' };

    const expected = this._sequence[this._inputIndex];
    if (pad !== expected) {
      this._lives -= 1;
      if (this._lives <= 0) {
        this._lives = 0;
        this._state = SIMON.STATE.OVER;
        this._emit();
        if (this.onGameOver) this.onGameOver({ reason: 'wrong', round: this._round });
        return { ok: true, hit: false, round: this._round, lives: 0 };
      }
      // 还有生命：重播本关序列
      this._inputIndex = 0;
      this._padIndex = 0;
      this._phase = 'on';
      this._clock = 0;
      this._state = SIMON.STATE.SHOWING;
      this._emit();
      return { ok: true, hit: false, round: this._round, lives: this._lives };
    }

    this._inputIndex += 1;
    if (this._inputIndex >= this._sequence.length) {
      // 本关通过：加长序列并进入下一关回放
      this._round += 1;
      if (this._sequence.length < SIMON.MAX_SEQ) this._sequence.push(this._rng());
      this._inputIndex = 0;
      this._padIndex = 0;
      this._phase = 'on';
      this._clock = 0;
      this._state = SIMON.STATE.SHOWING;
      this._emit();
      return { ok: true, hit: true, round: this._round, lives: this._lives, advanced: true };
    }
    this._emit();
    return { ok: true, hit: true, round: this._round, lives: this._lives };
  }

  pause() {
    if (this._state !== SIMON.STATE.SHOWING && this._state !== SIMON.STATE.INPUT) return false;
    this._resumeState = this._state;
    this._state = SIMON.STATE.PAUSED;
    this._emit();
    if (this.onPause) this.onPause({ reason: 'manual' });
    return true;
  }

  resume() {
    if (this._state !== SIMON.STATE.PAUSED) return false;
    // 恢复时从头重播本关序列，避免玩家错过
    if (this._resumeState === SIMON.STATE.SHOWING) {
      this._padIndex = 0;
      this._phase = 'on';
      this._clock = 0;
    }
    this._state = this._resumeState;
    this._emit();
    return true;
  }

  dispose() {
    this.onState = null;
    this.onGameOver = null;
    this.onPause = null;
  }

  _emit() {
    if (this.onState) {
      this.onState({
        state: this._state,
        round: this._round,
        lives: this._lives,
        inputIndex: this._inputIndex,
        flash: this.currentFlash,
        seqLen: this._sequence.length,
      });
    }
  }

  getSnapshot() {
    return {
      v: 1,
      sequence: this._sequence.slice(0, SIMON.MAX_SEQ),
      inputIndex: this._inputIndex,
      round: this._round,
      lives: this._lives,
      ts: Date.now(),
    };
  }

  restore(save) {
    if (!validateSimonSave(save)) return false;
    this._sequence = save.sequence.slice();
    this._inputIndex = 0;
    this._round = save.round;
    this._lives = save.lives;
    this._padIndex = 0;
    this._phase = 'on';
    this._clock = 0;
    this._state = SIMON.STATE.PAUSED;
    this._resumeState = SIMON.STATE.SHOWING;
    this._emit();
    return true;
  }
}

/** 存档校验：结构、序列取值、关卡/生命范围 */
export function validateSimonSave(save) {
  if (!save || typeof save !== 'object') return false;
  if (save.v !== 1) return false;
  if (!Array.isArray(save.sequence)) return false;
  if (save.sequence.length < 1 || save.sequence.length > SIMON.MAX_SEQ) return false;
  if (!save.sequence.every((p) => Number.isInteger(p) && p >= 0 && p < SIMON.PADS)) return false;
  if (!Number.isInteger(save.round) || save.round < 1) return false;
  if (!Number.isInteger(save.lives) || save.lives < 1 || save.lives > SIMON.LIVES) return false;
  if (!Number.isInteger(save.inputIndex) || save.inputIndex < 0 || save.inputIndex >= save.sequence.length) return false;
  return true;
}
