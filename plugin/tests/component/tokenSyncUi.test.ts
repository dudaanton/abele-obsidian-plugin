import { expect, it, vi } from 'vitest'
import type { Plugin } from 'obsidian'
import { renderStatus } from '@/sync/status'
import { tokenStatus } from '@/sync/tokenStatus'
import { mountPhoneSyncAction } from '@/sync/phoneSyncAction'
import { mount, flushPromises } from '@vue/test-utils'
import TokenDialogs from '@/components/sync/TokenDialogs.vue'
import { TokenUi, SCOPE_DELETED } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import Button from '@/components/obsidian/Button.vue'
import Modal from '@/components/obsidian/Modal.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import TokenQrReader from '@/components/sync/TokenQrReader.vue'
import { tokenUiFixture, sampleIssuedToken } from '@/testing/tokenUiFixture'
import SyncSettings from '@/components/settings/SyncSettings.vue'
import { MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { Menu, Notice } from '../mocks/obsidian'
import { SyncDriver } from '../e2e/helpers/syncDriver'
vi.mock('../e2e/helpers/syncVault', () => ({ waitFor: vi.fn() }))

it('accepts approval before runtime registration and shows progress and errors beside the buttons', async () => {
  const ui = tokenUiFixture(),
    candidate = ui.candidates.value[0]
  ui.runtimes.clear()
  let fail!: (error: Error) => void
  const approve = vi.spyOn(ui, 'approve').mockImplementation(
    () =>
      new Promise((_, reject) => {
        fail = reject
      })
  )
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'review', candidate },
    global: {
      stubs: {
        Modal: {
          template:
            '<main><article><slot /></article><footer><slot name="footer" /></footer></main>',
        },
      },
    },
  })
  const button = view.findAllComponents(Button).find((one) => one.props('text') === 'Approve')!
  expect(button.props('disabled')).toBe(false)
  await button.trigger('click')
  expect(approve).toHaveBeenCalledExactlyOnceWith(candidate, { background: true })
  expect(button.props('text')).toBe('Approving…')
  fail(Object.assign(new Error('Sample approval could not be saved'), { code: 'startup-stage' }))
  await flushPromises()
  expect(view.get('[role=alert]').element.parentElement).toBe(button.element.parentElement)
  expect(view.get('[role=alert]').text()).toContain('Sample approval could not be saved')
  view.unmount()
})

it('keeps the red status and disconnect menu but hides sync now for a server-deleted connection', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  ui.registry.storage(id).saveLocalStorage('abele-sync-token-state:scope-deleted', true)
  ui.registry.setStatus(id, 'scope_unavailable')
  ui.publish(id, { error: SCOPE_DELETED })
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const view = mount(SyncSettings, { props: { model: ui } })
  try {
    const row = view.findAll('.abele-sync-row')[0]
    expect(row.findAllComponents(Icon).map((one) => one.props('icon'))).not.toContain('refresh-cw')
    expect(row.text()).toContain('Deleted on the server')
    expect(row.find('.abele-status-dot_red').exists()).toBe(true)
    await row
      .findAllComponents(Icon)
      .find((one) => one.props('icon') === 'more-horizontal')!
      .trigger('click')
    expect(show.mock.instances.at(-1)!.items.some((item) => item.title === 'Disconnect…')).toBe(
      true
    )
  } finally {
    view.unmount()
    show.mockRestore()
  }
})

