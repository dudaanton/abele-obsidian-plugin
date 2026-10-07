// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  advanceChatAnchor,
  captureBookSelection,
  captureChatSelection,
  createChatAnchor,
  resolveChatAnchor,
} from '../../src/selection/anchors'
import { createChatRevision } from '../../src/selection/revisionMapping'
import type {
  ChatAnchor,
  ChatRevision,
  RenderedRange,
  RevisionMapping,
} from '../../src/selection/types'

const range = (start: number, end: number): RenderedRange => ({ space: 'rendered', start, end })
const revision = (revisionId: string, content: string, messageId = 'message-a') =>
  createChatRevision(
    { chatId: 'chat-a', messageId, content },
    { nextId: () => revisionId, project: (text) => ({ version: 'plain-v1', text }) }
  )
const capture = (source: ChatRevision, start = 5, end = 9) =>
  captureChatSelection({
    revision: source,
    range: range(start, end),
    sentence: source.projection.text,
    title: 'Sample conversation',
    pathHint: 'Conversations/sample.abchat',
    role: 'assistant',
    author: 'Sample assistant',
  })
const anchor = (source: ChatRevision, start = 5, end = 9) =>
  createChatAnchor(capture(source, start, end), source, () => 'anchor-a')
const proof = (
  from: ChatRevision,
  to: ChatRevision,
  start: number,
  end: number,
  text: string
): RevisionMapping => ({
  kind: 'proven',
  from: from.reference,
  to: to.reference,
  projectionVersion: 'plain-v1',
  edits: [{ range: range(start, end), text }],
})

