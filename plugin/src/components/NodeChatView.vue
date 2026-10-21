<template>
  <div
    ref="chatRoot"
    class="abele-node-chat"
    :class="{ 'abele-keyboard-open': keyboardOpen }"
    :data-session-id="presenter.reference?.sessionId"
    :data-session-title="presenter.label.value"
  >
    <!-- The regular chat's header: the agent on the left, what is used all the time on the
         right. The chat's name is on its tab. -->
    <div class="abele-ai-chat__header" :class="{ 'abele-ai-chat__header_tree': $slots.navigation }">
      <slot name="lead" />
      <slot name="navigation">
        <div class="abele-agent-selector">
          <Button
            ref="agentPicker"
            class="abele-node-chat__agent"
            :text="agentName"
            trailing-icon="chevron-down"
            aria-haspopup="menu"
            :label="t('streamB.agentStartAChatWithAnother.42d6fb', { v0: String(agentName) })"
            @click="chooseAgent"
          />
        </div>
      </slot>
      <div class="abele-ai-chat__header-actions">
        <AgentsButton />
        <Icon
          icon="plus"
          with-bg
          role="button"
          tabindex="0"
          :aria-label="t('streamB.newChatOrNodeSession.79b072')"
          :tooltip="t('streamB.newChat.db1838')"
          @click="emit('new-chat')"
          @keydown.enter.prevent="emit('new-chat')"
          @keydown.space.prevent="emit('new-chat')"
        />
        <Icon
          icon="more-horizontal"
          with-bg
          role="button"
          tabindex="0"
          :aria-label="t('streamB.moreChatActions.8bc495')"
          :tooltip="t('streamB.moreChatActions.8bc495')"
          @click="openMenu"
          @keydown.enter.prevent="openMenu"
          @keydown.space.prevent="openMenu"
        />
      </div>
    </div>
    <!-- Where the agent works, quietly under the header: the folder and worktree (pressed, moved
         to another), the node in the tooltip, a red dot while the node cannot be reached, and
         the way back to the session that started this one. -->
    <div
      v-if="offline || worktree || live?.parent"
      class="abele-node-chat__place"
      :title="placeTip"
    >
      <span v-if="offline" class="abele-node-chat__offline" role="status" :aria-label="status" />
      <WorktreeChip
        v-if="worktree"
        :folder="folder ?? ''"
        :copy="worktree"
        :disabled="
          !canSwitchWorktree ||
          offline ||
          presenter.isStreaming.value ||
          presenter.queued.value.length > 0 ||
          (!!presenter.nativeSessionId?.value && !canSwitchNative)
        "
        @choose="emit('choose-worktree')"
      />
      <ParentLink
        v-if="live?.parent"
        :title="live.parent.title"
        @open="live.open(live.parent.id)"
      />
    </div>
    <div
      v-if="presenter.error.value || presenter.connection.error.value"
      class="abele-ai-chat__error"
      role="alert"
    >
      <NodeErrorText :error="presenter.error.value || presenter.connection.error.value" />
    </div>
    <div v-show="!expanded" ref="scroller" class="abele-ai-chat__messages" @scroll="onScroll">
      <!-- A long session shows its end; what came before is read from the node as you scroll up. -->
      <div
        v-if="presenter.hasOlder?.value"
        class="abele-node-chat__older"
        role="status"
        :aria-busy="presenter.olderState?.value === 'loading'"
      >
        <template v-if="presenter.olderState?.value === 'failed'">
          <span
            :aria-label="
              presenter.olderError?.value
                ? t('streamB.couldNotReadEarlierMessages.fff300', {
                    v0: String(presenter.olderError.value),
                  })
                : undefined
            "
            >{{ t('streamB.couldNotReadEarlierMessages.5f0162') }}</span
          >
          <Button :text="t('streamB.tryAgain.d8b839')" @click="loadOlder" />
        </template>
        <span v-else>{{ t('streamB.loadingEarlierMessages.b8507b') }}</span>
      </div>
      <NodeDebugActions
        v-if="presenter.reference"
        :presenter="presenter"
        :before="presentation.messages[0]?.timestamp ?? Infinity"
      />
      <template v-for="(segment, index) in segments" :key="segment.switch?.seq ?? index">
        <WorktreeSwitchLine
          v-if="segment.switch"
          :branch="segment.switch.branch"
          :by="segment.switch.by"
        />
        <NodeMessageTree
          :messages="segment.messages"
          :children="presenter.projection.value.children || {}"
          :queue-states="presentation.states"
          :offline="offline"
          :tool-prompts="presenter.projection.value.toolPrompts"
          :prompt-diffs="presenter.projection.value.promptDiffs"
          :history-for="presenter.historyState?.bind(presenter)"
          :open-resource="resourceOpener(segment.target)"
          can-reply
          @cancel="presenter.cancelInput($event)"
          @retry="retry"
          @history-action="historyAction"
          @reply="(to) => chatInput?.quote(to)"
          @show-reply="showReply"
          @open-session="(id) => presenter.openSession?.(id)"
        >
          <template #after-message="{ message }">
            <NodeDebugActions
              v-if="presenter.reference"
              :presenter="presenter"
              :after="message.timestamp"
              :before="
                presentation.messages[
                  presentation.messages.findIndex((m) => m.id === message.id) + 1
                ]?.timestamp ?? Infinity
              "
            />
          </template>
        </NodeMessageTree>
      </template>
      <NodeDebuggerAccess
        v-if="presenter.reference && presenter.nodeDescription?.value"
        :presenter="presenter"
      />
      <NodePermissionCard
        v-for="prompt in standalonePrompts"
        :key="prompt.prompt_id"
        :prompt="prompt"
        :location="[nodeLabel, folder, worktree?.branch].filter(Boolean).join(' · ')"
        :allow-label="!presenter.provider?.value || presenter.provider.value === 'fake'"
        :disabled="offline"
        :answer-state="presenter.answers?.value[prompt.prompt_id]"
        :diffs="presenter.projection.value.promptDiffs?.[prompt.prompt_id]"
        @stop="presenter.stopFromApproval(prompt)"
        @answer="
          (choice, value) =>
            value === undefined
              ? presenter.answer(prompt, choice)
              : presenter.answer(prompt, choice, value)
        "
      />
      <NodeQuestionnaire
        v-for="prompt in questionnaires"
        :key="prompt.prompt_id"
        :prompt="prompt"
        :disabled="offline"
        :busy="answeringQuestion === prompt.prompt_id"
        :error="questionError[prompt.prompt_id]"
        @answer="(answers) => answerQuestionnaire(prompt, answers)"
      />
      <div
        v-if="working"
        class="abele-ai-chat__typing"
        role="status"
        :aria-label="t('streamB.reapply.49bf5144e2')"
      >
        <span class="abele-ai-chat__typing-dot" />
        <span class="abele-ai-chat__typing-dot" />
        <span class="abele-ai-chat__typing-dot" />
      </div>
      <div
        v-for="rejected in presenter.rejected.value"
        :key="rejected.id"
        class="abele-ai-chat__error"
        role="alert"
      >
        {{ t('streamB.reapply.1eca68d7d7') }} {{ rejected.text }} ·
        <NodeErrorText :error="rejected.error" />
      </div>
    </div>
    <MetaLine
      v-if="presenter.draftNotice?.value && presenter.draft.value.text"
      class="abele-node-chat__draft-note"
      role="status"
      :facts="[{ key: '0', value: presentUiField(presenter.draftNotice, 'value') }]"
    />
    <!-- What a long-lived session keeps going between its answers, over the composer. -->
    <BackgroundTasks
      v-if="live && !expanded"
      :tasks="live.background"
      :sessions="live.children"
      :can-stop="!!live.stopTask"
      @stop="(id) => live?.stopTask?.(id)"
      @open="(id) => live?.open(id)"
    />
    <input
      ref="attachmentInput"
      type="file"
      hidden
      :aria-label="t('streamB.attachAFile.21298c')"
      @change="attachFile"
    />
    <AiChatInput
      ref="chatInput"
      :key="presenter.id"
      v-model:expanded="expanded"
      :conversation-draft="presenter.draft.value"
      send-clearing="owner"
      :send-label="
        presenter.draftNotice?.value ? t('streamB.sendAgain.feead9') : t('streamB.send.f6f468')
      "
      :is-streaming="working"
      :is-busy="sending || attaching"
      :text-only="true"
      :slash-extra="slashItems"
      :can-continue="false"
      token-display=""
      scope-label=""
      @send="send"
      @abort="stopTurn"
      @command="onCommand"
      @show-reply="showReply"
      @focus="onInputFocus"
    >
      <template #attach>
        <Icon
          icon="paperclip"
          :label="t('streamB.attachAFile.21298c')"
          :tooltip="t('streamB.nodeAttachTextFile')"
          :disabled="attaching || sending"
          @click="!attaching && !sending && attachmentInput?.click()"
        />
      </template>
      <template #settings>
        <Icon
          v-if="$slots.navigation"
          ref="agentPicker"
          class="abele-node-chat__agent"
          icon="bot"
          :text-right="phone ? undefined : agentName"
          :label="t('streamB.agentStartAChatWithAnother.42d6fb', { v0: String(agentName) })"
          @click="chooseAgent"
        />
        <SessionSettings
          v-if="live"
          ref="settingsControl"
          :live="live"
          :busy="working"
          @compact="compactOpen = true"
        />
      </template>
    </AiChatInput>
    <CompactModal
      v-if="compactOpen && live"
      :context="live.context"
      :focus="compactFocus"
      :continuation="presenter.control?.state.value?.settings.continuation_text"
      :continues="presenter.control?.state.value?.settings.continue_after_compaction"
      @close="compactOpen = false"
      @compact="
        (focus, then) => {
          compactOpen = false
          live?.compact(focus, then)
        }
      "
    />
    <RenameModal
      v-if="renameOpen"
      :title="presenter.label.value"
      @close="renameOpen = false"
      @rename="
        (title) => {
          renameOpen = false
          live ? live.rename(title) : void presenter.control?.rename(title)
        }
      "
    />
    <ConfirmModal
      v-if="stopOpen && live"
      :title="t('streamB.stopTheSession.efff95')"
      :message="stopSaid"
      :confirm-text="t('streamB.stop.cae7d5')"
      :confirm-tooltip="t('streamB.stopTheAnswerWhatRunsInThe.ee84a5')"
      :cancel-tooltip="t('streamB.keepTheSessionRunning.bc0329')"
      @close="stopOpen = false"
      @confirm="
        () => {
          stopOpen = false
          live?.stop()
        }
      "
    />
  </div>
