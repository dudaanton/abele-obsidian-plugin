import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { artifactFile, artifactsOf, revealArtifact } from '@/ai/chatArtifactsAdapter'
import type { ChatSession } from '@/ai/ChatSession'
import { useVault } from '../helpers/testEnv'

const sessionWith = (attachments: string[]) =>
  ({
    touched: ref([]),
    allMessages: ref([
      { id: 'sample-upload', role: 'user', content: '', timestamp: 1, attachments },
    ]),
  }) as unknown as ChatSession

afterEach(() => vi.restoreAllMocks())
describe('stored artifact paths', () => {
  it.each([
    '/Pictures/sample.png',
    '../Pictures/sample.png',
    'Pictures/../../sample.png',
    'C:\\Pictures\\sample.png',
    '\\\\server\\Pictures\\sample.png',
    'file:///Pictures/sample.png',
  ])('keeps invalid stored path %s unavailable without looking it up', async (path) => {
    const app = useVault([{ path: 'Pictures/sample.png' }])
    const lookup = vi.spyOn(app.vault, 'getAbstractFileByPath')
    const artifact = artifactsOf(sessionWith([path])).images[0]
    expect(artifact.path).toBe(path)
    expect(artifactFile(artifact.path)).toBeUndefined()
    await revealArtifact(artifact.path)
    expect(lookup).not.toHaveBeenCalled()
  })
  it('normalizes valid relative paths without merging an invalid reference into them', () => {
    useVault([{ path: 'Pictures/sample.png' }])
    const images = artifactsOf(
      sessionWith(['Pictures/sample.png', 'Pictures//sample.png', '/Pictures/sample.png'])
    ).images
    expect(images.map((image) => image.path)).toEqual([
      'Pictures/sample.png',
      '/Pictures/sample.png',
    ])
    expect(artifactFile(images[0].path)).toBeDefined()
    expect(artifactFile(images[1].path)).toBeUndefined()
  })
})
