<template>
  <div class="abele-github-notifications">
    <div class="nav-header">
      <div class="nav-buttons-container abele-github-notifications__buttons">
        <Icon
          class="clickable-icon nav-action-button abele-github-notifications__refresh"
          icon="refresh-cw"
          :tooltip="refreshTooltip"
          :disabled="busy || !enabled"
          @click="refresh(true)"
        />
        <Icon
          class="clickable-icon nav-action-button abele-github-notifications__read-all"
          icon="check-check"
          :tooltip="
            state.repo
              ? `Mark all of ${state.repo} as read on GitHub (keep in inbox, not Done)`
              : 'Mark all as read on GitHub (keep in inbox, not Done)'
          "
          :disabled="busy || !unreadCount"
          @click="markAllRead"
        />
        <Icon
          class="clickable-icon nav-action-button abele-github-notifications__on-github"
          icon="external-link"
          tooltip="Open the notifications on GitHub"
          :disabled="!enabled"
          @click="emit('external', inboxUrl)"
        />
      </div>
    </div>

    <div class="abele-github-notifications__filters">
      <Tabs
        class="abele-github-notifications__which"
        level="secondary"
        :tabs="whichTabs"
        :model-value="state.which"
        @update:model-value="setWhich"
      />
      <Dropdown
        v-if="repoOptions.length > 2"
        class="abele-github-notifications__repo"
        :options="repoOptions"
        :model-value="state.repo"
        @update:model-value="setRepo"
      />
    </div>

    <div v-if="enabled && accessHint" class="abele-github-notifications__access-hint">
      {{ accessHint }}
    </div>

    <EmptyState v-if="!enabled">
      The GitHub integration is off. Turn it on in Abele settings → GitHub.
    </EmptyState>
    <div v-else-if="error" class="abele-github-notifications__error">
      <GithubNotice :text="error" :busy="busy" @retry="refresh(true)" />
    </div>
    <EmptyState v-else-if="items === null" text="Loading from GitHub…" />
    <EmptyState v-else-if="!shown.length" :text="emptyText" />
    <div v-else class="abele-github-notifications__list" role="list">
      <div
        v-for="n in shown"
        :key="n.id"
        class="tree-item abele-github-notification"
        :class="{ 'is-unread': n.unread }"
        role="listitem"
        :data-id="n.id"
      >
        <div
          class="tree-item-self is-clickable abele-github-notification__self"
          tabindex="0"
          @click="open(n, $event)"
          @keydown.enter.prevent="open(n, $event)"
        >
          <Icon
            :icon="subjectType(n.type).icon"
            no-hover
            :tooltip="subjectType(n.type).label"
            class="abele-github-notification__type"
          />
          <div class="abele-github-notification__body">
            <div class="abele-github-notification__repo">{{ n.repo }}</div>
            <div class="abele-github-notification__title">{{ n.title }}</div>
            <div class="abele-github-notification__meta">
              {{ subjectType(n.type).label }} · {{ reasonText(n.reason) }} ·
              {{ ago(n.updatedAt, now) }}
            </div>
          </div>
          <!-- Its own click, never the row's: a check pressed while it is busy opens nothing. -->
          <span class="abele-github-notification__mark" @click.stop @keydown.enter.stop>
            <Icon
              icon="check"
              tooltip="Done on GitHub (remove from inbox)"
              :disabled="busy || marking.has(n.id)"
              @click="markDone(n)"
            />
          </span>
        </div>
      </div>
      <div v-if="truncated" class="abele-github-notifications__more">
        GitHub has more than these. The rest are on GitHub.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import type { PaneType } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import Tabs from '../obsidian/Tabs.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import GithubNotice from './GithubNotice.vue'
import { GithubClient } from '@/github/client'
import { paneForClick } from '@/github/links'
import { inboxFor, type NotificationsState } from '@/github/notifications/inbox'
import { ago, reasonText, subjectType, type GithubNotification } from '@/github/notifications/model'

