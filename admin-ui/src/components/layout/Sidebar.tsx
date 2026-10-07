import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/teams', label: 'Teams' },
  { to: '/projects', label: 'Projects' },
]

export function Sidebar({
  mobileOpen,
  onNavigate,
}: {
  mobileOpen: boolean
  /** Called when a nav link is clicked - lets the mobile off-canvas
   * sidebar close itself on navigation instead of staying open over
   * the page the user just asked to go to. No-op impact on desktop,
   * where the sidebar is always visible regardless. */
  onNavigate: () => void
}): React.ReactElement {
  return (
    <nav
      className={`app-sidebar${mobileOpen ? ' mobile-open' : ''}`}
      aria-label="Primary navigation"
    >
      <a href="/" className="brand">
        Team Management Platform
      </a>
      <ul className="nav flex-column mt-2" role="list">
        {NAV_ITEMS.map((item) => (
          <li key={item.to} className="nav-item">
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              onClick={onNavigate}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
