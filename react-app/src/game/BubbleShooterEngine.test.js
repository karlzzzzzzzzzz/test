import test from 'node:test';
import assert from 'node:assert/strict';
import BubbleShooterEngine, {
  BUBBLE,
  DEADLINE_Y,
  cellCenter,
  validateBubbleSave,
} from './BubbleShooterEngine.js';

/** 固定序列随机源，循环复用 */
const seqRng = (values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

const makeEngine = (rng = () => 0.1, opts = {}) =>
  new BubbleShooterEngine({ rng, ...opts });

/** 构造行：偶数行 8 格、奇数行 7 格 */
const rowOf = (cells, offset = null) => ({
  offset: offset === null ? 0 : offset,
  cells,
});

/** 驱动飞行直到落位或结束 */
const driveFlight = (engine, maxTicks = 200) => {
  for (let i = 0; i < maxTicks && engine.shot; i++) engine.tick(50);
  return engine;
};

test('start：预分配可见行、初始 5 行有气泡、分数归零', () => {
  const e = makeEngine(seqRng([0.0, 0.2, 0.4, 0.6, 0.8]));
  e.start();
  assert.equal(e.state, BUBBLE.STATE.PLAYING);
  assert.equal(e.rows.length, BUBBLE.ROWS);
  e.rows.forEach((row, r) => {
    assert.equal(row.offset, r % 2);
    assert.equal(row.cells.length, r % 2 === 0 ? BUBBLE.COLS : BUBBLE.COLS - 1);
    for (const v of row.cells) {
      if (r < BUBBLE.INIT_ROWS) assert.ok(v >= 0 && v < BUBBLE.COLORS);
      else assert.equal(v, null);
    }
  });
  assert.equal(e.maxRow, BUBBLE.INIT_ROWS - 1);
  assert.equal(e.score, 0);
  assert.equal(e.shotsFired, 0);
  assert.equal(e.shotsUntilDrop, BUBBLE.SHOTS_PER_DROP);
  assert.equal(e.shot, null);
});

test('aimAt 限制在 ±75°，nudgeAim 逐步累加并夹紧', () => {
  const e = makeEngine();
  e.start();
  e.aimAt(BUBBLE.W * 10, 0); // 极右上方
  assert.equal(e.aimAngle, BUBBLE.AIM_LIMIT);
  e.aimAt(-BUBBLE.W * 10, 0);
  assert.equal(e.aimAngle, -BUBBLE.AIM_LIMIT);
  const before = e.aimAngle;
  e.nudgeAim(-Math.PI / 4);
  assert.equal(e.aimAngle, before);
});

test('shoot 生成飞行气泡，tick 推进直到落位', () => {
  const e = makeEngine(seqRng([0.0, 0.2, 0.4, 0.6, 0.8, 0.1, 0.3]));
  e.start();
  e.aimAt(BUBBLE.W / 2, 0);
  assert.equal(e.shoot(), true);
  const startY = e.shot.y;
  e.tick(50);
  assert.ok(e.shot.y < startY);
  assert.equal(e.shoot(), false); // 飞行中不可重复发射
  driveFlight(e);
  assert.equal(e.shot, null);
  assert.equal(e.shotsFired, 1);
  assert.equal(e.state, BUBBLE.STATE.PLAYING);
});

test('墙面反弹：斜射时气泡不越出左右边界', () => {
  const e = makeEngine();
  e._state = BUBBLE.STATE.PLAYING;
  e._rows = [rowOf(new Array(BUBBLE.COLS).fill(null))];
  e._current = 1;
  e._next = 2;
  e._aim = BUBBLE.AIM_LIMIT;
  e.shoot();
  let maxX = 0;
  for (let i = 0; i < 400 && e.shot; i++) {
    e.tick(16);
    if (e.shot) maxX = Math.max(maxX, e.shot.x);
  }
  assert.ok(maxX <= BUBBLE.W - BUBBLE.R + 1e-6);
  assert.equal(e.shot, null);
});

test('触顶吸附到第 0 行最近空格', () => {
  const e = makeEngine();
  e._state = BUBBLE.STATE.PLAYING;
  e._rows = [rowOf(new Array(BUBBLE.COLS).fill(null))];
  e._current = 3;
  e._next = 1;
  e._aim = 0;
  e.shoot();
  driveFlight(e);
  // x = W/2 = 8，最近格为 c=3（x=7）与 c=4（x=9），取先出现的 c=3
  assert.equal(e.rows[0].cells[3], 3);
  assert.equal(e.shotsFired, 1);
});

test('同色 3 连消除：得分 = 10 × 数量，清空盘面立即结束', () => {
  let over = null;
  const e = makeEngine(() => 0.1, { onGameOver: (info) => { over = info; } });
  e._state = BUBBLE.STATE.PLAYING;
  e._rows = [rowOf([1, 1, null, null, null, null, null, null])];
  e._shotsFired = 0;
  e._current = 1;
  e._next = 0;
  e._land({ x: 5, y: 1, color: 1 }, true);
  assert.equal(e.state, BUBBLE.STATE.OVER);
  assert.equal(e.score, 30);
  assert.deepEqual(e._lastPop, { popped: 3, dropped: 0, gained: 30 });
  assert.equal(over.reason, 'cleared');
  assert.equal(over.score, 30);
});

test('悬空气泡坠落：额外 20 分/个，且顶行连通气泡保留', () => {
  const e = makeEngine();
  e._state = BUBBLE.STATE.PLAYING;
  e._rows = [
    rowOf([1, 1, null, null, null, null, null, 2]),
    rowOf([3, null, null, null, null, null, null], 1),
  ];
  e._shotsFired = 0;
  e._current = 1;
  e._next = 0;
  e._land({ x: 5, y: 1, color: 1 }, true);
  // 3 个同色消除 + 1 个悬空坠落 = 30 + 20
  assert.equal(e.score, 50);
  assert.deepEqual(e._lastPop, { popped: 3, dropped: 1, gained: 50 });
  assert.equal(e.rows[1].cells[0], null);
  assert.equal(e.rows[0].cells[7], 2);
  assert.equal(e.state, BUBBLE.STATE.PLAYING);
});

test('每 8 发顶部下压一行，新行偏移与首行相反', () => {
  const e = makeEngine(seqRng([0.1, 0.3, 0.5, 0.7, 0.9]));
  e._state = BUBBLE.STATE.PLAYING;
  e._rows = [
    rowOf([0, null, null, null, null, null, null, null], 0),
    rowOf([null, null, null, null, null, null, null], 1),
  ];
  e._shotsFired = 7;
  e._current = 4;
  e._next = 3;
  e._land({ x: 5, y: 1, color: 4 }, true);
  assert.equal(e.rows.length, 3);
  assert.equal(e.rows[0].offset, 1);
  assert.equal(e.rows[0].cells.length, BUBBLE.COLS - 1);
  assert.equal(e.shotsFired, 8);
  assert.equal(e.state, BUBBLE.STATE.PLAYING);
});

test('行号触底（≥ ROWS）判负 overflow', () => {
  let over = null;
  const e = makeEngine(() => 0.1, { onGameOver: (info) => { over = info; } });
  const rows = []
  for (let r = 0; r < BUBBLE.ROWS; r++) {
    rows.push(rowOf(new Array(r % 2 === 0 ? BUBBLE.COLS : BUBBLE.COLS - 1).fill(null), r % 2))
  }
  rows[BUBBLE.ROWS - 1].cells[0] = 2
  e._state = BUBBLE.STATE.PLAYING;
  e._rows = rows;
  e._shotsFired = 7;
  e._current = 0;
  e._next = 0;
  e._land({ x: 5, y: 1, color: 0 }, true)
  assert.equal(e.state, BUBBLE.STATE.OVER);
  assert.equal(over.reason, 'overflow');
  assert.ok(DEADLINE_Y < BUBBLE.SHOOTER_Y);
});

test('暂停冻结飞行，恢复后从原位置继续', () => {
  const e = makeEngine();
  e.start();
  e.shoot();
  e.tick(50);
  const x = e.shot.x;
  const y = e.shot.y;
  assert.equal(e.pause(), true);
  assert.equal(e.state, BUBBLE.STATE.PAUSED);
  e.tick(1000);
  assert.equal(e.shot.y, y);
  assert.equal(e.shot.x, x);
  assert.equal(e.shoot(), false);
  assert.equal(e.aimAt(0, 0), false);
  assert.equal(e.resume(), true);
  assert.equal(e.state, BUBBLE.STATE.PLAYING);
  e.tick(50);
  assert.notEqual(e.shot, null);
  assert.ok(e.shot.y < y);
});

test('瞄准虚线始终在画布内，且不超过 220 步', () => {
  const e = makeEngine();
  e.start();
  e.aimAt(BUBBLE.W * 5, 0);
  assert.ok(e.aimPath.length > 1);
  assert.ok(e.aimPath.length <= 221);
  for (const p of e.aimPath) {
    assert.ok(p.x >= BUBBLE.R - 1e-6 && p.x <= BUBBLE.W - BUBBLE.R + 1e-6);
    assert.ok(p.y >= BUBBLE.R - 1e-6);
  }
});

test('存档快照与恢复：恢复为 paused 且盘面/分数保留', () => {
  const e = makeEngine(seqRng([0.0, 0.2, 0.4, 0.6, 0.8, 0.1, 0.3]));
  e.start();
  e.shoot();
  driveFlight(e);
  e._score = 120;
  const snap = e.getSnapshot();
  assert.equal(validateBubbleSave(snap), true);

  const e2 = makeEngine();
  assert.equal(e2.restore(snap), true);
  assert.equal(e2.state, BUBBLE.STATE.PAUSED);
  assert.equal(e2.score, 120);
  assert.equal(e2.rows.length, snap.rows.length);
  assert.equal(e2.currentColor, snap.current);
  assert.equal(e2.nextColor, snap.next);
  e2.resume();
  assert.equal(e2.state, BUBBLE.STATE.PLAYING);
});

test('validateBubbleSave 拒绝坏档', () => {
  const base = {
    v: 1,
    rows: [{ o: 0, c: new Array(BUBBLE.COLS).fill(-1) }],
    score: 0,
    shotsFired: 0,
    current: 0,
    next: 1,
  }
  base.rows[0].c[0] = 0
  assert.equal(validateBubbleSave(base), true)
  assert.equal(validateBubbleSave(null), false)
  assert.equal(validateBubbleSave({ ...base, v: 2 }), false)
  assert.equal(validateBubbleSave({ ...base, rows: [] }), false)
  assert.equal(validateBubbleSave({ ...base, rows: new Array(BUBBLE.MAX_ROWS + 1).fill(base.rows[0]) }), false)
  assert.equal(validateBubbleSave({ ...base, rows: [{ o: 0, c: [0, 0] }] }), false)
  assert.equal(validateBubbleSave({ ...base, rows: [{ o: 1, c: [0] }] }), false)
  assert.equal(validateBubbleSave({ ...base, rows: [{ o: 0, c: new Array(BUBBLE.COLS).fill(-1) }] }), false)
  assert.equal(validateBubbleSave({ ...base, rows: [{ o: 0, c: [-1, -1, -1, 9, -1, -1, -1, -1] }] }), false)
  assert.equal(validateBubbleSave({ ...base, score: -1 }), false)
  assert.equal(validateBubbleSave({ ...base, shotsFired: -1 }), false)
  assert.equal(validateBubbleSave({ ...base, current: BUBBLE.COLORS }), false)
  assert.equal(validateBubbleSave({ ...base, next: -1 }), false)
  assert.equal(validateBubbleSave({ ...base, aim: Number.NaN }), false)
});

test('cellCenter 六边形几何：相邻行水平错开半格、行高 √3', () => {
  const a = cellCenter(0, 0, 0)
  const b = cellCenter(1, 0, 1)
  assert.equal(a.x, BUBBLE.R)
  assert.equal(a.y, BUBBLE.R)
  assert.equal(b.x, BUBBLE.R * 2)
  assert.ok(Math.abs(b.y - a.y - BUBBLE.ROW_H) < 1e-9)
});
