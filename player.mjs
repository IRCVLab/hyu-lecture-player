import {setTimeout as delay} from 'node:timers/promises';
import {waitForFrame} from './browser.mjs';

export async function playVideoElement(video,{pollMs=1000,stallMs=120000,log=()=>{},expectedDuration}={}) {
  let lastTime=-1,lastAdvance=Date.now(),lastLog=0;
  const started=Date.now();
  for(;;) {
    const state=await video.evaluate(v=>({currentTime:v.currentTime,duration:v.duration,
      ended:v.ended,paused:v.paused,error:v.error?.code||null,rate:v.playbackRate}));
    if(state.error) throw new Error(`영상 재생 오류 (${state.error})`);
    const lectureDuration=!expectedDuration||state.duration>=expectedDuration-Math.min(1,expectedDuration*0.05);
    if(state.ended&&Number.isFinite(state.duration)&&state.duration>0&&lectureDuration) return state;
    if(state.rate!==1) await video.evaluate(v=>{v.playbackRate=1;});
    if(state.currentTime>lastTime+0.05) {lastTime=state.currentTime;lastAdvance=Date.now();}
    if(Date.now()-lastAdvance>stallMs) throw new Error('영상 재생이 멈췄습니다. 재실행하면 서버 진도를 확인해 이어서 진행합니다.');
    if(Number.isFinite(state.duration)&&Date.now()-started>(state.duration*1000+stallMs*2))
      throw new Error('영상 재생 제한 시간을 초과했습니다.');
    if(Date.now()-lastLog>=30000) {
      log(`재생 ${Math.floor(state.currentTime)} / ${Math.floor(state.duration)||'?'}초`);
      lastLog=Date.now();
    }
    await delay(pollMs);
  }
}

async function acknowledgePlaybackPrompt(frame,log) {
  const ok=frame.locator('.confirm-ok-btn');
  if(await ok.isVisible()) {
    const body=await frame.locator('.confirm-msg-box .confirm-msg-text').innerText();
    if(/진도체크를 시작|이어서|이어 보|이어보|시청한 위치|학습한 위치/.test(body)) {
      log('플레이어의 진도 기록/이어보기 확인');
      await ok.click();
    } else throw new Error('플레이어에 확인이 필요한 알림이 표시되었습니다. 브라우저를 확인하세요.');
  }
}

export async function playEntry(page,entry,{log=()=>{},stallMs=120000}={}) {
  await page.goto(entry.url,{waitUntil:'domcontentloaded'});
  const frame=await waitForFrame(page,f=>f.url().startsWith('https://hycms.hanyang.ac.kr/em/'));
  await frame.locator('.vc-front-screen-play-btn').waitFor({state:'visible'});
  await frame.locator('.vc-front-screen-play-btn').click();
  let video;
  const end=Date.now()+30000;
  while(Date.now()<end) {
    await acknowledgePlaybackPrompt(frame,log);
    const index=await frame.locator('video').evaluateAll((videos,expectedDuration)=>{
      const candidates=videos.map((v,i)=>({v,i})).filter(({v})=>
        !!(v.offsetWidth||v.offsetHeight)&&Number.isFinite(v.duration)&&v.duration>0&&
        (!expectedDuration||v.duration>=expectedDuration-Math.min(1,expectedDuration*0.05)));
      candidates.sort((a,b)=>b.v.duration-a.v.duration);
      return candidates[0]?.i??-1;
    },entry.durationSeconds);
    if(index>=0) {
      video=frame.locator('video').nth(index);
      if(await video.evaluate(v=>!v.paused)) break;
    }
    await page.waitForTimeout(500);
  }
  if(!video||await video.evaluate(v=>v.paused&&!v.ended))
    throw new Error('영상 재생이 시작되지 않았습니다. 브라우저의 알림을 확인하세요.');
  log(`시작: ${entry.title}`);
  const state=await playVideoElement(video,{stallMs,log,expectedDuration:entry.durationSeconds});
  // Allow the native player to finish its own end/progress callbacks before navigation.
  await page.waitForTimeout(3000);
  return state;
}

export async function runQueue(entries,{refresh,play,verify,log=()=>{},onResult=async()=>{}}) {
  const results=[];
  for(const entry of entries) {
    const fresh=await refresh(entry);
    if(!fresh) throw new Error(`목록에서 영상을 찾지 못했습니다: ${entry.title||entry.id}`);
    let result;
    if(fresh.completed) {
      log(`건너뜀 (완료): ${entry.title||entry.id}`);
      result={...fresh,status:'skipped'};
    } else {
      log(`재생 대기: ${entry.title||entry.id}`);
      const playback=await play(fresh);
      if(!playback?.ended) throw new Error('영상 종료를 확인하지 못했습니다.');
      const checked=await verify(fresh);
      result={...checked,status:checked?.completed?'completed':'unverified'};
      log(`${result.status==='completed'?'완료 표시 확인':'완료 표시 미확인'}: ${entry.title||entry.id} / 출결: ${checked?.attendance||'알 수 없음'}`);
    }
    results.push(result);
    await onResult(result,results);
  }
  return results;
}
