import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { extractRows, extractCourses, readInventory, LMS } from '../browser.mjs';
import {choosePlan} from '../terminal.mjs';
import {selectEntries} from '../selection.mjs';
import {Readable,Writable} from 'node:stream';

test('inventory preserves unknown schedules so picker recommends valid videos only',async()=>{
  const course={id:'1',name:'통계',year:2026};
  const base={id:'1',href:'/courses/1/modules/items/1',title:'영상',week:1,kind:'video',completed:false,
    startsText:'9월 1일 오전 00:00',dueText:'9월 14일 오후 11:59',endsText:'12월 21일 오후 11:59'};
  const raw=[base,{...base,id:'2',startsText:''},{...base,id:'3',dueText:'날짜 없음'}];
  const frame={url:()=>`${LMS}/learningx/lti/modulebuilder`,locator:()=>({first:()=>({waitFor:async()=>{}})}),evaluate:async()=>raw};
  const page={goto:async()=>{},isClosed:()=>false,frames:()=>[frame]};
  const rows=await readInventory(page,course);
  assert.equal(rows[1].startsAt,null);assert.equal(rows[2].dueAt,null);
  let text='';const output=new Writable({write(c,e,d){text+=c;d();}});
  const now=new Date('2026-09-11');
  const plan=await choosePlan([course],()=>readInventory(page,course),{input:Readable.from(['1\n\n보기\n']),output,now});
  assert.deepEqual(plan.selected.map(r=>r.id),['1']);
  assert.match(text,/일정 확인 필요/);
  assert.throws(()=>selectEntries([rows[2]],{weeks:[1],now}),/schedule date/);
});

test('discover only current student courses and derive year from term',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    const row=(id,role,term)=>`<tr><td class="course-list-course-title-column"><a href="/courses/${id}">과목 ${id}</a></td><td class="course-list-enrolled-as-column">${role}</td><td class="course-list-term-column">${term}</td></tr>`;
    await page.setContent(`<table id="my_courses_table">${row(123,'학생','2027년 1학기')}${row(124,'조교','2027년 1학기')}</table><table id="past_enrollments_table">${row(90,'학생','2026년 2학기')}</table>`);
    const courses=await page.evaluate(extractCourses);
    assert.deepEqual(courses,[{id:'123',name:'과목 123',term:'2027년 1학기',year:2027}]);
  }finally{await browser.close();}
});

test('extract LMS video types, completed versus incomplete and containing week', async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage();
    const row = (id,icon,status,date=true) => `<div class="xnmb-module_item-wrapper"><i class="xnmb-module_item-icon ${icon}"></i><a class="xnmb-module_item-left-title" href="/courses/220322/modules/items/${id}?return_url=x">영상 ${id}</a>${date?'<span class="xnmb-module_item-meta_data-lesson_periods-week">2주차</span><span class="xnlal-attendance-list-item-meta_data-lecture_periods-unlock_at"><span>9월 8일 오전 00:00</span></span><span class="xnlal-attendance-list-item-meta_data-lecture_periods-due_at"><span>9월 14일 오후 11:59</span></span><span class="xnlal-attendance-list-item-meta_data-lecture_periods-lock_at"><span>12월 21일 오후 11:59</span></span>':''}<span class="xnmb-module_item-completed ${status}">${status==='complete'?'완료':'-'}</span><span class="xnmb-module_item-meta_data-attendance_status">출석</span></div>`;
    await page.setContent(`<div class="xnmb-module-list"><div><div class="xnmb-module-outer-wrapper"><p class="xnmb-module-title">2주차 / Unit-2</p></div><div>${row(1,'movie','complete')}${row(2,'mp4','incomplete')}${row(3,'wiki_page','',false)}</div></div></div>`);
    const rows=await page.evaluate(extractRows);
    assert.equal(rows.length,3);
    assert.deepEqual(rows.map(r=>r.kind),['video','video','other']);
    assert.deepEqual(rows.map(r=>r.completed),[true,false,false]);
    assert.deepEqual(rows.map(r=>r.week),[2,2,2]);
    assert.equal(rows[1].startsText,'9월 8일 오전 00:00');
    assert.equal(rows[0].attendance,'출석');
    assert.equal(rows[0].id,'1');
    await page.locator('.xnmb-module_item-completed').first().evaluate(e=>{
      e.className='xnmb-module_item-completed completed';
      e.innerHTML='완료<i></i>';
    });
    assert.equal((await page.evaluate(extractRows))[0].completed,true,'live LMS completion includes an icon');
    await page.locator('.xnmb-module_item-wrapper').first().evaluate(e=>{
      e.insertAdjacentHTML('beforeend','<p class="xnlal-attendance-list-item-meta_data-lecture_periods"><span>시작 9월 1일</span><span>04:49</span></p>');
    });
    assert.equal((await page.evaluate(extractRows))[0].durationSeconds,289);
  } finally { await browser.close(); }
});
