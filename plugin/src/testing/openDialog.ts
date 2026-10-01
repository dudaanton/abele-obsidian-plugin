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
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
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
import { AbeleConfig } from '@/services/AbeleConfig'
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
function mountAlone(component: Component, props: Record<string, unknown> = {}): void {
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
}

/**
 * Every dialog the layout probes open by name, in the shape the plugin opens it with. The ones
 * several taps deep in the plugin — settings, the reader, a template — are the same dialog either
 * way. The icon picker, the list of keys, the MCP server, rewind and a script's form have their
 * own openers; the chat's two dialogs open from the chat.
 */
const DIALOGS: Record<string, () => void> = {
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
    config.saveSettings = async () => { config.version.value++ }
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
    config.saveSettings = async () => { config.version.value++ }
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
export function openDialog(name: string): void {
  const open = DIALOGS[name]
  if (!open) throw new Error(`No dialog called ${name}`)
  open()
}