it.each(['deleted', 'moved'] as const)(
  'offers one root recovery decision after a folder is %s',
  async (kind) => {
    const ui = tokenUiFixture(),
      id = ui.rows.value[0].id
    const restoreRoot = vi.fn(async () => {}),
      followRoot = vi.fn(async () => {})
    ui.registry.setRootIssue(id, kind === 'moved' ? { kind, path: 'Moved' } : { kind })
    ui.publish(id, {})
    ui.runtimes.set(id, { restoreRoot, followRoot } as never)
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const view = mount(SyncSettings, { props: { model: ui } })
    try {
      expect(view.text()).toContain(
        kind === 'moved' ? 'Folder moved to Moved; sync stopped' : 'Folder is gone; sync stopped'
      )
      const icons = view.findAllComponents(Icon)
      expect(icons.find((one) => one.props('icon') === 'refresh-cw')!.props('disabled')).toBe(true)
      await icons.find((one) => one.props('icon') === 'more-horizontal')!.trigger('click')
      const menu = show.mock.instances.at(-1)!
      expect(menu.items.filter((item) => item.title === 'Restore from the server')).toHaveLength(1)
      expect(menu.items.some((item) => item.title === 'Disconnect…')).toBe(true)
      expect(menu.items.some((item) => item.title === 'Resume' || item.title === 'Pause')).toBe(
        false
      )
      if (kind === 'moved') {
        menu.items.find((item) => item.title === 'Follow moved folder')!.handler!()
        await flushPromises()
        expect(followRoot).toHaveBeenCalledOnce()
      }
      menu.items.find((item) => item.title === 'Restore from the server')!.handler!()
      await flushPromises()
      expect(restoreRoot).toHaveBeenCalledOnce()
    } finally {
      view.unmount()
      show.mockRestore()
    }
  }
)

it('renders held-only warnings in the status bar and phone header until resolved', () => {
  const ui = tokenUiFixture()
  const first = ui.rows.value[0]
  for (const row of ui.rows.value) ui.registry.setStatus(row.id, 'idle')
  ui.rows.value = [{ ...first, status: 'idle' }]
  ui.activity.value = { [first.id]: { heldDeletes: 2 } }
  ui.candidates.value = []
  ui.questions.value = []
  const bar = document.createElement('div')
  const header = document.createElement('div')
  const open = vi.fn()
  const view = {
    addAction(icon: string, tooltip: string, action: () => void) {
      const button = document.createElement('button')
      button.dataset.icon = icon
      button.setAttribute('aria-label', tooltip)
      button.onclick = action
      header.append(button)
      return button
    },
  }
  const plugin = {
    app: { workspace: { getLeavesOfType: () => [{ view }], on: vi.fn() } },
    registerEvent: vi.fn(),
    register: vi.fn(),
  }
  const paint = mountPhoneSyncAction(plugin as unknown as Plugin, open)
  const status = tokenStatus(ui)
  renderStatus(bar, status)
  paint(status)
  expect(bar.textContent).toBe('Deletions held (2)')
  expect(bar.classList.contains('abele-sync-status_warning')).toBe(true)
  const action = header.querySelector('button')!
  expect(action.dataset.icon).toBe('cloud-alert')
  expect(action.classList.contains('mod-warning')).toBe(true)
  expect(action.getAttribute('aria-label')).toBe('Sync: deletions are held back')
  action.click()
  expect(open).toHaveBeenCalledOnce()
  ui.publish(first.id, { heldDeletes: 0 })
  paint(tokenStatus(ui))
  expect(header.children).toHaveLength(0)
})

it.each([
  ['Whole vault', 'root'],
  ['Folder: Shared', 'other'],
])('issues a token through the live driver selectors for %s', async (scopeLabel, scopeId) => {
  const ui = shareFixture(),
    id = ui.rows.value[0].id
  const available = await ui.choices(id)
  let releaseChoices!: () => void
  vi.spyOn(ui, 'choices').mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseChoices = () => resolve(available)
      })
  )
  const issue = vi.fn(async () => ({ token: 'sample-access-code' }))
  vi.spyOn(ui, 'client').mockReturnValue({ issue } as never)
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'share', connectionId: id },
    global: { stubs: { Modal: modalStub } },
  })
  await flushPromises()
  const driver = new SyncDriver(() => {
    throw new Error('No live vault expected')
  })
  const long = vi.spyOn(driver, 'long').mockImplementation(async (_label, code) => {
    const poll = async (condition: () => unknown, _timeout: number, label: string) => {
      if (label === 'sharing scopes to load') releaseChoices()
      await flushPromises()
      expect(condition()).toBeTruthy()
    }
    const press = async (root: Element, text: string) => {
      await flushPromises()
      const button = [...root.querySelectorAll('button')].find(
        (one) => one.textContent?.trim() === text
      )!
      expect(button).toBeDefined()
      expect(button.disabled).toBe(false)
      button.click()
      await flushPromises()
    }
    return new Function(
      'openSyncTab',
      'connectionRow',
      'icon',
      'poll',
      'modal',
      'typeInto',
      'press',
      'closeSettings',
      `return (async()=>{${code}})()`
    )(
      async () => view.element,
      (root: Element) => root,
      vi.fn(),
      poll,
      () => view.element,
      (input: HTMLInputElement, text: string) => {
        input.value = text
        input.dispatchEvent(new Event('input', { bubbles: true }))
      },
      press,
      vi.fn()
    )
  })
  try {
    expect(await driver.share(id, scopeLabel, 'Sample recipient')).toBe('sample-access-code')
    expect(issue).toHaveBeenCalledWith({
      scope: { kind: 'folder', id: scopeId },
      label: 'Sample recipient',
    })
  } finally {
    long.mockRestore()
    view.unmount()
  }
})

