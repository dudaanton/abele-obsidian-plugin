<template>
  <section class="abele-section">
    <div v-if="title || $slots.actions" class="abele-section__header">
      <slot name="lead" />
      <h3 v-if="title" ref="heading" class="abele-section__heading">{{ title }}</h3>
      <div v-if="$slots.actions" class="abele-section__actions"><slot name="actions" /></div>
    </div>
    <p v-if="desc || $slots.desc" class="abele-section__desc">
      <slot name="desc">{{ desc }}</slot>
    </p>
    <slot />
  </section>
</template>

<script setup lang="ts">
import { ref, watchEffect, onMounted } from 'vue'
import { setTooltip } from 'obsidian'
const props = defineProps<{
  /** Omitted when the group already has a heading above it — a tab label, say. */
  title?: string
  /** Plain text. For a description carrying markup, fill the `desc` slot instead. */
  desc?: string
  tooltip?: string
}>()
const heading = ref<HTMLElement>()
onMounted(() => {
  if (heading.value) setTooltip(heading.value, props.tooltip ?? '')
})
watchEffect(() => {
  if (heading.value) setTooltip(heading.value, props.tooltip ?? '')
})
</script>

<style lang="scss">
.abele-section {
  margin-top: var(--size-4-8);

  &:first-child {
    margin-top: 0;
  }
}

.abele-section__header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin: 0 0 var(--size-4-2);
}

.abele-section__actions {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  margin-inline-start: auto;
}

// A phone's glyph keeps its whole tap box, its height taken back by a margin, so the header is as
// tall as its heading and the rows under it start where they would without the glyph.
.is-phone .abele-section__actions .clickable-icon {
  margin-block: calc(-1 * var(--size-2-3));
}

// Obsidian pads its settings' headings to its own groups' edge; the header here already stands
// at the rows' text edge, so the heading takes no more.
.abele-section .abele-section__heading {
  margin: 0;
  padding-inline: 0;
  font-size: var(--font-ui-small);
  font-weight: var(--font-bold);
  line-height: var(--line-height-normal);
}

.abele-section__desc {
  margin: 0 0 var(--size-4-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

// Over a group of settings the heading and its words start where the words in the rows do.
.abele-section:has(> .abele-obsidian-setting) {
  > .abele-section__header,
  > .abele-section__desc {
    padding-inline: var(--size-4-5);
  }
}
// In a dialog the rows are not cards: their words stand at the dialog's text edge, and so do the
// heading's.
.modal:not(.mod-settings) .abele-section:has(> .abele-obsidian-setting) {
  > .abele-section__header,
  > .abele-section__desc {
    padding-inline: 0;
  }
}
</style>
