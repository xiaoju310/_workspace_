import { validatedObjectBox } from './objectBounds'
export interface VisualTextResult {
  status:'located'|'not_found'|'uncertain'; matches:{text:string;confidence:number;bounding_box:[number,number,number,number]}[]
  width:number;height:number;video_ms:number;frame_source:string;evidence_asset_id:string;frame_sha256:string
}
/** Never invent or repair model geometry. */
export function safeTextMatches(result:VisualTextResult,query:string){
  const key=(s:string)=>s.trim().replace(/\s+/g,' ').toLocaleLowerCase()
  if(result.status!=='located'||!Number.isFinite(result.width)||!Number.isFinite(result.height)||result.width<=0||result.height<=0)return []
  return result.matches.filter(m=>typeof m.text==='string'&&key(m.text)===key(query)&&Number.isFinite(m.confidence)&&m.confidence>=.8&&validatedObjectBox(m.bounding_box))
}
