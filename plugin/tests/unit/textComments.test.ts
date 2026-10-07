import { describe, expect, it } from 'vitest'
import { decodeThread, encodeThread, type CommentThread } from '@/comments/model'
import { memoryComments } from '../helpers/textComments'
import { parseMarkers, resolveQuote, anchorFor, insertMarker } from '@/editor/commentMarkers'

const initial = (): CommentThread => ({
  version: 1,
  id: 'aaaaaa',
  anchor: { note: 'Notes/sample.md', quote: 'sample words' },
  appearance: 'yellow',
  entries: [{ id: 'bbbbbb', body: '**First**', createdAt: '2025-01-02T03:04:05.000Z' }],
})

describe('human thread codec', () => {
  it('round trips ordered entries and appearance without chat metadata', () => {
    const thread = initial()
    thread.entries.push({ id: 'cccccc', body: 'Second', createdAt: '2025-01-02T03:04:05.000Z' })
    expect(decodeThread(encodeThread(thread), thread.id)).toEqual(thread)
    expect(encodeThread(thread)).not.toContain('abele-chat')
  })
  it.each([
    { version: 2 },
    { id: 'invalid' },
    { appearance: 'gold' },
    { entries: [] },
    { entries: [{ id: 'bbbbbb', body: 'x', createdAt: '2025-01-02' }] },
    { entries: [initial().entries[0], initial().entries[0]] },
    { anchor: { note: 'sample.abchat', quote: 'x' } },
  ])('refuses invalid data: %j', (patch) =>
    expect(() => decodeThread(JSON.stringify({ ...initial(), ...patch }), 'aaaaaa')).toThrow()
  )
  it('rejects malformed JSON and identity mismatches', () => {
    expect(() => decodeThread('{', 'aaaaaa')).toThrow()
    expect(() => decodeThread(encodeThread(initial()), 'dddddd')).toThrow()
  })
})

