<template>
  <!-- A footnote read where it is cited, when there is no margin to set it in: a card under the
       line, as a phone's encyclopedia or book reader opens one; the note stays where it is. -->
  <AnchoredCard
    :anchor="anchor"
    :label="`Footnote ${footnote.label}`"
    class="abele-footnote-peek"
    @close="emit('close')"
  >
    <div class="abele-footnote-peek__head">
      <span class="abele-footnote-peek__label">{{ footnote.label }}</span>
      <Icon
        icon="arrow-down"
        tooltip="Go to the footnote at the end of the note, to read or change it there"
        @click="toDefinition"
      />
    </div>
    <div class="abele-footnote-peek__body">
      <Markdown
        v-if="footnote.content.trim()"
        trusted
        :text="footnote.content"
        :file-path="footnote.filePath"
      />
      <p v-else class="abele-footnote-peek__empty">This footnote has no text yet</p>
    </div>
  </AnchoredCard>
</template>

<script setup lang="ts">
import type { Footnote } from '@/entities/Footnote'
import { reliableScrollTo } from '@/helpers/scrollUtils'
import AnchoredCard, { type CardAnchor } from './obsidian/AnchoredCard.vue'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'

const props = defineProps<{ footnote: Footnote; anchor: CardAnchor }>()
const emit = defineEmits<{ close: [] }>()

function toDefinition() {
  emit('close')
  reliableScrollTo(props.footnote.definitionFrom)
}
</script>

<style lang="scss">
// A footnote's card is short: no taller than a third of the screen, its words scrolling inside.
.abele-anchored-card.abele-footnote-peek {
  max-height: 33vh;
  gap: var(--size-2-2);
}

.abele-footnote-peek__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-2-2);
  margin-block: calc(-1 * var(--size-2-2)) 0;
}

.abele-footnote-peek__label {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}

.abele-footnote-peek__body {
  min-height: 0;
  overflow-y: auto;
  font-size: var(--font-small);
  line-height: var(--line-height-tight);

  p {
    margin: 0;
  }

  p + p {
    margin-top: var(--size-4-2);
  }
}

.abele-footnote-peek__empty {
  color: var(--text-muted);
}
</style>
