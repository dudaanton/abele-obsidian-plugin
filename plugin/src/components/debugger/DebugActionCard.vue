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
    <!-- A reading of the run changes nothing: what it asked is in its head, there is no exact
         action to check. -->
    <details
      v-if="(action.exact || action.detail) && !action.kind.startsWith('trace_')"
      class="abele-debug-action__exact"
    >
      <summary>{{ t('streamC.26bb6c1a72d4f414') }}</summary>
      <pre>{{ action.exact ?? action.detail }}</pre>
    </details>
    <div v-if="action.awaitingResult" class="abele-debug-action__result" role="status">
      {{ t('streamC.ce9dc7a8bc7d98f2') }}
    </div>
    <div v-if="action.result" class="abele-debug-action__result">
      <NodeErrorText v-if="action.status !== 'done'" :error="action.result" />
      <template v-else>{{ action.result }}</template>
    </div>
    <div
      v-if="action.status === 'asked' && !action.awaitingResult"
      class="abele-debug-action__buttons"
    >
      <Button
        :text="t('streamC.05a2d7332eb9d8bf')"
        :disabled="disabled"
        :tooltip="t('streamC.a3a900ae248b3e68')"
        @click="emit('deny')"
      />
      <Button
        :text="t('streamC.e213c161d5cefa52')"
        :disabled="disabled"
        :tooltip="t('streamC.db2a63b909320df2')"
        @click="emit('allow')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { t } from '@/i18n'

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
  'step-over': t('streamC.3d2758bb075c848b'),
  'step-into': t('streamC.1f581e2445e35faf'),
  'step-out': t('streamC.1d51cb62f8d46cb0'),
  continue: t('streamC.31fbef162594de01'),
  pause: t('streamC.858e4ba7a29fd38b'),
  evaluate: t('streamC.966591fe7e17f107'),
  set: t('streamC.e886d80c297e091b'),
  breakpoint: t('streamC.6df35e37fd3ee650'),
  restart: t('streamC.6b983a81e5e8099e'),
  stop: t('streamC.cae7d57bc067a514'),
  'record-point': t('streamC.695ca711fda0c74d'),
  record: t('streamC.e773b37f1caf9799'),
  trace_timeline: t('streamC.07f4b3ad482c015d'),
  trace_shape: t('streamC.9f761c27da05deec'),
  trace_slice: t('streamC.b9d944886273016a'),
  trace_diff: t('streamC.95a07e09165e3bb4'),
  trace_find: t('streamC.a86dabc0ace138e8'),
  trace_follow: t('streamC.20c3a692f1425939'),
  trace_mark: t('streamC.d7cda0ca2c8586e5'),
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
  'record-point': 'diamond-plus',
  record: 'circle-dot',
  trace_timeline: 'list',
  trace_shape: 'list-tree',
  trace_slice: 'scissors',
  trace_diff: 'diff',
  trace_find: 'search',
  trace_follow: 'footprints',
  trace_mark: 'flag',
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
      done: t('streamC.11a6767d5674c7e4'),
      denied: t('streamC.176a60da255fb23b'),
      unknown: props.action.result ?? t('streamC.165b25262bb6405a'),
      expired: props.action.result ?? t('streamC.056e459c82ac466f'),
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
