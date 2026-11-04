// 以下为仓库 v0.2 中已有契约的接入适配器。未连接服务时不得回退为模拟成功。
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) { super(message); this.name = 'ApiError'; this.status = status; this.code = code }
}
export interface JobResponse { stage: string; status: string; progress: number; error_code?: string; retryable?: boolean }
export interface RunResponse { run_id: string; status: string; video_url: string | null; safety_reviewed: boolean; segments: {page_no:number;start_ms:number;end_ms:number}[] }
export function createApiClient(baseUrl: string) {
  const url = new URL(baseUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请输入不含账号、参数或片段的 HTTP/HTTPS 服务地址。')
  const base = url.href.replace(/\/$/, '')
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(`${base}${path}`, { ...init, signal: init.signal ?? controller.signal, credentials: 'same-origin', headers: { ...(init.body instanceof FormData ? {} : {'Content-Type':'application/json'}), ...init.headers } })
      if (!response.ok) {
        let payload: {error?:{code?:string;message?:string};detail?:unknown} = {}
        try { payload = await response.json() } catch { /* 非 JSON 错误不当作成功 */ }
        throw new ApiError(response.status, payload.error?.code ?? `HTTP_${response.status}`, payload.error?.message ?? `请求失败（${response.status}），请查看服务日志。`)
      }
      if (response.status === 204) return undefined as T
      return await response.json() as T
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (error instanceof DOMException && error.name === 'AbortError') throw new ApiError(0,'TIMEOUT','服务响应超时，请确认服务状态后重试。')
      throw new ApiError(0,'NETWORK_ERROR','无法连接服务，请检查地址、网络和 CORS 配置。')
    } finally { clearTimeout(timer) }
  }
  const id = encodeURIComponent
  return {
    health: () => request<{status:string}>('/health'),
    createBook: (input: {title:string;authorization_ref:string}) => request<{book_id:string}>('/api/books',{method:'POST',body:JSON.stringify(input)}),
    uploadPage: (bookId:string,file:File,pageNo:number) => { const body = new FormData(); body.append('image',file); body.append('page_no',String(pageNo)); return request<{page_id:string;sha256:string}>(`/api/books/${id(bookId)}/pages`,{method:'POST',body}) },
    parseBook: (bookId:string) => request<{job_id:string}>(`/api/books/${id(bookId)}/parse`,{method:'POST'}),
    updatePage: (bookId:string,pageId:string,input:{ocr_text:string;revision:number}) => request<{revision:number}>(`/api/books/${id(bookId)}/pages/${id(pageId)}`,{method:'PATCH',body:JSON.stringify(input)}),
    createRun: (bookId:string,input:{age_band:string;voice:string;model_profile:string}) => request<{run_id:string;job_id:string}>(`/api/books/${id(bookId)}/runs`,{method:'POST',body:JSON.stringify(input)}),
    getJob: (jobId:string) => request<JobResponse>(`/api/jobs/${id(jobId)}`),
    getRun: (runId:string) => request<RunResponse>(`/api/runs/${id(runId)}`),
    askQuestion: (runId:string,audio:Blob,videoMs:number) => { const body=new FormData();body.append('audio',audio,'question.webm');body.append('video_ms',String(videoMs));return request<unknown>(`/api/runs/${id(runId)}/questions`,{method:'POST',body}) },
    touch: (runId:string,input:{video_ms:number;x_norm:number;y_norm:number;rendered_box:{width:number;height:number}}) => request<unknown>(`/api/runs/${id(runId)}/touches`,{method:'POST',body:JSON.stringify(input)}),
    interactions: (runId:string) => request<unknown[]>(`/api/runs/${id(runId)}/interactions`),
  }
}
