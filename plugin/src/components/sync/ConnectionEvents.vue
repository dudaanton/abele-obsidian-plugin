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
const rememberScroll = () => {
  if (!owner) return
  position = owner.scrollTop
  following = owner.scrollHeight - position - owner.clientHeight <= 4
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
      parent.scrollTop = following ? parent.scrollHeight : position
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
