import { useState } from 'react'
import type { CSSProperties } from 'react'
import { DropZone } from './components/DropZone'
import { Icon, SiteFooter, SiteHeader } from './components/SiteHeader'
import { handOff } from './handoff'
import { categories, toolHref, tools, type Tool } from './tools'
import './site.css'

const notes = [
  { title: 'Nothing is uploaded', body: 'A PDF engine compiled to WebAssembly runs inside this tab. Files are read from your disk and written back to it. There is no server to send them to.' },
  { title: 'Free, without the catch', body: 'No account, no paywall, no daily limit, no watermark added to your work. The only limit is your device’s memory.' },
  { title: 'Works offline', body: 'After the first visit the app keeps its own files, so it opens without a connection. Your documents are never cached.' },
]
const delay = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

export default function Home() {
  const [file, setFile] = useState<File>()
  const isImage = !!file && file.type.startsWith('image/')
  const choices = tools.filter(tool => tool.accepts === (isImage ? 'image' : 'pdf'))
  function choose(tool: Tool) { if (file) handOff(file); location.hash = toolHref(tool) }

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

        <div className="sheet rise" style={delay(200)}>
          {!file ? <DropZone label="Drop a PDF or images" hint="We’ll show what you can do with it. Nothing leaves this tab." accept="application/pdf,.pdf,image/png,image/jpeg,.png,.jpg,.jpeg" onFiles={files => setFile(files[0])}/>
            : <div className="chooser" aria-live="polite">
              <p className="chooser-file"><strong title={file.name}>{file.name}</strong><button className="link" onClick={() => setFile(undefined)}>Choose another</button></p>
              <p className="chooser-ask">What would you like to do?</p>
              <ul>{choices.map((tool, i) => <li key={tool.id} style={delay(i * 35)}><button onClick={() => choose(tool)}><span className="tool-icon"><Icon d={tool.icon}/></span>{tool.name}<span className="go" aria-hidden="true">→</span></button></li>)}</ul>
            </div>}
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
