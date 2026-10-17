<template>
  <div class="abele-github-notifications">
    <div class="nav-header">
      <div class="nav-buttons-container">
        <Icon
          icon="refresh-cw"
          class="clickable-icon nav-action-button"
          tooltip="Refresh notifications"
          :disabled="busy"
          @click="refresh"
        />
        <Icon
          icon="check-check"
          class="clickable-icon nav-action-button"
          tooltip="Mark unread notifications from this snapshot read; keep issues and pull requests unchanged"
          :disabled="busy || !snapshot?.complete || !shown.some((n) => n.unread && !n.pinned)"
          @click="readAll"
        />
      </div>
    </div>
    <div class="abele-github-notifications__filters">
      <Tabs
        :model-value="state.which"
        :tabs="[
          { id: 'all', label: 'All' },
          { id: 'unread', label: 'Unread' },
        ]"
        level="secondary"
        @update:model-value="setWhich"
      />
      <Dropdown :model-value="state.repo" :options="repos" @update:model-value="setRepo" />
    </div>
    <p class="setting-item-description">
      Mark read keeps notifications in this inbox. Done is not available for this service.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <EmptyState
      v-if="!snapshot"
      :text="busy ? 'Loading notifications…' : 'Notifications unavailable.'"
    />
    <EmptyState v-else-if="!shown.length" text="No notifications in this view." />
    <div v-else class="abele-github-notifications__list" role="list">
      <div
        v-for="n in shown"
        :key="n.id"
        class="tree-item abele-github-notification"
        :class="{ 'is-unread': n.unread }"
        role="listitem"
      >
        <div
          class="tree-item-self is-clickable abele-github-notification__self"
          tabindex="0"
          @click="open(n, $event)"
          @keydown.enter.prevent="open(n, $event)"
        >
          <Icon :icon="n.type === 'Pull' ? 'git-pull-request' : 'circle-dot'" no-hover />
          <div class="abele-github-notification__body">
            <div class="abele-github-notification__repo">{{ n.repo }}</div>
            <div class="abele-github-notification__title">{{ n.title }}</div>
            <div v-if="n.note" class="abele-github-notification__meta">{{ n.note }}</div>
            <div class="abele-github-notification__meta">
              {{ n.type }} · {{ n.pinned ? 'Pinned' : n.unread ? 'Unread' : 'Read' }} ·
              {{ n.updatedAt }}
            </div>
          </div>
          <span @click.stop @keydown.enter.stop
            ><Icon
              class="abele-native-notification__read"
              icon="check"
              :tooltip="
                n.pinned
                  ? 'Pinned notification: use the service to mark read without changing its pin'
                  : 'Mark read (keep in inbox)'
              "
              :disabled="busy || !n.unread || n.pinned"
              @click="read(n)"
          /></span>
        </div>
      </div>
    </div>
    <p v-if="snapshot && !snapshot.complete" class="setting-item-description">
      The inbox has more notifications. Bulk marking is unavailable for this incomplete snapshot.
    </p>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Keymap } from 'obsidian'
import type { NativeInbox, NativeInboxSnapshot, NativeNotification } from '@/forge/forgejoInbox'
import type { NotificationsState } from '@/github/notifications/inbox'
import Icon from '../obsidian/Icon.vue'
import Tabs from '../obsidian/Tabs.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import EmptyState from '../obsidian/EmptyState.vue'
const props = defineProps<{ inbox: NativeInbox; state: NotificationsState }>()
const emit = defineEmits<{
  (e: 'open', url: string, tab: boolean, pane: 'tab' | false): void
  (e: 'state'): void
}>()
const snapshot = shallowRef<NativeInboxSnapshot>(),
  busy = ref(false),
  error = ref('')
let active = true,
  serial = 0,
  timer: ReturnType<typeof setInterval> | undefined
const shown = computed(() =>
  (snapshot.value?.items ?? []).filter((n) => !props.state.repo || n.repo === props.state.repo)
)
const repos = computed(() => [
  { value: '', display: 'All repositories' },
  ...[...new Set(snapshot.value?.items.map((n) => n.repo))]
    .sort()
    .map((value) => ({ value, display: value })),
])
async function refresh() {
  if (busy.value) return
  const request = ++serial
  busy.value = true
  error.value = ''
  try {
    const result = await props.inbox.load(props.state.which)
    if (active && request === serial) snapshot.value = result
  } catch (problem) {
    if (active && request === serial) {
      snapshot.value = undefined
      error.value = problem instanceof Error ? problem.message : String(problem)
    }
  } finally {
    if (active && request === serial) busy.value = false
  }
}
async function mutate(operation: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await operation()
    if (active) {
      busy.value = false
      await refresh()
    }
  } catch (problem) {
    if (active) error.value = problem instanceof Error ? problem.message : String(problem)
  } finally {
    if (active) busy.value = false
  }
}
const read = (n: NativeNotification) => mutate(() => props.inbox.markRead(n))
const readAll = () =>
  snapshot.value && mutate(() => props.inbox.markAllRead(snapshot.value, props.state.repo))
const open = (n: NativeNotification, event: MouseEvent | KeyboardEvent) => {
  try {
    const destination = props.inbox.open(n)
    emit('open', destination.url, destination.tab, Keymap.isModEvent(event) ? 'tab' : false)
  } catch (problem) {
    error.value = String(problem)
  }
}
const setWhich = (which: string) => {
  if (which === 'all' || which === 'unread') {
    props.state.which = which
    emit('state')
  }
}
const setRepo = (repo: string) => {
  props.state.repo = repo
  emit('state')
}
watch([() => props.inbox, () => props.state.which], () => {
  ++serial
  busy.value = false
  snapshot.value = undefined
  void refresh()
})
onMounted(() => {
  void refresh()
  timer = window.setInterval(() => void refresh(), 60_000)
})
onBeforeUnmount(() => {
  active = false
  ++serial
  window.clearInterval(timer)
})
</script>
