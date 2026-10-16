import { expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import {
  codeGuideClickTarget,
  codeGuideContentBounds,
  withCodeGuideSettings,
} from '../e2e/helpers/codeGuideProbe'

it('uses the block content box regardless of the width of the closing text row', () => {
  const pre = document.createElement('pre')
  pre.style.cssText = 'padding: 0 12px; border: 2px solid'
  const row = document.createElement('span')
  row.textContent = '}'
  pre.append(row)
  vi.spyOn(pre, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 400, 200))
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(114, 100, 8, 20))
  document.body.append(pre)
  try {
    expect(codeGuideContentBounds(pre)).toEqual({ left: 114, right: 486 })
  } finally {
    pre.remove()
  }
})

it('restores each probe setting after success or failure, including an unset default', async () => {
  const config: Record<string, unknown> = { showIndentGuide: false }
  const vault = {
    getConfig: (key: string) => config[key],
    setConfig: (key: string, value: unknown) => {
      config[key] = value
    },
    requestSaveConfig: { run: vi.fn(async () => {}) },
  }
  await withCodeGuideSettings(vault, async () => {
    expect(config).toMatchObject({ showIndentGuide: true, tabSize: 4 })
    config.showIndentGuide = false
  })
  expect(config.showIndentGuide).toBe(false)
  expect(config.tabSize).toBeUndefined()
  expect(vault.requestSaveConfig.run).toHaveBeenCalledTimes(2)
  delete config.showIndentGuide
  await expect(
    withCodeGuideSettings(vault, async () => {
      config.showIndentGuide = false
      throw new Error('sample failure')
    })
  ).rejects.toThrow('sample failure')
  expect(config.showIndentGuide).toBeUndefined()
})

it('chooses an uncovered wrapped row instead of clicking a floating toolbar', () => {
  const contentDOM = document.createElement('div')
  const token = document.createElement('span')
  contentDOM.append(token)
  const toolbar = document.createElement('div')
  const hit = vi
    .spyOn(document, 'elementFromPoint')
    .mockImplementation((_x, y) => (y < 100 ? toolbar : token))
  const view = {
    dom: contentDOM,
    contentDOM,
    scrollDOM: { getBoundingClientRect: () => ({ top: 0, bottom: 400 }) },
    state: { doc: { lineAt: () => ({ to: 150 }) } },
    coordsAtPos: (pos: number) => ({
      left: 65,
      right: 65,
      top: pos <= 104 ? 20 : pos <= 113 ? 60 : 120,
      bottom: pos <= 104 ? 36 : pos <= 113 ? 76 : 136,
    }),
  } as unknown as EditorView
  try {
    expect(codeGuideClickTarget(view, 100)).toMatchObject({ pos: 122, x: 65, y: 128 })
    hit.mockReturnValue(toolbar)
    expect(codeGuideClickTarget(view, 100)).toBeNull()
  } finally {
    hit.mockRestore()
  }
})
