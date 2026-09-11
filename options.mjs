export function parseOptions(args) {
  const options={weeks:undefined,course:undefined,list:false,help:false,status:false,nonInteractive:false,current:false};
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg==='--weeks') {
      options.weeks=[];
      while(i+1<args.length&&!args[i+1].startsWith('--')) {
        const raw=args[++i];
        if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>53) throw new Error('--weeks에는 1~53 사이 주차를 입력하세요.');
        options.weeks.push(Number(raw));
      }
      if(!options.weeks.length) throw new Error('예: --weeks 1 2');
    } else if(arg==='--course') {
      const value=args[++i];
      if(options.course) throw new Error('--course는 한 번만 지정하세요. 여러 과목은 all 또는 대화형 선택을 사용하세요.');
      if(value!=='all'&&!/^[1-9]\d*$/.test(value||'')) throw new Error('--course에는 과목 ID 또는 all을 입력하세요.');
      options.course=value;
    } else if(arg==='--list') options.list=true;
    else if(arg==='--help'||arg==='-h') options.help=true;
    else if(arg==='--status') options.status=true;
    else if(arg==='--non-interactive') options.nonInteractive=true;
    else if(arg==='--current') options.current=true;
    else throw new Error(`알 수 없는 옵션: ${arg}`);
  }
  if(options.current&&options.weeks) throw new Error('--current와 --weeks는 함께 사용할 수 없습니다.');
  if(options.nonInteractive&&!options.help&&!options.status&&!options.list&&(!options.course||(!options.weeks&&!options.current)))
    throw new Error('--non-interactive 재생에는 --course ID|all과 --weeks 1 2 또는 --current가 필요합니다.');
  return options;
}
