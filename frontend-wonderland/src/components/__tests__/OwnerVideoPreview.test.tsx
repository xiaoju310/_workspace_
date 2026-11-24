import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import OwnerVideoPreview from '../OwnerVideoPreview'
import type { RunVideoState } from '../../app/types'

const ready:RunVideoState={status:'ready',url:'blob:saved-video',asset_id:'asset',sha256:'hash',size_bytes:100}
function html(videoState?:RunVideoState) {
  return renderToStaticMarkup(<OwnerVideoPreview videoState={videoState} onReload={vi.fn()} onReview={vi.fn()}/> )
}
describe('主人复核前的视频预览',()=>{
  it('未复核仍显示真实已保存视频，手动播放且不自动播放',()=>{
    const result=html(ready)
    expect(result).toContain('src="blob:saved-video"')
    expect(result).toContain('controls=""')
    expect(result).toContain('已生成视频（主人复核预览）')
    expect(result).not.toContain('autoPlay')
    expect(result).not.toContain('autoplay')
    expect(result).toContain('不会自动开启云端问答与认物')
    expect(result).toContain('查看生成进度与复核记录')
    expect(result).toContain('仅播放不会修改复核状态')
  })
  it('读取中不冒充失败，也不暴露生成重试',()=>{
    const result=html({status:'loading'})
    expect(result).toContain('正在读取本次运行已保存的视频')
    expect(result).not.toContain('<video')
    expect(result).not.toContain('重新读取已保存视频')
  })
  it('读取失败不渲染无效播放器，不显示底层凭据',()=>{
    const result=html({status:'error',error:'provider-secret-url'})
    expect(result).toContain('读取已保存视频失败')
    expect(result).toContain('重新读取已保存视频')
    expect(result).not.toContain('provider-secret-url')
    expect(result).not.toContain('<video')
  })
  it('确认区直接显示在视频下方，初始必须手动勾选',()=>{
    const confirm=vi.fn()
    const result=renderToStaticMarkup(<OwnerVideoPreview videoState={ready} onReview={vi.fn()} onConfirmReview={confirm}/>)
    expect(result).toContain('在这里确认内容复核')
    expect(result).toContain('确认内容复核并进入互动伴读')
    expect(result).toContain('type="checkbox"')
    expect(result).toMatch(/<button[^>]*disabled=""/)
    expect(result.indexOf('在这里确认内容复核')).toBeGreaterThan(result.indexOf('</video>'))
    expect(confirm).not.toHaveBeenCalled()
  })
  it('无产物时不假装成功',()=>{
    const result=html({status:'none',assetCount:2})
    expect(result).toContain('尚未读取到已保存的视频')
    expect(result).not.toContain('<video')
  })
})
