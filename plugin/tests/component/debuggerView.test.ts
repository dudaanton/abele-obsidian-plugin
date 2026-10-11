import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
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
describe('debugger panel', () => {
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
  it('explains how to open a session when the sidebar is empty', () => {
    DebuggerService.instance.destroy()
    const w = mount(DebuggerView)
    expect(w.text()).toContain('Open Debug from a node chat')
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
  it('has one entry point per control and disables gated restart and unbound mode', () => {
    const w = mount(DebugPanel, {
      props: { session: session('paused'), restartAvailable: false, modeAvailable: false },
    })
    expect(w.findAll('.nav-action-button')).toHaveLength(6)
    expect(w.findAll('.nav-action-button')[4].attributes('disabled')).toBeDefined()
    expect(w.get('.abele-debug-panel__mode').attributes('disabled')).toBeDefined()
    w.unmount()
  })
  it('opens Output on exit', () => {
    const w = mount(DebugPanel, { props: { session: session('exited') } })
    expect(w.get('.abele-debug-panel__output').isVisible()).toBe(true)
    expect(w.get('[role="status"]').attributes('aria-label')).toContain('Exit code unknown')
    w.unmount()
  })
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