describe('human comment lifecycle', () => {
  it('reports malformed files during rename without stranding valid unloaded threads', async () => {
    const m = memoryComments()
    m.files.set('badbad', '{broken')
    const saved = await m.service.publish(
      await m.service.draft('Notes/sample.md', 'sample words', 0, 12, 'yellow', 'First')
    )
    await expect(m.service.rename('Notes', 'Archive')).rejects.toThrow()
    expect((await m.repository.read(saved.thread.id))?.thread.anchor.note).toBe('Archive/sample.md')
    expect(m.files.get('badbad')).toBe('{broken')
  })
  it('cancellation before save has no side effects', async () => {
    const m = memoryComments()
    await m.service.draft('Notes/sample.md', 'sample words', 0, 12, 'yellow', 'First')
    expect(m.files.size).toBe(0)
    expect(m.notes.get('Notes/sample.md')).toBe('sample words')
  })
  it('stacks, edits and deletes entries with stable ordering and immutable creation dates', async () => {
    const m = memoryComments()
    const draft = await m.service.draft('Notes/sample.md', 'sample words', 0, 12, 'yellow', 'First')
    let saved = await m.service.publish(draft)
    m.clock('2025-01-03T04:05:06.000Z')
    saved = await m.service.add(saved, 'Second')
    const second = saved.thread.entries[1]
    saved = await m.service.edit(saved, saved.thread.entries[0].id, 'Changed', 'underline')
    expect(saved.thread.entries.map((e) => e.body)).toEqual(['Changed', 'Second'])
    expect(saved.thread.entries[0].createdAt).toBe('2025-01-02T03:04:05.000Z')
    expect(saved.thread.entries[0].editedAt).toBe('2025-01-03T04:05:06.000Z')
    saved = (await m.service.deleteEntry(saved, saved.thread.entries[0].id))!
    expect(saved.thread.entries).toEqual([second])
    expect(parseMarkers(m.notes.get('Notes/sample.md')!).length).toBe(1)
    expect(await m.service.deleteEntry(saved, second.id)).toBeNull()
    expect(m.files.size).toBe(0)
    expect(m.notes.get('Notes/sample.md')).toBe('sample words')
  })
  it('keeps a recoverable file after failed marker publication, and retries exactly once', async () => {
    const m = memoryComments()
    const draft = await m.service.draft('Notes/sample.md', 'sample words', 0, 12, 'pink', 'First')
    m.failDocument(true)
    await expect(m.service.publish(draft)).rejects.toThrow('document failed')
    expect(m.files.size).toBe(1)
    expect(parseMarkers(m.notes.get('Notes/sample.md')!)).toEqual([])
    m.failDocument(false)
    const saved = await m.service.publish(draft)
    await m.service.publish(draft)
    expect(m.files.size).toBe(1)
    expect(saved.thread.entries.length).toBe(1)
    expect(parseMarkers(m.notes.get('Notes/sample.md')!)[0].ids).toEqual([draft.thread.id])
  })
  it('does not overwrite changed source or external thread edits and retains the callers draft', async () => {
    const m = memoryComments()
    const draft = await m.service.draft('Notes/sample.md', 'sample words', 0, 12, 'cyan', 'First')
    m.notes.set('Notes/sample.md', 'changed')
    await expect(m.service.publish(draft)).rejects.toThrow('changed')
    expect(m.notes.get('Notes/sample.md')).toBe('changed')
    m.notes.set('Notes/sample.md', 'sample words')
    const saved = await m.service.publish(draft)
    m.files.set(saved.thread.id, encodeThread({ ...saved.thread, appearance: 'red' }))
    await expect(
      m.service.edit(saved, saved.thread.entries[0].id, 'Draft', 'blue')
    ).rejects.toThrow('stale')
    expect(saved.thread.entries[0].body).toBe('First')
  })
  it('deleting the final entry leaves prose and AI siblings intact', async () => {
    const m = memoryComments()
    m.notes.set('Notes/sample.md', 'sample words%%c:zzzzzz%%')
    const draft = await m.service.draft(
      'Notes/sample.md',
      m.notes.get('Notes/sample.md')!,
      0,
      12,
      'green',
      'First'
    )
    const saved = await m.service.publish(draft)
    await m.service.deleteEntry(saved, saved.thread.entries[0].id)
    expect(m.notes.get('Notes/sample.md')).toBe('sample words%%c:zzzzzz%%')
  })
  it('follows unloaded note and folder renames, but never collects manually unlinked threads', async () => {
    const m = memoryComments()
    const saved = await m.service.publish(
      await m.service.draft('Notes/sample.md', 'sample words', 0, 12, 'gray', 'First')
    )
    await m.service.rename('Notes', 'Archive')
    expect((await m.repository.read(saved.thread.id))?.thread.anchor.note).toBe('Archive/sample.md')
    await m.service.rename('Archive/sample.md', 'Archive/renamed.md')
    expect((await m.repository.read(saved.thread.id))?.thread.anchor.note).toBe(
      'Archive/renamed.md'
    )
    m.notes.set('Archive/renamed.md', 'no marker')
    expect(m.files.size).toBe(1)
  })
})

describe('shared anchor contract for human threads', () => {
  it('resolves insertions, moved and repeated exact quotes, and keeps missing quotes point anchored', () => {
    for (const text of [
      'prefix sample words%%c:aaaaaa%%',
      'sample words\n\nmarker%%c:aaaaaa%%',
      'sample words then sample words%%c:aaaaaa%%',
    ]) {
      const range = resolveQuote(text, parseMarkers(text)[0], 'sample words')!
      expect(text.slice(range.from, range.to)).toBe('sample words')
      expect(range.from).toBe(text.lastIndexOf('sample words'))
    }
    expect(
      resolveQuote('changed%%c:aaaaaa%%', parseMarkers('changed%%c:aaaaaa%%')[0], 'sample words')
    ).toBeNull()
  })
  it('merges mixed IDs and respects construct-safe placement and exclusions', () => {
    expect(insertMarker('words%%c:zzzzzz%%', 5, 'aaaaaa', 0).marker.ids).toEqual([
      'zzzzzz',
      'aaaaaa',
    ])
    const link = 'A [[sample|label]] sentence'
    expect(anchorFor(link, 12)?.pos).toBe(18)
    for (const text of [
      '---\nx: value\n---',
      '```\ncode\n```',
      '| a |\n| --- |\n| b |',
      '> [!note] Title',
    ])
      expect(anchorFor(text, 5)).toBeNull()
  })
})
