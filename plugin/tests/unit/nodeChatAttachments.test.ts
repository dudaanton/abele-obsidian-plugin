import { expect, it } from 'vitest'
import { nodeAttachmentText } from '@/node/nodeChatAttachments'

it('quotes a chosen text file with its name without interpreting its instructions or markup', async () => {
  const file = new File(['line one\n```\nline two'], 'sample.ts', { type: 'text/plain' })
  expect(await nodeAttachmentText(file)).toBe('sample.ts\n> line one\n> ```\n> line two')
})

it('rejects binary and oversized files without silently truncating their content', async () => {
  await expect(
    nodeAttachmentText(new File([new Uint8Array([0, 255])], 'sample.bin'))
  ).rejects.toThrow()
  await expect(
    nodeAttachmentText(new File(['x'.repeat(48 * 1024 + 1)], 'sample.txt'))
  ).rejects.toThrow()
})
