import { expect, it } from 'vitest'
import { isAllowedAttachment, resolveAttachmentsForApi } from '@/ai/attachments'
import { useVault } from '../helpers/testEnv'

it('accepts a canvas and attaches the readable tool outline with complete card data', async () => {
  useVault([
    {
      path: 'Boards/sample.canvas',
      content: JSON.stringify({
        nodes: [
          { id: 'card', type: 'text', text: 'Sample idea', x: 0, y: 0, width: 200, height: 100 },
        ],
        edges: [],
      }),
    },
  ])
  expect(isAllowedAttachment('Boards/sample.canvas')).toBe(true)
  const parts = await resolveAttachmentsForApi(['Boards/sample.canvas'])
  expect(parts).toHaveLength(1)
  const text = (parts[0] as { text: string }).text
  const outline = JSON.parse(text.slice(text.indexOf('\n') + 1))
  expect(outline.nodes[0]).toMatchObject({
    id: 'card',
    label: 'Sample idea',
    data: { text: 'Sample idea' },
  })
  expect(outline.groups).toEqual([])
})
