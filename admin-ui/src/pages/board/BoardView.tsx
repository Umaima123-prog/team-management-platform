import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
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
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [filters, setFilters] = useState<ListItemsFilters>({})
  const [openItemId, setOpenItemId] = useState<string | null>(null)

  const { board, items, loading, error, reload, pendingItemIds, moveItem } = useBoardItems(
    project.id,
    filters,
  )
  const { data: team } = useAsync((signal) => getTeam({ signal }, project.teamId), [
    project.teamId,
  ])
  const { data: usersPage } = useAsync((signal) => listUsers({ signal }), [])

  const teamMembers = team?.members.filter((m) => !m.removedAt) ?? []
  const users = usersPage?.items ?? []
  const openItem = items.find((i) => i.id === openItemId) ?? null

  // Server-enforced rule (WorkItemsService.assertCanMutateAssignedItem):
  // ADMIN may move any card; EMPLOYEE only one assigned to them.
  const canMoveItem = (item: WorkItem): boolean => isAdmin || item.assigneeId === user?.id

  if (loading) return <LoadingSpinner label="Loading board…" />
  if (error) return <ErrorAlert error={error} onRetry={reload} />
  if (!board) return <></>

  const sortedColumns = [...board.columns].sort((a, b) => a.order - b.order)

  return (
    <div>
      <BoardFilters filters={filters} onChange={setFilters} teamMembers={teamMembers} users={users} />

      {isAdmin && (
        <CreateItemForm
          projectId={project.id}
          teamMembers={teamMembers}
          users={users}
          onCreated={reload}
        />
      )}

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
              canMoveItem={canMoveItem}
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
