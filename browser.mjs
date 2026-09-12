import { parseKoreanDate } from './selection.mjs';

export const LMS='https://learning.hanyang.ac.kr';

export function extractCourses() {
  return [...document.querySelectorAll('#my_courses_table tr')].flatMap(row=>{
    const link=row.querySelector('.course-list-course-title-column a[href^="/courses/"]');
    const role=row.querySelector('.course-list-enrolled-as-column')?.textContent.trim();
    if(!link||!['학생','Student'].includes(role)) return [];
    const id=link.getAttribute('href').match(/^\/courses\/(\d+)$/)?.[1];
    const name=link.textContent.trim();
    const term=row.querySelector('.course-list-term-column')?.textContent.trim()||'';
    const year=Number(term.match(/\b(20\d{2})/)?.[1]||name.match(/^(20\d{2})/)?.[1]);
    return id?[{id,name,term,year:Number.isInteger(year)&&year>2000?year:null}]:[];
  });
}

export async function discoverCourses(page) {
  await page.goto(`${LMS}/courses`,{waitUntil:'domcontentloaded'});
  await page.locator('#my_courses_table').waitFor();
  return page.evaluate(extractCourses);
}

// Runs inside the modulebuilder frame. Read rendered LMS status, never local guesses.
export function extractRows() {
  return [...document.querySelectorAll('.xnmb-module_item-wrapper')].map(row=>{
    const text=selector=>row.querySelector(selector)?.textContent.trim()||'';
    const link=row.querySelector('a.xnmb-module_item-left-title');
    let weekText=text('.xnmb-module_item-meta_data-lesson_periods-week');
    if(!weekText) {
      for(let parent=row.parentElement;parent;parent=parent.parentElement) {
        const header=parent.querySelector('.xnmb-module-title');
        if(header) {weekText=header.textContent;break;}
      }
    }
    const date=suffix=>text(`[class$="lecture_periods-${suffix}"] > span`);
    const href=link?.getAttribute('href')||'';
    const icon=row.querySelector('.xnmb-module_item-icon');
    const completedElement=row.querySelector('.xnmb-module_item-completed');
    const completedText=completedElement?[...completedElement.childNodes]
      .filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim():'';
    const durationText=text('.xnlal-attendance-list-item-meta_data-lecture_periods > span:last-child');
    const durationParts=/^\d+(?::\d{2}){1,2}$/.test(durationText)?durationText.split(':').map(Number):null;
    return {
      id:href.match(/\/items\/(\d+)/)?.[1],href,title:link?.textContent.trim()||'',
      week:Number(weekText.match(/(\d+)\s*주차/)?.[1])||null,
      kind:icon&&(icon.classList.contains('movie')||icon.classList.contains('mp4'))?'video':'other',
      completed:completedText==='완료',completedText,
      durationSeconds:durationParts?durationParts.reduce((seconds,part)=>seconds*60+part,0):null,
      attendance:text('.xnmb-module_item-meta_data-attendance_status'),
      startsText:date('unlock_at'),dueText:date('due_at'),endsText:date('lock_at'),
    };
  });
}

export async function waitForFrame(page,predicate,timeoutMs=30000) {
  const end=Date.now()+timeoutMs;
  while(Date.now()<end) {
    if(page.isClosed()) throw new Error('브라우저 창이 닫혔습니다.');
    const frame=page.frames().find(predicate);
    if(frame) return frame;
    await page.waitForTimeout(250);
  }
  throw new Error('강의 프레임을 불러오지 못했습니다. 로그인과 네트워크를 확인하세요.');
}

export async function readInventory(page,course) {
  await page.goto(`${LMS}/courses/${course.id}/external_tools/140`,{waitUntil:'domcontentloaded'});
  const frame=await waitForFrame(page,f=>f.url().startsWith(`${LMS}/learningx/lti/modulebuilder`));
  await frame.locator('.xnmb-module-list .xnmb-module-title').first().waitFor();
  const rows=await frame.evaluate(extractRows);
  const dateOrUnknown=text=>{
    if(!text) return null;
    try {return parseKoreanDate(text,course.year);} catch {return null;}
  };
  const result=rows.map(row=>({
    ...row,courseId:course.id,courseName:course.name,courseYear:course.year,
    url:row.href?new URL(row.href,LMS).href:null,
    startsAt:dateOrUnknown(row.startsText),
    dueAt:dateOrUnknown(row.dueText),
    endsAt:dateOrUnknown(row.endsText),
  }));
  if(result.some(r=>r.kind==='video'&&(!r.id||!r.week||!r.url)))
    throw new Error(`${course.name}: 영상 메타데이터를 해석하지 못했습니다. 자동 재생을 중단합니다.`);
  return result;
}

export async function verifyCompletion(page,entry,{attempts=7,delayMs=10000,log=()=>{}}={}) {
  const course={id:entry.courseId,name:entry.courseName,year:entry.courseYear};
  let last;
  for(let i=0;i<attempts;i++) {
    if(i) await page.waitForTimeout(delayMs);
    last=(await readInventory(page,course)).find(r=>r.id===entry.id);
    if(!last) throw new Error(`완료 확인 중 영상이 목록에서 사라졌습니다: ${entry.title}`);
    if(last.completed) return last;
    log(`완료 표시 반영 대기 (${i+1}/${attempts}): ${entry.title}`);
  }
  return last;
}
