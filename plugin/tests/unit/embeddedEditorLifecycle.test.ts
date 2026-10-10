import { afterEach, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { getMarkdownEditorClass, resetEmbeddedEditorCache } from '@/editor/embeddedEditor'

class SampleEditor {
  buildLocalExtensions() {
    return []
  }
  set() {}
}

// Obsidian Component.unload is a no-op until load has marked the component loaded.
function fixture(fail: 'load' | 'editor' | 'prototype' | null = null) {
  const listeners = new Set<object>()
  let loaded = false
  const embed = {
    editable: false,
    editMode: Object.create(Object.create(SampleEditor.prototype)),
    load: vi.fn(() => {
      loaded = true
      if (fail === 'load') {
        listeners.add(embed)
        throw new Error('Sample load failure')
      }
    }),
    showEditor: vi.fn(() => {
      listeners.add(embed)
      if (fail === 'editor') throw new Error('Sample editor failure')
      if (fail === 'prototype') embed.editMode = Object.create(null)
    }),
    unload: vi.fn(() => {
      if (!loaded) return
      loaded = false
      listeners.delete(embed)
    }),
  }
  const make = vi.fn(() => embed)
  const app = { embedRegistry: { embedByExtension: { md: make } } } as unknown as App
  return { app, embed, listeners, make }
}

afterEach(() => resetEmbeddedEditorCache())

it('releases the discovery editor before caching its class, including across reloads', () => {
  const f = fixture()
  for (let i = 0; i < 10; i++) {
    resetEmbeddedEditorCache()
    expect(getMarkdownEditorClass(f.app)).toBe(SampleEditor)
    expect(f.listeners.size).toBe(0)
    expect(getMarkdownEditorClass(f.app)).toBe(SampleEditor)
    expect(f.make).toHaveBeenCalledTimes(i + 1)
  }
  expect(f.embed.load).toHaveBeenCalledTimes(10)
  expect(f.embed.unload).toHaveBeenCalledTimes(10)
})

it.each(['load', 'editor', 'prototype'] as const)(
  'releases a partially initialized discovery embed after a %s failure',
  (failure) => {
    const f = fixture(failure)
    expect(getMarkdownEditorClass(f.app)).toBeNull()
    expect(f.listeners.size).toBe(0)
    expect(f.embed.unload).toHaveBeenCalledOnce()
    expect(getMarkdownEditorClass(f.app)).toBeNull()
    expect(f.make).toHaveBeenCalledOnce()
  }
)
