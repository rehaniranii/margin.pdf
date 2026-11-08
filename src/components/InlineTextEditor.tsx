import { useEffect, useRef } from 'react'
import type { Point, Rect, RenderedPage, ReplacementFont } from '../model/document'
import { fontCss } from '../model/fonts'
import { regionStyle } from '../geometry/page'

// `wrap`: a paragraph replacement; the text wraps like the page will, and Enter still applies.
export type InlineDraft = {text:string;font:ReplacementFont;size:number;color:string;bounds:Rect;multiline:boolean;wrap?:boolean;direction?:Point}
export function InlineTextEditor({draft,image,busy,onChange,onApply,onCancel}:{draft:InlineDraft;image:RenderedPage;busy:boolean;onChange:(text:string)=>void;onApply:()=>void;onCancel:()=>void}) {
 const input=useRef<HTMLTextAreaElement>(null)
 useEffect(()=>{input.current?.focus();input.current?.select()},[])
 const angle=draft.direction?Math.round(Math.atan2(draft.direction[1],draft.direction[0])*180/Math.PI):0
 const quarterTurn=Math.abs(angle)===90,pageWidth=image.bounds[2]-image.bounds[0]
 const width=draft.bounds[2]-draft.bounds[0],height=draft.bounds[3]-draft.bounds[1]
 const rotated=angle?{position:'absolute' as const,width:`${(quarterTurn?height:width)/pageWidth*100}cqw`,height:`${(quarterTurn?width:height)/pageWidth*100}cqw`,minWidth:0,minHeight:0,transformOrigin:'top left',transform:`rotate(${angle}deg)`,left:angle===90||Math.abs(angle)===180?'100%':'0',top:angle===-90||Math.abs(angle)===180?'100%':'0'}:{}
 return <div className="inline-text-editor" style={regionStyle(draft.bounds,image)} onPointerDown={event=>event.stopPropagation()}>
  <textarea ref={input} aria-label={draft.multiline?'Edit added text on page':'Edit PDF text on page'} spellCheck={false} disabled={busy} value={draft.text} style={{...rotated,...fontCss(draft.font),...(draft.wrap?{whiteSpace:'pre-wrap',overflowWrap:'break-word'}:{}),color:draft.color,fontSize:`${draft.size/pageWidth*100}cqw`}} onChange={event=>onChange(event.target.value)} onKeyDown={event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onCancel()}
   if(event.key==='Enter'&&(!draft.multiline||event.metaKey||event.ctrlKey)){event.preventDefault();event.stopPropagation();onApply()}
  }}/>
  <div className="inline-text-actions" style={angle?{left:'auto',right:0}:undefined}><span>Draft · {draft.multiline?'Ctrl/Cmd+Enter':'Enter'} to apply</span><button disabled={busy} onClick={onApply}>Apply</button><button disabled={busy} onClick={onCancel}>Cancel</button></div>
 </div>
}
