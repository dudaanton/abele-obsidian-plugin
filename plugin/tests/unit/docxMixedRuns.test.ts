import { describe, expect, it } from 'vitest'
import { openDocx, WP } from '@/word/package'
import { applyWordEdit } from '@/word/edit'
import { descendants, rawNode } from '@/word/xml'
import { sampleDocx, SAMPLE_IMAGE } from '../fixtures/docx/sampleDocx'

const resources = {
  loadImage: async () => ({ bytes: SAMPLE_IMAGE, extension: 'png', mime: 'image/png' }),
}
describe('image insertion through mixed Word runs', () => {
  it.each(['trailing empty text', 'text before drawing', 'drawing before text'])(
    'retains an existing drawing exactly once: %s',
    async (kind) => {
      const sample = await openDocx(sampleDocx())
      const drawing = rawNode(sample.xml.get('word/document.xml')!, sample.images[0].drawing)
      const content =
        kind === 'trailing empty text'
          ? `<w:r><w:t>AB</w:t></w:r><w:r><w:t/>${drawing}</w:r>`
          : kind === 'text before drawing'
            ? `<w:r><w:rPr><w:b/></w:rPr><w:t>AB</w:t>${drawing}</w:r>`
            : `<w:r><w:rPr><w:i/></w:rPr>${drawing}<w:t>AB</w:t></w:r>`
      const doc = await openDocx(sampleDocx(`<w:p>${content}</w:p>`))
      const bytes = await applyWordEdit(
        doc,
        {
          operation: 'image_insert',
          paragraph: 1,
          offset: 1,
          image_path: 'sample-image.png',
          width: 20,
          height: 20,
        },
        resources
      )
      const after = await openDocx(bytes)
      expect(after.paragraphs[0].text).toBe('AB')
      expect(after.images).toHaveLength(2)
      const ids = descendants(after.trees.get('word/document.xml')!, WP, 'docPr').map(
        (node) => node.attrs.id
      )
      expect(ids).toHaveLength(2)
      expect(new Set(ids).size).toBe(2)
      const source = after.xml.get('word/document.xml')!
      expect(source.split(drawing).length - 1).toBe(1)
      const existing = after.images.find(
        (image) => descendants(image.node, WP, 'docPr')[0].attrs.id === '1'
      )!
      expect(rawNode(source, existing.drawing)).toBe(drawing)
    }
  )
})
