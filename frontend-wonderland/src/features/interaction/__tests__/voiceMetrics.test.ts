import {describe,it,expect} from 'vitest'
import {summarizeVoiceSamples,type VoiceSample} from '../voiceMetrics'
const sample:VoiceSample={id:'1',language:'zh-CN',stoppedAt:100,asrCompletedAt:300,requestStartedAt:400,answerAt:800,playbackAt:2100,status:'started'}
describe('语音全链路统计',()=>{
 it('包含失败、待确认和取消样本，不只统计成功请求',()=>{
  expect(summarizeVoiceSamples([sample,{...sample,id:'2',status:'recognition_failed'},{...sample,id:'3',status:'needs_confirmation'},{...sample,id:'4',status:'cancelled'}])).toMatchObject({total:4,started:1,withinTwoSeconds:1,ratio:.25,measurement:'browser_playback_start_not_verified_audible_onset'})
 })
 it('边界为录音结束至浏览器播放开始，超时不计达标',()=>{
  expect(summarizeVoiceSamples([sample,{...sample,id:'2',playbackAt:2101}])).toMatchObject({started:2,withinTwoSeconds:1,ratio:.5})
 })
 it('拒绝缺失、负数、非有限及倒序时间戳',()=>{
  const invalid=[{stoppedAt:null},{stoppedAt:NaN},{playbackAt:Infinity},{playbackAt:-1},{playbackAt:99},{asrCompletedAt:900},{requestStartedAt:NaN}].map((patch,index)=>({...sample,...patch,id:String(index)}))
  expect(summarizeVoiceSamples(invalid)).toMatchObject({total:7,started:0,withinTwoSeconds:0,ratio:0})
 })
 it('没有样本时不假报成功率',()=>{expect(summarizeVoiceSamples([]).ratio).toBeNull()})
})
