<template>
  <div
    class="abele-fold-heading"
    :class="{ 'is-collapsible': collapsible, 'is-collapsed': collapsible && collapsed }"
    :role="collapsible ? 'button' : undefined"
    :tabindex="collapsible ? 0 : undefined"
    :aria-expanded="collapsible ? !collapsed : undefined"
    @click="collapsible && emit('toggle')"
    @keydown="onKey"
  >
    <span
      v-if="collapsible"
      ref="chevron"
      class="collapse-icon abele-fold-heading__arrow"
      :class="{ 'is-collapsed': collapsed }"
      aria-hidden="true"
    />
    <span class="abele-fold-heading__text">{{ text }}</span>
    <span v-if="count !== undefined" class="abele-fold-heading__count">{{ count }}</span>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { setIcon } from 'obsidian'

/**
 * The title of a list that can be folded away: Obsidian's own fold arrow — the one on headings,
 * callouts and the file tree, pointing down while open and right while folded — then the title,
 * then how many entries the list holds. The whole of it is the control: a click, Enter or Space
 * asks to toggle. Not `collapsible`, it is the plain title and nothing more.
 */
const props = withDefaults(
  defineProps<{
    text: string
    /** Muted, after the title: how many entries the list holds, folded or not. */
    count?: number
    collapsible?: boolean
    collapsed?: boolean
  }>(),
  { count: undefined, collapsible: false, collapsed: false }
)

const emit = defineEmits<{
  /** Asks the owner to fold or unfold; the owner decides and passes `collapsed` back. */
  toggle: []
}>()

const onKey = (e: KeyboardEvent) => {
  if (!props.collapsible || (e.key !== 'Enter' && e.key !== ' ')) return
  // Space would otherwise scroll the note.
  e.preventDefault()
  emit('toggle')
}

const chevron = ref<HTMLElement>()
const draw = () => {
  if (chevron.value && !chevron.value.firstChild) setIcon(chevron.value, 'right-triangle')
}
onMounted(draw)
watch(() => props.collapsible, draw, { flush: 'post' })
</script>

<style lang="scss">
.abele-fold-heading {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-1);
  min-width: 0;

  &.is-collapsible {
    cursor: var(--cursor);
    border-radius: var(--radius-s);

    // The ring Obsidian draws round its own clickable icons, for whoever arrives by Tab.
    &:focus-visible {
      box-shadow: 0 0 0 var(--size-2-1) var(--background-modifier-border-focus);
      outline: none;
    }
  }
}

// The arrow sits at the start of the row, as in Obsidian's backlinks pane, so the title lines up
// with nothing moved when the list opens or folds.
.abele-fold-heading__arrow {
  flex: 0 0 auto;
}

.abele-fold-heading__count {
  color: var(--text-faint);
  font-size: var(--font-ui-small);
  font-weight: var(--font-normal);
}
</style>
