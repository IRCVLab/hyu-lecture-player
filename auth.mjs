import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

export async function promptCredentials({ input = process.stdin, output = process.stdout, signal } = {}) {
  let muted = false;
  const terminalOutput = new Writable({ write(chunk, encoding, callback) {
    if (!muted) output.write(chunk, encoding);
    callback();
  } });
  const reader = createInterface({ input, output: terminalOutput, terminal: Boolean(input.isTTY), historySize: 0 });
  const ask = prompt => new Promise((resolve, reject) => {
    const cancel = () => { cleanup(); reject(new Error('로그인 입력이 취소되었습니다.')); };
    const cleanup = () => {
      reader.off('close', cancel);
      reader.off('SIGINT', cancel);
      signal?.removeEventListener('abort', cancel);
    };
    if (signal?.aborted) { cancel(); return; }
    reader.once('close', cancel);
    reader.once('SIGINT', cancel);
    signal?.addEventListener('abort', cancel, { once: true });
    reader.question(prompt, value => { cleanup(); resolve(value); });
  });
  try {
    const userId = (await ask('한양대학교 아이디: ')).trim();
    output.write('비밀번호 (화면에 표시되지 않음): ');
    muted = true;
    const password = await ask('');
    return validate({ userId, password });
  } finally {
    reader.close();
    muted = false;
    output.write('\n');
    terminalOutput.end();
  }
}

function validate(credentials) {
  if (!credentials || typeof credentials.userId !== 'string' || !credentials.userId.trim()
    || typeof credentials.password !== 'string' || !credentials.password) {
    throw new Error('아이디와 비밀번호를 입력해 주세요.');
  }
  return { userId: credentials.userId, password: credentials.password };
}

