import { describe, expect, it } from 'vitest'
import { validatedObjectBox, sanitizeTouchBox } from '../objectBounds'
import { TouchObjectOverlay } from '../TouchObjectOverlay'
import type { Interaction } from '../../../app/types'
import type { TouchPoint, TouchRecognitionResponse } from '../../../types/interaction'

const point: TouchPoint = { norm_x: .25, norm_y: .5, video_pixel_x: 200, video_pixel_y: 300, video_width: 800, video_height: 600 }
const item: Interaction = { id:'t',book_id:'b',run_id:'r',kind:'touch',question:'what',answer:'黄瓜',transcript:'',video_ms:0,sources:[],latency_ms:10,created_at:'2026-11-22',uncertain:false,origin:'real',recognized:true,target_name:'黄瓜',bounding_box:[.1,.2,.4,.8],cached:false }

describe('物体框严格校验', () => {
  it('accepts full-image normalized left/top/right/bottom containing click', () => {
    expect(validatedObjectBox([.1,.2,.4,.8],point)).toEqual([.1,.2,.4,.8])
    expect(validatedObjectBox([0,0,1,1],point)).toEqual([0,0,1,1])
    expect(validatedObjectBox([.25,.5,.4,.8],point)).toEqual([.25,.5,.4,.8])
  })
  it.each([null, undefined, [], [0,0,1], [0,0,1,1,1], [-.1,0,.4,.8], [0,0,2,1], [0,0,NaN,1], [0,0,Infinity,1], ['0',0,1,1], [false,0,1,1], [.4,0,.1,1], [0,.5,1,.5], [.6,0,.9,1]].map(value=>[value]))('rejects malformed or neighbouring box %j', value => {
    expect(validatedObjectBox(value,point)).toBeUndefined()
  })
  it('strips geometry for uncertain/low-confidence/demo/non-target results', () => {
    for (const patch of [{status:'uncertain'}, {confidence:.59}, {is_demo_mock:true}, {target_name:' '}]) {
      const data = {status:'success',target_name:'黄瓜',confidence:.9,bounding_box:[.1,.2,.4,.8],...patch} as TouchRecognitionResponse
      sanitizeTouchBox(data,point)
      expect(data.bounding_box).toBeUndefined()
    }
  })
})

describe('responsive same-frame object overlay', () => {
  it('uses original aspect ratio and contain mapping, not container coordinates', () => {
    const tree = TouchObjectOverlay({ item,point,active:true })!
    expect(tree.props.viewBox).toBe('0 0 800 600')
    expect(tree.props.preserveAspectRatio).toBe('xMidYMid meet')
    expect(tree.props['aria-label']).toBe('识别物体边界：黄瓜')
    const rect = tree.props.children.find((node:any)=>node?.type==='rect')
    expect(rect.props).toMatchObject({x:80,y:120})
    expect(rect.props.width).toBeCloseTo(240)
    expect(rect.props.height).toBeCloseTo(360)
  })
  it('hides stale, demo, uncertain, missing or invalid localization', () => {
    expect(TouchObjectOverlay({item,point,active:false})).toBeNull()
    expect(TouchObjectOverlay({item,active:true})).toBeNull()
    for (const patch of [{uncertain:true},{origin:'mock'},{recognized:false},{bounding_box:null},{bounding_box:[.7,0,1,1]},{kind:'question'}]) {
      expect(TouchObjectOverlay({item:{...item,...patch} as Interaction,point,active:true})).toBeNull()
    }
  })
})
