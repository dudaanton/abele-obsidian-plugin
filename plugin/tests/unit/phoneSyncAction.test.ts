import { describe, expect, it, vi } from 'vitest'
import type { Plugin } from 'obsidian'
import { mountPhoneSyncAction } from '@/sync/phoneSyncAction'
import { DISCONNECTED_STATUS } from '@/sync/status'

/** A loaded note's view takes header actions; a tab not yet opened this session has no such API. */
function loadedView() {
  const actions: { icon: string; click: () => void; el: { removed: boolean } }[] = []
  return {
    actions,
    addAction(icon: string, _tooltip: string, click: () => void) {
      const one = {
        icon,
        click,
        el: {
          removed: false,
          addClass() {},
          toggleClass() {},
          remove() {
            one.el.removed = true
          },
        },
      }
      actions.push(one)
      return one.el
    },
  }
}

function workspace(leaves: { view: unknown }[]) {
  const handlers = new Map<string, (() => void)[]>()
  const plugin = {
    app: {
      workspace: {
        getLeavesOfType: (type: string) => (type === 'markdown' ? leaves : []),
        on: (name: string, handler: () => void) => {
          handlers.set(name, [...(handlers.get(name) ?? []), handler])
          return { name }
        },
      },
    },
    registerEvent() {},
    register() {},
  }
  const fire = (name: string) => handlers.get(name)?.forEach((handler) => handler())
  return { plugin: plugin as unknown as Plugin, fire }
}

describe('the cloud in a phone note header', () => {
  it('U7 opens sync from the offline header action and removes it after recovery', () => {
    const loaded = loadedView()
    const { plugin } = workspace([{ view: loaded }])
    const openSync = vi.fn()
    const paint = mountPhoneSyncAction(plugin, openSync)
    paint({ ...DISCONNECTED_STATUS, state: 'offline' })
    expect(loaded.actions.map((action) => action.icon)).toEqual(['cloud-off'])
    expect(openSync).not.toHaveBeenCalled()
    loaded.actions[0].click()
    expect(openSync).toHaveBeenCalledOnce()
    paint({ ...DISCONNECTED_STATUS, state: 'idle' })
    expect(loaded.actions).toHaveLength(1)
    expect(loaded.actions[0].el.removed).toBe(true)
    expect(openSync).toHaveBeenCalledOnce()
  })
  it('skips a note tab that is not loaded yet and still marks the loaded ones', () => {
    const loaded = loadedView()
    const deferred = { leaf: {} }
    const tabs = [{ view: deferred }, { view: loaded }]
    const { plugin } = workspace(tabs)
    const paint = mountPhoneSyncAction(plugin, () => {})
    expect(() => paint({ ...DISCONNECTED_STATUS, state: 'idle', review: 1 })).not.toThrow()
    expect(loaded.actions.map((one) => one.icon)).toEqual(['cloud'])
  })

  it('marks a background tab once it loads', () => {
    const tabs: { view: unknown }[] = [{ view: { leaf: {} } }]
    const { plugin, fire } = workspace(tabs)
    const paint = mountPhoneSyncAction(plugin, () => {})
    paint({ ...DISCONNECTED_STATUS, state: 'offline' })
    const loaded = loadedView()
    tabs[0].view = loaded
    fire('layout-change')
    expect(loaded.actions.map((one) => one.icon)).toEqual(['cloud-off'])
  })
})
