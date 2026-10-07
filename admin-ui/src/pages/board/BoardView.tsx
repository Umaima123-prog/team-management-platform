import { useState } from 'react'
import { useCurrentUser } from '../../context/CurrentUserContext'
import { useAsync } from '../../hooks/useAsync'
import { getTeam, listUsers } from '../../api/endpoints'
import type { ListItemsFilters } from '../../api/endpoints'
import type { Project, WorkItem } from '../../api/types'
import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingSpinner } from '../../components/common/LoadingSpinner'
import { BoardFilters } from './BoardFilters'
import { Column } from './Column'
import { useBoardItems } from './useBoardItems'
import { ItemDrawer } from '../ItemDrawer'
import { CreateItemForm } from './CreateItemForm'

export function BoardView({ project }: { project: Project }): React.ReactElement {
  const { currentUser } = useCurrentUser()
  const userId = currentUser?.id ?? ''
  const [filters, setFilters] = useState<ListItemsFilters>({})
  const [openItemId, setOpenItemId] = useState<string | null>(null)

  const { board, items, loading, error, reload, pendingItemIds, moveItem } = useBoardItems(
    userId,
    project.id,
    filters,
  )
  const { data: team } = useAsync((signal) => getTeam({ userId, signal }, project.teamId), [
    userId,
    project.teamId,
  ])
  const { data: usersPage } = useAsync((signal) => listUsers({ userId, signal }), [userId])

  const teamMembers = team?.members.filter((m) => !m.removedAt) ?? []
  const users = usersPage?.items ?? []
  const openItem = items.find((i) => i.id === openItemId) ?? null

  if (loading) return <LoadingSpinner label="Loading board…" />
  if (error) return <ErrorAlert error={error} onRetry={reload} />
  if (!board) return <></>

  const sortedColumns = [...board.columns].sort((a, b) => a.order - b.order)

  return (
    <div>
      <BoardFilters filters={filters} onChange={setFilters} teamMembers={teamMembers} users={users} />

      <CreateItemForm
        userId={userId}
        projectId={project.id}
        teamMembers={teamMembers}
        users={users}
        onCreated={reload}
      />

      <div className="board-columns" role="list" aria-label="Kanban board columns">
        {sortedColumns.map((column) => (
          <div key={column.id} role="listitem">
            <Column
              column={column}
              allColumns={sortedColumns}
              items={items
                .filter((i) => i.columnId === column.id)
                .sort((a, b) => a.rank - b.rank)}
              pendingItemIds={pendingItemIds}
              onOpenItem={(item: WorkItem) => setOpenItemId(item.id)}
              onMove={(itemId, targetColumnId, beforeItemId) =>
                void moveItem({ itemId, targetColumnId, beforeItemId })
              }
            />
          </div>
        ))}
      </div>

      {openItem && (
        <ItemDrawer
          item={openItem}
          teamMembers={teamMembers}
          users={users}
          onClose={() => setOpenItemId(null)}
          onUpdated={() => {
            reload()
          }}
        />
      )}
    </div>
  )
}
