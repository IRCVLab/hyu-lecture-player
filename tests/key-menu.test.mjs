import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import * as menu from '../key-menu.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function terminal({ raw = false, paused = true, rows = 12, columns = 55 } = {}) {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = raw;
  input.rawCalls = [];
  input.setRawMode = value => { input.rawCalls.push(value); input.isRaw = value; };
  if (paused === true) input.pause(); else if (paused === false) input.resume();
  let text = '';
  const output = new Writable({ write(chunk, encoding, callback) { text += chunk.toString(); callback(); } });
  Object.assign(output, { isTTY: true, rows, columns });
  return { input, output, text: () => text };
}
const items = [
  { value: 'a', label: '첫 강의', recommended: true },
  { value: 'blocked', label: '잠긴 강의', disabled: true },
  { value: 'c', label: '마지막 강의', warning: '마감 주의' },
];

test('exports reusable menu functions', () => {
  assert.equal(typeof menu.keyMenu, 'function');
  assert.equal(typeof menu.canUseKeyMenu, 'function');
});
test('capability requires raw TTY input and TTY output', () => {
  const { input, output } = terminal();
  assert.equal(menu.canUseKeyMenu(input, output), process.env.TERM !== 'dumb');
  assert.equal(menu.canUseKeyMenu({}, output), false);
  assert.equal(menu.canUseKeyMenu(input, {}), false);
});
test('arrows browse disabled rows and Enter submits enabled focus with full cleanup', async () => {
  const tty = terminal();
  const result = menu.keyMenu({ ...tty, title: '강의 선택', items });
  tty.input.write('\x1b[B\x1b[B\r');
  assert.deepEqual(await result, ['c']);
  assert.deepEqual(tty.input.rawCalls, [true, false]);
  assert.equal(tty.input.isPaused(), true);
  for (const event of ['data', 'end', 'close', 'error']) assert.equal(tty.input.listenerCount(event), 0);
  assert.equal(tty.output.listenerCount('resize'), 0);
  assert.match(tty.text(), /\x1b\[\?25h/);
  assert.match(tty.text(), /추천/);
  assert.match(tty.text(), /마감 주의/);
});
test('multiple selection preserves defaults, filters disabled, and returns menu order', async () => {
  const tty = terminal();
  const result = menu.keyMenu({ ...tty, items, multiple: true, initialSelected: ['c', 'blocked'], initialIndex: 0 });
  tty.input.write(' \r');
  assert.deepEqual(await result, ['a', 'c']);
});
test('empty multiple selection waits or selects focused according to option', async () => {
  for (const selectFocusedOnEmpty of [false, true]) {
    const tty = terminal();
    let resolved = false;
    const result = menu.keyMenu({ ...tty, items, multiple: true, selectFocusedOnEmpty }).then(value => { resolved = true; return value; });
    tty.input.write('\r');
    await tick();
    assert.equal(resolved, selectFocusedOnEmpty);
    if (!selectFocusedOnEmpty) { assert.match(tty.text(), /선택/); tty.input.write(' \r'); }
    assert.deepEqual(await result, ['a']);
  }
});
test('Home End wrapping and split ANSI sequences navigate correctly', async () => {
  const tty = terminal();
  const result = menu.keyMenu({ ...tty, items });
  tty.input.write('\x1b[');
  tty.input.write('F\x1b[H\x1b[A\r');
  assert.deepEqual(await result, ['c']);
});
test('cancel keys, abort, EOF, and close restore prior raw and flow states', async () => {
  for (const cancel of ['q', '\x03', '\x1b', 'abort', 'end', 'close']) {
    const tty = terminal({ raw: true, paused: false });
    const controller = new AbortController();
    const result = menu.keyMenu({ ...tty, items, signal: controller.signal });
    if (cancel === 'abort') controller.abort();
    else if (cancel === 'end') tty.input.end();
    else if (cancel === 'close') tty.input.destroy();
    else tty.input.write(cancel);
    assert.equal(await result, null, cancel);
    assert.equal(tty.input.isRaw, true, cancel);
    assert.equal(tty.input.isPaused(), false, cancel);
    assert.equal(tty.input.listenerCount('data'), 0, cancel);
  }
});
test('already aborted and entirely disabled menus do not acquire raw mode', async () => {
  for (const config of [{ signal: AbortSignal.abort(), items }, { items: items.map(item => ({ ...item, disabled: true })) }]) {
    const tty = terminal();
    assert.equal(await menu.keyMenu({ ...tty, ...config }), null);
    assert.deepEqual(tty.input.rawCalls, []);
  }
});
test('viewport fits terminal height, truncates Korean rows, scrolls and redraws on resize', async () => {
  const tty = terminal({ rows: 7, columns: 24 });
  const many = Array.from({ length: 30 }, (_, i) => ({ value: String(i), label: `${i}번 아주 긴 한국어 강의 제목입니다`.repeat(3) }));
  const result = menu.keyMenu({ ...tty, title: '강의 선택', items: many });
  const initial = tty.text();
  assert.ok(initial.split('\n').length <= 7);
  assert.match(initial, /…/);
  assert.doesNotMatch(initial, /29번/);
  tty.input.write('\x1b[F');
  await tick();
  assert.match(tty.text(), /29번/);
  const beforeResize = tty.text().length;
  tty.output.rows = 5;
  tty.output.emit('resize');
  assert.ok(tty.text().length > beforeResize);
  tty.input.write('\r');
  assert.deepEqual(await result, ['29']);
  assert.doesNotMatch(tty.text(), /\x1b\[2J/);
});

test('recommendation marker stays visible when long labels are truncated', async () => {
  const tty = terminal({ columns: 24 });
  const result = menu.keyMenu({ ...tty, items: [{ value: 'a', label: '아주 긴 강의 이름'.repeat(20), recommended: true }] });
  assert.match(tty.text(), /추천/);
  tty.input.write('\r');
  assert.deepEqual(await result, ['a']);
});

test('untrusted text cannot emit ANSI commands or introduce frame rows', async () => {
  const tty = terminal();
  const result = menu.keyMenu({ ...tty, title: '제목\x1b[2J\n다음', items: [
    { value: 'a', label: '강의\x1b]0;bad-title\x07', description: '설명\r\n추가\x1b[31m', warning: '경고\t문자' },
  ] });
  const rendered = tty.text();
  assert.doesNotMatch(rendered, /\x1b\[2J|\x1b\]|bad-title|\x1b\[31m|\t/);
  assert.equal(rendered.split('\n').length, 3);
  tty.input.write('q');
  assert.equal(await result, null);
});

test('fresh inactive input is paused after completion so stdin does not hold process open', async () => {
  const tty = terminal({ paused: null });
  assert.equal(tty.input.readableFlowing, null);
  const result = menu.keyMenu({ ...tty, items });
  tty.input.write('\r');
  assert.deepEqual(await result, ['a']);
  assert.equal(tty.input.readableFlowing, false);
});

test('trailing disabled weeks can be browsed but never selected', async () => {
  for (const multiple of [false, true]) {
    const tty = terminal({ rows: 7 });
    const weeks = Array.from({ length: 16 }, (_, i) => ({ value: String(i), label: `${i + 1}주차`, disabled: i > 0 }));
    let resolved = false;
    const result = menu.keyMenu({ ...tty, items: weeks, multiple, selectFocusedOnEmpty: true })
      .then(value => { resolved = true; return value; });
    tty.input.write('\x1b[F');
    await tick();
    assert.match(tty.text(), /16주차/);
    tty.input.write(' \r');
    await tick();
    assert.equal(resolved, false);
    assert.match(tty.text(), /선택할 수 없는/);
    tty.input.write('\x1b[H\r');
    assert.deepEqual(await result, ['0']);
  }
});

test('Enter on disabled focus still confirms checked enabled rows', async () => {
  const tty = terminal();
  const result = menu.keyMenu({ ...tty, items, multiple: true, initialSelected: ['a'] });
  tty.input.write('\x1b[B \r');
  assert.deepEqual(await result, ['a']);
});
