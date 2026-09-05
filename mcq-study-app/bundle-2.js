// ===== mcq-parser.js =====
/* General-purpose MCQ parser. It never writes to storage or creates quiz records. */

const HEADING_RE = /^(?:answer\s*key|answers?|solutions?|detailed\s+answers?|detailed\s+solutions?|explanations?)\s*:?[\s]*$/i;
const OPTION_RE = /^(?:\(([A-D])\)|([A-D])[.)])\s+(.+)$/i;
const OPTION_ONLY_RE = /^(?:\(([A-D])\)|([A-D])[.)])\s*$/i;
const NUM_OPTION_RE = /^(?:\(([1-4])\)|([1-4])[.)])\s+(.+)$/;
const QUESTION_RE = /^(?:Q(?:uestion)?\s*\.?\s*#?\s*(\d+)\s*[:.)-]?|Question\s+(\d+)\s*[:.)-]?|(\d+)\s*[.)])\s*(.*)$/i;
const QUESTION_ONLY_RE = /^(?:Q(?:uestion)?\s*\.?\s*#?\s*(\d+)|Question\s+(\d+)|\d+)\s*:?$/i;
const LOCAL_ANSWER_RE = /^(?:answer|correct\s+answer)\s*[:\-]?\s*(?:option\s*)?([A-D1-4])\b/i;

function clean(s) { return String(s ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim(); }
function nonEmpty(lines) { return lines.map(clean).filter(Boolean); }
function id() { return 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }
function optionLetter(raw) { const x = String(raw).toUpperCase(); return /^[1-4]$/.test(x) ? 'ABCD'[Number(x)-1] : x; }
function isAnswerHeading(line) { return HEADING_RE.test(clean(line)); }
function isOption(line) { return OPTION_RE.test(clean(line)) || OPTION_ONLY_RE.test(clean(line)) || NUM_OPTION_RE.test(clean(line)); }
function parseOption(line, numericMode=false) {
  const text=clean(line); const m = (numericMode ? NUM_OPTION_RE : OPTION_RE).exec(text) || (numericMode ? null : OPTION_ONLY_RE.exec(text));
  if (!m) return null;
  return { letter: optionLetter(m[1] || m[2]), text: clean(m[3] || ''), raw: line };
}
function numericOptionSequence(lines, i) {
  const nums=[];
  for(let j=i;j<Math.min(lines.length,i+6);j++){ const m=NUM_OPTION_RE.exec(clean(lines[j])); if(m) nums.push(Number(m[1]||m[2])); else if(clean(lines[j])) break; }
  return nums.length>=4 && new Set(nums.slice(0,4)).size===4;
}

function parseQuestionStart(line) {
  const s = clean(line);
  if (isAnswerHeading(s) || OPTION_RE.test(s)) return null;
  const m = QUESTION_RE.exec(s);
  if (!m) return null;
  return { number: m[1] || m[2] || m[3] || null, text: clean(m[4] || ''), raw: line };
}
function looksLikeNumberedQuestion(lines, i) {
  const s = clean(lines[i]);
  if (!/^\d+[.)]\s+/.test(s)) return false;
  const n = Number(s.match(/^(\d+)/)[1]);
  // A numbered line is considered a question only when a plausible 4-option set follows.
  // This prevents ordinary numbered prose from becoming MCQs.
  let seenNum = [], seenLetter = [];
  for (let j=i+1; j<Math.min(lines.length, i+24); j++) {
    const l=clean(lines[j]); if (!l) continue;
    if (isAnswerHeading(l)) break;
    const nm=NUM_OPTION_RE.exec(l); if (nm) { seenNum.push(Number(nm[1]||nm[2])); if (seenNum.length>=4 && new Set(seenNum).size===4) return true; }
    const lm=OPTION_RE.exec(l) || OPTION_ONLY_RE.exec(l); if (lm) { seenLetter.push((lm[1]||lm[2]).toUpperCase()); if (seenLetter.length>=4 && new Set(seenLetter).size===4) return true; }
    if (seenNum.length===0 && seenLetter.length===0 && QUESTION_RE.test(l)) break;
  }
  return false;
}

function splitInline(text) {
  // Finds lettered option markers occurring after question text. Conservative on purpose.
  const re = /(?:^|\s)(\(?[A-D]\)?[.)])\s+/gi;
  const matches=[]; let m;
  while ((m=re.exec(text))) matches.push({index:m.index + (m[0].startsWith(' ') ? 1 : 0), marker:m[1]});
  if (matches.length < 4) return null;
  const first=matches[0];
  const opts={};
  for(let i=0;i<matches.length;i++){
    const a=matches[i], b=matches[i+1];
    const marker=a.marker.replace(/[().]/g,'').toUpperCase();
    if (!'ABCD'.includes(marker)) continue;
    const end=b ? b.index : text.length;
    opts[marker]=clean(text.slice(a.index+a.marker.length,end));
  }
  if(['A','B','C','D'].every(k=>opts[k])) return {question: clean(text.slice(0,first.index)), options:opts};
  return null;
}

function extractAnswerEntries(lines, start) {
  const entries=[];
  for(let i=start;i<lines.length;i++){
    const s=clean(lines[i]); if(!s) continue;
    if (/^(?:detailed\s+answers?|detailed\s+solutions?|explanations?)\b/i.test(s) && !/^answers?\s*:/i.test(s)) break;
    let m=/^(\d+)\s*[.)\-:]\s*([A-D1-4])\b/i.exec(s);
    if(m) entries.push({number:Number(m[1]), answer:optionLetter(m[2]), line:i});
    else {
      m=/^(?:Q(?:uestion)?\s*\.?\s*(\d+)|Question\s+(\d+))\s*[:.)-]?\s*([A-D1-4])\b/i.exec(s);
      if(m) entries.push({number:Number(m[1]||m[2]), answer:optionLetter(m[3]), line:i});
    }
  }
  return entries;
}

