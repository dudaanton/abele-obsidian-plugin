import { UiError, uiMessage } from '@/i18n/streamBErrors'
import { presentUiError } from '@/i18n/streamBErrors'
import { streamBAgo as ago } from '@/i18n/streamBDate'
import { t } from '@/i18n'
import { h, shallowRef } from 'vue'
import { Notice } from 'obsidian'
import type { ChatSession } from '@/ai/ChatSession'
import type { NodeChatPresenter } from './NodeChatPresenter'
import { sourceQuote } from '@/helpers/sourceQuote'
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

const lastTime = (session: ChatSession) =>
  Math.max(0, ...(session.messages?.value ?? []).map((m) => m.timestamp ?? 0))

/**
 * Which Obsidian chat: the one open now first and marked, then the rest by when they were last
 * used. Each row says its agent, when it was last used and what was last asked in it, so chats
 * with one name are told apart; one that already reaches `has` says so under its name.
 */
export function chooseNodePathChat(
  has?: (session: ChatSession) => string | undefined
): Promise<ChatSession | undefined>
export function chooseNodePathChat(
  has: undefined,
  includeNode: true
): Promise<ChatSession | NodeChatPresenter | undefined>
export async function chooseNodePathChat(
  has?: (session: ChatSession) => string | undefined,
  includeNode = false
): Promise<ChatSession | NodeChatPresenter | undefined> {
  const { ChatService } = await import('@/ai/ChatService')
  const service = ChatService.getInstance()
  const open = service.activeSession?.value
  const sessions = [...service.getAllSessions()].sort(
    (a, b) => Number(b === open) - Number(a === open) || lastTime(b) - lastTime(a)
  )
  const nodes = includeNode
    ? service.tabOrder.value.flatMap((id) => {
        const node = service.getNodeSession(id)
        return node ? [node] : []
      })
    : []
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
      [
        ...nodes.map((node) => ({
          id: node.id,
          title: node.label.value,
          icon: 'messages-square',
          kind: t('streamB.reapply.5ae0dc4e40'),
          current: service.activeTabId?.value === node.id,
        })),
        ...sessions.map((session) => {
          const when = lastTime(session)
          const already = has?.(session)
          return {
            id: session.id,
            title: session.chatTitle.value || t('streamB.chat.460b3a'),
            icon: already ? 'folder-check' : 'messages-square',
            kind: already
              ? t('streamB.pickerAlreadyHasAccess', { place: already })
              : t('streamB.pickerObsidianChat'),
            current: session === open,
            note: [
              session === open ? t('streamB.openNow.14b67e') : '',
              session.agent?.value?.name ?? '',
              when ? ago(when) : '',
              // A chat nothing was asked in yet says so, rather than standing there unnamed.
              lastQuestion(session) || t('streamB.noQuestionsYet.d88156'),
            ]
              .filter(Boolean)
              .join(' · '),
          }
        }),
      ],
      t('streamB.whichChatGetsAccess.dfde18'),
      (item) =>
        resolve(
          nodes.find((node) => node.id === item.id) ??
            sessions.find((session) => session.id === item.id)
        ),
      t('streamB.openAnObsidianChatFirst.a28781')
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
        const parsed = NodeScopeEntriesSchema.safeParse(
          session.overrides?.value.nodeScope ?? session.agent?.value?.nodeScope ?? []
        )
        return parsed.success ? parsed.data : []
      }
      const session = await chooseNodePathChat((s) =>
        accessCovers(reach(s), stored) ? where : undefined
      )
      if (!session) return
      const chat = session.chatTitle.value || t('streamB.chat.460b3a')
      const had = reach(session).find((e) => accessCovers([e], stored))
      const access = shallowRef<'read' | 'edit' | 'run'>(had?.access ?? 'read'),
        error = shallowRef(''),
        busy = shallowRef(false)
      return new Promise<void>((resolve) => {
        nodePathDialog(
          t('streamB.giveAChatAccess.bd22cb'),
          (close) =>
            h('div', [
              h(Setting, {
                name: chat,
                desc: [
                  t('streamB.folder.01d84d', { v0: String(names.folder ?? where) }),
                  ...(names.branch
                    ? [t('streamB.worktree.3e8f5b', { v0: String(names.branch) })]
                    : []),
                  t('streamB.onTheNode.22b6f0', { v0: String(names.node) }),
                ].join(' · '),
              }),
              h(
                Setting,
                {
                  name: t('streamB.access.ec5ba0'),
                  desc: had
                    ? t('streamB.alreadyHasAccessWhetherChangesAskFirst.14a91e', {
                        v0: String(
                          had.access === 'run'
                            ? t('chatTree.nodeEditRun')
                            : had.access === 'edit'
                              ? t('streamB.readAndEdit.4067e8')
                              : t('streamBMeta.3316348dba')
                        ),
                      })
                    : t('streamB.whetherFileChangesAskFirstStillFollows.519f4b'),
                },
                {
                  default: () =>
                    h(Dropdown, {
                      modelValue: access.value,
                      options: [
                        {
                          value: 'read',
                          display: t('streamB.readFiles.4e792b'),
                        },
                        { value: 'edit', display: t('streamB.readAndEditFiles.3cfbdf') },
                        { value: 'run', display: t('chatTree.nodeEditRun') },
                      ],
                      'onUpdate:modelValue': (value: string) => {
                        if (value === 'read' || value === 'edit' || value === 'run')
                          access.value = value
                      },
                    }),
                }
              ),
              error.value ? h('div', { role: 'alert', class: 'mod-warning' }, error.value) : null,
              h('div', { class: 'modal-button-container' }, [
                h(Button, { text: t('streamB.cancel.19766e'), onClick: close }),
                h(Button, {
                  text: had ? t('streamB.save.1509f5') : t('streamB.giveAccess.ad2cee'),
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
                          t('streamB.can.085228', {
                            v0: String(chat),
                            v1: String(
                              access.value === 'edit'
                                ? t('streamB.readAndEdit.4067e8')
                                : t('streamBMeta.3316348dba')
                            ),
                            v2: String(where),
                          })
                        )
                      })
                      .catch((failure: unknown) => {
                        error.value =
                          failure instanceof Error
                            ? presentUiError(failure)
                            : t('streamB.couldNotApproveChatScope.4b6f14')
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
  const { ChatService } = await import('@/ai/ChatService')
  const chats = ChatService.getInstance()
  const activeId = chats.activeTabId?.value
  const active =
    !ask && activeId ? (chats.getNodeSession(activeId) ?? chats.activeSession?.value) : undefined
  const session = active ?? (await chooseNodePathChat(undefined, true))
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
    throw new UiError(uiMessage('streamB.openARetainedFileOrCommitBefore.874932'))
  if ('reference' in session) {
    const lines = captured.lines
      ? `:${captured.lines.start}${captured.lines.end === captured.lines.start ? '' : `-${captured.lines.end}`}`
      : ''
    const side = captured.side && captured.side !== 'after' ? ` (${captured.side})` : ''
    const quote = sourceQuote(
      `${captured.path ?? captured.commit ?? 'Selected code'}${lines}${side}`,
      text
    )
    const draft = session.draft.value
    draft.text = draft.text ? `${draft.text}\n\n${quote}` : quote
    chats.switchTab(session.id)
    await chats.revealSidebar({ focus: true })
    return
  }
  if (ask) await askNodeContextInObsidianChat(session, reference, text)
  else await addNodeContextToObsidianChat(session, reference, text)
  await chats.revealSidebar({ focus: ask })
}
