// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { prepareSelectionRevision, ensureCapturedAnchor } from '@/ai/chatAnchorStore'
import { acceptRevision, undoRevision } from '@/ai/replyAnnotations'
import { captureChatSelection } from '@/selection/anchors'
import type { ChatMessage } from '@/ai/types'
import type { RevisionPorts } from '@/selection/types'

function fixture() {
  let id = 0
  const ports: RevisionPorts = {
    nextId: () => `id-${++id}`,
    project: (text) => ({ version: 'test-v1', text: text.replaceAll('**', '') }),
  }
  const message: ChatMessage = {
    id: 'message',
    role: 'assistant',
    content: '**word** word',
    timestamp: 1,
  }
  const { selection, revision } = prepareSelectionRevision(message, 'chat', ports)
  const snapshot = captureChatSelection({
    revision,
    range: { space: 'rendered', start: 5, end: 9 },
    role: 'assistant',
    author: '',
    sentence: '',
    title: '',
    pathHint: 'sample.abchat',
  })
  return { ports, message: { ...message, selection }, revision, snapshot }
}

describe('selection storage transformations', () => {
  it('validates exact rendered identity without interpreting rendered offsets as source offsets', () => {
    const { message, snapshot, ports } = fixture()
    const { selection, anchor } = ensureCapturedAnchor(message, 'chat', snapshot, ports.nextId)
    expect(anchor.snapshot.source.range.start).toBe(5)
    expect(message.content.slice(5, 9)).not.toBe('word')
    expect(selection.versions).toHaveLength(1)
    expect(message.selection.anchors).toEqual([])
    expect(
      ensureCapturedAnchor({ ...message, selection }, 'chat', snapshot, ports.nextId).anchor
    ).toBe(anchor)
    expect(() => ensureCapturedAnchor(message, 'other-chat', snapshot, ports.nextId)).toThrow(
      /changed/
    )
    expect(() =>
      ensureCapturedAnchor({ ...message, content: 'different' }, 'chat', snapshot, ports.nextId)
    ).toThrow(/changed/)
    expect(() =>
      ensureCapturedAnchor(message, 'chat', { ...snapshot, text: 'invented' }, ports.nextId)
    ).toThrow(/changed/)
  })

  it('does not reuse a stored anchor with corrupted identity or placement evidence', () => {
    const { message, ports, snapshot } = fixture()
    const saved = ensureCapturedAnchor(message, 'chat', snapshot, ports.nextId)
    const corrupt = { ...saved.anchor, placements: [] }
    const repaired = ensureCapturedAnchor(
      { ...message, selection: { ...saved.selection, anchors: [corrupt] } },
      'chat',
      snapshot,
      ports.nextId
    )
    expect(repaired.anchor.id).not.toBe(corrupt.id)
    expect(repaired.anchor.placements).toHaveLength(1)
  })

  it('refuses duplicate versions, renderer changes and altered source with an existing version id', () => {
    const { message, revision, ports } = fixture()
    expect(() =>
      prepareSelectionRevision(
        { ...message, selection: { ...message.selection, versions: [revision, revision] } },
        'chat',
        ports
      )
    ).toThrow(/changed/)
    expect(() =>
      prepareSelectionRevision({ ...message, content: 'different' }, 'chat', ports)
    ).toThrow(/changed/)
    expect(() =>
      prepareSelectionRevision(message, 'chat', {
        ...ports,
        project: (text) => ({ version: 'new-v2', text }),
      })
    ).toThrow(/projection changed/)
  })

  it('does not collapse accepted equal-text versions, and undo restores the proven original', () => {
    const { message, ports, snapshot } = fixture()
    const anchored = {
      ...message,
      selection: ensureCapturedAnchor(message, 'chat', snapshot, ports.nextId).selection,
    }
    const after = acceptRevision(
      anchored,
      {
        id: 'proposal',
        parent: 'sample.abchat',
        message: message.id,
        before: message.content,
        from: 0,
        old: '**word**',
        text: '**word**',
        request: '',
        author: '',
        at: 2,
        status: 'pending',
      },
      3
    )
    expect(after.content).toBe(message.content)
    expect(after.selection!.revisionId).not.toBe(message.selection.revisionId)
    expect(after.selection!.anchors).toEqual(anchored.selection.anchors)
    expect(undoRevision(after, 4).selection!.revisionId).toBe(message.selection.revisionId)
    // Missing proof after an older-client rewrite must not infer identity from equal bytes.
    const stripped = {
      ...after,
      revisions: after.revisions!.map(({ beforeRevisionId, afterRevisionId, ...revision }) => {
        void beforeRevisionId
        void afterRevisionId
        return revision
      }),
    }
    expect(undoRevision(stripped, 4).selection!.revisionId).not.toBe(message.selection.revisionId)
  })
})
