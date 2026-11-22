import { syncedScopes, scopeApi, packAccountDraft, unpackAccountDraft, recoverServerBooks } from '../../lib/accountDrafts'
import type { ReadingBook, ReadingNote, ShareGrant, Interaction } from '../../app/types'
import type { BookType } from './types'
import type { ImportPage } from './import'

export interface WorkspaceDraft { books: ReadingBook[]; notes: ReadingNote[]; grants: ShareGrant[]; interactions: Interaction[] }
export interface ImportDraft { id: string; title: string; authorizationRef: string; authorized: boolean; type: BookType; pages: ImportPage[] }
export interface DraftSummary { id: string; title: string; pageCount: number; updatedAt: string }
type StoredPage = { asset?: string; url: string; [key: string]: unknown }
interface RecordData { key: string; scope: string; id: string; updatedAt: string; data: unknown; assets: string[]; cloudRevision?:number; cloudDirty?:boolean }

// 图片原始字节单独存入 IndexedDB，不把会失效的 blob: 链接或整本书的 base64 塞进 localStorage。
export class DraftStore {
  private knownImages = new Set<string>()
  private queues = new Map<string, Promise<unknown>>()
  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB, private readonly name = 'paper-companion-drafts-v1') {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!this.factory) { reject(new Error('浏览器不支持本地草稿存储')); return }
      const req = this.factory.open(this.name, 1)
      req.onupgradeneeded = () => { req.result.createObjectStore('records', { keyPath: 'key' }); req.result.createObjectStore('images') }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('本地草稿库被其他页面占用，请关闭旧页面重试'))
    })
  }
  private serial<T>(scope: string, action: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(scope) ?? Promise.resolve()).catch(() => {}).then(action)
    this.queues.set(scope, next)
    void next.finally(() => { if (this.queues.get(scope) === next) this.queues.delete(scope) }).catch(() => {})
    return next
  }
  private async transact<T>(stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
    const db = await this.open()
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(stores, mode)
        let value: T
        tx.oncomplete = () => resolve(value)
        tx.onabort = () => reject(tx.error ?? new Error('草稿保存未完成（可能空间不足）'))
        tx.onerror = () => reject(tx.error ?? new Error('草稿存储失败'))
        try { action(tx, v => { value = v }) } catch (e) { tx.abort(); reject(e) }
      })
    } finally { db.close() }
  }
  private get<T>(store: string, key: string): Promise<T | undefined> {
    return this.transact([store], 'readonly', (tx, result) => { const req = tx.objectStore(store).get(key); req.onsuccess = () => result(req.result) })
  }
  private records(scope: string): Promise<RecordData[]> {
    return this.transact(['records'], 'readonly', (tx, result) => { const req = tx.objectStore('records').getAll(); req.onsuccess = () => result(req.result.filter((r: RecordData) => r.scope === scope)) })
  }
  private key(scope: string, id: string) { return JSON.stringify([scope, id]) }
  private async pack(scope: string, page: ImportPage | ReadingBook['pages'][number], assets: Map<string, Blob>): Promise<StoredPage> {
    const importing = 'url' in page
    const url = importing ? page.url : page.image_url
    const { file: _file, ...rest } = page as ImportPage
    if (page.demo || !url.startsWith('blob:')) return { ...rest, url }
    const asset = this.key(scope, `image:${page.id}:${(page as any).cloud_asset??"local"}`)
    if (!this.knownImages.has(asset) && !assets.has(asset)) {
      const exists=await this.transact<IDBValidKey | undefined>(['images'],'readonly',(tx,result)=>{const req=tx.objectStore('images').getKey(asset);req.onsuccess=()=>result(req.result)})
      if(exists){this.knownImages.add(asset);return { ...rest,url:'',image_url:'',asset }}
      const response = importing && page.file ? null : await fetch(url)
      if (response && !response.ok) throw new Error('无法读取书页原图，请重新选择图片')
      assets.set(asset, importing && page.file ? page.file : await response!.blob())
    }
    // 不保存旧内存地址；恢复时从图片字节重新创建。
    return { ...rest, url: '', image_url: '', asset }
  }
  private async put(scope: string, id: string, data: unknown, images: Map<string, Blob>, assets: string[]) {
    await this.transact<void>(['records', 'images'], 'readwrite', tx => {
      for (const [key, blob] of images) tx.objectStore('images').put(blob, key)
      tx.objectStore('records').put({ key: this.key(scope, id), scope, id, updatedAt: new Date().toISOString(), data, assets } satisfies RecordData)
    })
    images.forEach((_,key)=>this.knownImages.add(key))
    await this.prune(scope).catch(() => { /* 保存已提交，孤立图片可下次清理，不能误报数据未保存。 */ })
  }
  private async prune(scope: string) {
    // 同一事务读取引用并清理孤立图片，保留已经转入书架的草稿图片。
    await this.transact<void>(['records', 'images'], 'readwrite', tx => {
      const req = tx.objectStore('records').getAll()
      req.onsuccess = () => {
        const used = new Set(req.result.filter((r: RecordData) => r.scope === scope).flatMap((r: RecordData) => r.assets))
        const cursor = tx.objectStore('images').openKeyCursor()
        cursor.onsuccess = () => { const c = cursor.result; if (!c) return; const key = String(c.key); if (JSON.parse(key)[0] === scope && !used.has(key)){tx.objectStore('images').delete(c.key);this.knownImages.delete(key)}; c.continue() }
      }
    })
  }
  private async unpack(page: StoredPage, urls: string[]) {
    const { asset, ...rest } = page
    if (!asset) return rest
    const blob = await this.get<Blob>('images', asset)
    if (!blob) throw new Error('草稿原图缺失，未覆盖原草稿，请重新选择图片或联系管理员')
    const url = URL.createObjectURL(blob); urls.push(url)
    return { ...rest, url, image_url: url, file: new File([blob], String(page.name), { type: blob.type }) }
  }
  private async syncRecord(scope:string,id:string, liveData:unknown) {
    if(!syncedScopes.has(scope))return
    const record=await this.get<RecordData>('records',this.key(scope,id))
    if(!record)return
    const data=await packAccountDraft(liveData,scope)
    const out=await scopeApi(scope).saveLibraryDraft(id,record.cloudRevision??0,data)
    await this.transact<void>(['records'],'readwrite',tx=>{tx.objectStore('records').put({...record,cloudRevision:out.revision,cloudDirty:false})})
  }
  private async fetchAccountRecord(scope:string,id:string):Promise<void> {
    if(!syncedScopes.has(scope))return
    const local=await this.get<RecordData>('records',this.key(scope,id))
    const remote=await scopeApi(scope).libraryDraft(id)
    // Unsynced edits win locally, but their old revision is retained so writes conflict safely.
    if(local?.cloudDirty)return
    if(local && local.cloudRevision===undefined && remote.data){
      // An old local-only installation may contain work absent from the other device.
      await this.transact<void>(['records'],'readwrite',tx=>tx.objectStore('records').put({...local,cloudDirty:true,cloudRevision:0}))
      return
    }
    if(!remote.data){
      if(remote.revision>0){await this.transact<void>(['records'],'readwrite',tx=>tx.objectStore('records').delete(this.key(scope,id)))}
      return
    }
    const unpacked=await unpackAccountDraft(remote.data,scope)
    try{
      const images=new Map<string,Blob>();const assets:string[]=[]
      const packPage=async(p:any)=>{const stored=await this.pack(scope,p,images);if(stored.asset)assets.push(stored.asset);return stored}
      let data=unpacked.data
      if(id==='workspace'){
        const books=[];for(const b of data.books){const pages=[];for(const p of b.pages)pages.push(await packPage(p));books.push({...b,pages})};data={...data,books}
      }else{const pages=[];for(const p of data.pages)pages.push(await packPage(p));data={...data,pages}}
      await this.put(scope,id,data,images,assets)
      const saved=await this.get<RecordData>('records',this.key(scope,id))
      await this.transact<void>(['records'],'readwrite',tx=>tx.objectStore('records').put({...saved!,cloudRevision:remote.revision,cloudDirty:false}))
    }finally{unpacked.urls.forEach(URL.revokeObjectURL)}
  }
  async syncPendingImports(scope:string) {
    if(!syncedScopes.has(scope))return
    for(const r of await this.records(scope)){
      if(r.id==='workspace'||(r.cloudRevision!==undefined&&!r.cloudDirty))continue
      const d=r.data as ImportDraft & {pages:StoredPage[]};const urls:string[]=[]
      try{const pages=[];for(const p of d.pages)pages.push(await this.unpack(p,urls));await this.saveImport(scope,{...d,pages} as unknown as ImportDraft)}
      finally{urls.forEach(URL.revokeObjectURL)}
    }
  }
  async discardLocalAfterBackup(scope:string) {
    await this.queues.get(scope)?.catch(()=>{})
    await this.transact<void>(['records'],'readwrite',tx=>{
      const req=tx.objectStore('records').getAll();req.onsuccess=()=>{for(const r of req.result)if(r.scope===scope)tx.objectStore('records').delete(r.key)}
    })
  }
  async exportLocalBackup(scope:string):Promise<string> {
    const records=await this.records(scope)
    const images:Record<string,string>={}
    for(const key of new Set(records.flatMap(r=>r.assets))){const blob=await this.get<Blob>('images',key);if(blob)images[key]=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(blob)})}
    return JSON.stringify({schema:1,records,images},null,2)
  }
  async saveImport(scope: string, draft: ImportDraft) {
    return this.serial(scope, async () => {
      const images = new Map<string, Blob>(); const pages: StoredPage[] = []
      for (const p of draft.pages) pages.push(await this.pack(scope, p, images))
      const previous=await this.get<RecordData>('records',this.key(scope,draft.id))
      await this.put(scope, draft.id, { ...draft, pages }, images, pages.flatMap(p => p.asset ? [p.asset] : []))
      const saved=await this.get<RecordData>('records',this.key(scope,draft.id))
      await this.transact<void>(['records'],'readwrite',tx=>tx.objectStore('records').put({...saved!,cloudRevision:previous?.cloudRevision,cloudDirty:syncedScopes.has(scope)}))
      await this.syncRecord(scope,draft.id,draft)
    })
  }
  async loadImport(scope: string, id: string): Promise<ImportDraft | null> {
    await this.queues.get(scope)?.catch(() => {})
    await this.fetchAccountRecord(scope,id)
    const record = await this.get<RecordData>('records', this.key(scope, id))
    if (!record) return null
    const data = record.data as ImportDraft & { pages: StoredPage[] }; const urls: string[] = []
    try { const pages = []; for (const p of data.pages) pages.push(await this.unpack(p, urls)); return { ...data, pages } as unknown as ImportDraft }
    catch (e) { urls.forEach(URL.revokeObjectURL); throw e }
  }
  async listImports(scope: string): Promise<DraftSummary[]> {
    await this.queues.get(scope)?.catch(() => {})
    if(syncedScopes.has(scope)){
      const remote=await scopeApi(scope).libraryDrafts()
      const local=(await this.records(scope)).filter(r=>r.id!=='workspace'&&(r.cloudDirty||r.cloudRevision===undefined)).map(r=>{const d=r.data as ImportDraft;return {id:r.id,title:d.title||'未命名图书',pageCount:d.pages.length,updatedAt:r.updatedAt}})
      return [...local,...remote.filter(r=>!local.some(l=>l.id===r.id))]
    }
    return (await this.records(scope)).filter(r => r.id !== 'workspace').sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(r => { const d = r.data as ImportDraft; return { id: r.id, title: d.title || '未命名图书', pageCount: d.pages.length, updatedAt: r.updatedAt } })
  }
  async saveWorkspace(scope: string, data: WorkspaceDraft, completedImport?: string) {
    return this.serial(scope, async () => {
      const images = new Map<string, Blob>(); const assets: string[] = []; const books: (Omit<ReadingBook,'pages'> & {pages:StoredPage[]})[] = []
      for (const book of data.books) { const pages = []; for (const p of book.pages) { const stored = await this.pack(scope, p, images); pages.push(stored); if (stored.asset) assets.push(stored.asset) }; books.push({ ...book, video_url: null, pages }) }
      const previous=await this.get<RecordData>('records',this.key(scope,'workspace'))
      const completed=completedImport?await this.get<RecordData>('records',this.key(scope,completedImport)):undefined
      // 转入书架与删除导入草稿必须原子提交：失败时原草稿仍然可恢复。
      await this.transact<void>(['records','images'], 'readwrite', tx => {
        for (const [key, blob] of images) tx.objectStore('images').put(blob, key)
        tx.objectStore('records').put({ key: this.key(scope,'workspace'), scope, id:'workspace', updatedAt:new Date().toISOString(), data:{ ...data, books }, assets,cloudRevision:previous?.cloudRevision,cloudDirty:syncedScopes.has(scope) } satisfies RecordData)
        if (completedImport) tx.objectStore('records').delete(this.key(scope, completedImport))
      })
      images.forEach((_,key)=>this.knownImages.add(key))
      await this.syncRecord(scope,'workspace',data)
      if(completedImport&&syncedScopes.has(scope)){
        const remote=await scopeApi(scope).libraryDraft(completedImport)
        if(remote.data)await scopeApi(scope).deleteLibraryDraft(completedImport,completed?.cloudRevision??0)
      }
      await this.prune(scope).catch(() => { /* 保存已提交，孤立图片可下次清理，不能误报数据未保存。 */ })
    })
  }
  async loadWorkspace(scope: string): Promise<{ data: WorkspaceDraft; urls: string[] } | null> {
    await this.queues.get(scope)?.catch(() => {})
    await this.fetchAccountRecord(scope,'workspace')
    const record = await this.get<RecordData>('records', this.key(scope, 'workspace'))
    if (!record) {
      if(!syncedScopes.has(scope))return null
      const data=await recoverServerBooks({books:[],notes:[],grants:[],interactions:[]},scope)
      return {data,urls:data.books.flatMap(b=>b.pages.map(p=>p.image_url).filter(u=>u.startsWith('blob:')))}
    }
    const data = record.data as WorkspaceDraft; const urls: string[] = []
    try {
      const books = []; for (const book of data.books) { const pages = []; for (const p of book.pages) pages.push(await this.unpack(p as unknown as StoredPage, urls)); books.push({ ...book, pages }) }
      let restored={ ...data, books } as unknown as WorkspaceDraft
      if(syncedScopes.has(scope)){
        restored=await recoverServerBooks(restored,scope)
        restored.books.forEach(b=>b.pages.forEach(p=>{if(p.image_url.startsWith('blob:')&&!urls.includes(p.image_url))urls.push(p.image_url)}))
      }
      return { data: restored, urls }
    } catch (e) { urls.forEach(URL.revokeObjectURL); throw e }
  }
  async deleteImport(scope: string, id: string) {
    if (id === 'workspace') throw new Error('不能从导入草稿入口删除书架')
    return this.serial(scope, async () => {
      if(syncedScopes.has(scope)){
        const local=await this.get<RecordData>('records',this.key(scope,id))
        const remote=await scopeApi(scope).libraryDraft(id)
        await scopeApi(scope).deleteLibraryDraft(id,local?.cloudRevision??remote.revision)
      }
      await this.transact<void>(['records'], 'readwrite', tx => { tx.objectStore('records').delete(this.key(scope, id)) }); await this.prune(scope).catch(() => { /* 保存已提交，孤立图片可下次清理，不能误报数据未保存。 */ }) })
  }
}
export const draftStore = new DraftStore()
