import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function Shell({ children }: { children: ReactNode }): React.ReactElement {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  // Belt-and-suspenders close on navigation (Sidebar's own link
  // onClick already does this directly) - also covers any
  // programmatic navigation (e.g. a redirect) that didn't go through
  // a literal click on a sidebar link.
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  return (
    <div className="app-shell">
      <Sidebar mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      <button
        type="button"
        className={`app-sidebar-backdrop${mobileOpen ? ' visible' : ''}`}
        aria-label="Close navigation menu"
        onClick={() => setMobileOpen(false)}
        tabIndex={mobileOpen ? 0 : -1}
      />
      <div className="app-main">
        <Topbar onToggleSidebar={() => setMobileOpen((open) => !open)} sidebarOpen={mobileOpen} />
        <main className="app-content">{children}</main>
      </div>
    </div>
  )
}
