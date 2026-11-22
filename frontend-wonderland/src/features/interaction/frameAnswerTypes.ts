export interface FrameQuestionResult {
  status:'answered'|'uncertain'; answer:string; confidence:number; page_no:number
  width:number;height:number;video_ms:number;frame_source:string;evidence_asset_id:string;frame_sha256:string
}
