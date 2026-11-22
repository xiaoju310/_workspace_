import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
const hooks=vi.hoisted(()=>({cursor:0,slots:[] as any[],effects:[] as (()=>void)[],dirty:false}))
vi.mock('react',async importOriginal=>{
  const real=await importOriginal<typeof import('react')>()
  return {...real,
    useState:(initial:any)=>{
      const index=hooks.cursor++
      if(!(index in hooks.slots))hooks.slots[index]={value:typeof initial==='function'?initial():initial}
      return [hooks.slots[index].value,(next:any)=>{
        const value=typeof next==='function'?next(hooks.slots[index].value):next
        if(!Object.is(value,hooks.slots[index].value)){hooks.slots[index].value=value;hooks.dirty=true}
      }]
    },
    useRef:(value:any)=>{
      const index=hooks.cursor++
      return hooks.slots[index]??(hooks.slots[index]={current:value})
    },
    useEffect:(effect:()=>void|(()=>void),deps?:unknown[])=>{
      const index=hooks.cursor++,old=hooks.slots[index]
      if(!old||!deps||deps.some((v,i)=>!Object.is(v,old.deps?.[i]))){
        const slot={deps,cleanup:old?.cleanup};hooks.slots[index]=slot
        hooks.effects.push(()=>{slot.cleanup?.();slot.cleanup=effect()})
      }
    },
  }
})

import {TtsPlayerWidget} from '../tts/TtsPlayerWidget'
import {ttsManager} from '../tts/TtsProvider'
let props:any,tree:any
function render(){let rounds=0;do{hooks.dirty=false;hooks.cursor=0;tree=TtsPlayerWidget(props);hooks.effects.splice(0).forEach(run=>run());if(++rounds>20)throw Error('loop')}while(hooks.dirty)}
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();render()}
function playButton(){return tree.props.children[0].props.children[0]}
beforeEach(()=>{hooks.cursor=0;hooks.slots=[];hooks.effects=[];hooks.dirty=false;props={textToSpeak:'乌龟走在森林里',autoPlayKey:'sample-1',onPlaybackStart:vi.fn(),onPlaybackError:vi.fn()};vi.spyOn(ttsManager,'stop').mockImplementation(()=>{});vi.spyOn(ttsManager,'isAvailable').mockResolvedValue(true);vi.spyOn(ttsManager,'speak').mockImplementation(async(_text,options)=>{options?.onStart?.();return {firstAudioMs:1}})})
afterEach(()=>{hooks.slots.forEach(slot=>slot?.cleanup?.());vi.restoreAllMocks()})
describe('自动朗读生命周期',()=>{
 it('一次结果只启动一次，普通重绘和手动重播不改自动指标',async()=>{
  render();await settle();render();expect(ttsManager.speak).toHaveBeenCalledTimes(1);expect(props.onPlaybackStart).toHaveBeenCalledTimes(1)
  playButton().props.onClick();render();playButton().props.onClick();await settle()
  expect(ttsManager.speak).toHaveBeenCalledTimes(2);expect(props.onPlaybackStart).toHaveBeenCalledTimes(1)
 })
 it('不同结果即使答案相同也重新播放',async()=>{
  render();await settle();props={...props,autoPlayKey:'sample-2'};render();await settle()
  expect(ttsManager.speak).toHaveBeenCalledTimes(2)
 })
 it('能力检查返回前撤销自动播放，不再调用朗读',async()=>{
  let resolve!:(v:boolean)=>void;vi.mocked(ttsManager.isAvailable).mockReturnValue(new Promise(r=>{resolve=r}))
  render();props={...props,autoPlayKey:undefined};render();resolve(true);await settle()
  expect(ttsManager.speak).not.toHaveBeenCalled();expect(props.onPlaybackStart).not.toHaveBeenCalled()
 })
 it('不支持、异常和启动错误均被记录，不产生未处理异常',async()=>{
  vi.mocked(ttsManager.isAvailable).mockRejectedValue(new Error('browser unavailable'));render();await settle()
  expect(props.onPlaybackError).toHaveBeenCalledTimes(1)
  vi.mocked(ttsManager.isAvailable).mockResolvedValue(false);props={...props,autoPlayKey:'sample-2'};render();await settle()
  expect(props.onPlaybackError).toHaveBeenCalledTimes(2)
  vi.mocked(ttsManager.isAvailable).mockResolvedValue(true);vi.mocked(ttsManager.speak).mockImplementation(async(_text,options)=>{options?.onError?.(new Error('start failed'));return {firstAudioMs:null}})
  props={...props,autoPlayKey:'sample-3'};render();await settle();expect(props.onPlaybackError).toHaveBeenCalledTimes(3)
 })
 it('卸载后迟到的播放回调不更新指标',async()=>{
  let callbacks:any;vi.mocked(ttsManager.speak).mockImplementation(async(_text,options)=>{callbacks=options;return {firstAudioMs:null}})
  render();await settle();hooks.slots.forEach(slot=>slot?.cleanup?.());callbacks.onStart();callbacks.onError(new Error('late'))
  expect(props.onPlaybackStart).not.toHaveBeenCalled();expect(props.onPlaybackError).not.toHaveBeenCalled()
 })
})
