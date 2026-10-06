<template>
  <div class="abele-node-chat">
    <div class="abele-ai-chat__header">
      <span
        >{{ presenter.label.value }} ·
        {{ presenter.provider?.value === 'claude' ? 'Claude Code' : 'Fake (non-executing)' }}</span
      >
      <Button text="Projects and workspaces" @click="workspaces" />
      <Icon icon="plus" with-bg tooltip="New chat or node session" @click="emit('new-chat')" />
    </div>
    <div class="abele-node-chat__status" role="status">
      {{ labels[presenter.state.value] }}
      <template v-if="presenter.connection.state.value === 'connecting'"> · Connecting…</template>
      <template v-if="presenter.state.value === 'offline' && presenter.queued.value.length">
        · {{ presenter.queued.value.length }} queued on this device</template
      >
      <Button v-if="presenter.state.value === 'offline'" text="Reconnect" @click="reconnect" />
    </div>
    <div v-if="presenter.provider?.value === 'claude'" class="abele-node-chat__status">
      Steering and questions are not supported yet.
      <details v-if="presenter.nativeSessionId?.value">
        <summary>Session resume</summary>
        <span>Follow-ups resume native session {{ presenter.nativeSessionId.value }}.</span>
      </details>
      <Button
        v-for="runId in presenter.projection.value.activeRuns"
        :key="runId"
        text="Interrupt turn"
        :disabled="presenter.connection.state.value !== 'connected'"
        @click="presenter.interrupt(runId)"
      />
    </div>
    <Setting
      v-else
      name="Ask for permission"
      desc="Pause the next fake turn for Allow or Deny. Nothing executes."
    >
      <Checkbox :is-enabled="permissionFixture" @toggle="permissionFixture = !permissionFixture" />
    </Setting>
    <div
      v-if="presenter.error.value || presenter.connection.error.value"
      class="abele-ai-chat__error"
      role="alert"
    >
      {{ presenter.error.value || presenter.connection.error.value }}
    </div>
    <div ref="scroller" v-show="!expanded" class="abele-ai-chat__messages">
      <NodeMessageTree
        :messages="presenter.messages.value"
        :children="presenter.projection.value.children || {}"
        :open-resource="openResource"
      />
      <div v-for="artifact in presenter.projection.value.artifacts" :key="artifact.artifactId">
        <Button text="Read stored output" @click="readArtifact(artifact.artifactId)" />
        <pre v-if="artifacts[artifact.artifactId]">{{ artifacts[artifact.artifactId] }}</pre>
      </div>
      <Setting
        v-for="prompt in presenter.projection.value.prompts"
        :key="prompt.prompt_id"
        :name="prompt.tool_name ? `Permission request · ${prompt.tool_name}` : 'Permission request'"
        :desc="
          prompt.state === 'pending'
            ? presenter.provider?.value === 'claude'
              ? 'Approve exactly this action or deny it. Your decision applies only to this request.'
              : 'The fake session is waiting for your decision. No tools will execute.'
            : `Permission ${prompt.state}${prompt.choice ? ': ' + prompt.choice : ''}`
        "
      >
        <pre v-if="prompt.input">{{ JSON.stringify(prompt.input, null, 2) }}</pre>
        <span v-if="prompt.state === 'pending'"
          >Expires {{ new Date(prompt.expires_at).toLocaleString() }}</span
        >
        <span v-else-if="prompt.state === 'resolved'">{{
          prompt.delivered
            ? 'Decision delivered to provider'
            : 'Decision saved; provider delivery not confirmed'
        }}</span>
        <template v-if="prompt.state === 'pending'">
          <Button
            :text="presenter.provider?.value === 'claude' ? 'Approve' : 'Allow'"
            :disabled="answering || presenter.connection.state.value !== 'connected'"
            @click="answer(prompt, 'allow')"
          />
          <Button
            text="Deny"
            :disabled="answering || presenter.connection.state.value !== 'connected'"
            @click="answer(prompt, 'deny')"
          />
        </template>
      </Setting>
      <div
        v-for="queued in presenter.queued.value"
        :key="queued.id"
        class="abele-ai-chat__queued-item"
      >
        <Icon icon="clock" no-hover />
        <span>Queued on this device: {{ queued.text }}</span>
      </div>
      <div
        v-for="input in presenter.projection.value.queuedInputs"
        :key="input.id"
        class="abele-ai-chat__queued-item"
      >
        <span>Queued on node: {{ input.text }}</span>
        <Button
          text="Cancel queued input"
          :disabled="presenter.connection.state.value !== 'connected'"
          @click="presenter.cancelInput(input.id)"
        />
      </div>
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
import { nextTick, ref, watch } from 'vue'
import type { Prompt } from '@abele/node-client'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import NodeMessageTree from './NodeMessageTree.vue'
import { NodeService } from '@/node/NodeService'
import { openNodeWorkspaces } from '@/node/openSession'
import AiChatInput from './AiChatInput.vue'
import Icon from './obsidian/Icon.vue'
import Button from './obsidian/Button.vue'
import Setting from './obsidian/Setting.vue'
import Checkbox from './obsidian/Checkbox.vue'

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
const expanded = ref(false)
const sending = ref(false)
const answering = ref(false)
const permissionFixture = ref(false)
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
const reconnect = () => {
  void props.presenter.connection.connect().catch(() => {})
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
    const el = scroller.value
    const atEnd = el && el.scrollHeight - el.scrollTop - el.clientHeight < 80
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
  .abele-ai-chat__header {
    flex-wrap: wrap;
    overflow-wrap: anywhere;
  }
  .abele-node-chat__status {
    padding: var(--size-4-2);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .setting-item {
    flex-wrap: wrap;
    gap: var(--size-4-2);
  }
  .setting-item-control {
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
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
