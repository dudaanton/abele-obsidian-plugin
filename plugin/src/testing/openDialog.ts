import {
  createApp,
  defineComponent,
  h,
  onUnmounted,
  onMounted,
  nextTick,
  type Component,
} from 'vue'
import dayjs from 'dayjs'
import { GlobalStore } from '@/stores/GlobalStore'
import { networkDecision } from '@/slides/liveAdapter'
import { AbeleConfig } from '@/services/AbeleConfig'
import { reviewKeyDestinations } from '@/secrets/destinationReview'
import { approveScriptKeyRequest } from '@/secrets/requestApproval'
import { destinationFixture } from './destinationFixture'
import { reviewScript } from '@/scripting/reviewScript'
import { chatArtifactsFixture } from './chatArtifactsFixture'

export interface DialogFixtureOptions {
  /** Inspect all synthetic recipient-row variants, without inheriting ambient rights. */
  recipientRows?: boolean
}
import TextCommentDialog from '@/components/TextCommentDialog.vue'
import { textCommentFixture } from './textCommentFixture'
import ChatNavigation from '@/components/ChatNavigation.vue'
import type { ChatMessage } from '@/ai/types'
import AgentsListDialog from '@/components/AgentsListDialog.vue'
import { agentsFixture } from './agentsFixture'
import NodeFilesDialog from '@/components/NodeFilesDialog.vue'
import { nodeFilesFixture } from './nodeFilesFixture'
import NodeWorkspaceDialog from '@/components/NodeWorkspaceDialog.vue'
import NodeDelegationGrantsDialog from '@/components/NodeDelegationGrantsDialog.vue'
import NodeDelegationCard from '@/components/NodeDelegationCard.vue'
import { nodeDelegationGrantsFixture, nodeDelegationCardFixture } from './nodeDelegationFixture'
import { nodeWorkspaceFixture } from './nodeWorkspaceFixture'
import NodePairingDialog from '@/components/NodePairingDialog.vue'
import NodePermissionCard from '@/components/NodePermissionCard.vue'
import { nodePairingFixture } from './nodePairingFixture'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import Modal from '@/components/obsidian/Modal.vue'
import AiReplyRevisionDialog from '@/components/AiReplyRevisionDialog.vue'
import AiReplyOriginalDialog from '@/components/AiReplyOriginalDialog.vue'
import ChatAnchorHistory from '@/components/ChatAnchorHistory.vue'
import { chooseAnchorSource } from '@/ai/openChat'
import { captureChatSelection, createChatAnchor } from '@/selection/anchors'
import DateTimePickerModal from '@/components/DateTimePickerModal.vue'
import RecurrencePickerModal from '@/components/RecurrencePickerModal.vue'
import DateRangePickerModal from '@/components/DateRangePickerModal.vue'
import BookComment from '@/components/reader/BookComment.vue'
import BookForms from '@/components/reader/BookForms.vue'
import ModelEditModal from '@/components/settings/ModelEditModal.vue'
import ImageModelEditModal from '@/components/settings/ImageModelEditModal.vue'
import TemplateSelectModal from '@/components/TemplateSelectModal.vue'
import TemplateVariablesModal from '@/components/TemplateVariablesModal.vue'
import FindAndReplaceModal from '@/components/FindAndReplaceModal.vue'
import ImportFilesModal from '@/components/ImportFilesModal.vue'
import SaveMediaModal from '@/components/SaveMediaModal.vue'
import UnusedMediaModal from '@/components/UnusedMediaModal.vue'
import DeduplicateMediaModal from '@/components/DeduplicateMediaModal.vue'
import MigrateDataviewFieldsModal from '@/components/MigrateDataviewFieldsModal.vue'
import MigrateFromDataviewModal from '@/components/MigrateFromDataviewModal.vue'
import MigrateFromFireflyModal from '@/components/MigrateFromFireflyModal.vue'
import MigrateFromTogglModal from '@/components/MigrateFromTogglModal.vue'
import TransferSendModal from '@/components/settings/transfer/TransferSendModal.vue'
import TransferPreviewModal from '@/components/settings/transfer/TransferPreviewModal.vue'
import TransferScanModal from '@/components/settings/transfer/TransferScanModal.vue'
import AgentEditorModal from '@/components/settings/ai/AgentEditorModal.vue'
import LintRuleModal from '@/components/settings/LintRuleModal.vue'
import GithubConnectionEditor from '@/components/settings/GithubConnectionEditor.vue'
import { connectionApproval } from '@/github/approveConnection'
import GithubSettings from '@/components/settings/GithubSettings.vue'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import { githubSettingsFrom } from '@/github/settings'
import { BUILTIN_RULES } from '@/linter/rules'
import { DEFAULT_LINTER_SETTINGS, ruleSetting } from '@/linter/settings'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { askName } from '@/modal/askName'
import { confirmAction } from '@/modal/confirm'
import { askWhatToRemove } from '@/reader/bookDiscussions'
import { askToRepairLinks } from '@/reader/highlightRepairDialog'
import type { HighlightRepairCandidate } from '@/reader/highlightRepair'
import type { Highlight } from '@/reader/highlights'

