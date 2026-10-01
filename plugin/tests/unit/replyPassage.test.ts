import { describe, expect, it } from 'vitest'
import { resolveReplyPassage } from '@/ai/replyPassage'

// A deliberately small renderer for the core's port. Live tests use the plugin renderer.
const render = async (source: string) =>
  source.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')

describe('mapping selected rendered words back to markdown', () => {
  it('chooses the selected repeated occurrence, not the first source match', async () => {
    expect(await resolveReplyPassage('lamp then lamp', 'lamp', 10, render)).toEqual({
      from: 10,
      old: 'lamp',
    })
  })
  it('includes balanced formatting when the selection crosses it', async () => {
    expect(await resolveReplyPassage('A **small** lantern.', 'small lantern', 2, render)).toEqual({
      from: 2,
      old: '**small** lantern',
    })
  })
  it('keeps surrounding formatting when selecting inside it', async () => {
    expect(await resolveReplyPassage('A **small** lantern.', 'small', 2, render)).toEqual({
      from: 4,
      old: 'small',
    })
  })
  it('does not edit a link target instead of the selected text', async () => {
    expect(
      await resolveReplyPassage('[lamp](https://sample.invalid/lamp) then lamp', 'lamp', 10, render)
    ).toEqual({ from: 41, old: 'lamp' })
  })
  it('refuses stale anchors and never chooses a nearby occurrence', async () => {
    await expect(resolveReplyPassage('lamp then lamp', 'lamp', 5, render)).rejects.toThrow(
      /changed/
    )
  })
  it('refuses mappings that would alter unselected rendered words or break formatting', async () => {
    await expect(
      resolveReplyPassage('**small** lantern', 'mall lantern', 1, render)
    ).rejects.toThrow(/map/)
  })
})
