import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {playVideoElement,runQueue} from '../player.mjs';

function wav(seconds) {
  const n=Math.round(8000*seconds),b=Buffer.alloc(44+n*2);
  b.write('RIFF');b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);
  b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
  return `data:audio/wav;base64,${b.toString('base64')}`;
}

test('normal media playback waits for real ended before returning',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent(`<video muted src="${wav(0.35)}"></video>`);
    const video=page.locator('video');
    await video.evaluate(v=>v.play());
    const result=await playVideoElement(video,{pollMs:30,stallMs:2000});
    assert.equal(result.ended,true);
    assert.equal(await video.evaluate(v=>v.playbackRate),1);
    assert.ok(result.currentTime>=0.34);
  } finally {await browser.close();}
});

test('paused video stalls instead of claiming completion',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent(`<video muted preload="auto" src="${wav(2)}"></video>`);
    await assert.rejects(playVideoElement(page.locator('video'),{pollMs:20,stallMs:150}),/멈|stall/);
  } finally {await browser.close();}
});

test('a short opening clip ending is not mistaken for the full lecture ending',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent(`<video muted src="${wav(0.1)}"></video>`);
    await page.locator('video').evaluate((v,next)=>{
      v.addEventListener('ended',()=>setTimeout(()=>{v.src=next;v.play();},200),{once:true});
      return v.play();
    },wav(0.6));
    const result=await playVideoElement(page.locator('video'),{pollMs:20,stallMs:2000,expectedDuration:0.6});
    assert.ok(result.duration>=0.59,'must wait for the actual lecture, not the opening clip');
  } finally {await browser.close();}
});

test('queue skips server-completed, verifies after ended and preserves unverified outcome',async()=>{
  const events=[];
  const entries=[{id:'a',completed:true},{id:'b',completed:false},{id:'c',completed:false}];
  const result=await runQueue(entries,{
    refresh:async e=>{events.push(`read:${e.id}`);return e;},
    play:async e=>{events.push(`play:${e.id}`);return {ended:true};},
    verify:async e=>{events.push(`verify:${e.id}`);return {...e,completed:e.id==='b',attendance:'출석'};},
  });
  assert.deepEqual(events,['read:a','read:b','play:b','verify:b','read:c','play:c','verify:c']);
  assert.deepEqual(result.map(r=>r.status),['skipped','completed','unverified']);
});

test('failed playback cannot trigger success verification or next-video playback',async()=>{
  await assert.rejects(runQueue([{id:'a'},{id:'b'}],{
    refresh:async e=>e,play:async()=>{throw new Error('stall');},
    verify:async()=>assert.fail('should not verify failed playback'),
  }),/stall/);
});
