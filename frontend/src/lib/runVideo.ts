/**
 * 从后端运行产物(A 的 media_assets)取回 B 生成并登记的视频，供阅读页播放（E-028）。
 *
 * 旧实现：book.video_url 在导入时写成 null，之后没有任何代码去读 /api/runs/{run_id}/assets，
 * Live 模式下阅读页永远显示静态书页，B 的视频无法播放，"视频上的触控"也从未被测过。
 *
 * 规则：
 *  1. 只认 asset_type=video 且 mime_type=video/mp4 的登记产物（与 A 的白名单一致）；
 *  2. 多个视频时取最晚登记的一个，并把 asset_id/sha256 带出，留痕里写明点的是哪个视频；
 *  3. 产物内容接口要求 Bearer 令牌，<video src> 不能直接带请求头，所以先带令牌下载成 Blob，
 *     再生成 blob: URL；调用方负责 revoke；
 *  4. 没有登记视频 → 返回 none（如实显示"尚无视频，显示静态书页"）；读取失败 → 抛错，不能当成"没有视频"。
 */

export interface RunAssetLike {
  id: string;
  run_id?: string;
  asset_type: string;
  mime_type: string;
  sha256: string;
  duration_ms?: number | null;
  created_at?: string;
}

export interface RunVideoApi {
  getRunAssets(runId: string): Promise<RunAssetLike[]>;
  getAssetContent(runId: string, assetId: string): Promise<Blob>;
}

export type RunVideoResult =
  | { status: 'none'; assetCount: number }
  | { status: 'ready'; url: string; asset: RunAssetLike; sizeBytes: number };

/** 纯函数：选出可播放的视频产物 */
export function pickVideoAsset(assets: RunAssetLike[]): RunAssetLike | null {
  const videos = assets.filter((a) => a.asset_type === 'video' && a.mime_type === 'video/mp4');
  if (!videos.length) return null;
  return [...videos].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0];
}

export async function loadRunVideo(
  api: RunVideoApi,
  runId: string,
  createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob)
): Promise<RunVideoResult> {
  const assets = await api.getRunAssets(runId);
  const asset = pickVideoAsset(assets);
  if (!asset) return { status: 'none', assetCount: assets.length };
  const blob = await api.getAssetContent(runId, asset.id);
  if (!blob || blob.size === 0) throw new Error('视频产物内容为空');
  // 后端 FileResponse 会带 video/mp4；个别代理丢失类型时按登记的 MIME 补上，否则 <video> 可能拒绝播放
  const typed = blob.type === asset.mime_type ? blob : new Blob([blob], { type: asset.mime_type });
  return { status: 'ready', url: createUrl(typed), asset, sizeBytes: typed.size };
}
