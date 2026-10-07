<template>
  <div class="abele-tool-approval abele-node-permission">
    <div class="abele-tool-approval__header">
      <Icon icon="shield-alert" no-hover /><span>{{
        prompt.tool_name || 'Permission request'
      }}</span>
    </div>
    <div v-if="summary" class="abele-tool-approval__param">{{ summary }}</div>
    <details v-if="prompt.input">
      <summary>Original action</summary>
      <Diff
        v-if="
          prompt.tool_name === 'Edit' &&
          typeof prompt.input.old_string === 'string' &&
          typeof prompt.input.new_string === 'string'
        "
        :text-left="prompt.input.old_string"
        :text-right="prompt.input.new_string"
      />
      <pre
        class="abele-tool-approval__code"
      ><code>{{ JSON.stringify(prompt.input, null, 2) }}</code></pre>
    </details>
    <div
      v-if="prompt.state === 'pending' && answerState"
      class="abele-node-permission__note"
      role="status"
    >
      Answer sent · {{ answerState.choice === 'allow' ? 'Approve' : 'Deny' }}
      <template v-if="answerState.state === 'pending'"> · waiting for confirmation</template>
      <template v-if="answerState.error"> · not accepted: {{ answerState.error }}</template>
    </div>
    <template v-else-if="prompt.state === 'pending'">
      <div v-if="expiry" class="abele-node-permission__note">{{ expiry }}</div>
      <div class="abele-tool-approval__actions">
        <Button
          :text="fake ? 'Allow' : 'Approve'"
          accent
          :disabled="disabled"
          tooltip="Approve exactly this action once"
          @click="emit('answer', 'allow')"
        />
        <Button
          text="Deny"
          :disabled="disabled"
          tooltip="Do not allow this action"
          @click="emit('answer', 'deny')"
        />
      </div>
    </template>
    <div v-else class="abele-node-permission__note">
      Permission {{ prompt.state }}{{ prompt.choice ? ': ' + prompt.choice : '' }}
      <template v-if="prompt.state === 'resolved'">
        ·
        {{
          prompt.delivered
            ? 'Decision delivered to provider'
            : 'Decision saved; delivery not confirmed'
        }}</template
      >
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { Prompt } from '@abele/node-client'
import { toolSummary } from '@/ai/toolLine'
import { promptExpiry } from '@/node/presentation'
import type { PromptAnswerState } from '@/node/promptAnswers'
import { useDisplayClock } from '@/composables/useDisplayClock'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import Diff from './Diff.vue'
const props = defineProps<{
  prompt: Prompt
  disabled: boolean
  fake?: boolean
  answerState?: PromptAnswerState
}>()
const emit = defineEmits<{ (e: 'answer', choice: 'allow' | 'deny'): void }>()
const now = useDisplayClock('minute', () => props.prompt.state === 'pending' && !props.answerState)
const expiry = computed(() => promptExpiry(props.prompt.expires_at, now.value))
const summary = computed(() =>
  toolSummary({ toolName: props.prompt.tool_name, toolParams: props.prompt.input })
)
</script>
<style lang="scss">
.abele-node-permission {
  .abele-tool-approval__actions {
    margin-top: var(--size-4-2);
    flex-wrap: nowrap;
  }
  .abele-tool-approval__actions button {
    width: auto;
  }
  .abele-tool-approval__code {
    max-height: none;
  }
  &__note {
    color: var(--text-muted);
    margin-top: var(--size-4-1);
  }
  details {
    margin-block: var(--size-4-1);
  }
}
</style>