describe('selection snapshots and chat anchors', () => {
  it('captures the exact repeated occurrence with source identity and context', () => {
    const source = revision('revision-a', 'echo echo tail')
    const snapshot = capture(source)
    expect(snapshot).toEqual({
      text: 'echo',
      sentence: 'echo echo tail',
      title: 'Sample conversation',
      pathHint: 'Conversations/sample.abchat',
      source: {
        kind: 'chat',
        chatId: 'chat-a',
        messageId: 'message-a',
        revisionId: 'revision-a',
        role: 'assistant',
        author: 'Sample assistant',
        quote: 'echo',
        range: range(5, 9),
        projectionVersion: 'plain-v1',
        context: { before: 'echo ', after: ' tail' },
      },
    })
    const first = createChatAnchor(capture(source, 0, 4), source, () => 'anchor-first')
    const second = anchor(source)
    expect(first.id).not.toBe(second.id)
    expect(resolveChatAnchor(first, source.reference, [source])).toMatchObject({
      status: 'current',
      placement: { range: range(0, 4) },
    })
    expect(resolveChatAnchor(second, source.reference, [source])).toMatchObject({
      status: 'current',
      placement: { range: range(5, 9) },
    })
  })

  it('copies and freezes every nested snapshot and placement', () => {
    const source = revision('revision-a', 'echo echo')
    const inputRange = range(5, 9)
    const snapshot = captureChatSelection({
      revision: source,
      range: inputRange,
      sentence: 'echo echo',
      title: 'Sample',
      pathHint: '',
      role: 'user',
      author: 'Sample user',
    })
    const saved = createChatAnchor(snapshot, source, () => 'anchor-a')
    expect(snapshot.source.range).not.toBe(inputRange)
    for (const object of [
      snapshot,
      snapshot.source,
      snapshot.source.context,
      snapshot.source.range,
      saved,
      saved.snapshot,
      saved.original,
      saved.placements,
      saved.placements[0],
      saved.placements[0].revision,
      saved.placements[0].range,
    ]) {
      expect(Object.isFrozen(object)).toBe(true)
    }
  })

  it('captures books without pretending they are chats', () => {
    const input = {
      text: 'sample passage',
      sentence: 'A sample passage.',
      title: 'Sample book',
      pathHint: 'Library/sample.epub',
      source: {
        kind: 'book' as const,
        place: 'sample-place',
        chapter: 'Section one',
        language: 'en',
      },
    }
    const snapshot = captureBookSelection(input)
    expect(snapshot).toEqual(input)
    expect(snapshot.source).not.toBe(input.source)
    expect(Object.isFrozen(snapshot.source)).toBe(true)
    expect(Object.isFrozen(snapshot)).toBe(true)
  })

  it('rejects empty, fractional, out-of-bounds, source-coordinate and split-surrogate selections', () => {
    const source = revision('revision-a', '🙂 echo')
    for (const invalid of [
      range(3, 3),
      range(0.5, 2),
      range(-1, 2),
      range(3, 20),
      range(1, 2),
      { space: 'source', start: 3, end: 7 } as unknown as RenderedRange,
    ]) {
      expect(() =>
        captureChatSelection({
          revision: source,
          range: invalid,
          sentence: '',
          title: '',
          pathHint: '',
          role: 'user',
          author: '',
        })
      ).toThrow()
    }
  })

  it('captures decomposed Unicode and formatting-spanning rendered text exactly', () => {
    const source = createChatRevision(
      { chatId: 'chat-a', messageId: 'message-a', content: '**🙂 e\u0301** tail' },
      {
        nextId: () => 'revision-a',
        project: () => ({ version: 'sample-inline-v1', text: '🙂 e\u0301 tail' }),
      }
    )
    const saved = anchor(source, 0, 10)
    expect(saved.snapshot.text).toBe('🙂 e\u0301 tail')
    expect(saved.snapshot.source.range).toEqual(range(0, 10))
    expect(resolveChatAnchor(saved, source.reference, [source]).status).toBe('current')
  })

  it('does not split surrogate pairs when clipping surrounding display context', () => {
    const source = revision('revision-a', '🙂' + 'a'.repeat(31) + 'echo' + 'b'.repeat(31) + '🙂')
    const snapshot = capture(source, 33, 37)
    expect(snapshot.source.context).toEqual({ before: 'a'.repeat(31), after: 'b'.repeat(31) })
  })

  it('refuses anchor creation for a stale snapshot even when versions have equal bytes', () => {
    const from = revision('revision-a', 'echo echo')
    const to = revision('revision-b', 'echo echo')
    expect(() => createChatAnchor(capture(from), to, () => 'anchor-a')).toThrow()
    expect(() => createChatAnchor(capture(from), from, () => '')).toThrow()
    expect(() =>
      createChatAnchor({ ...capture(from), text: 'other' }, from, () => 'anchor-a')
    ).toThrow()
  })

  it('keeps immutable original identity and adds only a proven subsequent placement', () => {
    const from = revision('revision-a', 'echo echo')
    const to = revision('revision-b', 'prefix echo echo')
    const original = anchor(from)
    const result = advanceChatAnchor(original, from, to, proof(from, to, 0, 0, 'prefix '))
    expect(result.status).toBe('mapped')
    expect(result.anchor.id).toBe(original.id)
    expect(result.anchor.original).toEqual(original.original)
    expect(result.anchor.snapshot).toBe(original.snapshot)
    expect(original.placements).toHaveLength(1)
    expect(result.anchor.placements).toHaveLength(2)
    expect(Object.isFrozen(result.anchor.placements)).toBe(true)
    expect(resolveChatAnchor(result.anchor, to.reference, [from, to])).toMatchObject({
      status: 'current',
      revision: to,
      placement: { range: range(12, 16) },
    })
    expect(
      advanceChatAnchor(result.anchor, from, to, proof(from, to, 0, 0, 'prefix ')).anchor
    ).toBe(result.anchor)
  })

  it.each(['intersecting', 'ambiguous'] as const)(
    'preserves a historical placement after %s edits',
    (status) => {
      const from = revision('revision-a', 'echo echo')
      const to = revision('revision-b', status === 'intersecting' ? 'echo changed' : 'echo echo')
      const original = anchor(from)
      const mapping: RevisionMapping =
        status === 'intersecting'
          ? proof(from, to, 5, 9, 'changed')
          : { kind: 'ambiguous', from: from.reference, to: to.reference }
      const result = advanceChatAnchor(original, from, to, mapping)
      expect(result.status).toBe(status)
      expect(result.anchor).toBe(original)
      expect(resolveChatAnchor(result.anchor, to.reference, [from, to])).toMatchObject({
        status: 'historical',
        revision: from,
        placement: { range: range(5, 9) },
      })
    }
  )

  it('does not promote equal text in a distinct revision without provenance', () => {
    const from = revision('revision-a', 'echo echo')
    const to = revision('revision-b', 'echo echo')
    expect(resolveChatAnchor(anchor(from), to.reference, [from, to])).toMatchObject({
      status: 'historical',
      revision: from,
    })
    expect(advanceChatAnchor(anchor(from), from, to).status).toBe('ambiguous')
  })

  it('undo selects the corresponding retained version placement, not a guessed quote', () => {
    const first = revision('revision-a', 'echo echo')
    const second = revision('revision-b', 'prefix echo echo')
    const third = revision('revision-c', 'prefix echo changed')
    const translated = advanceChatAnchor(
      anchor(first),
      first,
      second,
      proof(first, second, 0, 0, 'prefix ')
    ).anchor
    const changed = advanceChatAnchor(
      translated,
      second,
      third,
      proof(second, third, 12, 16, 'changed')
    ).anchor
    expect(resolveChatAnchor(changed, third.reference, [first, second, third]).status).toBe(
      'historical'
    )
    expect(resolveChatAnchor(changed, second.reference, [first, second, third])).toMatchObject({
      status: 'current',
      placement: { range: range(12, 16) },
    })
    expect(resolveChatAnchor(changed, first.reference, [first, second, third])).toMatchObject({
      status: 'current',
      placement: { range: range(5, 9) },
    })
  })

  it('shared ancestor anchors are available on both descendant branches, never inherited by replacements', () => {
    const ancestor = revision('revision-a', 'echo echo')
    const left = revision('revision-left', 'left branch', 'message-left')
    const right = revision('revision-right', 'right branch', 'message-right')
    const saved = anchor(ancestor)
    for (const branch of [
      [ancestor, left],
      [ancestor, right],
    ]) {
      expect(resolveChatAnchor(saved, branch[0].reference, branch).status).toBe('current')
    }
    for (const messageId of ['regenerated-message', 'edited-user-message']) {
      const replacement = revision('revision-new', 'echo echo', messageId)
      expect(resolveChatAnchor(saved, replacement.reference, [ancestor, replacement])).toEqual({
        status: 'missing',
        reason: 'message',
      })
      expect(
        advanceChatAnchor(saved, ancestor, replacement, proof(ancestor, replacement, 0, 0, ''))
          .anchor
      ).toBe(saved)
    }
  })

  it('reports missing targets separately from unresolved retained source', () => {
    const source = revision('revision-a', 'echo echo')
    const saved = anchor(source)
    expect(resolveChatAnchor(undefined, source.reference, [source])).toEqual({
      status: 'missing',
      reason: 'anchor',
    })
    expect(resolveChatAnchor(saved, undefined, [source])).toEqual({
      status: 'missing',
      reason: 'message',
    })
    expect(
      resolveChatAnchor(saved, { ...source.reference, chatId: 'chat-other' }, [source])
    ).toEqual({ status: 'missing', reason: 'chat' })
    expect(resolveChatAnchor(saved, source.reference, [])).toEqual({
      status: 'unresolved',
      snapshot: saved.snapshot,
    })
  })

  it('retains the original quote if retained projection or placement cannot be validated', () => {
    const source = revision('revision-a', 'echo echo')
    const saved = anchor(source)
    const projectionChanged = { ...source, projection: { version: 'plain-v2', text: 'echo echo' } }
    expect(resolveChatAnchor(saved, source.reference, [projectionChanged])).toEqual({
      status: 'unresolved',
      snapshot: saved.snapshot,
    })
    const corrupted = { ...saved, placements: [{ ...saved.placements[0], range: range(4, 8) }] }
    expect(resolveChatAnchor(corrupted, source.reference, [source])).toEqual({
      status: 'unresolved',
      snapshot: saved.snapshot,
    })
  })

  it('does not validate a different repeated occurrence as the original capture', () => {
    const source = revision('revision-a', 'echo echo')
    const saved = anchor(source)
    const corrupted = {
      ...saved,
      placements: [{ ...saved.placements[0], range: range(0, 4) }],
    }
    expect(resolveChatAnchor(corrupted, source.reference, [source])).toEqual({
      status: 'unresolved',
      snapshot: saved.snapshot,
    })
    const to = revision('revision-b', 'prefix echo echo')
    expect(
      advanceChatAnchor(corrupted, source, to, proof(source, to, 0, 0, 'prefix '))
    ).toMatchObject({ status: 'invalid', anchor: corrupted })
  })

  it('never resolves duplicate revision identities, even with equal content', () => {
    const source = revision('revision-a', 'echo echo')
    expect(resolveChatAnchor(anchor(source), source.reference, [source, { ...source }])).toEqual({
      status: 'ambiguous',
      reason: 'revision',
    })
  })

  it('never chooses among conflicting placements for repeated quotes', () => {
    const source = revision('revision-a', 'echo echo')
    const saved = anchor(source)
    const corrupted: ChatAnchor = {
      ...saved,
      placements: [saved.placements[0], { ...saved.placements[0], range: range(0, 4) }],
    }
    expect(resolveChatAnchor(corrupted, source.reference, [source])).toEqual({
      status: 'ambiguous',
      reason: 'placement',
    })
    const to = revision('revision-b', 'echo echo')
    expect(advanceChatAnchor(corrupted, source, to, proof(source, to, 0, 0, '')).status).toBe(
      'ambiguous'
    )
  })
})
