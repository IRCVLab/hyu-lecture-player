import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveCredentials, loadCredentials, ensureLogin, promptCredentials } from '../auth.mjs';
import { PassThrough } from 'node:stream';
import { chromium } from 'playwright';

async function vault(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hyu-auth-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('credential vault roundtrip, replacement, encryption and restrictive permissions', async t => {
  const dir = await vault(t);
  const credentials = { userId: 'test-student', password: 'test-password-secret' };
  await saveCredentials(dir, credentials);
  assert.deepEqual(await loadCredentials(dir), credentials);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  for (const name of ['credential.key', 'credentials.enc']) {
    assert.equal((await stat(join(dir, name))).mode & 0o777, 0o600);
    assert.equal((await readFile(join(dir, name))).includes(Buffer.from(credentials.password)), false);
  }
  await saveCredentials(dir, { ...credentials, password: 'replacement' });
  assert.equal((await loadCredentials(dir)).password, 'replacement');
});

test('missing vault returns null; incomplete, corrupt and invalid credentials fail safely', async t => {
  const dir = await vault(t);
  assert.equal(await loadCredentials(dir), null);
  await assert.rejects(saveCredentials(dir, { userId: '', password: 'x' }), /아이디/);
  await writeFile(join(dir, 'credential.key'), 'invalid');
  await assert.rejects(loadCredentials(dir), /불완전/);
  await writeFile(join(dir, 'credentials.enc'), 'invalid');
  await assert.rejects(loadCredentials(dir), /손상/);
});

test('authenticated encryption rejects altered ciphertext', async t => {
  const dir = await vault(t);
  await saveCredentials(dir, { userId: 'student', password: 'secret' });
  const path = join(dir, 'credentials.enc');
  const envelope = JSON.parse(await readFile(path, 'utf8'));
  const ciphertext = Buffer.from(envelope.data, 'base64');
  ciphertext[0] ^= 1;
  envelope.data = ciphertext.toString('base64');
  await writeFile(path, JSON.stringify(envelope));
  await assert.rejects(loadCredentials(dir), /손상/);
});

const loginUrl = 'https://api.hanyang.ac.kr/oauth/login';
const chooserUrl = 'https://hy-mooc.hanyang.ac.kr/xn-sso/customs/pages/oauthcallback.php';

async function browserFixture(t, html, url = loginUrl) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto(url);
  return page;
}

test('login uses credentials once and aborts on failure dialog without exposing dialog text', async t => {
  const dir = await vault(t);
  await saveCredentials(dir, { userId: 'student', password: 'secret' });
  const page = await browserFixture(t, '<input id="uid"><input id="upw"><button id="login_btn" onclick="window.attempts=(window.attempts||0)+1;alert(\'secret authentication failed\')">Login</button>');
  await assert.rejects(ensureLogin(page, { privateDir: dir, timeoutMs: 2000 }), error => /로그인/.test(error.message) && !error.message.includes('secret'));
  assert.equal(await page.evaluate(() => window.attempts), 1);
});

test('course URL alone is not authenticated; visible course UI is required', async t => {
  const dir = await vault(t);
  const page = await browserFixture(t, '<p>OAuth pending</p>', 'https://learning.hanyang.ac.kr/courses?token=secret');
  await assert.rejects(ensureLogin(page, { privateDir: dir, timeoutMs: 100 }), /시간/);
  await page.setContent('<a href="/courses/220341">Course</a>');
  await ensureLogin(page, { privateDir: dir, timeoutMs: 500 });
});

test('unique master account is selected, ambiguous accounts wait for manual selection', async t => {
  const dir = await vault(t);
  const page = await browserFixture(t, '<button onclick="location.href=\'https://learning.hanyang.ac.kr/courses\'">(석사) student</button><a href="/courses/220341">Course</a>', chooserUrl);
  await ensureLogin(page, { privateDir: dir, timeoutMs: 2000 });
  await page.goto(chooserUrl);
  await page.setContent('<button onclick="window.clicked=true">(석사) A</button><button onclick="window.clicked=true">(석사) B</button>');
  await assert.rejects(ensureLogin(page, { privateDir: dir, timeoutMs: 100 }), /시간/);
  assert.equal(await page.evaluate(() => window.clicked), undefined);
});