</template>
<script setup lang="ts">
import NodeQuestionnaire from './NodeQuestionnaire.vue'
import { provide } from 'vue'
import { obsidianConversationPresentation } from '@/node/obsidianConversationPresentation'
import type { Prompt, QuestionnaireAnswer } from '@abele/node-client'
import NodeErrorText from '@/components/NodeErrorText.vue'
import { presentUiField, presentUiError } from '@/i18n/streamBErrors'
import { streamBCount } from '@/i18n/streamBCounts'
import { t } from '@/i18n'
import { computed, nextTick, ref, watch, onUnmounted } from 'vue'
import { Menu, Notice, Platform } from 'obsidian'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { nodeQueueView } from '@/node/presentation'
import { agentChoices, providerLabel, type AgentChoice } from '@/node/providers'
import { nodeAttachmentText } from '@/node/nodeChatAttachments'
import type { NodeHistoryAction } from '@/node/NodeChatHistory'
import NodeChatHistoryDialog from './NodeChatHistoryDialog.vue'
import { openComponentDialog } from '@/modal/componentDialog'
import { NodeService } from '@/node/NodeService'
import { openNodePanel } from '@/node/openSession'
import { openNodeFiles } from '@/node/openFiles'
import NodeMessageTree from './NodeMessageTree.vue'
import NodePermissionCard from './NodePermissionCard.vue'
import AiChatInput from './AiChatInput.vue'
import type { ChatReplyTo } from '@/ai/types'
import { flashMessagePassage } from '@/ai/messageComments'
import Icon from './obsidian/Icon.vue'
import AgentsButton from './AgentsButton.vue'
import Button from './obsidian/Button.vue'
import MetaLine from './obsidian/MetaLine.vue'
import NodeDebugActions from '@/debugger/NodeDebugActions.vue'
import NodeDebuggerAccess from '@/debugger/NodeDebuggerAccess.vue'
import { attachNodeProgram, openNodeDebugger, startNodeProgram } from '@/debugger/register'
import { useChatKeyboardGap } from '@/composables/useChatKeyboardGap'
import WorktreeChip from './nodeWork/WorktreeChip.vue'
import BackgroundTasks from './nodeSession/BackgroundTasks.vue'
import SessionSettings from './nodeSession/SessionSettings.vue'
import CompactModal from './nodeSession/CompactModal.vue'
import RenameModal from './nodeSession/RenameModal.vue'
import ParentLink from './nodeSession/ParentLink.vue'
import ConfirmModal from './obsidian/ConfirmModal.vue'
import type { SlashItem } from './ChatSlashSuggest.vue'
import WorktreeSwitchLine from './nodeWork/WorktreeSwitchLine.vue'
import { nodeChatSegments, type NodeChatSwitch } from '@/node/nodePathChat'
import type { PathTarget } from '@/node/NodePathModel'
import { nodeChatResource } from '@/node/nodeChatPlace'
import type { CopySummary } from './nodeWork/types'
const props = withDefaults(
  defineProps<{
    presenter: NodeChatPresenter
    worktree?: CopySummary
    folder?: string
    canSwitchWorktree?: boolean
    canSwitchNative?: boolean
    currentTarget?: PathTarget
    switches?: NodeChatSwitch[]
    openNodeResource?: (path: string, target?: PathTarget) => void
  }>(),
  {
    worktree: undefined,
    folder: undefined,
    canSwitchWorktree: false,
    canSwitchNative: false,
    currentTarget: undefined,
    switches: () => [],
    openNodeResource: undefined,
  }
)
const emit = defineEmits<{
  (e: 'new-chat'): void
  (e: 'choose-worktree'): void
  /** Another agent was chosen in the header: a new chat with it, at the same place. */
  (e: 'start-with', choice: AgentChoice): void
}>()
// The presenter owns resource identities; this thin view supplies Obsidian's dialog adapter.
const stopFiles = props.presenter.setFilesOpener?.((model, path, range) =>
  openNodeFiles(model, props.presenter.connection, path, range)
)
onUnmounted(() => stopFiles?.())
const labels = {
  offline: t('streamB.offline.a17947'),
  queued: t('streamB.queued.661ff4'),
  accepted: t('streamB.accepted.a00fb0'),
  running: t('streamB.running.f4ccae'),
  'needs-attention': t('streamB.needsAttention.c1ebc7'),
  idle: t('streamB.connectedIdle.6dc24f'),
}
const status = computed(() =>
  props.presenter.connection.state.value === 'connecting'
    ? t('streamB.connecting.72021e')
    : labels[props.presenter.state.value]
)
/** The node this chat runs on, by the name it was paired under. */
const nodeLabel = computed(() => {
  try {
    return (
      NodeService.getInstance().nodes.value.find(
        (n) => n.id === props.presenter.reference.registrationId
      )?.label ?? t('streamB.node.e93372')
    )
  } catch {
    // Node connections did not load: the chat still says it runs on a node.
    return t('streamB.node.e93372')
  }
})
const placeTip = computed(() =>
  t('streamB.on.9d0cd0', { v0: String(nodeLabel.value), v1: String(status.value) })
)
const sessionAgent = () =>
  (props.presenter.projection.value.session as { agent?: string } | undefined)?.agent
