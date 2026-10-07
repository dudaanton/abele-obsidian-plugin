// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createChatRevision, mapPlacement } from '../../src/selection/revisionMapping'
import type {
  AnchorPlacement,
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
const placement = (source: ChatRevision, start: number, end: number): AnchorPlacement => ({
  revision: source.reference,
  projectionVersion: source.projection.version,
  range: range(start, end),
})
const proof = (
  from: ChatRevision,
  to: ChatRevision,
  edits: { range: RenderedRange; text: string }[]
): RevisionMapping => ({
  kind: 'proven',
  from: from.reference,
  to: to.reference,
  projectionVersion: from.projection.version,
  edits,
})

describe('selection revision mapping', () => {
  it('assigns distinct version identities even for equal content', () => {
    const first = revision('revision-a', 'echo echo')
    const second = revision('revision-b', 'echo echo')
    expect(first.reference).not.toEqual(second.reference)
    expect(first.content).toBe(second.content)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.projection)).toBe(true)
    expect(Object.isFrozen(first.reference)).toBe(true)
  })

  it('translates the captured repeated occurrence using proven outside edits', () => {
    const from = revision('revision-a', 'echo echo tail')
    const to = revision('revision-b', 'prefix echo echo end')
    const result = mapPlacement(
      placement(from, 5, 9),
      'echo',
      from,
      to,
      proof(from, to, [
        { range: range(0, 0), text: 'prefix ' },
        { range: range(10, 14), text: 'end' },
      ])
    )
    expect(result).toEqual({
      status: 'mapped',
      placement: placement(to, 12, 16),
    })
  })

  it('uses UTF-16 offsets without normalizing Unicode', () => {
    const from = revision('revision-a', '🙂 e\u0301 🙂')
    const to = revision('revision-b', '界🙂 e\u0301 🙂')
    expect(
      mapPlacement(
        placement(from, 3, 5),
        'e\u0301',
        from,
        to,
        proof(from, to, [{ range: range(0, 0), text: '界' }])
      )
    ).toEqual({ status: 'mapped', placement: placement(to, 4, 6) })
  })

  it('rejects ranges or edits that split a surrogate pair', () => {
    const from = revision('revision-a', '🙂 echo')
    const to = revision('revision-b', '🙂 echo')
    expect(
      mapPlacement(placement(from, 1, 2), '\ude42', from, to, proof(from, to, []))
    ).toMatchObject({ status: 'invalid' })
    expect(
      mapPlacement(
        placement(from, 3, 7),
        'echo',
        from,
        to,
        proof(from, to, [{ range: range(1, 1), text: '' }])
      )
    ).toMatchObject({ status: 'invalid' })
  })

  it.each([
    { edit: { range: range(5, 9), text: 'echo' }, next: 'echo echo' },
    { edit: { range: range(6, 7), text: 'X' }, next: 'echo eXho' },
    { edit: { range: range(7, 7), text: 'X' }, next: 'echo ecXho' },
  ])('preserves the old placement for an intersecting edit: $next', ({ edit, next }) => {
    const from = revision('revision-a', 'echo echo')
    const to = revision('revision-b', next)
    const old = placement(from, 5, 9)
    expect(mapPlacement(old, 'echo', from, to, proof(from, to, [edit]))).toEqual({
      status: 'intersecting',
    })
    expect(old).toEqual(placement(from, 5, 9))
  })

  it('defines insertions at the edges as outside the selected interval', () => {
    const from = revision('revision-a', 'echo')
    const to = revision('revision-b', '(echo)')
    expect(
      mapPlacement(
        placement(from, 0, 4),
        'echo',
        from,
        to,
        proof(from, to, [
          { range: range(0, 0), text: '(' },
          { range: range(4, 4), text: ')' },
        ])
      )
    ).toEqual({ status: 'mapped', placement: placement(to, 1, 5) })
  })

  it('does not infer a mapping from equal text or a nearest quote', () => {
    const from = revision('revision-a', 'echo echo')
    const to = revision('revision-b', 'echo echo')
    expect(mapPlacement(placement(from, 5, 9), 'echo', from, to)).toEqual({ status: 'ambiguous' })
    expect(
      mapPlacement(placement(from, 5, 9), 'echo', from, to, {
        kind: 'ambiguous',
        from: from.reference,
        to: to.reference,
      })
    ).toEqual({ status: 'ambiguous' })
    expect(mapPlacement(placement(from, 5, 9), 'echo', from, to, proof(from, to, []))).toEqual({
      status: 'mapped',
      placement: placement(to, 5, 9),
    })
  })

  it('fails closed for overlapping edits and unverified replay', () => {
    const from = revision('revision-a', 'prefix echo')
    const to = revision('revision-b', 'prefix echo')
    expect(
      mapPlacement(
        placement(from, 7, 11),
        'echo',
        from,
        to,
        proof(from, to, [
          { range: range(0, 3), text: 'pre' },
          { range: range(2, 4), text: 'ef' },
        ])
      )
    ).toEqual({ status: 'ambiguous' })
    expect(
      mapPlacement(
        placement(from, 7, 11),
        'echo',
        from,
        to,
        proof(from, to, [{ range: range(0, 0), text: 'extra ' }])
      )
    ).toMatchObject({ status: 'invalid' })
  })

  it('cannot transfer a placement to regeneration or an edited-user branch', () => {
    const from = revision('revision-a', 'echo')
    for (const messageId of ['regenerated-message', 'edited-user-message']) {
      const to = revision('revision-b', 'echo', messageId)
      expect(
        mapPlacement(placement(from, 0, 4), 'echo', from, to, proof(from, to, []))
      ).toMatchObject({ status: 'invalid', reason: 'identity' })
    }
  })

  it('rejects mismatched version identities, quotes and projection versions', () => {
    const from = revision('revision-a', 'echo')
    const to = revision('revision-b', 'echo')
    const wrong = revision('revision-other', 'echo')
    expect(
      mapPlacement(placement(from, 0, 4), 'echo', from, to, proof(wrong, to, []))
    ).toMatchObject({ status: 'invalid', reason: 'identity' })
    expect(
      mapPlacement(placement(from, 0, 4), 'other', from, to, proof(from, to, []))
    ).toMatchObject({ status: 'invalid' })
    expect(
      mapPlacement(
        placement(from, 0, 4),
        'echo',
        from,
        { ...to, projection: { version: 'plain-v2', text: 'echo' } },
        proof(from, to, [])
      )
    ).toMatchObject({ status: 'invalid', reason: 'projection-version' })
  })

  it('keeps rendered positions separate from source formatting boundaries', () => {
    const project = (content: string) => ({
      version: 'sample-inline-v1',
      text: content.replaceAll('**', ''),
    })
    const from = createChatRevision(
      { chatId: 'chat-a', messageId: 'message-a', content: '**echo** echo' },
      { nextId: () => 'revision-a', project }
    )
    const to = createChatRevision(
      { chatId: 'chat-a', messageId: 'message-a', content: 'intro **echo** echo' },
      { nextId: () => 'revision-b', project }
    )
    expect(
      mapPlacement(
        placement(from, 5, 9),
        'echo',
        from,
        to,
        proof(from, to, [{ range: range(0, 0), text: 'intro ' }])
      )
    ).toEqual({ status: 'mapped', placement: placement(to, 11, 15) })
    expect(
      mapPlacement(
        placement(from, 9, 13),
        'echo',
        from,
        to,
        proof(from, to, [{ range: range(0, 0), text: 'intro ' }])
      )
    ).toMatchObject({ status: 'invalid' })
  })
})
