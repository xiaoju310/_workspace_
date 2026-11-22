import { useState } from 'react'
import type { Page } from '../app/types'
import { OwlMascot } from './OwlMascot'

/** 每个页面说一句话：用小孩听得懂的口吻，不承担业务文案职责 */
const lines: Record<Page, string> = {
  home: '今天想读哪一本呀？我陪你挑！',
  import: '把书页放进来，我帮你数页码～',
  review: '慢慢看，看到错字就改掉它！',
  classification: '这本书是什么类型呢？你说了算！',
  progress: '故事正在长大，等一下下～',
  reader: '有问题可以在阅读页的提问框问哦～',
  history: '我们之前聊过这些哦！',
  notes: '把你的小发现写下来吧～',
  sharing: '要分享给谁呢？先检查一遍哦～',
  shared: '这是别人分享给你的笔记～',
  settings: '这里是大人的开关，小心按哦～',
}

/**
 * 伴读猫头鹰：固定在右下角，按页面说一句孩子气的话。
 * 纯装饰 + 提示，不替代任何业务操作；可随时收起，且不遮挡主内容（容器不吃点击）。
 */
export default function ReadingBuddy({ page }: { page: Page }) {
  const [hidden, setHidden] = useState(false)
  const [bubble, setBubble] = useState(true)

  if (hidden) {
    return (
      <button className="buddy-restore" onClick={() => { setHidden(false); setBubble(true) }} aria-label="把猫头鹰叫回来">
        <OwlMascot size={40} />
      </button>
    )
  }

  return (
    <div className="buddy" aria-live="polite">
      {bubble && (
        <div className="buddy-bubble" role="status">
          <span>{lines[page]}</span>
          <button type="button" aria-label="收起猫头鹰的提示" onClick={() => setBubble(false)}>×</button>
        </div>
      )}
      <button
        className="buddy-owl"
        type="button"
        aria-label={bubble ? '收起伴读猫头鹰的提示' : '让伴读猫头鹰再说话'}
        onClick={() => setBubble(value => !value)}
        onDoubleClick={() => setHidden(true)}
      >
        <OwlMascot size={152} />
      </button>
    </div>
  )
}
