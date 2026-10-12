<template>
  <!-- Down the chat's edge, a mark per question where it stands in the chat; pointed at, it says
       which; clicked, it goes there. The one being read is the accent; one that needs you, its
       colour. The whole outline is a button away in the chat's header. -->
  <nav class="abele-chat-rail" aria-label="Questions of this chat">
    <button
      v-for="mark in marks"
      :key="mark.id"
      :ref="(el) => tip(el, mark)"
      type="button"
      class="abele-chat-rail__mark"
      :class="{
        'abele-chat-rail__mark_here': mark.id === here,
        [`abele-chat-rail__mark_${mark.tone}`]: !!mark.tone,
      }"
      :style="{ top: `${mark.at * 100}%` }"
      :aria-label="mark.title"
      :aria-current="mark.id === here ? 'true' : undefined"
      @click="emit('jump', mark.id)"
    />
  </nav>
</template>

<script setup lang="ts">
import { setTooltip } from 'obsidian'
import type { RailMark } from './outline'

defineProps<{
  marks: RailMark[]
  /** The question being read now. */
  here?: string
}>()
const emit = defineEmits<{ (e: 'jump', id: string): void }>()

const tip = (el: unknown, mark: RailMark) => {
  if (el instanceof HTMLElement)
    setTooltip(el, `${mark.when} · ${mark.title}`, { placement: 'left', delay: 50 })
}
</script>

<style lang="scss">
.abele-chat-rail {
  position: relative;
  width: var(--size-4-4);
  height: 100%;
}
// A mark is a short line, its button as tall as a tap needs, centred on where the question is.
.abele-chat-rail__mark {
  all: unset;
  position: absolute;
  inset-inline: 0;
  height: var(--size-4-3);
  translate: 0 -50%;
  cursor: var(--cursor);

  &::before {
    content: '';
    position: absolute;
    inset-inline-end: var(--size-2-2);
    top: calc(50% - var(--border-width));
    width: var(--size-4-2);
    height: calc(var(--border-width) * 2);
    border-radius: var(--radius-s);
    background-color: var(--text-faint);
    transition: width 0.1s ease;
  }
  &:hover::before,
  &:focus-visible::before {
    width: var(--size-4-3);
    background-color: var(--text-muted);
  }
}
.abele-chat-rail__mark_waiting::before {
  background-color: var(--color-orange);
}
.abele-chat-rail__mark_failed::before {
  background-color: var(--color-red);
}
.abele-chat-rail__mark_here::before,
.abele-chat-rail__mark_here:hover::before {
  width: var(--size-4-3);
  background-color: var(--interactive-accent);
}
body.is-phone .abele-chat-rail__mark {
  height: var(--size-4-5);
}
</style>
