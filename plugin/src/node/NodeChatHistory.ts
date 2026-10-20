import type { NodeClient } from '@abele/node-client'
import { shallowRef } from 'vue'
import { t } from '@/i18n'
export type NodeCheckpoint = Awaited<ReturnType<NodeClient['chat']['checkpoints']>>[number]
export type NodeChatPreview = Awaited<ReturnType<NodeClient['chat']['preview']>>
export type NodeHistoryAction = 'rewind' | 'branch' | 'edit' | 'retry'
export class NodeChatHistory {
  readonly checkpoints = shallowRef<NodeCheckpoint[]>([])
  private readonly previews = new Map<
    string,
    { checkpoint: string; changes: NodeChatPreview['changes'] }
  >()
  constructor(
    private client: () => NodeClient,
    private sessionId: string,
    private unavailable: () => string
  ) {}
  async read(): Promise<void> {
    this.checkpoints.value = await this.client().chat.checkpoints(this.sessionId)
  }
  async preview(point: NodeCheckpoint): Promise<NodeChatPreview> {
    this.check()
    const preview = await this.client().chat.preview(this.sessionId, point.checkpoint_id)
    this.previews.set(preview.preview_id, {
      checkpoint: point.checkpoint_id,
      changes: structuredClone(preview.changes),
    })
    return preview
  }
  async restore(
    point: NodeCheckpoint,
    action: NodeHistoryAction,
    text?: string,
    files?: NodeChatPreview
  ): Promise<{ session_id: string }> {
    this.check()
    const shown = files && this.previews.get(files.preview_id)
    if (files && (action !== 'rewind' || shown?.checkpoint !== point.checkpoint_id))
      throw new Error(t('streamB.nodeHistoryFreshPreview'))
    // The typed SDK sends this online, never through the durable offline outbox. A failed
    // or disconnected operation is not replayed here, especially when it restores files.
    if (files) this.previews.delete(files.preview_id)
    return this.client().chat.restore({
      session_id: this.sessionId,
      checkpoint_id: point.checkpoint_id,
      action,
      ...(action === 'edit' && text !== undefined ? { text } : {}),
      ...(files && shown
        ? { restore_files: { preview_id: files.preview_id, changes: shown.changes } }
        : {}),
    })
  }
  private check(): void {
    const reason = this.unavailable()
    if (reason) throw new Error(reason)
  }
}
