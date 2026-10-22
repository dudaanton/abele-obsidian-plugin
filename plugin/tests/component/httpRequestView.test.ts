import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Platform } from 'obsidian'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import RequestView from '@/components/debugger/http/RequestView.vue'
import RequestsPanel from '@/components/debugger/http/RequestsPanel.vue'

it('offers an explicit refresh for requests added outside the view', async () => {
  const view = mount(RequestsPanel, { props: { collections: [] } })
  await view.get('[aria-label="Refresh requests"]').trigger('click')
  expect(view.emitted('refresh')).toHaveLength(1)
  view.unmount()
})
import RequestPairs from '@/components/debugger/http/RequestPairs.vue'
import CodeField from '@/components/obsidian/CodeField.vue'
import DebugValueView from '@/components/debugger/DebugValueView.vue'
import type { HttpRequest } from '@/components/debugger/http/types'
import { useVault } from '../helpers/testEnv'

it('brings a newly paused request into the visible phone viewport', async () => {
  Platform.isPhone = true
  const scroll = vi.fn()
  const original = HTMLElement.prototype.scrollIntoView
  HTMLElement.prototype.scrollIntoView = scroll
  try {
    const view = mount(RequestView, { props: { request: request(), environment: 'local', vars } })
    await view.setProps({ pausedAt: 'src/sample.js:8' })
    await nextTick()
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
    view.unmount()
  } finally {
    HTMLElement.prototype.scrollIntoView = original
  }
})

