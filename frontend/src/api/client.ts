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
export interface AssetResponse { id:string; run_id:string; asset_type:string; mime_type:string; sha256:string }
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
  async function request<T>(path:string,init:RequestInit={},authenticated=true,binary=false):Promise<T>{
    const token=authenticated?options.getToken?.().trim()??'':''
    if(authenticated&&!token)throw new ApiError(401,'AUTH_REQUIRED','请先填写 A 配置的本地 Bearer 令牌。')
    const controller=new AbortController()
    const timer=setTimeout(()=>controller.abort(),options.timeoutMs??15000)
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
    }finally{clearTimeout(timer)}
  }
  const id=encodeURIComponent
  const json=(method:string,body:unknown):RequestInit=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  return {
    health:()=>request<{status:string;service:string;version:string}>('/health',{},false),
    createBook:(input:{title:string;authorization_ref:string})=>request<BookResponse>('/api/books',json('POST',input)),
    getBook:(bookId:string)=>request<BookResponse>(`/api/books/${id(bookId)}`),
    uploadPage:(bookId:string,file:Blob,pageNo:number)=>{
      if(!Number.isInteger(pageNo)||pageNo<1)throw new ApiError(422,'VALIDATION_ERROR','页码必须为正整数。')
      if(!['image/jpeg','image/png'].includes(file.type))throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE','仅支持 JPG / PNG 图片原始字节。')
      return request<PageResponse>(`/api/books/${id(bookId)}/pages?page_no=${pageNo}`,{method:'POST',headers:{'Content-Type':file.type},body:file})
    },
    listPages:(bookId:string)=>request<PageResponse[]>(`/api/books/${id(bookId)}/pages`),
    classifyBook:(bookId:string,requestedType?:ApiBookType)=>request<ClassificationResponse>(`/api/books/${id(bookId)}/classify`,json('POST',requestedType?{requested_type:requestedType}:{})),
    confirmClassification:(bookId:string,confirmedType:ApiBookType)=>request<ClassificationResponse>(`/api/books/${id(bookId)}/classification`,json('PATCH',{confirmed_type:confirmedType})),
    updatePage:(bookId:string,pageNo:number,input:{ocr?:Record<string,unknown>;vision?:Record<string,unknown>})=>request<RevisionResponse>(`/api/books/${id(bookId)}/pages/${pageNo}/revision`,json('PATCH',input)),
    pageRevisions:(bookId:string,pageNo:number)=>request<Record<string,unknown>[]>(`/api/books/${id(bookId)}/pages/${pageNo}/revisions`),
    analyzeBook:(bookId:string,analysisProfile='default')=>request<JobResponse>(`/api/books/${id(bookId)}/analyze`,json('POST',{analysis_profile:analysisProfile})),
    getJob:(jobId:string)=>request<JobResponse>(`/api/jobs/${id(jobId)}`),
    retryJob:(jobId:string)=>request<JobResponse>(`/api/jobs/${id(jobId)}/retry`,{method:'POST'}),
    getRun:(runId:string)=>request<RunResponse>(`/api/runs/${id(runId)}`),
    listRuns:(bookId:string)=>request<Record<string,unknown>[]>(`/api/books/${id(bookId)}/runs`),
    runJobs:(runId:string)=>request<JobRecord[]>(`/api/runs/${id(runId)}/jobs`),
    progress:(runId:string)=>request<ProgressResponse>(`/api/runs/${id(runId)}/progress`),
    history:(runId:string)=>request<Record<string,unknown>>(`/api/runs/${id(runId)}/history`),
    segments:(runId:string)=>request<Record<string,unknown>[]>(`/api/runs/${id(runId)}/segments`),
    assets:(runId:string)=>request<AssetResponse[]>(`/api/runs/${id(runId)}/assets`),
    assetContent:(runId:string,assetId:string)=>request<Blob>(`/api/runs/${id(runId)}/assets/${id(assetId)}/content`,{},true,true),
    interactions:(runId:string)=>request<Record<string,unknown>[]>(`/api/runs/${id(runId)}/interactions`),
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
