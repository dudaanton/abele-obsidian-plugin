<template>
  <div class="tree-item abele-tree-item" :class="{ 'is-collapsed': collapsible && collapsed }">
    <div
      class="tree-item-self is-clickable abele-tree-item__self"
      :class="{ 'mod-collapsible': collapsible, 'is-active': active }"
      role="treeitem"
      tabindex="0"
      :aria-expanded="collapsible ? !collapsed : undefined"
      :aria-current="active ? 'true' : undefined"
      :data-path="path"
      @click="emit('click', $event)"
      @keydown.enter.prevent="emit('click', keyClick($event))"
    >
      <div
        v-if="collapsible"
        ref="chevron"
        class="tree-item-icon collapse-icon"
        :class="{ 'is-collapsed': collapsed }"
      />
      <div class="tree-item-inner abele-tree-item__inner">
        <span v-if="icon" ref="glyph" class="abele-tree-item__glyph" />
        <span class="abele-tree-item__text">{{ text }}</span>
      </div>
      <div v-if="flair || $slots.actions" class="tree-item-flair-outer">
        <span v-if="flair" class="tree-item-flair">{{ flair }}</span>
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
import { onMounted, ref, watch } from 'vue'
import { setIcon } from 'obsidian'

/**
 * One row of a tree, drawn with Obsidian's own tree classes — the file explorer's, the outline's —
 * so indentation, hover, the active row and the collapse arrow are the theme's. Its children go in
 * the default slot, shown while it is open.
 */
const props = withDefaults(
  defineProps<{
    text: string
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
  }>(),
  {
    icon: undefined,
    flair: undefined,
    active: false,
    collapsible: false,
    collapsed: false,
    path: undefined,
  }
)

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
  if (glyph.value && props.icon) {
    glyph.value.replaceChildren()
    setIcon(glyph.value, props.icon)
  }
}
onMounted(draw)
watch(() => [props.icon, props.collapsible], draw, { flush: 'post' })
</script>

<style lang="scss">
.abele-tree-item__inner {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  min-width: 0;
}

.abele-tree-item__glyph {
  display: flex;
  flex: 0 0 auto;
  color: var(--icon-color);
  opacity: var(--icon-opacity);

  .svg-icon {
    --icon-size: var(--icon-xs);
    --icon-stroke: var(--icon-xs-stroke-width);
  }
}

.abele-tree-item__text {
  min-width: 0;
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