export const repairExamples = (count: number): HighlightRepairCandidate[] =>
  Array.from({ length: count }, (_, i) => ({
    cfi: `epubcfi(/6/2!/4/${i * 2 + 2}:1)`,
    suggested: `epubcfi(/6/2!/4/${i * 2 + 3}:1)`,
    text: `Fabricated sample passage ${i + 1} with enough words to wrap in a narrow dialog and describe a proposed location.`,
    label: `Sample chapter ${i + 1} — an intentionally long chapter label`,
    context: {
      pre: 'A short invented paragraph before the passage. ',
      match: 'Fabricated sample passage',
      post: ' and an invented paragraph after it.',
    },
    anchored: i !== 0,
  }))

const HIGHLIGHT: Highlight = {
  cfi: 'epubcfi(/6/4!/4/2/1:0)',
  color: 'yellow',
  text: 'A sentence long enough to be worth a comment, and to wrap onto a second line.',
  comment: '',
  label: 'Chapter one',
}

/** Every event a dialog of the plugin ends with: any of them takes the probe's copy down. */
const ENDINGS = ['onClose', 'onCancel', 'onConfirm', 'onClear', 'onSave', 'onReset', 'onApply']

/** A Vue dialog mounted on its own, as the plugin mounts it, and unmounted when it ends. */
function mountAlone(
  component: Component,
  props: Record<string, unknown> = {},
  fixtureName?: string
): void {
  const host = document.body.createDiv()
  let open = true
  const close = () => {
    if (!open) return
    open = false
    app.unmount()
    host.remove()
  }
  const endings = Object.fromEntries(ENDINGS.map((name) => [name, close]))
  const app = createApp(component, { ...endings, ...props })
  app.mount(host)
  // Promise-returning fixtures participate in the inventory's owned-modal cleanup protocol.
  if (fixtureName)
    Array.from(document.querySelectorAll('.modal.abele-modal'))
      .at(-1)
      ?.setAttribute('data-abele-fixture', fixtureName)
}

/**
 * Every dialog the layout probes open by name, in the shape the plugin opens it with. The ones
 * several taps deep in the plugin — settings, the reader, a template — are the same dialog either
 * way. The icon picker, the list of keys, the MCP server, rewind and a script's form have their
 * own openers; the chat's two dialogs open from the chat.
 */
const mountNodeQuestion = (kind: 'select' | 'input') =>
  mountAlone(
    defineComponent({
      setup: () => () =>
        h(ObsidianModal, { title: 'Node question' }, () =>
          h(NodePermissionCard, {
            disabled: false,
            prompt: {
              kind,
              prompt_id: 'sample-question',
              session_id: 'sample-session',
              run_id: 'sample-run',
              revision: 1,
              action_digest: 'a'.repeat(64),
              expires_at: 1999999999999,
              state: 'pending',
              choice: null,
              installation_id: null,
              delivered: false,
              title: 'Choose a next action for the sample project',
              options:
                kind === 'select'
                  ? ['Inspect the changed files', 'Stop and leave the workspace unchanged']
                  : undefined,
            },
          })
        ),
    }),
    {}
  )

