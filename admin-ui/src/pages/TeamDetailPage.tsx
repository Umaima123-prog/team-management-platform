import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAsync } from '../hooks/useAsync'
import {
  addTeamMember,
  getTeam,
  listUsers,
  removeTeamMember,
  updateTeamMemberRole,
} from '../api/endpoints'
import type { TeamRole } from '../api/types'
import { ErrorAlert, errorMessage } from '../components/common/ErrorAlert'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { useToast } from '../context/ToastContext'

const ROLES: TeamRole[] = ['OWNER', 'LEAD', 'MEMBER']

export function TeamDetailPage(): React.ReactElement {
  const { teamId } = useParams<{ teamId: string }>()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const { showToast } = useToast()

  const { data: team, loading, error, reload } = useAsync(
    (signal) => getTeam({ signal }, teamId!),
    [teamId],
  )
  const { data: usersPage } = useAsync((signal) => listUsers({ signal }), [])

  const [selectedNewMember, setSelectedNewMember] = useState('')
  const [newMemberRole, setNewMemberRole] = useState<TeamRole>('MEMBER')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)

  const activeMembers = team?.members.filter((m) => !m.removedAt) ?? []
  const memberUserIds = new Set(activeMembers.map((m) => m.userId))
  const availableUsers = (usersPage?.items ?? []).filter((u) => !memberUserIds.has(u.id))

  function userName(id: string): string {
    return usersPage?.items.find((u) => u.id === id)?.name ?? id
  }

  async function handleAddMember(): Promise<void> {
    if (!teamId || !selectedNewMember) return
    setActionError(null)
    setBusyUserId(selectedNewMember)
    try {
      await addTeamMember({}, teamId, { userId: selectedNewMember, role: newMemberRole })
      showToast('success', `${userName(selectedNewMember)} added to the team.`)
      setSelectedNewMember('')
      reload()
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBusyUserId(null)
    }
  }

  async function handleRoleChange(memberUserId: string, role: TeamRole): Promise<void> {
    if (!teamId) return
    setActionError(null)
    setBusyUserId(memberUserId)
    try {
      await updateTeamMemberRole({}, teamId, memberUserId, role)
      showToast('success', 'Role updated.')
      reload()
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBusyUserId(null)
    }
  }

  async function handleRemove(memberUserId: string): Promise<void> {
    if (!teamId) return
    setActionError(null)
    setBusyUserId(memberUserId)
    try {
      await removeTeamMember({}, teamId, memberUserId)
      showToast('success', `${userName(memberUserId)} removed from the team.`)
      reload()
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBusyUserId(null)
    }
  }

  if (loading) return <LoadingSpinner label="Loading team…" />
  if (error) return <ErrorAlert error={error} onRetry={reload} />
  if (!team) return <></>

  return (
    <div>
      <h1 className="h3">
        {team.name} <span className="text-muted small">({team.code})</span>
      </h1>
      {team.description && <p className="text-muted">{team.description}</p>}

      {actionError && (
        <div className="alert alert-danger" role="alert">
          {actionError}
        </div>
      )}

      <div className="card mb-4">
        <div className="card-body">
          <h2 className="h6">Members</h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                {isAdmin && <th scope="col"></th>}
              </tr>
            </thead>
            <tbody>
              {activeMembers.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-muted">
                    No members yet.
                  </td>
                </tr>
              )}
              {activeMembers.map((member) => (
                <tr key={member.id}>
                  <td>{userName(member.userId)}</td>
                  <td style={{ maxWidth: 160 }}>
                    {isAdmin ? (
                      <>
                        <label htmlFor={`role-${member.userId}`} className="visually-hidden">
                          Role for {userName(member.userId)}
                        </label>
                        <select
                          id={`role-${member.userId}`}
                          className="form-select form-select-sm"
                          value={member.role}
                          disabled={busyUserId === member.userId}
                          onChange={(e) => void handleRoleChange(member.userId, e.target.value as TeamRole)}
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      member.role
                    )}
                  </td>
                  {isAdmin && (
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        disabled={busyUserId === member.userId}
                        onClick={() => void handleRemove(member.userId)}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {isAdmin && (
            <div className="row g-2 align-items-end mt-2">
              <div className="col-sm-5">
                <label htmlFor="add-member-user" className="form-label">
                  Add member
                </label>
                <select
                  id="add-member-user"
                  className="form-select"
                  value={selectedNewMember}
                  onChange={(e) => setSelectedNewMember(e.target.value)}
                >
                  <option value="">Select a user…</option>
                  {availableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-sm-3">
                <label htmlFor="add-member-role" className="form-label">
                  Role
                </label>
                <select
                  id="add-member-role"
                  className="form-select"
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value as TeamRole)}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-sm-2">
                <button
                  type="button"
                  className="btn btn-primary w-100"
                  disabled={!selectedNewMember || busyUserId === selectedNewMember}
                  onClick={() => void handleAddMember()}
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
