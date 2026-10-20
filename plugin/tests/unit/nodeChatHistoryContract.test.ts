import { expect, it } from 'vitest'
import { ref } from 'vue'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { NodeConnection } from '@/node/NodeService'

it.fails(
  'BUG: node chats need rewind, branch and edit history once the checkpoint contract is available',
  () => {
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
      new MemoryClientStore()
    )
    const presenter = new NodeChatPresenter(
      {
        kind: 'node-session',
        nodeId: 'sample-node',
        registrationId: 'sample-registration',
        sessionId: 'sample-session',
        title: 'Sample',
      },
      { client, state: ref('offline'), error: ref('') } as unknown as NodeConnection
    )
    try {
      expect(presenter.capabilities).toMatchObject({
        rewind: true,
        branches: true,
        editHistory: true,
      })
    } finally {
      presenter.destroy()
    }
  }
)
