import type { TextEdit, TextRegion } from './document'
import { closestFont } from './fonts'
export function textDraft(region:TextRegion,applied?:TextEdit):TextEdit {
 return applied??{type:'replace-text',page:Number(region.id.split(':')[0]),regionId:region.id,text:region.text,font:closestFont(region.fontName),size:Number(region.fontSize.toFixed(2)),color:region.color,...(region.link?{link:region.link}:{})}
}
