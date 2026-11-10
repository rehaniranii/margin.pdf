import type { CSSProperties } from 'react'
import { Icon, SiteFooter, SiteHeader } from './components/SiteHeader'
import { categories, toolHref, tools } from './tools'
import './site.css'

const notes = [
  { title: 'Documents stay local', body: 'A PDF engine compiled to WebAssembly runs inside this tab. Files are read from your disk and written back to it. The Vercel-hosted site uses basic visit analytics, which receive page names rather than your documents or editing actions.' },
  { title: 'Free, without the catch', body: 'No account, no paywall, no daily limit, no watermark added to your work. The only limit is your device’s memory.' },
  { title: 'Works offline', body: 'After the first visit the app keeps its own files, so it opens without a connection. Your documents are never cached.' },
]
const delay = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

export default function Home() {
  return <div className="site home">
    <SiteHeader/>
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker rise">Free PDF tools · in your browser</p>
          <h1 className="rise" style={delay(80)}>PDF tools that never ask for your file.</h1>
          <p className="lede rise" style={delay(160)}>Edit, merge, split, stamp and convert PDFs right here. Everything runs on your own device, so there is nothing to upload and nothing to sign up for.</p>
          <div className="hero-actions rise" style={delay(240)}><a className="cta" href="#/edit">Open the editor <span aria-hidden="true">→</span></a><a className="ghost" href="#/#tools">Browse tools</a></div>
        </div>

        <div className="sheet rise" style={delay(200)} aria-hidden="true">
          <div className="note">
            <p className="note-title">Project update</p>
            <p>Revenue grew <span className="swap"><span className="old">14%</span><span className="new">18%</span></span> this quarter.</p>
            <p>Costs stayed flat and <span className="mark">tickets fell</span>.</p>
            <p className="faint">Next: offline mode, accessibility.</p>
            <p/>
            <p>Contact: <span className="redact">jane.doe@example.com</span></p>
            <p>Signed, <svg className="signature" viewBox="0 0 150 44"><path pathLength={1} d="M4 34c6-14 12-26 16-26s-2 22-8 30c-4 5-9 2-6-4 4-8 14-6 18-2M30 24c4-6 9-6 8 0s-3 10 1 8 7-10 10-12-1 12 3 12 6-12 9-14c2 6 0 12 4 12s7-8 10-12M80 22c-6 0-9 12-3 12s8-14 10-20c-2 10-4 20 2 20s10-14 14-16c-6 2-6 14 0 14s9-8 12-12M108 36c12-3 24-5 38-6"/></svg></p>
            <p/>
            <p className="note-foot">Page 1 of 3</p>
          </div>
          <span className="note-chip">Edited on this device</span>
        </div>
      </section>

      <section id="tools" className="index">
        <header className="section-head reveal"><h2>Tools</h2><p>Every tool works on your device. Pick one, or open the editor and use them together.</p></header>
        <div className="index-grid">
          {categories.map(category => <div key={category.id} className="index-group reveal">
            <h3>{category.id}<small>{category.note}</small></h3>
            <ul>{tools.filter(tool => tool.category === category.id).map(tool => <li key={tool.id}>
              <a href={toolHref(tool)}><span className="tool-icon"><Icon d={tool.icon}/></span><span className="entry"><strong>{tool.name}</strong><small>{tool.blurb}</small></span><span className="leader" aria-hidden="true"/><span className="go" aria-hidden="true">→</span></a>
            </li>)}</ul>
          </div>)}
        </div>
      </section>

      <section id="privacy" className="fine-print">
        <header className="section-head reveal"><h2>The fine print</h2><p>Usually this is where the catch is. Here it’s just how the app works.</p></header>
        <ol>{notes.map(note => <li key={note.title} className="reveal"><h3>{note.title}</h3><p>{note.body}</p></li>)}</ol>
      </section>
    </main>
    <SiteFooter/>
  </div>
}
