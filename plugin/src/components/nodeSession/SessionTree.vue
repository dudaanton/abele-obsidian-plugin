<template>
  <!-- The node's sessions at this place, as a tree: your chats, under each the agents it started,
       under those theirs. A glyph for the kind, the state as a dot at the end, the time quiet
       beside it; a red shield where a session asks about nothing. Deeper than two, folded. -->
  <div class="abele-session-tree">
    <EmptyState v-if="!sessions.length" icon="messages-square" :text="t('chat.noSessions')" />
    <SessionTreeRow
      v-for="session in sessions"
      :key="session.id"
      :session="session"
      :depth="0"
      :active="active"
      :now="now"
      @open="(id) => emit('open', id)"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import EmptyState from '../obsidian/EmptyState.vue'
import SessionTreeRow from './SessionTreeRow.vue'
import type { ChildSession } from './types'

withDefaults(
  defineProps<{
    sessions: ChildSession[]
    /** The session open in the chat now. */
    active?: string
    now?: number
  }>(),
  { active: undefined, now: () => Date.now() }
)
const emit = defineEmits<{ open: [id: string] }>()
</script>
