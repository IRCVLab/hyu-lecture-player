import {access as fsAccess} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname, join, resolve, win32} from 'node:path';
import {fileURLToPath} from 'node:url';

function chromeCandidates(platform, env) {
  if (platform === 'win32') return [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]
    .filter(Boolean).map(root => win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ...(env.HOME ? [join(env.HOME, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')] : [])];
  if (platform === 'linux') return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'];
  return [];
}

// Read-only checks: never opens Chrome, creates private data, or installs software.
export async function checkSetup({platform = process.platform, env = process.env,
  nodeVersion = process.versions.node, projectDir = dirname(fileURLToPath(import.meta.url)),
  privateDir = join(projectDir, '.private'), access = fsAccess} = {}) {
  const checks = [];
  const nodeOK = Number(nodeVersion.split('.')[0]) >= 22;
  checks.push({id:'node', ok:nodeOK, message:`Node.js ${nodeVersion}`, ...(!nodeOK && {remedy:'Node.js 22 이상 LTS를 https://nodejs.org/ 에서 설치한 뒤 터미널을 다시 여세요.'})});
  let executablePath;
  for (const candidate of chromeCandidates(platform, env)) {
    try { await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK); executablePath = candidate; break; } catch {}
  }
  checks.push({id:'chrome', ok:!!executablePath, message:executablePath ? `Chrome: ${executablePath}` : 'Chrome을 찾을 수 없습니다.',
    ...(!executablePath && {remedy:'https://www.google.com/chrome/ 에서 Google Chrome을 기본 위치에 설치하세요.'})});
  if (platform === 'linux') {
    const ok = !!(env.DISPLAY || env.WAYLAND_DISPLAY);
    checks.push({id:'display',ok,message:ok ? '그래픽 화면 환경이 설정되어 있습니다.' : '그래픽 화면 환경이 없습니다.',
      ...(!ok && {remedy:'Linux 데스크톱에 로그인한 후 터미널에서 실행하세요. SSH만 연결된 환경에서는 Chrome 화면을 열 수 없습니다.'})});
  }
  let storageOK = true;
  try {
    await access(projectDir, constants.W_OK);
    try { await access(privateDir, constants.F_OK); }
    catch (error) { if (error.code === 'ENOENT') privateDir = projectDir; else throw error; }
    await access(privateDir, constants.W_OK);
  } catch { storageOK = false; }
  checks.push({id:'storage',ok:storageOK,message:storageOK ? '프로그램과 개인 데이터 저장 위치에 쓰기 권한이 있습니다.' : '저장 위치의 쓰기 권한을 확인할 수 없습니다.',
    ...(!storageOK && {remedy:'압축을 완전히 풀고 내 문서 등 쓰기 가능한 폴더로 프로그램을 옮긴 후 다시 실행하세요.'})});
  return {ok:checks.every(check=>check.ok),executablePath,checks};
}

export function formatSetupReport(result) {
  return ['실행 환경 확인', ...result.checks.flatMap(check => [`${check.ok ? '✓' : '✗'} ${check.message}`, ...(check.remedy ? [`  해결: ${check.remedy}`] : [])]),
    result.ok ? '준비되었습니다. 실행 파일을 다시 열어 시작하세요.' : '위 항목을 해결한 뒤 --check를 다시 실행하세요.'].join('\n');
}

export async function runSetup(options = {}) {
  const result = await checkSetup(options);
  console.log(formatSetupReport(result));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSetup().then(result => {process.exitCode = result.ok ? 0 : 1;}).catch(error => {
    console.error(`환경 확인 실패: ${error.message}`); process.exitCode = 1;
  });
}
