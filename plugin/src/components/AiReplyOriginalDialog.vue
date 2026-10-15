<template>
  <!-- The reply as it was first written, and what has changed in it since. -->
  <ObsidianModal title="Original reply" size="tall" @close="emit('close')">
    <div class="abele-reply-original">
      <!-- Changed by several in a row: each one's version, what it changed from the one before,
           and what it said about it. -->
      <template v-if="steps.length > 1">
        <Tabs v-model="version" level="secondary" :tabs="versionTabs" />
        <div class="abele-reply-original__who">{{ versionLine }}</div>
        <Markdown v-if="version === 'original'" :text="original" />
        <template v-else>
          <Diff :text-left="chosen.before" :text-right="chosen.after" />
          <div v-if="said.length" class="abele-reply-original__said">
            <Markdown v-for="line in said" :key="line.id" :text="line.content" />
          </div>
        </template>
      </template>
      <template v-else>
        <Tabs v-model="tab" level="secondary" :tabs="TABS" />
        <Markdown v-if="tab === 'original'" :text="original" />
        <Diff v-else :text-left="original" :text-right="message.content" />
      </template>
    </div>
    <template v-if="canUndo" #footer>
      <Button
        text="Undo last change"
        tooltip="Put the reply back as it was before its last change"
        @click="undo"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import dayjs from 'dayjs'
import ObsidianModal from './obsidian/Modal.vue'
import Markdown from './obsidian/Markdown.vue'
import Button from './obsidian/Button.vue'
import Tabs from './obsidian/Tabs.vue'
import Diff from './Diff.vue'
import type { ChatMessage } from '@/ai/types'
const props = defineProps<{ message: ChatMessage }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'undo'): void }>()
// What changed comes first: a long reply read whole again only hides the few words that moved.
const TABS = [
  { id: 'changes', label: 'Changes' },
  { id: 'original', label: 'Original' },
]
const tab = ref('changes')

// Every change still in force, in the order they were made; the last one is what the chat shows.
const steps = computed(() => (props.message.revisions ?? []).filter((r) => !r.undoneAt))
const versionTabs = computed(() => [
  { id: 'original', label: 'Original' },
  ...steps.value.map((r, i) => ({ id: String(i), label: `${i + 1} · ${r.author}` })),
])
// Opens on the last change: what the chat shows now, and why.
const version = ref(String(Math.max(0, steps.value.length - 1)))
const chosen = computed(() => steps.value[Number(version.value)] ?? steps.value.at(-1))
const versionLine = computed(() =>
  version.value === 'original'
    ? 'As the agent wrote it'
    : `What ${chosen.value.author} changed · ${dayjs(chosen.value.at).format('D MMM HH:mm')}`
)
/** What the interceptor of the chosen version said under the answer, if anything. */
const said = computed(() =>
  version.value === 'original'
    ? []
    : (props.message.interceptorChat ?? []).filter(
        (m) => m.role === 'assistant' && m.by === chosen.value.author
      )
)
const original = computed(() => props.message.revisions?.[0].before ?? props.message.content)
function undo() {
  emit('undo')
  emit('close')
}
const canUndo = computed(() => {
  const last = props.message.revisions?.findLast((r) => !r.undoneAt)
  return last && last.after === props.message.content
})
</script>

<style lang="scss">
.abele-reply-original__who {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.abele-reply-original__said {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  border-top: var(--border-width) solid var(--background-modifier-border);
  padding-top: var(--size-4-2);
}

.abele-reply-original {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
}
</style>
