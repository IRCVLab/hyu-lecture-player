import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,copyFile,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'hyu-cli-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  for(const file of await readdir(root)) if(file.endsWith('.mjs')) await copyFile(new URL(file,root),join(dir,file));
  return dir;
}
function run(dir,args,env=process.env) {return spawnSync(process.execPath,['cli.mjs',...args],{cwd:dir,encoding:'utf8',env,timeout:10000});}
test('help and readable status work without Playwright installed',async t=>{
  const dir=await fixture(t);
  const help=run(dir,['--help']);assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/--check/);
  assert.match(help.stdout,/↑↓.*Space.*Enter/);
  await mkdir(join(dir,'.private'));
  await writeFile(join(dir,'.private/status.json'),JSON.stringify({phase:'completed',pid:99999999,selected:[],final:[{id:'1',completed:true,attendance:'결석'}]}));
  const human=run(dir,['--status']);assert.equal(human.status,0,human.stderr);assert.match(human.stdout,/LMS 완료 1\/1개/);
  const json=run(dir,['--status','--json']);assert.equal(json.status,0,json.stderr);assert.equal(JSON.parse(json.stdout).phase,'completed');
  await assert.rejects(access(join(dir,'.private/run.lock')));
});
test('setup check works without Playwright and never creates private data',async t=>{
  const dir=await fixture(t);
  const env={...process.env,DISPLAY:'',WAYLAND_DISPLAY:''};
  const result=run(dir,['--check'],env);
  assert.doesNotMatch(result.stderr,/ERR_MODULE_NOT_FOUND/);
  assert.match(result.stdout,/Node/);
  if(process.platform==='linux') {assert.equal(result.status,1);assert.match(result.stdout,/데스크톱|DISPLAY/);}
  await assert.rejects(access(join(dir,'.private')));
});

test('offline full CLI carries per-course recommendation through final verification',async t=>{
  const dir=await fixture(t);
  // Boundary fixtures replace external login/browser/media only. The real CLI and picker run unchanged.
  await writeFile(join(dir,'setup.mjs'),`export async function checkSetup(){return {ok:true,executablePath:'fixture'}};export function formatSetupReport(){return 'fixture'};`);
  await writeFile(join(dir,'auth.mjs'),`export async function ensureLogin(){};export async function loadCredentials(){return {}};export async function promptCredentials(){throw Error('unexpected prompt')};`);
  await writeFile(join(dir,'browser.mjs'),`
    export const LMS='https://fixture.invalid';
    export const rows=[{id:'a1',courseId:'a',courseName:'통계',week:1},{id:'b2',courseId:'b',courseName:'영화',week:2}].map(r=>({...r,kind:'video',completed:false,durationSeconds:60,startsAt:'2020-01-01',dueAt:'2020-02-01',endsAt:'2099-01-01'}));
    export async function discoverCourses(){return [{id:'a',name:'통계'},{id:'b',name:'영화'}]};
    const reads={};
    export async function readInventory(page,course){
      reads[course.id]=(reads[course.id]||0)+1;
      if(course.id==='a'&&reads.a===2&&process.env.HYU_TEST_INVALID_REFRESH){
        const mode=process.env.HYU_TEST_INVALID_REFRESH;
        if(mode==='missing')rows[0].startsAt=null;
        if(mode==='future')rows[0].startsAt='2098-01-01';
        if(mode==='expired')rows[0].endsAt='2020-01-01';
      }
      return rows.filter(r=>r.courseId===course.id);
    };
    export async function verifyCompletion(page,entry){return entry};
  `);
  await writeFile(join(dir,'player.mjs'),`
    import {rows} from './browser.mjs';
    export async function playEntry(){};
    export async function runQueue(selected,options){
      if(selected.map(r=>r.id).join(',')!=='a1,b2')throw Error('recommendation lost');
      for(const entry of selected){await options.refresh(entry);await options.play(entry);rows.find(r=>r.id===entry.id).completed=true;await options.onResult({...entry,status:'completed'});}
    };
  `);
  const dependency=join(dir,'node_modules/playwright');await mkdir(dependency,{recursive:true});
  await writeFile(join(dependency,'package.json'),JSON.stringify({type:'module',exports:'./index.mjs'}));
  await writeFile(join(dependency,'index.mjs'),`
    const page={goto:async()=>({status:()=>200}),url:()=> 'https://fixture.invalid/courses'};
    export const chromium={launchPersistentContext:async()=>({setDefaultTimeout(){},pages:()=>[page],close:async()=>{}})};
  `);
  const result=spawnSync(process.execPath,['cli.mjs'],{cwd:dir,encoding:'utf8',input:'all\n\n보기\n',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/LMS 완료 2\/2개/);
  const {readFile}=await import('node:fs/promises');
  const state=JSON.parse(await readFile(join(dir,'.private/status.json'),'utf8'));
  assert.equal(state.phase,'completed');assert.deepEqual(state.final.map(r=>r.week),[1,2]);
  await assert.rejects(access(join(dir,'.private/run.lock')));
  for(const mode of ['missing','future','expired']) {
    const changed=spawnSync(process.execPath,['cli.mjs'],{cwd:dir,encoding:'utf8',input:'all\n\n보기\n',timeout:10000,
      env:{...process.env,HYU_TEST_INVALID_REFRESH:mode}});
    assert.equal(changed.status,1,`fresh ${mode} schedule must stop before playback`);
    const failed=JSON.parse(await readFile(join(dir,'.private/status.json'),'utf8'));
    assert.equal(failed.phase,'error');assert.equal(failed.results.length,0);
  }
});
