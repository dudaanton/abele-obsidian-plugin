import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RequestView from '@/components/debugger/http/RequestView.vue'
import DebugPanel from '@/components/debugger/DebugPanel.vue'
import type { HttpRequest } from '@/components/debugger/http/types'
import type { DebugSession } from '@/components/debugger/types'

const request = (missing?: string): HttpRequest => ({
  id: 'sample-create',
  name: 'Create sample',
  method: 'POST',
  url: '{{base}}/samples',
  params: [],
  headers: [{ key: 'Authorization', value: '${abele_key:sample-key}', secret: true, missing }],
  body: { format: 'json', text: '{}' },
  scripts: {},
  checks: [],
})
const vars = [{ key: 'base', value: 'http://localhost:4000' }]

describe('a saved request in its tab', () => {
  it('shows what the address comes to in the environment and never the key', () => {
    const view = mount(RequestView, { props: { request: request(), environment: 'local', vars } })
    expect(view.find('.abele-http-request__to').text()).toBe('http://localhost:4000/samples')
    expect(view.text()).toContain('sample-key')
    expect(view.text()).not.toContain('abele_key')
  })

  it('sends on Send and on Enter in the address, and not while it is already sending', async () => {
    const view = mount(RequestView, { props: { request: request(), environment: 'local', vars } })
    await view.find('.abele-http-request__send').trigger('click')
    await view.find('.abele-http-request__url').trigger('keydown', { key: 'Enter' })
    expect(view.emitted('send')).toHaveLength(2)
    await view.setProps({ outcome: { kind: 'sending' } })
    await view.find('.abele-http-request__url').trigger('keydown', { key: 'Enter' })
    expect(view.emitted('send')).toHaveLength(2)
  })

  it('keeps Send off while a key or a variable is missing, and marks only the address for a variable', async () => {
    const view = mount(RequestView, {
      props: { request: request('sample-key is not among the keys'), environment: 'local', vars },
    })
    expect(view.find('.abele-http-request__send').attributes('disabled')).toBeDefined()
    expect(view.find('.abele-http-request__to_missing').exists()).toBe(false)
    await view.setProps({ request: request(), vars: [] })
    expect(view.find('.abele-http-request__send').attributes('disabled')).toBeDefined()
    expect(view.find('.abele-http-request__to_missing').exists()).toBe(true)
  })

  it('says a request that may have gone through is not sent again by itself', () => {
    const view = mount(RequestView, {
      props: {
        request: request(),
        environment: 'local',
        vars,
        outcome: { kind: 'unknown', after: '30 s' },
      },
    })
    expect(view.text()).toContain('it is not sent again by itself')
  })
})

describe('the requests in the Debug view', () => {
  const session: DebugSession = {
    program: 'sample',
    status: 'running',
    frame: 0,
    frames: [],
    variables: [],
    breakpoints: [],
    watches: [],
    output: '',
    mode: 'ask',
  }
  it('lists collections with each request and opens one on a click', async () => {
    const view = mount(DebugPanel, {
      props: {
        session,
        requests: [{ name: 'Samples', requests: [{ ...request(), last: { status: 201 } }] }],
        environment: 'local',
      },
    })
    expect(view.find('.abele-debug-panel__requests').text()).toContain('Create sample')
    expect(view.find('.abele-debug-panel__last').text()).toBe('201')
    await view.find('.abele-debug-panel__request .tree-item-self').trigger('click')
    expect(view.emitted('open-request')?.[0]).toEqual(['sample-create'])
  })

  it('says the requests open while the node is online', () => {
    const view = mount(DebugPanel, {
      props: { session, requests: [], requestsOffline: true },
    })
    expect(view.find('.abele-debug-panel__requests').text()).toContain('while the node is online')
  })
})
