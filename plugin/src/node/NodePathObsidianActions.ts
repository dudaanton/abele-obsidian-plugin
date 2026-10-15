import { h, shallowRef } from 'vue'
import { Notice } from 'obsidian'
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
import {
  giveObsidianChatAccess,
  nodeAgentHost,
  revokeObsidianNodeScopeApprovals,
} from '@/ai/tools/node/owner'
import { NodeScopeEntriesSchema } from '@/ai/nodeScope'
import { accessCovers } from '@/ai/tools/node/accessRefusal'
import { nodeScopeNames, nodeScopeTitle } from '@/ai/tools/node/scopeNames'
import {
  addNodeContextToObsidianChat,
  askNodeContextInObsidianChat,
  type ObsidianNodeContext,
} from '@/ai/tools/node/context'

/** The public chat actions validate scope and record owner approval; prompt text grants nothing. */
export async function revokeNodePathChatApprovals(nodeId: string): Promise<void> {
  await revokeObsidianNodeScopeApprovals(nodeId)
}
/** The last thing asked in a chat, cut to a line: what tells ten chats named «Chat» apart. */
function lastQuestion(session: ChatSession): string {
  const asked = [...(session.messages?.value ?? [])]
    .reverse()
    .find((m) => m.role === 'user' && m.content)
  const words = (asked?.content ?? '')
    .replace(/\[↩ ([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return words.length > 60 ? `${words.slice(0, 59).trimEnd()}…` : words
}
/** How long ago, in the fewest words: «5 min ago», «3 h ago», «2 days ago». */
function ago(at: number, now = Date.now()): string {
  const min = Math.round((now - at) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}
const lastTime = (session: ChatSession) =>
  Math.max(0, ...(session.messages?.value ?? []).map((m) => m.timestamp ?? 0))

/**
 * Which Obsidian chat: the one open now first and marked, then the rest by when they were last
 * used. Each row says its agent, when it was last used and what was last asked in it, so chats
 * with one name are told apart; one that already reaches `has` says so under its name.
 */
export async function chooseNodePathChat(
  has?: (session: ChatSession) => string | undefined
): Promise<ChatSession | undefined> {
  const { ChatService } = await import('@/ai/ChatService')
  const service = ChatService.getInstance()
  const open = service.activeSession?.value
  const sessions = [...service.getAllSessions()].sort(
    (a, b) => Number(b === open) - Number(a === open) || lastTime(b) - lastTime(a)
  )
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
      sessions.map((session) => {
        const when = lastTime(session)
        const already = has?.(session)
        return {
          id: session.id,
          title: session.chatTitle.value || 'Chat',
          icon: already ? 'folder-check' : 'messages-square',
          kind: already ? `Already has access to ${already}` : 'Obsidian chat',
          current: session === open,
          note: [
            session === open ? 'Open now' : '',
            session.agent?.value?.name ?? '',
            when ? ago(when) : '',
            // A chat nothing was asked in yet says so, rather than standing there unnamed.
            lastQuestion(session) || 'no questions yet',
          ]
            .filter(Boolean)
            .join(' · '),
        }
      }),
      'Which chat gets access',
      (item) => resolve(sessions.find((session) => session.id === item.id)),
      'Open an Obsidian chat first'
    ).open()
  })
}
export function createNodePathObsidianActions(): NodePathOwnerActions {
  return {
    async grant(context) {
      const place = {
        node_id: context.target.registrationId,
        project_id: context.target.projectId,
        target: wirePathTarget(context.target),
      }
      const names = await nodeScopeNames(place)
      // A chat's access is kept under the node's own id, not this device's registration of it.
      const host = await nodeAgentHost()
      const stored = { ...place, node_id: host.nodeId?.(place.node_id) ?? place.node_id }
      const where = nodeScopeTitle(names)
      const reach = (session: ChatSession) => {
        const parsed = NodeScopeEntriesSchema.safeParse(session.overrides?.value.nodeScope ?? [])
        return parsed.success ? parsed.data : []
      }
      const session = await chooseNodePathChat((s) =>
        accessCovers(reach(s), stored) ? where : undefined
      )
      if (!session) return
      const chat = session.chatTitle.value || 'Chat'
      const had = reach(session).find((e) => accessCovers([e], stored))
      const access = shallowRef<'read' | 'edit'>(had?.access ?? 'edit'),
        error = shallowRef(''),
        busy = shallowRef(false)
      return new Promise<void>((resolve) => {
        nodePathDialog(
          'Give a chat access',
          (close) =>
            h('div', [
              h(Setting, {
                name: chat,
                desc: [
                  `Folder: ${names.folder ?? where}`,
                  ...(names.branch ? [`Worktree: ${names.branch}`] : []),
                  `on the ${names.node} node`,
                ].join(' · '),
              }),
              h(
                Setting,
                {
                  name: 'Access',
                  desc: had
                    ? `Already has ${had.access === 'edit' ? 'read and edit' : 'read'} access. Whether changes ask first follows the chat's permission mode.`
                    : 'Whether file changes ask first still follows this chat’s permission mode.',
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
              error.value ? h('div', { role: 'alert', class: 'mod-warning' }, error.value) : null,
              h('div', { class: 'modal-button-container' }, [
                h(Button, { text: 'Cancel', onClick: close }),
                h(Button, {
                  text: had ? 'Save' : 'Give access',
                  accent: true,
                  loading: busy.value,
                  onClick: () => {
                    if (busy.value) return
                    busy.value = true
                    void giveObsidianChatAccess(session, {
                      kind: 'target',
                      ...place,
                      access: access.value,
                    })
                      .then(() => {
                        close()
                        new Notice(
                          `${chat} can ${access.value === 'edit' ? 'read and edit' : 'read'} ${where}`
                        )
                      })
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
    ...(captured.lines ? { lines: { ...captured.lines } } : {}),
    ...(captured.side ? { side: captured.side } : {}),
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
    text = [
      commit.subject,
      `${commit.author} · ${commit.day}, ${commit.when}`,
      ...(commit.files ?? []).flatMap((file) => [file.path, file.after || file.before]),
    ].join('\n\n')
  }
  if (text === undefined)
    throw new Error('Open a retained file or commit before adding its context.')
  if (ask) await askNodeContextInObsidianChat(session, reference, text)
  else await addNodeContextToObsidianChat(session, reference, text)
  const { ChatService } = await import('@/ai/ChatService')
  await ChatService.getInstance().revealSidebar({ focus: ask })
}
