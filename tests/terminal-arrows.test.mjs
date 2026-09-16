import test from 'node:test';
import assert from 'node:assert/strict';
import {Writable,Readable,PassThrough} from 'node:stream';
import * as terminal from '../terminal.mjs';

const now=new Date('2026-09-16T12:00:00+09:00');
const base={kind:'video',completed:false,courseId:'a',courseName:'통계',startsAt:'2026-09-01',dueAt:'2026-09-21',endsAt:'2026-12-21',durationSeconds:60};
const rows=[{...base,id:'old',week:1,dueAt:'2026-09-07'},
  {...base,id:'done',week:2,completed:true}, {...base,id:'current',week:3},
  {...base,id:'future',week:4,startsAt:'2026-09-22'}, {...base,id:'expired',week:5,endsAt:'2026-09-10'},
  {...base,id:'unknown',week:6,dueAt:null}, {...base,id:'b',courseId:'b',courseName:'영화',week:2}];

test('week menu prechecks playable pending pairs, focuses current ahead of overdue, disables others',()=>{
  assert.equal(typeof terminal.buildWeekChoices,'function');
  const model=terminal.buildWeekChoices(rows,{now});
  assert.deepEqual(model.initialSelected,['a:1','a:3','b:2']);
  assert.equal(model.items[model.initialIndex].value,'a:3');
  assert.equal(model.items.find(r=>r.value==='a:1').warning,true);
  assert.match(model.items.find(r=>r.value==='a:1').description,/마감 지남/);
  for(const key of ['a:2','a:4','a:5','a:6']) assert.equal(model.items.find(r=>r.value===key).disabled,true);
  assert.match(model.items.find(r=>r.value==='a:3').description,/미완료 1개/);
});

test('arrow wizard uses defaults and explicit final confirmation without numeric entry',async()=>{
  assert.equal(typeof terminal.chooseArrowPlan,'function');
  const prompts=[];const loaded=[];let text='';
  const courses=[{id:'a',name:'통계'},{id:'b',name:'영화'}];
  const menu=async options=>{
    prompts.push(options);
    if(prompts.length===1)return ['a','b'];
    if(prompts.length===2)return options.initialSelected;
    return ['play'];
  };
  const result=await terminal.chooseArrowPlan(courses,async course=>{loaded.push(course.id);return rows.filter(r=>r.courseId===course.id);},
    {menu,now,output:new Writable({write(c,e,d){text+=c;d();}})});
  assert.deepEqual(loaded,['a','b']);assert.equal(prompts.length,3);
  assert.equal(prompts[0].selectFocusedOnEmpty,true);
  assert.equal(prompts[1].multiple,true);
  assert.deepEqual(result.selected.map(r=>r.id),['old','current','b']);
  assert.match(text,/미완료 3개/);assert.match(text,/출석 기한이 지난 영상 1개/);
});

test('arrow wizard respects manual unchecking and does not include invalid rows sharing a week',async()=>{
  assert.equal(typeof terminal.chooseArrowPlan,'function');
  let count=0;let text='';
  const result=await terminal.chooseArrowPlan([{id:'a'}],async()=>[
    {...base,id:'good',week:3},{...base,id:'done',week:3,completed:true},{...base,id:'bad',week:3,dueAt:null},
    {...base,id:'other',week:2}],{now,menu:async()=>[['a'],['a:3'],['play']][count++],
      output:new Writable({write(c,e,d){text+=c;d();}})});
  assert.deepEqual(result.selected.map(r=>r.id),['good']);
  assert.match(text,/완료 1개 제외/);assert.match(text,/일정 확인 필요.*1개/);
});

test('cancel at every arrow stage never returns a playback plan; no pending exits cleanly',async()=>{
  assert.equal(typeof terminal.chooseArrowPlan,'function');
  const output=new Writable({write(c,e,d){d();}});
  for(let cancelled=0;cancelled<3;cancelled++) {
    let count=0;
    const result=await terminal.chooseArrowPlan([{id:'a'}],async()=>rows.filter(r=>r.courseId==='a'),{
      now,output,menu:async()=>count++===cancelled?null:count===1?['a']:['a:3']});
    assert.equal(result,null);
  }
  let calls=0;
  assert.equal(await terminal.chooseArrowPlan([{id:'a'}],async()=>[{...base,week:1,completed:true}],
    {now,output,menu:async()=>{calls++;return ['a'];}}),null);
  assert.equal(calls,1);
});

test('identity fallback selects actual identity index and aborts cleanly',async()=>{
  assert.equal(typeof terminal.chooseAccount,'function');
  const output=new Writable({write(c,e,d){d();}});
  const accounts=[{index:3,label:'학부'},{index:8,label:'대학원'}];
  assert.equal(await terminal.chooseAccount(accounts,{input:Readable.from(['2\n']),output}),8);
  assert.equal(await terminal.chooseAccount(accounts,{input:Readable.from(['q\n']),output}),null);
  const input=new PassThrough(),abort=new AbortController();
  const promise=terminal.chooseAccount(accounts,{input,output,signal:abort.signal});abort.abort();
  assert.equal(await promise,null);input.end();
});

function ttyFixture(t,onRender) {
  const oldTerm=process.env.TERM;process.env.TERM='xterm-256color';
  t.after(()=>{if(oldTerm===undefined)delete process.env.TERM;else process.env.TERM=oldTerm;});
  const input=new PassThrough();input.isTTY=true;input.isRaw=false;
  const modes=[];input.setRawMode=value=>{input.isRaw=value;modes.push(value);};
  let text='';const output=new Writable({write(c,e,d){text+=c;onRender?.(String(c),input);d();}});
  output.isTTY=true;output.columns=100;output.rows=24;
  t.after(()=>input.end());return {input,output,modes,text:()=>text};
}

test('real TTY route accepts arrow selection then default weeks and confirmation, no numbers', {timeout:5000},async t=>{
  let stage=1;
  const fixture=ttyFixture(t,(chunk,input)=>{
    if(chunk.includes(`[${stage}/3]`)) {
      const keys=stage===1?'\x1b[B\r':'\r';stage++;
      setImmediate(()=>input.write(keys));
    }
  });
  const result=await terminal.choosePlan([{id:'a',name:'통계'},{id:'b',name:'영화'}],async course=>rows.filter(r=>r.courseId===course.id),{...fixture,now});
  assert.deepEqual(result.courses.map(c=>c.id),['b']);assert.deepEqual(result.selected.map(r=>r.id),['b']);
  assert.doesNotMatch(fixture.text(),/과목 번호|주차 번호/);
  assert.match(fixture.text(),/추천/);assert.equal(stage,4);assert.equal(fixture.input.isRaw,false);
  assert.deepEqual(fixture.modes,[true,false,true,false,true,false]);
});

test('identity TTY uses same arrows and Enter, not a number prompt', {timeout:5000},async t=>{
  let sent=false;
  const fixture=ttyFixture(t,(chunk,input)=>{
    if(!sent&&chunk.includes('로그인 신분')){sent=true;setImmediate(()=>input.write('\x1b[B\r'));}
  });
  assert.equal(await terminal.chooseAccount([{index:3,label:'학부'},{index:8,label:'대학원'}],fixture),8);
  assert.doesNotMatch(fixture.text(),/계정 번호/);assert.equal(fixture.input.isRaw,false);
});
