import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { canvasNewFileLocation } from '@/canvas/newFileLocation'

it('routes the native command and ribbon folder choice through new-note settings only while enabled', () => {
  const original = vi.fn((_source?: string) => ({ path: 'Journal' }))
  const native = { getNewFileParent: original }
  const getNewFileParent = vi.fn(() => ({ path: 'Inbox' }))
  let enabled = true
  const app = {
    internalPlugins: { getEnabledPluginById: () => native },
    fileManager: { getNewFileParent },
  } as unknown as App
  const off = canvasNewFileLocation(app, () => enabled)
  expect(native.getNewFileParent('Journal/sample-day.md')).toEqual({ path: 'Inbox' })
  expect(getNewFileParent).toHaveBeenCalledWith('Journal/sample-day.md', 'Untitled.md')
  enabled = false
  expect(native.getNewFileParent('Journal/sample-day.md')).toEqual({ path: 'Journal' })
  off()
  expect(native.getNewFileParent).toBe(original)
})
