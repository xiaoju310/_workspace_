/**
 * Live 主流程编排：建档 → 自动分类 →（主人校对/确认）→ 上传书页与校对文字 → 发起分析 → 轮询真实任务。
 * run_id / job_id 只来自后端响应，前端不再自己生成。
 * 依赖注入，便于单测，也便于 scripts/check-live-flow.sh 对真实后端跑同一份代码。
 */
export interface LiveBookApi {
  createBook(input: { title: string; authorization_ref: string }): Promise<{ id: string }>;
  classifyBook(bookId: string): Promise<{ predicted_type: string; confidence: number; reasons: string[] }>;
  uploadPage(bookId: string, file: Blob, pageNo: number): Promise<unknown>;
  updatePageOcr(bookId: string, pageNo: number, text: string): Promise<unknown>;
  analyzeBook(bookId: string): Promise<{ job_id: string; run_id: string; status: string }>;
}

/** 建档并立即自动分类：A 要求先分类才能确认（否则确认分类返回 409） */
export async function registerServerBook(api: LiveBookApi, input: { title: string; authorization_ref: string }) {
  const book = await api.createBook(input);
  try {
    const classification = await api.classifyBook(book.id);
    return { bookId: book.id, classification };
  } catch (e: any) {
    throw new Error(`图书已建档（${book.id}），但自动分类失败：${e?.message ?? e}`);
  }
}

export interface LivePageInput {
  ocr_text: string;
  /** 已上传时对应的服务端页码 */
  server_page_no?: number | null;
  /** 上次同步到服务端的校对文字 */
  server_synced_text?: string | null;
  getImage(): Promise<Blob>;
}

/**
 * 把最终页序的书页和校对文字同步到服务端并发起分析。
 * 可重入：失败后重试只补未同步的部分；每同步一页就通过 onSynced 记录，半途失败也不丢进度。
 */
export async function startServerAnalysis(
  api: LiveBookApi,
  bookId: string,
  pages: LivePageInput[],
  onSynced: (index: number, patch: { server_page_no: number; server_synced_text: string | null }) => void
): Promise<{ job_id: string; run_id: string }> {
  if (pages.length === 0) throw new Error('这本书还没有书页，无法发起分析。');
  pages.forEach((page, index) => {
    if (page.server_page_no && page.server_page_no !== index + 1) {
      throw new Error('书页上传后不能再调整顺序（服务端页码不可变），请恢复原顺序或重新导入。');
    }
  });

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const pageNo = index + 1;
    let synced = page.server_synced_text ?? null;
    if (!page.server_page_no) {
      await api.uploadPage(bookId, await page.getImage(), pageNo);
      onSynced(index, { server_page_no: pageNo, server_synced_text: synced });
    }
    if (synced !== page.ocr_text) {
      await api.updatePageOcr(bookId, pageNo, page.ocr_text);
      synced = page.ocr_text;
      onSynced(index, { server_page_no: pageNo, server_synced_text: synced });
    }
  }

  const job = await api.analyzeBook(bookId);
  if (!job?.run_id || !job?.job_id) throw new Error('服务端没有返回运行标识，无法跟踪分析任务。');
  return { job_id: job.job_id, run_id: job.run_id };
}

export interface RunJobLike {
  status: string;
  stage: string;
  error_code: string | null;
  error_message: string | null;
}

export type RunPhase =
  | { phase: 'running' }
  | { phase: 'succeeded' }
  | { phase: 'failed'; error: string };

/** 把后端任务列表归纳为阶段：任一失败即失败；全部成功才算成功；空列表不算成功 */
export function summarizeRunJobs(jobs: RunJobLike[]): RunPhase {
  const failed = jobs.find((j) => j.status === 'FAILED');
  if (failed) {
    const code = failed.error_code ?? 'UNKNOWN_ERROR';
    return { phase: 'failed', error: `${code}：${failed.error_message ?? '任务失败，后端未给出原因'}` };
  }
  if (jobs.length > 0 && jobs.every((j) => j.status === 'SUCCEEDED')) return { phase: 'succeeded' };
  return { phase: 'running' };
}
