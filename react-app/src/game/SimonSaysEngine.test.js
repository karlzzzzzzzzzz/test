import test from 'node:test';
import assert from 'node:assert/strict';
import SimonSaysEngine, { SIMON, validateSimonSave } from './SimonSaysEngine.js';

const makeEngine = (seq = [0], opts = {}) => {
  let i = 0;
  const rng = () => seq[Math.min(i++, seq.length - 1)];
  return new SimonSaysEngine({ rng, ...opts });
};

/** 推进回放直到进入 input 态（单步上限 100ms，多打几拍） */
const driveToInput = (engine, maxTicks = 200) => {
  for (let i = 0; i < maxTicks && engine.state === SIMON.STATE.SHOWING; i++) engine.tick(100);
  return engine.state;
};

test('start：序列长度 1、生命 3、进入 showing', () => {
  const e = makeEngine([2]);
  e.start();
  assert.equal(e.state, SIMON.STATE.SHOWING);
  assert.deepEqual(e.sequence, [2]);
  assert.equal(e.lives, 3);
  assert.equal(e.round, 1);
});

test('tick 推进回放：单 pad 播完后进入 input', () => {
  const e = makeEngine([1]);
  e.start();
  assert.equal(driveToInput(e), SIMON.STATE.INPUT);
  assert.equal(e.currentFlash, null);
});

test('高亮相位返回当前 pad，间隔相位返回 null', () => {
  const e = makeEngine([3]);
  e.start();
  assert.equal(e.currentFlash, 3);
  e.tick(100);
  e.tick(100);
  e.tick(100);
  e.tick(100); // 400ms > 380ms 高亮时长 → 进入间隔
  assert.equal(e.currentFlash, null);
});

test('正确复现：关卡 +1、序列加长、回到 showing', () => {
  const e = makeEngine([0, 2]);
  e.start();
  driveToInput(e);
  const r = e.input(0);
  assert.equal(r.ok, true);
  assert.equal(r.hit, true);
  assert.equal(r.advanced, true);
  assert.equal(e.round, 2);
  assert.equal(e.sequence.length, 2);
  assert.equal(e.state, SIMON.STATE.SHOWING);
});

test('按错：生命 -1 并重播本关序列', () => {
  const e = makeEngine([0]);
  e.start();
  driveToInput(e);
  const r = e.input(1);
  assert.equal(r.ok, true);
  assert.equal(r.hit, false);
  assert.equal(e.lives, 2);
  assert.equal(e.state, SIMON.STATE.SHOWING);
  assert.equal(e.inputIndex, 0);
});

test('生命归零：进入 over 并触发 onGameOver', () => {
  let over = null;
  const e = makeEngine([0], { onGameOver: (info) => { over = info; } });
  e.start();
  for (let i = 0; i < 3; i++) {
    driveToInput(e);
    e.input(1);
  }
  assert.equal(e.state, SIMON.STATE.OVER);
  assert.equal(e.lives, 0);
  assert.equal(over.reason, 'wrong');
  assert.equal(over.round, 1);
});

test('非 input 态输入被忽略', () => {
  const e = makeEngine([0]);
  e.start();
  const r = e.input(0); // showing 中
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-input');
  assert.equal(e.lives, 3);
});

test('speedFactor 随关卡下降且不低于 0.45', () => {
  const e = makeEngine([0]);
  e.start();
  assert.equal(e.speedFactor, 1);
  e._round = 5;
  assert.equal(Math.round(e.speedFactor * 100) / 100, 0.8);
  e._round = 30;
  assert.equal(e.speedFactor, SIMON.MIN_SPEED);
});

test('暂停冻结 tick，恢复回到 showing 并重播', () => {
  const e = makeEngine([0]);
  e.start();
  e.tick(100);
  const before = e.currentFlash;
  assert.equal(e.pause(), true);
  assert.equal(e.state, SIMON.STATE.PAUSED);
  e.tick(1000);
  assert.equal(e.state, SIMON.STATE.PAUSED);
  assert.equal(e.currentFlash, null);
  assert.equal(e.resume(), true);
  assert.equal(e.state, SIMON.STATE.SHOWING);
  assert.equal(e.currentFlash, before);
});

test('单次 tick 推进上限 100ms（防跳帧）', () => {
  const e = makeEngine([0]);
  e.start();
  e.tick(5000);
  // 380ms 高亮未播完 → 仍在高亮相位
  assert.equal(e.currentFlash, 0);
});

test('存档快照与恢复：恢复为 paused 且关卡保留', () => {
  const e = makeEngine([0, 1, 2]);
  e.start();
  driveToInput(e);
  e.input(0);
  e.input(1);
  const snap = e.getSnapshot();
  assert.equal(validateSimonSave(snap), true);

  const e2 = makeEngine([0]);
  assert.equal(e2.restore(snap), true);
  assert.equal(e2.state, SIMON.STATE.PAUSED);
  assert.equal(e2.round, snap.round);
  assert.deepEqual(e2.sequence, snap.sequence);
  e2.resume();
  assert.equal(e2.state, SIMON.STATE.SHOWING);
});

test('validateSimonSave 拒绝坏档', () => {
  assert.equal(validateSimonSave(null), false);
  assert.equal(validateSimonSave({ v: 2 }), false);
  assert.equal(validateSimonSave({ v: 1, sequence: [], round: 1, lives: 3, inputIndex: 0 }), false);
  assert.equal(validateSimonSave({ v: 1, sequence: [9], round: 1, lives: 3, inputIndex: 0 }), false);
  assert.equal(validateSimonSave({ v: 1, sequence: [0], round: 0, lives: 3, inputIndex: 0 }), false);
  assert.equal(validateSimonSave({ v: 1, sequence: [0], round: 1, lives: 0, inputIndex: 0 }), false);
  assert.equal(validateSimonSave({ v: 1, sequence: [0], round: 1, lives: 3, inputIndex: 1 }), false);
  assert.equal(validateSimonSave({ v: 1, sequence: [0], round: 1, lives: 3, inputIndex: 0 }), true);
});

test('序列长度不超过上限', () => {
  const e = makeEngine([0]);
  e.start();
  e._sequence = new Array(SIMON.MAX_SEQ).fill(0);
  e._state = SIMON.STATE.INPUT;
  e._inputIndex = SIMON.MAX_SEQ - 1;
  e.input(0);
  assert.equal(e.sequence.length, SIMON.MAX_SEQ);
  assert.equal(e.round, 2);
});
