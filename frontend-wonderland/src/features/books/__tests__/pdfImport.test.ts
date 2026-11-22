import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {materializePdfPages} from '../pdfImport'
import {IDBFactory} from 'fake-indexeddb'
import {DraftStore} from '../draftStore'
const jpeg=btoa(String.fromCharCode(255,216,255,224,1))
const preview=(count=2)=>({page_count:count,pages:Array.from({length:count},(_,i)=>({page_no:i+1,image_base64:jpeg}))})
let urls:Set<string>,counter:number
beforeEach(()=>{
 urls=new Set();counter=0
 vi.spyOn(URL,'createObjectURL').mockImplementation(()=>{const url=`blob:test-${++counter}`;urls.add(url);return url})
 vi.spyOn(URL,'revokeObjectURL').mockImplementation(url=>{urls.delete(url)})
 vi.stubGlobal('Image',class {src='';naturalWidth=100;naturalHeight=100;async decode(){}})
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
describe('整份PDF原子导入',()=>{
 it('保留页序、文件名和字节，可供草稿/后续原书页上传复用',async()=>{
  const result=await materializePdfPages(preview(),'绘本.PDF',2,()=>{})
  expect(result.map(p=>p.name)).toEqual(['绘本-001.jpg','绘本-002.jpg'])
  expect([...new Uint8Array(await result[0].file!.arrayBuffer())]).toEqual([255,216,255,224,1])
  expect(result.every(p=>p.file?.type==='image/jpeg'&&urls.has(p.url))).toBe(true);expect(urls.size).toBe(2)
 })
 it.each([
  {page_count:0,pages:[]},
  {...preview(),page_count:3},
  {...preview(),pages:[preview().pages[1],preview().pages[0]]},
  preview(3),
 ])('拒绝空页、页数不一致、乱序和超限：%j',async data=>{
  await expect(materializePdfPages(data,'book.pdf',2,()=>{})).rejects.toThrow();expect(urls.size).toBe(0)
 })
 it('后一页base64失败时撤销前面所有临时图片',async()=>{
  const data=preview();data.pages[1].image_base64='%%%'
  await expect(materializePdfPages(data,'book.pdf',2,()=>{})).rejects.toThrow();expect(urls.size).toBe(0)
 })
 it('后一页伪造图片类型时不保留第一张',async()=>{
  const data=preview();data.pages[1].image_base64=btoa('not jpeg')
  await expect(materializePdfPages(data,'book.pdf',2,()=>{})).rejects.toThrow('文件内容');expect(urls.size).toBe(0)
 })
 it('图片实际解码失败也全部回滚',async()=>{
  let calls=0;vi.stubGlobal('Image',class {src='';naturalWidth=100;naturalHeight=100;async decode(){if(++calls===2)throw Error('decode failed')}})
  await expect(materializePdfPages(preview(),'book.pdf',2,()=>{})).rejects.toThrow('图片损坏');expect(urls.size).toBe(0)
 })
 it('异步解码期间会话失效，撤销全部页面而不交付旧结果',async()=>{
  let active=true;let calls=0
  vi.stubGlobal('Image',class {src='';naturalWidth=100;naturalHeight=100;async decode(){if(++calls===2)active=false}})
  await expect(materializePdfPages(preview(),'book.pdf',2,()=>{if(!active)throw Error('stale')})).rejects.toThrow('stale');expect(urls.size).toBe(0)
 })
})


describe('PDF书页草稿重开',()=>{
 it('真实保存及重开后保留页序、各页字节和文件类型，其他账号不可见',async()=>{
  const data=preview(3)
  data.pages.forEach((p,i)=>{p.image_base64=btoa(String.fromCharCode(255,216,255,224,i+1))})
  const pages=await materializePdfPages(data,'三页绘本.pdf',100,()=>{})
  const factory=new IDBFactory(),store=new DraftStore(factory,'pdf-roundtrip')
  await store.saveImport('live:pdf-owner',{id:'pdf-import',title:'三页绘本',type:'picture_book',authorizationRef:'自制测试',authorized:true,pages})
  pages.forEach(p=>URL.revokeObjectURL(p.url))
  const reopened=new DraftStore(factory,'pdf-roundtrip')
  const restored=await reopened.loadImport('live:pdf-owner','pdf-import')
  expect(restored?.pages.map(p=>p.name)).toEqual(['三页绘本-001.jpg','三页绘本-002.jpg','三页绘本-003.jpg'])
  expect(restored?.pages.map(p=>p.id)).toEqual(pages.map(p=>p.id))
  for(const [index,page] of restored!.pages.entries()){
   expect(page.file?.type).toBe('image/jpeg')
   expect([...new Uint8Array(await page.file!.arrayBuffer())]).toEqual([255,216,255,224,index+1])
   expect(page.url).not.toBe(pages[index].url)
  }
  expect(await reopened.loadImport('live:someone-else','pdf-import')).toBeNull()
  expect(await reopened.loadImport('demo','pdf-import')).toBeNull()
  restored!.pages.forEach(p=>URL.revokeObjectURL(p.url))
  expect(urls.size).toBe(0)
 })
})