/**
 * The notifications of the account the GitHub token belongs to, as a sidebar list: unread ones
 * stand out, the list can be narrowed to the unread or to one repository, and each row opens what
 * it is about — a pull request, an issue, a discussion — in a GitHub tab. Opening leaves it
 * unread: a row's check marks it Done and removes it from both inboxes. The top button marks
 * everything read without marking Done. All (read and unread) is the default, as on GitHub.
 *
 * Read when the list opens and whenever GitHub's poll interval comes round while it is open;
 * the refresh button asks straight away. See `notifications/inbox.ts` for what that costs. A
 * round of polling never takes a row out from under the reader: one GitHub no longer lists as
 * unread — marked read here, or elsewhere — stays, no longer standing out, until the list is
 * refreshed by hand or the filter changes.
 */
const props = defineProps<{
  enabled: boolean
  /**
   * The client to read with, and whether it carries the notifications token rather than the
   * main one — so a refusal names the right field.
   */
  clientFor: () => GithubClient | { client: GithubClient; separate: boolean }
  state: NotificationsState
}>()

const reader = () => {
  const r = props.clientFor()
  return r instanceof GithubClient ? { client: r, separate: false } : r
}

const emit = defineEmits<{
  (e: 'open', url: string, pane: PaneType | false): void
  (e: 'external', url: string): void
  (e: 'state'): void
}>()

const items = shallowRef<GithubNotification[] | null>(null)
const error = ref('')
const busy = ref(false)
const truncated = ref(false)
const accessHint = ref('')
const marking = reactive(new Set<string>())
const now = ref(Date.now())
const pollSeconds = ref(60)
/** Read here since the list was asked for: stays in the unread list, dimmed, until the next asking. */
const readHere = reactive(new Set<string>())

const inbox = () => {
  const { client, separate } = reader()
  return inboxFor(client, separate)
}

const inboxUrl = computed(() => `${reader().client.endpoints.origin}/notifications`)

const shown = computed(() =>
  (items.value ?? []).filter(
    (n) =>
      (!props.state.repo || n.repo === props.state.repo) &&
      (props.state.which === 'all' || n.unread || readHere.has(n.id))
  )
)

const unreadCount = computed(() => shown.value.filter((n) => n.unread).length)

const whichTabs = computed(() => [
  { id: 'unread', label: 'Unread', tooltip: 'Only the notifications not read yet' },
  { id: 'all', label: 'All', tooltip: 'GitHub inbox: read and unread, not Done' },
])

const repoOptions = computed(() => {
  const counts = new Map<string, number>()
  for (const n of items.value ?? []) counts.set(n.repo, (counts.get(n.repo) ?? 0) + 1)
  if (props.state.repo && !counts.has(props.state.repo)) counts.set(props.state.repo, 0)
  return [
    { value: '', display: 'All repositories' },
    ...[...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([repo, count]) => ({ value: repo, display: `${repo} (${count})` })),
  ]
})

const emptyText = computed(() =>
  props.state.which === 'unread' ? 'No unread notifications.' : 'No notifications.'
)

const refreshTooltip = computed(
  () => `Ask GitHub now (it asks to be polled every ${pollSeconds.value} s)`
)

/**
 * A poll's answer, with the rows on screen it no longer lists kept — as read, where they were — so
 * nothing vanishes while it is being looked at. New ones take their place by time.
 */
function keepInView(
  shown: GithubNotification[],
  fresh: GithubNotification[]
): GithubNotification[] {
  const listed = new Set(fresh.map((n) => n.id))
  const gone = shown.filter((n) => !listed.has(n.id))
  if (gone.length)
    console.debug(
      '[abele] GitHub notifications no longer listed, kept in view as read',
      gone.map((n) => n.id)
    )
  for (const n of gone) readHere.add(n.id)
  return [...fresh, ...gone.map((n) => ({ ...n, unread: false }))].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  )
}

/** A refresh asked for while another ran: run once that one is done. Null: none. */
let queued: { force: boolean } | null = null

/** Refresh requests also wait for writes, not just for another refresh. */
function finishBusy() {
  busy.value = false
  const next = queued
  queued = null
  if (next) void refresh(next.force)
}

