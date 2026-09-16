import { stripVTControlCharacters } from 'node:util';

const ESC = '\x1b[';
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const clean = value => stripVTControlCharacters(String(value ?? '')).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
function width(text) {
  if (/^[\p{Mark}\u200d\ufe0f]+$/u.test(text)) return 0;
  return /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\p{Extended_Pictographic}]/u.test(text) ? 2 : 1;
}
function truncate(text, limit) {
  const parts = [...segments.segment(clean(text))].map(part => part.segment);
  if (parts.reduce((total, part) => total + width(part), 0) <= limit) return parts.join('');
  let result = '', used = 0;
  for (const part of parts) {
    if (used + width(part) > limit - 1) break;
    result += part;
    used += width(part);
  }
  return limit > 0 ? `${result}…` : '';
}

export function canUseKeyMenu(input = process.stdin, output = process.stdout) {
  return Boolean(input?.isTTY && output?.isTTY && typeof input.setRawMode === 'function' && process.env.TERM !== 'dumb');
}

/** Resolve selected string values in item order, or null when cancelled. */
export async function keyMenu({ title = '선택', items = [], multiple = false, initialSelected = [], initialIndex,
  selectFocusedOnEmpty = false, input = process.stdin, output = process.stdout, signal } = {}) {
  const enabled = items.map((item, index) => item.disabled ? -1 : index).filter(index => index >= 0);
  if (signal?.aborted || !enabled.length || input.destroyed || input.readableEnded) return null;
  let focus = enabled.includes(initialIndex) ? initialIndex : enabled[0];
  const selected = new Set(initialSelected.filter(value => items.some(item => item.value === value && !item.disabled)));
  const previousRaw = Boolean(input.isRaw);
  const previousFlowing = input.readableFlowing === true;
  let frameLines = 0, start = 0, message = '', pending = '', escapeTimer, done = false;

  return new Promise(resolve => {
    function clearFrame() {
      if (!frameLines) return;
      output.write('\r' + ESC + '2K');
      for (let line = 1; line < frameLines; line++) output.write(ESC + '1A\r' + ESC + '2K');
      frameLines = 0;
    }
    function draw() {
      if (done) return;
      const columns = Math.max(1, (output.columns || 80) - 1);
      const maxLines = Math.max(1, (output.rows || 24) - 1);
      const capacity = Math.max(1, maxLines - 2);
      start = Math.min(start, Math.max(0, items.length - capacity));
      if (focus < start) start = focus;
      if (focus >= start + capacity) start = focus - capacity + 1;
      const lines = [];
      if (maxLines > 1) lines.push(ESC + '1m' + truncate(title, columns) + ESC + '0m');
      for (let index = start; index < Math.min(items.length, start + capacity); index++) {
        const item = items[index];
        const marker = multiple ? (selected.has(item.value) ? '[x]' : '[ ]') : (focus === index ? '›' : ' ');
        const recommended = item.recommended ? ' ★ 추천' : '';
        const warning = typeof item.warning === 'string' ? ` ⚠ ${item.warning}` : item.warning ? ' ⚠ 주의' : '';
        const description = item.description ? ` — ${item.description}` : '';
        const text = truncate(`${marker}${recommended}${warning} ${item.label}${description}`, columns);
        const color = item.disabled ? '2' : item.recommended ? '32' : item.warning ? '33' : '0';
        lines.push(ESC + color + 'm' + (focus === index ? ESC + '7m' : '') + text + ESC + '0m');
      }
      if (maxLines > 2) {
        const help = message || `↑↓ 둘러보기 · ${multiple ? 'Space 선택 · ' : ''}Enter 확인 · Esc/q 취소`;
        const position = items.length > capacity ? `${focus + 1}/${items.length} · ` : '';
        lines.push(truncate(position + help, columns));
      }
      clearFrame();
      output.write(lines.join('\r\n'));
      frameLines = lines.length;
    }
    function finish(value = null) {
      if (done) return;
      done = true;
      clearTimeout(escapeTimer);
      input.off('data', onData);
      input.off('end', cancel);
      input.off('close', cancel);
      input.off('error', cancel);
      output.off('resize', draw);
      output.off('close', cancel);
      output.off('error', cancel);
      signal?.removeEventListener('abort', cancel);
      try { input.setRawMode(previousRaw); } catch { /* The terminal may already be closed. */ }
      if (previousFlowing) input.resume(); else input.pause();
      try { clearFrame(); output.write(ESC + '0m' + ESC + '?25h'); } catch { /* Closed output. */ }
      resolve(value);
    }
    const cancel = () => finish(null);
    function key(value) {
      if (value === 'q' || value === '\x03' || value === '\x1b') return finish(null);
      if (value === '\r' || value === '\n') {
        if (items[focus].disabled && (!multiple || (!selected.size && selectFocusedOnEmpty))) {
          message = '선택할 수 없는 항목입니다.';
          draw();
          return;
        }
        if (!multiple) return finish([items[focus].value]);
        if (!selected.size && selectFocusedOnEmpty) selected.add(items[focus].value);
        if (selected.size) return finish(items.filter(item => selected.has(item.value) && !item.disabled).map(item => item.value));
        message = 'Space로 항목을 선택해 주세요.';
      } else if (value === ' ' && multiple) {
        if (items[focus].disabled) {
          message = '선택할 수 없는 항목입니다.';
          draw();
          return;
        }
        const current = items[focus].value;
        if (selected.has(current)) selected.delete(current); else selected.add(current);
        message = '';
      } else {
        if (value === 'up') focus = (focus + items.length - 1) % items.length;
        else if (value === 'down') focus = (focus + 1) % items.length;
        else if (value === 'home') focus = 0;
        else if (value === 'end') focus = items.length - 1;
        else return;
        message = '';
      }
      draw();
    }
    function onData(chunk) {
      pending += chunk.toString();
      clearTimeout(escapeTimer);
      while (pending && !done) {
        if (pending[0] !== '\x1b') { const value = pending[0]; pending = pending.slice(1); key(value); continue; }
        if (pending === '\x1b' || /^\x1b(?:\[[0-9;]*|O)$/.test(pending)) {
          escapeTimer = setTimeout(() => key('\x1b'), 60);
          return;
        }
        const sequence = pending.match(/^\x1b(?:\[[0-9;]*[A-Za-z~]|O[A-Za-z])/);
        if (!sequence) { key('\x1b'); return; }
        pending = pending.slice(sequence[0].length);
        const command = sequence[0].slice(2);
        const action = { A: 'up', B: 'down', H: 'home', F: 'end', '1~': 'home', '7~': 'home', '4~': 'end', '8~': 'end' }[command];
        if (action) key(action);
      }
    }
    input.on('data', onData);
    input.on('end', cancel);
    input.on('close', cancel);
    input.on('error', cancel);
    output.on('resize', draw);
    output.on('close', cancel);
    output.on('error', cancel);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      input.setRawMode(true);
      output.write(ESC + '?25l');
      draw();
      input.resume();
    } catch { finish(null); }
  });
}
