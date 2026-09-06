// ===== robust mcq-parser.js =====
const QSTART=/^(?:Q(?:uestion)?\s*#?\s*(\d+)\s*[:.)-]?|Question\s+(\d+)\s*[:.)-]?|(\d+)\s*[.)-]?)(?:\s+|$)(.*)$/i;
const ANSWER_HEAD=/^(?:answer\s*key|answers?|solutions?|detailed\s+answers?|detailed\s+solutions?|explanations?)\s*:?[\s]*$/i;
const LOCAL_ANS=/^(?:answer|correct\s+answer)\s*[:\-]?\s*(?:option\s*)?([A-D1-4])\b/i;
const MARKER=/(?:^|\s|\()([A-Da-d])\s*[.)\-:](?=\s|$)/g;
const NUMMARK=/(?:^|\s|\()([1-4])\s*[.)\-:](?=\s|$)/g;
function clean(s){return String(s??'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim()}
function answerLetter(x){x=String(x||'').toUpperCase();return /^[1-4]$/.test(x)?'ABCD'[+x-1]:x}
function isHead(s){return ANSWER_HEAD.test(clean(s))}
function qStart(s){const m=QSTART.exec(clean(s));return m?{number:m[1]||m[2]||m[3]||null,text:clean(m[4]||'')}:null}
function id(){return 'q_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9)}
function parseInline(text){
  const s=clean(text); let ms=[...s.matchAll(MARKER)];
  if(ms.length<4){ms=[...s.matchAll(NUMMARK)];if(ms.length<4)return null}
  const marks=ms.slice(0,8).map(m=>({i:m.index+(m[0].startsWith(' ')?1:0),k:answerLetter(m[1])}));
  const wanted=['A','B','C','D']; if(!wanted.every(k=>marks.some(m=>m.k===k)))return null;
  const first=marks.find(m=>m.k==='A'); const opts={};
  for(let n=0;n<marks.length;n++){const a=marks[n],b=marks[n+1];if(!wanted.includes(a.k))continue;opts[a.k]=clean(s.slice(a.i+a.k.length+(s[a.i+a.k.length]===' '?1:0),b?b.i:s.length))}
  if(!wanted.every(k=>opts[k]))return null;
  return {question:clean(s.slice(0,first.i)),options:opts}
}
function parseOptionLine(s){
  let m=/^\(?([A-Da-d])\)?\s*[.)\-:]\s*(.*)$/i.exec(clean(s));
  if(m)return {k:m[1].toUpperCase(),text:clean(m[2])};
  m=/^\(?([1-4])\)?\s*[.)\-:]\s*(.*)$/.exec(clean(s));
  if(m)return {k:answerLetter(m[1]),text:clean(m[2])};
  return null;
}
function extractAnswers(lines,start){const out=[];for(let i=start;i<lines.length;i++){const s=clean(lines[i]);let m=/^(?:Q(?:uestion)?\s*)?(\d+)\s*[:.)-]?\s*([A-D1-4])\b/i.exec(s);if(m)out.push({n:+m[1],a:answerLetter(m[2])})}return out}
function parseMCQs(txt,meta={}){
  const raw=String(txt??'').replace(/\r/g,'').split('\n');
  const lines=raw.map(clean); const head=lines.findIndex(isHead); const end=head>=0?head:lines.length;
  const candidates=[]; const rejected=[];
  let current=null, optionMode=false, lastOpt=null;
  function finish(){
    if(!current)return;
    const opts=current.options; const missing=['A','B','C','D'].filter(k=>!opts[k]);
    const reasons=[]; if(!current.question.trim())reasons.push('Missing question text'); if(missing.length)reasons.push('Missing option(s): '+missing.join(', ')); if(!current.correctAnswer)reasons.push('No confidently mapped correct answer');
    current.status=reasons.length?'REVIEW':'READY';current.diagnostic=reasons.join('; ')||'All four options and answer detected.';candidates.push(current);current=null;optionMode=false;lastOpt=null;
  }
  function begin(number,text,line){finish();current={id:id(),displayedNumber:number,question:clean(text),options:{A:'',B:'',C:'',D:''},correctAnswer:null,status:'REVIEW',sourceLine:line+1,sourcePage:meta.pageMap?.[line]??null,rawText:raw[line]||'',diagnostic:''}}
  for(let i=0;i<end;i++){
    const s=lines[i];if(!s)continue;
    if(isHead(s)){finish();break}
    const qs=qStart(s);
    const inline=parseInline(s);
    if(qs){
      begin(qs.number,qs.text,i);
      if(inline){current.question=inline.question;current.options=inline.options;optionMode=true;lastOpt='D';}
      continue;
    }
    if(inline && !current){begin(null,inline.question,i);current.options=inline.options;optionMode=true;lastOpt='D';continue}
    const op=parseOptionLine(s);
    if(op){
      if(!current)begin(null,'',i);
      current.options[op.k]=op.text;lastOpt=op.k;optionMode=true;current.rawText+='\n'+raw[i];continue;
    }
    const ans=LOCAL_ANS.exec(s);if(ans&&current){current.correctAnswer=answerLetter(ans[1]);continue}
    if(current&&optionMode&&lastOpt){current.options[lastOpt]=clean(current.options[lastOpt]+' '+s);current.rawText+='\n'+raw[i];continue}
    if(current)current.question=clean(current.question+' '+s);
  }
  finish();
  const entries=head>=0?extractAnswers(lines,head+1):[];
  if(entries.length){
    if(entries.length===candidates.length)candidates.forEach((c,i)=>{if(!c.correctAnswer)c.correctAnswer=entries[i].a});
    else for(const e of entries){const m=candidates.filter(c=>String(c.displayedNumber)===String(e.n));if(m.length===1&&!m[0].correctAnswer)m[0].correctAnswer=e.a}
  }
  for(const c of candidates){const missing=['A','B','C','D'].filter(k=>!c.options[k]);const reasons=[];if(!c.question)reasons.push('Missing question text');if(missing.length)reasons.push('Missing option(s): '+missing.join(', '));if(!c.correctAnswer)reasons.push('No confidently mapped correct answer');c.status=reasons.length?'REVIEW':'READY';c.diagnostic=reasons.join('; ')||'All four options and answer detected.'}
  const valid=candidates.filter(c=>c.question&&Object.values(c.options).filter(Boolean).length>=2);
  const kept=[];for(const c of candidates){if(Object.values(c.options).filter(Boolean).length>=2||c.question)kept.push(c);else rejected.push({id:id(),status:'REJECTED AS NON-MCQ',sourceLine:c.sourceLine,rawText:c.rawText,diagnostic:'Could not find a plausible question/options structure.'})}
  return {version:'2.0',sourceName:meta.sourceName||'Imported source',sourceFilename:meta.sourceFilename||'',importedAt:new Date().toISOString(),candidates:kept,rejected,diagnostics:[],counts:{detected:kept.length,ready:kept.filter(c=>c.status==='READY').length,review:kept.filter(c=>c.status==='REVIEW').length,rejected:rejected.length}}
}
function validateApprovedQuestions(qs){return qs.every(q=>q.question?.trim()&&['A','B','C','D'].every(k=>q.options?.[k]?.trim())&&['A','B','C','D'].includes(q.correctAnswer))}