/** The agent this chat runs, by the name people know it: an ACP agent by its own. */
const agentName = computed(() => {
  const provider = props.presenter.provider?.value ?? ''
  const agent = sessionAgent()
  if (provider === 'acp' && agent)
    return (
      agentChoices(props.presenter.providerReports?.value ?? []).find((c) => c.agent === agent)
        ?.label ?? agent
    )
  return providerLabel(provider)
})
/** The agents of this node, this one checked; another starts a new chat with it here. */
const phone = Platform.isPhone
const agentPicker = ref<InstanceType<typeof Button> | InstanceType<typeof Icon> | null>(null)
const chooseAgent = () => {
  const button = agentPicker.value?.$el as HTMLElement | undefined
  if (!button) return
  const menu = new Menu()
  const provider = props.presenter.provider?.value
  const agent = sessionAgent() ?? ''
  for (const choice of agentChoices(props.presenter.providerReports?.value ?? [])) {
    const current = choice.provider === provider && (choice.agent ?? '') === agent
    menu.addItem((i) =>
      i
        .setTitle(choice.unavailable ? `${choice.label} · ${choice.unavailable}` : choice.label)
        .setChecked(current)
        .setDisabled(!!choice.unavailable)
        .onClick(() => {
          if (!current) emit('start-with', choice)
        })
    )
  }
  const rect = button.getBoundingClientRect()
  menu.showAtPosition({ x: rect.left, y: rect.bottom })
}
const offline = computed(() => props.presenter.connection.state.value !== 'connected')
provide(obsidianConversationPresentation, {
  client: props.presenter.connection.client,
  revision: computed(() => props.presenter.projection.value),
})
const standalonePrompts = computed(() => {
  const projection = props.presenter.projection.value
  const nested = new Set(
    Object.values(projection.toolPrompts ?? {})
      .flat()
      .map((p) => p.prompt_id)
  )
  return projection.prompts.filter((p) => p.kind !== 'questionnaire' && !nested.has(p.prompt_id))
})
const questionnaires = computed(() =>
  [
    ...new Map(
      [
        ...(props.presenter.connection.obsidian?.questionnaires.value ?? []),
        ...props.presenter.projection.value.prompts,
      ].map((prompt) => [prompt.prompt_id, prompt])
    ).values(),
  ].filter((prompt) => prompt.kind === 'questionnaire' && prompt.state === 'pending')
)
const answeringQuestion = ref('')
const questionError = ref<Record<string, string>>({})
async function answerQuestionnaire(prompt: Prompt, answers: QuestionnaireAnswer[] | null) {
  if (offline.value || answeringQuestion.value) return
  answeringQuestion.value = prompt.prompt_id
  delete questionError.value[prompt.prompt_id]
  try {
    await props.presenter.connection.client.answerQuestionnaire(prompt, answers)
    await props.presenter.connection.obsidian?.refreshQuestionnaires()
    await props.presenter.refresh()
  } catch (error) {
    questionError.value[prompt.prompt_id] = error instanceof Error ? error.message : String(error)
  } finally {
    answeringQuestion.value = ''
  }
}
/** A long-lived session: how it runs, what it keeps running; null for any other. */
const live = computed(() => props.presenter.live?.value ?? null)
/** Something runs now that Stop ends: an answer, a turn the session woke for, a compaction. */
const working = computed(
  () => !!props.presenter.projection.value.activeRuns?.length || !!live.value?.compacting
)
const stopTurn = () => {
  if (offline.value) return
  for (const run of props.presenter.projection.value.activeRuns ?? [])
    void props.presenter.interrupt(run)
}
const compactOpen = ref(false),
  compactFocus = ref(''),
  renameOpen = ref(false),
  stopOpen = ref(false)
