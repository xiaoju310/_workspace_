import type { ReactNode } from 'react'
import type { Page } from '../app/types'

/** 阅读时先看到播放器；生成工具仍保留在下方，展开不会提交任务。 */
export default function WorkspacePageContent({page,tools,children}:{page:Page;tools:ReactNode;children:ReactNode}) {
  return <>
    {page==='progress'&&tools}
    {children}
    {page==='reader'&&<details className="page-content reader-generation-tools">
      <summary>生成记录与分镜工具（展开查看，不会重新生成）</summary>
      {tools}
    </details>}
  </>
}
