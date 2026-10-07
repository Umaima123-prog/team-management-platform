import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { Shell } from './Shell'
import { CurrentUserProvider } from '../../context/CurrentUserContext'
import { ToastProvider } from '../../context/ToastContext'
import { installMockFetch } from '../../test/mockApi'
import { ALICE, ALL_USERS } from '../../test/fixtures'

/**
 * jsdom does not evaluate @media queries or compute real layout, so
 * these tests cover the behavioral contract the mobile CSS in
 * styles/app.css depends on (the `mobile-open` class toggling, the
 * backdrop's visibility class/tabIndex, auto-close on navigation) -
 * not the visual result itself. The visual fix at <768px (reported in
 * Phase 6 manual verification) still needs a real browser to confirm
 * - see docs/TIMELOG.md.
 */
function renderShell(initialPath = '/') {
  window.localStorage.setItem('admin-ui.currentUserId', ALICE.id)
  installMockFetch([{ path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) }])
  return render(
    <CurrentUserProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Shell>
            <Routes>
              <Route path="/" element={<div>Dashboard content</div>} />
              <Route path="/teams" element={<div>Teams content</div>} />
            </Routes>
          </Shell>
        </MemoryRouter>
      </ToastProvider>
    </CurrentUserProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('Shell mobile sidebar behavior', () => {
  it('starts closed, opens via the hamburger button, and reflects that in aria-expanded', async () => {
    renderShell()
    await screen.findByText('Dashboard content')

    const nav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(nav.className).not.toContain('mobile-open')

    const hamburger = screen.getByRole('button', { name: 'Toggle navigation menu' })
    expect(hamburger).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(hamburger)

    expect(nav.className).toContain('mobile-open')
    expect(hamburger).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes when the backdrop is clicked, and the backdrop is not tab-focusable while hidden', async () => {
    renderShell()
    await screen.findByText('Dashboard content')

    const backdrop = screen.getByRole('button', { name: 'Close navigation menu' })
    expect(backdrop).toHaveAttribute('tabindex', '-1')

    await userEvent.click(screen.getByRole('button', { name: 'Toggle navigation menu' }))
    expect(backdrop.className).toContain('visible')
    expect(backdrop).toHaveAttribute('tabindex', '0')

    await userEvent.click(backdrop)

    const nav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(nav.className).not.toContain('mobile-open')
    expect(backdrop.className).not.toContain('visible')
  })

  it('closes automatically when a nav link is clicked, after navigating', async () => {
    renderShell()
    await screen.findByText('Dashboard content')

    await userEvent.click(screen.getByRole('button', { name: 'Toggle navigation menu' }))
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(nav.className).toContain('mobile-open')

    await userEvent.click(screen.getByRole('link', { name: 'Teams' }))

    expect(await screen.findByText('Teams content')).toBeInTheDocument()
    expect(nav.className).not.toContain('mobile-open')
  })
})
