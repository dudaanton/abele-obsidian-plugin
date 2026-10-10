<template>
  <div
    ref="el"
    class="abele-worktree-chip"
    role="button"
    tabindex="0"
    @click="emit('choose')"
    @keydown.enter.prevent="emit('choose')"
  >
    <Icon :icon="copyIcon(copy)" size="xs" :interactive="false" />
    <span class="abele-worktree-chip__folder">{{ folder }}</span>
    <span class="abele-worktree-chip__branch">{{ copy.branch }}</span>
    <Icon icon="chevrons-up-down" size="xs" :interactive="false" />
  </div>
</template>

<script setup lang="ts">
// Where a chat's agent works, in the chat's header: the folder and the worktree. Pressing it
// moves the chat to another worktree of the same folder; the agent can move itself too, and
// either way the chat says so in a line of its own.
import { onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import { copyIcon, copyKind } from './codes'
import type { CopySummary } from './types'

const props = defineProps<{ folder: string; copy: CopySummary }>()
const emit = defineEmits<{ (e: 'choose'): void }>()
const el = ref<HTMLElement>()
const tip = () =>
  el.value && setTooltip(el.value, `${copyKind(props.copy)} · ${props.copy.path} · press to switch`)
onMounted(tip)
watch(() => props.copy, tip, { flush: 'post' })
</script>

<style lang="scss">
.abele-worktree-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-1);
  min-width: 0;
  padding: var(--size-2-2) var(--size-4-2);
  border-radius: var(--radius-s);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  cursor: var(--cursor);

  &:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
  }
  .abele-obsidian-icon {
    padding: 0;
    color: var(--icon-color);
  }
}
.abele-worktree-chip__branch {
  min-width: 0;
  overflow: hidden;
  color: var(--text-normal);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
