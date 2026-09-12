import { createInterface } from 'node:readline';
import {selectEntries} from './selection.mjs';
import {formatPlanSummary} from './presentation.mjs';

const validSchedule=row=>['startsAt','dueAt','endsAt'].every(field=>row[field]&&Number.isFinite(new Date(row[field]).getTime()));

function recommendedEntries(entries,now) {
  const time=new Date(now).getTime();
  const playable=entries.filter(row=>row.kind==='video'&&!row.completed&&validSchedule(row)&&
    Number.isInteger(row.week)&&row.week>0&&new Date(row.startsAt).getTime()<=time&&new Date(row.endsAt).getTime()>=time);
  return [...new Set(playable.map(row=>row.courseId))].flatMap(id=>playable.filter(row=>row.courseId===id).sort((a,b)=>a.week-b.week));
}

export function parseChoices(text, allowed) {
  const value=text.trim();
  if(/^(q|quit|취소)$/i.test(value)) return null;
  if(/^(all|전체)$/i.test(value)) return [...allowed];
  const parts=value.split(/[,\s]+/);
  if(!value||parts.some(part=>!/^\d+$/.test(part)||!allowed.includes(Number(part))))
    throw new Error('표시된 번호를 쉼표 또는 공백으로 입력하세요. 전체: all, 취소: q');
  return [...new Set(parts.map(Number))];
}

export function summarizeWeeks(entries,{now=new Date()}={}) {
  const current=new Date(now).getTime();
  const courses=new Map();
  for(const entry of entries) {
    if(!Number.isInteger(entry.week)||entry.week<1) continue;
    if(!courses.has(entry.courseId)) courses.set(entry.courseId,new Map());
    const weeks=courses.get(entry.courseId);
    if(!weeks.has(entry.week)) weeks.set(entry.week,{courseId:entry.courseId,week:entry.week,pending:0,completed:0,deadlines:[]});
    const row=weeks.get(entry.week);
    if(entry.kind!=='video') continue;
    row[entry.completed?'completed':'pending']++;
    if(entry.dueAt&&!row.deadlines.includes(entry.dueAt)) row.deadlines.push(entry.dueAt);
  }
  return [...courses.values()].flatMap(weeks=>[...weeks.values()].sort((a,b)=>a.week-b.week)).map(row=>{
    const pending=entries.filter(entry=>entry.courseId===row.courseId&&entry.week===row.week&&entry.kind==='video'&&!entry.completed);
    const open=pending.filter(entry=>validSchedule(entry)&&new Date(entry.startsAt).getTime()<=current&&new Date(entry.endsAt).getTime()>=current);
    let status;
    if(!row.pending&&!row.completed) status='영상 없음';
    else if(!row.pending) status='완료';
    else if(open.length) status=open.some(entry=>entry.dueAt&&new Date(entry.dueAt).getTime()<current)?'수강 필요 (마감 지남)':'수강 필요';
    else if(pending.every(entry=>entry.startsAt&&new Date(entry.startsAt).getTime()>current)) status='예정';
    else if(pending.every(entry=>entry.endsAt&&new Date(entry.endsAt).getTime()<current)) status='열람 종료';
    else status='일정 확인 필요';
    return {...row,status,actionable:open.length>0};
  });
}

function deadlineLabel(value) {
  const date=new Date(value);
  if(!Number.isFinite(date.getTime())) return '날짜 확인 필요';
  return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
}

