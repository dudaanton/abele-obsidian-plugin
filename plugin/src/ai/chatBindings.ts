import { nanoid } from 'nanoid'
import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { anchorBacklink } from '@/selection/anchorLinks'
import { bindingRecoveryAction } from '@/selection/bindingRecovery'
import { undoBindingEdit } from '@/selection/bindingEdits'
import type {
  SelectionBindingRecovery,
  SelectionBindingResult,
  SelectionBindingOperation,
} from '@/selection/bindings'
import type { ChatSelectionSnapshot, ChatRevision } from '@/selection/types'
import { sameRevision } from '@/selection/revisionMapping'
import { ensureCapturedAnchor } from './chatAnchorStore'
import { prepareChatBindingEdit, renameBoundMessage } from './chatBindingEdits'
import { replyMarkdownText } from './replyMarkdown'
import { BindingWriteFailure } from './chatBindingWrite'
import type { ChatSession } from './ChatSession'
import type { ChatMessage } from './types'
import { ChatStorage } from './ChatStorage'
import { bindingProof, transferBindingOwnership } from './chatBindingProof'
import { prepareSelectionRevision } from './chatAnchorStore'
import type { ReplyTextRenderer } from './replyPassage'

const key = (entry: SelectionBindingRecovery) => entry.id ?? entry.operation?.id ?? ''
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Thin chat/Markdown adapter. A binding never creates, reads or deletes a card. */
export class ChatSelectionBindings {
  constructor(
    private readonly session: ChatSession,
    private readonly render: ReplyTextRenderer = replyMarkdownText
  ) {}

  private result(entry: SelectionBindingRecovery, recoverable = true): SelectionBindingResult {
    const source = entry.snapshot?.source ?? entry.operation?.captured
    const anchorId = entry.anchorId ?? entry.operation?.anchorId
    return {
      status: entry.status,
      operationId: key(entry),
      targetPath: entry.targetPath,
      recoverable,
      backlink:
        source && anchorId
          ? anchorBacklink(this.session.currentChatFile.value?.path ?? '', {
              chatId: source.chatId,
              anchorId,
            })
          : '',
      ...(entry.evidence ? { reason: entry.evidence } : {}),
    }
  }

  async bind(
    snapshot: ChatSelectionSnapshot,
    anchorId: string,
    targetPath: string,
    signal?: AbortSignal
  ): Promise<SelectionBindingResult> {
    signal?.throwIfAborted()
    const { app } = GlobalStore.getInstance()
    const target =
      app.vault.getAbstractFileByPath(targetPath) ??
      app.vault.getAbstractFileByPath(`${targetPath}.md`)
    if (!(target instanceof TFile) || target.extension !== 'md')
      throw new Error(`No card at ${targetPath}. Nothing was linked.`)
    const existing = this.session
      .bindingState()
      .recovery.find(
        (entry) =>
          (entry.anchorId ?? entry.operation?.anchorId) === anchorId &&
          entry.targetPath === target.path &&
          entry.status !== 'undone' &&
          sameRevision(entry.snapshot?.source ?? entry.operation!.captured, snapshot.source)
      )
    if (existing) return this.result(existing)
    const entry: SelectionBindingRecovery = {
      id: nanoid(),
      anchorId,
      snapshot,
      targetPath: target.path,
      status: 'pending',
    }
    try {
      await this.session.changeBindings(async (state) => ({
        recovery: [...state.recovery, entry],
        result: undefined,
      }))
    } catch (error) {
      return this.result(
        {
          ...entry,
          status:
            error instanceof BindingWriteFailure && error.uncertain
              ? 'uncertain'
              : 'known-not-written',
          evidence: `The card is kept at ${target.path}. Recovery intent could not be saved: ${errorText(error)}`,
        },
        false
      )
    }
    return this.publish(key(entry), signal)
  }

