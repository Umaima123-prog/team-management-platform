import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import { getProject } from '../api/endpoints'
import { ErrorAlert } from '../components/common/ErrorAlert'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { BoardView } from './board/BoardView'
import { ActivityPanel } from './ActivityPanel'
import { InsightsPanel } from './InsightsPanel'

type Tab = 'board' | 'activity' | 'insights'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'board', label: 'Board' },
  { id: 'activity', label: 'Activity' },
  { id: 'insights', label: 'Insights' },
]

export function ProjectDetailPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>()
  const [tab, setTab] = useState<Tab>('board')

  const { data: project, loading, error, reload } = useAsync(
    (signal) => getProject({ signal }, projectId!),
    [projectId],
  )

  if (loading) return <LoadingSpinner label="Loading project…" />
  if (error) return <ErrorAlert error={error} onRetry={reload} />
  if (!project) return <></>

  return (
    <div>
      <h1 className="h3">
        {project.name} <span className="text-muted small">({project.projectKey})</span>
      </h1>

      <div role="tablist" aria-label="Project sections" className="nav nav-tabs mb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className={`nav-link${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'board' && <BoardView project={project} />}
        {tab === 'activity' && <ActivityPanel projectId={project.id} />}
        {tab === 'insights' && <InsightsPanel projectId={project.id} />}
      </div>
    </div>
  )
}
