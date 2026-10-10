import { describe, expect, it } from 'vitest'
import { prepareBindingEdit, undoBindingEdit, semanticBindingText } from '@/selection/bindingEdits'
import { prepareChatBindingEdit } from '@/ai/chatBindingEdits'
import { bindingRecoveryAction } from '@/selection/bindingRecovery'

const render = async (text: string) =>
  text.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2').replace(/\*\*(.*?)\*\*/g, '$1')
const link = (label: string) => `[[Cards/Sample|${label}]]`

describe('verified selection decoration', () => {
  it('links only the second occurrence and preserves formatting and projection', async () => {
    const patch = await prepareBindingEdit('lamp then **lamp**', 'lamp', 10, render, link)
    expect(patch.after).toBe('[[Cards/Sample|lamp]]')
    expect(patch.range.start).toBe(12)
    expect(patch.result).toBe('lamp then **[[Cards/Sample|lamp]]**')
    expect(await render(patch.result)).toBe('lamp then lamp')
  })
  it.each(['[[Other|lamp]]', '[lamp](sample.md)', '`lamp`', '```\nlamp\n```'])(
    'does not nest a link in existing syntax: %s',
    async (source) => {
      await expect(
        prepareChatBindingEdit(
          source,
          'lamp',
          (await render(source)).indexOf('lamp'),
          render,
          'Cards/Sample.md'
        )
      ).rejects.toThrow()
    }
  )
  it('requires the actual replacement to preserve all rendered text', async () => {
    await expect(prepareBindingEdit('lamp', 'lamp', 0, render, () => 'changed')).rejects.toThrow(
      /render/
    )
  })
  it('undo owns only its recorded patch and preserves unrelated edits', () => {
    const patch = {
      range: { space: 'source' as const, start: 0, end: 4 },
      before: 'lamp',
      after: link('lamp'),
    }
    const original = link('lamp') + ' then rest'
    expect(undoBindingEdit(original + ' later', original, patch)).toBe('lamp then rest later')
    expect(semanticBindingText(original, [{ patch, publishedContent: original }])).toBe(
      'lamp then rest'
    )
    expect(() => undoBindingEdit('a ' + original + original, original, patch)).toThrow()
    expect(() => undoBindingEdit('[[Other|lamp]] then rest', original, patch)).toThrow()
  })
  it('uncertain acknowledgement is not permission for blind replay or byte-based settlement', () => {
    expect(bindingRecoveryAction('uncertain', false)).toBe('review')
    expect(bindingRecoveryAction('uncertain', true)).toBe('applied')
    expect(bindingRecoveryAction('pending', false)).toBe('retry')
    expect(bindingRecoveryAction('known-not-written', false)).toBe('retry')
  })
})
