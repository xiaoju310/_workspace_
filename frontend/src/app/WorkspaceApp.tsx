import { useCallback, useEffect, useRef, useState } from 'react'
import WorkspaceShell from '../components/WorkspaceShell'
import HomePage from '../pages/HomePage'
import ImportBookPage from '../pages/ImportBookPage'
import { ReviewPage, ClassificationPage } from '../pages/ReviewPages'
import ProgressPage from '../pages/ProgressPage'
import InteractiveReaderPage from '../pages/InteractiveReaderPage'
import HistoryPage from '../pages/HistoryPage'
import NoteReviewPage from '../pages/NoteReviewPage'
import ShareNotePage from '../pages/ShareNotePage'
import SharedNotePage from '../pages/SharedNotePage'
import SettingsPage from '../pages/SettingsPage'
import { initialBooks, initialNotes, emptyJob, jobStages, originalPages } from '../mock/workspace'
import type { ImportedBookInput, Interaction, JobState, Page, ReadingBook, ReadingNote, ShareGrant, Source } from './types'
import type { PreviewState } from '../features/books/types'
import { Icon } from '../components/ui'

const SESSION_KEY = 'paper-companion-full-v1'
const validPages = new Set<Page>(['home','import','review','classification','progress','reader','history','notes','sharing','shared','settings'])
function readSession(): {books:ReadingBook[];notes:ReadingNote[];grants:ShareGrant[];interactions:Interaction[]}|null {
  try { const raw=sessionStorage.getItem(SESSION_KEY);if(!raw)return null; const data=JSON.parse(raw);return data.schema===1&&Array.isArray(data.books)&&Array.isArray(data.notes)&&Array.isArray(data.grants)&&Array.isArray(data.interactions)?data:null } catch { return null }
}
function route() { const [name,query]=location.hash.replace(/^#\//,'').split('?');return {page:validPages.has(name as Page)?name as Page:'home' as Page,query:new URLSearchParams(query)} }
function uid(prefix:string) { return `${prefix}-${crypto.randomUUID()}` }
function timestamp() { return new Date().toISOString() }
function makeNote(book:ReadingBook):ReadingNote {return {id:uid('mock-note'),book_id:book.id,title:`《${book.title}》的阅读发现`,summary:book.pages.map(p=>p.ocr_text).filter(Boolean).join('\n\n'),concepts:['人物','情节','我的发现'],sources:book.pages.map((p,i)=>({source:'original_page',page_no:i+1,start_ms:null,end_ms:null,quote:p.ocr_text.slice(0,140)})),review_status:'draft',visibility:'private',revision:1,reviewed_revision:null,updated_at:timestamp()}}

export default function WorkspaceApp() {
  const restored=useRef(readSession())
  const [books,setBooks]=useState<ReadingBook[]>(()=>restored.current?.books??initialBooks())
  const [notes,setNotes]=useState<ReadingNote[]>(()=>restored.current?.notes??initialNotes())
  const [grants,setGrants]=useState<ShareGrant[]>(()=>restored.current?.grants??[])
  const [interactions,setInteractions]=useState<Interaction[]>(()=>restored.current?.interactions??[])
  const [page,setPage]=useState<Page>(()=>route().page)
  const [selectedId,setSelectedId]=useState(()=>route().query.get('book')??books[0].id)
  const [state,setState]=useState<PreviewState>('success')
  const [job,setJob]=useState<JobState>(()=>{
    const initial=books.find(item=>item.id===selectedId)??books[0]
    return initial.status==='READY'?{...emptyJob(),status:'ready',stage:5,progress:100,run_id:initial.run_id,events:[{stage:'历史状态',message:'已有的本地演示结果，不是本次实时生成。',time:timestamp()}]}:initial.status==='GENERATING'?{...emptyJob(),status:'failed',run_id:initial.run_id,error:'演示任务尚未完成或会话已刷新，请重新确认后重试。'}:emptyJob()
  })
  const [toast,setToast]=useState('')
  const [recipient,setRecipient]=useState('')
  const [shareToken,setShareToken]=useState(()=>route().query.get('token')??'')
  const [seekTo,setSeekTo]=useState<number|null>(null)
  const sessionWarned=useRef(false)
  const previousBookId=useRef(selectedId)
  const book=books.find(item=>item.id===selectedId)??books[0]
  const note=notes.find(item=>item.book_id===book.id)??null
  const grant=grants.find(item=>item.token===shareToken)??null
  useEffect(()=>{if(previousBookId.current===book.id)return;previousBookId.current=book.id;setJob(book.status==='READY'?{...emptyJob(),status:'ready',progress:100,stage:5,run_id:book.run_id,events:[{stage:'历史状态',message:'此书为已有的本地演示结果，不是本次实时生成。',time:timestamp()}]}:book.status==='GENERATING'?{...emptyJob(),status:'failed',run_id:book.run_id,error:'演示会话已切换，本次任务未继续执行。请重试以创建新的模拟运行。'}:emptyJob())},[book.id,book.status,book.run_id])
  const notify=useCallback((text:string)=>setToast(text),[])
  const navigate=useCallback((next:Page,bookId?:string)=>{
    if(bookId)setSelectedId(bookId)
    setPage(next);setState('success');setToast('')
    const query=new URLSearchParams();if(bookId)query.set('book',bookId)
    location.hash=`#/${next==='home'?'':next}${query.size?'?'+query.toString():''}`
    window.scrollTo({top:0})
  },[])
  useEffect(()=>{const changed=()=>{const current=route();setPage(current.page);setState('success');const id=current.query.get('book');if(id)setSelectedId(id);if(current.page==='shared')setShareToken(current.query.get('token')??'')};window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed)},[])
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(timer)},[toast])
  useEffect(()=>{
    try {sessionStorage.setItem(SESSION_KEY,JSON.stringify({schema:1,books:books.map(item=>({...item,pages:item.pages.filter(p=>p.demo),page_count:item.pages.length})),notes,grants,interactions}))}
    catch { if(!sessionWarned.current){sessionWarned.current=true;notify('当前浏览器无法保存会话。刷新后将恢复初始演示数据。')} }
  },[books,notes,grants,interactions,notify])
  const updateBook=(updater:(current:ReadingBook)=>ReadingBook)=>{
    const next=updater(book)
    const contentChanged=book.pages.map(p=>`${p.id}:${p.ocr_text}`).join('\n')!==next.pages.map(p=>`${p.id}:${p.ocr_text}`).join('\n')
    setBooks(current=>current.map(item=>item.id===book.id?next:item))
    if(next.status==='REVIEW_REQUIRED')setJob(emptyJob())
    if(contentChanged){
      setJob(emptyJob())
      setNotes(current=>current.map(item=>item.book_id===book.id?{...item,review_status:'draft',visibility:'private',reviewed_revision:null,revision:item.revision+1,sources:next.pages.map((p,i)=>({source:'original_page',page_no:i+1,start_ms:null,end_ms:null,quote:p.ocr_text.slice(0,140)})),updated_at:timestamp()}:item))
      const ids=notes.filter(item=>item.book_id===book.id).map(item=>item.id)
      setGrants(current=>current.map(item=>ids.includes(item.note_id)?{...item,status:'revoked'}:item))
    }
  }

  useEffect(()=>{
    if(job.status!=='running')return
    const timer=setTimeout(()=>{
      setJob(current=>{
        if(current.status!=='running')return current
        const progress=Math.min(100,current.progress+10)
        const stage=Math.min(5,Math.floor(progress/18))
        return {...current,progress,stage,status:progress>=100?'review':'running',events:stage!==current.stage?[...current.events,{stage:jobStages[stage],message:'模拟阶段结果，仅用于界面演示。',time:timestamp()}]:current.events}
      })
    },650)
    return()=>clearTimeout(timer)
  },[job])
  useEffect(()=>{if(job.status==='ready')setBooks(current=>current.map(item=>item.run_id===job.run_id?{...item,status:'READY',safety_reviewed:true}:item))},[job.status,job.run_id])
  useEffect(()=>{if(job.status!=='ready')return;const completed=books.find(item=>item.run_id===job.run_id);if(!completed||notes.some(item=>item.book_id===completed.id))return;setNotes(current=>[makeNote(completed),...current])},[job.status,job.run_id,books,notes])

  function generate(){
    if(!book.pages.length||book.pages.some(p=>!p.confirmed)||!book.classification.owner_confirmed){notify('请先完成逐页文字校对和主人类型确认。');return}
    const runId=uid('mock-run')
    updateBook(current=>({...current,status:'GENERATING',safety_reviewed:false,run_id:runId,job_id:uid('mock-job')}))
    setJob({status:'running',stage:0,progress:0,error:null,run_id:runId,events:[{stage:jobStages[0],message:'开始本地模拟任务，不调用模型、不生成真实视频。',time:timestamp()}]})
    navigate('progress',book.id)
  }
  async function completeImport(input:ImportedBookInput){
    const id=uid('local-book')
    // 克隆图片 URL 的所有权，导入组件卸载时释放其原始 URL。
    const pages=await Promise.all(input.pages.map(async p=>{let imageUrl=p.url;if(!p.demo){const blob=await (await fetch(p.url)).blob();imageUrl=URL.createObjectURL(blob)}return {id:p.id,name:p.name,image_url:imageUrl,ocr_text:p.demo?(originalPages[Number(p.id.replace('demo-',''))-1]??''):'',confidence:p.demo?.86:0,revision:1,confirmed:false,demo:Boolean(p.demo)}}))
    setBooks(current=>[{id,title:input.title,subtitle:'刚刚带进来的新故事。',cover:'/art/cover-forest.svg',page_count:pages.length,status:'REVIEW_REQUIRED',classification:{predicted_type:input.type,confidence:input.type==='unknown'?null:.72,reasons:['模拟分类，真实预测需等待 B 的模型服务。'],confirmed_type:null,owner_confirmed:false},updated_label:'刚刚',authorization_ref:input.authorization_ref,pages,age_band:'6–9 岁（待人工审核）',run_id:null,job_id:null,video_url:null,origin:'mock',safety_reviewed:false},...current])
    navigate('review',id)
  }
  function saveNote(patch:Pick<ReadingNote,'title'|'summary'|'concepts'>){
    if(!patch.title.trim()||!patch.summary.trim()){notify('笔记标题和摘要不能为空。');return}
    setNotes(current=>current.map(item=>item.id===note?.id?{...item,...patch,title:patch.title.trim(),summary:patch.summary.trim(),review_status:'draft',visibility:'private',reviewed_revision:null,revision:item.revision+1,updated_at:timestamp()}:item))
    setGrants(current=>current.map(item=>item.note_id===note?.id&&item.status==='active'?{...item,status:'revoked'}:item))
    notify('修改已保存为私密草稿；旧审核和旧分享已失效。')
  }
  function reviewNote(decision:'submit'|'approve'|'reject'){
    if(!note)return
    if(decision==='approve'&&note.review_status!=='in_review'){notify('请先提交主人审核。');return}
    setNotes(current=>current.map(item=>item.id!==note.id?item:{...item,review_status:decision==='submit'?'in_review':decision==='approve'?'approved':'rejected',reviewed_revision:decision==='approve'?item.revision:null,visibility:'private',updated_at:timestamp()}))
    if(decision!=='approve')setGrants(current=>current.map(item=>item.note_id===note.id?{...item,status:'revoked'}:item))
    notify(decision==='approve'?'主人已确认当前笔记版本（本地模拟）。':decision==='submit'?'已提交主人审核（本地模拟）。':'已退回修改，分享保持私密。')
  }
  function createShare(input:{mode:ShareGrant['mode'];recipients:string[];minutes:number}){
    if(!note||note.review_status!=='approved'||note.reviewed_revision!==note.revision){notify('当前版本尚未通过主人审核，无法分享。');return null}
    if(input.mode==='named_users'&&input.recipients.length===0){notify('请填写至少一个演示用户标识。');return null}
    if(!Number.isFinite(input.minutes)||input.minutes<=0){notify('请选择有效的分享时限。');return null}
    const next:ShareGrant={id:uid('mock-share'),token:crypto.randomUUID(),note_id:note.id,note_revision:note.revision,snapshot:JSON.parse(JSON.stringify(note)),mode:input.mode,recipients:input.recipients,expires_at:new Date(Date.now()+input.minutes*60000).toISOString(),status:'active',created_at:timestamp()}
    setGrants(current=>[next,...current]);setNotes(current=>current.map(item=>item.id===note.id?{...item,visibility:'shared'}:item));return next
  }
  function revoke(id:string){setGrants(current=>current.map(item=>item.id===id?{...item,status:'revoked'}:item));const other=grants.some(item=>item.id!==id&&item.note_id===note?.id&&item.status==='active'&&Date.parse(item.expires_at)>Date.now());if(!other)setNotes(current=>current.map(item=>item.id===note?.id?{...item,visibility:'private'}:item));notify('本地演示分享已撤销。')}
  function openGrant(item:ShareGrant){setShareToken(item.token);setRecipient('');setPage('shared');setState('success');location.hash=`#/shared?token=${encodeURIComponent(item.token)}`;window.scrollTo({top:0})}
  function seek(source:Source){if(source.start_ms!==null){setSeekTo(source.start_ms);navigate('reader',book.id)}else{try{sessionStorage.setItem('paper-companion-focus-page',String(source.page_no))}catch{/* 页面仍可打开 */}navigate('review',book.id)}}
  function generateNote(){if(book.status!=='READY'){notify('请先完成生成阶段和内容复核。');return}if(note){navigate('notes');return}setNotes(current=>[makeNote(book),...current]);navigate('notes')}
  async function question(text:string,videoMs:number):Promise<Interaction>{
    await new Promise(resolve=>setTimeout(resolve,400))
    const target=/朋友|小熊|回信/.test(text)?book.pages.findIndex(p=>p.ocr_text.includes('小熊')):/哪里|森林|去/.test(text)?book.pages.findIndex(p=>p.ocr_text.includes('走进森林')):Math.min(book.pages.length-1,Math.floor(videoMs/12000))
    const excerpt=book.pages[target]?.ocr_text??''
    const uncertain=!/信|狐狸|朋友|小熊|森林|哪里|这页|勇气/.test(text)||!excerpt
    return{id:uid('mock-interaction'),book_id:book.id,run_id:book.run_id??'mock-unstarted',kind:'question',question:text,transcript:text,answer:uncertain?'这段模拟内容里还没有足够依据，我不确定。请结合书页确认。':`演示引用：第 ${target+1} 页写道：“${excerpt.slice(0,180)}” 这是按关键词展示的原文，未调用问答模型。`,video_ms:videoMs,sources:uncertain?[]:[{source:'original_page',page_no:target+1,start_ms:null,end_ms:null,quote:excerpt}],latency_ms:null,created_at:timestamp(),uncertain,origin:'mock',cached:false}
  }
  async function touch(x:number,y:number,videoMs:number,box:{width:number;height:number}):Promise<Interaction>{
    if(x<0||x>1||y<0||y>1||box.width<=0||box.height<=0)throw new Error('点击位于视频内容之外。')
    await new Promise(resolve=>setTimeout(resolve,300))
    const pageNo=Math.min(book.pages.length,Math.floor(Math.max(0,videoMs)/12000)+1)
    const excerpt=book.pages[pageNo-1]?.ocr_text??''
    return{id:uid('mock-touch'),book_id:book.id,run_id:book.run_id??'mock-unstarted',kind:'touch',question:`画面位置 (${x.toFixed(2)}, ${y.toFixed(2)})`,transcript:'',answer:excerpt?`已记录点击位置。当前仅展示第 ${pageNo} 页文字：“${excerpt.slice(0,180)}” 未进行视觉识别，无法据此确定点中的物体。`:'已记录点击位置；当前页缺少文字依据，无法确定点中的物体。',video_ms:videoMs,sources:excerpt?[{source:'original_page',page_no:pageNo,start_ms:null,end_ms:null,quote:excerpt}]:[],latency_ms:null,created_at:timestamp(),uncertain:true,origin:'mock',cached:false}
  }
  const context={book,state,setState,navigate,notify}
  const workflow={...context,updateBook,job,setJob,onGenerate:generate}
  const missingPages=book.pages.length===0&&page!=='home'&&page!=='import'&&page!=='settings'&&page!=='shared'
  return <WorkspaceShell page={page} state={state} setState={setState} navigate={navigate}>{page!=='home'&&page!=='import'&&page!=='settings'&&page!=='shared'&&<div className="book-context-bar"><span><Icon name="book" size={16}/>当前图书</span><select aria-label="当前图书" value={book.id} onChange={e=>{setSelectedId(e.target.value);setState('success')}}>{books.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><span className="context-origin">{book.origin==='mock'?'原创 / 本地模拟':'真实数据'}</span></div>}
    {missingPages?<div className="page-content"><div className="state-panel"><Icon name="image" size={32}/><h2>本次书页预览已结束</h2><p>用户选择的图片只保留在内存，刷新后需要重新导入。图书名和笔记仍保留在当前会话。</p><button className="button button-primary" onClick={()=>navigate('import')}>重新导入书页</button></div></div>:<>
    {page==='home'&&<HomePage books={books} notes={notes} state={state} setState={setState} onImport={()=>navigate('import')} onBook={item=>navigate(item.status==='READY'?'reader':'review',item.id)} onNote={id=>{const target=notes.find(n=>n.id===id);navigate('notes',target?.book_id)}}/>}
    {page==='import'&&<ImportBookPage state={state} setState={setState} onHome={()=>navigate('home')} onComplete={input=>{void completeImport(input).catch(()=>notify('图片转移到校对页失败，请重新导入。'))}}/>}
    {page==='review'&&<ReviewPage {...workflow}/>}{page==='classification'&&<ClassificationPage {...workflow}/>}{page==='progress'&&<ProgressPage {...workflow}/>}
    {page==='reader'&&<><InteractiveReaderPage {...context} interactions={interactions.filter(i=>i.book_id===book.id)} onInteraction={item=>setInteractions(current=>[item,...current])} seekTo={seekTo} onSeekHandled={()=>setSeekTo(null)} askQuestion={question} identifyTouch={touch}/><div className="reader-next"><button className="button button-secondary" onClick={generateNote}>整理阅读笔记<Icon name="note" size={16}/></button><button className="button button-ghost" onClick={()=>navigate('history')}>查看阅读历史<Icon name="arrow" size={16}/></button></div></>}
    {page==='history'&&<HistoryPage {...context} interactions={interactions.filter(i=>i.book_id===book.id)} onSeek={ms=>{setSeekTo(ms);navigate('reader')}}/>}
    {page==='notes'&&<NoteReviewPage {...context} note={note} onSave={saveNote} onReview={reviewNote} onSeek={seek}/>}
    {page==='sharing'&&<ShareNotePage {...context} note={note} grants={grants.filter(g=>g.note_id===note?.id)} onCreate={createShare} onRevoke={revoke} onOpen={openGrant}/>}
    {page==='shared'&&<SharedNotePage state={state} grant={grant} recipient={recipient} setRecipient={setRecipient} navigate={navigate}/>}
    {page==='settings'&&<SettingsPage navigate={navigate} onReset={()=>{books.forEach(item=>item.pages.forEach(p=>{if(!p.demo)URL.revokeObjectURL(p.image_url)}));setBooks(initialBooks());setNotes(initialNotes());setGrants([]);setInteractions([]);setSelectedId('demo-forest');setJob(emptyJob());navigate('home');notify('演示已重置。')}}/>}</>}
    {toast&&<div className="toast" role="status"><Icon name="info" size={17}/>{toast}<button aria-label="关闭提示" onClick={()=>setToast('')}><Icon name="close" size={16}/></button></div>}
  </WorkspaceShell>
}

