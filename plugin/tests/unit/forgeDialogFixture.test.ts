import { expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Modal } from 'obsidian'
import { dialogNames, openDialog } from '@/testing/openDialog'
import { useVault } from '../helpers/testEnv'
import { settingsLabel } from '@/i18n/settingsLabels'
import { initializeLocale } from '@/i18n'
import { catalogs } from '@/i18n/catalogs'

it.each([
  ['en', 'Git hosting', 'Git connections'],
  ['ru', 'Git-хостинг', 'Подключения Git'],
  ['lv', 'Git hostings', 'Git savienojumi'],
  ['es', 'Alojamiento de Git', 'Conexiones Git'],
  ['de', 'Git-Hosting', 'Git-Verbindungen'],
] as const)(
  'uses neutral labels for legacy shared metadata in %s',
  (locale, hosting, connections) => {
    try {
      initializeLocale(locale, catalogs[locale])
      expect(settingsLabel('GitHub')).toBe(hosting)
      expect(settingsLabel('GitHub connections')).toBe(connections)
    } finally {
      initializeLocale('en')
    }
  }
)

it('titles the shared connection page with its provider-neutral settings label', async () => {
  useVault([])
  const opened: Modal[] = []
  const original = Modal.prototype.open
  const spy = vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
    opened.push(this)
    original.call(this)
  })
  try {
    openDialog('github-connections')
    await flushPromises()
    expect(opened[0]?.titleText).toBe('Git hosting')
  } finally {
    opened[0]?.close()
    await flushPromises()
    spy.mockRestore()
  }
})

it('opens the real native PR dialog for phone and desktop probes without a provider write', async () => {
  useVault([])
  expect(dialogNames()).toContain('native-pr-create')
  const opened: Modal[] = []
  const open = Modal.prototype.open
  const spy = vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
    opened.push(this)
    open.call(this)
  })
  try {
    openDialog('native-pr-create')
    await flushPromises()
    expect(opened[0]?.contentEl.textContent).toContain('Draft creation is not available')
    expect(opened[0]?.contentEl.querySelector('[aria-label="Open as a draft"]')).toBeNull()
  } finally {
    opened[0]?.close()
    await flushPromises()
    spy.mockRestore()
  }
})
