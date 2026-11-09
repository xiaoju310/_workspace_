import fs from 'node:fs';
import path from 'node:path';
import {PictureBookRagEngine} from '../docs/test-results/d6/engine-source/src/features/interaction/qa/PictureBookRagEngine.ts';
import {TimeSliceIndexer} from '../docs/test-results/d6/engine-source/src/features/interaction/indexing/TimeSliceIndexer.ts';
const root=process.cwd();
const out=path.join(root,'docs/test-results/d6');fs.mkdirSync(out,{recursive:true});
const source=JSON.parse(fs.readFileSync(path.join(root,'docs/test-results/d4/corrected-reference-script.json'),'utf8').replace(/^\uFEFF/,''));
const cases=[
 ['D6-01','小禾穿着什么颜色的上衣？',1,['蓝色']],
 ['D6-02','桌上有几个红苹果？',1,['2个']],
 ['D6-03','红苹果放在哪里？',1,['桌上']],
 ['D6-04','小禾拿起了什么？',2,['书']],
 ['D6-05','书是什么颜色？',2,['绿色']],
 ['D6-06','书名是什么？',2,['森林日记']],
 ['D6-07','书名是森林日记吗？',2,['森林日记']],
 ['D6-08','小禾几岁？',null,[]],
 ['D6-09','小禾为什么拿起书？',null,[]],
 ['D6-10','书里有恐龙吗？',null,[]]
].map(([case_id,question,expected_page,keywords])=>({case_id,question,expected_page,keywords}));
const slices=source.pages.map(p=>({page_no:p.page_no,video_start_ms:0,video_end_ms:0,ocr_content:p.narration,entities:[],script:'',frame_objects:[],lighting:'',snippet:p.narration}));
const records=[];
for(const c of cases){
 const engine=new PictureBookRagEngine();
 const start=performance.now();
 const actual=await engine.generateAnswer({book_id:'e-d2-synthetic',run_id:c.case_id,query_text:c.question,video_ms:0},new TimeSliceIndexer(slices));
 const retrievalPass=c.expected_page===null?actual.evidence.length===0:actual.evidence[0]?.page_no===c.expected_page;
 const answerPass=c.expected_page===null?actual.status==='no_evidence':actual.status==='success'&&c.keywords.every(k=>actual.answer.includes(k));
 records.push({...c,asr_status:'未测',asr_actual:null,audio_ref:null,retrieval_status:retrievalPass?'通过':'失败',answer_status:answerPass?'通过':'失败',error_category:!retrievalPass?'检索':!answerPass?'回答':'无（仅文本链路）',duration_ms:performance.now()-start,actual});
}
fs.writeFileSync(path.join(out,'questions.json'),JSON.stringify(cases,null,2));
fs.writeFileSync(path.join(out,'text-results.json'),JSON.stringify({task_date:'2026-11-09',mode:'local_text_engine_on_synthetic_reference',audio_to_asr_executed:false,timeline:'无真实视频；0为接口占位，不是视频时间证据',records},null,2));
const cols=['case_id','question','expected_page','audio_ref','asr_status','asr_actual','retrieval_status','answer_status','error_category','duration_ms','answer','evidence_pages'];
const csv=[cols,...records.map(r=>cols.map(k=>k==='answer'?r.actual.answer:k==='evidence_pages'?r.actual.evidence.map(e=>e.page_no).join('|'):r[k]??''))].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');
fs.writeFileSync(path.join(out,'test-cases.csv'),'\uFEFF'+csv);
console.log(JSON.stringify({count:records.length,retrieval_pass:records.filter(r=>r.retrieval_status==='通过').length,answer_pass:records.filter(r=>r.answer_status==='通过').length,failures:records.filter(r=>r.error_category.startsWith('检索')||r.error_category==='回答').map(r=>({id:r.case_id,q:r.question,answer:r.actual.answer,category:r.error_category}))},null,2));
