import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClient } from '@abele/node-client'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { NodeClientStore } from '@/node/NodeClientStore'
import type { NodeConnection } from '@/node/NodeService'
import { chatMovedNotice } from '@/node/expectedTarget'

it.each([false, true])(
  'recovers a target-refused draft from a receipt after presenter reconstruction without overwriting newer text (newer: %s)',
  async (newer) => {
    const factory = new IDBFactory()
    const store = new NodeClientStore('sample-guarded-draft', factory)
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
      store
    )
    vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
    const connection = {
      client,
      state: ref('connected'),
      error: ref(''),
    } as unknown as NodeConnection
    const reference = {
      kind: 'node-session' as const,
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      sessionId: 'sample-session',
      title: 'Sample chat',
    }
    const presenter = new NodeChatPresenter(reference, connection)
    presenter.nodeDescription.value = { version: '0.4.2' }
    presenter.draft.value.text = '  Sample refused bytes\nwith another line  '
    const text = presenter.draft.value.text
    let finish!: () => void
    const flush = vi.spyOn(client, 'flush').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const sending = presenter.send(text.trim(), undefined, {
      nodeId: reference.nodeId,
      registrationId: reference.registrationId,
      projectId: 'sample-project',
      kind: 'worktree',
      id: 'sample-tree',
      incarnation: 'sample-old-binding',
    })
    await vi.waitFor(() => expect(flush).toHaveBeenCalledOnce())
    presenter.destroy()
    const reloadedStore = new NodeClientStore('sample-guarded-draft', factory)
    const reloadedClient = new NodeClient(client.target, reloadedStore)
    const reopened = new NodeChatPresenter(reference, {
      client: reloadedClient,
      state: ref('offline'),
      error: ref(''),
    } as unknown as NodeConnection)
    try {
      await reopened.refresh()
      expect(reopened.draft.value.text).toBe('') // Unknown outcome is not another sendable draft.
      if (newer) {
        reopened.draft.value.text = 'Sample newer draft'
        await reopened.refresh()
      }
      await reloadedStore.transaction((state) => {
        const request = state.outbox.shift()!
        state.results[request.operation_id] = {
          result: { code: 'target_changed', current_target: null },
        }
      })
      await reopened.refresh()
      expect(reopened.draft.value.text).toBe(newer ? 'Sample newer draft' : text)
      if (!newer) expect(reopened.draftNotice.value).toBe(chatMovedNotice)
      expect(await reloadedClient.pending()).toEqual([])
    } finally {
      finish()
      await sending
      reopened.destroy()
      store.close()
      reloadedStore.close()
      vi.restoreAllMocks()
    }
  }
)
