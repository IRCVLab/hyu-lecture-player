import {chmod,mkdir,readFile,writeFile,rename,open,unlink,appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {ensureLogin,loadCredentials,promptCredentials} from './auth.mjs';
import {LMS,discoverCourses,readInventory,verifyCompletion} from './browser.mjs';
import {selectEntries} from './selection.mjs';
import {playEntry,runQueue} from './player.mjs';
import {parseOptions} from './options.mjs';
import {choosePlan,chooseAccount} from './terminal.mjs';
import {checkSetup,formatSetupReport} from './setup.mjs';
import {formatStatus,formatPlanSummary,createConsoleReporter} from './presentation.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const privateDir=join(root,'.private');
const statusPath=join(privateDir,'status.json');
const lockPath=join(privateDir,'run.lock');
let context,ownsLock=false,stopping=false;
const cancellation=new AbortController();
const state={pid:process.pid,startedAt:new Date().toISOString(),phase:'starting',results:[]};
let writes=Promise.resolve();
let statusWrites=Promise.resolve();
const report=createConsoleReporter();
function log(message) {
  const line=`[${new Date().toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})}] ${message}`;
  report(line);
  writes=writes.then(()=>appendFile(join(privateDir,'run.log'),line+'\n',{mode:0o600}));
}
function saveStatus() {
  state.updatedAt=new Date().toISOString();
  const json=JSON.stringify(state,null,2);
  statusWrites=statusWrites.then(async()=>{
    const temporary=`${statusPath}.${process.pid}.tmp`;
    await writeFile(temporary,json,{mode:0o600});
    await rename(temporary,statusPath);
  });
  return statusWrites;
}
function alive(pid) {
  if(!Number.isInteger(pid)||pid<1) return false;
  try {process.kill(pid,0);return true;} catch(e) {return e.code==='EPERM';}
}
async function acquireLock() {
  try {
    const file=await open(lockPath,'wx',0o600);
    await file.writeFile(String(process.pid));await file.close();ownsLock=true;
  } catch(error) {
    if(error.code!=='EEXIST') throw error;
    const pid=Number(await readFile(lockPath,'utf8'));
    if(!Number.isInteger(pid)||pid<1) throw new Error('다른 실행이 초기화 중이거나 잠금 기록이 불완전합니다. 잠시 후 다시 확인하세요.');
    if(alive(pid)) throw new Error(`이미 실행 중입니다 (PID ${pid}). ./run.sh --status로 확인하세요.`);
    await unlink(lockPath);
    const file=await open(lockPath,'wx',0o600);
    await file.writeFile(String(process.pid));await file.close();ownsLock=true;
  }
}

async function main() {
  const options=parseOptions(process.argv.slice(2));
  if(options.help) {
    console.log('메뉴 조작: ↑↓ 이동 · Space 선택/해제 · Enter 확정 · Esc/q 취소\n필요한 미완료 주차는 기본 체크·강조됩니다. 일반 터미널에서는 번호 입력이 필요 없습니다.');
    console.log(`한양대 주차별 강의 자동 재생 (브라우저 표시)\n\n./run.sh                         로그인 → 과목 → 추천 주차 → 보기\n./run.sh --check                 설치·화면 환경 점검 (로그인/재생 없음)\n./run.sh --course ID --weeks 1 2  지정 과목/주차 순차 재생\n./run.sh --course ID --current   지정 과목의 이번 주차\n./run.sh --list                  재생 없이 과목/주차 목록 확인\n./run.sh --status                읽기 쉬운 현재/마지막 실행 결과\n./run.sh --status --json         상세 JSON 결과\n\nWindows: run.cmd / macOS: run.command도 사용할 수 있습니다.\n--course all: 현재 수강 과목 전체. --non-interactive: 터미널 질문 없이 지정 옵션으로 실행.\n완료된 영상은 제외합니다. 한 번에 한 영상만 정상 속도로 끝까지 재생한 뒤 LMS 완료 표시를 확인합니다.\n중단: Ctrl+C. 다시 실행하면 서버의 최신 완료 상태를 확인합니다.`);
    return;
  }
  if(options.status) {
    try {const saved=JSON.parse(await readFile(statusPath,'utf8'));const processAlive=alive(saved.pid);
      console.log(options.json?JSON.stringify({...saved,processAlive},null,2):formatStatus(saved,{processAlive}));}
    catch(e) {if(e.code==='ENOENT') console.log('아직 실행 기록이 없습니다.');else throw e;}
    return;
  }
  const setup=await checkSetup({projectDir:root,privateDir});
  if(options.check||!setup.ok) console.log(formatSetupReport(setup));
  if(!setup.ok) {process.exitCode=1;return;}
  if(options.check) return;
  console.log('\nHYU Lecture Player — 로그인 → 과목 → 주차 추천 → 보기\n환경 점검 통과. Chrome을 여는 중…');
  let chromium;
  try {({chromium}=await import('playwright'));}
  catch {throw new Error('필요한 패키지가 없습니다. 실행 파일(run.sh/run.cmd/run.command)로 시작하거나 npm ci를 실행하세요.');}
  await mkdir(privateDir,{recursive:true,mode:0o700});await chmod(privateDir,0o700);
  await acquireLock();
  state.options=options;
  await saveStatus();
  context=await chromium.launchPersistentContext(join(privateDir,'profile'),{
    executablePath:setup.executablePath,headless:false,viewport:{width:1400,height:1000},
  });
  context.setDefaultTimeout(30000);
  const page=context.pages()[0]||await context.newPage();
  for(const extra of context.pages().slice(1)) await extra.close();
  const response=await page.goto(`${LMS}/courses`,{waitUntil:'domcontentloaded'});
  if(response?.status()===401) await page.goto(`${LMS}/login?return_to=%2Fcourses`,{waitUntil:'domcontentloaded'});
  state.phase='login';await saveStatus();
  let credentials;
  if(!await loadCredentials(privateDir)&&page.url().startsWith('https://api.hanyang.ac.kr/oauth/login')&&!options.nonInteractive)
    credentials=await promptCredentials({signal:cancellation.signal});
  const selectAccount=options.nonInteractive?undefined:async (accounts,{signal})=>{
    const selected=await chooseAccount(accounts,{signal});
    if(selected===null) throw new Error('계정 선택을 취소했습니다.');
    return selected;
  };
  await ensureLogin(page,{privateDir,log,credentials,selectAccount,signal:cancellation.signal});
  log('학생 계정 로그인 확인');
  state.phase='inventory';await saveStatus();
  const available=await discoverCourses(page);
  if(!available.length) throw new Error('현재 학생으로 수강 중인 과목을 찾지 못했습니다. 계정을 확인하세요.');
  let courses=available,all=[],weeks=options.weeks,recommendedSelection;
  const explicit=options.course&&(options.weeks||options.current||options.list);
  if(explicit||options.nonInteractive) {
    if(!options.course) throw new Error('--course ID|all을 지정하세요.');
    courses=available.filter(c=>options.course==='all'||c.id===options.course);
    if(!courses.length) throw new Error('지정한 과목이 현재 수강 목록에 없습니다.');
    for(const course of courses) all.push(...await readInventory(page,course));
  } else {
    const candidates=options.course&&options.course!=='all'?available.filter(c=>c.id===options.course):available;
    const plan=await choosePlan(candidates,course=>readInventory(page,course),{list:options.list,signal:cancellation.signal});
    if(!plan) {state.phase='cancelled';await saveStatus();return;}
    courses=plan.courses;all=plan.entries;weeks=plan.weeks;recommendedSelection=plan.selected;
  }
  state.courses=courses;
  const selected=recommendedSelection??selectEntries(all,{weeks});
  state.selected=selected.map(({id,courseId,courseName,title,week,completed,attendance})=>({id,courseId,courseName,title,week,completed,attendance}));
  const pending=selected.filter(e=>!e.completed);
  if(explicit||options.nonInteractive) report(formatPlanSummary(selected));
  log(`영상 ${selected.length}개: 완료 ${selected.length-pending.length}개 제외, 재생 대상 ${pending.length}개`);
  for(const e of selected) log(`${e.completed?'[완료·제외]':'[재생 대상]'} ${e.courseName} ${e.week}주차 | ${e.title} | 출결: ${e.attendance}`);
  if(options.list) {state.phase='listed';await saveStatus();return;}
  if(!selected.length) {log('선택된 주차에 재생할 영상이 없습니다. --weeks로 주차를 지정할 수 있습니다.');state.phase='empty';await saveStatus();return;}
  state.phase='running';await saveStatus();
  await runQueue(selected,{
    log,
    refresh:async entry=>{
      state.current={id:entry.id,title:entry.title,courseId:entry.courseId,week:entry.week};state.progress=undefined;await saveStatus();
      const fresh=(await readInventory(page,courses.find(c=>c.id===entry.courseId))).find(r=>r.id===entry.id);
      if(fresh&&!fresh.completed) {
        try {selectEntries([fresh],{weeks:[entry.week]});}
        catch {throw new Error(`최신 공개·출석·열람 일정을 확인할 수 없거나 재생 가능한 기간이 아닙니다: ${entry.title}. LMS를 확인하고 다시 선택하세요.`);}
      }
      return fresh;
    },
    play:entry=>playEntry(page,entry,{log:message=>{log(message);state.progress=message;void saveStatus();}}),
    verify:entry=>verifyCompletion(page,entry,{log}),
    onResult:async(result)=>{state.results.push(result);await saveStatus();},
  });
  state.phase='final-verification';await saveStatus();
  const finalRows=[];
  for(const course of courses) finalRows.push(...await readInventory(page,course));
  state.final=selected.map(entry=>{
    const final=finalRows.find(r=>r.courseId===entry.courseId&&r.id===entry.id);
    return {id:entry.id,courseId:entry.courseId,title:entry.title,week:entry.week,completed:final?.completed===true,attendance:final?.attendance||'미확인'};
  });
  const incomplete=state.final.filter(r=>!r.completed);
  state.phase=incomplete.length?'unverified':'completed';
  log(`최종 확인: 완료 ${state.final.length-incomplete.length}/${state.final.length}개${incomplete.length?' — 미확인 영상은 --status 참조':''}`);
  await saveStatus();
  report(formatStatus(state,{processAlive:true}));
  if(incomplete.length) process.exitCode=2;
}

async function stop() {
  if(stopping) return;stopping=true;
  cancellation.abort();
  state.phase='interrupted';
  await saveStatus().catch(()=>{});
  await context?.close().catch(()=>{});
}
process.on('SIGINT',()=>void stop());
process.on('SIGTERM',()=>void stop());
try {await main();}
catch(error) {
  // Avoid Playwright stack traces with token-bearing URLs or field values.
  const message=String(error.message).split('\n')[0].replace(/https?:\/\/\S+/g,'[URL]');
  console.error(`오류: ${message}`);
  report('다시 실행하면 이미 완료된 영상은 건너뜁니다. 설치 문제는 --check로 확인하세요.');
  if(ownsLock) {state.phase=stopping?'interrupted':'error';state.error=message;await saveStatus().catch(()=>{});}
  process.exitCode=1;
} finally {
  await context?.close().catch(()=>{});
  if(ownsLock) await unlink(lockPath).catch(()=>{});
  await writes.catch(()=>{});
  await statusWrites.catch(()=>{});
}
