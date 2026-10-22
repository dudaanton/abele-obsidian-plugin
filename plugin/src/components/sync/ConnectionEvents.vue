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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
let owner: HTMLElement | undefined
const scrollClass = 'abele-sync-window__scroll'
let alreadyOwned = false
let position = 0
let following = true
let anchor: { row: HTMLElement; id: string; offset: number } | undefined
const rememberEntry = () => {
  const rows = list.value?.children
  if (!owner || !rows?.length) return undefined
  const top = owner.getBoundingClientRect().top + owner.clientTop
  // Rows are ordered vertically. Avoid walking thousands of retained entries on scroll.
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (rows[middle].getBoundingClientRect().bottom <= top) low = middle + 1
    else high = middle
  }
  const row = rows[low] as HTMLElement | undefined
  if (!row || row.getBoundingClientRect().top >= top + owner.clientHeight) return undefined
  return { row, id: row.dataset.activityId, offset: row.getBoundingClientRect().top - top }
}
const rememberScroll = () => {
  if (!owner) return
  position = owner.scrollTop
  following = owner.scrollHeight - position - owner.clientHeight <= 4
  anchor = following ? undefined : rememberEntry()
}
onMounted(() => {
  owner = scroller()
  if (!owner) return
  // The shared body also contains changing status rows. Native anchoring fights the
  // reader's position when those rows disappear, so this list owns its scroll policy.
  alreadyOwned = owner.classList.contains(scrollClass)
  owner.classList.add(scrollClass)
  owner.scrollTop = owner.scrollHeight
  position = owner.scrollTop
  owner.addEventListener('scroll', rememberScroll, { passive: true })
})
onBeforeUnmount(() => {
  if (!owner) return
  owner.removeEventListener('scroll', rememberScroll)
  owner.classList.toggle(scrollClass, alreadyOwned)
  owner = undefined
})
watch(
  () => [props.events, props.revision],
  () => {
    const parent = owner
    if (parent?.isConnected) {
      if (following) parent.scrollTop = parent.scrollHeight
      else if (anchor) {
        // Stable row ids survive chunk-boundary changes. If the reader's entry itself
        // expired, show the oldest remaining entry from its start: the old negative
        // offset may be taller than the entire replacement row.
        const retained = anchor.row.isConnected
          ? anchor.row
          : list.value?.querySelector<HTMLElement>(`[data-activity-id="${anchor.id}"]`)
        const row = retained ?? (list.value?.firstElementChild as HTMLElement | undefined)
        const offset = retained ? anchor.offset : 0
        if (row) {
          parent.scrollTop +=
            row.getBoundingClientRect().top -
            parent.getBoundingClientRect().top -
            parent.clientTop -
            offset
          anchor = { row, id: row.dataset.activityId, offset }
        }
      } else parent.scrollTop = position
      position = parent.scrollTop
    }
  },
  { flush: 'post' }
)
</script>

<style>
.abele-sync-window__scroll {
  overflow-anchor: none;
}
</style>
