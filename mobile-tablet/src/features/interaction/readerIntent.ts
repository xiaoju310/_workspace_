import type { SegmentOut } from '../../types/interaction'
import { pageNoOf } from './pageTimeline'
import type { PageRef } from './pageTimeline'
export type ReaderIntent = {kind:'play'|'pause'|'resume'|'stop'} | {kind:'scene'|'text'|'frame';query:string} | {kind:'question'}
export interface FrameVoiceRequest { id:number; query:string; scope:string; videoMs:number | null }
/** Full-utterance controls only: questions/negations containing "play" are not commands. */
export function classifyReaderIntent(raw:string):ReaderIntent {
  const q=raw.trim().replace(/[。！？!?，,.]+$/g,'').trim()
  const s=q.toLowerCase().replace(/^(?:请(?:你|帮我)?|麻烦(?:你)?|please\s+)/,'').replace(/(?:吧|一下)$/,'').trim()
  if (/^(?:播放|开始播放|播放视频|开始播放视频|播放故事|开始讲故事|play(?: the)?(?: video| story)?|start(?: playback| playing)?)$/.test(s))return {kind:'play'}
  if (/^(?:暂停|暂停播放|暂停视频|停一下|pause(?: the)?(?: video| playback)?)$/.test(s))return {kind:'pause'}
  if (/^(?:继续|继续播放|继续播放视频|接着播放|resume(?: the)?(?: video| playback)?|continue(?: playing| playback)?)$/.test(s))return {kind:'resume'}
  if (/^(?:结束|结束播放|停止|停止播放|停止视频|stop(?: the)?(?: video| playback)?|end(?: playback)?)$/.test(s))return {kind:'stop'}
  const quoted=q.match(/(?:查找|找到|框选|圈出|高亮|找出|find|highlight|locate)\s*[“"‘']([^”"’']+)[”"’']/i)
  if(quoted && /字|文字|单词|词语|word|text|highlight|框选|圈出|高亮/i.test(q))return {kind:'text',query:quoted[1].trim()}
  const text=s.match(/^(?:查找|找到|框选|圈出|高亮|找出)(?:画面中|画面里|当前画面)?(?:的)?(.+?)(?:这?几个字|这?两个字|这?三个字|这?个字|几个字|文字|单词|词语)$/)
  if(text)return {kind:'text',query:text[1].replace(/[“”"‘']/g,'').trim()}
  const englishText=s.match(/^(?:find|highlight|locate)\s+(?:the\s+)?(?:word|words|text)\s+(.+)$/)
  if(englishText)return {kind:'text',query:englishText[1].replace(/^["']|["']$/g,'').trim()}
  const scene=s.match(/^(?:找到|查找|找出|跳到|定位到|转到|回到|find\s+|go to\s+|jump to\s+|show\s+)(.+)$/i)
  if(scene)return {kind:'scene',query:scene[1].trim()}
  // Visual attributes and visible actions use the real current frame, not story-text guesses.
  // Causal, historical and story-summary questions retain the ordinary evidence-based route.
  if(!/为什么|为何|什么原因|\bwhy\b|故事|原文|书里|书中|以前|后来|story|book|before|after/i.test(q) &&
    /(?:什么|啥)(?:形状|颜色)|(?:什么|啥)样子|(?:什么|啥)东西.*(?:跳|跑|飞|冒|钻)|\bwhat\s+(?:colou?r|shape)\b|^what\s+(?:(?:has|just)\s+)?(?:jumped|ran|flew|popped|came|appeared|is visible)\b/i.test(q))return {kind:'frame',query:raw.trim()}
  if(/当前画面|这张图|图中|图片里|画面里|画面中|这里.*(?:颜色|什么|谁)|这是什么|这是谁|这个.*(?:什么|颜色|谁)|这.*是什么|这里.*(?:什么|谁)|\b(?:in (?:this|the) (?:picture|image|frame)|this picture|this image)\b/i.test(q))return {kind:'frame',query:raw.trim()}
  return {kind:'question'}
}
const normalized=(s:string)=>s.toLowerCase().replace(/[\s，,。.!！?？“”"'、：:；;]/g,'')
/** Locate only an unambiguous, literally supported segment. Never invent a timestamp. */
export function locateScene(query:string,pages:(PageRef&{ocr_text:string;edit_text?:string;confirmed?:boolean})[],segments:SegmentOut[]|undefined,duration:number):{ok:true;ms:number;pageNo:number}|{ok:false;message:string} {
  const target=normalized(query.replace(/(?:出现的|的)?(?:画面|场景|片段)$|(?:the )?(?:scene|picture|frame)$/i,'').replace(/^(?:the )?(?:scene (?:of|where) )/i,'').trim())
  if(!target)return {ok:false,message:'请说明要查找的场景。'}
  const explicit=query.match(/^(?:第\s*(\d+)\s*页|page\s+(\d+))$/i)
  const candidates:( {ms:number;pageNo:number;score:number} )[]=[]
  for(const segment of segments??[]) {
    if(!Number.isFinite(segment.start_ms)||!Number.isFinite(segment.end_ms)||segment.start_ms<0||segment.end_ms<=segment.start_ms||segment.end_ms>duration)continue
    const page=pages.find((p,i)=>pageNoOf(p,i)===segment.page_no)
    if(!page || page.confirmed===false)continue
    const content=normalized(segment.caption||'')
    const original=normalized(page.edit_text??page.ocr_text)
    const score=explicit ? (segment.page_no===Number(explicit[1]??explicit[2])?1:0) : content.includes(target)?1:original.includes(target)?.9:0
    if(score)candidates.push({ms:segment.start_ms,pageNo:segment.page_no,score})
  }
  candidates.sort((a,b)=>b.score-a.score||a.ms-b.ms)
  if(!candidates.length)return {ok:false,message:'没有找到有原文/分镜依据且具备可靠时间轴的场景，不会猜测跳转。'}
  const first=candidates[0]
  if(candidates.some(c=>c.pageNo!==first.pageNo&&c.score===first.score))return {ok:false,message:'找到多个可能的场景，请补充人物、动作或页码后再定位。'}
  return {ok:true,ms:first.ms,pageNo:first.pageNo}
}
