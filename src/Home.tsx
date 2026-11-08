import { ThemeToggle } from './theme'
import './home.css'

// Only tools with a working route get a link; the rest are labelled honestly until they ship.
const tools = [
  { name: 'Edit text', blurb: 'Change existing text right on the page.', href: '#/edit', icon: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4' },
  { name: 'Merge', blurb: 'Combine several PDFs into one file.', icon: 'M6 4v6a4 4 0 0 0 4 4h4M18 4v6a4 4 0 0 1-4 4M12 14v6' },
  { name: 'Split', blurb: 'Pull pages or ranges into new files.', icon: 'M12 4v6M12 10l-6 10M12 10l6 10' },
  { name: 'Organize', blurb: 'Reorder, delete and duplicate pages.', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { name: 'Rotate', blurb: 'Turn pages the right way up.', icon: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5' },
  { name: 'Image to PDF', blurb: 'Turn JPG and PNG images into a PDF.', icon: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01' },
  { name: 'PDF to image', blurb: 'Export pages as crisp images.', icon: 'M6 3h8l4 4v14H6zM14 3v4h4M9 17l2-3 2 2 2-3' },
  { name: 'Watermark', blurb: 'Stamp text across every page.', icon: 'M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z' },
  { name: 'Page numbers', blurb: 'Add numbering in the margin you choose.', icon: 'M6 3h12v18H6zM10 17h4M12 7v6' },
]

const promises = [
  { title: 'Never uploaded', body: 'A WebAssembly engine opens and processes your PDFs inside this browser tab. Your files go nowhere else.' },
  { title: 'No account, no limits', body: 'No sign-up, no paywall, no daily quota, no watermark on what you export.' },
  { title: 'No tracking', body: 'There are no analytics or third-party scripts, and your documents are never stored.' },
]

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} pathLength={1}/></svg>


function spotlight(event: React.PointerEvent<HTMLElement>) {
  const box = event.currentTarget.getBoundingClientRect()
  event.currentTarget.style.setProperty('--x', `${event.clientX - box.left}px`)
  event.currentTarget.style.setProperty('--y', `${event.clientY - box.top}px`)
}

export default function Home() {
  return <div className="home">
    <header className="home-header">
      <a href="#/" className="brand" aria-label="margin.pdf home"><span className="brand-mark" aria-hidden="true">m<span>.</span></span>margin<span className="brand-extension">.pdf</span></a>
      <nav><a href="#tools">Tools</a><a href="#privacy">Privacy</a><ThemeToggle/><a className="home-cta small" href="#/edit">Open editor</a></nav>
    </header>

    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow rise"><span/>Free · Private · In your browser</p>
          <h1 className="rise" style={{ '--d': '80ms' } as React.CSSProperties}>Every PDF tool you need.<br/><em>None of the uploading.</em></h1>
          <p className="lede rise" style={{ '--d': '160ms' } as React.CSSProperties}>Edit, merge, split and convert PDFs on your own device. Free, no account, and your files never leave your computer.</p>
          <div className="hero-actions rise" style={{ '--d': '240ms' } as React.CSSProperties}><a className="home-cta" href="#/edit">Start editing <span aria-hidden="true">→</span></a><a className="home-ghost" href="#tools">See all tools</a></div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="sheet back"/><div className="sheet mid"/>
          <div className="sheet front"><i/><i/><i className="short"/><i className="edit"/><i/><i className="short"/></div>
          <div className="chip lock">● Processed locally</div><div className="chip tool">✎ Edit text</div><div className="chip page">Page 1 / 2</div>
        </div>
      </section>

      <section id="tools" className="tools">
        <h2 className="reveal">Tools</h2>
        <p className="section-lede reveal">The ones you reach for every day, all running on your device.</p>
        <div className="tool-grid">
          {tools.map((tool, i) => {
            const body = <><span className="tool-icon"><Icon d={tool.icon}/></span><strong>{tool.name}</strong><span className="tool-blurb">{tool.blurb}</span>{tool.href ? <span className="live">Live</span> : <span className="soon">Soon</span>}</>
            const style = { '--d': `${i * 40}ms` } as React.CSSProperties
            return tool.href
              ? <a key={tool.name} className="tool-card reveal" style={style} href={tool.href} onPointerMove={spotlight}>{body}</a>
              : <div key={tool.name} className="tool-card reveal is-soon" style={style} aria-disabled="true">{body}</div>
          })}
        </div>
      </section>

      <section id="privacy" className="privacy">
        <h2 className="reveal">Private by design</h2>
        <div className="promise-grid">{promises.map((p, i) => <div key={p.title} className="promise reveal"><span className="promise-num" aria-hidden="true">{i + 1}</span><h3>{p.title}</h3><p>{p.body}</p></div>)}</div>
      </section>
    </main>

    <footer className="home-footer"><span>margin.pdf</span><span>No uploads. No account.</span></footer>
  </div>
}
