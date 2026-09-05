// ===== storage.js =====
const DB='local-mcq-study'; const VER=1;
let dbPromise;
function open(){ if(dbPromise)return dbPromise; dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open(DB,VER); r.onupgradeneeded=()=>{const db=r.result; ['imports','quizzes','progress','settings','daily'].forEach(s=>{if(!db.objectStoreNames.contains(s))db.createObjectStore(s,{keyPath:'id'});});}; r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);}); return dbPromise; }
async function put(store,value){const db=await open(); return new Promise((res,rej)=>{const t=db.transaction(store,'readwrite'); t.objectStore(store).put(value); t.oncomplete=()=>res(value); t.onerror=()=>rej(t.error);});}
async function get(store,id){const db=await open();return new Promise((res,rej)=>{const t=db.transaction(store,'readonly');const r=t.objectStore(store).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function all(store){const db=await open();return new Promise((res,rej)=>{const t=db.transaction(store,'readonly');const r=t.objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function del(store,id){const db=await open();return new Promise((res,rej)=>{const t=db.transaction(store,'readwrite');t.objectStore(store).delete(id);t.oncomplete=()=>res();t.onerror=()=>rej(t.error);});}
async function clearStore(store){const db=await open();return new Promise((res,rej)=>{const t=db.transaction(store,'readwrite');t.objectStore(store).clear();t.oncomplete=()=>res();t.onerror=()=>rej(t.error);});}
async function exportAll(){return {version:1,exportedAt:new Date().toISOString(),imports:await all('imports'),quizzes:await all('quizzes'),progress:await all('progress'),settings:await all('settings'),daily:await all('daily')};}
async function importAll(data){for(const s of ['imports','quizzes','progress','settings','daily']) for(const x of (data?.[s]||[])) await put(s,x);}

// ===== spaced-repetition.js =====
const intervals=[1,3,7,14,30,60,120,240];
function nextReview(state,correct,now=Date.now()){
  const s={...(state||{}),repetitions:(state?.repetitions||0),intervalIndex:(state?.intervalIndex||0)};
  if(correct){s.repetitions++;s.intervalIndex=Math.min(s.intervalIndex+1,intervals.length-1);} else {s.repetitions=0;s.intervalIndex=0;}
  const days=intervals[s.intervalIndex]; s.intervalDays=days; s.dueAt=now+days*86400000; s.lastResult=correct?'correct':'wrong'; s.updatedAt=now; return s;
}
function isDue(state,now=Date.now()){return !state?.dueAt || state.dueAt<=now;}

// ===== quiz-engine.js =====
async function recordAnswer(quiz,question,correct,{advance=true}={}){
  const key=`${quiz.id}:${question.id}`; const prev=await get('progress',key)||{id:key,quizId:quiz.id,questionId:question.id,wrong:false,repetitions:0,intervalIndex:0};
  const state=nextReview(prev,correct); state.wrong=!correct; await put('progress',state);
  if(advance){ const p=quiz.progress||{currentIndex:0,answered:0}; p.answered=(p.answered||0)+1; p.currentIndex=Math.min((p.currentIndex||0)+1,quiz.questions.length); quiz.progress=p; await put('quizzes',quiz); } return state;
}
async function getWrongQuestions(){
  const {all}=await import('./storage.js'); const [qs,prog]=await Promise.all([all('quizzes'),all('progress')]); const wrong=[]; for(const q of qs) for(const x of q.questions||[]){const p=prog.find(z=>z.quizId===q.id&&z.questionId===x.id); if(p?.wrong)wrong.push({quiz:q,question:x,progress:p});} return wrong;
}

// ===== daily-paper.js =====
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
async function getDailyPaper(count){const day=new Date().toISOString().slice(0,10); const id=`${day}:${count}`; const saved=await get('daily',id); if(saved)return saved;
 const quizzes=await all('quizzes'), progress=await all('progress'), pool=[];
 for(const q of quizzes) for(const x of q.questions||[]){const p=progress.find(z=>z.quizId===q.id&&z.questionId===x.id)||{}; const priority=p.wrong?0:(isDue(p)?1:2); pool.push({quizId:q.id,questionId:x.id,priority});}
 const selected=[]; for(const pr of [0,1,2]){const part=shuffle(pool.filter(x=>x.priority===pr)); for(const x of part){if(selected.length>=count)break; if(!selected.some(y=>y.quizId===x.quizId&&y.questionId===x.questionId))selected.push(x);} if(selected.length>=count)break;}
 const paper={id,date:day,count,items:selected}; await put('daily',paper); return paper; }

// ===== txt-editor.js =====
function makeDownload(text,name='extracted.txt'){const b=new Blob([text],{type:'text/plain;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

// ===== diagnostics.js =====
function summary(importRec){return importRec?.diagnosticsSummary||{};}

// ===== mcq-review.js =====
function renderCandidate(c,handlers){
 const el=document.createElement('article');el.className='question';
 const badge=c.status==='READY'?'ready':c.status==='REVIEW'?'review':'rejected';
 el.innerHTML=`<div class="row"><span class="pill ${badge}">${c.status}</span><span class="muted small">ID ${c.id} · Question ${c.displayedNumber??'—'} · source line ${c.sourceLine}</span></div><h3>${reviewEsc(c.question||'[missing question]')}</h3>${['A','B','C','D'].map(k=>`<div class="option"><b>${k}.</b> ${reviewEsc(c.options?.[k]||'[missing]')}</div>`).join('')}<p class="small">Correct: <b>${c.correctAnswer||'UNKNOWN'}</b></p><p class="small danger-text">${reviewEsc(c.diagnostic||'')}</p>`;
 const b=document.createElement('div');b.className='row';
 if(c.status!=='REJECTED AS NON-MCQ'){const a=document.createElement('button');a.textContent=c.approved?'Approved ✓':'Approve';a.disabled=!!c.approved;a.onclick=()=>handlers.approve(c.id);b.append(a);}
 const e=document.createElement('button');e.className='secondary';e.textContent='Edit';e.onclick=()=>handlers.edit(c.id);b.append(e);
 const d=document.createElement('button');d.className='danger';d.textContent=c.status==='REJECTED AS NON-MCQ'?'Delete':'Reject / Delete';d.onclick=()=>handlers.reject(c.id);b.append(d);el.append(b);return el;
}
function reviewEsc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

// ===== pdf-importer.js =====
const PDFJS='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.min.mjs';
let pdfjsPromise;
async function pdfjs(){if(!pdfjsPromise)pdfjsPromise=import(PDFJS).then(m=>{m.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.worker.min.mjs';return m;});return pdfjsPromise;}

async function openLocalFile(pdfjsLib,file){
  const CHUNK=1024*1024;
  const first=await file.slice(0,CHUNK).arrayBuffer();
  class FileRangeTransport extends pdfjsLib.PDFDataRangeTransport{
    constructor(){super(file.size,new Uint8Array(first),false,file.name);}
    requestDataRange(begin,end){
      file.slice(begin,end).arrayBuffer().then(buf=>{this.onDataRange(begin,new Uint8Array(buf));});
    }
  }
  const range=new FileRangeTransport();
  return pdfjsLib.getDocument({range,rangeChunkSize:CHUNK,disableAutoFetch:true,disableStream:true,enableScripting:false}).promise;
}

async function extractPDF(file,{onProgress,onPage}={}){
 const pdfjsLib=await pdfjs(); const pdf=await openLocalFile(pdfjsLib,file); const pages=[]; let textPages=0;
 for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);const tc=await page.getTextContent();let text=tc.items.map(i=>i.str).join(' ').replace(/[ \t]+/g,' ').trim();let method='text';if(text.length<8)method='ocr-needed';else textPages++;const rec={page:n,text,method};pages.push(rec);onPage?.(rec);onProgress?.(n,pdf.numPages);page.cleanup?.();}
 try{await pdf.cleanup();await pdf.destroy();}catch(_){}
 return {pageCount:pages.length,textPages,ocrPages:pages.filter(p=>p.method==='ocr-needed').length,pages};
}

async function ocrPage(file,pageNumber,{onProgress}={}){
 if(!window.Tesseract)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/7.0.0/tesseract.min.js';s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});
 const pdfjsLib=await pdfjs();const pdf=await openLocalFile(pdfjsLib,file);const page=await pdf.getPage(pageNumber);const viewport=page.getViewport({scale:1.7});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
 const worker=await Tesseract.createWorker('eng',1,{logger:m=>onProgress?.(m.progress||0,m.status||'')});const out=await worker.recognize(canvas);await worker.terminate();try{await pdf.cleanup();await pdf.destroy()}catch(_){}return out.data.text||'';
}
function toTXT(result){return result.pages.map(p=>`===== PAGE ${p.page} | ${p.method==='ocr-needed'?'OCR REQUIRED':'TEXT'} =====\n${p.text||'[NO EXTRACTABLE TEXT — OCR REQUIRED]'}`).join('\n\n');}
