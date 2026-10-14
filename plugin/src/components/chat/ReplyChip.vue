<template>
  <!-- The same chip the note editor and a sent question draw, here among Vue's own elements. -->
  <span ref="host" class="abele-reply-chip-host" />
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { ChatReplyTo } from '@/ai/types'
import { replyChip } from './replyChip'

const props = defineProps<{
  to: ChatReplyTo
  number?: number
  gone?: boolean
  removable?: boolean
}>()
const emit = defineEmits<{ (e: 'open'): void; (e: 'remove'): void }>()

const host = ref<HTMLElement>()
const draw = () => {
  const el = host.value
  if (!el) return
  el.replaceChildren(
    replyChip(el.ownerDocument, props.to, {
      number: props.number,
      gone: props.gone,
      onOpen: () => emit('open'),
      onRemove: props.removable ? () => emit('remove') : undefined,
    })
  )
}
onMounted(draw)
watch(() => [props.to, props.number, props.gone, props.removable], draw)
</script>
