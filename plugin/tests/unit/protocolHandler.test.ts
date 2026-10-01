import { beforeEach, expect, it, vi } from 'vitest'
import { handleProtocolAction } from '@/helpers/protocolHandler'
import { configureAbele, dailyJournal, useVault } from '../helpers/testEnv'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { FakeApp } from '../helpers/fakeVault'

let app: FakeApp
beforeEach(() => {
  app = useVault([
    { path: 'sample-note.md', content: 'before' },
    { path: 'Scripts/sample-note.md', content: 'before' },
    { path: 'Scripts/sample.js', content: 'before' },
    { path: '.obsidian/sample.md', content: 'before' },
    { path: 'Service/sample.md', content: 'before' },
  ])
  configureAbele({ journals: [dailyJournal()] })
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, scriptsFolder: 'Scripts' }
  Object.assign(app.vault, { configDir: 'Service' })
})

it('writes nothing until the preview of the path and content is confirmed', async () => {
  const modify = vi.spyOn(app.vault, 'modify')
  const confirm = vi.fn(async () => false)
  await handleProtocolAction(app as never, { path: 'sample-note', data: '<b>sample</b>' }, confirm)
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'sample-note.md',
      content: 'before\n<b>sample</b>',
      mode: 'append',
    })
  )
  expect(modify).not.toHaveBeenCalled()
})

it.each([
  'Scripts/sample-note.md',
  'Scripts/sample.js',
  '.obsidian/sample.md',
  'Service/sample.md',
  'Notes/../sample-note.md',
  'Scripts\\sample-note.md',
  '/sample-note.md',
])('refuses non-note and service paths: %s', async (path) => {
  const confirm = vi.fn(async () => true)
  const modify = vi.spyOn(app.vault, 'modify')
  await handleProtocolAction(app as never, { path, data: 'after', mode: 'replace' }, confirm)
  expect(confirm).not.toHaveBeenCalled()
  expect(modify).not.toHaveBeenCalled()
})

it('shows replacement contents and writes on explicit acceptance', async () => {
  const confirm = vi.fn(async () => true)
  await handleProtocolAction(
    app as never,
    { path: 'sample-note.md', data: 'after', mode: 'replace' },
    confirm
  )
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ current: 'before', content: 'after', mode: 'replace' })
  )
  expect(await app.vault.read(app.vault.getFileByPath('sample-note.md')!)).toBe('after')
})

it('does not create a daily note when the confirmation is cancelled', async () => {
  const create = vi.spyOn(app.vault, 'create')
  const confirm = vi.fn(async () => false)
  await handleProtocolAction(app as never, { daily: '', journal: 'Daily', data: 'sample' }, confirm)
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ creates: true }))
  expect(create).not.toHaveBeenCalled()
})

it('does not replace changes made while the confirmation was open', async () => {
  await handleProtocolAction(
    app as never,
    { path: 'sample-note.md', data: 'after', mode: 'replace' },
    async () => {
      await app.vault.modify(app.vault.getFileByPath('sample-note.md')!, 'edited elsewhere')
      return true
    }
  )
  expect(await app.vault.read(app.vault.getFileByPath('sample-note.md')!)).toBe('edited elsewhere')
})
