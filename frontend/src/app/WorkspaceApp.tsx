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
import type { ImportedBookInput, Interaction, JobState, Page, ReadingBook, ReadingNote, ShareGrant, SharedProps, Source, TouchDetail, VoiceCapture } from './types'
import type { PreviewState } from '../features/books/types'
import type { AppMode } from '../types/interaction'
import { Icon } from '../components/ui'
import { apiClient, fromBackendBookType } from '../lib/api'
import { buildSlicesFromBook } from '../features/interaction/indexing/buildSlices'
import { TimeSliceIndexer } from '../features/interaction/indexing/TimeSliceIndexer'
import { createShareOnServer, noteToServerContent, revokeShareOnServer, reviewOnServer } from '../lib/noteSync'
import { registerServerBook, startServerAnalysis, summarizeRunJobs } from '../lib/liveBookFlow'
import { pageImageBlob } from '../features/books/pageImage'
import type { SegmentOut } from '../types/interaction'
import { loadRunVideo } from '../lib/runVideo'
import { buildInteractionCsv, summarizeRecords } from '../lib/latencyExport'
import type { BackendInteractionRecord } from '../lib/latencyExport'
import { loadSharedNote, parseSharedRef, serverShareHash } from '../lib/sharedNoteView'
import type { SharedRef } from '../lib/sharedNoteView'
import type { RunVideoState } from './types'

/**
 * 会话按模式隔离（E-023）：旧实现 Live/Demo 共用一个 key，且切换模式时组件不重建，
 * Demo 的模拟记录会出现在 Live 的历史/看板里，反之亦然。
 */
