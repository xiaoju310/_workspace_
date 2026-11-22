import { describe,it,expect } from 'vitest'
import { classifyReaderIntent,locateScene } from '../readerIntent'
import type { SegmentOut } from '../../../types/interaction'
describe('语音意图和可靠场景定位',()=>{
 it.each([['播放','play'],['请暂停播放。','pause'],['继续','resume'],['结束播放','stop'],['Please resume playback.','resume'],['stop the video','stop']])('%s 分发为 %s',(text,kind)=>expect(classifyReaderIntent(text).kind).toBe(kind))
 it.each(['为什么暂停播放？','不要停止播放','故事里谁在播放音乐？','Why did he stop?'])('%s 仍是问题而非控制',text=>expect(classifyReaderIntent(text).kind).toBe('question'))
 it('框选和看图单独路由，不进入原书文字问答',()=>{
  expect(classifyReaderIntent('高亮“小刺猬”几个字')).toEqual({kind:'text',query:'小刺猬'})
  expect(classifyReaderIntent('辣椒什么形状？')).toEqual({kind:'frame',query:'辣椒什么形状？'})
  expect(classifyReaderIntent('What jumped out?')).toEqual({kind:'frame',query:'What jumped out?'})
  expect(classifyReaderIntent('故事里辣椒是什么形状？').kind).toBe('question')
  expect(classifyReaderIntent('查找“尖尖的”几个字')).toEqual({kind:'text',query:'尖尖的'})
  expect(classifyReaderIntent('查找跳了出来几个字')).toEqual({kind:'text',query:'跳了出来'})
  expect(classifyReaderIntent('Find the word Hello')).toEqual({kind:'text',query:'hello'})
  expect(classifyReaderIntent('当前画面里有什么？').kind).toBe('frame')
  expect(classifyReaderIntent('找到番茄跳起的画面')).toEqual({kind:'scene',query:'番茄跳起的画面'})
 })
 const pages=[{server_page_no:2,ocr_text:'黄瓜地里有黄瓜。',confirmed:true},{server_page_no:4,ocr_text:'番茄跳起。',confirmed:true}]
 const segments=[{page_no:2,start_ms:1000,end_ms:3000,caption:'黄瓜地'},{page_no:4,start_ms:3000,end_ms:6000,caption:'番茄跳起'}] as SegmentOut[]
 it('使用登记时间轴，不按全书页数估算',()=>expect(locateScene('番茄跳起的画面',pages,segments,6000)).toEqual({ok:true,ms:3000,pageNo:4}))
 it('没有时间轴、无内容依据、未校对、时间越界或多处歧义时拒绝猜测',()=>{
  expect(locateScene('黄瓜地',pages,undefined,6000).ok).toBe(false)
  expect(locateScene('不存在的场景',pages,segments,6000).ok).toBe(false)
  expect(locateScene('黄瓜地',pages.map(p=>({...p,confirmed:false})),segments,6000).ok).toBe(false)
  expect(locateScene('番茄跳起',pages,segments,4000).ok).toBe(false)
  expect(locateScene('黄瓜地',pages,[...segments,{page_no:4,start_ms:3000,end_ms:6000,caption:'黄瓜地'}] as SegmentOut[],6000).ok).toBe(false)
 })
})
