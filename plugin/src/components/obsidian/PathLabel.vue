<template>
  <details
    v-if="mode !== 'full' && expandable"
    class="abele-path-label"
    @toggle="opened = ($event.target as HTMLDetailsElement).open"
  >
    <summary>
      <span
        ref="glyph"
        class="collapse-icon"
        :class="{ 'is-collapsed': !opened }"
        aria-hidden="true"
      />{{ compact }}
    </summary>
    <span v-if="workspace" class="abele-path-label__workspace">Workspace: {{ workspace }}</span>
    <span v-if="missing" class="abele-path-label__state">Unavailable on this device</span>
    <div class="abele-path-label__full">{{ path }}</div>
    <div class="abele-path-label__actions">
      <Icon v-if="copyable" icon="copy" tooltip="Copy full path" @click="emit('copy', path)" /><Icon
        v-if="revealable"
        icon="folder"
        tooltip="Reveal in file explorer"
        :disabled="missing"
        disabled-reason="Target unavailable"
        @click="emit('reveal', path)"
      />
    </div>
  </details>
  <span v-else class="abele-path-label"
    ><span v-if="workspace" class="abele-path-label__workspace">Workspace: {{ workspace }}</span
    ><span :class="{ 'abele-path-label__full': mode === 'full' }">{{
      mode === 'full' ? path : compact
    }}</span
    ><span v-if="missing" class="abele-path-label__state">Unavailable on this device</span></span
  >
</template>
<script setup lang="ts">
import { computed, ref, onMounted, watch, nextTick } from 'vue'
import { setIcon } from 'obsidian'
import Icon from './Icon.vue'
const props = withDefaults(
  defineProps<{
    path: string
    mode?: 'basename' | 'context' | 'full'
    workspace?: string
    missing?: boolean
    copyable?: boolean
    revealable?: boolean
    expandable?: boolean
  }>(),
  { mode: 'context', expandable: true }
)
const emit = defineEmits<{ copy: [path: string]; reveal: [path: string] }>()
const glyph = ref<HTMLElement>(),
  opened = ref(false)
const draw = () => {
  if (glyph.value) {
    glyph.value.replaceChildren()
    setIcon(glyph.value, 'right-triangle')
  }
}
onMounted(draw)
watch(
  () => [props.mode, props.expandable],
  () => void nextTick(draw)
)
const compact = computed(() => {
  const index = Math.max(props.path.lastIndexOf('/'), props.path.lastIndexOf('\\'))
  return props.mode === 'basename'
    ? props.path.slice(index + 1) || props.path
    : index < 0
      ? 'Vault root'
      : props.path.slice(0, index) || props.path.slice(0, 1)
})
</script>
<style>
.abele-path-label {
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  overflow-wrap: anywhere;
}
.abele-path-label > summary {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-1);
  list-style: none;
  cursor: var(--cursor-link);
}
.abele-path-label > summary::marker,
.abele-path-label > summary::-webkit-details-marker {
  display: none;
  content: '';
}
.abele-path-label__workspace,
.abele-path-label__state {
  display: block;
}
.abele-path-label__full {
  display: block;
  user-select: text;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.abele-path-label__actions {
  display: flex;
  gap: var(--size-4-1);
}
</style>
