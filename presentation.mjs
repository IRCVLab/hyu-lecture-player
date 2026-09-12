// Pure terminal presentation helpers. Never infer LMS completion from elapsed time.
function durationLabel(seconds) {
  const minutes=Math.ceil(seconds/60);
  return minutes>=60?`${Math.floor(minutes/60)}시간${minutes%60?` ${minutes%60}분`:''}`:`${minutes}분`;
}

export function formatPlanSummary(entries,{now=new Date()}={}) {
  const pending=entries.filter(row=>!row.completed);
  const known=pending.filter(row=>Number.isFinite(row.durationSeconds)&&row.durationSeconds>0);
  const seconds=known.reduce((sum,row)=>sum+row.durationSeconds,0);
  const lines=['\n[재생 전 확인]'];
  for(const id of new Set(entries.map(row=>row.courseId))) {
    const rows=entries.filter(row=>row.courseId===id);
    const weeks=[...new Set(rows.map(row=>row.week))].sort((a,b)=>a-b);
    lines.push(`  ${rows[0].courseName||id}: ${weeks.join(', ')}주차 / 미완료 ${rows.filter(row=>!row.completed).length}개`);
  }
  lines.push(`미완료 ${pending.length}개 / 완료 ${entries.length-pending.length}개 제외`);
  lines.push(`예상 재생 시간: ${known.length?`약 ${durationLabel(seconds)}`:pending.length?'계산 불가':'0분'}${known.length<pending.length?` + 길이 미확인 ${pending.length-known.length}개`:''}`);
  if(pending.length) lines.push('전체 영상 길이 기준입니다. 이어보기로 짧아질 수 있고, 로딩·완료 확인 시간은 별도입니다.');
  const late=pending.filter(row=>row.dueAt&&new Date(row.dueAt).getTime()<new Date(now).getTime()).length;
  if(late) lines.push(`주의: 출석 기한이 지난 영상 ${late}개 — 재생 완료 후에도 결석일 수 있습니다.`);
  return lines.join('\n');
}

const key=row=>`${row.courseId??''}:${row.id}`;
const phaseLabels={starting:'준비 중',login:'로그인 중',inventory:'강의 목록 확인 중',running:'순차 재생 중',
  'final-verification':'LMS 최종 확인 중',completed:'전체 완료 확인',unverified:'완료 미확인 항목 있음',
  interrupted:'중단됨',cancelled:'선택 취소',error:'오류로 중단됨',empty:'재생 대상 없음',listed:'목록 확인 완료'};

export function formatStatus(state,{processAlive=false}={}) {
  const selected=state.selected||[];
  const final=state.final;
  const results=state.results||[];
  const verified=new Set(results.filter(row=>row.status==='completed'||row.status==='skipped').map(key));
  const total=final?.length??selected.length;
  const completed=final?final.filter(row=>row.completed).length:
    selected.filter(row=>row.completed||verified.has(key(row))).length;
  const active=['starting','login','inventory','running','final-verification'].includes(state.phase);
  const stopped=active&&!processAlive;
  const lines=[`\n${stopped?'실행 중단 감지':phaseLabels[state.phase]||'상태 확인 필요'}`,`LMS 완료 ${completed}/${total}개 / 미확인 ${total-completed}개`];
  if(active&&state.current?.title) lines.push(`현재 강의: ${state.current.title}`);
  if(active&&state.progress) lines.push(state.progress);
  const absent=(final||results).filter(row=>row.attendance==='결석').length;
  if(absent) lines.push(`출결: 결석 ${absent}개 — 학습 완료와 출석 인정은 별도입니다.`);
  if(state.phase==='unverified') {
    for(const row of final||[]) if(!row.completed) lines.push(`  미확인: ${row.title||'영상'}${row.week?` (${row.week}주차)`:''}`);
  }
  if(state.error) lines.push(`안내: ${state.error}`);
  if(stopped||['interrupted','error','unverified'].includes(state.phase))
    lines.push('해결 후 다시 실행하세요. 이미 완료된 영상은 자동으로 건너뜁니다. 설치 문제는 --check로 확인하세요.');
  else if(state.phase==='completed') lines.push('선택한 모든 영상의 LMS 완료 표시를 확인했습니다. 다음에도 같은 실행 파일을 사용하세요.');
  return lines.join('\n');
}

export function createConsoleReporter(output=process.stdout) {
  let progressLine=false;
  return message=>{
    const progress=/^(?:\[[^\]]+\] )?재생 \d+ \/ \d+초$/.test(message);
    if(output.isTTY&&progress) {
      output.write(`\r\x1b[2K${message}`);progressLine=true;
    } else {
      if(progressLine) output.write('\n');
      progressLine=false;output.write(`${message}\n`);
    }
  };
}
