import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RequestView from '@/components/debugger/http/RequestView.vue'
import RequestsPanel from '@/components/debugger/http/RequestsPanel.vue'
import type { HttpRequest } from '@/components/debugger/http/types'
import { useVault } from '../helpers/testEnv'

// The request's width beside its answer is kept on the device, as the app keeps it.
beforeEach(() => {
  useVault([])
})

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

  it('says where the answer would be that a key is not on this device, with the way to the keys', async () => {
    const why = 'The key sample-key is not on this device'
    const view = mount(RequestView, {
      props: { request: request(why), environment: 'local', vars },
    })
    const notice = view.find('.abele-http-request__answer .abele-http-request__notice')
    expect(notice.text()).toContain(why)
    expect(view.text()).not.toContain('Send it to see the answer here.')
    await notice.find('.abele-http-request__open-keys').trigger('click')
    expect(view.emitted('open-keys')).toHaveLength(1)
  })

  it('counts the steps of the code in words that agree', async () => {
    const answer = (steps: number) => ({
      kind: 'answered' as const,
      response: { status: 201, reason: 'Created', ms: 3, bytes: 2, headers: [], body: '{}', steps },
    })
    const view = mount(RequestView, {
      props: { request: request(), environment: 'local', vars, outcome: answer(1) },
    })
    expect(view.find('.abele-http-request__steps').text()).toBe('1 step in code')
    await view.setProps({ outcome: answer(3) })
    expect(view.find('.abele-http-request__steps').text()).toBe('3 steps in code')
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

describe('a request and a recording', () => {
  it('offers sending into a recording only while one goes on', async () => {
    const view = mount(RequestView, { props: { request: request(), environment: 'local', vars } })
    expect(view.find('.abele-http-request__into').exists()).toBe(false)
    await view.setProps({ recording: 'sample program' })
    await view.find('.abele-http-request__into').trigger('click')
    expect(view.emitted('into-recording')?.[0]).toEqual([true])
  })
})

describe('the history of a request', () => {
  const history = [
    {
      id: 'sample-2',
      at: '05:12',
      environment: 'local',
      status: 201,
      ms: 80,
      bytes: 10,
      body: '{}',
    },
    {
      id: 'sample-1',
      at: '05:03',
      environment: 'local',
      status: 422,
      ms: 90,
      bytes: 10,
      body: '{"a":1}',
    },
  ]
  const answered = {
    kind: 'answered' as const,
    response: { status: 201, reason: 'Created', ms: 80, bytes: 10, headers: [], body: '{}' },
  }
  it('lists each sending and compares one with the answer shown', async () => {
    const view = mount(RequestView, {
      props: { request: request(), environment: 'local', vars, outcome: answered, history },
    })
    const tab = view
      .findAll('.abele-tabs__tab, [role=tab]')
      .find((t) => t.text().startsWith('History'))
    expect(tab).toBeDefined()
    await tab!.trigger('click')
    expect(view.text()).toContain('05:03')
    await view.findAll('.abele-http-request__rows .tree-item-self')[1].trigger('click')
    expect(view.emitted('show-send')?.[0]).toEqual(['sample-1'])
    await view.setProps({ compareWith: history[1] })
    expect(view.text()).toContain('Compared with the answer of 05:03')
  })
})

describe('the requests view', () => {
  it('lists collections with each request and opens one on a click', async () => {
    const view = mount(RequestsPanel, {
      props: {
        collections: [{ name: 'Samples', requests: [{ ...request(), last: { status: 201 } }] }],
        environment: 'local',
      },
    })
    expect(view.text()).toContain('Create sample')
    expect(view.find('.abele-requests-panel__last').text()).toBe('201')
    expect(view.find('.abele-requests-panel__recording').exists()).toBe(false)
    await view.find('.abele-requests-panel__request .tree-item-self').trigger('click')
    expect(view.emitted('open-request')?.[0]).toEqual(['sample-create'])
  })

  it('unfolds a collection to bring the requests asked for into sight', async () => {
    const view = mount(RequestsPanel, {
      attachTo: document.body,
      props: { collections: [{ name: 'Samples', requests: [request()] }], environment: 'local' },
    })
    await view
      .find('.tree-item:not(.abele-requests-panel__environment) > .tree-item-self')
      .trigger('click')
    expect(view.find('[data-request="sample-create"]').exists()).toBe(false)
    await view.setProps({ reveal: { collection: 'Samples', ids: ['sample-create'], at: 1 } })
    await new Promise((r) => setTimeout(r, 0))
    expect(view.find('[data-request="sample-create"]').exists()).toBe(true)
    view.unmount()
  })

  it('says the requests open while the node is online', () => {
    const view = mount(RequestsPanel, { props: { collections: [], offline: true } })
    expect(view.text()).toContain('while the node is online')
  })
})

describe('an empty request and a long answer', () => {
  it('folds every part with nothing in it, and opening one shows the line to add the first', async () => {
    const blank: HttpRequest = { ...request(), method: 'GET', headers: [], body: undefined }
    const view = mount(RequestView, { props: { request: blank, environment: 'local', vars } })
    expect(view.findAll('.abele-http-pairs')).toHaveLength(0)
    expect(view.find('.abele-http-request__rows').exists()).toBe(false)
    await view.findAll('.abele-fold-heading')[0].trigger('click')
    expect(view.find('.abele-http-pairs_empty input').attributes('placeholder')).toBe(
      'Add a parameter'
    )
  })

  it("lists the answer's headers as names beside values, repeated names each on its own line", async () => {
    const value = 'SID=c2FtcGxl' + 'x'.repeat(200) + '; path=/; Secure'
    const view = mount(RequestView, {
      props: {
        request: request(),
        environment: 'local',
        vars,
        outcome: {
          kind: 'answered',
          response: {
            status: 200,
            reason: 'OK',
            ms: 12,
            bytes: 40,
            headers: [
              { key: 'set-cookie', value },
              { key: 'set-cookie', value: 'PREF=1' },
            ],
            body: '',
          },
        },
      },
    })
    const tab = view.findAll('[role="tab"], button').find((b) => b.text().startsWith('Headers'))
    await tab!.trigger('click')
    expect(view.findAll('.abele-http-request__headers dt').map((d) => d.text())).toEqual([
      'set-cookie',
      'set-cookie',
    ])
    expect(view.find('.abele-http-request__headers dd').text()).toBe(value)
  })

  it('stands a divider between the request and its answer', () => {
    const view = mount(RequestView, { props: { request: request(), environment: 'local', vars } })
    expect(view.find('.abele-http-request__divider').attributes('role')).toBe('separator')
  })
})

describe("a request's body", () => {
  it("is written in the plugin's code editor and handed on when the field is left", async () => {
    const view = mount(RequestView, {
      props: { request: request(), environment: 'local', vars },
      attachTo: document.body,
    })
    const content = view.find('.abele-http-request__body .cm-content')
    expect(content.exists()).toBe(true)
    expect(content.attributes('aria-label')).toBe('Body')
    expect(view.find('.abele-http-request__body textarea').exists()).toBe(false)
    view.unmount()
  })
})
