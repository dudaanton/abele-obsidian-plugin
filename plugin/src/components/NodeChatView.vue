<template>
  <div ref="chatRoot" class="abele-node-chat" :class="{ 'abele-keyboard-open': keyboardOpen }">
    <div class="abele-ai-chat__header">
      <span class="abele-node-chat__title" :title="title">{{ presenter.label.value }}</span>
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
      <!-- A session another one started: the way back to it, at the line's end. -->
      <ParentLink
        v-if="live?.parent"
        :title="live.parent.title"
        @open="live.open(live.parent.id)"
      />
      <div class="abele-ai-chat__header-actions">
        <AgentsButton />
        <span class="abele-node-chat__indicator" role="status" :title="status" :aria-label="status">
          <Icon :icon="statusIcon" no-hover />
          <span class="abele-node-chat__status-label">{{ status }}</span>
        </span>
        <Icon
          v-if="presenter.workspaceId?.value"
          icon="folder-open"
          with-bg
          role="button"
          tabindex="0"
          aria-label="Browse workspace files"
          tooltip="Browse workspace files and review"
          @click="presenter.openFiles()"
          @keydown.enter.prevent="presenter.openFiles()"
          @keydown.space.prevent="presenter.openFiles()"
        />
        <Icon
          icon="more-horizontal"
          with-bg
          role="button"
          tabindex="0"
          aria-label="Node session menu"
          tooltip="Node session menu"
          @click="openMenu"
          @keydown.enter.prevent="openMenu"
          @keydown.space.prevent="openMenu"
        />
        <Icon
          icon="plus"
          with-bg
          role="button"
          tabindex="0"
          aria-label="New chat or node session"
          tooltip="New chat or node session"
          @click="emit('new-chat')"
          @keydown.enter.prevent="emit('new-chat')"
          @keydown.space.prevent="emit('new-chat')"
        />
      </div>
    </div>
    <div
      v-if="presenter.error.value || presenter.connection.error.value"
      class="abele-ai-chat__error"
      role="alert"
    >
      {{ presenter.error.value || presenter.connection.error.value }}
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
                ? `Could not read earlier messages: ${presenter.olderError.value}`
                : undefined
            "
            >Could not read earlier messages</span
          >
          <Button text="Try again" @click="loadOlder" />
        </template>
        <span v-else>Loading earlier messages…</span>
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
          :open-resource="(path) => openResource(path, segment.target)"
          can-reply
          @cancel="presenter.cancelInput($event)"
          @retry="retry"
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
      <div v-for="artifact in presenter.projection.value.artifacts" :key="artifact.artifactId">
        <Button text="Read stored output" @click="readArtifact(artifact.artifactId)" />
        <pre v-if="artifacts[artifact.artifactId]">{{ artifacts[artifact.artifactId] }}</pre>
      </div>
      <NodePermissionCard
        v-for="prompt in presenter.projection.value.prompts"
        :key="prompt.prompt_id"
        :prompt="prompt"
        :fake="presenter.provider?.value === 'fake'"
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
      <div
        v-for="rejected in presenter.rejected.value"
        :key="rejected.id"
        class="abele-ai-chat__error"
        role="alert"
      >
        Not accepted: {{ rejected.text }} · {{ rejected.error }}
      </div>
      <div v-if="presenter.projection.value.unknown.length" class="abele-chat-msg">
        <span
          class="clickable-icon abele-chat-msg__icon abele-node-chat__details-spacer"
          aria-hidden="true"
          ><Icon icon="bot"
        /></span>
        <!-- The raw records can number in the thousands in a long session: drawn only when open. -->
        <details
          class="abele-chat-msg__body"
          @toggle="detailsOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary>Details</summary>
          <p
            v-for="(diagnostic, index) in diagnostics"
            :key="index"
            class="abele-node-chat__diagnostic"
          >
            {{ diagnostic }}
          </p>
          <template
            v-for="record in detailsOpen ? presenter.projection.value.unknown : []"
            :key="record.seq"
          >
            <details v-if="recordArtifact(record.data)">
              <summary>{{ record.type }} · {{ record.seq }}</summary>
              <Button
                text="Read stored record"
                @click="readArtifact(recordArtifact(record.data))"
              />
              <pre v-if="artifacts[recordArtifact(record.data)]">{{
                artifacts[recordArtifact(record.data)]
              }}</pre>
            </details>
          </template>
          <pre v-if="detailsOpen">{{
            JSON.stringify(presenter.projection.value.unknown, null, 2)
          }}</pre>
        </details>
      </div>
    </div>
    <MetaLine
      v-if="presenter.draftNotice?.value && presenter.draft.value.text"
      class="abele-node-chat__draft-note"
      role="status"
      :facts="[{ key: '0', value: presenter.draftNotice.value }]"
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
    <AiChatInput
      ref="chatInput"
      :key="presenter.id"
      v-model:expanded="expanded"
      :conversation-draft="presenter.draft.value"
      send-clearing="owner"
      :send-label="presenter.draftNotice?.value ? 'Send again' : 'Send'"
      :is-streaming="working"
      :is-busy="sending"
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
      <template v-if="live" #settings>
        <SessionSettings
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
      title="Stop the session?"
      :message="stopSaid"
      confirm-text="Stop"
      confirm-tooltip="Stop the answer, what runs in the background and the session's process"
      cancel-tooltip="Keep the session running"
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
import { computed, nextTick, ref, watch, onUnmounted } from 'vue'
import { Menu, Notice } from 'obsidian'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { nodeQueueView } from '@/node/presentation'
import { providerLabel, capabilityReason } from '@/node/providers'
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
import { piFailure } from '@/node/piFailure'
import NodeDebugActions from '@/debugger/NodeDebugActions.vue'
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
const diagnostics = computed(() =>
  props.presenter.projection.value.unknown
    .filter((record) => record.type === 'pi.message.final')
    .map((record) =>
      piFailure(
        record.data && typeof record.data === 'object' && !Array.isArray(record.data)
          ? (record.data as Record<string, unknown>)
          : {}
      )
    )
    .filter(Boolean)
)
const emit = defineEmits<{ (e: 'new-chat'): void; (e: 'choose-worktree'): void }>()
// The presenter owns resource identities; this thin view supplies Obsidian's dialog adapter.
const stopFiles = props.presenter.setFilesOpener?.((model, path, range) =>
  openNodeFiles(model, props.presenter.connection, path, range)
)
onUnmounted(() => stopFiles?.())
const labels = {
  offline: 'Offline',
  queued: 'Queued',
  accepted: 'Accepted',
  running: 'Running',
  'needs-attention': 'Needs attention',
  idle: 'Connected · Idle',
}
const icons = {
  offline: 'wifi-off',
  queued: 'clock',
  accepted: 'check',
  running: 'loader',
  'needs-attention': 'circle-alert',
  idle: 'circle-check',
}
const title = computed(
  () =>
    `${props.presenter.label.value} · ${providerLabel(props.presenter.provider?.value ?? 'fake')}`
)
const status = computed(() =>
  props.presenter.connection.state.value === 'connecting'
    ? 'Connecting…'
    : labels[props.presenter.state.value]
)
const statusIcon = computed(() =>
  props.presenter.connection.state.value === 'connecting'
    ? 'loader'
    : icons[props.presenter.state.value]
)
const offline = computed(() => props.presenter.connection.state.value !== 'connected')
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
  const tasks = n ? `, ${n === 1 ? 'the task' : `${n} tasks`} running in the background` : ''
  return `This stops the answer${tasks} and the session's process. The conversation stays; your next message starts the session again.`
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
const detailsOpen = ref(false)
const expanded = ref(false),
  sending = ref(false),
  permissionFixture = ref(false)
