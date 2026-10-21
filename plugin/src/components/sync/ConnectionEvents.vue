<template>
  <ol ref="list" class="abele-sync-window__events">
    <ConnectionEventChunk v-for="chunk in chunks" :key="chunk.id" :chunk="chunk" />
  </ol>
</template>

<script setup lang="ts">
/**
 * The connection's recent activity, in time order. A component of its own so that progress
 * ticks of the window around it do not touch these rows: it renders again only when the
 * list itself is a different list.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ActivityHistory, type ConnectionEvents } from '@/sync/activityHistory'
import ConnectionEventChunk from './ConnectionEventChunk.vue'

const props = defineProps<{ events: ConnectionEvents; revision?: number }>()
const list = ref<HTMLOListElement>()
const chunks = computed(() => {
  void props.revision
  return (
    props.events instanceof ActivityHistory ? props.events : new ActivityHistory(props.events)
  ).chunks()
})

const scroller = () => list.value?.closest<HTMLElement>('.abele-modal__body')
onMounted(() => {
  const parent = scroller()
  if (parent) parent.scrollTop = parent.scrollHeight
})
watch(
  () => [props.events, props.revision],
  async () => {
    const parent = scroller()
    const follow = parent && parent.scrollHeight - parent.scrollTop - parent.clientHeight <= 4
    await nextTick()
    if (follow && parent.isConnected) parent.scrollTop = parent.scrollHeight
  }
)
</script>