const DIALOGS: Record<string, (options?: DialogFixtureOptions) => void | Promise<void>> = {
  'chat-artifacts-empty': () => mountAlone(chatArtifactsFixture('empty')),
  'chat-artifacts': () => mountAlone(chatArtifactsFixture('populated')),
  'chat-artifacts-long': () => mountAlone(chatArtifactsFixture('long')),
  'text-comment-create': () => mountAlone(TextCommentDialog, textCommentFixture()),
  'text-comment-list': () => mountAlone(TextCommentDialog, textCommentFixture(true)),
  'text-comment-orphan': () =>
    mountAlone(TextCommentDialog, { ...textCommentFixture(true), orphan: true, unresolved: true }),
  'text-comment-edit': async () => {
    mountAlone(TextCommentDialog, textCommentFixture(true), 'text-comment-edit')
    await nextTick()
    Array.from(document.querySelectorAll<HTMLButtonElement>('.abele-text-comments button'))
      .find((button) => button.textContent?.trim() === 'Edit')
      ?.click()
  },
  'text-comment-delete': () => {
    void confirmAction(GlobalStore.getInstance().app, {
      title: 'Delete comment?',
      message:
        'This is the last entry. Its marker and thread will also be removed. The note text will stay.',
      confirmText: 'Delete',
    })
  },
  'chat-navigation': () => {
    const messages = Array.from({ length: 40 }, (_, i): ChatMessage[] => [
      { id: `question-${i}`, parentId: i ? `tool-${i - 1}` : undefined, role: 'user',
        content: `Sample question ${i + 1} with enough words to wrap across a narrow screen`, timestamp: 1700000000000 + i * 3600000 },
      { id: `answer-${i}`, parentId: `question-${i}`, role: 'assistant',
        content: 'A sample answer with more detail about the question.', timestamp: 1700000001000 + i * 3600000 },
      { id: `tool-${i}`, parentId: `answer-${i}`, role: 'tool-call', content: '', toolName: 'read',
        toolStatus: 'pending', toolParams: { path: 'Notes/sample-file.md' }, timestamp: 1700000002000 + i * 3600000 },
    ]).flat()
    mountAlone(ChatNavigation, {
      messages,
      allMessages: [...messages,
        { id: 'alternate', parentId: 'question-0', role: 'user', content: 'Alternate sample continuation with enough words to wrap on a narrow screen', timestamp: 1700000003000 },
        { id: 'alternate-first', parentId: 'alternate', role: 'assistant', content: 'First nested continuation', timestamp: 1700000004000 },
        { id: 'alternate-second', parentId: 'alternate', role: 'assistant', content: 'Second nested continuation', timestamp: 1700000005000 },
        { id: 'other-start', role: 'user', content: 'Another sample conversation start', timestamp: 1700000006000 },
      ],
      comments: [{ id: 'layout-sample-missing-discussion', message: 'question-0', quote: 'A retained sample passage ' + 'x'.repeat(100) }],
      state: { expanded: [], scrollTop: 0 }, activeMessageId: 'answer-0', canGoBack: true,
    })
  },
  'node-pairing': () =>
    mountAlone(NodePairingDialog, { ...nodePairingFixture('waiting'), resumeNodeId: undefined }),
  'node-pairing-waiting': () => mountAlone(NodePairingDialog, nodePairingFixture('waiting')),
  'node-pairing-recovery': () => mountAlone(NodePairingDialog, nodePairingFixture('recovery')),
  'node-pairing-endpoint': () => mountAlone(NodePairingDialog, nodePairingFixture('endpoint')),
  'node-question': () => mountNodeQuestion('select'),
  'node-question-input': () => mountNodeQuestion('input'),
  'node-workspaces': () => mountAlone(NodeWorkspaceDialog, nodeWorkspaceFixture()),
  'node-delegation-grants': () => mountAlone(NodeDelegationGrantsDialog, nodeDelegationGrantsFixture()),
  'node-delegation-card': () => mountAlone(defineComponent({ emits: ['close'], setup: (_props, { emit }) => () => h(Modal, { title: 'Node delegation', onClose: () => emit('close') }, { default: () => h(NodeDelegationCard, { card: nodeDelegationCardFixture(), nodeLabel: 'Sample node' }) }) })),

  'node-files': async () =>
    mountAlone(NodeFilesDialog, await nodeFilesFixture('files'), 'node-files'),
  'node-edit': async () => mountAlone(NodeFilesDialog, await nodeFilesFixture('edit'), 'node-edit'),
  'node-edit-conflict': async () =>
    mountAlone(NodeFilesDialog, await nodeFilesFixture('conflict'), 'node-edit-conflict'),
  'node-edit-unknown': async () =>
    mountAlone(NodeFilesDialog, await nodeFilesFixture('unknown'), 'node-edit-unknown'),
  'node-edit-binary': async () =>
    mountAlone(NodeFilesDialog, await nodeFilesFixture('binary'), 'node-edit-binary'),
  'node-edit-large': async () =>
    mountAlone(NodeFilesDialog, await nodeFilesFixture('tooLarge'), 'node-edit-large'),
  'node-edit-shared': async () =>
    mountAlone(NodeFilesDialog, await nodeFilesFixture('shared'), 'node-edit-shared'),
  'agents': () => mountAlone(AgentsListDialog, { source: agentsFixture() }),
  'node-diffs': async () =>
    mountAlone(NodeFilesDialog, await nodeFilesFixture('diffs'), 'node-diffs'),
  'node-review': async () =>
    mountAlone(NodeFilesDialog, await nodeFilesFixture('review'), 'node-review'),
  'node-history': async () =>
    mountAlone(NodeFilesDialog, await nodeFilesFixture('history'), 'node-history'),
  'template-review': () => {
    void reviewScript(GlobalStore.getInstance().app, {
      template: {
        name: 'Sample command template',
        path: 'Templates/sample-command.md',
        source:
          '---\ntype: template\ntemplate_for: sample\ncallbacks: command:sample:run\n---\n# {{Title}}\n\n{{sample;convert;Input}}',
      },
    })
  },
  'template-review-change': () => {
    void reviewScript(GlobalStore.getInstance().app, {
      template: {
        name: 'Sample command template',
        path: 'Templates/sample-command.md',
        source: '---\ncallbacks: command:sample:changed\n---\n# Changed sample body',
      },
      previous: '---\ncallbacks: command:sample:run\n---\n# Sample body',
    })
  },
  'slide-network': () => {
    const app = GlobalStore.getInstance().app
    const path = 'sample-network-probe.md'
    const key = `abele-slide-network:${path}`
    const previous = app.loadLocalStorage(key)
    app.saveLocalStorage(key, null)
    void networkDecision(app, path).finally(() => app.saveLocalStorage(key, previous))
  },
  'selection-source': () => {
    void chooseAnchorSource([
      'Chats/sample-original.abchat',
      'Copies/a-long-sample-conversation-name-for-a-narrow-screen.abchat',
    ])
  },
  'selection-history': () => {
    const revision = {
      reference: { chatId: 'sample-chat', messageId: 'sample-reply', revisionId: 'sample-version' },
      content:
        'A small lantern glows beside the garden path.\n\nAn earlier answer with a retained selection.',
      projection: {
        version: 'chat-text-v1',
        text: 'A small lantern glows beside the garden path.An earlier answer with a retained selection.',
      },
    }
    const snapshot = captureChatSelection({
      revision,
      range: { space: 'rendered', start: 2, end: 15 },
      sentence: revision.projection.text,
      title: 'Sample chat',
      pathHint: 'Chats/sample.abchat',
      role: 'assistant',
      author: 'assistant',
    })
    const anchor = createChatAnchor(snapshot, revision, () => 'sample-anchor')
    mountAlone(ChatAnchorHistory, {
      anchor,
      resolution: { status: 'historical', revision, placement: anchor.placements[0] },
    })
  },
  'selection-unresolved': () => {
    const revision = {
      reference: { chatId: 'sample-chat', messageId: 'sample-reply', revisionId: 'sample-version' },
      content: 'Saved words from an earlier answer.',
      projection: { version: 'chat-text-v1', text: 'Saved words from an earlier answer.' },
    }
    const snapshot = captureChatSelection({
      revision,
      range: { space: 'rendered', start: 0, end: 11 },
      sentence: revision.content,
      title: 'Sample chat',
      pathHint: 'Chats/sample.abchat',
      role: 'assistant',
      author: 'assistant',
    })
    mountAlone(ChatAnchorHistory, {
      anchor: createChatAnchor(snapshot, revision, () => 'sample-anchor'),
      resolution: { status: 'unresolved', snapshot },
    })
  },
  'reply-revision': () =>
    mountAlone(AiReplyRevisionDialog, {
      proposal: {
        id: 'sample-proposal',
        parent: 'sample-chat.abchat',
        message: 'sample-reply',
        before: 'A small lantern glows.',
        from: 2,
        old: 'small lantern',
        text: 'bright lamp that lights the garden path',
        request: 'Please clarify the selected description.',
        author: 'Sample editor',
        at: 1,
        status: 'pending',
      },
      decide: async () => {},
    }),
  'reply-original': () =>
    mountAlone(AiReplyOriginalDialog, {
      message: {
        id: 'sample-reply',
        role: 'assistant',
        timestamp: 1,
        content: 'A bright lamp glows.',
        revisions: [
          {
            proposal: 'sample-proposal',
            before: 'A **small lantern** glows beside the garden path.',
            after: 'A bright lamp glows.',
            author: 'Sample editor',
            at: 1,
            highlights: [],
          },
        ],
      },
    }),
  'key-destinations': (options) =>
    destinationFixture(options?.recipientRows ? 'layout' : 'review', () => {
      const modal = reviewKeyDestinations()
      modal.modalEl.dataset.abeleFixture = 'key-destinations'
      return new Promise<void>((resolve) => {
        const close = modal.onClose.bind(modal)
        modal.onClose = () => {
          try {
            close()
          } finally {
            resolve()
          }
        }
      })
    }),
  'key-destinations-new': () =>
    destinationFixture('new', () => {
      const modal = reviewKeyDestinations()
      modal.modalEl.dataset.abeleFixture = 'key-destinations-new'
      const select = modal.bodyEl.querySelector('select')!
      select.value = 'new'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      for (const [label, value] of [
        ['Recipient address', 'http://192.168.42.12:8123/status'],
        ['New key name', 'Sample local key'],
      ]) {
        const input = modal.bodyEl.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return new Promise<void>((resolve) => {
        const close = modal.onClose.bind(modal)
        modal.onClose = () => {
          try {
            close()
          } finally {
            resolve()
          }
        }
      })
    }),
  'saved-key-request': () =>
    destinationFixture('request', async () => {
      const completion = approveScriptKeyRequest({
        url: 'https://api.sample.example/data',
        headers: { Authorization: '${abele_key:Sample key}' },
      })
      const modal = document.querySelector<HTMLElement>('.modal.abele-modal')
      if (modal) modal.dataset.abeleFixture = 'saved-key-request'
      // Cancellation may outlive DOM removal while the production transaction rolls back.
      // Await its real settlement before the fixture restores or another fixture opens.
      await completion.catch(() => {})
    }),
  confirm: () =>
    mountAlone(ConfirmModal, {
      title: 'Delete model',
      message: 'Delete GPT? Agents using it will have no model until one is chosen.',
    }),
  date: () => mountAlone(DateTimePickerModal, { mode: 'due', initialDate: dayjs() }),
  recurrence: () => mountAlone(RecurrencePickerModal, {}),
  'date-range': () => mountAlone(DateRangePickerModal, {}),
  'book-comment': () => mountAlone(BookComment, { highlight: HIGHLIGHT }),
  'book-forms': () =>
    mountAlone(BookForms, { highlight: { ...HIGHLIGHT, forms: ['sample', 'samples'] } }),
  model: () =>
    mountAlone(ModelEditModal, {
      model: {
        id: 'model-1',
        name: 'Model',
        contextWindow: 128000,
        maxTokens: 4096,
        supportsReasoning: true,
      },
    }),
  'image-model': () =>
    mountAlone(ImageModelEditModal, {
      model: {
        id: 'gpt-image-1',
        name: '',
        size: '1024x1024',
        outputFormat: 'png',
        quality: 'high',
      },
      isOpenAi: true,
    }),
  'template-select': () => mountAlone(TemplateSelectModal, { templates: [] }),
  'template-variables': () =>
    mountAlone(TemplateVariablesModal, {
      variables: [
        ...Array.from({ length: 8 }, (_, i) => ({
          raw: `{{user:Field ${i + 1}}}`,
          type: 'user',
          name: `Field ${i + 1}`,
        })),
        { raw: '{{list:Items}}', type: 'list', name: 'Items' },
        { raw: '{{select:Kind}}', type: 'select', name: 'Kind', options: ['one', 'two'] },
      ],
    }),
  'find-replace': () => mountAlone(FindAndReplaceModal),
  'import-files': () => mountAlone(ImportFilesModal),
  'save-media': () => mountAlone(SaveMediaModal),
  'unused-media': () => mountAlone(UnusedMediaModal),
  'dedup-media': () => mountAlone(DeduplicateMediaModal),
  'migrate-dataview-fields': () => mountAlone(MigrateDataviewFieldsModal),
  'migrate-dataview': () => mountAlone(MigrateFromDataviewModal),
  'migrate-firefly': () => mountAlone(MigrateFromFireflyModal),
  'migrate-toggl': () => mountAlone(MigrateFromTogglModal),
  'transfer-send': () =>
    mountAlone(TransferSendModal, { frames: ['ABELE-TRANSFER'], text: 'ABELE', code: '1234' }),
  'transfer-preview': () =>
    mountAlone(TransferPreviewModal, {
      payload: { v: 1, at: new Date().toISOString(), entries: [], secrets: {} },
      codes: 1,
    }),
  'transfer-scan': () => mountAlone(TransferScanModal),
  'github-connection-approval': () =>
    void connectionApproval(GlobalStore.getInstance().app)({
      id: 'sample',
      name: 'Sample account with a long connection label',
      server: 'https://github.enterprise.sample.example.test:8443',
      account: { login: 'sample-account' },
    }),
  'github-agent-access': () => {
    const config = AbeleConfig.getInstance(),
      registry = AgentRegistry.getInstance(),
      original = config.github
    const save = config.saveSettings
    // Touching Off/Ask/On in a layout fixture must never write its sample data to disk.
    config.saveSettings = async () => {
      config.version.value++
    }
    config.github = githubSettingsFrom({
      connections: Array.from({ length: 6 }, (_, i) => ({
        id: `sample-${i}`,
        name: `Sample connection ${i + 1} with a long descriptive label`,
        server: i ? 'https://git.sample.example.test' : '',
        keyId: '',
        owners: [] as string[],
        isDefault: i === 0,
      })),
    })
    const agent = registry.create({
      name: 'Sample connection permissions',
      githubConnections: { 'missing-sample': 'ask' },
    })
    mountAlone(
      defineComponent({
        emits: ['close'],
        setup(_props, { emit }) {
          onUnmounted(() => {
            config.github = original
            registry.remove(agent.id)
            config.saveSettings = save
          })
          onMounted(() => {
            void nextTick(() =>
              Array.from(document.querySelectorAll('.abele-agent-editor .abele-tabs__tab'))
                .find((el) => el.textContent === 'Access')
                ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            )
          })
          return () => h(AgentEditorModal, { agentId: agent.id, onClose: () => emit('close') })
        },
      })
    )
  },
  'github-connections': () => {
    const config = AbeleConfig.getInstance()
    const original = config.github
    const save = config.saveSettings
    config.saveSettings = async () => {
      config.version.value++
    }
    config.github = githubSettingsFrom({
      enabled: true,
      connections: Array.from({ length: 8 }, (_, i) => ({
        id: `sample-${i}`,
        name: `Sample connection ${i + 1} with a long descriptive name`,
        server: 'https://github.enterprise.sample.example.test:8443',
        keyId: '',
        owners: ['sample-organization/long-repository-name'],
        isDefault: i === 0,
        account: { login: `sample-account-${i + 1}` },
      })),
    })
    mountAlone(
      defineComponent({
        emits: ['close'],
        setup(_props, { emit }) {
          onUnmounted(() => {
            config.github = original
            config.saveSettings = save
          })
          onMounted(() => {
            void nextTick(() => {
              const heading = Array.from(
                document.querySelectorAll('.abele-settings__github .abele-section__heading')
              ).find((el) => el.textContent === 'Connections')
              heading?.scrollIntoView({ block: 'start' })
            })
          })
          return () =>
            h(
              ObsidianModal,
              { title: 'GitHub connections', size: 'tall', onClose: () => emit('close') },
              { default: () => h(GithubSettings) }
            )
        },
      })
    )
  },
  'github-connection': () =>
    mountAlone(GithubConnectionEditor, {
      connection: {
        id: 'sample-connection',
        name: 'An intentionally long connection name for a narrow screen',
        server: 'https://github.enterprise.sample.example.test:8443',
        keyId: '',
        owners: ['sample-organization', 'sample-organization/long-repository-name', 'sample-*'],
        isDefault: true,
        account: { login: 'sample-enterprise-account' },
      },
      connections: [],
    }),
  'agent-editor': () =>
    mountAlone(AgentEditorModal, { agentId: AgentRegistry.getInstance().list()[0]?.id ?? '' }),
  // A rule with settings of its own, its changes going nowhere.
  'lint-rule': () => {
    const rule = BUILTIN_RULES.find((r) => r.params.length) ?? BUILTIN_RULES[0]
    mountAlone(LintRuleModal, { rule, setting: ruleSetting(DEFAULT_LINTER_SETTINGS, rule) })
  },
  'ask-name': () => void askName(GlobalStore.getInstance().app, { title: 'New script' }),
  'confirm-action': () =>
    void confirmAction(GlobalStore.getInstance().app, {
      title: 'Remove footnote [^1]?',
      message: 'The footnote and every reference to it are removed from this note.',
      confirmText: 'Remove',
    }),
  'discussion-remove': () => void askWhatToRemove(HIGHLIGHT),
  'book-repair-one': () => void askToRepairLinks(GlobalStore.getInstance().app, repairExamples(1)),
  'book-repair-many': () =>
    void askToRepairLinks(GlobalStore.getInstance().app, repairExamples(12)),
}

/** The names `openDialog` knows, for a probe to walk. */
export const dialogNames = (): string[] => Object.keys(DIALOGS)

/** Opens one of the plugin's dialogs by name, for the layout probes. Escape closes it. */
export function openDialog(name: string, options?: DialogFixtureOptions): void | Promise<void> {
  const open = DIALOGS[name]
  if (!open) throw new Error(`No dialog called ${name}`)
  const completion = open(options)
  // Legacy visual probes can ignore completion; new fixture consumers must await cleanup.
  if (completion) void completion.catch(() => {})
  return completion
}