const modalStub = { template: '<div><slot /><slot name="footer" /></div>' }
it('does not reload the whole manifest when selecting a different sharing scope', async () => {
  const ui = shareFixture()
  const choices = vi.spyOn(ui, 'choices')
  const issue = vi.fn(async () => ({ token: 'sample-access-code' }))
  vi.spyOn(ui, 'client').mockReturnValue({ issue } as never)
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'share', connectionId: ui.rows.value[0].id },
    global: { stubs: { Modal: modalStub } },
  })
  try {
    await flushPromises()
    choices.mockImplementationOnce(() => new Promise(() => {}))
    view.findComponent(Dropdown).vm.$emit('update:model-value', '1')
    await view.find('input').setValue('Sample recipient')
    await flushPromises()
    const create = view
      .findAllComponents(Button)
      .find((one) => one.props('text') === 'Create token')!
    expect(create.props('disabled')).toBe(false)
    expect(choices).toHaveBeenCalledTimes(1)
    await create.trigger('click')
    await flushPromises()
    expect(issue).toHaveBeenCalledWith({
      scope: { kind: 'folder', id: 'other' },
      label: 'Sample recipient',
    })
  } finally {
    view.unmount()
    choices.mockRestore()
  }
})
it('displays the exact path and server-size reason for an oversized unsent file', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  ui.publish(id, {
    pending: 1,
    refused: [
      {
        path: 'Media/oversized.bin',
        reason: 'This file is too large for the server. It stays on this device.',
      },
    ],
  })
  const view = mount(SyncSettings, {
    props: { model: ui },
    global: { stubs: { Modal: modalStub, SelectiveSync: true } },
  })
  await flushPromises()
  await view.find('.abele-sync-row').trigger('click')
  await flushPromises()
  const row = view
    .findAll('.setting-item')
    .find((one) => one.find('.setting-item-name').text() === 'Media/oversized.bin')
  expect(row).toBeDefined()
  expect(row!.find('.setting-item-description').text()).toBe(
    'This file is too large for the server. It stays on this device.'
  )
  view.unmount()
})
function shareFixture() {
  const ui = tokenUiFixture()
  const scope = { kind: 'folder' as const, id: 'root', path: '/' }
  vi.spyOn(ui, 'choices').mockResolvedValue([scope, { ...scope, id: 'other', path: 'Shared' }])
  vi.spyOn(ui, 'issued').mockResolvedValue([
    {
      id: 'issued',
      label: 'Sample',
      scope,
      issued_by_token_id: 'root',
      created_at: '2025-01-01',
      revoked_at: null,
    },
  ])
  return ui
}
it('cancelling a revoke confirmation makes no request', async () => {
  const ui = shareFixture(),
    revoke = vi.fn()
  vi.spyOn(ui, 'client').mockReturnValue({ revoke } as never)
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'share', connectionId: ui.rows.value[0].id },
    global: { stubs: { Modal: modalStub } },
  })
  await flushPromises()
  await view
    .findAllComponents(Icon)
    .find((one) => one.props('icon') === 'ban')!
    .trigger('click')
  await view
    .findAllComponents(Button)
    .find((one) => one.props('text') === 'Keep access')!
    .trigger('click')
  expect(revoke).not.toHaveBeenCalled()
  expect(view.text()).not.toContain('Revoke Sample')
  view.unmount()
})
it('shows token list and revoke errors', async () => {
  const ui = shareFixture()
  const issued = vi.spyOn(ui, 'issued').mockRejectedValueOnce(new Error('List failed'))
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'share', connectionId: ui.rows.value[0].id },
    global: { stubs: { Modal: modalStub } },
  })
  await flushPromises()
  expect(view.get('[role="alert"]').text()).toContain('could not finish')
  view.unmount()
  issued.mockResolvedValue([
    {
      id: 'issued',
      label: 'Sample',
      scope: { kind: 'folder', id: 'root', path: '/' },
      issued_by_token_id: 'root',
      created_at: '2025-01-01',
      revoked_at: null,
    },
  ])
  vi.spyOn(ui, 'client').mockReturnValue({
    revoke: async () => {
      throw new Error('Revoke failed')
    },
  } as never)
  const next = mount(TokenDialogs, {
    props: { ui, mode: 'share', connectionId: ui.rows.value[0].id },
    global: { stubs: { Modal: modalStub } },
  })
  await flushPromises()
  await next
    .findAllComponents(Icon)
    .find((one) => one.props('icon') === 'ban')!
    .trigger('click')
  await next
    .findAllComponents(Button)
    .find((one) => one.props('text') === 'Revoke')!
    .trigger('click')
  await flushPromises()
  expect(next.get('[role="alert"]').text()).toContain('could not finish')
  next.unmount()
})
it.each(['close', 'scope', 'connection'] as const)(
  'discards a late issued token after %s',
  async (change) => {
    const ui = shareFixture()
    let answer!: (value: { token: string }) => void
    vi.spyOn(ui, 'client').mockReturnValue({
      issue: () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    } as never)
    const view = mount(TokenDialogs, {
      props: { ui, mode: 'share', connectionId: ui.rows.value[0].id },
      global: { stubs: { Modal: modalStub } },
    })
    await flushPromises()
    await view.find('input').setValue('Sample access')
    await view
      .findAllComponents(Button)
      .find((one) => one.props('text') === 'Create token')!
      .trigger('click')
    if (change === 'close') view.findComponent(Modal).vm.$emit('close')
    else if (change === 'scope') view.findComponent(Dropdown).vm.$emit('update:model-value', '1')
    else await view.setProps({ connectionId: ui.rows.value[1].id })
    await flushPromises()
    answer({ token: 'late-secret-token' })
    await flushPromises()
    expect(view.text()).not.toContain('New token')
    expect(view.html()).not.toContain('late-secret-token')
    view.unmount()
  }
)
it.each(['close', 'scope', 'connection'] as const)(
  'discards a late access list after %s',
  async (change) => {
    const ui = shareFixture()
    let answer!: (value: Awaited<ReturnType<TokenUi['issued']>>) => void
    vi.spyOn(ui, 'issued')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve
          })
      )
      .mockResolvedValue([])
    const view = mount(TokenDialogs, {
      props: { ui, mode: 'share', connectionId: ui.rows.value[0].id },
      global: { stubs: { Modal: modalStub } },
    })
    await flushPromises()
    if (change === 'close') view.findComponent(Modal).vm.$emit('close')
    else if (change === 'scope') view.findComponent(Dropdown).vm.$emit('update:model-value', '1')
    else await view.setProps({ connectionId: ui.rows.value[1].id })
    await flushPromises()
    answer([
      {
        id: 'late',
        label: 'Late access response',
        scope: { kind: 'folder', id: 'root', path: '/' },
        issued_by_token_id: 'root',
        created_at: '2025-01-01',
        revoked_at: null,
      },
    ])
    await flushPromises()
    expect(view.text()).not.toContain('Late access response')
    view.unmount()
  }
)
it('shows vault inspection progress in its connection row and keeps sync blocked', () => {
  const ui = tokenUiFixture()
  const id = ui.rows.value[0].id
  ui.activity.value = { ...ui.activity.value, [id]: { inspection: { completed: 12, total: 3000 } } }
  const view = mount(SyncSettings, { props: { model: ui } })
  expect(view.text()).toContain('Checking the vault · 12 of 3 000')
  const sync = view
    .findAllComponents(Icon)
    .find((one) => one.props('tooltip') === 'Sync this connection now')!
  expect(sync.props('disabled')).toBe(true)
  view.unmount()
})
it('allows Close during a slow vault check and cancels enrollment', async () => {
  const data = new Map<string, unknown>()
  const registry = TokenConnectionRegistry.open({
    loadLocalStorage: (key) => data.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      data.set(key, value)
    },
  })
  const transport = vi.fn<typeof fetch>()
  const ui = new TokenUi(registry, { get: () => null, set: () => {}, remove: () => {} }, transport)
  let release!: () => void
  ui.connectionChangeGuard = () =>
    new Promise((resolve) => {
      release = resolve
    })
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'connect' },
    global: { stubs: { Modal: modalStub } },
  })
  try {
    await view.find('input:not([type=file])').setValue(sampleIssuedToken)
    await view
      .findAllComponents(Button)
      .find((one) => one.props('text') === 'Connect')!
      .trigger('click')
    await flushPromises()
    const close = view.findAllComponents(Button).find((one) => one.props('text') === 'Close')!
    expect(close.props('disabled')).toBeFalsy()
    await close.trigger('click')
    expect(view.emitted('close')).toHaveLength(1)
    release()
    await flushPromises()
    expect(transport).not.toHaveBeenCalled()
    expect(registry.records()).toEqual([])
  } finally {
    view.unmount()
  }
})
it('ends an unreachable connection attempt with a visible error and ignores its late answer', async () => {
  vi.useFakeTimers()
  const data = new Map<string, unknown>(),
    keys = new Map<string, string>()
  let answer!: (response: Response) => void
  const transport = vi.fn<typeof fetch>(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve
      })
  )
  const registry = TokenConnectionRegistry.open({
    loadLocalStorage: (key) => data.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      data.set(key, value)
    },
  })
  const ui = new TokenUi(
    registry,
    {
      get: (key) => keys.get(key) ?? null,
      set: (key, value) => {
        keys.set(key, value)
      },
      remove: (key) => {
        keys.delete(key)
      },
    },
    transport
  )
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'connect' },
    global: { stubs: { Modal: modalStub } },
  })
  try {
    await view.find('input:not([type=file])').setValue(sampleIssuedToken)
    const button = view.findAllComponents(Button).find((one) => one.props('text') === 'Connect')!
    await button.trigger('click')
    await flushPromises()
    expect(button.props('disabled')).toBe(true)
    expect(
      view
        .findAllComponents(Button)
        .find((one) => one.props('text') === 'Close')!
        .props('disabled')
    ).toBeFalsy()
    await vi.advanceTimersByTimeAsync(10000)
    await flushPromises()
    expect(view.get('[role="alert"]').text()).toContain('not reachable')
    expect(button.props('disabled')).toBe(false)
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true)
    answer(
      Response.json({
        protocol: 2,
        token_id: 'late-token',
        space_id: 'late-space',
        scope: { kind: 'folder', id: 'root', path: '/' },
        status: 'active',
        limits: { max_file_bytes: 1000, quota_bytes: null },
      })
    )
    await flushPromises()
    expect(registry.records()).toEqual([])
    expect(keys.size).toBe(0)
    expect(view.emitted('close')).toBeUndefined()
  } finally {
    view.unmount()
    vi.useRealTimers()
  }
})
it('reports a failed review refresh without leaving an unhandled settings promise', async () => {
  const ui = tokenUiFixture(),
    before = Notice.shown.length
  vi.spyOn(ui, 'refreshReviews').mockRejectedValue(new Error('sample closed review store'))
  const view = mount(SyncSettings, { props: { model: ui } })
  await flushPromises()
  expect(Notice.shown.slice(before).join(' ')).toContain('Incoming changes')
  view.unmount()
})