const settingsControl = ref<{ open: (event?: MouseEvent) => void } | null>(null)
/**
 * After «/»: the session's own commands, then what the agent itself takes — its commands and
 * skills, as it last reported them. One of the agent's goes to it as the message; a name the
 * session already answers itself (`compact`, `model`…) stays the session's.
 */
const slashItems = computed<SlashItem[] | undefined>(() => {
  const own: SlashItem[] = (live.value?.commands ?? []).map((c) => ({
    kind: c.kind,
    name: c.name,
    title: `/${c.name}`,
    description: c.description,
  }))
  const taken = new Set(own.map((c) => c.name))
  const agent: SlashItem[] = (props.presenter.agentCommands?.value ?? [])
    .filter((c) => !taken.has(c.name))
    .map((c) => ({
      kind: c.source === 'skill' ? 'skill' : 'agent',
      name: c.name,
      title: c.input_hint ? `/${c.name} ${c.input_hint}` : `/${c.name}`,
      description: c.description ?? '',
    }))
  const all = [...own, ...agent]
  return all.length ? all : undefined
})
/** What stopping the session ends, named. */
const stopSaid = computed(() => {
  const n = live.value?.background.length ?? 0
  const tasks = n
    ? t('streamB.runningInTheBackground.9c70fa', {
        v0: String(n === 1 ? t('streamB.theTask.fd27a4') : streamBCount(n, 'task')),
      })
    : ''
  return t('streamB.thisStopsTheAnswerAndTheSession.a76301', { v0: String(tasks) })
})
/** A session command chosen after «/», or typed with its words. */
const onCommand = (command: string) => {
  const [name, ...rest] = command.slice(1).split(/\s+/)
  const words = rest.join(' ').trim()
  if (name === 'compact') {
    compactFocus.value = words
    compactOpen.value = true
  } else if (name === 'rename') {
    if (words) live.value?.rename(words)
    else renameOpen.value = true
  } else if (name === 'stop') stopOpen.value = true
  else if (['model', 'effort', 'mode'].includes(name)) settingsControl.value?.open()
}
const presentation = computed(
  () =>
    props.presenter.presentation?.value ??
    nodeQueueView(
      props.presenter.messages.value,
      props.presenter.queued.value,
      props.presenter.projection.value.queuedInputs ?? [],
      {}
    )
)
const chatRoot = ref<HTMLElement | null>(null)
const keyboardOpen = ref(false)
const { measure: measureBottomGap } = useChatKeyboardGap(chatRoot)
const onInputFocus = (focused: boolean) => {
  if (focused) measureBottomGap()
  keyboardOpen.value = focused
}
const expanded = ref(false),
  sending = ref(false),
  permissionFixture = ref(false)
