import { h, shallowRef } from 'vue'
import type { ChatSession } from '@/ai/ChatSession'
import { NodeSuggestModal } from '@/components/nodeWork/NodeSuggestModal'
import Setting from '@/components/obsidian/Setting.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Button from '@/components/obsidian/Button.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { nodePathDialog } from './NodePathDialogs'
import { NodePathService } from './NodePathService'
import { wirePathTarget } from './nodePathChat'
import type { NodePathContext, NodePathOwnerActions } from './NodePathOwnerActions'
import { giveObsidianChatAccess, revokeObsidianNodeScopeApprovals } from '@/ai/tools/node/owner'
import {
  addNodeContextToObsidianChat,
  askNodeContextInObsidianChat,
  type ObsidianNodeContext,
} from '@/ai/tools/node/context'

/** The public chat actions validate scope and record owner approval; prompt text grants nothing. */
export async function revokeNodePathChatApprovals(nodeId: string): Promise<void> {
  await revokeObsidianNodeScopeApprovals(nodeId)
}
export async function chooseNodePathChat(): Promise<ChatSession | undefined> {
  const { ChatService } = await import('@/ai/ChatService')
  const sessions = ChatService.getInstance().getAllSessions()
  return new Promise((resolve) => {
    class Picker extends NodeSuggestModal {
      onClose(): void {
        super.onClose()
        // Native prompts may close synchronously before delivering their selected item.
        queueMicrotask(() => resolve(undefined))
      }
    }
    new Picker(
      GlobalStore.getInstance().app,
      sessions.map((session) => ({
        id: session.id,
        title: session.chatTitle.value || 'Chat',
        icon: 'messages-square',
        kind: 'Obsidian chat',
      })),
      'Choose the Obsidian chat',
      (item) => resolve(sessions.find((session) => session.id === item.id)),
      'Open an Obsidian chat first'
    ).open()
  })
}
export function createNodePathObsidianActions(): NodePathOwnerActions {
  return {
    async grant(context) {
      const session = await chooseNodePathChat()
      if (!session) return
      const access = shallowRef<'read' | 'edit'>('edit'),
        error = shallowRef(''),
        busy = shallowRef(false)
      return new Promise<void>((resolve) => {
        nodePathDialog(
          'Give chat access to node target',
          (close) =>
            h('div', [
              h(Setting, { name: 'Chat', desc: session.chatTitle.value || 'Chat' }),
              h(Setting, {
                name: 'Target',
                desc: `${context.target.nodeId} · ${context.target.id}`,
              }),
              h(
                Setting,
                {
                  name: 'Access',
                  desc: 'Whether file changes ask first still follows this chat’s existing permission mode.',
                },
                {
                  default: () =>
                    h(Dropdown, {
                      modelValue: access.value,
                      options: [
                        { value: 'read', display: 'Read files' },
                        { value: 'edit', display: 'Read and edit files' },
                      ],
                      'onUpdate:modelValue': (value: string) => {
                        if (value === 'read' || value === 'edit') access.value = value
                      },
                    }),
                }
              ),
              error.value ? h('div', { role: 'alert' }, error.value) : null,
              h('div', { class: 'modal-button-container' }, [
                h(Button, { text: 'Cancel', onClick: close }),
                h(Button, {
                  text: 'Give access',
                  accent: true,
                  loading: busy.value,
                  onClick: () => {
                    if (busy.value) return
                    busy.value = true
                    void giveObsidianChatAccess(session, {
                      kind: 'target',
                      node_id: context.target.registrationId,
                      project_id: context.target.projectId,
                      target: wirePathTarget(context.target),
                      access: access.value,
                    })
                      .then(close)
                      .catch((failure: unknown) => {
                        error.value =
                          failure instanceof Error
                            ? failure.message
                            : 'Could not approve chat scope'
                      })
                      .finally(() => {
                        busy.value = false
                      })
                  },
                }),
              ]),
            ]),
          resolve
        )
      })
    },
    async ask(context) {
      await add(context, true)
    },
    async add(context) {
      await add(context, false)
    },
  }
}
async function add(captured: NodePathContext, ask: boolean): Promise<void> {
  const session = await chooseNodePathChat()
  if (!session) return
  let reference: ObsidianNodeContext = {
    node_id: captured.target.registrationId,
    project_id: captured.target.projectId,
    target: wirePathTarget(captured.target),
    ...(captured.path ? { path: captured.path } : {}),
    ...(captured.revision ? { revision: captured.revision } : {}),
    ...(captured.contentId ? { content_id: captured.contentId } : {}),
  }
  let text = captured.selection || captured.text
  if (text === undefined && captured.path) {
    const model = NodePathService.getInstance().model(captured.target.registrationId)
    const file = await model.port.file(captured.target, captured.path, undefined, captured.revision)
    text = file.text
    reference = {
      ...reference,
      ...(file.revision ? { revision: file.revision } : {}),
      ...(file.contentId ? { content_id: file.contentId } : {}),
    }
  } else if (text === undefined && captured.commit) {
    const commit = await NodePathService.getInstance()
      .model(captured.target.registrationId)
      .port.commit(captured.target, captured.commit)
    text = JSON.stringify(commit, null, 2)
  }
  if (text === undefined)
    throw new Error('Open a retained file or commit before adding its context.')
  if (ask) await askNodeContextInObsidianChat(session, reference, text)
  else await addNodeContextToObsidianChat(session, reference, text)
  const { ChatService } = await import('@/ai/ChatService')
  await ChatService.getInstance().revealSidebar({ focus: ask })
}
