import { defineComponent, h, onUnmounted, onMounted, nextTick, type Component } from 'vue'
import dayjs from 'dayjs'
import { GlobalStore } from '@/stores/GlobalStore'
import { mountKit } from '@/components/obsidian/mount'
import { networkDecision } from '@/slides/liveAdapter'
import { AbeleConfig } from '@/services/AbeleConfig'
import { t } from '@/i18n'
import { reviewKeyDestinations } from '@/secrets/destinationReview'
import { approveScriptKeyRequest } from '@/secrets/requestApproval'
import { destinationFixture } from './destinationFixture'
import { reviewScript } from '@/scripting/reviewScript'
import { chatArtifactsFixture } from './chatArtifactsFixture'
import { chatTreeFixture, chatFolderAccessFixture } from './chatTreeFixture'
import TokenUiFixture from './TokenUiFixture.vue'
import ShareSetsFixture from './ShareSetsFixture.vue'
import NodeSyntaxFixture from './NodeSyntaxFixture.vue'
import NodeLspFixture from './NodeLspFixture.vue'
import { NodeSettingsAccessFixture } from './nodeSettingsAccessFixture'
import EnvironmentDialog from '@/components/debugger/http/EnvironmentDialog.vue'
import PullRequestDialog from '@/components/nodeWork/PullRequestDialog.vue'
import MapBackgroundEditor from '@/components/settings/MapBackgroundEditor.vue'
import MapPlaceCard from '@/components/mapBase/MapPlaceCard.vue'
import MapFormulaCreate from '@/components/mapBase/MapFormulaCreate.vue'
import ProgramLaunchDialog from '@/debugger/ProgramLaunchDialog.vue'

