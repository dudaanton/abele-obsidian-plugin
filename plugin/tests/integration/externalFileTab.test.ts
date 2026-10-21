import { expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ExternalFileTab } from '@/sync/external/ExternalFileTab'
import { externalActionsOf } from '@/sync/external/actionHost'
import { externalFileFixture } from './externalFileFollowupFixture'
import * as kit from '@/components/obsidian/mount'

it('does not open a hydrated file merely because its card is restored or refreshed', async () => {
  const s = await externalFileFixture('Media/sample-document.bin')
  const openFile = vi.fn(async () => {})
  const tab = new ExternalFileTab({ openFile } as never)
  Object.assign(tab, { app: s.app })
  Object.defineProperty(tab, 'contentEl', { value: document.createElement('div') })
  try {
    await tab.setState({ path: s.path }, {} as never)
    await flushPromises()
    expect(openFile).not.toHaveBeenCalled()
  } finally {
    await tab.onClose()
    tab.unload()
    s.close()
  }
})

it('fully unmounts its kit and stops presentation updates when the card closes', async () => {
  const s = await externalFileFixture()
  const mount = vi.spyOn(kit, 'mountKit')
  const tab = new ExternalFileTab({ openFile: vi.fn() } as never)
  Object.assign(tab, { app: s.app })
  const content = document.createElement('div')
  Object.defineProperty(tab, 'contentEl', { value: content })
  try {
    await s.port.evict(s.path)
    await tab.setState({ path: s.path }, {} as never)
    await flushPromises()
    expect(content.querySelector('.abele-external-view')).not.toBeNull()
    const unmount = vi.spyOn(mount.mock.results.at(-1)!.value.app, 'unmount')
    await tab.onClose()
    await tab.onClose()
    expect(unmount).toHaveBeenCalledOnce()
    expect(content.children).toHaveLength(0)
    const describe = vi.spyOn(s.manager, 'describe')
    s.manager.progress(s.path, { done: 1, total: s.bytes.length })
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(describe).not.toHaveBeenCalled()
    expect(content.children).toHaveLength(0)
  } finally {
    await tab.onClose()
    tab.unload()
    mount.mockRestore()
    s.close()
  }
})

it('does not reopen an unowned stub recursively through its registered extension', async () => {
  const s = await externalFileFixture()
  const openFile = vi.fn(async () => {})
  const tab = new ExternalFileTab({ openFile } as never)
  try {
    await s.app.vault.create('Media/unowned.abele-ref', 'ordinary unknown data')
    Object.assign(tab, { app: s.app })
    const content = document.createElement('div')
    Object.defineProperty(tab, 'contentEl', { value: content })
    await tab.setState({ file: 'Media/unowned.abele-ref' }, {} as never)
    await flushPromises()
    expect(openFile).not.toHaveBeenCalled()
    expect(content.textContent).toContain('not owned by a current connection')
  } finally {
    await tab.onClose()
    tab.unload()
    s.close()
  }
})

it('keeps through the shared action and switches the same tab to the original with its position', async () => {
  const s = await externalFileFixture('Books/sample.epub')
  let tab: ExternalFileTab | undefined
  try {
    await s.port.evict(s.path)
    const openFile = vi.fn(async () => {})
    const pin = vi.fn(async (path: string, pinned: boolean) => {
      await s.port.setPinned(path, pinned)
    })
    externalActionsOf.set(s.app.vault, { pin } as never)
    tab = new ExternalFileTab({ openFile } as never)
    Object.assign(tab, { app: s.app })
    const content = document.createElement('div')
    Object.defineProperty(tab, 'contentEl', { value: content })
    await tab.setState({ path: s.path, subpath: '#page=4' }, {} as never)
    await flushPromises()
    expect(content.textContent).toContain('sample.epub')
    const keep = [...content.querySelectorAll('button')].find(
      (button) => button.textContent === 'Keep on this device'
    )!
    keep.click()
    await vi.waitFor(() => expect(openFile).toHaveBeenCalled())
    expect(pin).toHaveBeenCalledWith(s.path, true)
    expect(openFile.mock.calls[0]).toEqual([
      s.app.vault.getFileByPath(s.path),
      { eState: { subpath: '#page=4' } },
    ])
    expect((await s.port.inspect(s.path)).pinned).toBe(true)
  } finally {
    await tab?.onClose()
    tab?.unload()
    s.close()
  }
})
