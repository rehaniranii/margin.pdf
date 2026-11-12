import type { Point, Rect, RenderedPage, ReplacementFont, TextSpan } from '../model/document'
import { fontCss } from '../model/fonts'
import { RichTextField } from './RichTextField'
import type { StyledValue } from './RichTextField'
import { regionStyle } from '../geometry/page'

// `wrap`: a paragraph replacement; the text wraps like the page will, and Enter still applies.
export type InlineDraft = {text:string;font:ReplacementFont;spans?:TextSpan[];size:number;color:string;bounds:Rect;multiline:boolean;wrap?:boolean;direction?:Point}
export function InlineTextEditor({draft,image,busy,onChange,onApply,onCancel}:{draft:InlineDraft;image:RenderedPage;busy:boolean;onChange:(value:StyledValue)=>void;onApply:()=>void;onCancel:()=>void}) {
 const angle=draft.direction?Math.round(Math.atan2(draft.direction[1],draft.direction[0])*180/Math.PI):0
 const quarterTurn=Math.abs(angle)===90,pageWidth=image.bounds[2]-image.bounds[0]
 const width=draft.bounds[2]-draft.bounds[0],height=draft.bounds[3]-draft.bounds[1]
 const rotated=angle?{position:'absolute' as const,width:`${(quarterTurn?height:width)/pageWidth*100}cqw`,height:`${(quarterTurn?width:height)/pageWidth*100}cqw`,minWidth:0,minHeight:0,transformOrigin:'top left',transform:`rotate(${angle}deg)`,left:angle===90||Math.abs(angle)===180?'100%':'0',top:angle===-90||Math.abs(angle)===180?'100%':'0'}:{}
 return <div className="inline-text-editor" style={regionStyle(draft.bounds,image)} onPointerDown={event=>event.stopPropagation()}>
  {/* Cmd/Ctrl+B and I style the selected words (all of the text when nothing is selected). */}
  <RichTextField autoSelect label={draft.multiline?'Edit added text on page':'Edit PDF text on page'} multiline={draft.multiline} disabled={busy} text={draft.text} font={draft.font} spans={draft.spans}
   style={{...rotated,...fontCss(draft.font),fontWeight:400,fontStyle:'normal',...(draft.wrap||draft.multiline?{whiteSpace:'pre-wrap',overflowWrap:'break-word'}:{}),color:draft.color,fontSize:`${draft.size/pageWidth*100}cqw`}}
   onChange={onChange} onKeyDown={event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onCancel()}
   if(event.key==='Enter'&&(!draft.multiline||event.metaKey||event.ctrlKey)){event.preventDefault();event.stopPropagation();onApply()}
  }}/>
  <div className="inline-text-actions" style={angle?{left:'auto',right:0}:undefined}><span>Draft · {draft.multiline?'Ctrl/Cmd+Enter':'Enter'} to apply</span><button disabled={busy} onClick={onApply}>Apply</button><button disabled={busy} onClick={onCancel}>Cancel</button></div>
 </div>
}