/** Asks GitHub — or not, if its interval has not passed and nobody pressed refresh. */
async function refresh(force = false) {
  if (!props.enabled) return
  if (busy.value) {
    queued = { force: force || !!queued?.force }
    return
  }
  busy.value = true
  now.value = Date.now()
  const which = props.state.which
  try {
    const page = await inbox().load(which, force)
    // The other list was chosen meanwhile: this answer is not what is shown.
    if (which === props.state.which) {
      items.value = force || !items.value ? page.items : keepInView(items.value, page.items)
      if (force) readHere.clear()
      truncated.value = page.truncated
      accessHint.value = page.accessHint
      pollSeconds.value = page.pollSeconds
      error.value = ''
    }
  } catch (e) {
    if (which === props.state.which) error.value = e instanceof Error ? e.message : String(e)
  } finally {
    finishBusy()
  }
}

function setWhich(which: string) {
  if (which !== 'unread' && which !== 'all') return
  props.state.which = which
  emit('state')
}

// The other list: what was read of it before at once, then asked for when its interval is up.
watch(
  () => props.state.which,
  (which) => {
    items.value = inbox().cached(which)
    readHere.clear()
    void refresh()
  }
)

function setRepo(repo: string) {
  props.state.repo = repo
  emit('state')
}

/** Done on GitHub and here, including a read row retained on screen after an unread poll. */
async function markDone(n: GithubNotification) {
  if (busy.value || marking.has(n.id)) return
  busy.value = true
  marking.add(n.id)
  try {
    await inbox().markDone(n.id)
    readHere.delete(n.id)
    items.value = (items.value ?? []).filter((item) => item.id !== n.id)
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    marking.delete(n.id)
    finishBusy()
  }
}

async function markAllRead() {
  if (busy.value) return
  busy.value = true
  try {
    const before = shown.value.filter((n) => n.unread).map((n) => n.id)
    await inbox().markAllRead(props.state.which, props.state.repo)
    for (const id of before) readHere.add(id)
    items.value = inbox().cached(props.state.which)
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    finishBusy()
  }
}

/**
 * Opens what the notification is about by the clicks of any link here — plain by the tab rule,
 * Mod in a new tab, Alt on GitHub. It stays unread: opening is not Read or Done.
 */
async function open(n: GithubNotification, event: MouseEvent | KeyboardEvent) {
  const pane = event instanceof MouseEvent ? paneForClick(event, false) : false
  const where = await inbox().open(n)
  if (pane === null || !where.tab) emit('external', where.url)
  else emit('open', where.url, pane)
}

let timer = 0
onMounted(() => {
  void refresh()
  // Round again when GitHub's interval comes up; an unchanged list answers 304 and costs nothing.
  timer = window.setInterval(() => {
    now.value = Date.now()
    if (!busy.value && inbox().waitSeconds(props.state.which) === 0) void refresh()
  }, 15_000)
})
onBeforeUnmount(() => window.clearInterval(timer))

defineExpose({ refresh })
</script>

<style lang="scss">
.abele-github-notifications {
  display: flex;
  flex-direction: column;
  min-width: 0;

  &__filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-4-2);
    padding: var(--size-4-1) var(--size-4-2) var(--size-4-2);

    .abele-obsidian-dropdown {
      min-width: 0;
      max-width: 100%;

      select {
        max-width: 100%;
      }
    }
  }

  &__error {
    padding: var(--size-4-2);
  }

  &__list {
    padding: 0 var(--size-4-1);
  }

  &__access-hint,
  &__more {
    padding: var(--size-4-2) var(--size-4-3);
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
  }
}

.abele-github-notification {
  &__self.tree-item-self {
    // A flat list: no room kept for a fold arrow, which a narrow sidebar cannot spare.
    padding-inline-start: var(--size-4-2);
    align-items: flex-start;
    gap: var(--size-4-2);
    padding-top: var(--size-4-1);
    padding-bottom: var(--size-4-1);
  }

  &__type {
    flex: 0 0 auto;
    padding-top: var(--size-2-1);
    color: var(--text-faint);
  }

  &__body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
  }

  &__repo,
  &__meta {
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
    overflow-wrap: anywhere;
  }

  &__title {
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  &__mark {
    flex: 0 0 auto;
  }

  &.is-unread &__title {
    color: var(--text-normal);
    font-weight: var(--font-semibold);
  }

  &.is-unread &__type {
    color: var(--text-accent);
  }
}
</style>
