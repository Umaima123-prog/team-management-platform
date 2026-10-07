import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CurrentUserProvider } from '../context/CurrentUserContext'
import { ToastProvider } from '../context/ToastContext'

export function renderWithProviders(ui: ReactElement, initialPath = '/') {
  return render(
    <CurrentUserProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
      </ToastProvider>
    </CurrentUserProvider>,
  )
}