const scroller = ref<HTMLElement>()
const segments = computed(() =>
  nodeChatSegments(
    presentation.value.messages,
    props.presenter.projection.value.messageSequences,
    props.switches,
    props.currentTarget
  )
)
const openResource = (path: string, target?: PathTarget) =>
  props.openNodeResource ? props.openNodeResource(path, target) : props.presenter.openResource(path)
// Markdown invalidates a render when its resource context changes. Keep that context stable
// across message deltas, while preserving the worktree each historical segment belongs to.
const resourceContexts = new Map<string, (path: string) => void>()
const resourceOpener = (target?: PathTarget) => {
  const key = JSON.stringify(target ?? null)
  let open = resourceContexts.get(key)
  if (!open) {
    open = Object.assign((path: string) => openResource(path, target), {
      canOpen: (path: string) => !target || !!nodeChatResource(path, target),
    })
    resourceContexts.set(key, open)
  }
  return open
}
const workspaces = () => {
  const node = NodeService.getInstance().nodes.value.find(
    (n) => n.id === props.presenter.reference.registrationId
  )
  if (node) openNodePanel(node)
}
const openMenu = (event: MouseEvent | KeyboardEvent) => {
  const menu = new Menu()
  menu.addItem((i) =>
    i
      .setTitle(t('streamB.logRawSessionRecords.1c0258'))
      .setIcon('bug')
      .onClick(() => {
        console.debug('[Abele node] raw session records', {
          reference: props.presenter.reference,
          records: props.presenter.projection.value.unknown,
          artifacts: props.presenter.projection.value.artifacts,
        })
        new Notice(t('streamB.rawSessionRecordsLoggedToTheDeveloper.5fd714'))
      })
  )
  if (props.presenter.debuggerAvailable?.value === true)
    menu.addItem((i) =>
      i
        .setTitle(t('streamB.debug.1a03bd'))
        .setIcon('bug-play')
        .onClick(() => {
          void openNodeDebugger(props.presenter)
        })
    )
  if (props.presenter.debuggerAvailable?.value === true)
    menu.addItem((i) =>
      i
        .setTitle(t('streamB.runAProgram.ac87e8'))
        .setIcon('play')
        .onClick(() => {
          void startNodeProgram(props.presenter)
        })
    )
  if (props.presenter.debuggerAvailable?.value === true)
    menu.addItem((i) =>
      i
        .setTitle(t('streamB.attachToARunningProgram.66133a'))
        .setIcon('plug')
        .onClick(() => {
          void attachNodeProgram(props.presenter)
        })
    )
  if (props.presenter.workspaceId?.value)
    menu.addItem((i) =>
      i
        .setTitle(t('streamB.browseWorkspaceFiles.748cc2'))
        .setIcon('folder-open')
        .onClick(() => props.presenter.openFiles())
    )
  menu.addItem((i) =>
    i.setTitle(t('streamB.foldersAndWorktrees.29c05e')).setIcon('server').onClick(workspaces)
  )
  menu.addItem((i) =>
    i
      .setTitle(t('streamB.rename.6fa62b'))
      .setIcon('pencil')
      .onClick(() => (renameOpen.value = true))
  )
  if (live.value)
    menu.addItem((i) =>
      i
        .setTitle(t('streamB.stopTheSession.0215d3'))
        .setIcon('octagon-x')
        .setWarning(true)
        .setSection('danger')
        .onClick(() => (stopOpen.value = true))
    )
  menu.addItem((i) =>
    i
      .setTitle(t('streamB.reconnect.bf8a9e'))
      .setIcon('refresh-cw')
      .onClick(() => {
        void props.presenter.connection.connect().catch(() => {})
      })
  )
  if (props.presenter.provider?.value === 'fake')
    menu.addItem((i) =>
      i
        .setTitle(t('streamB.askForPermission.7bd9e9'))
        .setIcon('shield-alert')
        .setChecked(permissionFixture.value)
        .onClick(() => {
          permissionFixture.value = !permissionFixture.value
        })
    )
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  menu.showAtPosition({ x: rect.left, y: rect.bottom })
}
const send = async (text: string, _files: string[] = [], replyTo?: ChatReplyTo[]) => {
  if (live.value && /^\/(rename|stop|model|effort|mode)(\s|$)/.test(text.trim())) {
    onCommand(text.trim())
    props.presenter.draft.value.text = ''
    return
  }
  sending.value = true
  // The places replied to go as links over the words; the field's text held them as markers.
  const reply = replyTo?.length ? { replyTo, draft: props.presenter.draft.value.text } : undefined
  try {
    if (permissionFixture.value && props.presenter.provider?.value === 'fake')
      await props.presenter.send(
        text,
        [{ kind: 'permission', ttl_ms: 60000 }, { kind: 'echo' }],
        props.currentTarget,
        reply
      )
    else if (reply) await props.presenter.send(text, undefined, props.currentTarget, reply)
    else if (props.currentTarget) await props.presenter.send(text, undefined, props.currentTarget)
    else await props.presenter.send(text)
  } finally {
    sending.value = false
  }
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
}
const chatInput = ref<InstanceType<typeof AiChatInput> | null>(null)
const attachmentInput = ref<HTMLInputElement | null>(null)
const attaching = ref(false)
let disposed = false
onUnmounted(() => {
  disposed = true
})
const attachFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || attaching.value) return
  const presenter = props.presenter
  attaching.value = true
  try {
    const quote = await nodeAttachmentText(file)
    if (disposed || props.presenter !== presenter) return
    const text = [presenter.draft.value.text, quote].filter(Boolean).join('\n\n')
    if (new TextEncoder().encode(text).length > 60 * 1024)
      throw new Error(t('streamB.nodeAttachmentTooLarge'))
    presenter.draft.value.text = text
  } catch (error) {
    if (!disposed && props.presenter === presenter)
      presenter.error.value =
        error instanceof Error ? error.message : t('streamB.nodeAttachmentTextOnly')
  } finally {
    attaching.value = false
  }
}
/** Back to the words a place replies to: its message brought into view, the words flashed. */
const showReply = (to: ChatReplyTo) => {
  const el = scroller.value?.querySelector<HTMLElement>(
    `[data-node-message="${CSS.escape(to.messageId)}"]`
  )
  if (!el) {
    new Notice(t('streamB.thatMessageIsNoLongerInThis.b1fd76'))
    return
  }
  el.scrollIntoView({ block: 'center' })
  const words = el.querySelector<HTMLElement>('[data-find-part="content"]')
  if (words && to.start !== undefined) flashMessagePassage(words, to.quote, to.start)
}
const retry = (messageId: string) => {
  if (offline.value || sending.value) return
  const messages = props.presenter.messages.value
  const failed = messages.find((message) => message.id === messageId)
  const input = messages.find(
    (message) => message.id === failed?.retryInputId && message.role === 'user'
  )
  if (input) void send(input.content)
}
const historyAction = (messageId: string, action: NodeHistoryAction) => {
  const presenter = props.presenter
  const state = presenter.historyState(messageId)
  if (!state || state.reason) return
  if (action === 'rewind' || action === 'edit') {
    openComponentDialog(
      () => NodeChatHistoryDialog,
      {
        action,
        initialText: state.input?.content ?? '',
        readPreview: () => presenter.historyPreview(messageId),
        restore: (files: Parameters<typeof presenter.restoreHistory>[3], text?: string) =>
          presenter.restoreHistory(messageId, action, text, files),
      },
      { key: `node-history:${presenter.id}` }
    ).ready.catch((error: unknown) => {
      presenter.error.value = presentUiError(error)
    })
  } else
    void presenter.restoreHistory(messageId, action).catch((error: unknown) => {
      presenter.error.value = presentUiError(error)
    })
}
/** An earlier page arriving keeps the words you are reading where they are. */
let keepFromBottom: number | null = null
const loadOlder = async () => {
  const el = scroller.value
  if (!el || !props.presenter.loadOlder || props.presenter.olderState?.value === 'loading') return
  keepFromBottom = el.scrollHeight - el.scrollTop
  try {
    await props.presenter.loadOlder()
  } finally {
    await nextTick()
    if (keepFromBottom !== null) el.scrollTop = el.scrollHeight - keepFromBottom
    keepFromBottom = null
  }
}
/** Near the top of what is shown, the page before it is read; also while the list does not fill
 *  the pane, so a short window is never a dead end. */
