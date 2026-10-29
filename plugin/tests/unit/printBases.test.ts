import { expect, it, vi } from 'vitest'
import type { BasesView, QueryController } from 'obsidian'
import { PrintView, printableBasesView, renderPrintBases } from '@/bases/PrintView'

it('does not recreate a chart when export is unloaded during its query', async () => {
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  const host = root.appendChild(document.createElement('div'))
  const update = vi.fn()
  let dispose = () => {}
  printableBasesView({ type: 'abele-chart', onDataUpdated: update, data: { data: [] }, register: (callback: () => void) => { dispose = callback } } as unknown as BasesView, host)
  const rendering = renderPrintBases(root)
  await Promise.resolve()
  dispose()
  await rendering
  expect(update).not.toHaveBeenCalled()
  root.remove()
})

it('waits for a native embed to construct its view after post-processing returns', async () => {
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  const block = root.appendChild(document.createElement('div'))
  block.className = 'block-language-base'
  let done = false
  const rendering = renderPrintBases(root).then(() => {
    done = true
  })
  await Promise.resolve()
  await Promise.resolve()
  expect(done).toBe(false)
  const host = block.appendChild(document.createElement('div'))
  host.className = 'bases-view'
  host.dataset.viewType = 'abele-calendar'
  let dispose = () => {}
  const view = printableBasesView(
    {
      type: 'abele-calendar',
      onDataUpdated: () => {},
      register: (callback: () => void) => {
        dispose = callback
      },
      config: { getOrder: () => ['file.name'], getDisplayName: (id: string) => id },
      data: { data: [{ getValue: () => 'Sample deferred view' }] },
    } as unknown as BasesView,
    host
  )
  view.onDataUpdated()
  await rendering
  expect(host.textContent).toContain('Sample deferred view')
  dispose()
  root.remove()
})

it('waits for asynchronous query rows before completing the static snapshot', async () => {
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  const host = root.appendChild(document.createElement('div'))
  let dispose = () => {}
  const view = printableBasesView(
    {
      type: 'abele-calendar',
      onDataUpdated: () => {},
      register: (callback: () => void) => {
        dispose = callback
      },
      config: { getOrder: () => ['file.name'], getDisplayName: (id: string) => id },
    } as unknown as BasesView,
    host
  )
  let done = false
  const rendering = renderPrintBases(root).then(() => {
    done = true
  })
  await Promise.resolve()
  expect(done).toBe(false)
  Object.assign(view, { data: { data: [{ getValue: () => 'Sample completed query' }] } })
  view.onDataUpdated()
  await rendering
  expect(host.querySelector('tbody')?.textContent).toContain('Sample completed query')
  dispose()
  root.remove()
})

it('recognizes print mode when a previously detached view receives its query rows', () => {
  const host = document.createElement('div')
  const ordinaryUpdate = vi.fn()
  const view = printableBasesView(
    {
      type: 'abele-calendar',
      onDataUpdated: ordinaryUpdate,
      register: () => {},
      config: { getOrder: () => ['file.name'], getDisplayName: (id: string) => id },
      data: { data: [{ getValue: () => 'Sample last record' }] },
    } as unknown as BasesView,
    host
  )
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  root.append(host)
  view.onDataUpdated()
  expect(ordinaryUpdate).not.toHaveBeenCalled()
  expect(host.querySelector('tbody')?.textContent).toContain('Sample last record')
  root.remove()
})

it.each(['abele-calendar', 'abele-timeline', 'abele-find-and-replace'])(
  'prints every %s row without viewport clipping or controls',
  (type) => {
    const host = document.createElement('div')
    const view = new PrintView({} as QueryController, host, type)
    Object.assign(view, {
      config: { getOrder: () => ['file.name', 'note.value'], getDisplayName: (id: string) => id },
      data: {
        data: Array.from({ length: 125 }, (_, i) => ({
          getValue: (id: string) => (id === 'file.name' ? `Sample ${i}` : i),
        })),
      },
    })
    view.onDataUpdated()
    expect(host.querySelectorAll('tbody tr')).toHaveLength(125)
    expect(host.textContent).toContain('Sample 124')
    expect(host.querySelector('button, input')).toBeNull()
  }
)