function detectAnswerSection(lines) {
  for(let i=0;i<lines.length;i++) if(isAnswerHeading(lines[i])) return i;
  return -1;
}

function parseMCQs(txt, metadata={}) {
  const rawLines=String(txt ?? '').split(/\r?\n/);
  const lines=rawLines.map(x=>x.replace(/\r/g,''));
  const answerSection=detectAnswerSection(lines);
  const scanEnd=answerSection>=0 ? answerSection : lines.length;
  const candidates=[];
  const diagnostics=[];
  let i=0;

  while(i<scanEnd){
    let start=parseQuestionStart(lines[i]);
    if (start && /^\d+[.)]\s+/.test(clean(lines[i])) && !looksLikeNumberedQuestion(lines,i) && !splitInline(start.text)) start=null;
    if(!start){
      // Question number on its own line.
      if(QUESTION_ONLY_RE.test(clean(lines[i])) && !isOption(lines[i])) {
        const m=QUESTION_ONLY_RE.exec(clean(lines[i]));
        start={number:m?.[1]||m?.[2]||clean(lines[i]).match(/^\d+/)?.[0]||null,text:''};
      }
    }
    if(!start){i++; continue;}

    const sourceLine=i+1;
    const originalNumber=start.number;
    let qText=start.text;
    let opts={};
    let numericMode=false;
    let j=i+1;
    let localAnswer=null;
    const blockLines=[lines[i]];

    const inline=splitInline(start.text);
    if(inline){ qText=inline.question; opts=inline.options; j=i+1; }

    while(j<scanEnd){
      const l=clean(lines[j]);
      if(!l){j++; continue;}
      if(LOCAL_ANSWER_RE.test(l)){ localAnswer=optionLetter(LOCAL_ANSWER_RE.exec(l)[1]); j++; continue; }
      const nextQBeforeOption=parseQuestionStart(l);
      if(nextQBeforeOption && Object.keys(opts).length>=4) break;
      if(nextQBeforeOption && !numericMode && !numericOptionSequence(lines,j)) break;
      let op=parseOption(l,false);
      if(!op && (Object.keys(opts).length===0 || numericMode) && NUM_OPTION_RE.test(l) && (numericMode || numericOptionSequence(lines,j))) { op=parseOption(l,true); numericMode=true; }
      if(op){
        opts[op.letter]=op.text; blockLines.push(lines[j]); j++; continue;
      }
      // Once options have started, non-option text is a continuation of the last option.
      if(Object.keys(opts).length>0 && !parseQuestionStart(l)){
        if(['A','B','C','D'].some(k=>opts[k]==='')){ const empty=['A','B','C','D'].find(k=>opts[k]===''); opts[empty]=l; blockLines.push(lines[j]); j++; continue; }
        const last=['A','B','C','D'].reverse().find(k=>opts[k]);
        if(last) opts[last]=clean(opts[last]+' '+l); else qText=clean(qText+' '+l);
        blockLines.push(lines[j]); j++; continue;
      }
      // Before options, collect question continuation unless this is another question.
      const nextQ=parseQuestionStart(l);
      if(!nextQ){ qText=clean(qText+' '+l); blockLines.push(lines[j]); j++; continue; }
      break;
    }

    // Avoid treating ordinary numeric prose as a candidate unless four options exist or it is explicitly labelled Question/Q.
    const explicit=/^(?:Q(?:uestion)?|Question)\b/i.test(clean(lines[i]));
    const optionCount=Object.keys(opts).length;
    const missing=['A','B','C','D'].filter(k=>!opts[k]);
    let status='REVIEW';
    let reason=[];
    if(!qText) reason.push('Missing question text');
    if(optionCount<4) reason.push(`Only ${optionCount} of 4 options detected`);
    if(missing.length) reason.push('Missing option(s): '+missing.join(', '));
    let answer=localAnswer;
    if(answer && !opts[answer]) { reason.push('Detected answer points to a missing option'); answer=null; }
    const candidate={
      id:id(), displayedNumber:originalNumber, question:clean(qText),
      options:{A:opts.A||'',B:opts.B||'',C:opts.C||'',D:opts.D||''},
      correctAnswer:answer||null, status:'REVIEW', sourcePage:metadata.pageMap?.[sourceLine-1] ?? null,
      sourceLine, rawText:blockLines.join('\n'), diagnostic:reason.join('; ')||'Answer not yet confidently mapped'
    };
    candidates.push(candidate);
    i=Math.max(j,i+1);
  }

  // Map a global answer key by sequence, not by question number. This remains safe when numbering repeats.
  if(answerSection>=0){
    const entries=extractAnswerEntries(lines,answerSection+1);
    const usable=candidates.filter(c=>c.status==='REVIEW');
    if(entries.length===candidates.length){
      candidates.forEach((c,idx)=>{ if(!c.correctAnswer){ c.correctAnswer=entries[idx].answer; c.diagnostic='Mapped from answer key by document order (not question number).'; }});
    } else {
      // If counts do not match, only map when the key's sequence aligns with unique displayed numbers.
      const counts=new Map(); candidates.forEach(c=>counts.set(c.displayedNumber,(counts.get(c.displayedNumber)||0)+1));
      entries.forEach(e=>{
        const matches=candidates.filter(c=>String(c.displayedNumber)===String(e.number));
        if(matches.length===1 && !matches[0].correctAnswer){ matches[0].correctAnswer=e.answer; matches[0].diagnostic='Mapped from answer key using a unique displayed question number.'; }
      });
    }
  }

  for(const c of candidates){
    const missing=['A','B','C','D'].filter(k=>!c.options[k]);
    const reasons=[];
    if(!c.question) reasons.push('Missing question text');
    if(missing.length) reasons.push('Missing option(s): '+missing.join(', '));
    if(!c.correctAnswer) reasons.push('No confidently mapped correct answer');
    if(reasons.length===0) c.status='READY'; else { c.status='REVIEW'; c.diagnostic=reasons.join('; '); }
  }

  // Strong rejection: numbered prose with no options, not explicitly labelled as a question.
  // Preserve it in diagnostics, but do not present it as an MCQ candidate.
  const rejected=[];
  const allNumbered=rawLines.map((line,idx)=>({line,idx})).filter(x=>/^\s*\d+[.)]\s+/.test(x.line));
  const candidateStarts=new Set(candidates.map(c=>c.sourceLine-1));
  for(const x of allNumbered){
    if(candidateStarts.has(x.idx)) continue;
    const s=clean(x.line);
    if(!looksLikeNumberedQuestion(rawLines,x.idx) && !OPTION_RE.test(s) && !OPTION_ONLY_RE.test(s) && !numericOptionSequence(rawLines,x.idx)) rejected.push({id:id(),status:'REJECTED AS NON-MCQ',sourceLine:x.idx+1,rawText:x.line,diagnostic:'Numbered prose did not show a plausible four-option MCQ structure.'});
  }

  const ready=candidates.filter(c=>c.status==='READY').length;
  const review=candidates.filter(c=>c.status==='REVIEW').length;
  return {
    version:'1.0', sourceName:metadata.sourceName||'Imported source', sourceFilename:metadata.sourceFilename||'',
    importedAt:new Date().toISOString(), candidates, rejected, diagnostics,
    counts:{detected:candidates.length,ready,review,rejected:rejected.length}
  };
}

function validateApprovedQuestions(questions){
  return questions.every(q=>q.question?.trim() && ['A','B','C','D'].every(k=>q.options?.[k]?.trim()) && ['A','B','C','D'].includes(q.correctAnswer));
}
