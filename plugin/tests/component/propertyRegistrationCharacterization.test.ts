import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { Plugin } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { registerPropertyWidgets } from '@/properties/register'
import { templateHarness } from '../helpers/templateHarness'

const stops: (() => void)[] = []
beforeEach(() => {
  const config = AbeleConfig.getInstance()
  Object.assign(config, {
    propertyWidgets: true,
    counterProperties: ['count'],
    dateProperties: ['day'],
    priorityProperties: ['rank'],
    labelProperties: ['labels'],
    groupProperties: ['groups'],
  })
})
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  vi.restoreAllMocks()
})

function setup(layoutReady: boolean) {
  const env = templateHarness()
  const original = vi.fn()
  const table = {
    multitext: { render: original },
    text: { render: original },
    file: { render: original, reservedKeys: [] },
  } as Record<string, { render: typeof original; reservedKeys?: string[] }>
  const setType = vi.fn()
  const trigger = vi.fn()
  const host = document.createElement('div')
  for (const key of ['visible', 'visible', 'other']) {
    const row = host.appendChild(document.createElement('div'))
    row.className = 'metadata-property'
    row.dataset.propertyKey = key
  }
  const ready: (() => void)[] = []
  Object.assign(env.app, {
    metadataTypeManager: {
      registeredTypeWidgets: table,
      getAssignedWidget: () => null,
      setType,
      trigger,
    },
  })
  Object.assign(env.app.workspace, {
    layoutReady,
    onLayoutReady: (fn: () => void) => ready.push(fn),
    iterateAllLeaves: (fn: (leaf: unknown) => void) => fn({ view: { containerEl: host } }),
  })
  let cleanup = () => {}
  registerPropertyWidgets({
    app: env.app,
    register: (fn: () => void) => {
      cleanup = fn
    },
  } as unknown as Plugin)
  let stopped = false
  const stop = () => {
    if (!stopped) {
      cleanup()
      stopped = true
    }
  }
  stops.push(stop)
  return {
    ...env,
    original,
    table,
    setType,
    trigger,
    ready: () => ready.forEach((fn) => fn()),
    stop,
  }
}

describe('property widget registration lifecycle', () => {
  it('patches immediately but assigns types only at layout readiness, redrawing visible keys once each', () => {
    const env = setup(false)
    expect(env.table.text.render).not.toBe(env.original)
    expect(env.table.files).toBeDefined()
    expect(env.setType).not.toHaveBeenCalled()
    expect(env.trigger).not.toHaveBeenCalled()
    env.ready()
    expect(env.setType.mock.calls).toEqual([
      ['file', 'file'],
      ['files', 'files'],
    ])
    expect(env.trigger.mock.calls).toEqual([
      ['changed', 'visible'],
      ['changed', 'other'],
    ])
    env.stop()
    expect(env.table.text.render).toBe(env.original)
    expect(env.table.files).toBeUndefined()
  })

  it('syncs on version changes, avoids redraw for unchanged settings, and stops watching after unload', async () => {
    const env = setup(true)
    const config = AbeleConfig.getInstance()
    expect(env.setType).toHaveBeenCalledTimes(2)
    config.version.value++
    await nextTick()
    expect(env.trigger).not.toHaveBeenCalled()
    config.counterProperties = ['new-count']
    config.version.value++
    await nextTick()
    expect(env.trigger).toHaveBeenCalledTimes(2)
    config.propertyWidgets = false
    config.version.value++
    await nextTick()
    expect(env.table.text.render).toBe(env.original)
    expect(env.trigger).toHaveBeenCalledTimes(4)
    config.dateProperties = ['new-day']
    config.version.value++
    await nextTick()
    expect(env.trigger).toHaveBeenCalledTimes(4)
    config.propertyWidgets = true
    config.version.value++
    await nextTick()
    expect(env.table.text.render).not.toBe(env.original)
    expect(env.trigger).toHaveBeenCalledTimes(6)
    env.stop()
    env.trigger.mockClear()
    config.propertyWidgets = false
    config.version.value++
    await nextTick()
    expect(env.trigger).not.toHaveBeenCalled()
  })

  it('leaves stock rendering untouched when disabled initially or the host has no type registry', () => {
    AbeleConfig.getInstance().propertyWidgets = false
    const env = setup(false)
    expect(env.table.text.render).toBe(env.original)
    env.ready()
    expect(env.setType).not.toHaveBeenCalled()
    const bare = templateHarness()
    const register = vi.fn()
    registerPropertyWidgets({ app: bare.app, register } as unknown as Plugin)
    expect(register).not.toHaveBeenCalled()
  })
})