const scroller = ref<HTMLElement>()
const artifacts = ref<Record<string, string>>({})
const recordArtifact = (data: unknown): string => {
  const id =
    data && typeof data === 'object' ? (data as Record<string, unknown>).artifact_id : undefined
  return typeof id === 'string' ? id : ''
}
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
      .setTitle(providerLabel(props.presenter.provider?.value ?? 'fake'))
      .setIcon('terminal')
      .setDisabled(true)
  )
  if (props.presenter.debuggerAvailable?.value === true)
    menu.addItem((i) =>
      i
        .setTitle('Debug')
        .setIcon('bug-play')
        .onClick(() => {
          void openNodeDebugger(props.presenter)
        })
    )
  if (props.presenter.debuggerAvailable?.value === true)
    menu.addItem((i) =>
      i
        .setTitle('Run a program')
        .setIcon('play')
        .onClick(() => {
          void startNodeProgram(props.presenter)
        })
    )
  if (props.presenter.debuggerAvailable?.value === true)
    menu.addItem((i) =>
      i
        .setTitle('Attach to a running program')
        .setIcon('plug')
        .onClick(() => {
          void attachNodeProgram(props.presenter)
        })
    )
  menu.addItem((i) => i.setTitle('Folders and worktrees').setIcon('server').onClick(workspaces))
  menu.addItem((i) =>
    i
      .setTitle('Rename…')
      .setIcon('pencil')
      .onClick(() => (renameOpen.value = true))
  )
  if (live.value)
    menu.addItem((i) =>
      i
        .setTitle('Stop the session…')
        .setIcon('octagon-x')
        .setWarning(true)
        .setSection('danger')
        .onClick(() => (stopOpen.value = true))
    )
  menu.addItem((i) =>
    i
      .setTitle('Reconnect')
      .setIcon('refresh-cw')
      .onClick(() => {
        void props.presenter.connection.connect().catch(() => {})
      })
  )
  if (props.presenter.provider?.value !== 'fake') {
    menu.addItem((i) =>
      i
        .setTitle(
          props.presenter.provider?.value === 'pi' &&
            capabilityReason(props.presenter.providerReport?.value, 'resume')
            ? `Session resume · ${capabilityReason(props.presenter.providerReport?.value, 'resume')}`
            : 'Session resume'
        )
        .setDisabled(
          props.presenter.provider?.value === 'pi' &&
            !!capabilityReason(props.presenter.providerReport?.value, 'resume')
        )
        .setIcon('history')
        .onClick(
          () =>
            new Notice(
              props.presenter.nativeSessionId?.value
                ? `Follow-ups resume native session ${props.presenter.nativeSessionId.value}.`
                : 'A native session identity is not available yet.'
            )
        )
    )
    menu.addItem((i) =>
      i
        .setTitle(
          props.presenter.provider?.value === 'pi'
            ? `Steer turn · ${capabilityReason(props.presenter.providerReport?.value, 'steering') || 'Queued follow-ups only'}`
            : 'Steer turn'
        )
        .setDisabled(true)
        .setIcon('corner-up-right')
        .onClick(() => {
          props.presenter.error.value =
            'Steering is not supported yet. Send a queued follow-up instead.'
        })
    )
    menu.addItem((i) =>
      i
        .setTitle(
          props.presenter.provider?.value === 'pi'
            ? `Provider questions · ${capabilityReason(props.presenter.providerReport?.value, 'extension_prompts') || 'Answer only provider-issued questions'}`
            : 'Ask a question'
        )
        .setDisabled(true)
        .setIcon('circle-help')
        .onClick(() => {
          props.presenter.error.value = 'Interactive questions are not supported yet.'
        })
    )
  } else
    menu.addItem((i) =>
      i
        .setTitle('Ask for permission')
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
/** Back to the words a place replies to: its message brought into view, the words flashed. */
const showReply = (to: ChatReplyTo) => {
  const el = scroller.value?.querySelector<HTMLElement>(
    `[data-node-message="${CSS.escape(to.messageId)}"]`
  )
  if (!el) {
    new Notice('That message is no longer in this chat')
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
const readArtifact = async (id: string) => {
  try {
    artifacts.value[id] = await props.presenter.artifact(id)
  } catch (error) {
    props.presenter.error.value =
      error instanceof Error ? error.message : 'Could not read stored output'
  }
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
  &__older {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--size-4-2);
    padding: var(--size-4-2);
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
  }
  &__details-spacer {
    visibility: hidden;
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
  &__title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  &__indicator {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--size-4-1);
    color: var(--text-muted);
  }
  .abele-ai-chat__header-actions {
    flex-shrink: 0;
  }
  &__status-label {
    display: none;
  }
  .abele-worktree-chip {
    flex: 0 1 auto;
  }
  @container (max-width: 30em) {
    .abele-ai-chat__header {
      flex-wrap: wrap;
    }
    .abele-worktree-chip {
      order: 2;
      width: 100%;
    }
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