const onScroll = () => {
  const el = scroller.value
  if (!el) return
  // Reading at the end keeps the chat there as answers render and grow; scrolling away lets go.
  stickToEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  if (el.scrollTop < 300 && props.presenter.hasOlder?.value) void loadOlder()
}
/** The chat follows its end: opened, it shows the latest words even once they finish rendering. */
let stickToEnd = true
const settle = new ResizeObserver(() => {
  const el = scroller.value
  if (el && stickToEnd && keepFromBottom === null) el.scrollTop = el.scrollHeight
})
onUnmounted(() => settle.disconnect())
watch(
  () => props.presenter.messages.value,
  async () => {
    const el = scroller.value
    await nextTick()
    if (!el) return
    settle.disconnect()
    for (const child of el.children) settle.observe(child)
    if (keepFromBottom !== null) return
    if (stickToEnd) el.scrollTop = el.scrollHeight
    if (el.scrollHeight <= el.clientHeight && props.presenter.hasOlder?.value) void loadOlder()
  }
)
</script>
<style lang="scss">
.abele-node-chat {
  > .abele-ai-chat__error {
    flex-shrink: 0;
    padding-inline: var(--size-4-3);
    overflow-wrap: anywhere;
  }
  &__older {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--size-4-2);
    padding: var(--size-4-2);
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
  }
  &__draft-note {
    flex-shrink: 0;
    padding: var(--size-4-2);
  }
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  .abele-ai-chat__header-actions {
    flex-shrink: 0;
  }
  /* The agent as the regular chat's header names it: a dropdown that opens its menu. */
  .abele-agent-selector {
    flex: 1;
    min-width: 0;
  }
  &__agent {
    max-width: min(12em, 100%);
    min-width: 0;
    text-align: start;
    .abele-obsidian-button__label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .abele-obsidian-button__trailing-icon {
      flex-shrink: 0;
    }
  }
  /* Where the agent works: one quiet line under the header. */
  &__place {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--size-4-2);
    min-width: 0;
    padding: 0 var(--size-4-3) var(--size-4-1);
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);

    .abele-worktree-chip {
      flex: 0 1 auto;
      min-width: 0;
    }
    &:empty {
      display: none;
    }
  }
  &__offline {
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-red);
  }
  &__node {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  container-type: inline-size;
  body.is-mobile &.abele-keyboard-open {
    flex: 0 0 auto;
    height: calc(100% - max(0px, var(--keyboard-height, 0px) - var(--abele-bottom-gap, 0px)));
  }
  body.is-mobile.mod-toolbar-open &.abele-keyboard-open {
    height: calc(
      100% - max(
          0px,
          var(--keyboard-height, 0px) +
            var(--mobile-toolbar-height, 0px) - var(--abele-bottom-gap, 0px)
        )
    );
  }
  .abele-chat-msg__diff,
  .abele-chat-msg__new-file {
    max-height: none;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}
</style>