export interface DialogFixtureOptions {
  delegationCommand?: string | string[]
  managerLegacyIntegration?: boolean
  managerCodexApproval?: boolean
  managerEscapedCommand?: boolean
  managerRunState?: import('@abele/node-protocol').ManagerRun['state']
  managerJustification?: string
  managerCommand?: string
  managerOldNode?: boolean
  delegationState?:
    | 'paused-prompt'
    | 'working'
    | 'done'
    | 'failed'
    | 'empty'
    | 'paused'
    | 'warning'
    | 'prompt'
    | 'answering'
    | 'owner-stopped'
    | 'lost'
  permissionState?: 'running' | 'refused' | 'node-opt-in' | 'unknown'
  agentInherit?: boolean
  /** Inspect all synthetic recipient-row variants, without inheriting ambient rights. */
  recipientRows?: boolean
  agentsState?: import('./agentsFixture').AgentsFixtureState
  transferPayload?: import('@/transfer/types').TransferPayload
}
import TextCommentDialog from '@/components/TextCommentDialog.vue'
import { textCommentFixture } from './textCommentFixture'
import ChatNavigation from '@/components/chatOutline/ChatOutlineDialog.vue'
import type { ChatMessage } from '@/ai/types'
import AgentsListDialog from '@/components/AgentsListDialog.vue'
import { agentsFixture } from './agentsFixture'
import { chooseAttentionTab } from '@/agents/AgentsService'
import NodeFilesDialog from '@/components/NodeFilesDialog.vue'
import { nodeFilesFixture } from './nodeFilesFixture'
import NodeManagerRunCard from '@/components/NodeManagerRunCard.vue'
import { nodeManagerFixture } from './nodeManagerFixture'
import NodeDelegationCard from '@/components/NodeDelegationCard.vue'
import { nodeDelegationCardFixture, nodePermissionCardFixture } from './nodeDelegationFixture'
import NodePairingDialog from '@/components/NodePairingDialog.vue'
import NodePermissionCard from '@/components/NodePermissionCard.vue'
import { nodePairingFixture } from './nodePairingFixture'
import { nodeFolderPickerFixture } from './nodeFolderPickerFixture'
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
import ExcalidrawMigrationModal from '@/components/ExcalidrawMigrationModal.vue'
import { excalidrawDrawings, excalidrawReport } from './excalidrawFixture'
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
import { confirmDialog, promptDialog } from '@/components/obsidian/dialogs'
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
  const close = () => app.unmount()
  const endings = Object.fromEntries(ENDINGS.map((name) => [name, close]))
  const app = mountKit(
    document.body.createDiv(),
    component,
    { ...endings, ...props },
    { remove: true }
  )
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
  'debugger-launch': () =>
    mountAlone(ProgramLaunchDialog, {
      program: 'dist/main.js',
      stopOnEntrySupported: true,
      launch: async () => {
        throw Object.assign(new Error('debugger_startup_handoff_lost'), {
          details: { stderr: 'Error: Cannot find module sample-module\n    at dist/main.js:1:1' },
        })
      },
    }),
  'map-background': () => mountAlone(MapBackgroundEditor),
  'map-background-error': () => mountAlone(MapBackgroundEditor, { showErrors: true }),
  'map-background-long': () =>
    mountAlone(MapBackgroundEditor, {
      background: {
        id: 'sample-background',
        name: 'Sample terrain with a long descriptive background name',
        light: [
          'https://example.test/sample-terrain/{z}/{x}/{y}.png',
          'https://example.test/sample-labels/{z}/{x}/{y}.png',
        ],
        dark: ['https://example.test/sample-dark/{z}/{x}/{y}.png'],
      },
    }),
  'map-formula-create': () =>
    mountAlone(MapFormulaCreate, {
      formula: 'formula.position',
      coordinates: '12, 20',
      properties: ['coordinates', 'position'],
    }),
  'map-place-card': () =>
    mountAlone(
      defineComponent({
        setup: () => () =>
          h(
            Modal,
            { size: 'tall', modalClass: 'abele-map-card-modal' },
            {
              default: () =>
                h(MapPlaceCard, {
                  place: {
                    id: 'sample',
                    path: 'Sample.md',
                    title: 'Sample place with a long descriptive title',
                    lat: 12,
                    lon: 20,
                    properties: [{ name: 'Kind', value: 'Grove' }],
                    text: 'A sample note with readable content.',
                  },
                }),
            }
          ),
      })
    ),
  'native-pr-create': () =>
    mountAlone(
      defineComponent({
        inheritAttrs: false,
        emits: ['close'],
        setup(_props, { emit }) {
          return () =>
            h(
              Modal,
              { title: 'Create pull request', onClose: () => emit('close') },
              {
                default: () =>
                  h(PullRequestDialog, {
                    branch: 'sample-topic-with-a-deliberately-long-branch-name',
                    base: 'main',
                    commits: 3,
                    files: 4,
                    initialTitle: 'Sample change with a deliberately long descriptive title',
                    initialBody: 'An invented description of the proposed change.',
                    host: 'Gitea',
                    draftSupported: false,
                    onCancel: () => emit('close'),
                    onCreate: () => emit('close'),
                  }),
              }
            )
        },
      })
    ),
  'chat-artifacts-empty': async () =>
    mountAlone(await chatArtifactsFixture('empty'), {}, 'chat-artifacts-empty'),
  'chat-artifacts': async () =>
    mountAlone(await chatArtifactsFixture('populated'), {}, 'chat-artifacts'),
  'chat-artifacts-long': async () =>
    mountAlone(await chatArtifactsFixture('long'), {}, 'chat-artifacts-long'),
  'chat-tree': () => mountAlone(chatTreeFixture(), {}, 'chat-tree'),
  'chat-folder-access': () => mountAlone(chatFolderAccessFixture(), {}, 'chat-folder-access'),
  'text-comment-create': () => mountAlone(TextCommentDialog, textCommentFixture()),
  'text-comment-list': () => mountAlone(TextCommentDialog, textCommentFixture(true)),
  'text-comment-orphan': () =>
    mountAlone(TextCommentDialog, { ...textCommentFixture(true), orphan: true, unresolved: true }),
  'text-comment-edit': async () => {
    mountAlone(TextCommentDialog, textCommentFixture(true), 'text-comment-edit')
    // The saved thread arrives after mounting; each comment is changed from its pencil glyph.
    for (let i = 0; i < 20; i++) {
      const pencil = document.querySelector<HTMLElement>(
        '.abele-text-comments [aria-label="Edit this comment"]'
      )
      if (pencil) {
        pencil.click()
        await nextTick()
        return
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
  },
  'text-comment-delete': () => {
    void confirmDialog({
      title: 'Delete comment?',
      message:
        'This is the last entry. Its marker and thread will also be removed. The note text will stay.',
      confirmText: 'Delete',
    })
  },
  'chat-navigation': () => {
    const messages = Array.from({ length: 40 }, (_, i): ChatMessage[] => [
      {
        id: `question-${i}`,
        parentId: i ? `tool-${i - 1}` : undefined,
        role: 'user',
        content: `Sample question ${i + 1} with enough words to wrap across a narrow screen`,
        timestamp: 1700000000000 + i * 3600000,
      },
      {
        id: `answer-${i}`,
        parentId: `question-${i}`,
        role: 'assistant',
        content: 'A sample answer with more detail about the question.',
        timestamp: 1700000001000 + i * 3600000,
      },
      {
        id: `tool-${i}`,
        parentId: `answer-${i}`,
        role: 'tool-call',
        content: '',
        toolName: 'read',
        toolStatus: 'pending',
        toolParams: { path: 'Notes/sample-file.md' },
        timestamp: 1700000002000 + i * 3600000,
      },
    ]).flat()
    mountAlone(ChatNavigation, {
      messages,
      allMessages: [
        ...messages,
        {
          id: 'alternate',
          parentId: 'question-0',
          role: 'user',
          content: 'Alternate sample continuation with enough words to wrap on a narrow screen',
          timestamp: 1700000003000,
        },
        {
          id: 'alternate-first',
          parentId: 'alternate',
          role: 'assistant',
          content: 'First nested continuation',
          timestamp: 1700000004000,
        },
        {
          id: 'alternate-second',
          parentId: 'alternate',
          role: 'assistant',
          content: 'Second nested continuation',
          timestamp: 1700000005000,
        },
        {
          id: 'other-start',
          role: 'user',
          content: 'Another sample conversation start',
          timestamp: 1700000006000,
        },
      ],
      comments: [
        {
          id: 'layout-sample-missing-discussion',
          message: 'question-0',
          quote: 'A retained sample passage ' + 'x'.repeat(100),
        },
      ],
      state: { expanded: [], scrollTop: 0 },
      activeMessageId: 'answer-0',
      canGoBack: true,
    })
  },
  agents: (options) =>
    mountAlone(AgentsListDialog, { source: agentsFixture(options?.agentsState) }),
  'agents-tabs': async () => {
    const completion = chooseAttentionTab(
      GlobalStore.getInstance().app,
      Array.from({ length: 20 }, (_, i) => ({
        id: `sample-tab-${i}`,
        label: `Sample conversation ${i + 1} with an intentionally long invented title for a narrow dialog`,
        waiting: i === 3,
        working: i === 7,
        at: Date.now() - i * 3_600_000,
      })),
      async () => {}
    )
    document
      .querySelector<HTMLElement>('.abele-close-tab')
      ?.setAttribute('data-abele-fixture', 'agents-tabs')
    await completion
  },
  'node-pairing': () =>
    mountAlone(NodePairingDialog, { ...nodePairingFixture('waiting'), resumeNodeId: undefined }),
  'node-pairing-long': () =>
    mountAlone(NodePairingDialog, {
      ...nodePairingFixture(
        'waiting',
        'Sample remote project with a long enrollment label ' + 'sampleproject'.repeat(4)
      ),
      resumeNodeId: undefined,
    }),
  'node-pairing-waiting': () => mountAlone(NodePairingDialog, nodePairingFixture('waiting')),
  'node-pairing-recovery': () => mountAlone(NodePairingDialog, nodePairingFixture('recovery')),
  'node-pairing-endpoint': () => mountAlone(NodePairingDialog, nodePairingFixture('endpoint')),
  'node-question': () => mountNodeQuestion('select'),
  'node-question-input': () => mountNodeQuestion('input'),
  // Not its promise: that settles once the dialog is open, and the probes close it themselves.
  'node-folder-picker': () => void nodeFolderPickerFixture(),
  'node-folder-picker-stale': () => void nodeFolderPickerFixture(true),
  'node-folder-picker-refused': () => void nodeFolderPickerFixture(false, true),
  'node-manager-run': (options) =>
    mountAlone(
      defineComponent({
        emits: ['close'],
        setup:
          (_props, { emit }) =>
          () =>
            h(
              Modal,
              { title: 'Manager command', size: 'tall', onClose: () => emit('close') },
              {
                default: () =>
                  h(NodeManagerRunCard, {
                    card: nodeManagerFixture(
                      options?.managerRunState,
                      options?.managerEscapedCommand,
                      options?.managerCodexApproval,
                      options
                    ),
                  }),
              }
            ),
      })
    ),
  'node-settings-access': () =>
    mountAlone(
      defineComponent({
        emits: ['close'],
        setup:
          (_props, { emit }) =>
          () =>
            h(
              Modal,
              { title: 'Nodes', size: 'tall', onClose: () => emit('close') },
              { default: () => h(NodeSettingsAccessFixture) }
            ),
      })
    ),
  'node-delegation-card': (options) =>
    mountAlone(
      defineComponent({
        emits: ['close'],
        setup:
          (_props, { emit }) =>
          () =>
            h(
              Modal,
              { title: 'Node delegation', size: 'tall', onClose: () => emit('close') },
              {
                default: () =>
                  h(NodeDelegationCard, {
                    card: options?.permissionState
                      ? nodePermissionCardFixture(options.permissionState)
                      : nodeDelegationCardFixture(
                          options?.delegationState,
                          options?.delegationCommand
                        ),
                    nodeLabel: 'Sample node',
                  }),
              }
            ),
      })
    ),

  'node-syntax-sh': () => mountAlone(NodeSyntaxFixture, { kind: 'sh' }),
  'node-syntax-ts': () => mountAlone(NodeSyntaxFixture, { kind: 'ts' }),
  'node-syntax-diff': () => mountAlone(NodeSyntaxFixture, { kind: 'diff' }),
  'node-files': async () =>
    mountAlone(NodeFilesDialog, await nodeFilesFixture('files'), 'node-files'),
  'node-lsp-missing': () => mountAlone(NodeLspFixture, { state: 'missing' }, 'node-lsp-missing'),
  'node-lsp-untrusted': () =>
    mountAlone(NodeLspFixture, { state: 'untrusted' }, 'node-lsp-untrusted'),
  'node-lsp-loading': () => mountAlone(NodeLspFixture, { state: 'loading' }, 'node-lsp-loading'),
  'node-lsp-errors': () => mountAlone(NodeLspFixture, { state: 'errors' }, 'node-lsp-errors'),
  'node-lsp-eslint': () => mountAlone(NodeLspFixture, { state: 'eslint' }, 'node-lsp-eslint'),
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
  // An answer replaced by two interceptors in a row: a version tab for each, with what it said.
  'reply-versions': () =>
    mountAlone(AiReplyOriginalDialog, {
      message: {
        id: 'sample-versions',
        role: 'assistant',
        timestamp: 1,
        content: 'The lamp is on the high shelf, by the window.',
        revisions: [
          {
            proposal: '',
            by: 'interceptor',
            before: 'The lantern is on the shelf.',
            after: 'The lamp is on the shelf.',
            author: 'Sample fact checker',
            at: 1,
            highlights: [],
          },
          {
            proposal: '',
            by: 'interceptor',
            before: 'The lamp is on the shelf.',
            after: 'The lamp is on the high shelf, by the window.',
            author: 'Sample plain language',
            at: 2,
            highlights: [],
          },
        ],
        interceptorChat: [
          {
            id: 'sample-note',
            role: 'assistant',
            content: 'Said where on the shelf.',
            timestamp: 2,
            by: 'Sample plain language',
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
    destinationFixture('new', async () => {
      const modal = reviewKeyDestinations()
      modal.modalEl.dataset.abeleFixture = 'key-destinations-new'
      const select = modal.bodyEl.querySelector('select')
      select.value = 'new'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      // The new key's fields are drawn on the dialog's next render.
      await nextTick()
      for (const [label, value] of [
        ['Recipient address', 'http://192.168.42.12:8123/status'],
        ['New key name', 'Sample local key'],
      ]) {
        const input = modal.bodyEl.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
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
  'excalidraw-confirm': () =>
    mountAlone(ExcalidrawMigrationModal, {
      drawings: excalidrawDrawings,
      run: () => Promise.resolve(excalidrawReport()),
    }),
  'excalidraw-report': () =>
    mountAlone(ExcalidrawMigrationModal, {
      drawings: excalidrawDrawings,
      run: () => Promise.resolve(excalidrawReport()),
      initialReport: excalidrawReport(),
    }),
  'transfer-send': () =>
    mountAlone(TransferSendModal, { frames: ['ABELE-TRANSFER'], text: 'ABELE', code: '1234' }),
  'transfer-preview': (options) =>
    mountAlone(TransferPreviewModal, {
      payload: options?.transferPayload ?? {
        v: 1,
        at: new Date().toISOString(),
        entries: [],
        secrets: {},
      },
      codes: 1,
    }),
  'transfer-scan': () => mountAlone(TransferScanModal),
  'sync-connect': () => mountAlone(TokenUiFixture, { screen: 'connect' }),
  'sync-connect-error': () => mountAlone(TokenUiFixture, { screen: 'connect-error' }),
  'sync-connect-token': () => mountAlone(TokenUiFixture, { screen: 'connect-token' }),
  'sync-connections': () => mountAlone(TokenUiFixture, { screen: 'connections' }),
  'sync-empty': () => mountAlone(TokenUiFixture, { screen: 'empty' }),
  'sync-share': () => mountAlone(TokenUiFixture, { screen: 'share' }),
  'sync-set-empty': () => mountAlone(ShareSetsFixture, { screen: 'empty' }),
  'sync-set-long': () => mountAlone(ShareSetsFixture, { screen: 'long' }),
  'sync-set-readonly': () => mountAlone(ShareSetsFixture, { screen: 'readonly' }),
  'sync-set-removed': () => mountAlone(ShareSetsFixture, { screen: 'removed' }),
  'sync-set-delete': () => mountAlone(ShareSetsFixture, { screen: 'delete' }),
  'sync-set-states': () => mountAlone(ShareSetsFixture, { screen: 'states' }),
  'sync-share-token': () => mountAlone(TokenUiFixture, { screen: 'share-token' }),
  'sync-review': () => mountAlone(TokenUiFixture, { screen: 'review' }),
  'sync-attachment': () => mountAlone(TokenUiFixture, { screen: 'attachment' }),
  'sync-states': () => mountAlone(TokenUiFixture, { screen: 'states' }),
  'sync-disconnect': () => mountAlone(TokenUiFixture, { screen: 'disconnect' }),
  'github-connection-approval': () =>
    void connectionApproval()({
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
              {
                title: t('settings.GithubSettings.git_hosting.a3002011'),
                size: 'tall',
                onClose: () => emit('close'),
              },
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
  'node-agent-permissions': (options) => {
    const config = AbeleConfig.getInstance(),
      registry = AgentRegistry.getInstance()
    const save = config.saveSettings
    config.saveSettings = async () => {
      config.version.value++
    }
    const agent = registry.create({
      name: 'Sample code agent',
      utility: true,
      node: {
        id: 'sample-permission-node',
        name: 'Sample node',
        provider: 'codex',
        permissionModeConfigured: !options?.agentInherit,
      },
    })
    mountAlone(
      defineComponent({
        emits: ['close'],
        setup(_props, { emit }) {
          onUnmounted(() => {
            registry.remove(agent.id)
            config.saveSettings = save
          })
          return () => h(AgentEditorModal, { agentId: agent.id, onClose: () => emit('close') })
        },
      })
    )
  },
  // An agent's tools offered by section, on its Access tab with the node section in view: one
  // section standing open, one in the agent's own words, the node's actions set unevenly.
  'agent-tools': () => {
    const config = AbeleConfig.getInstance(),
      registry = AgentRegistry.getInstance()
    const save = config.saveSettings
    config.saveSettings = async () => {
      config.version.value++
    }
    const agent = registry.create({
      name: 'Sample tools by section',
      toolDiscovery: 'sections',
      toolModes: { node_read: 'auto', node_search: 'auto', node_edit: 'ask', geocode: 'ask' },
      toolSectionOpening: { maps: 'always' },
      toolSectionDescriptions: { maps: 'Sample places and routes, in the agent’s own words.' },
    })
    mountAlone(
      defineComponent({
        emits: ['close'],
        setup(_props, { emit }) {
          onUnmounted(() => {
            registry.remove(agent.id)
            config.saveSettings = save
          })
          onMounted(() => {
            void nextTick(() => {
              Array.from(document.querySelectorAll('.abele-agent-editor .abele-tabs__tab'))
                .find((el) => el.textContent === 'Access')
                ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
              void nextTick(() =>
                Array.from(document.querySelectorAll('.abele-tool-modes__heading'))
                  .find((el) => el.textContent === 'Node')
                  ?.scrollIntoView({ block: 'start' })
              )
            })
          })
          return () => h(AgentEditorModal, { agentId: agent.id, onClose: () => emit('close') })
        },
      })
    )
  },
  // A rule with settings of its own, its changes going nowhere.
  'lint-rule': () => {
    const rule = BUILTIN_RULES.find((r) => r.params.length) ?? BUILTIN_RULES[0]
    mountAlone(LintRuleModal, { rule, setting: ruleSetting(DEFAULT_LINTER_SETTINGS, rule) })
  },
  'ask-name': () => void promptDialog({ title: 'New script' }),
  'confirm-action': () =>
    void confirmDialog({
      title: 'Remove footnote [^1]?',
      message: 'The footnote and every reference to it are removed from this note.',
      confirmText: 'Remove',
    }),
  'discussion-remove': () => void askWhatToRemove(HIGHLIGHT),
  'book-repair-one': () => void askToRepairLinks(GlobalStore.getInstance().app, repairExamples(1)),
  'book-repair-many': () =>
    void askToRepairLinks(GlobalStore.getInstance().app, repairExamples(12)),
  // A saved requests' environment: values written, values kept in memory, the step header.
  'request-environment': () =>
    mountAlone(EnvironmentDialog, {
      environment: {
        name: 'local',
        vars: [
          { key: 'base', value: 'http://localhost:4000' },
          { key: 'tenant', value: 'sample-tenant' },
          { key: 'debug', value: '1', off: true },
          { key: 'token', secret: true },
        ],
        stepHeader: true,
      },
      secrets: { token: 'sample-token-value' },
    }),
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
