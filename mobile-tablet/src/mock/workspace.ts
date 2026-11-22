import { books } from './books'
import type { ReadingBook, ReadingNote, JobState } from '../app/types'

export const originalPages = [
  '清晨，小狐狸在树下捡到一封信。信封上画着一片小小的叶子。“这是谁寄来的呢？”它轻轻地问。',
  '小狐狸带着信走进森林。小鸟指向山坡上的邮局：“去那里问问吧。”风吹过树叶，像在说加油。',
  '邮局里，小熊正在整理信件。“这是写给新朋友的。”小熊笑着说。小狐狸读完信，也写下了自己的第一封回信。',
]
export const otherPages = [
  ['夜晚，邮局的灯亮了。小兔写下一封信，想把今天的心愿寄给月亮。','邮差小鸟接过信，飞过安静的屋顶。小兔学会用文字表达自己的心情。','第二天，小兔收到了朋友的回信。原来愿意倾听的人，一直就在身边。'],
  ['种子落在松软的土里。水分和合适的温度，让它开始发芽。','细根向下生长，嫩芽朝有光的方向伸展。叶片展开，植物开始制造养分。','季节更替，花朵结出新的种子。风把种子带向远方，新的生长又开始了。'],
]
export function initialBooks(): ReadingBook[] {
  const images=[['/art/page-forest-1.svg','/art/page-forest-2.svg','/art/page-forest-3.svg'],['/art/page-moon-1.svg','/art/page-moon-2.svg','/art/page-moon-3.svg'],['/art/page-seed-1.svg','/art/page-seed-2.svg','/art/page-seed-3.svg']]
  return books.map((book, i) => ({ ...book, page_count: 3, authorization_ref: '团队原创合成内容 · 不含赛事样本', age_band: '6–9 岁（演示标签，待人工审核）', origin: 'mock', run_id: i === 0 ? 'mock-run-forest-001' : null, job_id: null, video_url: null, safety_reviewed: i === 0, pages: (i===0?originalPages:otherPages[i-1]).map((text, p) => ({id:`${book.id}-p${p+1}`,name:`原创示例-${p+1}.svg`,image_url:images[i][p],ocr_text:text,confidence:p===1?.72:.96,revision:1,confirmed:i===0,demo:true})) }))
}
export function initialNotes(): ReadingNote[] {
  return [{id:'note-forest',book_id:'demo-forest',title:'关于勇气与友谊的三个发现',summary:'小狐狸从一封陌生的来信开始，走进森林寻找答案。它通过询问小鸟、拜访邮局结识小熊，也学会主动表达自己的心意。勇气有时就是迈出一步，友谊从愿意回应开始。',concepts:['勇气','友谊','主动表达'],sources:[{source:'original_page',page_no:1,start_ms:null,end_ms:null,quote:originalPages[0]},{source:'original_page',page_no:3,start_ms:null,end_ms:null,quote:originalPages[2]}],review_status:'draft',visibility:'private',revision:1,reviewed_revision:null,updated_at:new Date().toISOString()}]
}
export function emptyJob(): JobState { return {status:'idle',stage:0,progress:0,error:null,run_id:null,events:[]} }
export const jobStages = ['图文解析','分类与结构','阅读脚本','视频与配音','笔记草稿','主人复核']


