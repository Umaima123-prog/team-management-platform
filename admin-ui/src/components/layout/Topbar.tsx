import { useAuth } from '../../context/AuthContext'

export function Topbar({
  onToggleSidebar,
  sidebarOpen,
}: {
  onToggleSidebar: () => void
  sidebarOpen: boolean
}): React.ReactElement {
  const { user, logout } = useAuth()

  return (
    <header className="app-topbar">
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={onToggleSidebar}
        aria-label="Toggle navigation menu"
        aria-expanded={sidebarOpen}
      >
        ☰
      </button>
      <div className="flex-grow-1" />
      {user && (
        <span className="text-muted small me-2">
          {user.name} <span className="badge text-bg-secondary">{user.role}</span>
        </span>
      )}
      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => void logout()}>
        Sign out
      </button>
    </header>
  )
}
