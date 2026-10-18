<template>
  <div class="abele-github-notice">
    <div class="abele-github-notice__line">
      <Icon
        icon="alert-triangle"
        size="xs"
        :interactive="false"
        class="abele-github-notice__glyph"
      />
      <div class="abele-github-notice__text">{{ parts.head }}</div>
      <Icon
        v-if="retry"
        class="abele-github-notice__retry"
        icon="rotate-ccw"
        :tooltip="retryTooltip"
        :disabled="busy"
        @click="emit('retry')"
      />
    </div>
    <Disclosure
      v-if="parts.rest"
      v-model="open"
      class="abele-github-notice__more"
      :label="t('repository.check')"
    >
      <div class="abele-github-notice__rest">{{ parts.rest }}</div>
    </Disclosure>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import Disclosure from '../obsidian/Disclosure.vue'
import Icon from '../obsidian/Icon.vue'

/**
 * Something GitHub would not give, said where it was to be: a whole item, a section of one, the
 * file tree, the next page of a list. Its first sentence on one line with a glyph to ask again;
 * the rest — what to check, the permission, GitHub's own words — folded under it.
 */
const props = withDefaults(
  defineProps<{
    text: string
    busy?: boolean
    /** Offer to ask again; off for a notice no second asking would change. */
    retry?: boolean
    retryTooltip?: string
  }>(),
  { busy: false, retry: true, retryTooltip: () => t('repository.askAgain') }
)

const emit = defineEmits<{
  (e: 'retry'): void
}>()

const open = ref(false)

/** A notice this short is said whole; a longer one folds all after its first sentence. */
const WHOLE = 140

/** The first sentence, and whatever follows it. */
const parts = computed(() => {
  const text = props.text.trim()
  if (text.length <= WHOLE) return { head: text, rest: '' }
  const m = /^([\s\S]+?[.!?…])(?:\s+)([\s\S]+)$/.exec(text)
  return m ? { head: m[1], rest: m[2] } : { head: text, rest: '' }
})
</script>

<style lang="scss">
.abele-github-notice {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  padding: var(--size-4-2) 0;
  font-size: var(--font-ui-small);

  // What went wrong is said by a warning glyph on the first line, not by a bar down the side.
  &__line {
    display: flex;
    align-items: flex-start;
    gap: var(--size-4-2);
    min-width: 0;
  }

  &__glyph {
    flex: 0 0 auto;
    height: 1lh;
    color: var(--text-warning);
  }

  &__text {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text-muted);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  &__retry {
    flex: 0 0 auto;
    margin-block: calc((1lh - var(--icon-size) - 2 * var(--size-2-2)) / 2);
  }

  &__more {
    padding-inline-start: calc(var(--icon-xs) + var(--size-4-2));
  }

  // The cause, the permission and GitHub's own words, a line each.
  &__rest {
    color: var(--text-muted);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
}
</style>
