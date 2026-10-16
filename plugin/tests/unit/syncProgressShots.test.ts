import { expect, it, vi } from 'vitest'
import { syncProgressShots } from '../e2e/helpers/syncProgressShots'

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