  async retry(operationId: string): Promise<SelectionBindingResult> {
    const entry = this.session.bindingState().recovery.find((e) => key(e) === operationId)
    if (!entry) throw new Error('This binding recovery is unavailable.')
    const evidence = this.session
      .bindingState()
      .messages.some((m) =>
        m.decorationOperations?.some((op) => op.id === operationId && !op.undoneAt)
      )
    const action = bindingRecoveryAction(entry.status, evidence)
    if (action === 'applied') return this.result({ ...entry, status: 'applied' })
    if (action !== 'retry')
      return this.result({
        ...entry,
        evidence:
          entry.evidence ??
          'Publication is uncertain. Inspect the persisted source; do not replay this operation.',
      })
    return this.publish(operationId)
  }

  private async publish(
    operationId: string,
    signal?: AbortSignal
  ): Promise<SelectionBindingResult> {
    let entry = this.session.bindingState().recovery.find((e) => key(e) === operationId)!
    try {
      signal?.throwIfAborted()
      if (!entry.snapshot || !entry.anchorId)
        throw new Error('This older recovery lacks a captured selection. Select the source again.')
      const index = await ChatStorage.getInstance().selectionIdentityIndex()
      const paths = index.filter((item) => item.chatId === entry.snapshot!.source.chatId)
      if (paths.length !== 1 || paths[0].path !== this.session.currentChatFile.value?.path)
        throw new Error(
          'The conversation identity is missing or duplicated. Choose and reopen the source before linking.'
        )
      const target = GlobalStore.getInstance().app.vault.getAbstractFileByPath(entry.targetPath)
      if (!(target instanceof TFile))
        throw new Error(`The card at ${entry.targetPath} is unavailable. Nothing was linked.`)
      // Persist uncertainty BEFORE publication. A crash at any later point is never permission to retry blindly.
      entry = {
        ...entry,
        status: 'uncertain',
        evidence: 'Publication has not been acknowledged. Inspect source before retrying.',
      }
      await this.session.changeBindings(async (state) => ({
        recovery: state.recovery.map((e) => (key(e) === operationId ? entry : e)),
        result: undefined,
      }))
      const result = await this.session.changeBindings(async (state) => {
        signal?.throwIfAborted()
        const snapshot = entry.snapshot!
        const message = state.messages.find((m) => m.id === snapshot.source.messageId)
        if (!message || message.draft || message.role !== snapshot.source.role)
          throw new Error('The saved source message is unavailable.')
        ensureCapturedAnchor(message, snapshot.source.chatId, snapshot, () => entry.anchorId!)
        if (!message.selection?.anchors.some((a) => a.id === entry.anchorId))
          throw new Error('The durable source anchor is unavailable.')
        if (
          message.decorationOperations?.some((op) => op.anchorId === entry.anchorId && !op.undoneAt)
        )
          throw new Error('This selection already has a card link.')
        const patch = await prepareChatBindingEdit(
          message.content,
          snapshot.text,
          snapshot.source.range.start,
          this.render,
          entry.targetPath
        )
        const projected = await this.render(patch.result)
        if (
          projected !==
          message.selection.versions.find((v) => sameRevision(v.reference, snapshot.source))
            ?.projection.text
        )
          throw new Error('The source renderer changed. Select the source again.')
        signal?.throwIfAborted()
        const resulting = { ...snapshot.source, revisionId: nanoid() }
        const operation: SelectionBindingOperation = {
          id: operationId,
          bindingId: operationId,
          anchorId: entry.anchorId!,
          targetPath: entry.targetPath,
          captured: snapshot.source,
          patch: { range: patch.range, before: patch.before, after: patch.after },
          resulting,
          ownership: { revision: resulting, start: patch.range.start, after: patch.after },
        }
        const decorated = this.revision(message, patch.result, resulting.revisionId, projected)
        decorated.decorationOperations = [
          ...transferBindingOwnership(
            message,
            decorated,
            patch.range.start,
            patch.before.length,
            patch.after.length
          ),
          operation,
        ]
        entry = { ...entry, operation, status: 'applied', evidence: undefined }
        return {
          message: decorated,
          recovery: state.recovery.map((e) => (key(e) === operationId ? entry : e)),
          result: this.result(entry),
        }
      })
      return result
    } catch (error) {
      if (error instanceof BindingWriteFailure && error.uncertain) {
        try {
          if (await this.session.inspectBindingWrite(operationId))
            return this.result({ ...entry, status: 'applied', evidence: undefined })
        } catch {
          /* Keep the durable uncertain journal. */
        }
        return this.result({ ...entry, status: 'uncertain', evidence: errorText(error) })
      }
      entry = { ...entry, status: 'known-not-written', evidence: errorText(error) }
      try {
        await this.session.changeBindings(async (state) => ({
          recovery: state.recovery.map((e) => (key(e) === operationId ? entry : e)),
          result: undefined,
        }))
      } catch {
        return this.result({
          ...entry,
          status: 'uncertain',
          evidence: `Could not save failure status: ${errorText(error)}`,
        })
      }
      return this.result(entry)
    }
  }

