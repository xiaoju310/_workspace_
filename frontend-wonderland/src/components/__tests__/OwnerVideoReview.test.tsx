import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunVideoState } from '../../app/types'
const hooks=vi.hoisted(()=>({cursor:0,slots:[] as any[]}))
vi.mock('react',async importOriginal=>{
  const real=await importOriginal<typeof import('react')>()
  return {...real,useState:(initial:any)=>{
    const i=hooks.cursor++
    if(!(i in hooks.slots))hooks.slots[i]=initial
    return [hooks.slots[i],(next:any)=>{hooks.slots[i]=next}]
  },useRef:(initial:any)=>{
    const i=hooks.cursor++
    return hooks.slots[i]??(hooks.slots[i]={current:initial})
  }}
})
import OwnerVideoPreview from '../OwnerVideoPreview'
function find(node:any,predicate:(node:any)=>boolean):any {
  if(!node||typeof node!=='object')return null
  if(predicate(node))return node
  return [node.props?.children].flat(Infinity).map(child=>find(child,predicate)).find(Boolean)
}
const ready:RunVideoState={status:'ready',url:'blob:saved',asset_id:'asset',sha256:'hash',size_bytes:100}
let videoState:RunVideoState,confirm:ReturnType<typeof vi.fn>,tree:any
function render(){hooks.cursor=0;tree=OwnerVideoPreview({videoState,onReview:vi.fn(),onConfirmReview:confirm})}
const button=()=>find(tree,n=>n.props?.onClick?.name==='confirmReview')
const checkbox=()=>find(tree,n=>n.type==='input')
beforeEach(()=>{hooks.slots=[];videoState=ready;confirm=vi.fn();render()})
describe('当前视频内联复核的明确同意',()=>{
  it('未勾选时禁用且绕过按钮也不会自动确认',()=>{
    expect(button().props.disabled).toBe(true)
    button().props.onClick()
    expect(confirm).not.toHaveBeenCalled()
  })
  it('勾选后仅在点击确认时调用一次，重复点击不重复提交',()=>{
    checkbox().props.onChange({target:{checked:true}});render()
    expect(confirm).not.toHaveBeenCalled()
    expect(button().props.disabled).toBe(false)
    button().props.onClick();button().props.onClick()
    expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('取消勾选重新禁用',()=>{
    checkbox().props.onChange({target:{checked:true}});render()
    checkbox().props.onChange({target:{checked:false}});render()
    button().props.onClick();expect(confirm).not.toHaveBeenCalled()
  })
  it('播放失败撤销勾选，不能把失败产物确认',()=>{
    checkbox().props.onChange({target:{checked:true}});render()
    find(tree,n=>n.type==='video').props.onError();render()
    expect(checkbox().props.checked).toBe(false)
    expect(checkbox().props.disabled).toBe(true)
    button().props.onClick();expect(confirm).not.toHaveBeenCalled()
  })
  it.each([{status:'loading'},{status:'none',assetCount:0},{status:'error',error:'secret'}] as RunVideoState[])('无可用视频时不允许复核：$status',state=>{
    videoState=state;render()
    expect(checkbox().props.disabled).toBe(true)
    checkbox().props.onChange({target:{checked:true}});render()
    button().props.onClick();expect(confirm).not.toHaveBeenCalled()
  })
})