export async function choosePlan(courses,loadInventory,{input=process.stdin,output=process.stdout,list=false,signal,now=new Date()}={}) {
  if(signal?.aborted) return null;
  if(!courses.length) throw new Error('선택할 수 있는 수강 과목이 없습니다.');
  const rl=createInterface({input,output,terminal:!!input.isTTY});
  const lines=rl[Symbol.asyncIterator]();
  const onAbort=()=>rl.close();
  signal?.addEventListener('abort',onAbort,{once:true});
  const ask=async prompt=>{
    if(signal?.aborted) return 'q';
    output.write(prompt);
    const next=await lines.next();
    return next.done||signal?.aborted?'q':next.value;
  };
  const choices=async(prompt,allowed)=>{
    for(;;) {
      try {return parseChoices(await ask(prompt),allowed);}
      catch(error) {output.write(`${error.message}\n`);}
    }
  };
  try {
    output.write('\n[1/3] 수강 과목을 선택하세요 (여러 개: 1,2 / 전체: all / 취소: q)\n');
    courses.forEach((course,i)=>output.write(`${i+1}. ${course.name||course.title||course.id}${course.term?` (${course.term})`:''} [${course.id}]\n`));
    const courseChoices=await choices('과목 번호: ',courses.map((_,i)=>i+1));
    if(courseChoices===null) return null;
    const chosen=courseChoices.map(index=>courses[index-1]);
    const entries=[];
    for(const course of chosen) {
      if(signal?.aborted) return null;
      output.write(`  ${course.name||course.id}의 주차 정보를 가져오는 중…\n`);
      entries.push(...await loadInventory(course));
    }
    if(signal?.aborted) return null;
    const summaries=summarizeWeeks(entries,{now});
    if(!summaries.length) throw new Error('선택한 과목에서 주차 정보를 찾지 못했습니다.');
    const showWeeks=(details=false)=>{
    output.write('\n[2/3] 주차별 영상 현황 (기한은 출석 인정 기한, 재생 완료와 출결은 별도입니다)\n');
    for(const course of chosen) {
      output.write(`\n${course.name||course.title||course.id}\n`);
      const actionable=summaries.filter(row=>row.courseId===course.id&&row.actionable).map(row=>row.week);
      output.write(`  지금 수강 필요: ${actionable.length?`${actionable.join(', ')}주차`:'없음'}\n`);
      const unknown=entries.filter(row=>row.courseId===course.id&&row.kind==='video'&&!row.completed&&!validSchedule(row)).length;
      if(unknown) output.write(`  일정 확인 필요: ${unknown}개 영상 (자동 추천 제외)\n`);
      for(const row of summaries.filter(row=>row.courseId===course.id&&(details||row.actionable||row.status==='일정 확인 필요')))
        output.write(`  ${row.week}주차: ${row.status} / 미완료 ${row.pending}개 / 완료 ${row.completed}개 / 출석 기한: ${row.deadlines.length?row.deadlines.map(deadlineLabel).join(', '):'정보 없음'}\n`);
    }
    if(!details) output.write('  완료·예정 주차를 포함한 전체 목록: d 입력\n');
    };
    showWeeks();
    const commonWeeks=[...new Set(summaries.map(row=>row.week))]
      .filter(week=>chosen.every(course=>summaries.some(row=>row.courseId===course.id&&row.week===week)))
      .sort((a,b)=>a-b);
    output.write(commonWeeks.length?`\n선택한 모든 과목에 공통으로 있는 주차: ${commonWeeks.join(', ')}\n`:
      '\n공통 주차가 없어도 Enter로 과목별 미완료 영상을 추천받을 수 있습니다.\n');
    let weeks,selected,recommended=false;
    for(;;) {
      const answer=(await ask('Enter: 지금 가능한 미완료 추천 / 주차 직접 입력: 1 2 / 전체 목록: d / 취소: q\n선택: ')).trim();
      if(/^(d|상세)$/i.test(answer)) {showWeeks(true);continue;}
      if(answer==='') {
        selected=recommendedEntries(entries,now);recommended=true;
        if(!selected.length) {output.write('지금 재생할 미완료 영상이 없습니다. 일정 확인 필요 항목은 LMS에서 확인하세요.\n');return null;}
        break;
      }
      try {
        weeks=parseChoices(answer,commonWeeks);
        if(weeks===null) return null;
        if(!weeks.length) throw new Error('공통 주차가 없습니다. Enter 추천을 사용하거나 과목을 따로 선택하세요.');
        selected=selectEntries(entries,{weeks,now});
        break;
      } catch(error) {
        const message=/future/.test(error.message)?'아직 공개되지 않은 영상이 있습니다. 다른 주차를 선택하세요.':
          /expired/.test(error.message)?'열람이 종료된 영상이 있습니다. 다른 주차를 선택하세요.':
          /schedule date/.test(error.message)?'일정 확인이 필요한 영상이 있습니다. LMS 일정을 확인하거나 Enter 추천을 사용하세요.':error.message;
        output.write(`${message}\n`);
      }
    }
    const summaryRows=recommended?[...selected,...entries.filter(row=>row.kind==='video'&&row.completed&&
      selected.some(item=>item.courseId===row.courseId&&item.week===row.week))]:selected;
    output.write(formatPlanSummary(summaryRows,{now})+'\n');
    output.write('[3/3] 아래에서 확인해야 재생을 시작합니다.\n');
    for(;;) {
      const answer=(await ask(list?'목록 확인 (Enter), 취소 (q): ':'보기 (Enter 또는 보기): 영상을 한 편씩 순서대로 재생합니다. 취소 (q): ')).trim();
      if(/^(q|quit|취소)$/i.test(answer)) return null;
      if(answer===''||answer==='보기'||(list&&answer==='목록 확인'))
        return recommended?{courses:chosen,entries,selected}:{courses:chosen,entries,weeks};
      output.write('시작하려면 Enter를 누르고, 취소하려면 q를 입력하세요.\n');
    }
  } finally {
    signal?.removeEventListener('abort',onAbort);
    rl.close();
  }
}
