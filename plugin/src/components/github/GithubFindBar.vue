<template>
  <div class="abele-github-find" role="search" data-find-skip>
    <Input
      ref="inputRef"
      class="abele-github-find__input"
      :model-value="query"
      placeholder="Find in this tab"
      aria-label="Find in this tab"
      @update:model-value="onInput"
      @keydown="onKey"
    />
    <span class="abele-github-find__count" aria-live="polite">{{ countText }}</span>
    <div class="abele-github-find__actions">
      <Icon
        icon="case-sensitive"
        :active="caseSensitive"
        tooltip="Match letter case"
        @click="toggleCase"
      />
      <Icon
        icon="arrow-up"
        tooltip="Previous match (Shift+Enter)"
        :disabled="!count"
        @click="step(-1)"
      />
      <Icon icon="arrow-down" tooltip="Next match (Enter)" :disabled="!count" @click="step(1)" />
      <Icon icon="x" tooltip="Close the find bar (Esc)" @click="emit('close')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import Input from '../obsidian/Input.vue'
import Icon from '../obsidian/Icon.vue'
import { TabFinder, type FinderHooks } from '@/github/find/finder'

const props = defineProps<{
  /** The tab's content, which is what is searched. */
  root: HTMLElement
  hooks: FinderHooks
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const inputRef = ref<InstanceType<typeof Input>>()
const query = ref('')
const caseSensitive = ref(false)
/** Moves whenever the finder's count or current match does. */
const tick = ref(0)
const finder = shallowRef<TabFinder | null>(null)

const count = computed(() => (void tick.value, finder.value?.count ?? 0))
const countText = computed(() => {
  void tick.value
  if (!query.value) return ''
  if (!count.value) return 'No results'
  return `${(finder.value?.current ?? 0) + 1} of ${count.value}`
})

let timer = 0
const run = () => {
  const f = finder.value
  if (!f) return
  f.search(query.value, caseSensitive.value)
  // While typing, the page follows the first match, but a folded diff is not opened for it.
  void f.reveal(false)
}

const onInput = (value: string) => {
  query.value = value
  window.clearTimeout(timer)
  timer = window.setTimeout(run, 120)
}

const toggleCase = () => {
  caseSensitive.value = !caseSensitive.value
  run()
}

const step = async (delta: 1 | -1) => {
  const f = finder.value
  if (!f) return
  // Enter straight after typing: search what is typed now, not what was typed 120 ms ago.
  if (timer) {
    window.clearTimeout(timer)
    timer = 0
    f.search(query.value, caseSensitive.value)
  }
  await f.move(delta)
}

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    void step(e.shiftKey ? -1 : 1)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}

/** Puts the cursor in the field with what is there selected, for another Cmd+F. */
const focus = () => {
  const el = inputRef.value?.$el as HTMLInputElement | undefined
  el?.focus()
  el?.select()
}

onMounted(() => {
  finder.value = new TabFinder(props.root, props.hooks, () => tick.value++)
  focus()
})

onBeforeUnmount(() => {
  window.clearTimeout(timer)
  finder.value?.clear()
})

defineExpose({ focus })
</script>

<style lang="scss">
.abele-github-find {
  // Stays at the top of the tab while the matches are scrolled to.
  position: sticky;
  top: 0;
  z-index: var(--layer-cover);
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-2);
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-s);

  &__input {
    flex: 1 1 auto;
  }

  &__count {
    flex-shrink: 0;
    min-width: 5em;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  &__actions {
    display: flex;
    flex-shrink: 0;
    gap: var(--size-2-1);
  }
}

// The matches: in the page's own text through the Custom Highlight API, in code as decorations.
// The current one in the theme's orange — Obsidian has no variable of its own for an active match.
::highlight(abele-find) {
  background-color: var(--text-highlight-bg);
}

::highlight(abele-find-current) {
  background-color: color-mix(in srgb, var(--color-orange) 50%, transparent);
  color: var(--text-normal);
}

.abele-github-find__match {
  background-color: var(--text-highlight-bg);
  border-radius: var(--radius-s);
}

.abele-github-find__match_current {
  background-color: color-mix(in srgb, var(--color-orange) 50%, transparent);
  outline: 1px solid var(--interactive-accent);
}
</style>