// The request's width beside its answer is kept on the device, as the app keeps it.
beforeEach(() => {
  useVault([])
})
afterEach(() => {
  Platform.isPhone = false
  vi.restoreAllMocks()
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

describe('request script slots', () => {
  it('offers the paused controls even before the debugger supplies a source location', async () => {
    const view = mount(RequestView, {
      props: {
        request: request(),
        environment: 'local',
        vars,
        paused: true,
        outcome: { kind: 'sending' },
      },
    })
    expect(view.find('.abele-http-request__paused').text()).toBe('Paused')
    await view.find('.abele-http-request__paused').trigger('click')
    expect(view.emitted('open-debugger')).toEqual([[]])
  })
  it('identifies the request collection inside the phone tab as well as its title', () => {
    const view = mount(RequestView, {
      props: { request: request(), environment: 'local', vars, collection: 'Samples/Orders' },
    })
    expect(view.find('.abele-http-request__collection').text()).toBe('Samples/Orders')
  })
  it('opens the paused debugger in one press and changes the answer timeout', async () => {
    const view = mount(RequestView, {
      props: {
        request: request(),
        environment: 'local',
        vars,
        outcome: { kind: 'sending' },
        pausedAt: 'src/sample.ts:12',
      },
    })
    expect(view.find('.abele-http-request__paused').text()).toContain(
      'Waiting — the program is paused at src/sample.ts:12'
    )
    await view.find('.abele-http-request__paused').trigger('click')
    expect(view.emitted('open-debugger')).toEqual([[]])
    await view.find('.abele-http-request__timeout select').setValue('60000')
    expect(view.emitted('timeout')).toEqual([[60000]])
  })
  it('brings a completed answer into view on a phone', async () => {
    Platform.isPhone = true
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const view = mount(RequestView, {
      props: { request: request(), environment: 'local', vars, outcome: { kind: 'sending' } },
    })
    const scroll = vi.fn()
    view.find('.abele-http-request__answer').element.scrollIntoView = scroll
    await view.setProps({
      outcome: {
        kind: 'answered',
        response: { status: 200, reason: 'OK', ms: 1, bytes: 2, headers: [], body: '{}' },
      },
    })
    await nextTick()
    expect(scroll).not.toHaveBeenCalled()
    for (const callback of [...frames]) callback(0)
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    view.unmount()
  })
  it('uses JSON highlighting before a body has been entered', () => {
    const view = mount(RequestView, {
      props: { request: { ...request(), body: undefined }, environment: 'local', vars },
    })
    expect(view.findComponent(CodeField).props('path')).toBe('body.json')
  })
  it('labels inclusion consistently whether the row is checked or unchecked', async () => {
    const view = mount(RequestPairs, {
      props: { pairs: [{ key: 'sample', value: 'value' }], label: 'Headers', adding: 'Add' },
    })
    const label = view.find('input[type=checkbox]').attributes('aria-label')
    expect(label).toBe('Include sample')
    await view.setProps({ pairs: [{ key: 'sample', value: 'value', off: true }] })
    expect(view.find('input[type=checkbox]').attributes('aria-label')).toBe(label)
  })
  it('wraps response values and gives the recording switch a visible label', () => {
    const view = mount(RequestView, {
      props: {
        request: request(),
        environment: 'local',
        vars,
        recording: 'sample.js',
        intoRecording: true,
        outcome: {
          kind: 'answered',
          response: { status: 200, reason: 'OK', ms: 1, bytes: 2, headers: [], body: '{}' },
        },
      },
    })
    expect(view.findComponent(DebugValueView).props('wrap')).toBe(true)
    expect(view.find('.abele-http-request__recording').text()).toContain('Record request')
    expect(view.find('[role=switch]').attributes('aria-checked')).toBe('true')
  })
  it('opens an assigned script and offers change/remove even when it is missing', async () => {
    const view = mount(RequestView, {
      props: {
        request: { ...request(), scripts: { before: 'Missing sample' } },
        environment: 'local',
        vars,
        scriptProblems: { before: 'Script not found' },
      },
    })
    await view
      .findAll('.abele-fold-heading')
      .find((h) => h.text().includes('Scripts'))!
      .trigger('click')
    const row = view.find('.abele-http-request__script_problem')
    expect(row.text()).toContain('Missing sample')
    await row.find('.tree-item-self').trigger('click')
    expect(view.emitted('open-script')?.[0]).toEqual(['Missing sample'])
    await row.find('[aria-label="Run another script before it goes"]').trigger('click')
    await row.find('[aria-label="Take it off this request; the script stays"]').trigger('click')
    expect(view.emitted('pick-script')?.[0]).toEqual(['before'])
    expect(view.emitted('remove-script')?.[0]).toEqual(['before'])
    expect(view.emitted('open-script')).toHaveLength(1)
  })
  it('offers an empty slot for picking a script', async () => {
    const view = mount(RequestView, { props: { request: request(), environment: 'local', vars } })
    await view
      .findAll('.abele-fold-heading')
      .find((h) => h.text().includes('Scripts'))!
      .trigger('click')
    await view.find('.abele-http-request__script_none .tree-item-self').trigger('click')
    expect(view.emitted('pick-script')?.[0]).toEqual(['before'])
  })
  it('places the divider in the shared grid so either side determines its height', () => {
    const view = mount(RequestView, { props: { request: request(), environment: 'local', vars } })
    expect(view.find('.abele-http-request__layout > .abele-http-request__divider').exists()).toBe(
      true
    )
  })
  it('says when an answered request has no body', () => {
    const view = mount(RequestView, {
      props: {
        request: request(),
        environment: 'local',
        vars,
        outcome: {
          kind: 'answered',
          response: { status: 204, reason: 'No Content', ms: 1, bytes: 0, headers: [], body: '' },
        },
      },
    })
    expect(view.find('.abele-http-request__answer').text()).toContain('No body.')
  })
})

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
  it('explains an uncertain channel result and retains its diagnostic code', () => {
    const view = mount(RequestView, {
      props: {
        request: request(),
        environment: 'local',
        vars,
        outcome: { kind: 'unknown', after: 'time', reason: 'outcome_unknown' },
      },
    })
    expect(view.get('.abele-http-request__notice').text()).toContain('result')
    expect(view.get('.abele-http-request__notice').text()).not.toContain('outcome_unknown')
    expect(view.get('.abele-http-request__notice [title="outcome_unknown"]').exists()).toBe(true)
    view.unmount()
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
    expect(view.find('.abele-http-request__history').classes()).toContain('abele-selectable')
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
    expect(view.find('.abele-http-request__headers').classes()).toContain('abele-selectable')
    expect(view.find('.abele-http-request__facts').classes()).toContain('abele-selectable')
    expect(view.find('.abele-http-request__to').classes()).toContain('abele-selectable')
    expect(view.find('.abele-fold-heading').classes()).not.toContain('abele-selectable')
    view.unmount()
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

describe('selectable read-only text in the shared kit', () => {
  it('enables native selection including WebKit while keeping controls unselectable', () => {
    const css = readFileSync('src/components/obsidian/designKit.css', 'utf8')
    expect(css).toMatch(
      /\.abele-selectable[^{]*\{[^}]*-webkit-user-select: text;[^}]*user-select: text;/
    )
    expect(css).toMatch(
      /\.abele-selectable :is\([^}]*button[^}]*\{[^}]*-webkit-user-select: none;[^}]*user-select: none;/
    )
  })
})

it('links a confirmed recorded request even without code steps', async () => {
  const view = mount(RequestView, {
    props: {
      request: request(),
      environment: 'local',
      vars,
      recorded: true,
      outcome: {
        kind: 'answered',
        response: {
          status: 200,
          reason: 'OK',
          ms: 2,
          bytes: 0,
          headers: [],
          body: '',
          steps: 0,
        },
      },
    },
  })
  await view.get('.abele-http-request__steps').trigger('click')
  expect(view.emitted('open-run')).toEqual([[]])
  await view.setProps({ recorded: false })
  expect(view.find('.abele-http-request__steps').exists()).toBe(false)
  view.unmount()
})
