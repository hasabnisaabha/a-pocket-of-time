/* Flexible MCQ detector. Loaded after the old parser so this function wins. */
function parseMCQ(input){
  let raw=String(input||'').replace(/\r/g,'').replace(/\u00a0/g,' ').replace(/===== PAGE \d+ =====/g,'\n');
  const answerHead=/(?:^|\n)\s*(?:answer\s*key|answers?|solutions?)\s*:?/i;
  const ak=raw.match(answerHead);
  const answerText=ak?raw.slice(ak.index+ak[0].length):'';
  const key=[];
  const keyRe=/(?:^|\s)(?:Q(?:uestion)?\s*)?(\d{1,4})\s*[.)\-:]?\s*\(?([A-Da-d1-4])\)?(?=\s|$)/g;let km;
  while((km=keyRe.exec(answerText)))key.push({n:+km[1],a:/^[1-4]$/.test(km[2])?'ABCD'[+km[2]-1]:km[2].toUpperCase()});
  if(ak)raw=raw.slice(0,ak.index);
  raw=raw.replace(/\[OCR NEEDED\]/gi,' ');
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const id=()=>`q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const qre=/(?:^|\s)(?:Q(?:uestion)?\s*\.?\s*#?\s*|Question\s+)?(\d{1,4})\s*[.)\-:]\s+/gi;
  const optRe=/(?:^|\s)(?:\(([A-Da-d])\)|\[([A-Da-d])\]|([A-Da-d])[.)\-:])\s*/g;
  const numRe=/(?:^|\s)(?:\(([1-4])\)|\[([1-4])\]|([1-4])[.)\-:])\s*/g;
  function build(num,body,line){
    body=clean(body);let answer=null;
    const am=body.match(/\b(?:correct\s+)?answer\s*[:\-]?\s*(?:option\s*)?\(?([A-Da-d1-4])\)?\b/i);
    if(am){answer=/^[1-4]$/.test(am[1])?'ABCD'[+am[1]-1]:am[1].toUpperCase();body=clean(body.slice(0,am.index))}
    let ms=[...body.matchAll(optRe)], chosen=null;
    for(let i=0;i<=ms.length-4;i++)if(ms.slice(i,i+4).map(m=>(m[1]||m[2]||m[3]).toUpperCase()).join('')==='ABCD'){chosen=ms.slice(i,i+4);break}
    const o={A:'',B:'',C:'',D:''};let question=body;
    if(chosen){question=clean(body.slice(0,chosen[0].index));chosen.forEach((m,i)=>{const label=(m[1]||m[2]||m[3]).toUpperCase();o[label]=clean(body.slice(m.index+m[0].length,chosen[i+1]?.index??body.length))})}
    else {const nm=[...body.matchAll(numRe)];if(nm.length>=4){question=clean(body.slice(0,nm[0].index));nm.slice(0,4).forEach((m,i)=>o['ABCD'[i]]=clean(body.slice(m.index+m[0].length,nm[i+1]?.index??body.length)))}}
    return{id:id(),displayedNumber:num??null,question,options:o,correctAnswer:answer,sourceLine:line};
  }
  let out=[];
  const starts=[...raw.matchAll(qre)];
  // Numbered questions. Only treat a number as a question when the following block has options,
  // unless it is explicitly Q/Question labelled.
  for(let i=0;i<starts.length;i++){
    const s=starts[i],end=starts[i+1]?.index??raw.length;
    const body=raw.slice(s.index+s[0].length,end);
    const built=build(+s[1],body,raw.slice(0,s.index).split('\n').length);
    const full=clean(body), hasOpts=Object.values(built.options).filter(Boolean).length>=4;
    const explicit=/^\s*(?:Q|Question)/i.test(s[0]);
    if(hasOpts||explicit)out.push(built);
  }
  // If numbering got destroyed by PDF extraction, find every A-B-C-D run and use the text before A as the question.
  if(!out.length || out.filter(q=>Object.values(q.options).filter(Boolean).length>=4).length<Math.max(1,out.length*.5)){
    const joined=raw.replace(/\n+/g,' '),ms=[...joined.matchAll(optRe)];let pos=0, inferred=[];
    while(pos<ms.length){let k=-1;for(let i=pos;i<=ms.length-4;i++){if(ms.slice(i,i+4).map(m=>(m[1]||m[2]||m[3]).toUpperCase()).join('')==='ABCD'){k=i;break}}if(k<0)break;const end=ms[k+4]?.index??joined.length;const built=build(null,joined.slice(pos?ms[pos-1].index+ms[pos-1][0].length:0,end),1);if(built.question&&Object.values(built.options).every(Boolean))inferred.push(built);pos=k+4}if(inferred.length)out=inferred;
  }
  // Map answer keys by document order when counts match, otherwise by a unique displayed number.
  if(key.length===out.length)out.forEach((q,i)=>{if(!q.correctAnswer)q.correctAnswer=key[i].a});
  else out.forEach(q=>{const a=key.filter(x=>String(x.n)===String(q.displayedNumber));if(a.length===1&&!q.correctAnswer)q.correctAnswer=a[0].a});
  out.forEach(q=>{const missing=['A','B','C','D'].filter(k=>!clean(q.options[k]));q.status=q.question&&missing.length===0&&q.correctAnswer?'READY':'REVIEW';q.diagnostic=q.status==='READY'?'Looks complete.':(!q.question?'Question text missing. ':'')+(missing.length?'Missing '+missing.join(', ')+'. ':'')+(!q.correctAnswer?'Correct answer not found.':'')});
  return{version:'2.1',candidates:out,rejected:[],diagnostics:[],counts:{detected:out.length,ready:out.filter(q=>q.status==='READY').length,review:out.filter(q=>q.status==='REVIEW').length,rejected:0}};
}
