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
      w.get('.nav-header').element.compareDocumentPosition(card.element) &
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
  it('names unknown agent authority and explains the disabled mode switch', () => {
    const w = mount(DebugPanel, {
      props: {
        session: { ...session('paused'), mode: 'unknown' },
        modeAvailable: false,
        modeUnavailableReason: 'This node has no live-grant read API',
      },
    })
    const mode = w.get('.abele-debug-panel__mode')
    expect(mode.attributes('disabled')).toBeDefined()
    expect(mode.attributes('aria-label')).toContain('Unknown')
    expect(mode.attributes('aria-label')).toContain('no live-grant read API')
    expect(mode.attributes('aria-label')).not.toContain('asks before each action')
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
    expect(w.get('.abele-debug-panel__mode').attributes('disabled')).toBeDefined()
    w.unmount()
  })
  it('detaches from a program it attached to instead of stopping it, and says it runs on', async () => {
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
    expect(w.get('[role="status"]').attributes('aria-label')).toBe('Detached · The program runs on')
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
