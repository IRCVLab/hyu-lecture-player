import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, copyFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const setup = await import('../setup.mjs').catch(() => ({}));

test('setup exports dependency-free API', () => assert.equal(typeof setup.checkSetup, 'function'));
test('setup reports actionable failures without opening a browser', async () => {
  const report = await setup.checkSetup({nodeVersion:'20.9.0', platform:'linux', env:{}, projectDir:'/project', access:async()=>{throw new Error('no');}});
  assert.equal(report.ok,false);
  for (const id of ['node','browser','display','storage']) assert.equal(report.checks.find(c=>c.id===id).ok,false);
  assert.match(setup.formatSetupReport(report), /nodejs.org/);
  assert.match(setup.formatSetupReport(report), /google.com\/chrome/);
});
test('finds executable Chrome on supported platforms and accepts Wayland', async () => {
  for(const [platform,path,env] of [
    ['linux','/usr/bin/google-chrome',{WAYLAND_DISPLAY:'wayland-0'}],
    ['darwin','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',{}],
    ['win32','C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',{ProgramFiles:'C:\\Program Files'}],
  ]) {
    const report=await setup.checkSetup({nodeVersion:'22.0.0',platform,env,projectDir:'/project',stat:async()=>({isFile:()=>true}),access:async(p)=>{if(p!==path&&p!=='/project')throw Object.assign(new Error('missing'),{code:'ENOENT'});}});
    assert.equal(report.ok,true,platform);
    assert.equal(report.executablePath,path);
  }
});

const browserLayouts = [
  ['chrome','Google Chrome','Google Chrome.app/Contents/MacOS/Google Chrome','Google/Chrome/Application/chrome.exe','google-chrome'],
  ['edge','Microsoft Edge','Microsoft Edge.app/Contents/MacOS/Microsoft Edge','Microsoft/Edge/Application/msedge.exe','microsoft-edge'],
  ['brave','Brave','Brave Browser.app/Contents/MacOS/Brave Browser','BraveSoftware/Brave-Browser/Application/brave.exe','brave-browser'],
  ['chromium','Chromium','Chromium.app/Contents/MacOS/Chromium','Chromium/Application/chrome.exe','chromium'],
];
function simulatedSetup(platform, env, files, overrides={}) {
  return setup.checkSetup({platform,env,nodeVersion:'22.0.0',projectDir:'/project',
    access:async path=>{if(path!=='/project'&&!files.includes(path))throw Object.assign(new Error('missing'),{code:'ENOENT'});},
    stat:async path=>({isFile:()=>files.includes(path)}),...overrides});
}
test('auto-detects four browsers in system and user app folders across platforms',async()=>{
  for(const [id,name,mac,windows,linux] of browserLayouts) {
    for(const [platform,path,env] of [
      ['darwin',`/Applications/${mac}`,{}],
      ['darwin',`/Users/test user/Applications/${mac}`,{HOME:'/Users/test user'}],
      ['win32',`C:\\Program Files\\${windows.replaceAll('/','\\')}`,{ProgramFiles:'C:\\Program Files'}],
      ['win32',`C:\\Users\\test user\\AppData\\Local\\${windows.replaceAll('/','\\')}`,{LOCALAPPDATA:'C:\\Users\\test user\\AppData\\Local'}],
      ['linux',`/usr/bin/${linux}`,{DISPLAY:':0'}],
    ]) {
      const result=await simulatedSetup(platform,env,[path]);
      assert.equal(result.ok,true,`${id} ${path}`);
      assert.equal(result.executablePath,path);
      assert.equal(result.browserId,id);
      assert.equal(result.browserName,name);
      assert.equal(result.profileDirectory,id==='chrome'?'profile':`profile-${id}`);
      assert.ok(setup.formatSetupReport(result).includes(name));
    }
  }
});
test('browser priority is Chrome then Edge then Brave then Chromium, regardless of install root',async()=>{
  const paths=browserLayouts.map((row,i)=>`${i===0?'/Users/test/Applications':'/Applications'}/${row[2]}`);
  for(let i=0;i<paths.length;i++) {
    const result=await simulatedSetup('darwin',{HOME:'/Users/test'},paths.slice(i));
    assert.equal(result.browserId,browserLayouts[i][0]);
  }
});
test('Linux PATH detection ignores relative and empty entries and does not accept directories',async()=>{
  const result=await simulatedSetup('linux',{DISPLAY:':0',PATH:':relative:.:/custom tools:/usr/bin'},
    ['relative/google-chrome','google-chrome','/custom tools/google-chrome','/custom tools/brave-browser'],
    {stat:async path=>({isFile:()=>path.endsWith('/brave-browser')})});
  assert.equal(result.browserId,'brave');
  assert.equal(result.executablePath,'/custom tools/brave-browser');
});
test('inaccessible candidates are skipped and duplicate paths are checked once',async()=>{
  const visited=[];
  const result=await simulatedSetup('linux',{DISPLAY:':0',PATH:'/usr/bin:/usr/bin'},[],{
    access:async path=>{visited.push(path);if(path.includes('chrome'))throw new Error('permission');},
    stat:async path=>({isFile:()=>path==='/usr/bin/microsoft-edge'}),
  });
  assert.equal(result.browserId,'edge');
  assert.equal(visited.filter(p=>p==='/usr/bin/google-chrome').length,1);
});
test('no browser reports supported choices without creating a profile or assuming Chrome',async()=>{
  const result=await simulatedSetup('darwin',{},[]);
  assert.equal(result.ok,false);
  assert.equal(result.executablePath,undefined);
  assert.equal(result.profileDirectory,undefined);
  assert.match(setup.formatSetupReport(result),/Chrome.*Edge.*Brave.*Chromium/);
});

