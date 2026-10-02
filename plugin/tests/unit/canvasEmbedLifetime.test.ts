import { expect, it, vi } from 'vitest'
import { CanvasEmbed } from '@/canvas/embed'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

it('does not resurrect a static canvas embed after unloading during a pending file read', async () => {
  const bytes = JSON.stringify({ nodes: [], edges: [] })
  const app = useVault([{ path: 'sample.canvas', content: bytes }])
  Object.assign(app, { workspace: { on: vi.fn() } })
  const gate = deferred<string>(),
    read = vi.spyOn(app.vault, 'read').mockReturnValueOnce(gate.promise)
  const el = document.createElement('span')
  el.className = 'internal-embed'
  el.setAttribute('src', 'sample.canvas')
  const native = document.createElement('div')
  native.textContent = 'Native content'
  el.append(native)
  const widget = new CanvasEmbed(app as never, el, () => 'sample-note.md')
  widget.onload()
  widget.onunload()
  gate.resolve(bytes)
  await Promise.resolve()
  await Promise.resolve()
  expect(el.querySelector('.abele-canvas-embed')).toBeNull()
  expect(el.classList.contains('abele-canvas-embed-source')).toBe(false)
  expect(el.textContent).toBe('Native content')
  read.mockRestore()
})
