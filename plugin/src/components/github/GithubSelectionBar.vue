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
import { t } from '@/i18n'
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
      name: t('streamB.copyLink.dbf362'),
      icon: 'link',
      tooltip: t('streamB.copyALinkToTheseLines.44c635'),
      run: () => void linker.copy(link()),
    },
    {
      name: t('streamB.insertIntoNote.be3d5a'),
      icon: 'text-cursor-input',
      tooltip: t('streamB.insertALinkToTheseLinesInto.d64ef0'),
      run: () => void linker.insert(link()),
    },
  ]
  if (snippet) {
    list.push({
      name: t('streamB.insertWithCode.7226b2'),
      icon: 'file-code',
      tooltip: t('streamB.insertTheseLinesIntoTheNoteYou.7596a8'),
      run: () => void linker.insertSnippet(snippet()),
    })
  }
  if (quote && linker.canAsk()) {
    list.push({
      name: t('streamB.askHere.7b4ec4'),
      icon: 'message-circle-plus',
      tooltip: t('streamB.openANewChatWithALink.c0815b'),
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