async function fixture(t, files={}) {
  const dir=await mkdtemp(join(tmpdir(),'launcher with spaces '));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await copyFile(new URL('../run.sh',import.meta.url),join(dir,'run.sh'));
  await mkdir(join(dir,'bin'));
  for(const [name,body] of Object.entries(files)) await writeFile(join(dir,'bin',name),body,{mode:0o755});
  return dir;
}
test('shell launcher gives official guidance when node is missing',async(t)=>{
  const dir=await fixture(t);
  const result=spawnSync('/bin/bash',[join(dir,'run.sh'),'--check'],{env:{PATH:join(dir,'bin')},encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stdout+result.stderr,/nodejs.org/);
});
test('shell launcher rejects outdated node before npm or CLI',async(t)=>{
  const dir=await fixture(t,{node:'#!/bin/sh\nexit 1\n'});
  const result=spawnSync('/bin/bash',[join(dir,'run.sh'),'--check'],{env:{PATH:join(dir,'bin')},encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stdout+result.stderr,/22/);
});
test('shell check and help skip npm and preserve cwd and args',async(t)=>{
  const dir=await fixture(t,{node:'#!/bin/sh\nif [ "$1" = "-e" ]; then exit 0; fi\nprintf "%s\\n" "$PWD" "$@"\n'});
  for(const [arg,target] of [['--check','cli.mjs'],['--help','cli.mjs'],['--status','cli.mjs']]) {
    const result=spawnSync('/bin/bash',[join(dir,'run.sh'),arg,'value with spaces'],{env:{PATH:join(dir,'bin')},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'),[dir,target,arg,'value with spaces']);
  }
});
test('shell forwards check combinations unchanged for CLI validation',async(t)=>{
  const dir=await fixture(t,{node:'#!/bin/sh\nif [ "$1" = "-e" ]; then exit 0; fi\nprintf "%s\\n" "$@"\n'});
  for(const args of [['--check','--status'],['--check','--course','123']]) {
    const result=spawnSync('/bin/bash',[join(dir,'run.sh'),...args],{env:{PATH:join(dir,'bin')},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'),['cli.mjs',...args]);
  }
});
test('shell launcher explains npm absence and failed installation',async(t)=>{
  const dir=await fixture(t,{node:'#!/bin/sh\nexit 0\n'});
  let result=spawnSync('/bin/bash',[join(dir,'run.sh')],{env:{PATH:join(dir,'bin')},encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stdout+result.stderr,/npm.*nodejs.org/s);
  await writeFile(join(dir,'bin','npm'),'#!/bin/sh\nexit 9\n',{mode:0o755});
  result=spawnSync('/bin/bash',[join(dir,'run.sh')],{env:{PATH:join(dir,'bin')},encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stdout+result.stderr,/npm ci/);
  assert.match(result.stdout+result.stderr,/다시/);
});

test('standalone checker runs in a fresh directory with no dependencies',async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),'setup standalone '));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await copyFile(new URL('../setup.mjs',import.meta.url),join(dir,'setup.mjs'));
  const result=spawnSync(process.execPath,[join(dir,'setup.mjs')],{env:{...process.env,DISPLAY:'',WAYLAND_DISPLAY:''},encoding:'utf8'});
  assert.match(result.stdout,/실행 환경 확인/);
  assert.doesNotMatch(result.stderr,/ERR_MODULE_NOT_FOUND/);
  if(process.platform==='linux') assert.equal(result.status,1);
});

test('existing private directory without write permission fails storage check',async()=>{
  const result=await setup.checkSetup({nodeVersion:'22.0.0',platform:'linux',env:{DISPLAY:':0'},projectDir:'/project',access:async(path,mode)=>{
    if(path==='/project/.private'&&mode!==0)throw Object.assign(new Error('permission'),{code:'EACCES'});
  }});
  assert.equal(result.checks.find(check=>check.id==='storage').ok,false);
});
