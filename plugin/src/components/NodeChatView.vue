<template>
  <div class="abele-node-chat">
    <div class="abele-ai-chat__header">
      <span class="abele-node-chat__title" :title="title">{{ presenter.label.value }}</span>
      <div class="abele-ai-chat__header-actions">
        <span class="abele-node-chat__indicator" role="status" :title="status" :aria-label="status">
          <Icon :icon="statusIcon" no-hover />
          <span class="abele-node-chat__status-label">{{ status }}</span>
        </span>
        <Icon
          v-for="runId in presenter.projection.value.activeRuns"
          :key="runId"
          icon="square"
          with-bg
          role="button"
          tabindex="0"
          aria-label="Interrupt turn"
          tooltip="Interrupt turn"
          :disabled="offline"
          @click="presenter.interrupt(runId)"
          @keydown.enter.prevent="!offline && presenter.interrupt(runId)"
          @keydown.space.prevent="!offline && presenter.interrupt(runId)"
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
    <div v-show="!expanded" ref="scroller" class="abele-ai-chat__messages">
      <NodeMessageTree
        :messages="presentation.messages"
        :children="presenter.projection.value.children || {}"
        :queue-states="presentation.states"
        :offline="offline"
        :open-resource="openResource"
        @cancel="presenter.cancelInput($event)"
      />
      <div v-for="artifact in presenter.projection.value.artifacts" :key="artifact.artifactId">
        <Button text="Read stored output" @click="readArtifact(artifact.artifactId)" />
        <pre v-if="artifacts[artifact.artifactId]">{{ artifacts[artifact.artifactId] }}</pre>
      </div>
      <NodePermissionCard
        v-for="prompt in presenter.projection.value.prompts"
        :key="prompt.prompt_id"
        :prompt="prompt"
        :fake="presenter.provider?.value !== 'claude'"
        :disabled="answering || offline"
        @answer="answer(prompt, $event)"
      />
      <div
        v-for="rejected in presenter.rejected.value"
        :key="rejected.id"
        class="abele-ai-chat__error"
        role="alert"
      >
        Not accepted: {{ rejected.text }} · {{ rejected.error }}
      </div>
      <details v-if="presenter.projection.value.unknown.length">
        <summary>Other journal records and provider evidence</summary>
        <template v-for="record in presenter.projection.value.unknown" :key="record.seq">
          <details v-if="recordArtifact(record.data)">
            <summary>{{ record.type }} · {{ record.seq }}</summary>
            <Button text="Read stored record" @click="readArtifact(recordArtifact(record.data))" />
            <pre v-if="artifacts[recordArtifact(record.data)]">{{
              artifacts[recordArtifact(record.data)]
            }}</pre>
          </details>
        </template>
        <pre>{{ JSON.stringify(presenter.projection.value.unknown, null, 2) }}</pre>
      </details>
    </div>
    <AiChatInput
      :key="presenter.id"
      v-model:expanded="expanded"
      :conversation-draft="presenter.draft.value"
      :is-streaming="false"
      :is-busy="sending"
      :text-only="true"
      :can-continue="false"
      token-display=""
      scope-label=""
      @send="send"
    />
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Menu, Notice } from 'obsidian'
import type { Prompt } from '@abele/node-client'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { nodeQueueView } from '@/node/presentation'
import { NodeService } from '@/node/NodeService'
import { openNodeWorkspaces } from '@/node/openSession'
import NodeMessageTree from './NodeMessageTree.vue'
import NodePermissionCard from './NodePermissionCard.vue'
import AiChatInput from './AiChatInput.vue'
import Icon from './obsidian/Icon.vue'
import Button from './obsidian/Button.vue'
const props = defineProps<{ presenter: NodeChatPresenter }>()
const emit = defineEmits<{ (e: 'new-chat'): void }>()
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
    `${props.presenter.label.value} · ${props.presenter.provider?.value === 'claude' ? 'Claude Code' : 'Fake (non-executing)'}`
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
const expanded = ref(false),
  sending = ref(false),
  answering = ref(false),
  permissionFixture = ref(false)
const scroller = ref<HTMLElement>()
const artifacts = ref<Record<string, string>>({})
const recordArtifact = (data: unknown): string => {
  const id =
    data && typeof data === 'object' ? (data as Record<string, unknown>).artifact_id : undefined
  return typeof id === 'string' ? id : ''
}
const openResource = (path: string) => props.presenter.openResource(path)
const workspaces = () => {
  const node = NodeService.getInstance().nodes.value.find(
    (n) => n.id === props.presenter.reference.registrationId
  )
  if (node) openNodeWorkspaces(node, props.presenter.workspaceId?.value ?? undefined)
}
const openMenu = (event: MouseEvent | KeyboardEvent) => {
  const menu = new Menu()
  menu.addItem((i) =>
    i
      .setTitle(
        props.presenter.provider?.value === 'claude' ? 'Claude Code' : 'Fake (non-executing)'
      )
      .setIcon('terminal')
      .setDisabled(true)
  )
  menu.addItem((i) =>
    i.setTitle('Projects and workspaces').setIcon('git-branch').onClick(workspaces)
  )
  menu.addItem((i) =>
    i
      .setTitle('Reconnect')
      .setIcon('refresh-cw')
      .onClick(() => {
        void props.presenter.connection.connect().catch(() => {})
      })
  )
  if (props.presenter.provider?.value === 'claude') {
    menu.addItem((i) =>
      i
        .setTitle('Session resume')
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
        .setTitle('Steer turn')
        .setIcon('corner-up-right')
        .onClick(() => {
          props.presenter.error.value =
            'Steering is not supported yet. Send a queued follow-up instead.'
        })
    )
    menu.addItem((i) =>
      i
        .setTitle('Ask a question')
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
const send = async (text: string) => {
  sending.value = true
  try {
    if (permissionFixture.value && props.presenter.provider?.value !== 'claude')
      await props.presenter.send(text, [{ kind: 'permission', ttl_ms: 60000 }, { kind: 'echo' }])
    else await props.presenter.send(text)
  } finally {
    sending.value = false
  }
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
}
const answer = async (prompt: Prompt, choice: 'allow' | 'deny') => {
  answering.value = true
  try {
    await props.presenter.answer(prompt, choice)
  } finally {
    answering.value = false
  }
}
const readArtifact = async (id: string) => {
  try {
    artifacts.value[id] = await props.presenter.artifact(id)
  } catch (error) {
    props.presenter.error.value =
      error instanceof Error ? error.message : 'Could not read stored output'
  }
}
watch(
  () => props.presenter.messages.value,
  async () => {
    const el = scroller.value,
      atEnd = el && el.scrollHeight - el.scrollTop - el.clientHeight < 80
    await nextTick()
    if (el && atEnd) el.scrollTop = el.scrollHeight
  }
)
</script>
<style lang="scss">
.abele-node-chat {
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
