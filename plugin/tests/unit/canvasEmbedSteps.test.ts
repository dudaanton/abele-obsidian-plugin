import { expect, it, vi } from 'vitest'
import { CanvasEmbed } from '@/canvas/embed'
import * as pictures from '@/canvas/pictureAdapter'
import { useVault } from '../helpers/testEnv'

it.each([
  { steps: 'broken' },
  {
    steps: [
      { id: 'same', reveal: ['alpha'], say: 'First' },
      { id: 'same', reveal: ['alpha'], say: 'Second' },
    ],
  },
])(
  'keeps a static diagram picture when its legacy steps are invalid: $steps',
  async ({ steps }) => {
    const app = useVault([
      {
        path: 'sample.canvas',
        content: JSON.stringify({
          nodes: [
            { id: 'alpha', type: 'text', text: 'Alpha', x: 0, y: 0, width: 240, height: 120 },
          ],
          edges: [],
          abele: { steps },
        }),
      },
    ])
    Object.assign(app, { workspace: { on: vi.fn() } })
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,c2FtcGxl')
    const paint = vi
      .spyOn(pictures, 'canvasPicture')
      .mockResolvedValue({
        canvas,
        region: { x: 0, y: 0, width: 240, height: 120 },
        warnings: [],
        visible: ['alpha'],
        say: undefined,
      })
    const embed = document.createElement('span')
    embed.className = 'internal-embed'
    embed.setAttribute('src', 'sample.canvas')
    const widget = new CanvasEmbed(app as never, embed, () => 'sample-note.md')
    widget.load()
    try {
      await vi.waitFor(() =>
        expect(embed.querySelector('.abele-canvas-embed-status')?.textContent).toMatch(
          /steps|step/i
        )
      )
      expect(embed.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png/)
      expect(
        (embed.querySelector('[aria-label="Play diagram"]') as HTMLButtonElement).disabled
      ).toBe(true)
      expect(
        (embed.querySelector('[aria-label="Open diagram"]') as HTMLButtonElement).disabled
      ).toBe(false)
      embed.setAttribute('src', 'sample.canvas#step=1')
      await vi.waitFor(() => expect(paint).toHaveBeenCalledTimes(2))
      expect(paint.mock.calls[1][3].step).toBeUndefined()
      expect(embed.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png/)
    } finally {
      widget.unload()
      paint.mockRestore()
    }
  }
)
