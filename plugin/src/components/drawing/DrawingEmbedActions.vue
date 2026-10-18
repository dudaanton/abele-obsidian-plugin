<template>
  <Icon
    v-for="action in actions"
    :key="action.cls"
    :class="`abele-drawing-embed__${action.cls}`"
    :icon="action.icon"
    :tooltip="action.tooltip"
    interactive
    @mousedown.stop
    @mouseup.stop
    @pointerdown.stop
    @touchstart.stop
    @touchend.stop
    @click="press($event, action.cls)"
  />
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import { computed } from 'vue'
import Icon from '../obsidian/Icon.vue'

/**
 * The buttons over a drawing in a note (`drawing/embed.ts` renders them into its own corner and
 * swaps the set when the part starts or stops being changed). The picture, its pan and zoom and
 * the resize corner stay the embed's.
 *
 * Every press stays here. Not the note's: a click neither moves the cursor into the embed nor
 * opens it. Nor the box's, which while the part is changed cancels every touch it hears — and
 * Safari makes no click out of a finger's lift that was cancelled, so the buttons would not
 * answer a finger.
 */
const props = defineProps<{ adjusting: boolean }>()

const emit = defineEmits<{
  adjust: []
  open: []
  whole: []
  cancel: []
  keep: []
}>()

type Name = 'adjust' | 'go' | 'whole' | 'cancel' | 'keep'

const actions = computed<{ cls: Name; icon: string; tooltip: string }[]>(() =>
  props.adjusting
    ? [
        { cls: 'whole', icon: 'maximize', tooltip: t('streamC.b7d4ff614fbde816') },
        { cls: 'cancel', icon: 'x', tooltip: t('streamC.3c25f9961925260d') },
        { cls: 'keep', icon: 'check', tooltip: t('streamC.f01f7534716f65dc') },
      ]
    : [
        { cls: 'adjust', icon: 'scan', tooltip: t('streamC.b0c1506a8d1c7cbc') },
        { cls: 'go', icon: 'arrow-up-right', tooltip: t('streamC.2ae0db4c29318e7a') },
      ]
)

function press(event: MouseEvent, name: Name): void {
  event.preventDefault()
  event.stopPropagation()
  if (name === 'adjust') emit('adjust')
  else if (name === 'go') emit('open')
  else if (name === 'whole') emit('whole')
  else if (name === 'cancel') emit('cancel')
  else emit('keep')
}
</script>
