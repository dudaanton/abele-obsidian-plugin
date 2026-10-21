/**
 * Deleting one connection's files from the server: the question names the server, how much goes
 * and whose access closes; it reports done only when the server agreed, and uncertainty
 * offers retry. (Was the per-folder picker's test; the action moved to the connection.)
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import { AbeleError } from '@abele/sync-sdk/protocol'
import { flushPromises, mount } from '@vue/test-utils'
import ServerDeleteModal from '@/components/sync/ServerDeleteModal.vue'
import type { ServerDeleteFacts } from '@/components/sync/serverDelete'
import SyncSettings from '@/components/settings/SyncSettings.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Button from '@/components/obsidian/Button.vue'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import { Menu } from '../mocks/obsidian'
import { Modal as NativeModal } from 'obsidian'
import * as nativeUi from 'obsidian'

const facts: ServerDeleteFacts = {
  files: 12,
  bytes: 3 * 1024 * 1024,
  canWrite: true,
  access: [{ label: 'Sample tablet', scope: 'Folder: Sample folder' }],
}
const press = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!
const open = (remove: () => Promise<void>) =>
  mount(ServerDeleteModal, {
    props: { name: '“Sample folder”', host: 'sync.example', facts, remove },
    attachTo: document.body,
  })

describe('ServerDeleteModal', () => {
  it('keeps the read-only menu action disabled and binds the reason as an Obsidian tooltip', async () => {
    const ui = tokenUiFixture()
    vi.spyOn(ui, 'serverDeleteFacts').mockResolvedValue({ ...facts, canWrite: false })
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent'),
      tooltip = vi.spyOn(nativeUi, 'setTooltip')
    const original = Menu.prototype.addItem
    const items = vi.spyOn(Menu.prototype, 'addItem').mockImplementation(function (build) {
      return original.call(this, (item) => {
        Object.assign(item, { dom: document.createElement('div') })
        build(item)
      })
    })
    const view = mount(SyncSettings, { props: { model: ui } })
    try {
      await view
        .findAllComponents(Icon)
        .find((one) => one.props('icon') === 'more-horizontal')!
        .trigger('click')
      await flushPromises()
      const item = show.mock.instances.at(-1)!.items.at(-1)!
      expect(item.title).toBe('Delete from the server: read only')
      expect(item.disabled).toBe(true)
      expect(tooltip).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        'This key can only read. Only someone who can change these files can delete them.'
      )
      item.handler!()
      await flushPromises()
      expect(view.findComponent(ServerDeleteModal).exists()).toBe(false)
    } finally {
      view.unmount()
      show.mockRestore()
      tooltip.mockRestore()
      items.mockRestore()
    }
  })
  it('refuses native dismissal while the confirmed deletion is running', async () => {
    let finish!: () => void
    const opened = vi.spyOn(NativeModal.prototype, 'open')
    const view = open(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    try {
      const native = opened.mock.contexts.at(-1)!
      press('Delete from the server').click()
      await flushPromises()
      native.close()
      await flushPromises()
      expect(native.isOpen).toBe(true)
      expect(view.emitted('close')).toBeUndefined()
      finish()
      await flushPromises()
    } finally {
      view.unmount()
      opened.mockRestore()
    }
  })
  it('opens the menu while facts wait and deletes only after confirming its last action', async () => {
    const ui = tokenUiFixture(),
      id = ui.rows.value[0].id
    let finish!: (value: ServerDeleteFacts) => void
    vi.spyOn(ui, 'serverDeleteFacts').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const remove = vi.spyOn(ui, 'deleteFromServer').mockResolvedValue()
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const view = mount(SyncSettings, {
      props: { model: ui },
      global: {
        stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } },
      },
    })
    try {
      await view
        .findAllComponents(Icon)
        .find((one) => one.props('icon') === 'more-horizontal')!
        .trigger('click')
      const menu = show.mock.instances.at(-1)!
      expect(menu.items.at(-2)?.title).toBe('Disconnect…')
      expect(menu.items.at(-1)?.disabled).toBe(true)
      finish(facts)
      await flushPromises()
      expect(menu.items.at(-1)?.title).toBe('Delete from the server…')
      expect(menu.items.at(-1)?.disabled).toBe(false)
      menu.items.at(-1)!.handler!()
      await flushPromises()
      expect(remove).not.toHaveBeenCalled()
      expect(view.findComponent(ServerDeleteModal).exists()).toBe(true)
      await view
        .findAllComponents(Button)
        .find((one) => one.props('text') === 'Delete from the server')!
        .trigger('click')
      await flushPromises()
      expect(remove).toHaveBeenCalledExactlyOnceWith(id)
    } finally {
      view.unmount()
      show.mockRestore()
    }
  })
  it('keeps a busy request open and does not send a second request', async () => {
    let finish!: () => void
    const remove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const view = open(remove)
    press('Delete from the server').click()
    await flushPromises()
    expect(press('Deleting…').disabled).toBe(true)
    press('Cancel').click()
    expect(view.emitted('close')).toBeUndefined()
    finish()
    await flushPromises()
    expect(view.emitted('done')).toHaveLength(1)
    view.unmount()
  })

  it('does not delete through a read-only confirmation', async () => {
    const remove = vi.fn(async () => {})
    const view = open(remove)
    await view.setProps({ facts: { ...facts, canWrite: false } })
    expect(press('Delete from the server').disabled).toBe(true)
    press('Delete from the server').click()
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
    view.unmount()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('names the server, the files, their size and the access that closes, then deletes', async () => {
    const remove = vi.fn(async () => {})
    const view = open(remove)
    const text = document.body.textContent ?? ''
    expect(text).toContain('sync.example')
    expect(text).toContain('Files12')
    expect(text).toContain('3.0 MB')
    expect(text).toContain('Sample tablet')
    expect(text).toContain('30 days')
    press('Delete from the server').click()
    await flushPromises()
    expect(remove).toHaveBeenCalledOnce()
    expect(view.emitted('done')).toHaveLength(1)
    view.unmount()
  })

  it('explains that deletion is unconfirmed and offers to recover the result', async () => {
    const view = open(async () => Promise.reject(new Error('Not reachable')))
    press('Delete from the server').click()
    await flushPromises()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'No answer from sync.example. It may already be deleted: Try again to find out.'
    )
    expect(press('Try again')).toBeTruthy()
    expect(view.emitted('done')).toBeUndefined()
    view.unmount()
  })
  it('distinguishes this kept copy from deletion on other connected devices', async () => {
    const view = open(async () => {})
    try {
      await flushPromises()
      expect(document.querySelector('.abele-server-delete__note')?.textContent).toContain(
        'This device keeps every file.'
      )
      expect(document.querySelector('.abele-server-delete__note')?.textContent).toContain(
        'Your other connected devices remove theirs; the server keeps them in trash for 30 days.'
      )
    } finally {
      view.unmount()
    }
  })
  it('explains a typed forbidden confirmation without exposing server text', async () => {
    const view = open(async () => {
      throw new AbeleError('forbidden', 'untrusted response detail')
    })
    try {
      press('Delete from the server').click()
      await flushPromises()
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        'This connection does not allow that action.'
      )
      expect(view.text()).not.toContain('untrusted response detail')
      expect(view.emitted('done')).toBeUndefined()
    } finally {
      view.unmount()
    }
  })
  it('names a known failure without exposing transport code and keeps retry warning-coloured', async () => {
    const view = open(async () => {
      throw Object.assign(new Error('private transport detail'), { deletionOutcome: 'not-deleted' })
    })
    press('Delete from the server').click()
    await flushPromises()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Nothing was deleted: sync.example did not answer.'
    )
    expect(
      view
        .findAllComponents(Button)
        .find((one) => one.props('text') === 'Try again')
        ?.props('warning')
    ).toBe(true)
    view.unmount()
  })
})
