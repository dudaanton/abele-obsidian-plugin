import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'

const source = readFileSync(resolve(__dirname, '../e2e/canvasNotePanels.e2e.test.ts'), 'utf8')
const body = source.match(/const OPEN_CANVAS = `([\s\S]*?)`\n/)![1]
const open = new Function('app', 'path', `return (async () => {${body}})()`)

it('returns to the existing canvas rather than creating a second tab that hides the tested view', async () => {
  const canvas = { view: { file: { path: 'sample.canvas' } } }
  let active: unknown = { view: { file: { path: 'note.md' } } }
  const workspace = {
    getLeavesOfType: () => [canvas],
    revealLeaf: vi.fn(async (leaf) => {
      active = leaf
    }),
    setActiveLeaf: vi.fn((leaf) => {
      active = leaf
    }),
    openLinkText: vi.fn(async () => {
      active = { ...canvas }
    }),
  }
  await open({ workspace }, 'sample.canvas')
  expect(active).toBe(canvas)
  expect(workspace.openLinkText).not.toHaveBeenCalled()
  expect(workspace.revealLeaf).toHaveBeenCalledWith(canvas)
})

it('opens the canvas normally when there is no existing tab', async () => {
  const workspace = {
    getLeavesOfType: () => [],
    openLinkText: vi.fn(async () => {}),
  }
  expect(await open({ workspace }, 'sample.canvas')).toBe(true)
  expect(workspace.openLinkText).toHaveBeenCalledWith('sample.canvas', '', 'tab')
})
