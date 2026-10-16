<template>
  <!-- What «/» at the start of a message can be: the chat's own commands, then skills, then
       prompts. Obsidian's suggestion list, standing over the field the way the `[[` one does;
       what each is goes into a glyph at the row's end, its description under its name. -->
  <div v-if="items.length" class="suggestion-container abele-chat-slash" role="listbox">
    <div class="suggestion">
      <div
        v-for="(item, i) in items"
        :key="item.kind + item.name"
        class="suggestion-item mod-complex"
        :class="{ 'is-selected': i === selected }"
        role="option"
        :aria-selected="i === selected"
        @mousemove="selected = i"
        @mousedown.prevent="choose(item)"
      >
        <div class="suggestion-content">
          <div class="suggestion-title">{{ item.title }}</div>
          <div v-if="item.description" class="suggestion-note">{{ item.description }}</div>
        </div>
        <div class="suggestion-aux">
          <Icon
            class="suggestion-flair"
            :icon="KIND_GLYPH[item.kind]"
            :tooltip="KIND_SAID[item.kind]"
            size="xs"
            :interactive="false"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { TFile } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { discoverSkills } from '@/ai/tools/SkillTool'

export interface SlashItem {
  kind: 'command' | 'skill' | 'prompt'
  name: string
  title: string
  description: string
  /** A prompt's note. */
  file?: TFile
}

const props = defineProps<{
  /** What follows the «/», while the message is only that word. */
  query: string
  /** Node sessions accept text only: no vault skills or prompts there. */
  textOnly?: boolean
  /** What the place the chat works in offers instead: a node session's commands and skills. */
  extra?: SlashItem[]
}>()
const emit = defineEmits<{ choose: [item: SlashItem] }>()

const KIND_GLYPH = { command: 'square-slash', skill: 'sparkles', prompt: 'file-text' } as const
const KIND_SAID = { command: 'Chat command', skill: 'Skill', prompt: 'Prompt' } as const

const COMMANDS: SlashItem[] = [
  {
    kind: 'command',
    name: 'compact',
    title: '/compact',
    description: 'Shorten what was said so far',
  },
  { kind: 'command', name: 'new', title: '/new', description: 'Start a new chat' },
  { kind: 'command', name: 'load', title: '/load', description: 'Open a chat you have had' },
]

const all = computed<SlashItem[]>(() => {
  if (props.extra) return props.extra
  if (props.textOnly) return COMMANDS
  const { app } = GlobalStore.getInstance()
  const skills = discoverSkills().map<SlashItem>((skill) => ({
    kind: 'skill',
    name: skill.name,
    title: `/${skill.name}`,
    description: skill.description,
  }))
  const prompts: SlashItem[] = []
  for (const file of app.vault.getMarkdownFiles()) {
    const front = app.metadataCache.getFileCache(file)?.frontmatter
    if (front?.type === 'abele-prompt')
      prompts.push({
        kind: 'prompt',
        name: file.basename,
        title: file.basename,
        description: front.description || '',
        file,
      })
  }
  prompts.sort((a, b) => a.title.localeCompare(b.title))
  return [...COMMANDS, ...skills, ...prompts]
})

const items = computed(() => {
  const q = props.query.toLowerCase()
  return all.value.filter(
    (item) => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
  )
})

const selected = ref(0)
watch(items, () => (selected.value = 0))

const choose = (item: SlashItem) => emit('choose', item)

/** The list's keys, taken before the field sees them; true when the key was the list's. */
const key = (e: KeyboardEvent): boolean => {
  if (!items.value.length) return false
  const n = items.value.length
  if (e.key === 'ArrowDown') selected.value = (selected.value + 1) % n
  else if (e.key === 'ArrowUp') selected.value = (selected.value - 1 + n) % n
  else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab')
    choose(items.value[selected.value])
  else return false
  e.preventDefault()
  e.stopPropagation()
  void nextTick(() =>
    document
      .querySelector('.abele-chat-slash .suggestion-item.is-selected')
      ?.scrollIntoView({ block: 'nearest' })
  )
  return true
}
defineExpose({ key, open: computed(() => items.value.length > 0) })
</script>

<style lang="scss">
// Over the field, its width, the way Obsidian's own suggestions stand over a line.
.abele-chat-slash {
  position: absolute;
  inset-inline: 0;
  bottom: 100%;
  margin-bottom: var(--size-4-1);
  max-height: 50vh;
  overflow-y: auto;
  z-index: var(--layer-popover);
}
.abele-chat-slash .suggestion-flair {
  display: flex;
  color: var(--text-faint);
}
</style>
