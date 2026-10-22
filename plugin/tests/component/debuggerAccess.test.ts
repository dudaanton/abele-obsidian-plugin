import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import DebuggerAccessCard from '@/debugger/DebuggerAccessCard.vue'
import NodeDebuggerAccess from '@/debugger/NodeDebuggerAccess.vue'
import DebuggerGrantsDialog from '@/debugger/DebuggerGrantsDialog.vue'
import Modal from '@/components/obsidian/Modal.vue'
import { accessRequest, accessDescription, accessGrant } from '../fixtures/debuggerAccess'
import { useVault } from '../helpers/testEnv'
import { initializeLocale } from '@/i18n'
import { catalogs } from '@/i18n/catalogs'

it.each(['allow', 'deny'] as const)(
  'offers an explicit %s action and names the program and folder',
  async (decision) => {
    const w = mount(DebuggerAccessCard, { props: { request: accessRequest } })
    expect(w.text()).toContain('/sample/project')
    expect(w.text()).toContain('sample-server.js')
    expect(
      w
        .findAll('button')
        .find((b) => b.text() === 'Allow')!
        .classes()
    ).toContain('mod-cta')
    await w
      .findAll('button')
      .find((b) => b.text().toLowerCase() === decision)!
      .trigger('click')
    expect(w.emitted('decide')).toEqual([[decision]])
    await w.setProps({ decision })
    expect(w.findAll('button')).toHaveLength(0)
    w.unmount()
  }
)
it('renders incoming requests in this chat, allows once, and leaves the tool retry to the agent', async () => {
  let event = (_: { type: string; data?: unknown }) => {}
  const stop = vi.fn()
  const request = vi.fn(async (method: string) =>
    method.endsWith('requests')
      ? [
          accessRequest,
          { ...accessRequest, request_id: 'other-request', conversation_id: 'other-chat' },
        ]
      : accessGrant
  )
  const presenter = {
    reference: { sessionId: 'sample-chat' },
    debuggerAvailable: ref(true),
    nodeDescription: ref(accessDescription),
    connection: {
      state: ref('connected'),
      client: {
        request,
        onEvent: (fn: typeof event) => {
          event = fn
          return stop
        },
      },
    },
  }
  const w = mount(NodeDebuggerAccess, { props: { presenter: presenter as never } })
  await flushPromises()
  expect(w.findAllComponents(DebuggerAccessCard)).toHaveLength(1)
  await w.findAll('button')[0]!.trigger('click')
  await flushPromises()
  expect(request).toHaveBeenCalledWith('debugger.v1.access.decide', {
    request_id: 'sample-request',
    decision: 'allow',
  })
  expect(w.text()).toContain('agent can retry')
  const before = request.mock.calls.length
  event({ type: 'session.update', data: { update: { kind: 'agent_message_chunk' } } })
  await flushPromises()
  expect(request.mock.calls).toHaveLength(before)
  event({ type: 'session.update', data: { update: { kind: 'debugger_access_requested' } } })
  await flushPromises()
  expect(request.mock.calls.length).toBeGreaterThan(before)
  w.unmount()
  expect(stop).toHaveBeenCalledOnce()
})
it('uses a tall grant dialog and exposes revoke/delete for the node’s issuer-filtered list', async () => {
  useVault([])
  const request = vi.fn(async (method: string) =>
    method.endsWith('list') ? [accessGrant] : { revoked: true }
  )
  const w = mount(DebuggerGrantsDialog, {
    props: {
      label: 'Sample node',
      connection: {
        connect: vi.fn(),
        client: { request, describe: async () => accessDescription },
      } as never,
    },
    global: { stubs: { Modal: { template: '<div><slot /></div>', props: ['size'] } } },
  })
  await flushPromises()
  expect(w.text()).toContain('sample-debug')
  expect(w.findComponent(Modal).props('size')).toBe('tall')
  const refresh = w.get('.abele-section__actions [aria-label="Refresh"]')
  expect(refresh.text()).toBe('')
  await refresh.trigger('click')
  await flushPromises()
  expect(request.mock.calls.filter(([method]) => method === 'debugger.v1.grant.list')).toHaveLength(
    2
  )
  await w.get('[aria-label="Revoke debugger access"]').trigger('click')
  await flushPromises()
  expect(request).toHaveBeenCalledWith('debugger.v1.grant.revoke', { grant_id: 'sample-grant' })
  await w.get('[aria-label^="Delete this grant"]').trigger('click')
  await flushPromises()
  expect(request).toHaveBeenCalledWith('debugger.v1.grant.delete', { grant_id: 'sample-grant' })
  w.unmount()
})
it('refreshes an uncertain decision from a header glyph without repeating the decision', async () => {
  const request = vi.fn(async (method: string) => {
    if (method === 'debugger.v1.access.decide') throw new Error('Sample connection interrupted')
    return [accessRequest]
  })
  const presenter = {
    reference: { sessionId: 'sample-chat' },
    debuggerAvailable: ref(true),
    nodeDescription: ref(accessDescription),
    connection: { state: ref('connected'), client: { request, onEvent: () => () => {} } },
  }
  const w = mount(NodeDebuggerAccess, { props: { presenter: presenter as never } })
  await flushPromises()
  await w
    .findAll('button')
    .find((button) => button.text() === 'Allow')!
    .trigger('click')
  await flushPromises()
  await w.get('.abele-section__actions [aria-label="Refresh debugger requests"]').trigger('click')
  await flushPromises()
  expect(
    request.mock.calls.filter(([method]) => method === 'debugger.v1.access.decide')
  ).toHaveLength(1)
  expect(
    request.mock.calls.filter(([method]) => method === 'debugger.v1.access.requests')
  ).toHaveLength(2)
  w.unmount()
})
it('disables offline and expired request actions', async () => {
  const w = mount(DebuggerAccessCard, { props: { request: accessRequest, disabled: true } })
  expect(w.findAll('button').every((button) => button.attributes('disabled') !== undefined)).toBe(
    true
  )
  await w.setProps({ request: { ...accessRequest, expires_at: '2000-01-01T00:00:00.000Z' } })
  expect(w.text()).toContain('expired')
  expect(w.findAll('button')).toHaveLength(0)
  w.unmount()
})
it('translates debugger consent and grant descriptions while keeping program identities intact', async () => {
  useVault([])
  initializeLocale('ru', catalogs.ru)
  const card = mount(DebuggerAccessCard, { props: { request: accessRequest } })
  const request = vi.fn(async () => [accessGrant])
  const dialog = mount(DebuggerGrantsDialog, {
    props: {
      label: 'Sample node',
      connection: {
        connect: vi.fn(),
        client: { request, describe: async () => accessDescription },
      } as never,
    },
    global: { stubs: { Modal: { template: '<div><slot /></div>', props: ['title', 'size'] } } },
  })
  try {
    await flushPromises()
    expect(card.text()).toContain('Разрешить агенту пользоваться отладчиком')
    expect(card.text()).toContain('sample-server.js · чтение')
    expect(card.findAll('button').map((b) => b.text())).toEqual(['Разрешить', 'Отклонить'])
    expect(dialog.findComponent(Modal).props('title')).toBe('Доступ агента к отладчику')
    expect(dialog.text()).toContain('Действует · чтение · запрашивать')
    expect(dialog.text()).toContain('sample-debug')
    expect(dialog.find('[aria-label="Отозвать доступ к отладчику"]').exists()).toBe(true)
  } finally {
    card.unmount()
    dialog.unmount()
    initializeLocale('en')
  }
})