const SESSION_KEY_BASE = 'paper-companion-full-v1'
export function sessionKeyFor(mode: AppMode) { return `${SESSION_KEY_BASE}:${mode}` }
/** 供延迟看板读取当前模式会话里的真实交互记录。读取失败必须如实带出原因，不能伪装成"没有数据" */
export function readSessionInteractions(mode: AppMode): { interactions: Interaction[]; error: string | null } {
  let raw: string | null
  try { raw=sessionStorage.getItem(sessionKeyFor(mode)) } catch (e: any) { return { interactions: [], error: `浏览器会话存储不可用：${e?.message ?? e}` } }
  if(!raw) return { interactions: [], error: null }
  try { const data=JSON.parse(raw); return data?.schema===1&&Array.isArray(data.interactions)?{ interactions: data.interactions, error: null }:{ interactions: [], error: '会话数据格式不符(schema≠1)，未读取' } }
  catch (e: any) { return { interactions: [], error: `会话数据损坏：${e?.message ?? e}` } }
}
const validPages = new Set<Page>(['home','import','review','classification','progress','reader','history','notes','sharing','shared','settings'])
function readSession(mode: AppMode): {books:ReadingBook[];notes:ReadingNote[];grants:ShareGrant[];interactions:Interaction[]}|null {
  try { const raw=sessionStorage.getItem(sessionKeyFor(mode));if(!raw)return null; const data=JSON.parse(raw);return data.schema===1&&Array.isArray(data.books)&&Array.isArray(data.notes)&&Array.isArray(data.grants)&&Array.isArray(data.interactions)?data:null } catch { return null }
}
function route() { const [name,query]=location.hash.replace(/^#\//,'').split('?');return {page:validPages.has(name as Page)?name as Page:'home' as Page,query:new URLSearchParams(query)} }
function uid(prefix:string) { return `${prefix}-${crypto.randomUUID()}` }
function timestamp() { return new Date().toISOString() }
function makeNote(book:ReadingBook):ReadingNote {return {id:uid('note'),book_id:book.id,title:`《${book.title}》的阅读发现`,summary:book.pages.map(p=>p.ocr_text).filter(Boolean).join('\n\n'),concepts:['人物','情节','我的发现'],sources:book.pages.map((p,i)=>({source:'original_page',page_no:i+1,start_ms:null,end_ms:null,quote:p.ocr_text.slice(0,140)})),review_status:'draft',visibility:'private',revision:1,reviewed_revision:null,updated_at:timestamp()}}

/** 后端任务的进度以服务端为准：切书或刷新后重新轮询，不显示本地"演示任务"文案 */
function serverJobFor(book:ReadingBook):JobState{
  if(book.status==='READY'&&book.safety_reviewed)return {...emptyJob(),status:'ready',stage:5,progress:100,run_id:book.run_id,server:true}
  return {...emptyJob(),status:'running',run_id:book.run_id,server:true,events:[{stage:'后端任务',message:'正在读取后端任务状态。',time:timestamp()}]}
}

export default function WorkspaceApp({ appMode = 'live' }: { appMode?: AppMode }) {
  const restored=useRef(readSession(appMode))
  const [books,setBooks]=useState<ReadingBook[]>(()=>restored.current?.books??initialBooks())
  const [notes,setNotes]=useState<ReadingNote[]>(()=>restored.current?.notes??initialNotes())
  const [grants,setGrants]=useState<ShareGrant[]>(()=>restored.current?.grants??[])
  const [interactions,setInteractions]=useState<Interaction[]>(()=>restored.current?.interactions??[])
  const [page,setPage]=useState<Page>(()=>route().page)
  const [selectedId,setSelectedId]=useState(()=>route().query.get('book')??books[0].id)
  const [state,setState]=useState<PreviewState>('success')
  const [job,setJob]=useState<JobState>(()=>{
    const initial=books.find(item=>item.id===selectedId)??books[0]
    if(initial.server_book_id&&initial.run_id)return serverJobFor(initial)
    return initial.status==='READY'?{...emptyJob(),status:'ready',stage:5,progress:100,run_id:initial.run_id,events:[{stage:'历史状态',message:'已有的本地演示结果，不是本次实时生成。',time:timestamp()}]}:initial.status==='GENERATING'?{...emptyJob(),status:'failed',run_id:initial.run_id,error:'演示任务尚未完成或会话已刷新，请重新确认后重试。'}:emptyJob()
  })
  const [toast,setToast]=useState('')
  const [recipient,setRecipient]=useState('')
  const [shareToken,setShareToken]=useState(()=>route().query.get('token')??'')
  const [sharedRef,setSharedRef]=useState<SharedRef|null>(()=>parseSharedRef(route().query))
  const [sharedView,setSharedView]=useState<SharedProps['serverView']>(undefined)
  const [sharedNonce,setSharedNonce]=useState(0)
  const [seekTo,setSeekTo]=useState<number|null>(null)
  const sessionWarned=useRef(false)
  const previousBookId=useRef(selectedId)
  const segmentsCacheRef=useRef<Map<string,SegmentOut[]>>(new Map())
  const warnedSegmentsRef=useRef<Set<string>>(new Set())
  // 每个 run 的视频加载状态（blob: URL 只在内存中，不写入会话存储，刷新后重新下载）
  const [videos,setVideos]=useState<Record<string,RunVideoState>>({})
  const videoUrlsRef=useRef<Map<string,string>>(new Map())
  // 每个 run 的加载代号：「重新检查视频」后，上一次还没返回的结果作废，不能覆盖新状态
  const videoGenRef=useRef<Map<string,number>>(new Map())
  const book=books.find(item=>item.id===selectedId)??books[0]
  const video=book.run_id?videos[book.run_id]:undefined
  const note=notes.find(item=>item.book_id===book.id)??null
  const grant=grants.find(item=>item.token===shareToken)??null

  useEffect(()=>{if(previousBookId.current===book.id)return;previousBookId.current=book.id;setJob(book.server_book_id&&book.run_id?serverJobFor(book):book.status==='READY'?{...emptyJob(),status:'ready',progress:100,stage:5,run_id:book.run_id,events:[{stage:'历史状态',message:'此书为已有的本地演示结果，不是本次实时生成。',time:timestamp()}]}:book.status==='GENERATING'?{...emptyJob(),status:'failed',run_id:book.run_id,error:'演示会话已切换，本次任务未继续执行。请重试以创建新的模拟运行。'}:emptyJob())},[book.id,book.status,book.run_id])
  const notify=useCallback((text:string)=>setToast(text),[])
  const navigate=useCallback((next:Page,bookId?:string)=>{
    if(bookId)setSelectedId(bookId)
    setPage(next);setState('success');setToast('')
    const query=new URLSearchParams();if(bookId)query.set('book',bookId)
    location.hash=`#/${next==='home'?'':next}${query.size?'?'+query.toString():''}`
    window.scrollTo({top:0})
  },[])
  useEffect(()=>{const changed=()=>{const current=route();setPage(current.page);setState('success');const id=current.query.get('book');if(id)setSelectedId(id);if(current.page==='shared'){setShareToken(current.query.get('token')??'');setSharedRef(parseSharedRef(current.query))}};window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed)},[])
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(timer)},[toast])
  // Live 只读分享：一律向 A 核验并展示服务端内容（E-029：旧实现只看本地快照，换浏览器打开即失效）
  useEffect(()=>{
    if(appMode!=='live'||page!=='shared')return
    if(!sharedRef){setSharedView({status:'missing'});return}
    let stale=false
    setSharedView({status:'loading'})
    void loadSharedNote(apiClient,sharedRef).then(result=>{if(!stale)setSharedView(result)})
    return()=>{stale=true}
  },[appMode,page,sharedRef,sharedNonce])
  // Live：进入阅读页时向 A 查询该 run 是否已登记 B 生成的视频（E-028：旧实现从不查询，永远显示静态书页）
  useEffect(()=>{
    if(appMode!=='live'||page!=='reader'||!book.run_id||!book.server_book_id||videos[book.run_id])return
    const runId=book.run_id
    const gen=(videoGenRef.current.get(runId)??0)+1
    videoGenRef.current.set(runId,gen)
    const current_=()=>videoGenRef.current.get(runId)===gen
    setVideos(current=>({...current,[runId]:{status:'loading'}}))
    loadRunVideo(apiClient,runId).then(result=>{
      if(!current_()){if(result.status==='ready')URL.revokeObjectURL(result.url);return}
      if(result.status==='none'){setVideos(current=>({...current,[runId]:{status:'none',assetCount:result.assetCount}}));return}
      const old=videoUrlsRef.current.get(runId);if(old)URL.revokeObjectURL(old)
      videoUrlsRef.current.set(runId,result.url)
      setVideos(current=>({...current,[runId]:{status:'ready',url:result.url,asset_id:result.asset.id,sha256:result.asset.sha256,size_bytes:result.sizeBytes}}))
    }).catch((e:any)=>{if(current_())setVideos(current=>({...current,[runId]:{status:'error',error:String(e?.message??e)}}))})
  },[appMode,page,book.run_id,book.server_book_id,videos])
  useEffect(()=>()=>{videoUrlsRef.current.forEach(url=>URL.revokeObjectURL(url));videoUrlsRef.current.clear()},[])
  const reloadVideo=useCallback((runId:string)=>{
    const old=videoUrlsRef.current.get(runId);if(old){URL.revokeObjectURL(old);videoUrlsRef.current.delete(runId)}
    videoGenRef.current.set(runId,(videoGenRef.current.get(runId)??0)+1)
    setVideos(current=>{const next={...current};delete next[runId];return next})
  },[])
  useEffect(()=>{
    try {sessionStorage.setItem(sessionKeyFor(appMode),JSON.stringify({schema:1,books:books.map(item=>({...item,pages:item.pages.filter(p=>p.demo),page_count:item.pages.length})),notes,grants,interactions}))}
    catch { if(!sessionWarned.current){sessionWarned.current=true;notify('当前浏览器无法保存会话。刷新后将恢复初始演示数据。')} }
  },[books,notes,grants,interactions,notify,appMode])

  const updateBook=(updater:(current:ReadingBook)=>ReadingBook)=>{
    let next=updater(book)
    const contentChanged=book.pages.map(p=>`${p.id}:${p.ocr_text}`).join('\n')!==next.pages.map(p=>`${p.id}:${p.ocr_text}`).join('\n')
    if(contentChanged){
      next = {
        ...next,
        pages_only: false,
        pages: next.pages.map(p => ({ ...p, server_synced_text: null })),
      }
    }
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
    if(job.status!=='running'||job.server)return
    const timer=setTimeout(()=>{
      setJob(current=>{
        if(current.status!=='running')return current
        const progress=Math.min(100,current.progress+10)
        const stage=Math.min(5,Math.floor(progress/18))
        return {...current,progress,stage,status:progress>=100?'review':'running',events:stage!==current.stage?[...current.events,{stage:jobStages[stage],message:'阶段结果生成中。',time:timestamp()}]:current.events}
      })
    },650)
    return()=>clearTimeout(timer)
  },[job])
  useEffect(()=>{if(job.status==='ready')setBooks(current=>current.map(item=>item.run_id===job.run_id?{...item,status:'READY',safety_reviewed:true}:item))},[job.status,job.run_id])
  useEffect(()=>{if(job.status!=='ready')return;const completed=books.find(item=>item.run_id===job.run_id);if(!completed||completed.server_book_id||notes.some(item=>item.book_id===completed.id))return;setNotes(current=>[makeNote(completed),...current])},[job.status,job.run_id,books,notes])

  const patchBook=useCallback((id:string,updater:(current:ReadingBook)=>ReadingBook)=>{
    setBooks(current=>current.map(item=>item.id===id?updater(item):item))
  },[])

  // 轮询后端真实任务；进度只反映服务端状态，不模拟百分比，防范跨书覆盖与竞态
  useEffect(()=>{
    if(job.status!=='running'||!job.server||!job.run_id)return
    const runId=job.run_id
    let stopped=false
    let timer:ReturnType<typeof setTimeout>|undefined
    const tick=async()=>{
      try{
        const jobs = await apiClient.runJobs(runId)
        if(stopped)return
        const result=summarizeRunJobs(jobs)
        if(stopped)return
        if(result.phase==='running'){timer=setTimeout(tick,1500);return}
        if(result.phase==='failed'){
          setBooks(current=>current.map(item=>item.run_id===runId?{...item,status:'FAILED'}:item))
          setJob(current=>current.run_id===runId?({...current,status:'failed',error:result.error,events:[...current.events,{stage:'后端任务',message:result.error,time:timestamp()}]}):current)
          return
        }
        setJob(current=>current.run_id===runId?({...current,status:'review',stage:5,progress:100,events:[...current.events,{stage:'后端任务',message:'后端分析任务已成功，等待主人复核。',time:timestamp()}]}):current)
      }catch(e:any){
        if(!stopped)setJob(current=>current.run_id===runId?({...current,status:'failed',error:`读取后端任务状态失败：${e.message}`}):current)
      }
    }
    void tick()
    return()=>{stopped=true;if(timer)clearTimeout(timer)}
  },[job.status,job.server,job.run_id])

  async function generate(){
    if(!book.pages.length||book.pages.some(p=>!p.confirmed)||!book.classification.owner_confirmed){notify('请先完成逐页文字校对和主人类型确认。');return}

    if(appMode==='live'){
      if(!book.server_book_id){notify('这本书没有在后端建档，真实模式不会模拟生成。请填好令牌后重新导入，或切换到演示模式。');return}
      const target=book
      // 重试/发起分析前：置为 running 状态，清空残留错误，提供即时状态反馈
      setJob(current=>({...emptyJob(),status:'running',run_id:target.run_id,server:true,events:[...current.events,{stage:'后端任务',message:'正在同步书页并重试分析任务…',time:timestamp()}]}))
      patchBook(target.id,current=>({...current,status:'GENERATING'}))
      navigate('progress',target.id)

      try{
        const started=await startServerAnalysis(apiClient,target.server_book_id!,target.pages.map(p=>({ocr_text:p.ocr_text,server_page_no:p.server_page_no,server_synced_text:p.server_synced_text,getImage:()=>pageImageBlob(p.image_url)})),(index,patch)=>{
          const pageId=target.pages[index].id
          patchBook(target.id,current=>({...current,pages:current.pages.map(p=>p.id===pageId?{...p,...patch}:p)}))
        })
        patchBook(target.id,current=>({...current,status:'GENERATING',safety_reviewed:false,pages_only:false,run_id:started.run_id,job_id:started.job_id}))
        setJob(current=>({...current,status:'running',run_id:started.run_id,server:true,events:[...current.events,{stage:'后端任务',message:'已上传书页和校对文字，后端分析任务已创建。',time:timestamp()}]}))
      }catch(e:any){
        patchBook(target.id,current=>({...current,status:'FAILED'}))
        setJob(current=>({...current,status:'failed',error:`发起分析失败：${e.message}`,events:[...current.events,{stage:'后端任务',message:`发起分析失败：${e.message}`,time:timestamp()}]}))
        notify(`发起分析失败：${e.message}`)
      }
      return
    }

    const runId=uid('run')
    updateBook(current=>({...current,status:'GENERATING',safety_reviewed:false,run_id:runId,job_id:uid('job')}))
    setJob({status:'running',stage:0,progress:0,error:null,run_id:runId,events:[{stage:jobStages[0],message:'生成任务已启动，正在分析图书多模态资产。',time:timestamp()}]})
    navigate('progress',book.id)
  }

  function openPagesOnly(){
    if(!book.run_id||!book.server_book_id||book.pages.some(p=>!p.confirmed)){notify('需要已校对的书页和后端运行记录，才能开启书页问答。');return}
    patchBook(book.id,current=>({...current,pages_only:true}))
    navigate('reader',book.id)
  }

  async function completeImport(input:ImportedBookInput){
    const id=uid('book')
    const pages=await Promise.all(input.pages.map(async p=>{let imageUrl=p.url;if(!p.demo){const blob=await (await fetch(p.url)).blob();imageUrl=URL.createObjectURL(blob)}return {id:p.id,name:p.name,image_url:imageUrl,ocr_text:p.demo?(originalPages[Number(p.id.replace('demo-',''))-1]??''):'',confidence:p.demo?.86:0,revision:1,confirmed:false,demo:Boolean(p.demo)}}))

    // 未在后端建档时没有任何分类模型参与：类型来自导入表单，置信度为 null，不再写死 0.72 与"根据排版特征分类"的说法
    let classification:ReadingBook['classification']={predicted_type:input.type,confidence:null,reasons:['本地导入，未调用分类模型：类型来自导入时的选择，请主人确认。'],confirmed_type:null,owner_confirmed:false}
    let serverBookId:string|null=null
    if(appMode==='live'){
      if(apiClient.getToken()){
        // 失败时直接抛出，不留下一本"看似已建档"的书
        const registered=await registerServerBook(apiClient,{title:input.title,authorization_ref:input.authorization_ref})
        serverBookId=registered.bookId
        classification={predicted_type:fromBackendBookType(registered.classification.predicted_type),confidence:registered.classification.confidence,reasons:registered.classification.reasons,confirmed_type:null,owner_confirmed:false}
        notify('已在后端建档并完成自动分类。下一步请校对文字并确认类型。')
      }else{
        notify('没有填写令牌：这本书只保存在本地，不会写入后端。')
      }
    }

    setBooks(current=>[{id,title:input.title,subtitle:'刚刚带进来的新故事。',cover:'/art/cover-forest.svg',page_count:pages.length,status:'REVIEW_REQUIRED',classification,updated_label:'刚刚',authorization_ref:input.authorization_ref,pages,age_band:'6–9 岁（待人工审核）',run_id:null,job_id:null,video_url:null,origin:serverBookId?'real':'mock',server_book_id:serverBookId,safety_reviewed:false},...current])
    navigate('review',id)
  }

  async function saveNote(patch:Pick<ReadingNote,'title'|'summary'|'concepts'>){
    if(!patch.title.trim()||!patch.summary.trim()){notify('笔记标题和摘要不能为空。');return}
    if(note?.server_id){
      try{await apiClient.updateNote(note.server_id,noteToServerContent({...note,...patch,title:patch.title.trim(),summary:patch.summary.trim()}))}
      catch(e:any){notify(`服务端保存笔记失败: ${e.message}。修改未保存。`);return}
    }
    setNotes(current=>current.map(item=>item.id===note?.id?{...item,...patch,title:patch.title.trim(),summary:patch.summary.trim(),review_status:'draft',visibility:'private',reviewed_revision:null,revision:item.revision+1,updated_at:timestamp()}:item))
    setGrants(current=>current.map(item=>item.note_id===note?.id&&item.status==='active'?{...item,status:'revoked'}:item))
    notify('修改已保存为私密草稿；旧审核和旧分享已失效。')
  }

  const LOCAL_ONLY = '该笔记所属图书尚未在服务端建档，无法进行真实审核/分享（本地草稿仍可编辑）。请切换到演示模式体验，或先通过后端工作台建档。'

  // 笔记审核：服务端为准。先让服务端成功，再改本地；失败则本地状态完全不变。
  async function reviewNote(decision:'submit'|'approve'|'reject'){
    if(!note)return
    if(decision==='approve'&&note.review_status!=='in_review'){notify('请先提交主人审核。');return}

    let nextStatus:ReadingNote['review_status']|null=null
    if(appMode==='live'&&decision!=='submit'){
      if(!note.server_id){notify(LOCAL_ONLY);return}
      try{
        // A 要求有摘要和来源才能解除占位，审核前先把当前内容写上去
        if(decision==='approve')await apiClient.updateNote(note.server_id,noteToServerContent(note))
        const out=await reviewOnServer(apiClient,note.server_id,decision==='approve'?'approve':'revise')
        nextStatus=out.local==='approved'?'approved':'rejected'
      }catch(e:any){
        notify(`服务端笔记审核失败: ${e.message}。状态未变更。`)
        return
      }
    }

    const status=nextStatus??(decision==='submit'?'in_review':decision==='approve'?'approved':'rejected')
    setNotes(current=>current.map(item=>item.id!==note.id?item:{...item,review_status:status,reviewed_revision:status==='approved'?item.revision:null,visibility:'private',updated_at:timestamp()}))
    if(status!=='approved')setGrants(current=>current.map(item=>item.note_id===note.id?{...item,status:'revoked'}:item))
    notify(status==='approved'?'主人已确认当前笔记版本。':decision==='submit'?'已提交主人审核（本地步骤，服务端以审核结果为准）。':'已退回修改，分享保持私密。')
  }

  // 笔记分享：Live 先在服务端创建，成功后才产生本地授权；失败返回 null，不留"假链接"。
  async function createShare(input:{mode:ShareGrant['mode'];recipients:string[];minutes:number}): Promise<ShareGrant | null> {
    if(!note||note.review_status!=='approved'||note.reviewed_revision!==note.revision){notify('当前版本尚未通过主人审核，无法分享。');return null}
    if(input.mode==='named_users'&&input.recipients.length===0){notify('请填写至少一个用户标识。');return null}
    if(!Number.isFinite(input.minutes)||input.minutes<=0){notify('请选择有效的分享时限。');return null}

    const expiresAt=new Date(Date.now()+input.minutes*60000).toISOString()
    let shareId=uid('share')
    let token:string=crypto.randomUUID()
    let server=false
    let serverInfo:Pick<ShareGrant,'server_note_id'|'server_mode'>={}
    if(appMode==='live'){
      if(!note.server_id){notify(LOCAL_ONLY);return null}
      try{
        const created=await createShareOnServer(apiClient,note.server_id,{mode:input.mode==='named_users'?'invite_only':'link',recipients:input.recipients,expiresAt})
        shareId=created.id
        token=created.token??token
        server=true
        serverInfo={server_note_id:note.server_id,server_mode:created.mode}
      }catch(e:any){
        notify(`服务端创建分享失败: ${e.message}`)
        return null
      }
    }

    const next:ShareGrant={id:shareId,token,note_id:note.id,note_revision:note.revision,snapshot:JSON.parse(JSON.stringify(note)),mode:input.mode,recipients:input.recipients,expires_at:expiresAt,status:'active',created_at:timestamp(),server,...serverInfo}
    setGrants(current=>[next,...current])
    setNotes(current=>current.map(item=>item.id===note.id?{...item,visibility:'shared'}:item))
    return next
  }

  // 撤销分享：服务端撤销成功才改本地；失败则保持"有效"并如实告知（链接在服务端仍然可用）。
  async function revoke(id:string){
    const target=grants.find(item=>item.id===id)
    if(target?.server){
      if(!note?.server_id){notify(LOCAL_ONLY);return}
      try{
        await revokeShareOnServer(apiClient,note.server_id,id)
      }catch(e:any){
        notify(`服务端撤销分享失败: ${e.message}。该分享在服务端仍然有效，请重试。`)
        return
      }
    }
    setGrants(current=>current.map(item=>item.id===id?{...item,status:'revoked'}:item))
    const other=grants.some(item=>item.id!==id&&item.note_id===note?.id&&item.status==='active'&&Date.parse(item.expires_at)>Date.now())
    if(!other)setNotes(current=>current.map(item=>item.id===note?.id?{...item,visibility:'private'}:item))
    notify('分享链接已成功撤销。')
  }

  function openGrant(item:ShareGrant){
    if(item.server&&item.server_note_id&&item.server_mode){
      const hash=serverShareHash({mode:item.server_mode,token:item.token,noteId:item.server_note_id,shareId:item.id})
      setSharedRef(parseSharedRef(new URLSearchParams(hash.split('?')[1])));setPage('shared');setState('success');location.hash=hash;window.scrollTo({top:0});return
    }
    setShareToken(item.token);setRecipient('');setPage('shared');setState('success');location.hash=`#/shared?token=${encodeURIComponent(item.token)}`;window.scrollTo({top:0})}
  function seek(source:Source){if(source.start_ms!==null){setSeekTo(source.start_ms);navigate('reader',book.id)}else{try{sessionStorage.setItem('paper-companion-focus-page',String(source.page_no))}catch{/* 页面仍可打开 */}navigate('review',book.id)}}
  async function generateNote(){
    if(book.server_book_id){
      if(note){navigate('notes');return}
      try{
        const created=await apiClient.generateNoteDraft(book.server_book_id)
        setNotes(current=>[{...makeNote(book),server_id:created.id},...current])
        navigate('notes')
      }catch(e:any){notify(`服务端未能生成笔记：${e.message}`)}
      return
    }
    if(book.status!=='READY'){notify('请先完成生成阶段和内容复核。');return}if(note){navigate('notes');return}setNotes(current=>[makeNote(book),...current]);navigate('notes')}

  // 取当前 run 的时间轴(A)；带缓存与错误提示防抖，失败不阻断问答，但会用于触控字幕依据与检索时间窗口
  async function loadSegments(runId:string):Promise<SegmentOut[]>{
    const cached=segmentsCacheRef.current.get(runId)
    if(cached)return cached
    try{
      const segs=await apiClient.getRunSegments(runId)
      // 空结果不缓存：B 之后登记时间轴时要能读到
      if(segs.length)segmentsCacheRef.current.set(runId,segs)
      return segs
    }catch(e:any){
      if(!warnedSegmentsRef.current.has(runId)){
        warnedSegmentsRef.current.add(runId)
        notify(`读取视频时间轴失败（${e.message}），本次不使用时间窗口。`)
      }
      return []
    }
  }

  // 智能伴读提问：Live 严格按"当前这本书"的校对文字检索；无依据如实拒答；不使用任何内置故事。
  async function question(text:string,videoMs:number,inputMethod:'speech'|'keyboard'='keyboard',voice?:VoiceCapture):Promise<Interaction>{
    if(appMode === 'live') {
      if(!book.server_book_id)throw new Error('这本书是本地数据，没有在后端建档，真实模式下不能提问或留痕。请切换到演示模式，或填好令牌后重新导入。')
      if(!book.run_id)throw new Error('这本书还没有生成运行任务(run_id)，暂时无法提问留痕。请先完成校对与生成。')
      const segments=await loadSegments(book.run_id)
      const indexer=new TimeSliceIndexer(buildSlicesFromBook(book.pages,segments))
      const resp = await apiClient.askQuestion(
        {book_id: book.id, run_id: book.run_id, query_text: text, video_ms: videoMs, input_method: inputMethod},
        'live',
        voice?.blob,
        {indexer,voice:voice?{mimeType:voice.mimeType,durationMs:voice.durationMs,transcript:voice.transcript,transcriptIsFinal:voice.transcriptIsFinal,asrErrorCode:voice.asrErrorCode}:undefined}
      )
      if(resp.persisted===false)notify(`回答已生成，但未能写入后端：${resp.persist_error ?? '未知原因'}`)
      return {
        id: uid('interaction'),
        book_id: book.id,
        run_id: book.run_id,
        kind: 'question',
        question: text,
        // 显示识别原文（可能与提交的问题不同），而不是把问题本身冒充成转写
        transcript: voice?.transcript ?? '',
        answer: resp.answer,
        video_ms: videoMs,
        sources: (resp.evidence || []).map((ev) => ({
          source: ev.evidence_type==='page'?'original_page' as const:'video_frame' as const,
          page_no: ev.page_no,
          start_ms: ev.evidence_type==='page'?null:ev.video_start_ms,
          end_ms: ev.evidence_type==='page'?null:ev.video_end_ms,
          quote: ev.source_quote || ev.snippet || '',
        })),
        latency_ms: resp.latency?.total_roundtrip_ms ?? null,
        created_at: timestamp(),
        uncertain: resp.status !== 'success',
        origin: 'real',
        cached: Boolean(resp.cache_hit),
        persisted: resp.persisted,
        persist_error: resp.persist_error,
      }
    }

    // 演示模式 (Demo) - 显式标明
    await new Promise(resolve=>setTimeout(resolve,400))
    const target=/朋友|小熊|回信/.test(text)?book.pages.findIndex(p=>p.ocr_text.includes('小熊')):/哪里|森林|去/.test(text)?book.pages.findIndex(p=>p.ocr_text.includes('走进森林')):Math.min(book.pages.length-1,Math.floor(videoMs/12000))
    const excerpt=book.pages[target]?.ocr_text??''
    const uncertain=!/信|狐狸|朋友|小熊|森林|哪里|这页|勇气/.test(text)||!excerpt
    return{id:uid('interaction'),book_id:book.id,run_id:book.run_id??'unstarted',kind:'question',question:text,transcript:voice?.transcript??'',answer:uncertain?'这段演示内容里还没有足够依据，我不确定。请结合书页确认。':`演示引用：第 ${target+1} 页写道：“${excerpt.slice(0,180)}” 这是按关键词展示的原文，未调用问答模型。`,video_ms:videoMs,sources:uncertain?[]:[{source:'original_page',page_no:target+1,start_ms:null,end_ms:null,quote:excerpt}],latency_ms:null,created_at:timestamp(),uncertain,origin:'mock',cached:false}
  }

  // 触控识别：坐标映射算法的完整输出(touch_point/viewport_info)原样透传；无视觉模型时如实 uncertain。
  async function touch(x:number,y:number,videoMs:number,box:{width:number;height:number},detail?:TouchDetail):Promise<Interaction>{
    if(x<0||x>1||y<0||y>1||box.width<=0||box.height<=0)throw new Error('点击位于画面内容之外。')

    if(appMode === 'live') {
      if(!book.server_book_id)throw new Error('这本书是本地数据，没有在后端建档，真实模式下不能提问或留痕。请切换到演示模式，或填好令牌后重新导入。')
      if(!book.run_id)throw new Error('这本书还没有生成运行任务(run_id)，暂时无法触控留痕。请先完成校对与生成。')
      if(!detail)throw new Error('缺少坐标映射结果(touch_point/viewport_info)，已拒绝上报，避免记录错误像素。')
      const segments=await loadSegments(book.run_id)
      const frame=detail.frame
      const resp = await apiClient.recognizeTouch(
        {book_id: book.id, run_id: book.run_id, video_ms: videoMs, touch_point: detail.touch_point, viewport_info: detail.viewport_info},
        'live',
        {segments,frame:frame?{kind:frame.kind,page_no:frame.page_no,asset_id:frame.kind==='video'&&video?.status==='ready'?video.asset_id:null,asset_sha256:frame.kind==='video'&&video?.status==='ready'?video.sha256:null,snapshot:frame.snapshot?.blob??null,snapshot_width:frame.snapshot?.width,snapshot_height:frame.snapshot?.height,snapshot_error:frame.snapshot_error,clicked_at:frame.clicked_at,capture_ms:frame.capture_ms}:undefined}
      )
      if(resp.persisted===false)notify(`触控已处理，但未能写入后端：${resp.persist_error ?? '未知原因'}`)
      return {
        id: uid('touch'),
        book_id: book.id,
        run_id: book.run_id,
        kind: 'touch',
        question: `点击画面位置 (${x.toFixed(2)}, ${y.toFixed(2)})`,
        transcript: '',
        answer: resp.target_name?`识别物体：${resp.target_name}（${resp.explanation}）`:resp.explanation,
        video_ms: videoMs,
        sources: resp.evidence
          ? [{source:'video_frame' as const,page_no:resp.evidence.page_no,start_ms:resp.evidence.video_start_ms,end_ms:resp.evidence.video_end_ms,quote:resp.evidence.snippet||resp.evidence.source_quote||''}]
          : [],
        latency_ms: resp.latency_ms,
        created_at: timestamp(),
        uncertain: resp.status !== 'success' || resp.confidence < 0.6,
        origin: 'real',
        recognized: resp.status === 'success' && Boolean(resp.target_name),
        cached: resp.cache_hit,
        persisted: resp.persisted,
        persist_error: resp.persist_error,
      }
    }

    // 演示模式 (Demo) - 显式标明
    await new Promise(resolve=>setTimeout(resolve,300))
    const pageNo=Math.min(book.pages.length,Math.floor(Math.max(0,videoMs)/12000)+1)
    const excerpt=book.pages[pageNo-1]?.ocr_text??''
    return{id:uid('touch'),book_id:book.id,run_id:book.run_id??'unstarted',kind:'touch',question:`画面位置 (${x.toFixed(2)}, ${y.toFixed(2)})`,transcript:'',answer:excerpt?`[演示模式] 已记录点击位置。当前展示第 ${pageNo} 页文字：“${excerpt.slice(0,180)}” 仅为示例逻辑。`:'[演示模式] 已记录点击位置；当前页缺少文字依据。',video_ms:videoMs,sources:excerpt?[{source:'original_page',page_no:pageNo,start_ms:null,end_ms:null,quote:excerpt}]:[],latency_ms:null,created_at:timestamp(),uncertain:true,origin:'mock',recognized:false,cached:false}
  }

  // D13：导出 A 后端里的真实留痕（不是浏览器会话记录），附延迟 P50/P95 统计
  async function exportServerLog(){
    if(!book.run_id||!book.server_book_id){notify('这本书没有后端运行记录，无法导出后端留痕。');return}
    try{
      const records=(await apiClient.fetchRemoteInteractions(book.run_id)) as unknown as BackendInteractionRecord[]
      if(!records.length){notify('后端还没有这次运行的交互留痕。');return}
      const save=(content:string,type:string,name:string)=>{const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
      const stamp=new Date().toISOString().replace(/[:.]/g,'-')
      save(buildInteractionCsv(records),'text/csv;charset=utf-8',`interactions-${book.run_id}-${stamp}.csv`)
      save(JSON.stringify(summarizeRecords(book.run_id,records),null,2),'application/json;charset=utf-8',`latency-summary-${book.run_id}-${stamp}.json`)
      notify(`已从后端导出 ${records.length} 条留痕（CSV）和延迟统计（JSON）。`)
    }catch(e:any){notify(`读取后端留痕失败：${e.message}`)}
  }
  const context={book,state,setState,navigate,notify,appMode}
  // 阅读页拿到的 book 带上已下载的视频地址；其它页面不受影响
  const readerBook=video?.status==='ready'?{...book,video_url:video.url}:book
  const workflow={...context,updateBook,job,setJob,onGenerate:()=>{void generate()},onOpenPagesOnly:openPagesOnly}
  const missingPages=book.pages.length===0&&page!=='home'&&page!=='import'&&page!=='settings'&&page!=='shared'

  return (
    <WorkspaceShell page={page} state={state} setState={setState} navigate={navigate} appMode={appMode}>
      {page!=='home'&&page!=='import'&&page!=='settings'&&page!=='shared'&& (
        <div className="book-context-bar">
          <span><Icon name="book" size={16}/>当前图书</span>
          <select aria-label="当前图书" value={book.id} onChange={e=>{setSelectedId(e.target.value);setState('success')}}>
            {books.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          <span className="context-origin" style={{ color: appMode==='live'?'#10b981':'#f59e0b' }}>
            {appMode==='live'?'🟢 真实后端模式 (Live)':'🟠 本地演示模式 (Demo)'}
          </span>
        </div>
      )}
      {missingPages?<div className="page-content"><div className="state-panel"><Icon name="image" size={32}/><h2>本次书页预览已结束</h2><p>用户选择的图片只保留在内存，刷新后需要重新导入。图书名和笔记仍保留在当前会话。</p><button className="button button-primary" onClick={()=>navigate('import')}>重新导入书页</button></div></div>:<>
      {page==='home'&&<HomePage books={books} notes={notes} state={state} setState={setState} onImport={()=>navigate('import')} onBook={item=>navigate(item.status==='READY'?'reader':'review',item.id)} onNote={id=>{const target=notes.find(n=>n.id===id);navigate('notes',target?.book_id)}}/>}
      {page==='import'&&<ImportBookPage state={state} setState={setState} serverSync={appMode==='live'&&Boolean(apiClient.getToken())} onHome={()=>navigate('home')} onComplete={input=>{void completeImport(input).catch((e:any)=>notify(`导入未完成：${e.message}`))}}/>}
      {page==='review'&&<ReviewPage {...workflow}/>}{page==='classification'&&<ClassificationPage {...workflow}/>}{page==='progress'&&<ProgressPage {...workflow}/>}
      {page==='reader'&&<><InteractiveReaderPage {...context} book={readerBook} videoState={appMode==='live'&&book.run_id&&book.server_book_id?(video??{status:'loading'}):undefined} onReloadVideo={book.run_id?()=>reloadVideo(book.run_id!):undefined} interactions={interactions.filter(i=>i.book_id===book.id)} onInteraction={item=>setInteractions(current=>[item,...current])} seekTo={seekTo} onSeekHandled={()=>setSeekTo(null)} askQuestion={question} identifyTouch={touch} appMode={appMode}/><div className="reader-next"><button className="button button-secondary" onClick={generateNote}>整理阅读笔记<Icon name="note" size={16}/></button><button className="button button-ghost" onClick={()=>navigate('history')}>查看阅读历史<Icon name="arrow" size={16}/></button></div></>}
      {page==='history'&&<HistoryPage {...context} interactions={interactions.filter(i=>i.book_id===book.id)} onSeek={ms=>{setSeekTo(ms);navigate('reader')}} onExportServer={appMode==='live'&&book.run_id&&book.server_book_id?exportServerLog:undefined}/>}
      {page==='notes'&&<NoteReviewPage {...context} note={note} onSave={saveNote} onReview={reviewNote} onSeek={seek}/>}
      {page==='sharing'&&<ShareNotePage {...context} note={note} grants={grants.filter(g=>g.note_id===note?.id)} onCreate={createShare} onRevoke={revoke} onOpen={openGrant}/>}
      {page==='shared'&&<SharedNotePage state={state} grant={grant} recipient={recipient} setRecipient={setRecipient} navigate={navigate} serverView={appMode==='live'?sharedView??{status:'loading'}:undefined} onRetryServer={()=>setSharedNonce(n=>n+1)}/>}
      {page==='settings'&&<SettingsPage navigate={navigate} onReset={()=>{books.forEach(item=>item.pages.forEach(p=>{if(!p.demo)URL.revokeObjectURL(p.image_url)}));setBooks(initialBooks());setNotes(initialNotes());setGrants([]);setInteractions([]);setSelectedId('demo-forest');setJob(emptyJob());navigate('home');notify('演示已重置。')}}/>}</>}
      {toast&&<div className="toast" role="status"><Icon name="info" size={17}/>{toast}<button aria-label="关闭提示" onClick={()=>setToast('')}><Icon name="close" size={16}/></button></div>}
    </WorkspaceShell>
  )
}
