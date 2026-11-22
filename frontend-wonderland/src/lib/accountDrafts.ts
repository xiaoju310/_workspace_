/** Serialize only metadata + account-owned image hashes, never temporary URLs or passwords. */
import { apiClient, fromBackendBookType } from './api'
import { serverNoteDraft, serverStatusToLocal } from './noteSync'
import type { WorkspaceDraft } from '../features/books/draftStore'
import type { ReadingBook, ReadingNote } from '../app/types'

export const syncedScopes = new Map<string,string>()
export function enableAccountSync(scope:string, enabled:boolean) { enabled ? syncedScopes.set(scope,apiClient.getToken()) : syncedScopes.delete(scope) }
export function scopeApi(scope:string):typeof apiClient {
  // A queued save must never run under the next person's token after logout/login.
  const token=syncedScopes.get(scope)
  return new Proxy(apiClient,{get(target,key){
    const value=Reflect.get(target,key)
    if(typeof value!=='function')return value
    return (...args:unknown[])=>{
      if(!token||apiClient.getToken()!==token)throw new Error('账号已切换，已停止旧账号的同步；修改保留在本机')
      return value.apply(target,args)
    }
  }})
}
const imageHashes = new Map<string,{token:string;hash:string}>()
export async function packAccountDraft(data:any, scope:string):Promise<any> {
  const api=scopeApi(scope)
  async function page(p:any, importing=false) {
    const url = importing ? p.url : p.image_url
    const {file:_file,...rest} = p
    if (p.demo) return rest
    let cached=imageHashes.get(url)
    if (!cached || cached.token!==apiClient.getToken()) {
      const response = importing && p.file ? null : await fetch(url)
      if(response&&!response.ok)throw new Error('无法读取需要同步的原图')
      const blob = importing && p.file ? p.file : await response!.blob()
      const result=await api.uploadLibraryImage(blob)
      cached={token:apiClient.getToken(),hash:result.sha256};imageHashes.set(url,cached)
    }
    return {...rest,url:'',image_url:'',cloud_asset:cached.hash}
  }
  if(Array.isArray(data.books))return {...data,books:await sequential(data.books,async(b:any)=>({...b,video_url:null,pages:await sequential(b.pages,(p:any)=>page(p))}))}
  return {...data,pages:await sequential(data.pages,(p:any)=>page(p,true))}
}
async function sequential<T,R>(items:T[],fn:(item:T)=>Promise<R>):Promise<R[]>{const out=[];for(const item of items)out.push(await fn(item));return out}
export async function unpackAccountDraft(data:any, scope:string):Promise<{data:any;urls:string[]}> {
  const urls:string[]=[]
  const api=scopeApi(scope)
  async function page(p:any, importing=false) {
    if(!p.cloud_asset)return p
    const {cloud_asset,...rest}=p
    const blob=await api.libraryImage(cloud_asset)
    const url=URL.createObjectURL(blob);urls.push(url)
    imageHashes.set(url,{token:apiClient.getToken(),hash:cloud_asset})
    return {...rest,cloud_asset,url,image_url:url,...(importing?{file:new File([blob],p.name||'page.png',{type:blob.type})}:{})}
  }
  try{
    const result=Array.isArray(data.books)
      ? {...data,books:await sequential(data.books,async(b:any)=>({...b,video_url:null,pages:await sequential(b.pages,(p:any)=>page(p))}))}
      : {...data,pages:await sequential(data.pages,(p:any)=>page(p,true))}
    return {data:result,urls}
  }catch(e){urls.forEach(URL.revokeObjectURL);throw e}
}

/** Also recover books created before account sync was introduced. No model calls here. */
export async function recoverServerBooks(snapshot:WorkspaceDraft, scope:string):Promise<WorkspaceDraft> {
  const api=scopeApi(scope)
  const rows=await api.libraryBooks()
  const byServerId=new Map(rows.map(r=>[r.id,r]))
  // A server-side deletion is authoritative: old browser caches may not resurrect it.
  const books=snapshot.books.filter(b=>!b.server_book_id||byServerId.has(b.server_book_id))
  const removed=new Set(snapshot.books.filter(b=>!books.includes(b)).map(b=>b.id))
  const notes=snapshot.notes.filter(n=>!removed.has(n.book_id))
  for(const row of rows){
    let book=books.find(b=>b.server_book_id===row.id)
    if(!book){
      const classification=row.classification
      const pages=[]
      for(const p of row.pages){
        const blob=await api.libraryPage(row.id,p.page_no)
        const image_url=URL.createObjectURL(blob)
        const text=p.ocr_json?JSON.parse(p.ocr_json).text||'':''
        pages.push({id:p.id,name:`${p.page_no}.png`,image_url,ocr_text:text,confidence:0,revision:p.revision,confirmed:false,demo:false,server_page_no:p.page_no,server_synced_text:text})
      }
      const type=fromBackendBookType(classification?.predicted_type||'other')
      book={id:`restored-${row.id}`,server_book_id:row.id,title:row.title,subtitle:'从账号书架恢复',cover:'/art/cover-forest.svg',page_count:pages.length,status:'REVIEW_REQUIRED',classification:{predicted_type:type,confidence:classification?.confidence??null,reasons:classification?JSON.parse(classification.reasons_json):[],confirmed_type:classification?.confirmed_type?fromBackendBookType(classification.confirmed_type):null,owner_confirmed:Boolean(classification?.confirmed_type)},updated_label:'账号同步',authorization_ref:row.authorization_ref,pages,age_band:'待主人复核',run_id:row.run?.id??null,job_id:null,video_url:null,origin:'real',safety_reviewed:false} satisfies ReadingBook
      books.push(book)
    }
    // Newer server tasks and approved notes should also be visible on a second device.
    if(row.run&&book.run_id!==row.run.id){book={...book,run_id:row.run.id,job_id:null,status:'GENERATING',safety_reviewed:false};books[books.findIndex(b=>b.server_book_id===row.id)]=book}
    for(const raw of row.notes){
      if(notes.some(n=>n.server_id===raw.id))continue
      const out={...raw,content:JSON.parse(raw.content_json)}
      const n=serverNoteDraft(book.id,book.title,out)
      const reviewed=serverStatusToLocal(raw.status)
      notes.push({...n,review_status:reviewed,visibility:raw.status==='SHARED'?'shared':'private',reviewed_revision:reviewed==='approved'?raw.version:null} as ReadingNote)
    }
  }
  return {...snapshot,books,notes,grants:snapshot.grants.filter(g=>notes.some(n=>n.id===g.note_id))}
}

