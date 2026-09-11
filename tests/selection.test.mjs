import test from 'node:test';
import assert from 'node:assert/strict';

import { parseKoreanDate, selectEntries } from '../selection.mjs';
const now = new Date('2026-09-11T12:00:00+09:00');
const video = (week, fields = {}) => ({ courseId: 'a', week, kind: 'video', completed: false,
  title: `Week ${week}`, url: `https://example.test/${week}`,
  startsAt: '2026-09-01T00:00:00+09:00', dueAt: '2026-09-14T23:59:00+09:00',
  endsAt: '2026-12-31T23:59:00+09:00', ...fields });

test('parses Korean dates with Seoul offset and midnight/noon', () => {
  assert.equal(typeof parseKoreanDate, 'function');
  assert.equal(parseKoreanDate('9월 1일 오전 00:00', 2026), '2026-08-31T15:00:00.000Z');
  assert.equal(parseKoreanDate('9월 14일 오후 11:59', 2026), '2026-09-14T14:59:00.000Z');
  assert.equal(parseKoreanDate('9월 14일 오후 12:00', 2026), '2026-09-14T03:00:00.000Z');
  assert.equal(parseKoreanDate('9월 14일 오전 12:00', 2026), '2026-09-13T15:00:00.000Z');
});

test('rejects malformed and rolled over Korean dates', () => {
  for (const text of ['2월 29일 오전 01:00', '4월 31일 오전 01:00', '13월 1일 오전 01:00',
    '9월 0일 오전 01:00', '9월 1일 오후 13:00', '9월 1일 오전 01:60', 'garbage']) {
    assert.throws(() => parseKoreanDate(text, 2026), /date|날짜/i);
  }
  assert.equal(parseKoreanDate('2월 29일 오전 01:00', 2024), '2024-02-28T16:00:00.000Z');
});

test('chooses latest active start separately per course and retains completed videos', () => {
  assert.equal(typeof selectEntries, 'function');
  const rows = [video(1), video(2, { startsAt: '2026-09-08T00:00:00+09:00', completed: true }),
    video(4, { courseId: 'b' }), video(5, { courseId: 'b', startsAt: '2026-09-12T00:00:00+09:00' })];
  assert.deepEqual(selectEntries(rows, { now }), [rows[1], rows[2]]);
});

test('explicit weeks match exactly, order by course and week, preserve lecture order', () => {
  const rows = [video(11), video(2, { title: 'first' }), video(1), video(2, { title: 'second' }),
    video(1, { courseId: 'b' }), video(2, { courseId: 'b' })];
  assert.deepEqual(selectEntries(rows, { weeks: [2, 1], now }), [rows[2], rows[1], rows[3], rows[4], rows[5]]);
});

test('rejects unknown weeks but accepts a known non-video-only week', () => {
  assert.throws(() => selectEntries([video(11)], { weeks: [1], now }), /week|주차/i);
  assert.deepEqual(selectEntries([video(1, { kind: 'other' })], { weeks: [1], now }), []);
});

test('ambiguous active weeks require explicit selection', () => {
  assert.throws(() => selectEntries([video(1), video(2)], { now }), /--weeks/);
});

test('missing dates and future explicit weeks are rejected', () => {
  assert.throws(() => selectEntries([video(1, { startsAt: null })], { now }), /schedule|date/i);
  assert.throws(() => selectEntries([video(1, { dueAt: null })], { now }), /schedule|date/i);
  assert.throws(() => selectEntries([video(1, { startsAt: '2026-09-12T00:00:00+09:00' })], { weeks: [1], now }), /future|start/i);
});

test('expired incomplete videos are rejected, completed videos remain skippable', () => {
  const expired = video(1, { endsAt: '2026-09-10T00:00:00+09:00' });
  assert.throws(() => selectEntries([expired], { weeks: [1], now }), /expired|end/i);
  const complete = { ...expired, completed: true };
  assert.deepEqual(selectEntries([complete], { weeks: [1], now }), [complete]);
});

test('no currently active video week returns no entries', () => {
  assert.deepEqual(selectEntries([video(1, { dueAt: '2026-09-10T00:00:00+09:00' })], { now }), []);
});