it('connects with only a token and shows a plain failure without closing the dialog', async () => {
  const data = new Map<string, unknown>()
  const ui = new TokenUi(
    TokenConnectionRegistry.open({
      loadLocalStorage: (key) => data.get(key) ?? null,
      saveLocalStorage: (key, value) => {
        data.set(key, value)
      },
    }),
    { get: () => null, set: () => {}, remove: () => {} },
    async () => {
      throw new Error('No request expected')
    }
  )
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'connect' },
    global: {
      stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } },
    },
  })
  expect(view.findAll('input:not([type=file])')).toHaveLength(1)
  expect(view.text()).not.toContain('Password')
  await view.find('input:not([type=file])').setValue('bad')
  await view
    .findAllComponents(Button)
    .find((one) => one.props('text') === 'Connect')!
    .trigger('click')
  await flushPromises()
  expect(view.get('[role="alert"]').text()).toContain('damaged')
  expect(view.emitted('close')).toBeUndefined()
})

it('uses the same explicit Connect action for a scanned token', async () => {
  const ui = tokenUiFixture(true),
    connect = vi.spyOn(ui, 'connect').mockResolvedValue()
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'connect' },
    global: { stubs: { Modal: modalStub } },
  })
  view.findComponent(TokenQrReader).vm.$emit('token', sampleIssuedToken)
  await flushPromises()
  expect(view.text()).toContain('https://sync.example')
  expect(view.text()).toContain('Whole vault')
  expect(view.text()).not.toContain('Folder: /')
  expect(connect).not.toHaveBeenCalled()
  await view
    .findAllComponents(Button)
    .find((one) => one.props('text') === 'Connect')!
    .trigger('click')
  await flushPromises()
  expect(connect).toHaveBeenCalledWith(sampleIssuedToken, expect.any(AbortSignal))
})

