import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../context/AuthContext'
import { ToastProvider } from '../context/ToastContext'

export function renderWithProviders(ui: ReactElement, initialPath = '/') {
  return render(
    <AuthProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
      </ToastProvider>
    </AuthProvider>,
  )
}
