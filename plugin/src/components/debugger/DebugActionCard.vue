<template>
  <div class="abele-debug-action" :class="`abele-debug-action_${action.status}`">
    <div class="abele-debug-action__head">
      <Icon :icon="icons[action.kind] ?? 'bug'" size="xs" :interactive="false" />
      <span class="abele-debug-action__what">{{ names[action.kind] ?? action.kind }}</span>
      <code v-if="action.detail" class="abele-debug-action__detail">{{ action.detail }}</code>
      <span class="abele-debug-action__at">{{ action.at }}</span>
      <span v-if="action.status !== 'asked'" ref="stateEl" class="abele-debug-action__state">
        <Icon :icon="stateIcon" size="xs" :interactive="false" />
      </span>
    </div>
    <details v-if="action.exact || action.detail" class="abele-debug-action__exact">
      <summary>Exact action</summary>
      <pre>{{ action.exact ?? action.detail }}</pre>
    </details>
    <div v-if="action.awaitingResult" class="abele-debug-action__result" role="status">
      Awaiting result
    </div>
    <div v-if="action.result" class="abele-debug-action__result">
      {{ action.result }}
    </div>
    <div
      v-if="action.status === 'asked' && !action.awaitingResult"
      class="abele-debug-action__buttons"
    >
      <Button
        text="Deny"
        :disabled="disabled"
        tooltip="Do not let the agent do this"
        @click="emit('deny')"
      />
      <Button
        text="Allow"
        :disabled="disabled"
        tooltip="Let the agent do exactly this, once"
        @click="emit('allow')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// One action of the chat agent in the debug session, where it happened: in the chat, between its
// messages, like any tool call. Asked: the exact action, where the program stood, Allow and Deny.
// Done, denied or expired: a glyph at the end says which, the words are in its tooltip; a done
// action shows what it gave back.
import { computed, onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import type { DebugAction } from './types'

const props = withDefaults(defineProps<{ action: DebugAction; disabled?: boolean }>(), {
  disabled: false,
})
const emit = defineEmits<{ (e: 'allow'): void; (e: 'deny'): void }>()

const names: Record<string, string> = {
  'step-over': 'Step over',
  'step-into': 'Step into',
  'step-out': 'Step out',
  continue: 'Continue',
  pause: 'Pause',
  evaluate: 'Evaluate',
  set: 'Change a value',
  breakpoint: 'Breakpoint',
  restart: 'Restart',
  stop: 'Stop',
}
const icons: Record<string, string> = {
  'step-over': 'redo-dot',
  'step-into': 'arrow-down-to-dot',
  'step-out': 'arrow-up-from-dot',
  continue: 'play',
  pause: 'pause',
  evaluate: 'square-function',
  set: 'pencil',
  breakpoint: 'circle-dot',
  restart: 'rotate-ccw',
  stop: 'square',
}
const stateIcon = computed(
  () =>
    ({ done: 'check', denied: 'x', expired: 'clock-alert', unknown: 'circle-help', asked: '' })[
      props.action.status
    ]
)
const stateEl = ref<HTMLElement>()
const tip = () =>
  stateEl.value &&
  setTooltip(
    stateEl.value,
    {
      done: 'Done',
      denied: 'You denied it',
      unknown: props.action.result ?? 'Execution outcome unknown; do not replay',
      expired: props.action.result ?? 'Not done: the program moved on before it was allowed',
      asked: '',
    }[props.action.status]
  )
onMounted(tip)
watch(() => [props.action.status, props.action.result], tip, { flush: 'post' })
</script>

<style lang="scss">
.abele-debug-action {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-3);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  font-size: var(--font-ui-small);
}
.abele-debug-action_asked {
  border-color: var(--interactive-accent);
}
.abele-debug-action__head {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  min-width: 0;

  .abele-obsidian-icon {
    padding: 0;
    color: var(--icon-color);
  }
}
.abele-debug-action__what {
  flex: 0 0 auto;
  color: var(--text-normal);
}
.abele-debug-action__detail {
  min-width: 0;
  overflow: hidden;
  color: var(--code-normal);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-debug-action__at {
  flex: 0 0 auto;
  margin-inline-start: auto;
  color: var(--text-faint);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
.abele-debug-action__state {
  display: flex;
}
.abele-debug-action_done .abele-debug-action__state .abele-obsidian-icon {
  color: var(--text-success);
}
.abele-debug-action_denied,
.abele-debug-action_expired {
  .abele-debug-action__what,
  .abele-debug-action__detail {
    color: var(--text-muted);
  }
}
.abele-debug-action_expired .abele-debug-action__detail {
  text-decoration: line-through;
}
.abele-debug-action__result {
  padding-inline-start: calc(var(--icon-xs) + var(--size-4-2));
  color: var(--text-muted);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
.abele-debug-action__exact {
  color: var(--text-muted);
  min-width: 0;
  pre {
    margin: var(--size-4-2) 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}
.abele-debug-action__head {
  flex-wrap: wrap;
}
.abele-debug-action__result {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.abele-debug-action__buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--size-4-2);
}
</style>
