// 与 A 的 FastAPI 实现对齐；网络失败不回退为模拟数据。
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) { super(message); this.name='ApiError'; this.status=status; this.code=code }
}
export type ApiBookType = 'picture_book' | 'novel' | 'textbook' | 'science' | 'other'
export interface BookResponse { id:string; title:string; authorization_ref:string; owner_id:string; status:string; created_at:string; updated_at:string }
export interface PageResponse { id:string; book_id:string; page_no:number; sha256:string; mime_type:string; size_bytes:number; image_path:string; created_at:string }
export interface ClassificationResponse { book_id:string; predicted_type:ApiBookType; confidence:number; reasons:string[]; confirmed_type:ApiBookType|null; confirmed_by:string|null; status:string }
export interface JobResponse { job_id:string; run_id:string; status:string; stage:string; attempts:number }
export interface JobRecord { id:string; run_id:string; status:string; stage:string; attempts:number; max_attempts:number; error_code:string|null; error_message:string|null }
export interface RunResponse { id:string; book_id:string; status:string; config:Record<string,unknown>; model_manifest:Record<string,unknown> }
export interface ProgressResponse { run_id:string; status:string; stages:{stage:string;status:string;attempts:number;error_code:string|null}[] }
export interface RevisionResponse { book_id:string; page_no:number; revision:number; ocr:Record<string,unknown>|null; vision:Record<string,unknown>|null; source:string }
export interface NoteResponse { id:string; book_id:string; owner_id:string; content:Record<string,unknown>; status:string; version:number; created_at:string; updated_at:string }
export interface ShareResponse { id:string; share_mode:'invite_only'|'link'; shared_user_id:string|null; expires_at:string|null; status:string; token?:string|null }
export interface InteractionIn { interaction_type:'voice'|'touch'; input:Record<string,unknown>; output:Record<string,unknown>&{producer:string}; latency_ms:number }
export interface InteractionRecorded { id:string; run_id:string; status:string }
export interface AssetResponse { id:string; run_id:string; asset_type:string; mime_type:string; sha256:string; duration_ms?:number|null; created_at?:string }
export interface VideoGenerationStatus { status:'NOT_STARTED'|'QUEUED'|'RUNNING'|'FAILED'|'SUCCEEDED'; job_id?:string; page_no?:number; asset_id?:string|null; error_code?:string|null; error_message?:string|null; can_resume?:boolean; duration?:number }
export interface StoryShot { page_no:number;caption:string;prompt:string;source_page_nos?:number[]|null }
export interface Storyboard { character_guide:string;shots:StoryShot[];limitations?:string[] }
export interface GenerationRecord { job_id:string;run_id:string;stage:string;status:string;page_nos:number[];page_scope:string;narration:boolean;created_at:string;error_code:string|null;submitted_count:number|null;downloaded_count:number|null;uncertain_count:number|null;completed_vision_calls:number|null;amount:null }
export interface GenerationRecords { book_id:string;records:GenerationRecord[];amount:null;billing_note:string }
export interface WorkflowStatus {
  coverage?:{complete:boolean;missing_page_nos:number[];unanalyzed_page_nos:number[];invalid_mapping:boolean;pages:{page_no:number;shot_numbers:number[]}[];note:string}
  narration?:boolean
  vision:null|{page_no:number;summary:string;scene:string;uncertain:boolean;entities:{name:string;description:string;confidence:number}[];events:string[]}[]
  storyboard:Storyboard|null;revision:number;approved:boolean;source_current:boolean;asset_id:string|null
  tasks:{stage:string;job_id:string;status:string;error_code:string|null;error_message:string|null}[]
  events?:{event:string;safe_metadata_json:string;created_at:string}[]
  clips:{page_no:number;downloaded:number;submitted:number;submission_started?:number}[]
  capabilities:{vision_configured:boolean;video_configured:boolean;composition_available:boolean;narration_available?:boolean;asr_available?:boolean;voices?:string[]}
}
export interface ApiOptions { getToken?:()=>string; timeoutMs?:number; fetch?:typeof fetch }
const statusCodes:Record<number,string> = {400:'BAD_REQUEST',401:'UNAUTHORIZED',403:'FORBIDDEN',404:'NOT_FOUND',409:'CONFLICT',410:'GONE',413:'PAYLOAD_TOO_LARGE',415:'UNSUPPORTED_MEDIA_TYPE',422:'VALIDATION_ERROR',503:'SERVICE_UNAVAILABLE'}
function errorMessage(payload:unknown):string|null {
  if(!payload||typeof payload!=='object')return null
  const data=payload as {detail?:unknown;error?:{message?:unknown}}
  if(typeof data.detail==='string')return data.detail
  if(Array.isArray(data.detail))return data.detail.map(item=>{
    if(!item||typeof item!=='object')return '请求字段无效'
    const entry=item as {loc?:unknown;msg?:unknown}
    return `${Array.isArray(entry.loc)?entry.loc.join('.'):'请求字段'}：${typeof entry.msg==='string'?entry.msg:'校验失败'}`
  }).join('；')
  return typeof data.error?.message==='string'?data.error.message:null
}
export function createApiClient(baseUrl:string,options:ApiOptions={}) {
  const url=new URL(baseUrl)
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('请输入不含账号、参数或片段的 HTTP/HTTPS 服务地址。')
  const base=url.href.replace(/\/$/,'')
  const doFetch=options.fetch??globalThis.fetch.bind(globalThis)
  async function request<T>(path:string,init:RequestInit={},authenticated=true,binary=false,timeoutMs?:number):Promise<T>{
    const token=authenticated?options.getToken?.().trim()??'':''
    if(authenticated&&!token)throw new ApiError(401,'AUTH_REQUIRED','请先注册或登录。')
    const controller=new AbortController()
    const cancel=()=>controller.abort()
    init.signal?.addEventListener('abort',cancel,{once:true})
    if(init.signal?.aborted)controller.abort()
    const timer=setTimeout(()=>controller.abort(),timeoutMs??options.timeoutMs??15000)
    try{
      const headers=new Headers(init.headers)
      if(token)headers.set('Authorization',`Bearer ${token}`)
      const response=await doFetch(`${base}${path}`,{...init,headers,signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store'})
      if(!response.ok){
        let payload:unknown=null
        try{payload=await response.json()}catch{/* 非 JSON 错误保留 HTTP 状态 */}
        let message=errorMessage(payload)??`请求失败（HTTP ${response.status}）`
        if(token)message=message.replaceAll(token,'[已隐藏令牌]')
        throw new ApiError(response.status,statusCodes[response.status]??`HTTP_${response.status}`,message)
      }
      if(response.status===204)return undefined as T
      if(binary)return await response.blob() as T
      try{return await response.json() as T}catch{throw new ApiError(response.status,'INVALID_RESPONSE','服务返回了无效 JSON，请核对接口版本。')}
    }catch(error){
      if(error instanceof ApiError)throw error
      if(controller.signal.aborted)throw new ApiError(0,'TIMEOUT','服务响应超时，请先查询已有对象状态，避免重复创建。')
      throw new ApiError(0,'NETWORK_ERROR','无法连接服务，请检查地址、网络和跨域配置。')
    }finally{clearTimeout(timer);init.signal?.removeEventListener('abort',cancel)}
  }
  const id=encodeURIComponent
  const json=(method:string,body:unknown):RequestInit=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  return {
    health:()=>request<{status:string;service:string;version:string}>('/health',{},false),
    register:(username:string,password:string)=>request<{user:{id:string;username:string;role:string};access_token:string}>('/api/auth/register',json('POST',{username,password}),false),
    login:(username:string,password:string)=>request<{user:{id:string;username:string;role:string};access_token:string}>('/api/auth/login',json('POST',{username,password}),false),
    me:()=>request<{id:string;username:string;role:string}>('/api/auth/me'),
    logout:()=>request<void>('/api/auth/logout',{method:'POST'}),
    createBook:(input:{title:string;authorization_ref:string})=>request<BookResponse>('/api/books',json('POST',input)),
    deleteBook:(bookId:string)=>request<void>(`/api/books/${id(bookId)}`,{method:'DELETE'}),
    getBook:(bookId:string)=>request<BookResponse>(`/api/books/${id(bookId)}`),
    uploadPage:(bookId:string,file:Blob,pageNo:number)=>{
      if(!Number.isInteger(pageNo)||pageNo<1)throw new ApiError(422,'VALIDATION_ERROR','页码必须为正整数。')
      if(!['image/jpeg','image/png'].includes(file.type))throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE','仅支持 JPG / PNG 图片原始字节。')
      return request<PageResponse>(`/api/books/${id(bookId)}/pages?page_no=${pageNo}`,{method:'POST',headers:{'Content-Type':file.type},body:file})
    },
    recognizePage:(file:Blob)=>{
      if(!['image/jpeg','image/png'].includes(file.type))throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE','仅支持 JPG / PNG。')
      return request<{text:string;confidence:number;provider:string;source:string}>('/api/ocr/recognize',{method:'POST',headers:{'Content-Type':file.type},body:file},true,false,120000)
    },
    listPages:(bookId:string)=>request<PageResponse[]>(`/api/books/${id(bookId)}/pages`),
    classifyBook:(bookId:string,requestedType?:ApiBookType)=>request<ClassificationResponse>(`/api/books/${id(bookId)}/classify`,json('POST',requestedType?{requested_type:requestedType}:{})),
    confirmClassification:(bookId:string,confirmedType:ApiBookType)=>request<ClassificationResponse>(`/api/books/${id(bookId)}/classification`,json('PATCH',{confirmed_type:confirmedType})),
    updatePage:(bookId:string,pageNo:number,input:{ocr?:Record<string,unknown>;vision?:Record<string,unknown>})=>request<RevisionResponse>(`/api/books/${id(bookId)}/pages/${pageNo}/revision`,json('PATCH',input)),
    pageRevisions:(bookId:string,pageNo:number)=>request<Record<string,unknown>[]>(`/api/books/${id(bookId)}/pages/${pageNo}/revisions`),
    analyzeBook:(bookId:string,analysisProfile='default')=>request<JobResponse>(`/api/books/${id(bookId)}/analyze`,json('POST',{analysis_profile:analysisProfile})),
    libraryDraft:(key:string)=>request<{revision:number;data:any;updated_at?:string}>(`/api/library/drafts/${id(key)}`),
    saveLibraryDraft:(key:string,revision:number,data:unknown)=>request<{revision:number}>(`/api/library/drafts/${id(key)}`,json('PUT',{expected_revision:revision,data}),true,false,120000),
    deleteLibraryDraft:(key:string,revision:number)=>request<void>(`/api/library/drafts/${id(key)}?expected_revision=${revision}`,{method:'DELETE'}),
    libraryDrafts:()=>request<{id:string;title:string;pageCount:number;updatedAt:string;revision:number}[]>('/api/library/drafts'),
    previewPdf:(blob:Blob,maxPages:number,signal?:AbortSignal)=>request<{pages:{page_no:number;image_base64:string}[];page_count:number}>(`/api/library/pdf/preview?max_pages=${maxPages}`,{method:'POST',headers:{'Content-Type':'application/pdf'},body:blob,signal},true,false,120000),
    uploadLibraryImage:(blob:Blob)=>request<{sha256:string}>('/api/library/images',{method:'POST',headers:{'Content-Type':blob.type},body:blob},true,false,120000),
    libraryImage:(digest:string)=>request<Blob>(`/api/library/images/${id(digest)}`,{},true,true,120000),
    libraryBooks:()=>request<any[]>('/api/library/books'),
    libraryPage:(bookId:string,pageNo:number)=>request<Blob>(`/api/library/books/${id(bookId)}/pages/${pageNo}/image`,{},true,true,120000),
    speechCapabilities:()=>request<{asr_available:boolean;narration_available:boolean;provider:string;languages?:string[]}>('/api/speech/capabilities'),
    transcribeAudio:(audio:Blob,signal?:AbortSignal,language='zh-CN')=>request<{text:string;is_final:boolean;provider:string;audio_storage:string}>('/api/speech/transcribe',
      {method:'POST',headers:{'Content-Type':audio.type||'audio/webm','X-Local-Speech-Consent':'true','X-Speech-Language':language},body:audio,signal},true,false,95000),
    generationRecords:(bookId:string)=>request<GenerationRecords>(`/api/books/${id(bookId)}/generation-records`),
    workflow:(runId:string)=>request<WorkflowStatus>(`/api/runs/${id(runId)}/workflow`),
    understandPages:(runId:string,pageNos:number[])=>request<unknown>(`/api/runs/${id(runId)}/workflow/vision`,json('POST',{page_nos:pageNos,confirm_paid:true})),
    makeStoryboard:(runId:string)=>request<unknown>(`/api/runs/${id(runId)}/workflow/storyboard`,{method:'POST'}),
    saveStoryboard:(runId:string,revision:number,story:Storyboard)=>request<unknown>(`/api/runs/${id(runId)}/workflow/storyboard`,json('PUT',{expected_revision:revision,character_guide:story.character_guide,shots:story.shots})),
    approveStoryboard:(runId:string,revision:number,coverageConfirmed=false)=>request<unknown>(`/api/runs/${id(runId)}/workflow/storyboard/approve`,json('POST',{expected_revision:revision,coverage_confirmed:coverageConfirmed})),
    generateBookVideo:(runId:string,narration=false)=>request<unknown>(`/api/runs/${id(runId)}/workflow/video`,json('POST',{confirm_paid:true,narration})),
    resumeBookVideo:(runId:string)=>request<unknown>(`/api/runs/${id(runId)}/workflow/video/resume`,json('POST',{confirm_paid:true})),
    semanticQuestion:(runId:string,body:Record<string,unknown>)=>request<import('../types/interaction').AskQuestionResponse>(`/api/runs/${id(runId)}/interaction/qa`,json('POST',body),true,false,115000),
    askFrame:(runId:string,body:Record<string,unknown>)=>request<import('../features/interaction/frameAnswerTypes').FrameQuestionResult>(`/api/runs/${id(runId)}/interaction/frame-qa`,json('POST',body),true,false,120000),
    locateFrameText:(runId:string,body:Record<string,unknown>)=>request<import('../features/interaction/visualText').VisualTextResult>(`/api/runs/${id(runId)}/interaction/text`,json('POST',body),true,false,120000),
    semanticTouch:(runId:string,body:Record<string,unknown>)=>request<import('../types/interaction').TouchRecognitionResponse>(`/api/runs/${id(runId)}/interaction/touch`,json('POST',body),true,false,115000),
    videoStatus:(runId:string)=>request<VideoGenerationStatus>(`/api/runs/${id(runId)}/video`),
    generateVideo:(runId:string,input:{page_no:number;prompt:string;duration:5;confirm_paid:boolean})=>request<VideoGenerationStatus>(`/api/runs/${id(runId)}/video`,json('POST',input)),
    resumeVideo:(runId:string)=>request<VideoGenerationStatus>(`/api/runs/${id(runId)}/video/resume`,{method:'POST'}),
    getJob:(jobId:string)=>request<JobResponse>(`/api/jobs/${id(jobId)}`),
    retryJob:(jobId:string)=>request<JobResponse>(`/api/jobs/${id(jobId)}/retry`,{method:'POST'}),
    getRun:(runId:string)=>request<RunResponse>(`/api/runs/${id(runId)}`),
    listRuns:(bookId:string)=>request<Record<string,unknown>[]>(`/api/books/${id(bookId)}/runs`),
    runJobs:(runId:string)=>request<JobRecord[]>(`/api/runs/${id(runId)}/jobs`),
    progress:(runId:string)=>request<ProgressResponse>(`/api/runs/${id(runId)}/progress`),
    history:(runId:string)=>request<Record<string,unknown>>(`/api/runs/${id(runId)}/history`),
    segments:(runId:string)=>request<Record<string,unknown>[]>(`/api/runs/${id(runId)}/segments`),
    assets:(runId:string)=>request<AssetResponse[]>(`/api/runs/${id(runId)}/assets`),
    // 视频文件可能较大，下载超时放宽到 120 秒
    assetContent:(runId:string,assetId:string)=>request<Blob>(`/api/runs/${id(runId)}/assets/${id(assetId)}/content`,{},true,true,120000),
    interactions:(runId:string)=>request<Record<string,unknown>[]>(`/api/runs/${id(runId)}/interactions`),
    recordInteraction:(runId:string,body:InteractionIn)=>request<InteractionRecorded>(`/api/runs/${id(runId)}/interactions`,json('POST',body)),
    generateNote:(bookId:string,noteTemplate='standard')=>request<NoteResponse>(`/api/books/${id(bookId)}/notes/generate`,json('POST',{note_template:noteTemplate})),
    getNote:(noteId:string)=>request<NoteResponse>(`/api/notes/${id(noteId)}`),
    updateNote:(noteId:string,content:Record<string,unknown>)=>request<NoteResponse>(`/api/notes/${id(noteId)}`,json('PATCH',{content})),
    reviewNote:(noteId:string,action:'approve'|'revise')=>request<NoteResponse>(`/api/notes/${id(noteId)}/review`,json('POST',{action})),
    createShare:(noteId:string,input:{share_mode:'invite_only'|'link';shared_user_id?:string;expires_at?:string})=>request<ShareResponse>(`/api/notes/${id(noteId)}/shares`,json('POST',input)),
    listShares:(noteId:string)=>request<ShareResponse[]>(`/api/notes/${id(noteId)}/shares`),
    revokeShare:(noteId:string,shareId:string)=>request<void>(`/api/notes/${id(noteId)}/shares/${id(shareId)}`,{method:'DELETE'}),
    sharedNote:(token:string)=>request<NoteResponse>(`/api/shared-notes/${id(token)}`,{},false),
    invitedNote:(noteId:string,shareId:string)=>request<NoteResponse>(`/api/notes/${id(noteId)}/shares/${id(shareId)}/view`),
  }
}
export type ApiClient=ReturnType<typeof createApiClient>
