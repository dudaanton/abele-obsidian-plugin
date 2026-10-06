<template>
  <div class="abele-node-chat">
    <div class="abele-ai-chat__header">
      <span>{{ presenter.label.value }} · Fake (non-executing)</span>
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
    <Setting
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
      <AiChatMessage
        v-for="message in presenter.messages.value"
        :key="message.id"
        :message="message"
        :read-only-history="true"
        :resource-opener="openResource"
      />
      <div v-for="artifact in presenter.projection.value.artifacts" :key="artifact.artifactId">
        <Button text="Read stored output" @click="readArtifact(artifact.artifactId)" />
        <pre v-if="artifacts[artifact.artifactId]">{{ artifacts[artifact.artifactId] }}</pre>
      </div>
      <Setting
        v-for="prompt in presenter.projection.value.prompts"
        :key="prompt.prompt_id"
        name="Permission request"
        :desc="
          prompt.state === 'pending'
            ? 'The fake session is waiting for your decision. No tools will execute.'
            : `Permission ${prompt.state}${prompt.choice ? ': ' + prompt.choice : ''}`
        "
      >
        <template v-if="prompt.state === 'pending'">
          <Button
            text="Allow"
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
        v-for="rejected in presenter.rejected.value"
        :key="rejected.id"
        class="abele-ai-chat__error"
        role="alert"
      >
        Not accepted: {{ rejected.text }} · {{ rejected.error }}
      </div>
      <details v-if="presenter.projection.value.unknown.length">
        <summary>Other journal records</summary>
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
import AiChatMessage from './AiChatMessage.vue'
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
const openResource = (path: string) => props.presenter.openResource(path)
const reconnect = () => {
  void props.presenter.connection.connect().catch(() => {})
}
const send = async (text: string) => {
  sending.value = true
  try {
    if (permissionFixture.value)
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
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}
</style>
