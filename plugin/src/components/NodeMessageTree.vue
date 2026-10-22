<template>
  <!-- The node chat's messages as the regular chat draws them: tool calls in a row folded into
       one line of work, opened on a press; a call's nested agent work inside it. -->
  <template
    v-for="block in blocks"
    :key="block.kind === 'run' ? `run:${block.id}` : block.message.id"
  >
    <ChatToolRun
      v-if="block.kind === 'run'"
      :id="block.id"
      :calls="block.calls"
      :open="isOpen(block)"
      :resource-opener="openResource"
      @update:open="(open) => chosen.set(block.id, open)"
    >
      <template v-for="message in block.messages" :key="message.id">
        <NodeMessage
          :data-node-message="message.id"
          v-bind="messageProps(message)"
          v-on="handlers"
        />
        <div v-if="children[message.id]?.length" class="abele-node-child-work">
          <NodeMessageTree
            v-if="depth < 12"
            :messages="children[message.id]"
            :children="children"
            :depth="depth + 1"
            :target="target"
            :open-resource="openResource"
            :queue-states="queueStates"
            :offline="offline"
            :tool-prompts="toolPrompts"
            :prompt-diffs="promptDiffs"
            v-on="handlers"
          />
        </div>
      </template>
    </ChatToolRun>
    <NodeMessage
      v-else
      :data-node-message="block.message.id"
      v-bind="messageProps(block.message)"
      v-on="handlers"
    />
    <template v-if="block.kind === 'run' && !isOpen(block)">
      <NodeCodexNetworkRefusal
        v-for="call in block.calls.filter(isCodexNetworkMessage)"
        :key="call.id"
        :node-id="target?.registrationId"
        :project-id="target?.projectId"
      />
    </template>
    <slot
      name="after-message"
      :message="block.kind === 'run' ? block.messages[block.messages.length - 1] : block.message"
    />
  </template>
</template>
<script setup lang="ts">
import type { ChatMessage, ChatReplyTo } from '@/ai/types'
import type { QueueState } from '@/node/presentation'
import type { Prompt } from '@abele/node-client'
import type { NodeHistoryAction } from '@/node/NodeChatHistory'
import { computed, reactive } from 'vue'
import { callState, chatBlocks, type ChatBlock } from '@/ai/toolRuns'
import ChatToolRun from './ChatToolRun.vue'
import NodeMessage from './NodeMessage.vue'
import NodeCodexNetworkRefusal from './NodeCodexNetworkRefusal.vue'
import { isCodexNetworkMessage } from '@/node/codexNetwork'
import type { PathTarget } from '@/node/NodePathModel'
const props = withDefaults(
  defineProps<{
    messages: ChatMessage[]
    target?: PathTarget
    children: Record<string, ChatMessage[]>
    depth?: number
    openResource: (path: string) => void
    queueStates?: Record<string, QueueState>
    offline?: boolean
    /** The agent's answers here can be replied to from the composer; nested work cannot. */
    canReply?: boolean
    toolPrompts?: Record<string, Prompt[]>
    promptDiffs?: Record<string, { path: string; old: string; new: string }[]>
    historyFor?: (messageId: string) => { reason: string } | undefined
  }>(),
  {
    depth: 0,
    target: undefined,
    queueStates: () => ({}),
    toolPrompts: () => ({}),
    promptDiffs: () => ({}),
    historyFor: undefined,
  }
)
const emit = defineEmits<{
  (e: 'cancel', inputId: string): void
  (e: 'retry', messageId: string): void
  (e: 'reply', to: ChatReplyTo): void
  (e: 'show-reply', to: ChatReplyTo): void
  /** Another session on the node, named by a message, opened in its own chat. */
  (e: 'open-session', sessionId: string): void
  (e: 'history-action', messageId: string, action: NodeHistoryAction): void
}>()
const blocks = computed(() => chatBlocks(props.messages))
/** A run the reader opened or closed stays so; otherwise it is open while it works or waits. */
const chosen = reactive(new Map<string, boolean>())
const isOpen = (block: Extract<ChatBlock, { kind: 'run' }>) =>
  chosen.get(block.id) ??
  block.calls.some((c) => callState(c) === 'running' || c.toolStatus === 'pending')
const messageProps = (message: ChatMessage) => ({
  message,
  target: props.target,
  openResource: props.openResource,
  queueState: props.queueStates[message.id],
  offline: props.offline,
  canReply: props.canReply && props.depth === 0,
  prompts: props.toolPrompts?.[message.id],
  promptDiffs: props.promptDiffs,
  historyState: props.depth === 0 ? props.historyFor?.(message.id) : undefined,
})
const handlers = {
  cancel: (id: string) => emit('cancel', id),
  retry: (id: string) => emit('retry', id),
  reply: (to: ChatReplyTo) => emit('reply', to),
  'show-reply': (to: ChatReplyTo) => emit('show-reply', to),
  'open-session': (id: string) => emit('open-session', id),
  'history-action': (id: string, action: NodeHistoryAction) => emit('history-action', id, action),
}
</script>
<style lang="scss">
.abele-node-error-text {
  flex: 1;
  min-width: 0;
}
.abele-node-child-work {
  margin-inline-start: var(--size-4-3);
  padding-inline-start: var(--size-4-2);
  border-inline-start: var(--border-width) solid var(--background-modifier-border);
}
.abele-node-message-note {
  color: var(--text-muted);
}
.abele-node-queue-state {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  color: var(--text-muted);
}
</style>
