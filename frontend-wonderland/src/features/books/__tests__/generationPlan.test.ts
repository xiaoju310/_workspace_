import {describe,it,expect} from 'vitest'
import {workflowPlan} from '../generationPlan'
import type {WorkflowStatus} from '../../../api/client'
const value={clips:[{page_no:1,submitted:1,downloaded:1,submission_started:1},{page_no:2,submitted:1,downloaded:0,submission_started:1},{page_no:3,submitted:0,downloaded:0,submission_started:1},{page_no:4,submitted:0,downloaded:0,submission_started:0}],narration:true} as WorkflowStatus

describe('生成计划不伪造费用和复用',()=>{
  it('恢复准确区分四种片段',()=>{
    const p=workflowPlan('resume',value,[1,2,3,4],false)
    expect(p.reuse).toEqual(['已下载，校验通过后复用文件：第 1 页','已提交，继续查询原任务：第 2 页','尚未提交，恢复后可能新建收费片段：第 4 页','提交结果不明（后端会阻止恢复，需先核对）：第 3 页'])
    expect(p.narration).toContain('沿用首次选择：本机中文配音')
    expect(p.services.join()).toContain('只向火山方舟查询原任务')
    expect(p.services.join()).toContain('仅尚未提交的片段')
  })
  it('旧服务缺少 submission_started 不会承诺免费恢复',()=>{
    const p=workflowPlan('resume',{...value,clips:[{page_no:8,submitted:0,downloaded:0}],narration:undefined},[8],true)
    expect(p.reuse[2]).toContain('第 8 页');expect(p.narration).toContain('不推断');expect(p.warnings.join()).toContain('可能收费')
  })
  it('图文理解不包含配音且注明外发',()=>{
    const p=workflowPlan('vision',value,[8,12],true)
    expect(p.pages).toEqual([8,12]);expect(p.narration).toBe('不包含');expect(p.services.join()).toContain('校对文字发送')
  })
  it('首次多页视频明确披露在线女声外发文字',()=>{
    expect(workflowPlan('video',value,[1,2],true).narration).toContain('旁白文字会发送到微软在线语音服务')
    expect(workflowPlan('video',value,[1,2],false).narration).toBe('不包含')
  })
})

it('在线女声恢复披露外发，并且不误称本机配音',()=>{
  const p=workflowPlan('resume',{...value,narration_provider:'edge_neural'},[1,2],true)
  expect(p.narration).toContain('微软在线语音服务')
  expect(p.narration).not.toContain('本机中文配音')
})
