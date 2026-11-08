import type { ReplacementFont, TextEdit, TextRegion } from './document'
export function textDraft(region:TextRegion,applied?:TextEdit):TextEdit {
 return applied??{type:'replace-text',page:Number(region.id.split(':')[0]),regionId:region.id,text:region.text,font:(['Helvetica','Times-Roman','Courier'].includes(region.fontName)?region.fontName:'Helvetica') as ReplacementFont,size:Number(region.fontSize.toFixed(2)),color:region.color}
}