async function optionalRead(path) {
  try { return await readFile(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function privateWrite(path, value) {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, value, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

export async function saveCredentials(privateDir, credentials) {
  const normalized = validate(credentials);
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  await chmod(privateDir, 0o700);
  const keyPath = join(privateDir, 'credential.key');
  let key = await optionalRead(keyPath);
  if (key && key.length !== 32) throw new Error('저장된 인증 키가 손상되었습니다.');
  if (!key) {
    key = randomBytes(32);
    await writeFile(keyPath, key, { flag: 'wx', mode: 0o600 });
  }
  await chmod(keyPath, 0o600);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ version: 1, credentials: normalized }), 'utf8'), cipher.final()]);
  await privateWrite(join(privateDir, 'credentials.enc'), JSON.stringify({ version: 1,
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') }));
}

export async function loadCredentials(privateDir) {
  let key, token;
  try {
    [key, token] = await Promise.all([
      optionalRead(join(privateDir, 'credential.key')),
      optionalRead(join(privateDir, 'credentials.enc')),
    ]);
  } catch { throw new Error('저장된 인증 정보를 읽을 수 없습니다.'); }
  if (!key && !token) return null;
  if (!key || !token) throw new Error('저장된 인증 정보가 불완전합니다.');
  try {
    const envelope = JSON.parse(token.toString('utf8'));
    if (envelope.version !== 1 || key.length !== 32) throw new Error();
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
    if (payload.version !== 1) throw new Error();
    return validate(payload.credentials);
  } catch { throw new Error('저장된 인증 정보가 손상되었거나 유효하지 않습니다.'); }
}

// The portal page performs its own RSA credential transformation. Submit its UI
// once, without reproducing the registration application's HTTP operations.
export async function ensureLogin(page, { privateDir, log = () => {}, timeoutMs = 300000, credentials, selectAccount, signal } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('로그인 대기 시간을 올바르게 지정해 주세요.');
  const deadline = Date.now() + timeoutMs;
  let submitted = false;
  let chosenAccount = false;
  let prompted = false;
  let dialogFailure = false;
  const suppliedCredentials = credentials ? validate(credentials) : null;
  const onDialog = dialog => {
    dialogFailure = true;
    // Do not include dialog text: the portal may echo personal information.
    void dialog.dismiss().catch(() => {});
  };
  page.on('dialog', onDialog);
  const visible = locator => locator.isVisible().catch(() => false);
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('로그인이 취소되었습니다.');
      if (dialogFailure) throw new Error('로그인 안내 또는 실패 창이 표시되어 자동 로그인을 중단했습니다. 브라우저에서 계정 상태를 확인해 주세요.');
      if (page.isClosed()) throw new Error('로그인 중 브라우저가 닫혔습니다.');
      const url = new URL(page.url());
      if (url.origin === 'https://learning.hanyang.ac.kr' && url.pathname === '/') {
        const accountNavigation = page.locator('#global_nav_profile_link, #global_nav_dashboard_link').first();
        const courseLink = page.locator('a[href^="/courses/"]').first();
        if (await visible(accountNavigation) && await visible(courseLink)) {
          try {
            await page.goto('https://learning.hanyang.ac.kr/courses', {
              waitUntil: 'domcontentloaded', timeout: Math.max(1, deadline - Date.now()),
            });
          } catch { throw new Error('로그인 후 강좌 목록을 열지 못했습니다. 브라우저에서 확인해 주세요.'); }
          continue;
        }
      }
      if (url.origin === 'https://learning.hanyang.ac.kr' && url.pathname.startsWith('/courses')) {
        const courseUi = page.locator('a[href^="/courses/"], #course_home_content').first();
        if (await visible(courseUi)) {
          if (submitted && suppliedCredentials && privateDir) await saveCredentials(privateDir, suppliedCredentials);
          return;
        }
      }
      const isLoginPage = url.origin === 'https://api.hanyang.ac.kr' && url.pathname === '/oauth/login';
      if (isLoginPage && !submitted && await visible(page.locator('#uid')) && await visible(page.locator('#upw'))) {
        const loginCredentials = suppliedCredentials ?? (privateDir ? await loadCredentials(privateDir) : null);
        if (loginCredentials) {
          submitted = true;
          const actionTimeout = () => Math.max(1, Math.min(5000, deadline - Date.now()));
          try {
            await page.locator('#uid').fill(loginCredentials.userId, { timeout: actionTimeout() });
            await page.locator('#upw').fill(loginCredentials.password, { timeout: actionTimeout() });
            await page.locator('#login_btn').click({ timeout: actionTimeout(), noWaitAfter: true });
          } catch { throw new Error('로그인 화면을 처리하지 못했습니다. 브라우저에서 로그인 상태를 확인해 주세요.'); }
        }
      }
      const accountUrl = new URL(page.url());
      const isAccountPage = accountUrl.origin === 'https://hy-mooc.hanyang.ac.kr'
        && accountUrl.pathname === '/xn-sso/customs/pages/oauthcallback.php';
      if (isAccountPage && !chosenAccount) {
        const buttons = page.getByRole('button');
        const options = [];
        for (let index = 0; index < await buttons.count(); index++) {
          const button = buttons.nth(index);
          const label = ((await button.textContent()) ?? '').trim();
          if (await visible(button) && /학부|학사|석사|박사|학생|대학원|조교|교수|교직원|직원|연구원/.test(label)
            && !/취소|개인정보/.test(label)) options.push({ index, label });
        }
        const students = options.filter(option => /학부|학사|석사|박사|학생|대학원/.test(option.label) && !/조교|교수|교직원|직원|연구원/.test(option.label));
        let selected = students.length === 1 ? students[0].index : undefined;
        if (options.length && selected === undefined && selectAccount) {
          chosenAccount = true;
          let timer;
          const controller = new AbortController();
          const callbackSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
          let onAbort;
          try {
            const cancellation = new Promise((_, reject) => {
              onAbort = () => reject(new Error('계정 선택이 취소되었습니다.'));
              if (callbackSignal.aborted) onAbort();
              else callbackSignal.addEventListener('abort', onAbort, { once: true });
            });
            selected = await Promise.race([cancellation, Promise.resolve().then(() => {
              if (callbackSignal.aborted) throw new Error('계정 선택이 취소되었습니다.');
              return selectAccount(options, { signal: callbackSignal });
            }), new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('계정 선택 대기 시간이 초과되었습니다.')), Math.max(1, deadline - Date.now()));
            })]);
          } finally {
            clearTimeout(timer);
            callbackSignal.removeEventListener('abort', onAbort);
            controller.abort();
          }
        }
        if (signal?.aborted) throw new Error('로그인이 취소되었습니다.');
        if (selected !== undefined && selected !== null) {
          if (!options.some(option => option.index === selected)) throw new Error('선택한 계정이 유효하지 않습니다.');
          chosenAccount = true;
          try { await buttons.nth(selected).click({ timeout: Math.max(1, Math.min(5000, deadline - Date.now())), noWaitAfter: true }); }
          catch { throw new Error('계정 선택을 완료하지 못했습니다. 브라우저에서 확인해 주세요.'); }
        } else if (options.length && !prompted) {
          prompted = true;
          log('브라우저에서 사용할 계정을 직접 선택해 주세요.');
        }
      }
      if (!prompted && !submitted) {
        prompted = true;
        log('브라우저에서 로그인을 완료해 주세요. 계정 선택이 여러 개이면 사용할 계정을 직접 선택해 주세요.');
      }
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(200, deadline - Date.now()))));
    }
    throw new Error('로그인 대기 시간이 초과되었습니다. 브라우저에서 로그인과 계정 선택을 확인해 주세요.');
  } finally { page.off('dialog', onDialog); }
}