  /** Projection is unchanged, so every current exact placement transfers without a quote search. */
  private revision(
    message: ChatMessage,
    content: string,
    revisionId: string,
    text: string
  ): ChatMessage {
    const chatId = message.selection!.versions[0].reference.chatId
    const { selection, revision: prior } = prepareSelectionRevision(message, chatId, {
      nextId: nanoid,
      project: () => ({ version: message.selection!.versions[0].projection.version, text }),
    })
    if (prior.projection.text !== text)
      throw new Error('Cannot prove annotation placement on this source revision.')
    const reference = { ...prior.reference, revisionId }
    const version: ChatRevision = { reference, content, projection: prior.projection }
    return {
      ...message,
      content,
      selection: {
        ...selection,
        revisionId,
        versions: [...selection.versions, version],
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

  async rename(oldPath: string, newPath: string): Promise<void> {
    for (const message of this.session.bindingState().messages) {
      if (!message.decorationOperations?.some((op) => op.targetPath === oldPath && !op.undoneAt))
        continue
      await this.session.changeBindings(async (state) => {
        const current = state.messages.find((m) => m.id === message.id)!
        const after = await renameBoundMessage(current, oldPath, newPath, this.render)
        return {
          message: after,
          recovery: state.recovery.map((entry) =>
            entry.targetPath === oldPath
              ? {
                  ...entry,
                  targetPath: newPath,
                  operation:
                    after.decorationOperations?.find((op) => op.id === key(entry)) ??
                    entry.operation,
                }
              : entry
          ),
          result: undefined,
        }
      })
    }
    if (this.session.bindingState().recovery.some((entry) => entry.targetPath === oldPath))
      await this.session.changeBindings(async (state) => ({
        recovery: state.recovery.map((entry) =>
          entry.targetPath === oldPath ? { ...entry, targetPath: newPath } : entry
        ),
        result: undefined,
      }))
  }

  async undo(operationId: string): Promise<void> {
    await this.session.changeBindings(async (state) => {
      const message = state.messages.find((m) =>
        m.decorationOperations?.some((op) => op.id === operationId)
      )
      const operation = message?.decorationOperations?.find((op) => op.id === operationId)
      if (!message || !operation || operation.undoneAt)
        throw new Error('This link cannot be removed with its recorded inverse.')
      const proof = bindingProof(message, operation)
      const content = undoBindingEdit(message.content, proof.content, proof.patch)
      const projected = await this.render(content)
      const after = this.revision(message, content, nanoid(), projected)
      after.decorationOperations = transferBindingOwnership(
        message,
        after,
        proof.at,
        proof.patch.after.length,
        operation.patch.before.length,
        operationId
      ).map((op) => (op.id === operationId ? { ...op, undoneAt: Date.now() } : op))
      return {
        message: after,
        recovery: state.recovery.map((e) =>
          key(e) === operationId ? { ...e, status: 'undone', evidence: undefined } : e
        ),
        result: undefined,
      }
    })
  }
}
