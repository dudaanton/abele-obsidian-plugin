<template>
  <ol v-if="events.length" class="abele-event-list">
    <li v-for="event in events" :key="event.id">
      <ListRow
        :title="event.title"
        :state="event.state === 'pending' ? 'loading' : (event.state ?? 'ready')"
        :message="event.message || messages[event.state ?? 'ready']"
      >
        <template #metadata
          ><div class="abele-event-list__meta">
            <MetaLine
              :facts="[
                { key: 'actor', value: event.actor },
                { key: 'source', value: event.source },
              ]"
            /><span v-if="(event.actor || event.source) && showTime(event)" aria-hidden="true">
              · </span
            ><RelativeTime
              v-if="showTime(event)"
              :value="event.time"
              :now="now"
              mode="absolute"
              :diagnostic="diagnostic"
            /></div
        ></template>
        <template #actions
          ><Icon
            v-if="event.jump && event.state !== 'missing'"
            icon="message-square"
            :tooltip="`Open source for ${event.title}`"
            @click="emit('jump', event.id)" /><Icon
            v-if="event.state === 'error' && event.retryable"
            icon="refresh-cw"
            :text-right="event.retryLabel"
            :tooltip="event.retryLabel || `Retry ${event.title}`"
            @click="emit('retry', event.id)"
        /></template>
        <template v-if="event.detail" #detail
          ><Disclosure
            :label="event.detailLabel || 'Details'"
            :model-value="expanded.has(event.id)"
            @update:model-value="toggle(event.id, $event)"
            >{{ event.detail }}</Disclosure
          ></template
        >
      </ListRow>
    </li>
  </ol>
  <EmptyState v-else text="No events yet" />
</template>
<script setup lang="ts">
import { ref } from 'vue'
import ListRow from './ListRow.vue'
import MetaLine from './MetaLine.vue'
import RelativeTime from './RelativeTime.vue'
import Disclosure from './Disclosure.vue'
import Icon from './Icon.vue'
import EmptyState from './EmptyState.vue'
import type { TimestampValue } from '@/helpers/displayFormat'
export interface KitEvent {
  id: string
  title: string
  actor?: string
  source?: string
  time?: TimestampValue
  state?: 'ready' | 'pending' | 'missing' | 'error'
  message?: string
  jump?: boolean
  retryable?: boolean
  retryLabel?: string
  detail?: string
  detailLabel?: string
}
defineProps<{ events: KitEvent[]; now?: Date; diagnostic?: boolean }>()
const emit = defineEmits<{ jump: [id: string]; retry: [id: string] }>()
const messages = {
  ready: '',
  pending: 'Saving…',
  missing: 'Source unavailable',
  error: 'Could not save',
}
const showTime = (event: KitEvent) =>
  event.time !== undefined || !['pending', 'error'].includes(event.state ?? 'ready')
const expanded = ref(new Set<string>())
const toggle = (id: string, open: boolean) => {
  if (open) expanded.value.add(id)
  else expanded.value.delete(id)
}
</script>
<style>
.abele-event-list {
  list-style: none;
  padding: 0;
  margin: 0;
  border-inline-start: var(--size-2-1) solid var(--background-modifier-border);
}
.abele-event-list > li + li {
  margin-top: var(--size-4-1);
}
.abele-event-list__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--size-2-1);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-normal);
}
</style>
