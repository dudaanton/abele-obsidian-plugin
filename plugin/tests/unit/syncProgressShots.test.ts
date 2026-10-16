import { expect, it, vi } from 'vitest'
import {
  collectSyncProgressShots,
  syncProgressShots,
  syncProgressShotsPrelude,
} from '../e2e/helpers/syncProgressShots'
import type { SyncDriver } from '../e2e/helpers/syncDriver'

it('uses the current phone document through the actual serialized prelude', async () => {
  let current = document.implementation.createHTMLDocument()
  const shot = vi.fn(async (path: string) => path)
  const window = { __e2eHost: { shot } } as unknown as {
    __syncProgressShots: ReturnType<typeof syncProgressShots>
  }
  new Function(
    'window',
    'document',
    'settingsDoc',
    syncProgressShotsPrelude('/sample-shots', true)
  )(window, document, () => current)
  current = document.implementation.createHTMLDocument()
  const root = current.createElement('div')
  root.className = 'abele-sync-window'
  current.body.append(root)
  window.__syncProgressShots.sample([
    { value: 2, total: 300, text: 'Downloading · 2 of 300 files · 8 KB transferred' },
  ])
  expect(shot).toHaveBeenCalledExactlyOnceWith('/sample-shots/phone-downloading-window.png')
  expect((await window.__syncProgressShots.finish()).missing).toEqual([])
})

it('logs missing artifacts loudly without throwing or changing product assertions', async () => {
  const report = await syncProgressShots([], async () => 'unused.png').finish()
  const sync = { long: vi.fn().mockResolvedValue(report) } as unknown as SyncDriver
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    expect(await collectSyncProgressShots(sync)).toEqual([])
    expect(error).toHaveBeenCalledWith(
      '[sync progress screenshots MISSING]',
      expect.stringContaining('preparing-folders')
    )
    vi.mocked(sync.long).mockRejectedValueOnce(new Error('observer unavailable'))
    expect(await collectSyncProgressShots(sync)).toEqual([])
    expect(error).toHaveBeenLastCalledWith(
      '[sync progress screenshots MISSING]',
      'observer unavailable'
    )
  } finally {
    error.mockRestore()
    log.mockRestore()
  }
})

it('resolves the settings document at sample time after settings moves to another renderer', async () => {
  const first = document.implementation.createHTMLDocument()
  const second = document.implementation.createHTMLDocument()
  const root = second.createElement('div')
  root.className = 'abele-sync-window'
  second.body.append(root)
  let current = first
  const capture = vi.fn(async () => 'preparing-folders.png')
  const observer = syncProgressShots(() => [current], capture)
  current = second
  observer.sample([{ value: 0, total: 60, text: 'Preparing folders · 0 of 60 folders' }])
  expect(capture).toHaveBeenCalledExactlyOnceWith('preparing-folders', second)
  const report = await observer.finish()
  expect(report.missing).toEqual(['downloading-window', 'downloading-status-bar'])
})

it('captures the first matching visible states once without awaiting screenshots in the sampler', async () => {
  const observe = new Function(
    'return (' + syncProgressShots.toString() + ')'
  )() as typeof syncProgressShots
  const doc = document.implementation.createHTMLDocument()
  const root = doc.createElement('div')
  root.className = 'abele-sync-window'
  doc.body.append(root)
  const status = doc.createElement('span')
  status.className = 'abele-sync-status-text'
  status.textContent = 'Downloading · 2 of 300 files'
  status.getBoundingClientRect = () => ({ width: 120, height: 20 }) as DOMRect
  doc.body.append(status)
  const capture = vi.fn(async (label: string) => label + '.png')
  const observer = observe([doc], capture)
  const sample = (text: string) => [{ label: '2 of 300', value: 2, total: 300, text }]
  observer.sample(sample('Downloading · 2 of 300 files'))
  expect(capture).not.toHaveBeenCalled()
  observer.sample([
    { label: '0 of 60', value: 0, total: 60, text: 'Preparing folders · 0 of 60 folders' },
  ])
  observer.sample(sample('Preparing folders · 3 of 60 folders'))
  observer.sample(sample('Downloading · 2 of 300 files · 8 of 1200 KB · about 1 min left'))
  observer.sample(sample('Downloading · 3 of 300 files · 12 of 1200 KB · about 1 min left'))
  expect(capture.mock.calls.map((call) => call[0])).toEqual([
    'preparing-folders',
    'downloading-window',
    'downloading-status-bar',
  ])
  expect(await Promise.all(observer.pending)).toHaveLength(3)
})

it('captures phone progress without waiting for an ETA and reports capture errors', async () => {
  const doc = document.implementation.createHTMLDocument()
  const root = doc.createElement('div')
  root.className = 'abele-sync-window'
  doc.body.append(root)
  const capture = vi.fn(async () => {
    throw new Error('no picture')
  })
  const observer = syncProgressShots([doc], capture, true)
  observer.sample([
    {
      label: '2 of 300',
      value: 2,
      total: 300,
      text: 'Downloading · 2 of 300 files · 8 KB transferred',
    },
  ])
  expect(await Promise.all(observer.pending)).toEqual([
    { label: 'phone-downloading-window', error: 'no picture' },
  ])
})
