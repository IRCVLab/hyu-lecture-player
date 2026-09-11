import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { playEntry, runQueue } from '../player.mjs';
import { LMS, verifyCompletion } from '../browser.mjs';

function wav(seconds) {
  const count=Math.round(seconds*8000), bytes=Buffer.alloc(44+count*2);
  bytes.write('RIFF'); bytes.writeUInt32LE(36+count*2,4); bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(8000,24); bytes.writeUInt32LE(16000,28); bytes.writeUInt16LE(2,32);
  bytes.writeUInt16LE(16,34); bytes.write('data',36); bytes.writeUInt32LE(count*2,40);
  return `data:audio/wav;base64,${bytes.toString('base64')}`;
}

const entry=id=>({id,courseId:'999123',courseName:'통합 테스트 과목',courseYear:2026,
  title:`영상 ${id}`,url:`${LMS}/courses/999123/modules/items/${id}`,completed:false});

async function fixture(t) {
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  return browser.newPage();
}

function inventory(completed) {
  return `<div class="xnmb-module-list"><h2 class="xnmb-module-title">1주차</h2>
    <div class="xnmb-module_item-wrapper"><i class="xnmb-module_item-icon mp4"></i>
    <a class="xnmb-module_item-left-title" href="/courses/999123/modules/items/1">영상 1</a>
    <span class="xnmb-module_item-meta_data-lesson_periods-week">1주차</span>
    <span class="xnmb-module_item-completed">${completed?'완료<i></i>':'-<i></i>'}</span>
    <span class="xnmb-module_item-meta_data-attendance_status">결석</span>
    <span class="meta-lecture_periods-unlock_at"><span>9월 1일 오전 00:00</span></span>
    <span class="meta-lecture_periods-due_at"><span>9월 7일 오후 11:59</span></span>
    <span class="meta-lecture_periods-lock_at"><span>12월 21일 오후 11:59</span></span>
    </div></div>`;
}

test('real nested player confirmation selects the active video and queue waits for each ended', {timeout:30000}, async t=>{
  const page=await fixture(t);
  const events=[];
  let active=0,maxActive=0;
  await page.exposeFunction('recordPlayback', (type,id)=>{
    events.push(`${type}:${id}`);
    if(type==='playing') {active++;maxActive=Math.max(maxActive,active);}
    if(type==='ended') active--;
  });
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    let body;
    if(url.pathname.includes('/modules/items/')) {
      const id=url.pathname.split('/').at(-1);
      body=`<iframe src="${LMS}/learningx/lti/lecture_attendance/${id}" allow="autoplay"></iframe>`;
    } else if(url.pathname.includes('/lecture_attendance/')) {
      const id=url.pathname.split('/').at(-1);
      body=`<iframe src="https://hycms.hanyang.ac.kr/em/${id}" allow="autoplay"></iframe>`;
    } else if(url.origin==='https://hycms.hanyang.ac.kr'&&url.pathname.startsWith('/em/')) {
      const id=url.pathname.split('/').at(-1);
      body=`<button class="vc-front-screen-play-btn">재생</button>
        <div id="prompt" class="confirm-msg-box" hidden><div class="confirm-msg-text">본 콘텐츠의 진도체크를 시작합니다. 실행중인 다른 콘텐츠의 진도체크는 중단됩니다.</div>
        <div class="confirm-btn-wrapper"><button class="confirm-ok-btn">확인</button></div></div>
        ${Array.from({length:11},(_,i)=>`<video id="vp1-video${i}" muted style="${i===6?'width:320px;height:180px':'display:none'}"></video>`).join('')}
        <script>
        const video=document.querySelector('#vp1-video6');
        document.querySelector('.vc-front-screen-play-btn').onclick=()=>{
          video.src=${JSON.stringify(wav(1.3))};video.load();document.querySelector('#prompt').hidden=false;
        };
        document.querySelector('.confirm-ok-btn').onclick=()=>{
          document.querySelector('#prompt').hidden=true;video.play();
        };
        video.addEventListener('playing',()=>window.recordPlayback('playing',${JSON.stringify(id)}));
        video.addEventListener('ended',()=>window.recordPlayback('ended',${JSON.stringify(id)}));
        </script>`;
    } else throw new Error(`Unexpected network request: ${url.origin}${url.pathname}`);
    await route.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  const results=await runQueue([entry('1'),entry('2')],{
    refresh:async row=>row,
    play:row=>playEntry(page,row,{stallMs:3000}),
    verify:async row=>{
      assert.equal(active,0);
      assert.equal(events.at(-1),`ended:${row.id}`);
      return {...row,completed:true};
    },
  });
  assert.deepEqual(events,['playing:1','ended:1','playing:2','ended:2']);
  assert.equal(maxActive,1);
  assert.deepEqual(results.map(row=>row.status),['completed','completed']);
  const frame=page.frames().find(frame=>frame.url().startsWith('https://hycms.hanyang.ac.kr/em/'));
  assert.equal(await frame.locator('video').count(),11);
  assert.equal(await frame.locator('#vp1-video6').evaluate(video=>video.ended),true);
});

test('unrelated dialog is not accepted because the page title mentions 이어서', {timeout:10000}, async t=>{
  const page=await fixture(t);
  let confirmations=0;
  await page.exposeFunction('recordConfirmation',()=>{confirmations++;});
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    const body=url.origin===LMS
      ? '<iframe src="https://hycms.hanyang.ac.kr/em/unrelated" allow="autoplay"></iframe>'
      : `<h1>이어서 배우는 통계</h1><button class="vc-front-screen-play-btn">재생</button>
        <div class="confirm-msg-box" hidden><div class="confirm-msg-text">등록 정보를 변경합니다</div>
        <div class="confirm-btn-wrapper"><button class="confirm-ok-btn">확인</button></div></div>
        <video muted style="width:320px;height:180px"></video><script>
        const video=document.querySelector('video');
        document.querySelector('.vc-front-screen-play-btn').onclick=()=>{
          video.src=${JSON.stringify(wav(1.3))};video.load();document.querySelector('.confirm-msg-box').hidden=false;
        };
        document.querySelector('.confirm-ok-btn').onclick=()=>{
          window.recordConfirmation();document.querySelector('.confirm-msg-box').hidden=true;video.play();
        };
        </script>`;
    await route.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  await assert.rejects(playEntry(page,entry('1'),{stallMs:2000}),/확인이 필요한 알림/);
  assert.equal(confirmations,0);
});

for(const completionAfter of [2,Infinity]) {
  test(`completion rereads actual LMS rows and ${completionAfter===2?'recognizes 완료 with icon':'keeps an unverified result'}`,async t=>{
    const page=await fixture(t);
    let loads=0;
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      let body;
      if(url.pathname==='/courses/999123/external_tools/140') {
        loads++;
        body=`<iframe src="${LMS}/learningx/lti/modulebuilder?reload=${loads}"></iframe>`;
      } else if(url.pathname==='/learningx/lti/modulebuilder') body=inventory(loads>=completionAfter);
      else throw new Error(`Unexpected network request: ${url.origin}${url.pathname}`);
      await route.fulfill({contentType:'text/html; charset=utf-8',body});
    });
    const messages=[];
    const result=await verifyCompletion(page,entry('1'),{attempts:3,delayMs:10,log:message=>messages.push(message)});
    assert.equal(result.completed,completionAfter===2);
    assert.equal(loads,completionAfter===2?2:3);
    assert.equal(messages.length,completionAfter===2?1:3);
    assert.equal(result.attendance,'결석');
    assert.equal(result.id,'1');
  });
}
