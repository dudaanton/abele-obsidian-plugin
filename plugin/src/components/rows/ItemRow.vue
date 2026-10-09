<template>
  <div class="tree-item abele-item">
    <div
      class="tree-item-self abele-item__self"
      :class="{
        'is-clickable': openable,
        'is-active': selected,
        'mod-strong': strong,
        'mod-unavailable': unavailable,
        'mod-multiline': description || $slots.description || excerpt,
      }"
    >
      <button
        v-if="openable"
        class="abele-item__hit"
        type="button"
        :aria-label="label || title"
        :aria-current="selected ? 'true' : undefined"
        @click="emit('open')"
      />
      <div v-if="icon || $slots.leading" class="tree-item-icon abele-item__icon">
        <slot name="leading"><Icon :icon="icon" no-hover /></slot>
      </div>
      <div class="tree-item-inner abele-item__body">
        <div class="abele-item__head">
          <span class="abele-item__title"
            ><slot name="title">{{ title }}</slot></span
          >
          <span v-if="$slots.trailing" class="abele-item__trailing"><slot name="trailing" /></span>
        </div>
        <div v-if="description || $slots.description" class="abele-item__description">
          <slot name="description">{{ description }}</slot>
        </div>
        <div v-if="excerpt" class="abele-item__excerpt">{{ excerpt }}</div>
      </div>
      <div v-if="$slots.actions" class="tree-item-flair-outer abele-item__actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// One object per row, laid out the way Nuxt UI lays out its list items: leading icon, title,
// a muted description under it and a trailing fact on the title's own line. Everything else
// about the look is Obsidian's tree item: padding, radius, hover and the selected background.
// Errors and loading belong to the list, not to a row; actions on the object belong to the
// header of whatever the row opens, so `actions` is for one menu at most.
import Icon from '@/components/obsidian/Icon.vue'

withDefaults(
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
</script>

<style>
.abele-item .abele-item__self {
  position: relative;
  padding: var(--nav-item-padding);
  align-items: flex-start;
}
.is-phone .abele-item .abele-item__self {
  min-height: var(--touch-size-m);
}
.is-phone .abele-item .abele-item__self:not(.mod-multiline) {
  /* Pad a one-line row up to the touch height instead of centring it: a title that still
     wraps keeps its icon on the first line. */
  padding-block: calc((var(--touch-size-m) - var(--nav-item-size) * var(--line-height-tight)) / 2);
}
.abele-item .abele-item__self.mod-multiline {
  padding-block: var(--size-4-2);
}
.abele-item .abele-item__hit {
  position: absolute;
  min-height: 0;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--nav-item-radius);
  background: none;
  box-shadow: none;
  cursor: var(--cursor);
}
.abele-item .abele-item__hit:hover {
  background: none;
  box-shadow: none;
}
.abele-item .abele-item__hit:focus-visible {
  box-shadow: 0 0 0 2px var(--interactive-accent);
}
.abele-item .abele-item__icon {
  /* Exactly one title line tall, so the glyph is centred on the first line of the title. */
  height: calc(var(--nav-item-size) * var(--line-height-tight));
  line-height: var(--line-height-tight);
}
.abele-item .abele-item__body {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  flex: 1 1 auto;
  min-width: 0;
  white-space: normal;
}
.abele-item__head {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-2);
  min-width: 0;
}
.abele-item__title {
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
.abele-item__self.mod-strong .abele-item__title {
  font-weight: var(--font-semibold);
}
.abele-item__self.mod-unavailable .abele-item__title {
  color: var(--text-faint);
}
.abele-item__trailing {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: baseline;
  gap: var(--size-4-2);
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.abele-item__self:hover .abele-item__trailing {
  color: var(--text-muted);
}
.abele-item__description,
.abele-item__excerpt {
  min-width: 0;
  font-size: var(--font-ui-smaller);
  line-height: var(--line-height-tight);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-item__description {
  color: var(--text-muted);
}
.abele-item__excerpt {
  color: var(--text-faint);
}
.abele-item .abele-item__actions {
  position: absolute;
  z-index: 1;
  inset-block: 0;
  inset-inline-end: var(--size-4-1);
  padding: 0;
  align-items: center;
  visibility: hidden;
}
/* On a desktop the one menu takes the trailing fact's place while the pointer is on the row,
   so trailing facts stay in one column down the list. A phone has no hover: it is always there. */
.abele-item__self:is(:hover, :focus-within) .abele-item__actions {
  visibility: visible;
}
.abele-item__self:has(.abele-item__actions):is(:hover, :focus-within) .abele-item__trailing {
  visibility: hidden;
}
.is-mobile .abele-item .abele-item__actions {
  position: relative;
  inset: auto;
  align-self: flex-start;
  /* The touch-sized button is centred on the title's first line, not hung below it. */
  margin-block: calc((var(--nav-item-size) * var(--line-height-tight) - var(--touch-size-m)) / 2);
  visibility: visible;
}
.is-mobile .abele-item__self:has(.abele-item__actions) .abele-item__trailing {
  visibility: visible;
}
.abele-item__trailing :is(a, button, .clickable-icon) {
  position: relative;
  z-index: 1;
}
</style>
