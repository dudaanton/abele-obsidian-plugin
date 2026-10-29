import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'
beforeEach(() => useVault([]))
import DebugPanel from '@/components/debugger/DebugPanel.vue'
import DebugValues from '@/components/debugger/DebugValues.vue'
import DebuggerView from '@/debugger/DebuggerView.vue'
import { DebuggerService } from '@/debugger/DebuggerService'
import DebugActionCard from '@/components/debugger/DebugActionCard.vue'
import type { DebugSession } from '@/components/debugger/types'
it('shows only this view action failure, leaving unrelated controller diagnostics in their own surface', async () => {
  const { shallowRef } = await import('vue')
  const service = DebuggerService.instance
  service.destroy()
  service.active.value = {
    revision: shallowRef(0),
    refresh: vi.fn(async () => {}),
    fail: vi.fn(),
    controller: {
      session: session('paused'),
      actions: [],
      error: 'sample unrelated source failure',
      watch: async () => {
        throw new Error('sample own watch failure')
      },
    },
  } as never
  const view = mount(DebuggerView)
  try {
    expect(view.find('.abele-debug-view__error').exists()).toBe(false)
    view.getComponent(DebugPanel).vm.$emit('watch', 'missing.field')
    await flushPromises()
    expect(view.get('.abele-debug-view__error').text()).toContain('sample own watch failure')
  } finally {
    view.unmount()
    service.active.value = null
  }
})
it('keeps a late failed view action on the session that started it', async () => {
  const { shallowRef } = await import('vue')
  const service = DebuggerService.instance
  service.destroy()
  let reject!: (reason: Error) => void
  const first = {
    revision: shallowRef(0),
    refresh: vi.fn(async () => {}),
    fail: vi.fn(),
    controller: {
      session: session('paused'),
      actions: [],
      watch: () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    },
  }
  const second = { ...first, revision: shallowRef(0), fail: vi.fn() }
  service.active.value = first as never
  const view = mount(DebuggerView)
  try {
    view.getComponent(DebugPanel).vm.$emit('watch', 'missing.field')
    service.active.value = second as never
    reject(new Error('sample watch failure'))
    await flushPromises()
    expect(first.fail).toHaveBeenCalled()
    expect(second.fail).not.toHaveBeenCalled()
    expect(view.find('.abele-debug-view__error').exists()).toBe(false)
  } finally {
    view.unmount()
    service.active.value = null
  }
})
it('stops showing recording on a detached session even if the last trace read was recording', async () => {
  const { shallowRef } = await import('vue')
  const service = DebuggerService.instance
  service.destroy()
  const state = session('running')
  const revision = shallowRef(0)
  service.active.value = {
    revision,
    retainedBreakpoints: [],
    forgottenBreakpoints: new Set(),
    controller: { session: state, actions: [] },
    trace: {
      breakpoints: () => [],
      summaries: () => [],
      recording: () => ({
        elapsed: '1:00',
        steps: 1,
        browser: { state: 'none', via: 'agent', hosts: [] },
        folder: 'runs',
      }),
    },
  } as never
  const view = mount(DebuggerView)
  try {
    expect(view.getComponent(DebugPanel).props('recording')).toBeDefined()
    state.status = 'exited'
    revision.value++
    await flushPromises()
    expect(view.getComponent(DebugPanel).props('recording')).toBeUndefined()
  } finally {
    view.unmount()
    service.active.value = null
  }
})
const session = (status: DebugSession['status']): DebugSession => ({
  program: 'sample program',
  status,
  frames: [{ name: 'sample', file: 'sample.ts', line: 7 }],
  frame: 0,
  variables: [{ name: 'total', value: '12' }],
  breakpoints: [
    { file: 'sample.ts', line: 7, state: 'rejected', reason: 'No executable statement' },
  ],
  watches: [{ expression: 'total', value: '12' }],
  output: 'sample output',
  mode: 'ask',
  seen: '10:00',
})
it('keeps debugger controls in their own normal-flow row', () => {
  const wrapper = mount(DebugPanel, { props: { session: session('paused') } })
  try {
    expect(wrapper.find('.nav-header').exists()).toBe(false)
    expect(
      wrapper.get('.abele-debug-panel__toolbar').findAll('.nav-action-button').length
    ).toBeGreaterThan(0)
  } finally {
    wrapper.unmount()
  }
})
it('forgets each ended record point without converting it into a stopping breakpoint', async () => {
  const { ref } = await import('vue')
  const { debuggerSnapshot } = await import('../fixtures/debugger')
  const service = DebuggerService.instance
  service.destroy()
  const b = service.binding({
    reference: { registrationId: 'sample-registration', sessionId: 'sample-chat' },
    connection: { state: ref('connected'), client: {} },
  } as never)
  b.controller.observe({
    observation: 'current',
    snapshot: debuggerSnapshot({
      breakpoints: [7, 9].map((line) => ({
        breakpoint_id: `sample-${line}`,
        source_id: 'sample-source',
        line,
        enabled: true,
        status: 'verified',
        resolved_line: line,
        resolved_column: null,
        message: null,
      })),
    }),
  })
  b.controller.registerSource('sample-source', 'sample.ts')
  const { TraceSession } = await import('@/debugger/trace/TraceSession')
  b.trace = new TraceSession({} as never, b.controller, () => ++b.revision.value)
  b.trace.points = [7, 9].map((line) => ({ breakpoint_id: `sample-${line}`, take: ['value'] }))
  b.controller.session.status = 'exited'
  b.controller.session.detached = true
  service.select(b)
  const remove = vi.spyOn(b.trace, 'removePoint').mockResolvedValue()
  const view = mount(DebuggerView)
  try {
    for (const line of [7, 9]) {
      view.getComponent(DebugPanel).vm.$emit('breakpoint', 'sample.ts', line)
      await flushPromises()
      expect(
        view
          .getComponent(DebugPanel)
          .props('session')
          .breakpoints.some((p: { line: number }) => p.line === line)
      ).toBe(false)
    }
    expect(remove).not.toHaveBeenCalled()
    expect(b.retainedBreakpoints).toEqual([])
    expect(b.trace.points).toEqual([])
  } finally {
    view.unmount()
    service.destroy()
  }
})
it('keeps local point removal available on an unavailable ended session', () => {
  const view = mount(DebugPanel, {
    props: { session: { ...session('exited'), unavailable: true } },
  })
  try {
    expect(view.get('[aria-label="Remove all breakpoints"]').attributes('disabled')).toBeUndefined()
    expect(view.get('[aria-label="Remove"]').attributes('disabled')).toBeUndefined()
  } finally {
    view.unmount()
  }
})
it('waits for source paths rather than showing adapter source ids in breakpoint rows', async () => {
  const { shallowRef } = await import('vue')
  const service = DebuggerService.instance
  service.destroy()
  const state = session('running')
  state.breakpoints = [{ file: 'sample-adapter-source', line: 7, state: 'set' }]
  const revision = shallowRef(0)
  let file = 'sample-adapter-source'
  service.active.value = {
    revision,
    controller: {
      session: state,
      actions: [],
      knownBreakpoints: () => [{ file, sourceId: 'sample-adapter-source', line: 7 }],
    },
  } as never
  const view = mount(DebuggerView)
  try {
    expect(view.text()).not.toContain('sample-adapter-source:7')
    file = 'src/sample.ts'
    state.breakpoints[0].file = file
    revision.value++
    await flushPromises()
    expect(view.text()).toContain('sample.ts:7')
  } finally {
    view.unmount()
    service.active.value = null
  }
})
it('keeps a real paused state visible even when the trace classifies the hit as a record point', async () => {
  const { shallowRef } = await import('vue')
  const service = DebuggerService.instance
  service.destroy()
  service.active.value = {
    revision: shallowRef(0),
    controller: { session: session('paused'), actions: [] },
    trace: {
      breakpoints: () => [],
      isRecordStop: () => true,
      summaries: () => [],
      recording: () => undefined,
    },
  } as never
  const view = mount(DebuggerView)
  try {
    expect(view.getComponent(DebugPanel).props('session').status).toBe('paused')
  } finally {
    view.unmount()
    service.active.value = null
  }
})
it('opens a selected caller frame and explains a library without source', async () => {
  const { shallowRef } = await import('vue')
  const service = DebuggerService.instance
  service.destroy()
  const s = session('paused')
  s.frames.push({ name: 'library', file: '', line: 1 })
  const b = {
    revision: shallowRef(1),
    refresh: vi.fn(async () => {}),
    controller: {
      session: s,
      current: true,
      actions: [],
      selectFrame: vi.fn(async (index: number) => {
        s.frame = index
      }),
    },
  }
  service.active.value = b as never
  const reveal = vi.spyOn(service, 'reveal').mockImplementation(() => {})
  const w = mount(DebuggerView)
  try {
    w.getComponent(DebugPanel).vm.$emit('frame', 0)
    await flushPromises()
    expect(reveal).toHaveBeenCalledWith(b, 'sample.ts', 7)
    w.getComponent(DebugPanel).vm.$emit('frame', 1)
    await flushPromises()
    expect(reveal).toHaveBeenCalledWith(b, '', 1)
    reveal.mockClear()
    b.controller.selectFrame.mockImplementationOnce(async () => {
      Object.assign(b.controller, { snapshot: { stop_epoch: 2, incarnation: 'sample-new-stop' } })
    })
    w.getComponent(DebugPanel).vm.$emit('frame', 0)
    await flushPromises()
    expect(reveal).not.toHaveBeenCalled()
  } finally {
    w.unmount()
    service.active.value = null
    reveal.mockRestore()
  }
})
it('keeps refused requests readable in Debug after the decision', async () => {
  const { shallowRef } = await import('vue')
  const service = DebuggerService.instance
  service.destroy()
  service.active.value = {
    revision: shallowRef(1),
    controller: {
      session: session('paused'),
      current: true,
      actions: [
        {
          id: 'sample-denied',
          kind: 'breakpoint',
          at: 'sample.ts:7',
          status: 'denied',
          result: 'Request denied; no breakpoint was set',
        },
      ],
    },
  } as never
  const w = mount(DebuggerView)
  try {
    expect(w.getComponent(DebugActionCard).text()).toContain('Request denied')
  } finally {
    w.unmount()
    service.active.value = null
  }
})
it('removes disabled breakpoints from the panel even though the node no longer holds them', async () => {
  const { shallowRef } = await import('vue')
  const service = DebuggerService.instance
  service.destroy()
  const removeBreakpoint = vi.fn(async () => {})
  service.active.value = {
    revision: shallowRef(1),
    refresh: vi.fn(async () => {}),
    controller: {
      session: session('paused'),
      current: true,
      actions: [],
      snapshot: { breakpoints: [] },
      knownBreakpoints: () => [
        {
          id: 'sample-disabled',
          sourceId: 'sample-source',
          file: 'sample.ts',
          line: 7,
          requestedLine: 7,
          enabled: false,
        },
      ],
      removeBreakpoint,
    },
  } as never
  const w = mount(DebuggerView)
  try {
    w.getComponent(DebugPanel).vm.$emit('breakpoint', 'sample.ts', 7)
    await flushPromises()
    expect(removeBreakpoint).toHaveBeenCalledWith('sample-disabled')
  } finally {
    w.unmount()
    service.active.value = null
  }
})
it('renders exact approvals in the debug view without a chat', async () => {
  const { shallowRef } = await import('vue')
  const service = DebuggerService.instance
  service.destroy()
  const decide = vi.fn(async () => {})
  const refresh = vi.fn(async () => {})
  service.active.value = {
    revision: shallowRef(1),
    controller: {
      session: session('paused'),
      current: true,
      actions: [
        {
          id: 'sample-ask',
          kind: 'evaluate',
          detail: 'n > 0 && n < 4',
          exact: 'sample exact request',
          at: 'sample.ts:7',
          status: 'asked',
        },
      ],
      decide,
    },
    refresh,
  } as never
  const w = mount(DebuggerView)
  try {
    const card = w.getComponent(DebugActionCard)
    expect(
      w.get('.abele-debug-panel__toolbar').element.compareDocumentPosition(card.element) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(card.text()).toContain('n > 0 && n < 4')
    card.vm.$emit('allow')
    await flushPromises()
    expect(decide).toHaveBeenCalledWith('sample-ask', true)
    expect(refresh).toHaveBeenCalledOnce()
  } finally {
    w.unmount()
    service.active.value = null
  }
})
describe('debugger panel', () => {
  it('shows the evaluation diagnostic in its watch row', () => {
    const view = mount(DebugPanel, {
      props: {
        session: {
          ...session('paused'),
          watches: [
            { expression: 'missing.field', error: 'ReferenceError: missing is not defined' },
          ],
        },
      },
    })
    try {
      expect(view.get('.abele-debug-panel__value_error').text()).toContain(
        'ReferenceError: missing is not defined'
      )
    } finally {
      view.unmount()
    }
  })
  it('identifies a log point rather than promising to stop there', () => {
    const w = mount(DebugPanel, {
      props: {
        session: {
          ...session('paused'),
          breakpoints: [
            { file: 'sample.ts', line: 7, state: 'set', kind: 'log', logMessage: 'value {n}' },
          ],
        },
      },
    })
    expect(w.get('.abele-breakpoint-mark').attributes('aria-label')).toBe('Log point: value {n}')
    w.unmount()
  })
  it('keeps an approved watch result readable as retained evidence when execution becomes unknown', () => {
    const w = mount(DebugPanel, {
      props: {
        session: { ...session('starting'), watches: [{ expression: '1 < 2', value: 'true' }] },
      },
    })
    expect(w.get('.abele-debug-panel__value').text()).toBe('Last value: true')
    w.unmount()
  })
  it('offers breakpoint menus, remove-all and exception filter checkboxes', async () => {
    const w = mount(DebugPanel, {
      props: {
        session: session('paused'),
        exceptionFilters: ['uncaught'],
        exceptionsAvailable: true,
      },
    })
    const row = w
      .findAll('.tree-item-self')
      .find((r) => r.find('.abele-tree-item__text').text() === 'sample.ts:7')!
    await row.trigger('contextmenu')
    expect(w.emitted('breakpoint-menu')?.[0].slice(0, 2)).toEqual(['sample.ts', 7])
    await w.get('[aria-label="Remove all breakpoints"]').trigger('click')
    expect(w.emitted('remove-breakpoints')).toHaveLength(1)
    const caught = w.get('[aria-label="Caught exceptions"]')
    await caught.trigger('click')
    expect(w.emitted('exceptions')).toEqual([[['uncaught', 'caught']]])
    w.unmount()
  })
  it.each(['.abele-tree-item__text', '.abele-breakpoint-mark'])(
    'opens the breakpoint source when its %s is clicked',
    async (selector) => {
      const w = mount(DebugPanel, { props: { session: session('paused') } })
      const row = w
        .findAll('.tree-item-self')
        .find((r) => r.find('.abele-tree-item__text').text() === 'sample.ts:7')!
      await row.get(selector).trigger('click')
      expect(w.emitted('reveal')).toEqual([['sample.ts', 7]])
      expect(w.emitted('breakpoint')).toBeUndefined()
      w.unmount()
    }
  )
  it('omits the agent mode control when the node cannot read its authority', () => {
    const w = mount(DebugPanel, {
      props: {
        session: { ...session('paused'), mode: 'unknown' },
        modeAvailable: false,
        modeUnavailableReason: 'This node has no live-grant read API',
      },
    })
    expect(w.find('.abele-debug-panel__mode').exists()).toBe(false)
    w.unmount()
  })
  it('does not paint last-known Allow all as current permission after connection loss', () => {
    const w = mount(DebugPanel, {
      props: { session: { ...session('lost'), mode: 'allow' }, modeAvailable: true },
    })
    expect(w.get('.abele-debug-panel__mode').attributes('aria-label')).toContain('Unknown')
    expect(w.get('.abele-debug-panel__mode').attributes('aria-pressed')).toBe('false')
    w.unmount()
  })
  it('folds the frames with no source of the program into one quiet row, opened on asking', async () => {
    const w = mount(DebugPanel, {
      props: {
        session: {
          ...session('paused'),
          frames: [
            { name: 'total', file: 'src/sample.js', line: 4 },
            { name: '<anonymous>', file: 'src/sample.js', line: 8 },
            { name: '<anonymous>', file: '', line: 1778 },
            { name: 'wrapModuleLoad', file: '', line: 254 },
            { name: '<anonymous>', file: '', line: 36 },
          ],
        },
      },
    })
    const internals = w.get('.abele-debug-panel__internals')
    expect(internals.text()).toContain('Node internals')
    expect(internals.text()).toContain('3')
    expect(w.text()).not.toContain('wrapModuleLoad')
    await internals.get('.tree-item-self').trigger('click')
    expect(w.text()).toContain('wrapModuleLoad')
    await w
      .findAll('.tree-item-self')
      .find((r) => r.text().includes('wrapModuleLoad'))!
      .trigger('click')
    expect(w.emitted('frame')?.at(-1)).toEqual([3])
    w.unmount()
  })
  it('names the runs folder by its own name, the whole path in its tooltip', () => {
    const folder = '/Users/username/projects/sample-service/.abele/runs'
    const w = mount(DebugPanel, {
      props: {
        session: session('running'),
        recording: {
          elapsed: '0:01',
          steps: 2,
          browser: { state: 'none', via: 'chrome', hosts: [] },
          folder,
        },
      },
    })
    const row = w.find('.abele-debug-panel__folder')
    expect(row.find('.abele-tree-item__text').text()).toBe('runs')
    expect(row.html()).toContain(folder)
  })

  it('explains how to open a session when the sidebar is empty', () => {
    DebuggerService.instance.destroy()
    const w = mount(DebuggerView)
    // The kit's empty pane: the bug glyph, what is missing, then how to get one.
    const empty = w.find('.abele-empty-state')
    expect(empty.find('.abele-empty-state__icon').exists()).toBe(true)
    expect(empty.find('.abele-empty-state__title').text()).toBe('No debug session')
    expect(empty.find('.abele-empty-state__description').text()).toBe(
      'Open Debug from a node folder or chat menu.'
    )
    w.unmount()
  })
  it('disables every mutation while disconnected, keeping last values', () => {
    const w = mount(DebugPanel, { props: { session: session('lost') } })
    expect(w.text()).toContain('As of 10:00')
    expect(w.text()).toContain('12')
    expect(w.get('input').attributes('disabled')).toBeDefined()
    for (const button of w.findAll(
      '.nav-action-button, .abele-debug-panel__mode, .tree-item-actions .clickable-icon'
    ))
      expect(button.attributes('disabled')).toBeDefined()
    w.unmount()
  })
  it('offers recovery after connection loss without enabling stale step controls', async () => {
    const w = mount(DebugPanel, {
      props: { session: session('lost'), restartAvailable: true },
    })
    const restart = w.get('[aria-label="Restart: the same program from its first line"]')
    expect(restart.attributes('disabled')).toBeUndefined()
    await restart.trigger('click')
    expect(w.emitted('command')?.at(-1)).toEqual(['restart'])
    expect(w.get('[aria-label="Step over (F10)"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('offers reattach for a detached program through the running program picker', async () => {
    const w = mount(DebugPanel, {
      props: {
        session: { ...session('exited'), attached: true, detached: true },
        reattachAvailable: true,
      },
    })
    const button = w.get('[aria-label="Attach to a running program"]')
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    expect(w.emitted('command')?.at(-1)).toEqual(['reattach'])
    w.unmount()
  })

  it('has one entry point per control and disables gated restart and unbound mode', () => {
    const w = mount(DebugPanel, {
      props: { session: session('paused'), restartAvailable: false, modeAvailable: false },
    })
    expect(w.findAll('.nav-action-button')).toHaveLength(6)
    expect(w.findAll('.nav-action-button')[4].attributes('disabled')).toBeDefined()
    expect(w.find('.abele-debug-panel__mode').exists()).toBe(false)
    w.unmount()
  })
  it('detaches from an attached program and leaves its later process state unknown', async () => {
    const w = mount(DebugPanel, {
      props: { session: { ...session('running'), attached: true } },
    })
    const last = w.findAll('.nav-action-button').at(-1)!
    expect(last.attributes('aria-label')).toBe('Detach (Shift+F5): the program runs on')
    expect(w.findAll('.nav-action-button')[4].attributes('aria-label')).toContain(
      'not for a program the debugger attached to'
    )
    await last.trigger('click')
    expect(w.emitted('command')?.at(-1)).toEqual(['stop'])
    await w.setProps({ session: { ...session('exited'), attached: true, detached: true } })
    expect(w.get('[role="status"]').attributes('aria-label')).toBe('Detached')
    expect(w.text()).not.toContain('Exit code unknown')
    w.unmount()
    // A program the node started keeps its Stop.
    const own = mount(DebugPanel, { props: { session: session('running') } })
    expect(own.findAll('.nav-action-button').at(-1)!.attributes('aria-label')).toBe(
      'Stop (Shift+F5)'
    )
    own.unmount()
  })
  it('opens Output on exit', () => {
    const w = mount(DebugPanel, { props: { session: session('exited') } })
    expect(w.get('.abele-debug-panel__output').isVisible()).toBe(true)
    expect(w.get('[role="status"]').attributes('aria-label')).toContain('Exit code unknown')
    w.unmount()
  })
})
it('opens an explicitly inspected scope so its returned children are visible', async () => {
  const w = mount(DebugValues, {
    props: {
      values: [{ name: 'Local', value: 'Expand to inspect', handle: 'sample-scope' }],
      folded: new Set<string>(),
    },
  })
  try {
    await w.get('[role="treeitem"]').trigger('click')
    expect(w.emitted('inspect')).toEqual([['sample-scope']])
    expect(w.emitted('toggle')).toEqual([['value:Local']])
    await w.setProps({
      folded: new Set(['value:Local']),
      values: [{ name: 'Local', value: '1 values', children: [{ name: 'n', value: '3' }] }],
    })
    expect(w.get('.tree-item-children').isVisible()).toBe(true)
    expect(w.text()).toContain('n')
    expect(w.text()).toContain('3')
  } finally {
    w.unmount()
  }
})
it('reveals a long inert scalar in place without evaluating it', async () => {
  const value = 'sample value '.repeat(40)
  const w = mount(DebugValues, {
    props: { values: [{ name: 'sample', value }], folded: new Set<string>() },
  })
  await w.get('[role="treeitem"]').trigger('click')
  expect(w.emitted('toggle')).toEqual([['value:sample']])
  expect(w.emitted('inspect')).toBeUndefined()
  await w.setProps({ folded: new Set(['value:sample']) })
  expect(w.get('pre').text()).toBe(value.trim())
  w.unmount()
})
it('opens a document the row shows only the start of whole, by the row alone', async () => {
  const full = '<?xml version="1.0"?><sample>' + '<line/>'.repeat(40) + '</sample>'
  const w = mount(DebugValues, {
    props: {
      values: [{ name: 'exported', value: '"<?xml version=…', type: 'string', full }],
      folded: new Set<string>(),
    },
  })
  expect(w.find('.abele-tree-item__actions').exists()).toBe(false)
  await w.get('[role="treeitem"]').trigger('click')
  expect(w.emitted('open')).toEqual([['exported', full, 'string']])
  expect(w.emitted('toggle')).toBeUndefined()
  w.unmount()
})
it('shows exact long proposal details and disables approval offline', () => {
  const w = mount(DebugActionCard, {
    props: {
      action: {
        id: 'sample',
        kind: 'evaluate',
        detail: 'sample '.repeat(300),
        at: 'sample.ts:7',
        status: 'asked',
      },
      disabled: true,
    },
  })
  expect(w.get('details').text()).toContain('sample '.repeat(300).trim())
  expect(w.findAll('button').every((b) => b.attributes('disabled') !== undefined)).toBe(true)
  w.unmount()
})
it('opens a complete observed document without a separate full-value field', async () => {
  const value = JSON.stringify({ sample: 'value '.repeat(40) })
  const w = mount(DebugValues, {
    props: { values: [{ name: 'payload', value }], folded: new Set<string>() },
  })
  await w.get('[role="treeitem"]').trigger('click')
  expect(w.emitted('open')).toEqual([['payload', value, undefined]])
  expect(w.emitted('inspect')).toBeUndefined()
  w.unmount()
})