it('shows every connection as one row and opens its window with progress, refusals and the conflict copy', async () => {
  const ui = tokenUiFixture(),
    view = mount(SyncSettings, {
      props: { model: ui },
      global: { stubs: { Modal: modalStub, SelectiveSync: true } },
    })
  const rows = view.findAll('.abele-sync-row')
  expect(rows).toHaveLength(3)
  expect(rows[0].text()).toContain('sync.example')
  expect(rows[0].text()).toContain('820 of 2500 files')
  expect(rows[1].text()).toContain('unavailable.example')
  expect(rows[1].text()).toContain('Server unavailable, retrying')
  expect(rows[2].text()).toContain('collaboration.example')
  expect(view.text()).toContain('Group: Sample research group with a deliberately long name')
  expect(view.text()).not.toContain('deliberately long name.md')
  await rows[0].trigger('click')
  await flushPromises()
  expect(view.text()).toContain('server is full')
  expect(view.text()).toContain('Conflict copies')
  expect(view.text()).toContain('Sample note (Conflicted copy sample-device).md')
})

it('shows what waits for a decision above the connections only while something waits', () => {
  const ui = tokenUiFixture(),
    view = mount(SyncSettings, { props: { model: ui } })
  expect(view.findAll('h3')[0].text()).toBe('Waiting for you')
  ui.candidates.value = []
  ui.questions.value = []
  return flushPromises().then(() => {
    expect(view.text()).not.toContain('Waiting for you')
  })
})

