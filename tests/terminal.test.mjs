import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import { getEventListeners } from 'node:events';
import { parseChoices, summarizeWeeks, choosePlan } from '../terminal.mjs';
const schedule={startsAt:'2020-01-01T00:00:00Z',dueAt:'2099-01-01T00:00:00Z',endsAt:'2099-01-01T00:00:00Z'};

test('number choices support comma or spaces, all, unique order and cancellation',()=>{
  assert.deepEqual(parseChoices('2, 1 2',[1,2,11]),[2,1]);
  assert.deepEqual(parseChoices('all',[1,2,11]),[1,2,11]);
  assert.equal(parseChoices('q',[1]),null);
  for(const value of ['','0','3','1x','1.5']) assert.throws(()=>parseChoices(value,[1,2]));
});
test('interactive choice loads courses sequentially and returns full inventories after 보기',async()=>{
  const courses=[{id:'a',name:'과목 A',term:'2026-2'},{id:'b',name:'과목 B'}];
  const loaded=[];
  const rows=[{...schedule,courseId:'b',week:1,kind:'video',completed:false},{...schedule,courseId:'b',week:2,kind:'other'}];
  let text='';
  const output=new Writable({write(chunk,encoding,done){text+=chunk.toString();done();}});
  const result=await choosePlan(courses,async course=>{loaded.push(course.id);return rows;},{input:Readable.from(['2\n1\n보기\n']),output});
  assert.deepEqual(loaded,['b']);
  assert.deepEqual(result,{courses:[courses[1]],entries:rows,weeks:[1]});
  assert.match(text,/미완료 1개/);
  assert.match(text,/한 편씩/);
});
test('cancelling course selection does not load inventory',async()=>{
  const output=new Writable({write(chunk,encoding,done){done();}});
  assert.equal(await choosePlan([{id:'a'}],async()=>assert.fail('cancel must not load'),{input:Readable.from(['q\n']),output}),null);
});
test('week summaries count videos only, retain course identity and deadlines',()=>{
  const rows=[{courseId:'a',week:1,kind:'video',completed:true,dueAt:'2026-09-07T14:59:00Z'},
    {courseId:'a',week:1,kind:'video',completed:false,dueAt:'2026-09-08T14:59:00Z'},
    {courseId:'a',week:1,kind:'other',completed:false},
    {courseId:'b',week:1,kind:'video',completed:false,dueAt:null},
    {courseId:'a',week:11,kind:'other'}];
  const result=summarizeWeeks(rows);
  assert.deepEqual(result.map(r=>[r.courseId,r.week,r.pending,r.completed]),[['a',1,1,1],['a',11,0,0],['b',1,1,0]]);
  assert.deepEqual(result[0].deadlines,['2026-09-07T14:59:00Z','2026-09-08T14:59:00Z']);
});

test('all weeks uses the intersection across selected courses',async()=>{
  let text='';
  const output=new Writable({write(chunk,encoding,done){text+=chunk.toString();done();}});
  const result=await choosePlan([{id:'a'},{id:'b'}],async course=>(course.id==='a'?[1,2]:[2,3]).map(week=>({...schedule,courseId:course.id,week,kind:'video'})),
    {input:Readable.from(['all\nall\n\n']),output});
  assert.deepEqual(result.weeks,[2]);
  assert.match(text,/선택한 모든 과목에 공통으로 있는 주차: 2/);
});

test('courses without common weeks can cancel manual selection',async()=>{
  const output=new Writable({write(chunk,encoding,done){done();}});
  assert.equal(await choosePlan([{id:'a'},{id:'b'}],async course=>[{...schedule,courseId:course.id,week:course.id==='a'?1:2,kind:'video'}],
    {input:Readable.from(['all\nq\n']),output}),null);
});

test('abort cancels a pending terminal prompt and removes its listener',async()=>{
  const input=new PassThrough();
  const controller=new AbortController();
  const output=new Writable({write(chunk,encoding,done){done();}});
  let timeout;
  try {
    const pending=choosePlan([{id:'a'}],async()=>assert.fail('cancel must not load'),{input,output,signal:controller.signal});
    controller.abort();
    const result=await Promise.race([pending,new Promise(resolve=>{timeout=setTimeout(()=>resolve('timed out'),200);})]);
    assert.equal(result,null);
    assert.equal(getEventListeners(controller.signal,'abort').length,0);
  } finally {clearTimeout(timeout);input.end();}
});

