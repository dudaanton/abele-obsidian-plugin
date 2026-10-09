<template>
  <ol v-if="events.length" class="abele-event-list">
    <li v-for="event in events" :key="event.id">
      <ListRow
        :title="event.title"
        :facts="[
          { key: 'actor', value: event.actor },
          { key: 'source', value: event.source, required: true, unknown: 'Source unavailable' },
        ]"
        :state="event.state === 'pending' ? 'loading' : (event.state ?? 'ready')"
        :message="event.message"
      >
        <template #metadata
          ><MetaLine
            :facts="[
              { key: 'actor', value: event.actor },
              { key: 'source', value: event.source, required: true, unknown: 'Source unavailable' },
            ]" /><RelativeTime :value="event.time" :now="now" :diagnostic="diagnostic"
        /></template>
        <template #actions>
          <Icon
            v-if="event.jump && event.state !== 'missing'"
            icon="message-square"
            :tooltip="`Open source for ${event.title}`"
            @click="emit('jump', event.id)"
          />
          <Icon
            v-if="event.state === 'error' && event.retryable"
            icon="refresh-cw"
            :tooltip="`Retry ${event.title}`"
            @click="emit('retry', event.id)"
          />
        </template>
        <template v-if="event.detail" #detail
          ><Disclosure
            :label="`Details for ${event.title}`"
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
  detail?: string
}
defineProps<{ events: KitEvent[]; now?: Date; diagnostic?: boolean }>()
const emit = defineEmits<{ jump: [id: string]; retry: [id: string] }>()
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
}
.abele-event-list > li + li {
  border-top: 1px solid var(--background-modifier-border);
}
</style>