it.each([false, true])(
  'approves before runtime registration while a later version remains pending (paused=%s)',
  async (paused) => {
    const fixture = tokenUiFixture(),
      state = new MemoryStateStore()
    const reviews = {
      executables: new ExecutableReview(state),
      attachments: new AttachmentConsent(state),
      close: () => {},
    }
    const ui = new TokenUi(
      fixture.registry,
      { get: () => 'a'.repeat(43), set: () => {}, remove: () => {} },
      async () => {
        throw new Error('No request expected')
      },
      reviews
    )
    const source = fixture.candidates.value[0].source,
      bytes = new TextEncoder().encode('sample reviewed version')
    fixture.registry.setPaused(source.id, paused)
    const retry = vi.fn(async () => {})
    ui.retryConnection = retry
    const incoming = {
      source,
      fileId: 'file-a',
      versionId: 'version-a',
      path: 'Scripts/sample.js',
      previousPath: null,
      operation: 'modify' as const,
      directory: false,
      receivedAt: 200,
      mtime: 100,
      sha: await sha256(bytes),
      bytes,
    }
    await reviews.executables.stage(incoming)
    const [candidate] = await reviews.executables.pending(),
      apply = vi.fn(async () => {})
    const runtime = {
      apply,
      sync: async () => {},
      pause: async () => {},
      disconnect: async () => {},
      resolve: async () => null,
      opened: async () => [],
    }
    const view = mount(TokenDialogs, {
      props: { ui, mode: 'review', candidate },
      global: { stubs: { Modal: modalStub } },
    })
    expect(view.get('pre').text()).toBe('sample reviewed version')
    const later = new TextEncoder().encode('later unreviewed version')
    await reviews.executables.stage({
      ...incoming,
      versionId: 'version-b',
      bytes: later,
      sha: await sha256(later),
    })
    await view
      .findAllComponents(Button)
      .find((one) => one.props('text') === 'Approve')!
      .trigger('click')
    await vi.waitFor(() => expect(view.get('[role=status]').text()).toContain('Approved —'))
    expect((await reviews.executables.state()).find((one) => one.id === candidate.id)?.status).toBe(
      'queued'
    )
    expect(apply).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledTimes(paused ? 0 : 1)
    ui.bind(source.id, runtime)
    await vi.waitFor(() => expect(view.get('[role=status]').text()).toBe('Approved and installed.'))
    expect(apply).toHaveBeenCalledExactlyOnceWith({ ...candidate, status: 'applying' })
    expect((await reviews.executables.pending()).map((one) => one.versionId)).toEqual(['version-b'])
  }
)

