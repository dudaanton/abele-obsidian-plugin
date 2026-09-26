/**
 * `file` and `files` are drawn as file cards out of the box: the plugin gives those names the
 * File and Files types unless the person already chose a type for them.
 */
import { describe, it, expect } from 'vitest'
import type { App } from 'obsidian'
import { assignFileKeys } from '@/properties/types'

function fakeApp(assigned: Record<string, string>, registered = ['text', 'file', 'files']) {
  const set: [string, string][] = []
  const manager = {
    registeredTypeWidgets: Object.fromEntries(registered.map((t) => [t, { type: t }])),
    getAssignedWidget: (key: string) => assigned[key] ?? null,
    setType: (key: string, type: string) => {
      set.push([key, type])
      assigned[key] = type
    },
  }
  return { app: { metadataTypeManager: manager } as unknown as App, set }
}

describe('file and files drawn as cards out of the box', () => {
  it('gives file the File type and files the Files type', () => {
    const { app, set } = fakeApp({})
    assignFileKeys(app)
    expect(set).toEqual([
      ['file', 'file'],
      ['files', 'files'],
    ])
  })

  it('leaves a type the person chose alone', () => {
    const { app, set } = fakeApp({ file: 'text', files: 'multitext' })
    assignFileKeys(app)
    expect(set).toEqual([])
  })

  it('does nothing twice', () => {
    const { app, set } = fakeApp({})
    assignFileKeys(app)
    assignFileKeys(app)
    expect(set).toHaveLength(2)
  })

  it('skips a type this Obsidian does not have', () => {
    const { app, set } = fakeApp({}, ['text', 'file'])
    assignFileKeys(app)
    expect(set).toEqual([['file', 'file']])
  })
})
