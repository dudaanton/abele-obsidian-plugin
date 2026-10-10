<template>
  <div
    class="tree-item abele-item-row"
    :class="{
      'abele-item-row_selected': selected,
      'abele-item-row_strong': strong,
      'abele-item-row_unavailable': unavailable,
      'abele-item-row_multiline': multiline,
      'abele-item-row_static': !openable,
    }"
  >
    <div
      class="tree-item-self abele-item-row__self"
      :class="{ 'is-clickable': openable, 'is-active': selected }"
    >
      <button
        v-if="openable"
        class="abele-item-row__hit"
        type="button"
        :aria-label="label || title"
        :aria-current="selected ? 'true' : undefined"
        @click="emit('open')"
      />
      <div v-if="icon || $slots.leading" class="tree-item-icon abele-item-row__leading">
        <slot name="leading"><Icon :icon="icon" no-hover /></slot>
      </div>
      <div class="tree-item-inner abele-item-row__body">
        <div class="abele-item-row__head">
          <span class="abele-item-row__title"
            ><slot name="title">{{ title }}</slot></span
          >
          <span v-if="$slots.trailing" class="abele-item-row__trailing"
            ><slot name="trailing"
          /></span>
        </div>
        <div v-if="description || $slots.description" class="abele-item-row__description">
          <slot name="description">{{ description }}</slot>
        </div>
        <div v-if="excerpt" class="abele-item-row__excerpt">{{ excerpt }}</div>
      </div>
      <div v-if="$slots.actions" class="tree-item-flair-outer abele-item-row__actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// One object per row, laid out the way Nuxt UI lays out its list items: leading icon, title,
// a muted description under it and a trailing fact on the title's own line. The look is
// Obsidian's tree item (padding, radius, hover, selected background) and its variables; every
// part and state also carries an `abele-item-row` BEM class, so a CSS snippet can restyle it.
// Errors and loading belong to the list, not to a row; actions on the object belong to the
// header of whatever the row opens, so `actions` is for one menu at most.
import { computed, useSlots } from 'vue'
import Icon from '@/components/obsidian/Icon.vue'

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    excerpt?: string
    icon?: string
    label?: string
    selected?: boolean
    strong?: boolean
    unavailable?: boolean
    openable?: boolean
  }>(),
  { openable: true }
)
const emit = defineEmits<{ open: [] }>()
const slots = useSlots()
const multiline = computed(() => !!(props.description || slots.description || props.excerpt))
</script>

<style>
.abele-item-row .abele-item-row__self {
  position: relative;
  padding: var(--nav-item-padding);
  align-items: flex-start;
}
.abele-item-row_multiline .abele-item-row__self {
  padding-block: var(--size-4-2);
}
.is-phone .abele-item-row .abele-item-row__self {
  min-height: var(--touch-size-m);
}
/* Pad a one-line row up to the touch height instead of centring it: a title that still wraps
   keeps its icon on the first line. */
.is-phone .abele-item-row:not(.abele-item-row_multiline) .abele-item-row__self {
  padding-block: calc((var(--touch-size-m) - var(--nav-item-size) * var(--line-height-tight)) / 2);
}
.abele-item-row .abele-item-row__hit {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--nav-item-radius);
  background: none;
  box-shadow: none;
  cursor: var(--cursor);
}
.abele-item-row .abele-item-row__hit:hover {
  background: none;
  box-shadow: none;
}
.abele-item-row .abele-item-row__hit:focus-visible {
  box-shadow: 0 0 0 2px var(--interactive-accent);
}
/* Exactly one title line tall, so the glyph is centred on the first line of the title. */
.abele-item-row .abele-item-row__leading {
  height: calc(var(--nav-item-size) * var(--line-height-tight));
  line-height: var(--line-height-tight);
}
.abele-item-row .abele-item-row__body {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  flex: 1 1 auto;
  min-width: 0;
  white-space: normal;
}
.abele-item-row__head {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-2);
  min-width: 0;
}
.abele-item-row__title {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text-normal);
  line-height: var(--line-height-tight);
  max-height: calc(2em * var(--line-height-tight));
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.abele-item-row_strong .abele-item-row__title {
  font-weight: var(--font-semibold);
}
.abele-item-row_unavailable .abele-item-row__title {
  color: var(--text-faint);
}
.abele-item-row__trailing {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: baseline;
  gap: var(--size-4-2);
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.abele-item-row__self:hover .abele-item-row__trailing {
  color: var(--text-muted);
}
.abele-item-row__description,
.abele-item-row__excerpt {
  min-width: 0;
  font-size: var(--font-ui-smaller);
  line-height: var(--line-height-tight);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-item-row__description {
  color: var(--text-muted);
}
.abele-item-row__excerpt {
  color: var(--text-faint);
}
/* On a desktop the one menu takes the trailing fact's place while the pointer is on the row,
   so trailing facts stay in one column down the list. A phone has no hover: it is always there. */
.abele-item-row .abele-item-row__actions {
  position: absolute;
  z-index: 1;
  inset-block: 0;
  inset-inline-end: var(--size-4-1);
  padding: 0;
  align-items: center;
  visibility: hidden;
}
.abele-item-row__self:is(:hover, :focus-within) .abele-item-row__actions {
  visibility: visible;
}
.abele-item-row__self:has(.abele-item-row__actions):is(:hover, :focus-within)
  .abele-item-row__trailing {
  visibility: hidden;
}
/* The touch-sized button is centred on the title's first line, not hung below it. */
.is-mobile .abele-item-row .abele-item-row__actions {
  position: relative;
  inset: auto;
  align-self: flex-start;
  margin-block: calc((var(--nav-item-size) * var(--line-height-tight) - var(--touch-size-m)) / 2);
  visibility: visible;
}
.is-mobile .abele-item-row__self:has(.abele-item-row__actions) .abele-item-row__trailing {
  visibility: visible;
}
.abele-item-row__trailing :is(a, button, .clickable-icon) {
  position: relative;
  z-index: 1;
}
</style>
