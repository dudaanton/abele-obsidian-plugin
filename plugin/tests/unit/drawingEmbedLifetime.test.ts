import { expect, it, vi } from 'vitest'
import { DrawingEmbed } from '@/drawing/embed'
import { emptyDrawingSvg } from '@/drawing/drawingFile'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

it('does not reattach an embedded drawing after its pending file read finishes on a closed note', async () => {
  const content = emptyDrawingSvg()
  const app = useVault([{ path: 'sample-drawing.svg', content }])
  const gate = deferred<string>()
  const read = vi.spyOn(app.vault, 'cachedRead').mockReturnValueOnce(gate.promise)
  const embed = document.createElement('span')
  embed.setAttribute('src', 'sample-drawing.svg')
  const drawing = new DrawingEmbed(
    app as never,
    embed,
    app.vault.getFileByPath('sample-drawing.svg')!,
    { sourcePath: 'sample-note.md', callout: null, place: () => null }
  )
  const pending = (drawing as unknown as { refresh(): Promise<void> }).refresh()
  drawing.onunload()
  gate.resolve(content)
  await pending
  expect(embed.querySelector('.abele-drawing-embed')).toBeNull()
  read.mockRestore()
})