test('week status distinguishes overdue playable, active, future, completed and closed videos',()=>{
  const now=new Date('2026-09-11T12:00:00+09:00');
  const base={courseId:'a',kind:'video',completed:false,startsAt:'2026-09-01T00:00:00+09:00',dueAt:'2026-09-14T23:59:00+09:00',endsAt:'2026-12-21T23:59:00+09:00'};
  const rows=[{...base,week:1,dueAt:'2026-09-07T23:59:00+09:00'}, {...base,week:2},
    {...base,week:3,startsAt:'2026-09-15T00:00:00+09:00'}, {...base,week:4,completed:true},
    {...base,week:5,endsAt:'2026-09-10T23:59:00+09:00'}, {...base,week:6,kind:'other'}];
  const summaries=summarizeWeeks(rows,{now});
  assert.deepEqual(summaries.map(row=>row.status),['수강 필요 (마감 지남)','수강 필요','예정','완료','열람 종료','영상 없음']);
  assert.deepEqual(summaries.filter(row=>row.actionable).map(row=>row.week),[1,2]);
});

test('picker leads with actionable weeks without automatically selecting them',async()=>{
  const rows=[1,2,3].map(week=>({courseId:'a',week,kind:'video',completed:false,
    startsAt:week===3?'2026-09-15T00:00:00+09:00':'2026-09-01T00:00:00+09:00',
    dueAt:week===1?'2026-09-07T23:59:00+09:00':'2026-09-21T23:59:00+09:00',endsAt:'2026-12-21T23:59:00+09:00'}));
  let text='';
  const output=new Writable({write(chunk,encoding,done){text+=chunk.toString();done();}});
  const result=await choosePlan([{id:'a',name:'통계'}],async()=>rows,
    {input:Readable.from(['1\nd\n2\n\n']),output,now:new Date('2026-09-11T12:00:00+09:00')});
  assert.match(text,/지금 수강 필요: 1, 2주차/);
  assert.match(text,/3주차: 예정/);
  assert.deepEqual(result.weeks,[2]);
});

test('Enter recommends different open pending weeks per course and still requires confirmation',async()=>{
  const courses=[{id:'a'},{id:'b'}];
  let text='';const output=new Writable({write(c,e,d){text+=c;d();}});
  const load=async course=>[{...schedule,id:course.id,courseId:course.id,week:course.id==='a'?1:2,kind:'video',completed:false,durationSeconds:60}];
  const plan=await choosePlan(courses,load,{input:Readable.from(['all\n\n보기\n']),output});
  assert.deepEqual(plan.selected.map(r=>[r.courseId,r.week]),[['a',1],['b',2]]);
  assert.match(text,/예상 재생 시간: 약 2분/);assert.match(text,/재생 전 확인/);
  assert.equal(await choosePlan(courses,load,{input:Readable.from(['all\n\nq\n']),output}),null);
});

test('recommendation excludes completed, unknown, future and expired items and does not hide warnings',async()=>{
  let text='';const output=new Writable({write(c,e,d){text+=c;d();}});
  const base={...schedule,courseId:'a',kind:'video',completed:false};
  const rows=[{...base,id:'open',week:1,dueAt:'2020-01-01'},
    {...base,id:'done',week:1,completed:true},{...base,id:'future',week:2,startsAt:'2090-01-01'},
    {...base,id:'expired',week:3,endsAt:'2020-01-01'},{...base,id:'unknown',week:4,startsAt:null},
    {...base,id:'unknown-due',week:5,dueAt:null}];
  const plan=await choosePlan([{id:'a'}],async()=>rows,{input:Readable.from(['1\n\n\n']),output});
  assert.deepEqual(plan.selected.map(r=>r.id),['open']);
  assert.match(text,/완료 1개 제외/);
  assert.match(text,/출석 기한이 지난 영상 1개/);
  assert.doesNotMatch(text,/2주차: 예정/);
  assert.match(text,/일정 확인 필요/);
});

test('manual future week error returns to selection; no pending recommendation exits cleanly',async()=>{
  let text='';const output=new Writable({write(c,e,d){text+=c;d();}});
  const base={...schedule,courseId:'a',kind:'video',week:1};
  const result=await choosePlan([{id:'a'}],async()=>[{...base,completed:true}],{input:Readable.from(['1\n\n']),output});
  assert.equal(result,null);assert.match(text,/재생할 미완료 영상이 없습니다/);
  text='';
  const plan=await choosePlan([{id:'a'}],async()=>[{...base,id:'ok'},{...base,id:'future',week:2,startsAt:'2090-01-01'}],
    {input:Readable.from(['1\n2\n1\n보기\n']),output});
  assert.deepEqual(plan.weeks,[1]);assert.match(text,/아직 공개되지/);
});
