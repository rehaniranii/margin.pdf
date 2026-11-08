import { useEffect, useRef } from 'react'
import type { Rect, RenderedPage, ReplacementFont } from '../model/document'
import { regionStyle } from '../geometry/page'

export type InlineDraft = {text:string;font:ReplacementFont;size:number;color:string;bounds:Rect;multiline:boolean}
export function InlineTextEditor({draft,image,busy,onChange,onApply,onCancel}:{draft:InlineDraft;image:RenderedPage;busy:boolean;onChange:(text:string)=>void;onApply:()=>void;onCancel:()=>void}) {
 const input=useRef<HTMLTextAreaElement>(null)
 useEffect(()=>{input.current?.focus();input.current?.select()},[])
 return <div className="inline-text-editor" style={regionStyle(draft.bounds,image)} onPointerDown={event=>event.stopPropagation()}>
  <textarea ref={input} aria-label={draft.multiline?'Edit added text on page':'Edit PDF text on page'} spellCheck={false} disabled={busy} value={draft.text} style={{fontFamily:draft.font==='Times-Roman'?'Times New Roman, serif':draft.font==='Courier'?'Courier New, monospace':'Arial, sans-serif',color:draft.color,fontSize:`${draft.size/(image.bounds[2]-image.bounds[0])*100}cqw`}} onChange={event=>onChange(event.target.value)} onKeyDown={event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onCancel()}
   if(event.key==='Enter'&&(!draft.multiline||event.metaKey||event.ctrlKey)){event.preventDefault();event.stopPropagation();onApply()}
  }}/>
  <div className="inline-text-actions"><span>Draft · {draft.multiline?'Ctrl/Cmd+Enter':'Enter'} to apply</span><button disabled={busy} onClick={onApply}>Apply</button><button disabled={busy} onClick={onCancel}>Cancel</button></div>
 </div>
}
