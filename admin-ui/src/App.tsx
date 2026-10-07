import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { CurrentUserProvider } from './context/CurrentUserContext'
import { ToastProvider } from './context/ToastContext'
import { SignInGate } from './components/common/SignInGate'
import { Shell } from './components/layout/Shell'
import { DashboardPage } from './pages/DashboardPage'
import { TeamsPage } from './pages/TeamsPage'
import { TeamDetailPage } from './pages/TeamDetailPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'

function App(): React.ReactElement {
  return (
    <CurrentUserProvider>
      <ToastProvider>
        <SignInGate>
          <BrowserRouter>
            <Shell>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/teams" element={<TeamsPage />} />
                <Route path="/teams/:teamId" element={<TeamDetailPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Shell>
          </BrowserRouter>
        </SignInGate>
      </ToastProvider>
    </CurrentUserProvider>
  )
}

export default App