test('ambiguous account selection after credential submission requests manual action', async t => {
  const dir = await vault(t);
  await saveCredentials(dir, { userId: 'student', password: 'secret' });
  const page = await browserFixture(t, `<input id="uid"><input id="upw"><button id="login_btn" onclick="location.href='${chooserUrl}'">Login</button><button>(석사) A</button><button>(석사) B</button>`);
  const messages = [];
  await assert.rejects(ensureLogin(page, { privateDir: dir, timeoutMs: 1500, log: message => messages.push(message) }), /시간/);
  assert.ok(messages.some(message => message.includes('직접 선택')));
});

test('unexpected origin or authentication path never receives stored credentials or account clicks', async t => {
  const dir = await vault(t);
  await saveCredentials(dir, { userId: 'student', password: 'secret' });
  const html = '<input id="uid"><input id="upw"><button id="login_btn" onclick="window.submitted=true">Login</button><button onclick="window.chosen=true">(석사) account</button>';
  const page = await browserFixture(t, html, 'https://evil.example/oauth/login');
  for (const url of ['https://evil.example/oauth/login', 'https://api.hanyang.ac.kr/unexpected', 'https://hy-mooc.hanyang.ac.kr/unexpected']) {
    await page.goto(url);
    await assert.rejects(ensureLogin(page, { privateDir: dir, timeoutMs: 1000 }), /시간/);
    assert.equal(await page.locator('#uid').inputValue(), '');
    assert.equal(await page.locator('#upw').inputValue(), '');
    assert.equal(await page.evaluate(() => window.submitted), undefined);
    assert.equal(await page.evaluate(() => window.chosen), undefined);
  }
});

test('new credentials persist only after verified successful login', async t => {
  const dir = await vault(t);
  const credentials = { userId: 'student', password: 'secret' };
  const page = await browserFixture(t, '<input id="uid"><input id="upw"><button id="login_btn" onclick="alert(\'failed\')">Login</button>');
  await assert.rejects(ensureLogin(page, { privateDir: dir, credentials, timeoutMs: 2000 }), /로그인/);
  assert.equal(await loadCredentials(dir), null);
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<a href="/courses/22">Course</a>' }));
  await page.setContent('<input id="uid"><input id="upw"><button id="login_btn" onclick="location.href=\'https://learning.hanyang.ac.kr/courses\'">Login</button>');
  await ensureLogin(page, { privateDir: dir, credentials, timeoutMs: 3000 });
  assert.deepEqual(await loadCredentials(dir), credentials);
});

test('general student account selection supports undergraduates and callback selection including assistant role', async t => {
  const page = await browserFixture(t, '<button onclick="location.href=\'https://learning.hanyang.ac.kr/courses\'">(학부) student</button><a href="/courses/22">Course</a>', chooserUrl);
  await ensureLogin(page, { timeoutMs: 2000 });
  await page.goto(chooserUrl);
  await page.setContent('<button>(학부) A</button><button>(박사) B</button><button onclick="location.href=\'https://learning.hanyang.ac.kr/courses\'">(조교) C</button><button>취소</button><a href="/privacy">개인정보</a>');
  let offered;
  await ensureLogin(page, { timeoutMs: 2000, selectAccount: async options => { offered = options; return options.find(option => option.label.includes('조교')).index; } });
  assert.equal(offered.length, 3);
  assert.equal(offered.some(option => /취소|개인정보/.test(option.label)), false);
});