it('rejects only the displayed executable candidate, leaving local code and a later candidate untouched', async () => {
  const ui = tokenUiFixture(),
    candidate = ui.candidates.value[0],
    reject = vi.spyOn(ui, 'reject').mockResolvedValue(),
    approve = vi.spyOn(ui, 'approve')
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'review', candidate },
    global: { stubs: { Modal: modalStub } },
  })
  await view
    .findAllComponents(Button)
    .find((one) => one.props('text') === 'Reject')!
    .trigger('click')
  await flushPromises()
  expect(reject).toHaveBeenCalledExactlyOnceWith(candidate)
  expect(approve).not.toHaveBeenCalled()
})
it('closing executable review decides nothing and leaves it available for later', async () => {
  const ui = tokenUiFixture(),
    candidate = ui.candidates.value[0],
    reject = vi.spyOn(ui, 'reject'),
    approve = vi.spyOn(ui, 'approve')
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'review', candidate },
    global: { stubs: { Modal: modalStub } },
  })
  view.findComponent(Modal).vm.$emit('close')
  expect(view.emitted('close')).toHaveLength(1)
  expect(reject).not.toHaveBeenCalled()
  expect(approve).not.toHaveBeenCalled()
  expect(ui.candidates.value).toContain(candidate)
})

it('offers explicit server rename follow and disconnect while keeping the local folder', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id,
    followServerRoot = vi.fn(async () => {})
  ui.registry.setRootIssue(id, { kind: 'server-renamed', from: 'Shared', to: 'Renamed' } as never)
  ui.publish(id, {})
  ui.runtimes.set(id, { followServerRoot } as never)
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent'),
    view = mount(SyncSettings, { props: { model: ui } })
  try {
    expect(view.text()).toContain(
      'Shared folder renamed on the server: Shared → Renamed; sync stopped'
    )
    await view
      .findAllComponents(Icon)
      .find((one) => one.props('icon') === 'more-horizontal')!
      .trigger('click')
    const menu = show.mock.instances.at(-1)!
    expect(menu.items.some((item) => item.title === 'Disconnect…')).toBe(true)
    expect(menu.items.some((item) => item.title === 'Restore from the server')).toBe(false)
    menu.items.find((item) => item.title === 'Keep syncing into the same local folder')!.handler!()
    await flushPromises()
    expect(followServerRoot).toHaveBeenCalledOnce()
  } finally {
    view.unmount()
    show.mockRestore()
  }
})
