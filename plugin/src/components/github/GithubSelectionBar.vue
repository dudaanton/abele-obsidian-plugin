<template>
  <div class="abele-github-selection">
    <span class="abele-github-selection__label">{{ label }}</span>
    <template v-if="phone">
      <Icon
        v-for="a in actions"
        :key="a.name"
        :icon="a.icon"
        :tooltip="a.name"
        with-bg
        @click="a.run"
      />
    </template>
    <template v-else>
      <Button
        v-for="a in actions"
        :key="a.name"
        :text="a.name"
        :icon="a.icon"
        :tooltip="a.tooltip"
        @click="a.run"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Platform } from 'obsidian'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import type { GithubLink } from '@/github/permalinks'
import type { Linker } from '@/github/linking'
import type { SnippetBlock } from '@/github/snippetBlock'
import type { Quote } from '@/github/chatAbout'

const props = withDefaults(
  defineProps<{
    linker: Linker
    /** "Lines 10–20". */
    label: string
    link: () => GithubLink | Promise<GithubLink>
    /** The lines with their code, for a card in the note. */
    snippet?: () => SnippetBlock | Promise<SnippetBlock>
    /** The selected code, quoted in a chat asked from here. */
    quote?: () => Quote
  }>(),
  { snippet: undefined, quote: undefined }
)

/**
 * A phone has no room for four labelled buttons beside a diff's gutters: they stacked four rows
 * deep. There the same actions are a single row of icons, each named by its tooltip.
 */
const phone = Platform.isPhone

interface Action {
  name: string
  icon: string
  tooltip: string
  run: () => void
}

const actions = computed<Action[]>(() => {
  const { linker, link, snippet, quote } = props
  const list: Action[] = [
    {
      name: 'Copy link',
      icon: 'link',
      tooltip: 'Copy a link to these lines',
      run: () => void linker.copy(link()),
    },
    {
      name: 'Insert into note',
      icon: 'text-cursor-input',
      tooltip: 'Insert a link to these lines into the note you were last in',
      run: () => void linker.insert(link()),
    },
  ]
  if (snippet) {
    list.push({
      name: 'Insert with code',
      icon: 'file-code',
      tooltip:
        'Insert these lines into the note you were last in, as a card holding the code itself',
      run: () => void linker.insertSnippet(snippet()),
    })
  }
  if (quote && linker.canAsk()) {
    list.push({
      name: 'Ask here',
      icon: 'message-circle-plus',
      tooltip: 'Open a new chat with a link to these lines and their code in its input',
      run: () => void linker.ask(link(), quote()),
    })
  }
  return list
})
</script>

<style lang="scss">
.abele-github-selection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-2);
  background: var(--background-secondary);
  border-block: 1px solid var(--background-modifier-border);
  font-family: var(--font-interface);
  font-size: var(--font-ui-small);

  &__label {
    color: var(--text-muted);
    margin-right: auto;
  }
}
</style>
