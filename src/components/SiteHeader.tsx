import { ThemeToggle } from '../theme'

export const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} pathLength={1}/></svg>

export const Brand = () => <a href="#/" className="brand" aria-label="margin.pdf home"><span className="brand-mark" aria-hidden="true"/>margin<span className="brand-extension">.pdf</span></a>

export function SiteHeader() {
  return <header className="site-header">
    <Brand/>
    <nav aria-label="Site"><a href="#/#tools">Tools</a><a href="#/#privacy">Privacy</a><ThemeToggle/><a className="cta small" href="#/edit">Open editor</a></nav>
  </header>
}

export const SiteFooter = () => <footer className="site-footer"><span>margin.pdf</span><span>Free. No uploads, no account, works offline once loaded.</span></footer>
