import { useCurrentUser } from '../../context/CurrentUserContext'

export function Topbar({
  onToggleSidebar,
  sidebarOpen,
}: {
  onToggleSidebar: () => void
  sidebarOpen: boolean
}): React.ReactElement {
  const { users, currentUser, setCurrentUserId, signOut } = useCurrentUser()

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
      <label htmlFor="current-user-select" className="visually-hidden">
        Acting as
      </label>
      <select
        id="current-user-select"
        className="form-select form-select-sm current-user-select"
        style={{ width: 'auto' }}
        value={currentUser?.id ?? ''}
        onChange={(e) => setCurrentUserId(e.target.value)}
        aria-label="Acting as"
      >
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={signOut}>
        Sign out
      </button>
    </header>
  )
}
