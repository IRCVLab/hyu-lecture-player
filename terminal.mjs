import { createInterface } from 'node:readline';

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
    const open=pending.filter(entry=>entry.startsAt&&entry.endsAt&&new Date(entry.startsAt).getTime()<=current&&new Date(entry.endsAt).getTime()>=current);
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
    output.write('\n수강 과목을 선택하세요 (여러 개: 1,2 / 전체: all / 취소: q)\n');
    courses.forEach((course,i)=>output.write(`${i+1}. ${course.name||course.title||course.id}${course.term?` (${course.term})`:''} [${course.id}]\n`));
    const selected=await choices('과목 번호: ',courses.map((_,i)=>i+1));
    if(selected===null) return null;
    const chosen=selected.map(index=>courses[index-1]);
    const entries=[];
    for(const course of chosen) {
      if(signal?.aborted) return null;
      entries.push(...await loadInventory(course));
    }
    if(signal?.aborted) return null;
    const summaries=summarizeWeeks(entries,{now});
    if(!summaries.length) throw new Error('선택한 과목에서 주차 정보를 찾지 못했습니다.');
    output.write('\n주차별 영상 현황 (기한은 출석 인정 기한, 재생 완료와 출결은 별도입니다)\n');
    for(const course of chosen) {
      output.write(`\n${course.name||course.title||course.id}\n`);
      const actionable=summaries.filter(row=>row.courseId===course.id&&row.actionable).map(row=>row.week);
      output.write(`  지금 수강 필요: ${actionable.length?`${actionable.join(', ')}주차`:'없음'}\n`);
      for(const row of summaries.filter(row=>row.courseId===course.id))
        output.write(`  ${row.week}주차: ${row.status} / 미완료 ${row.pending}개 / 완료 ${row.completed}개 / 출석 기한: ${row.deadlines.length?row.deadlines.map(deadlineLabel).join(', '):'정보 없음'}\n`);
    }
    const commonWeeks=[...new Set(summaries.map(row=>row.week))]
      .filter(week=>chosen.every(course=>summaries.some(row=>row.courseId===course.id&&row.week===week)))
      .sort((a,b)=>a-b);
    if(!commonWeeks.length) throw new Error('공통으로 있는 주차가 없습니다. 과목을 따로 선택해 주세요.');
    output.write(`\n선택한 모든 과목에 공통으로 있는 주차: ${commonWeeks.join(', ')}\n`);
    const weeks=await choices('주차 번호 (예: 1 2, 전체: all, 취소: q): ',commonWeeks);
    if(weeks===null) return null;
    const pending=summaries.filter(row=>weeks.includes(row.week)).reduce((sum,row)=>sum+row.pending,0);
    output.write(`\n${chosen.length}개 과목 / ${weeks.join(', ')}주차 / 미완료 영상 ${pending}개\n`);
    for(;;) {
      const answer=(await ask(list?'목록 확인 (Enter), 취소 (q): ':'보기 (Enter 또는 보기): 영상을 한 편씩 순서대로 재생합니다. 취소 (q): ')).trim();
      if(/^(q|quit|취소)$/i.test(answer)) return null;
      if(answer===''||answer==='보기'||(list&&answer==='목록 확인')) return {courses:chosen,entries,weeks};
      output.write('시작하려면 Enter를 누르고, 취소하려면 q를 입력하세요.\n');
    }
  } finally {
    signal?.removeEventListener('abort',onAbort);
    rl.close();
  }
}
