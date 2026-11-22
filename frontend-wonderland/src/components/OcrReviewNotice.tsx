import { Badge, Icon } from './ui'
import { findSuspectOcrLines, ocrReferenceScore } from '../features/books/ocrReview'

export function OcrReviewNotice({ text, score, demo, edited }: {
  text: string; score: number | null | undefined; demo: boolean; edited: boolean
}) {
  const suspects = findSuspectOcrLines(text)
  return (
    <div className="ocr-notice">
      <div className="wf-card-heading">
        <h2>文字校对</h2>
        <Badge tone="neutral">{demo ? '演示参考分' : '识别参考分'} {ocrReferenceScore(score)}</Badge>
      </div>
      <p id="ocr-score-help" className="wf-small">
        参考分只针对模型最初输出，不评价人工校对后的文字，不是文字准确率；高分也可能漏字、漏标点或打乱阅读顺序。
        {demo ? '当前分数与文字为演示数据。' : ''}{edited ? '你已编辑文字，参考分不评价手工修改后的内容。' : ''}
      </p>
      <p id="ocr-review-help" className="ocr-hint">
        <Icon name="alert" size={16} />
        请每页对照原图检查正文、阅读顺序、引号与标点，手动确认后再进入后续分析。系统不会自动确认。
      </p>
      {typeof score === 'number' && Number.isFinite(score) && score >= 0 && score < .8 && (
        <p className="wf-small">本页识别参考分较低，尤其需要检查漏字与错字。</p>
      )}
      <p className="wf-small">拍照小提示：书页铺平、镜头正对书页、避开反光；拍清文字并保留完整正文。若出现漏行或顺序错乱，请重拍后识别，或手动校对。</p>
      {suspects.length > 0 && (
        <div id="ocr-suspect-help" className="ocr-suspects" role="status">
          <div>
            <p>发现 {suspects.length} 处可疑独立行，可能是装饰误识别，也可能是原文。请对照原图决定是否保留；系统未自动删除任何文字。</p>
            <ul>{suspects.slice(0, 12).map(item => <li key={item.line}>第 {item.line} 行：「{item.text}」</li>)}</ul>
            {suspects.length > 12 && <p>仅列出前 12 处，请继续检查全文。</p>}
          </div>
        </div>
      )}
    </div>
  )
}
