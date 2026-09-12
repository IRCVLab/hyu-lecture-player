import test from 'node:test';
import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import * as ui from '../presentation.mjs';

test('plan estimate excludes completed clips, reports partial durations and late attendance',()=>{
  assert.equal(typeof ui.formatPlanSummary,'function');
  const rows=[{courseId:'a',courseName:'통계',week:1,completed:true,durationSeconds:5000},
    {courseId:'a',courseName:'통계',week:2,completed:false,durationSeconds:125,dueAt:'2020-01-01'},
    {courseId:'b',courseName:'영화',week:1,completed:false,durationSeconds:null}];
  const text=ui.formatPlanSummary(rows);
  assert.match(text,/미완료 2개/);assert.match(text,/완료 1개/);
  assert.match(text,/3분/);assert.match(text,/길이 미확인 1개/);
  assert.match(text,/이어보기/);assert.match(text,/출석 기한.*1개/);
  assert.match(text,/통계.*1, 2주차/);assert.match(text,/영화.*1주차/);
});
test('human status uses final server result, separates attendance and does not expose raw state',()=>{
  assert.equal(typeof ui.formatStatus,'function');
  const text=ui.formatStatus({phase:'completed',pid:123,options:{secret:'hidden'},
    selected:[{id:'a'},{id:'b'}],final:[{id:'a',completed:true,attendance:'결석'},{id:'b',completed:true,attendance:'출석'}]}, {processAlive:false});
  assert.match(text,/완료 2\/2개/);assert.match(text,/결석 1개/);
  assert.doesNotMatch(text,/hidden|"pid"|중단/);
});
test('running and stale status count unique course/item results and offer recovery',()=>{
  assert.equal(typeof ui.formatStatus,'function');
  const state={phase:'running',selected:[{courseId:'a',id:'1',completed:true},{courseId:'b',id:'1',completed:false}],
    results:[{courseId:'a',id:'1',status:'skipped'}],current:{title:'강의'},progress:'재생 30 / 60초'};
  const live=ui.formatStatus(state,{processAlive:true});
  assert.match(live,/완료 1\/2개/);assert.match(live,/강의/);assert.match(live,/30/);
  assert.match(ui.formatStatus(state,{processAlive:false}),/중단.*다시 실행/s);
  assert.match(ui.formatStatus({phase:'error',error:'연결 실패'},{processAlive:false}),/연결 실패/);
  assert.match(ui.formatStatus({phase:'unverified',final:[{completed:false}]}),/미확인 1개/);
});
test('TTY progress replaces one line, ordinary output flushes it; non-TTY stays plain',()=>{
  assert.equal(typeof ui.createConsoleReporter,'function');
  let text='';const output=new Writable({write(chunk,e,done){text+=chunk;done();}});output.isTTY=true;
  const reporter=ui.createConsoleReporter(output);reporter('재생 1 / 60초');reporter('재생 2 / 60초');reporter('완료 표시 확인');
  assert.match(text,/\r\x1b\[2K/);assert.equal(text.split('\n').length-1,2);
  text='';output.isTTY=false;const plain=ui.createConsoleReporter(output);plain('재생 1 / 60초');
  assert.equal(text,'재생 1 / 60초\n');
});
