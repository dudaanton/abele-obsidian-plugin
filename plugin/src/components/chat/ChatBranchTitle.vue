<template>
  <span class="abele-chat-branch__title" :title="title">{{ title }}</span
  ><span class="abele-chat-branch__facts"
    ><span class="abele-chat-branch__questions" :aria-label="questionsLabel"
      ><Icon
        class="abele-chat-branch__glyph"
        icon="message-circle-question"
        :tooltip="questionsLabel"
      /><span>{{ questions }}</span></span
    ><time :datetime="time.datetime || undefined" :aria-label="time.exact">{{ clock }}</time
    ><StatusDot v-if="tone" :tone="TONE[tone].dot" :label="TONE[tone].label"
  /></span>
</template>

<script setup lang="ts">
// One branch in the menu the branch count opens: how it starts, then its facts as codes, its
// words in labels. Rendered into the item's title with `renderKit`, so the item has its size
// before Obsidian places the menu; flat and prop-only.
import { computed } from 'vue'
import Icon from '@/components/obsidian/Icon.vue'
import StatusDot from '@/components/obsidian/StatusDot.vue'
import type { BranchChoice } from '@/ai/chatBranches'
import { formatTimestamp } from '@/helpers/displayFormat'

const props = defineProps<Omit<BranchChoice, 'id'>>()

const TONE = {
  waiting: { dot: 'orange', label: 'Waiting for your approval' },
  failed: { dot: 'red', label: 'Refused or failed' },
} as const

const questionsLabel = computed(() => `${props.questions} questions in it`)
const time = computed(() => formatTimestamp(props.timestamp, { diagnostic: true }))
const clock = computed(() =>
  time.value.datetime ? time.value.exact.split(', ')[1].slice(0, 5) : time.value.label
)
</script>
