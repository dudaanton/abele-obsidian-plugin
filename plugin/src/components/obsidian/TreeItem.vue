<template>
  <div
    class="tree-item abele-tree-item"
    :class="{
      'is-collapsed': collapsible && collapsed,
      'abele-tree-item_collapsed': collapsible && collapsed,
      'abele-tree-item_active': active,
      'abele-tree-item_disabled': disabled,
      'abele-tree-item_plain': plain,
    }"
  >
    <div
      class="tree-item-self abele-tree-item__self"
      :class="{ 'is-clickable': !inert, 'mod-collapsible': collapsible, 'is-active': active }"
      role="treeitem"
      :tabindex="inert ? undefined : 0"
      :aria-expanded="collapsible ? !collapsed : undefined"
      :aria-current="active ? 'true' : undefined"
      :aria-disabled="disabled || undefined"
      :data-path="path"
      @click="inert || emit('click', $event)"
      @keydown.enter.prevent="inert || emit('click', keyClick($event))"
    >
      <div
        v-if="collapsible"
        ref="chevron"
        class="tree-item-icon collapse-icon abele-tree-item__toggle"
        :class="{ 'is-collapsed': collapsed }"
      />
      <div class="tree-item-inner abele-tree-item__inner">
        <span ref="glyph" class="abele-tree-item__glyph" aria-hidden="true" />
        <span class="abele-tree-item__text">{{ text }}</span>
        <span v-if="note" class="abele-tree-item__note">{{ note }}</span>
      </div>
      <div v-if="flair || $slots.actions || $slots.end" class="tree-item-flair-outer">
        <span v-if="flair" class="tree-item-flair abele-tree-item__flair">{{ flair }}</span>
        <slot name="end" />
        <!-- Shown while the row is pointed at or focused; always on a phone, which cannot point. -->
        <span v-if="$slots.actions" class="abele-tree-item__actions"><slot name="actions" /></span>
      </div>
    </div>
    <div v-if="collapsible && !collapsed && $slots.default" class="tree-item-children">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { setIcon } from 'obsidian'

/**
 * One row of a tree, drawn with Obsidian's own tree classes — the file explorer's, the outline's —
 * so indentation, hover, the active row and the collapse arrow are the theme's. Its children go in
 * the default slot, shown while it is open.
 */
const props = withDefaults(
  defineProps<{
    text: string
    /** Optional short location or secondary fact. */
    note?: string
    /** A glyph before the name: `folder`, `file`. */
    icon?: string
    /** Muted text at the row's end: a size, a count. */
    flair?: string
    /** The row stands for what is shown now. */
    active?: boolean
    /** Has children to fold: draws the arrow, and shows the default slot while open. */
    collapsible?: boolean
    collapsed?: boolean
    /** Carried as `data-path`, for finding the row again. */
    path?: string
    /**
     * A row that is only read — a list of files a question is about: no hover, no tab stop, no
     * click. Without it every row is one more stop for the keyboard on the way to the buttons.
     */
    plain?: boolean
    /** Seen but not open now: faint, no hover, no tab stop, no click. */
    disabled?: boolean
  }>(),
  {
    icon: undefined,
    note: undefined,
    flair: undefined,
    active: false,
    collapsible: false,
    collapsed: false,
    path: undefined,
    plain: false,
    disabled: false,
  }
)

const inert = computed(() => props.plain || props.disabled)

const emit = defineEmits<{
  /** The row was clicked, or Enter pressed on it; the event says which modifier keys were held. */
  click: [event: MouseEvent]
}>()

/** Enter on a focused row is a click, with the keys the keyboard event held. */
const keyClick = (e: KeyboardEvent) =>
  new MouseEvent('click', {
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
  })

const chevron = ref<HTMLElement>()
const glyph = ref<HTMLElement>()

const draw = () => {
  if (chevron.value && !chevron.value.firstChild) setIcon(chevron.value, 'right-triangle')
  if (glyph.value) {
    glyph.value.replaceChildren()
    if (props.icon) setIcon(glyph.value, props.icon)
  }
}
onMounted(draw)
watch(() => [props.icon, props.collapsible], draw, { flush: 'post' })
</script>

<style lang="scss">
.abele-tree-item__inner {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-1);
  min-width: 0;
}

.abele-tree-item__glyph {
  display: flex;
  align-items: center;
  height: 1lh;
  flex: 0 0 auto;
  color: var(--icon-color);
  opacity: var(--icon-opacity);
  width: var(--icon-xs);

  .svg-icon {
    --icon-size: var(--icon-xs);
    --icon-stroke: var(--icon-xs-stroke-width);
  }
}

.abele-tree-item_disabled > .abele-tree-item__self {
  color: var(--text-faint);
  cursor: default;

  .abele-tree-item__glyph {
    color: var(--text-faint);
  }
}

.abele-tree-item__text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.abele-tree-item__note {
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  overflow-wrap: anywhere;
}

.abele-tree-item__self .tree-item-flair {
  white-space: nowrap;
}

.abele-tree-item__actions {
  display: flex;
  visibility: hidden;

  .abele-tree-item__self:hover &,
  .abele-tree-item__self:focus-within &,
  body.is-phone & {
    visibility: visible;
  }

  .abele-obsidian-icon {
    padding: 0 var(--size-2-1);
  }
}
</style>