test('credential terminal prompt does not echo password and rejects closed input', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let transcript = '';
  output.on('data', chunk => { transcript += chunk; });
  const pending = promptCredentials({ input, output });
  input.write('student\n');
  await new Promise(resolve => setImmediate(resolve));
  input.write('top-secret\n');
  assert.deepEqual(await pending, { userId: 'student', password: 'top-secret' });
  assert.equal(transcript.includes('top-secret'), false);
  const closedInput = new PassThrough();
  const cancelled = promptCredentials({ input: closedInput, output: new PassThrough() });
  closedInput.end();
  await assert.rejects(cancelled, /취소/);
});

test('interactive password entry stays hidden and Ctrl-C restores terminal mode', async () => {
  for (const cancel of [false, true]) {
    const input = new PassThrough();
    input.isTTY = true;
    let raw = false;
    input.setRawMode = value => { raw = value; };
    const output = new PassThrough();
    let transcript = '';
    output.on('data', chunk => { transcript += chunk; });
    const pending = promptCredentials({ input, output });
    input.write('student\r');
    await new Promise(resolve => setImmediate(resolve));
    input.write(cancel ? 'hidden-secret\u0003' : 'hidden-secret\r');
    if (cancel) await assert.rejects(pending, /취소/);
    else assert.equal((await pending).password, 'hidden-secret');
    assert.equal(transcript.includes('hidden-secret'), false);
    assert.equal(raw, false);
  }
});

test('authenticated root dashboard returns to courses; unauthenticated root does not navigate', async t => {
  const page = await browserFixture(t, '<a id="global_nav_profile_link">Account</a><a href="/courses/22">Course</a>', 'https://learning.hanyang.ac.kr/');
  await ensureLogin(page, { timeoutMs: 2000 });
  assert.equal(new URL(page.url()).pathname, '/courses');
  await page.goto('https://learning.hanyang.ac.kr/');
  await page.setContent('<title>Dashboard</title><p>Please log in</p>');
  await assert.rejects(ensureLogin(page, { timeoutMs: 300 }), /시간/);
  assert.equal(new URL(page.url()).pathname, '/');
});

test('account callback receives an aborted signal on timeout', async t => {
  const page = await browserFixture(t, '<button>(학부) A</button><button>(석사) B</button>', chooserUrl);
  let callbackSignal;
  await assert.rejects(ensureLogin(page, { timeoutMs: 500, selectAccount: async (_options, context) => {
    callbackSignal = context?.signal;
    await new Promise(() => {});
  } }), /시간/);
  assert.ok(callbackSignal);
  assert.equal(callbackSignal.aborted, true);
});

test('external cancellation interrupts pending account selection and aborts its signal', async t => {
  const page = await browserFixture(t, '<button>(학부) A</button><button>(석사) B</button>', chooserUrl);
  const controller = new AbortController();
  let callbackSignal;
  await assert.rejects(ensureLogin(page, { timeoutMs: 2000, signal: controller.signal, selectAccount: async (_options, context) => {
    callbackSignal = context?.signal;
    controller.abort();
    await new Promise(() => {});
  } }), /취소/);
  assert.equal(callbackSignal.aborted, true);
});

test('credential prompt external abort settles at ID or password and restores terminal state', async () => {
  for (const passwordStage of [false, true]) {
    const input = new PassThrough();
    input.isTTY = true;
    let raw = false;
    input.setRawMode = value => { raw = value; };
    const output = new PassThrough();
    let transcript = '';
    output.on('data', chunk => { transcript += chunk; });
    const controller = new AbortController();
    const pending = promptCredentials({ input, output, signal: controller.signal });
    if (passwordStage) {
      input.write('student\r');
      await new Promise(resolve => setImmediate(resolve));
      input.write('hidden-secret');
    }
    controller.abort();
    await assert.rejects(Promise.race([pending, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('abort did not settle prompt')), 500);
      timer.unref();
    })]), /취소/);
    assert.equal(raw, false);
    assert.equal(transcript.includes('hidden-secret'), false);
    assert.equal(input.listenerCount('keypress'), 0);
    assert.equal(input.isPaused(), true);
  }
});
