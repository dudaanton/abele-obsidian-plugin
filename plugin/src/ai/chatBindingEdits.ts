import { prepareBindingEdit } from '@/selection/bindingEdits'
import type { ReplyTextRenderer } from './replyPassage'
import { nanoid } from 'nanoid'
import type { ChatMessage } from './types'
import { prepareSelectionRevision } from './chatAnchorStore'
import { sameRevision } from '@/selection/revisionMapping'
import { bindingProof, transferBindingOwnership } from './chatBindingProof'

export function bindingRevision(message: ChatMessage, content: string, text: string): ChatMessage {
  const chatId = message.selection.versions[0].reference.chatId
  const { selection, revision: prior } = prepareSelectionRevision(message, chatId, {
    nextId: nanoid,
    project: () => ({ version: message.selection.versions[0].projection.version, text }),
  })
  if (prior.projection.text !== text)
    throw new Error('Cannot prove annotation placement on this source revision.')
  const revisionId = nanoid()
  const reference = { ...prior.reference, revisionId }
  return {
    ...message,
    content,
    selection: {
      ...selection,
      revisionId,
      versions: [...selection.versions, { reference, content, projection: prior.projection }],
      anchors: selection.anchors.map((anchor) => ({
        ...anchor,
        placements: [
          ...anchor.placements,
          ...anchor.placements
            .filter((p) => sameRevision(p.revision, prior.reference))
            .map((p) => ({ ...p, revision: reference })),
        ],
      })),
    },
  }
}

export async function renameBoundMessage(
  message: ChatMessage,
  oldPath: string,
  newPath: string,
  render: ReplyTextRenderer
): Promise<ChatMessage> {
  let current = message
  for (const operation of message.decorationOperations ?? []) {
    if (operation.undoneAt || operation.targetPath !== oldPath) continue
    if (/[[\]|#^\n\r]/u.test(newPath))
      throw new Error('The renamed card path cannot be represented safely in a wikilink.')
    const proof = bindingProof(
      current,
      current.decorationOperations.find((op) => op.id === operation.id)
    )
    const after = proof.patch.after.replace(
      `[[${oldPath.replace(/\.md$/u, '')}`,
      `[[${newPath.replace(/\.md$/u, '')}`
    )
    if (after === proof.patch.after) throw new Error('The owned link target is unavailable.')
    const content =
      current.content.slice(0, proof.at) +
      after +
      current.content.slice(proof.at + proof.patch.after.length)
    const projected = await render(content)
    if (projected !== (await render(current.content)))
      throw new Error('The renamed link would change rendered text.')
    const next = bindingRevision(current, content, projected)
    const reference = next.selection.versions.at(-1).reference
    next.decorationOperations = transferBindingOwnership(
      current,
      next,
      proof.at,
      proof.patch.after.length,
      after.length,
      operation.id
    ).map((op) =>
      op.id === operation.id
        ? { ...op, targetPath: newPath, ownership: { revision: reference, start: proof.at, after } }
        : op
    )
    current = next
  }
  return current
}

/** Markdown restrictions live in this format adapter, never in the selection model. */
export function prepareChatBindingEdit(
  content: string,
  quote: string,
  start: number,
  render: ReplyTextRenderer,
  targetPath: string
) {
  if (!targetPath || /[[\]|#^\n\r]/u.test(targetPath))
    throw new Error('This card path cannot be represented safely as a wikilink. The card was kept.')
  if (/[[\]|\n\r]/u.test(quote))
    throw new Error('Select words within one line. The card was kept.')
  return prepareBindingEdit(content, quote, start, render, (label, passage) => {
    // Reject code and existing links even when their displayed label looks like ordinary prose.
    const lineStart = content.lastIndexOf('\n', passage.from - 1) + 1
    const lineEnd = content.indexOf('\n', passage.from)
    const line = content.slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
    const prefix = content.slice(0, lineStart)
    const syntax = [...line.matchAll(/\[\[[^\n]*?\]\]|\[[^\n]*?\]\([^)]*\)|`+[^`]*`+/gu)]
    const overlaps = syntax.some((match) => {
      const from = lineStart + match.index
      return from < passage.from + passage.old.length && from + match[0].length > passage.from
    })
    if (
      overlaps ||
      (prefix.match(/^\s*(?:```|~~~)/gm)?.length ?? 0) % 2 ||
      /[[\]`]/u.test(passage.old)
    )
      throw new Error('Cannot safely link words in code or an existing link. The card was kept.')
    // In table cells wikilink pipes must be escaped, and some renderers do not preserve them.
    const outsideSyntax = line.replace(/\[\[[^\n]*?\]\]|\[[^\n]*?\]\([^)]*\)|`+[^`]*`+/gu, '')
    const aliasPipe = outsideSyntax.includes('|') ? '\\|' : '|'
    return `[[${targetPath.replace(/\.md$/u, '')}${aliasPipe}${label}]]`
  })
}
