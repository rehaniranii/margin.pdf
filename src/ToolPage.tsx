import { useState } from 'react'
import { UtilityPanel } from './components/UtilityPanel'
import { Icon, SiteFooter, SiteHeader } from './components/SiteHeader'
import { handOff, takeHandOff } from './handoff'
import { categories, toolHref, tools, type Tool } from './tools'
import './site.css'

export default function ToolPage({ tool }: { tool: Tool }) {
  const [initialFile] = useState(() => takeHandOff()?.file)
  const related = tools.filter(other => other.category === tool.category && other.id !== tool.id)
  const note = categories.find(category => category.id === tool.category)?.note
  return <div className="site tool-page">
    <SiteHeader/>
    <main>
      <div className="tool-heading">
        <nav className="crumbs" aria-label="Breadcrumb"><a href="#/">Tools</a><span aria-hidden="true">/</span><span>{tool.category}</span></nav>
        <div className="tool-title"><span className="tool-icon large"><Icon d={tool.icon}/></span><div><h1>{tool.name}</h1><p>{tool.intro ?? tool.blurb}</p></div></div>
        <p className="local-line"><span aria-hidden="true"/>Runs in this tab. The file is read from your device and never uploaded.</p>
      </div>
      {/* key: a new tool gets a fresh worker and form state */}
      <UtilityPanel key={tool.id} page initialTab={tool.tab} initialFile={initialFile}
        onClose={() => { location.hash = '#/' }}
        onOpen={(bytes, name, hasLocalCopy) => { handOff(new File([bytes], name, { type: 'application/pdf' }), hasLocalCopy); location.hash = '#/edit' }}/>
      {related.length > 0 && <section className="related">
        <h2>More in {tool.category}<small>{note}</small></h2>
        <div className="related-list">{related.map(other => <a key={other.id} href={toolHref(other)}><span className="tool-icon"><Icon d={other.icon}/></span><span><strong>{other.name}</strong><small>{other.blurb}</small></span></a>)}</div>
      </section>}
    </main>
    <SiteFooter/>
  </div>
}
