<template>
  <!-- Every file sync is not moving, grouped by why. Absent when there are none. Files that only
       wait for the server are the same rows under their own heading. -->
  <Section
    v-if="error || items.length"
    :title="
      error
        ? t('sync.notSynced.titleBare')
        : waiting
          ? t('sync.notSynced.waitingHeading', { count })
          : t('sync.notSynced.title', { count })
    "
  >
    <p v-if="error" class="abele-not-synced__error" role="alert">
      <StatusDot tone="red" :label="t('sync.notSynced.unreadable')" />
      {{ t('sync.notSynced.unreadable') }}
    </p>
    <div
      v-for="group in groups"
      :key="group.kind"
      class="abele-not-synced__group"
      :class="{ 'is-nested': groups.length > 1 }"
    >
      <!-- One reason: its words under the section title, no heading over one kind of row. -->
      <template v-if="groups.length > 1">
        <FoldHeading
          :text="group.title"
          :count="group.items.length"
          collapsible
          :hang="false"
          :collapsed="!isOpen(group)"
          @toggle="toggle(group)"
        />
      </template>
      <template v-if="groups.length === 1 || isOpen(group)">
        <div class="abele-not-synced__desc">
          <span>{{ group.desc }}</span>
          <a
            v-if="group.retry && group.items.length > 1"
            href="#"
            class="abele-not-synced__retry"
            @click.prevent="
              emit(
                'retry',
                group.items.map((item) => item.path)
              )
            "
            >{{ t('sync.notSynced.retryAll') }}</a
          >
        </div>
        <EntryRow v-for="item in shown(group)" :key="item.path" class="abele-not-synced__row">
          <template #leading
            ><Icon :icon="fileIcon(item.path)" size="s" :interactive="false"
          /></template>
          <span class="abele-not-synced__name">{{ fileName(item.path) }}</span>
          <template #codes>
            <Icon
              :icon="item.direction === 'out' ? 'arrow-up' : 'arrow-down'"
              size="xs"
              :interactive="false"
              :tooltip="item.direction === 'out' ? t('sync.notSynced.out') : t('sync.notSynced.in')"
            />
          </template>
          <!-- A missing action keeps its room, so every arrow stands in one column down the list. -->
          <template #actions>
            <Icon
              v-if="item.direction === 'out'"
              icon="folder-open"
              :tooltip="t('sync.notSynced.reveal')"
              @click="emit('reveal', item.path)"
            />
            <Icon v-else icon="folder-open" class="abele-not-synced__room" interactive disabled />
            <Icon
              v-if="group.retry"
              icon="refresh-cw"
              :tooltip="t('sync.notSynced.retry')"
              @click="emit('retry', [item.path])"
            />
            <Icon
              v-else-if="hasRetry"
              icon="refresh-cw"
              class="abele-not-synced__room"
              interactive
              disabled
            />
          </template>
          <template #meta>
            <span class="abele-not-synced__meta">
              <template v-for="(part, index) in meta(item)" :key="index">
                <span v-if="index">{{ ' · ' }}</span>
                <span
                  class="abele-not-synced__part"
                  :class="{ 'abele-not-synced__folder': part.folder }"
                  >{{ part.text }}</span
                >
              </template>
            </span>
          </template>
        </EntryRow>
        <ScrollMore
          v-if="shown(group).length < group.items.length"
          :label="t('sync.notSynced.more', { count: group.items.length - shown(group).length })"
          :shown="shown(group).length"
          @more="more(group)"
        />
      </template>
    </div>
  </Section>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, reactive } from 'vue'
import Section from '../obsidian/Section.vue'
import EntryRow from '../obsidian/EntryRow.vue'
import FoldHeading from '../obsidian/FoldHeading.vue'
import Icon from '../obsidian/Icon.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import ScrollMore from '../obsidian/ScrollMore.vue'
import {
  FOLD_OVER,
  PAGE,
  groupNotSynced,
  type NotSyncedGroup,
  type NotSyncedItem,
} from '@/sync/notSynced'

const props = defineProps<{
  items: NotSyncedItem[]
  error?: boolean
  limit?: string
  waiting?: boolean
}>()
const emit = defineEmits<{ reveal: [path: string]; retry: [paths: string[]] }>()

const groups = computed(() => (props.error ? [] : groupNotSynced(props.items, props.limit)))
const count = computed(() => props.items.length.toLocaleString())
const hasRetry = computed(() => groups.value.some((group) => group.retry))

/** What the person opened or closed; a short group starts open, a long one folded. */
const opened = reactive<Record<string, boolean>>({})
const isOpen = (group: NotSyncedGroup) => opened[group.kind] ?? group.items.length <= FOLD_OVER
const toggle = (group: NotSyncedGroup) => {
  opened[group.kind] = !isOpen(group)
}
const pages = reactive<Record<string, number>>({})
const shown = (group: NotSyncedGroup) => group.items.slice(0, (pages[group.kind] ?? 1) * PAGE)
const more = (group: NotSyncedGroup) => {
  pages[group.kind] = (pages[group.kind] ?? 1) + 1
}

const fileName = (path: string) => path.split('/').pop() ?? path
const since = (iso: string) => {
  const time = Date.parse(iso)
  return Number.isFinite(time) && time > 0
    ? t('sync.notSynced.since', {
        when: new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      })
    : ''
}
const meta = (item: NotSyncedItem) =>
  [
    item.path.split('/').slice(0, -1).join('/'),
    item.kind === 'waiting' &&
    item.fact?.toLowerCase() === 'server unavailable; kept locally until it reconnects'
      ? t('sync.notSynced.serverOffline')
      : item.kind === 'waiting' && item.fact === 'server asked to try again later'
        ? t('sync.notSynced.serverBusy')
        : item.fact,
    item.devices?.length ? t('sync.notSynced.on', { devices: item.devices.join(', ') }) : '',
    since(item.since),
  ]
    .map((text, index) => ({ text, folder: index === 0 }))
    .filter((part) => part.text)

const ICONS: [RegExp, string][] = [
  [/\.(png|jpe?g|gif|webp|heic|svg)$/i, 'image'],
  [/\.(mov|mp4|mkv|webm)$/i, 'film'],
  [/\.(mp3|m4a|wav|flac)$/i, 'file-audio'],
  [/\.pdf$/i, 'file-text'],
  [/\.(zip|tar|gz|7z)$/i, 'file-archive'],
  [/\.md$/i, 'file-text'],
]
const fileIcon = (path: string) => ICONS.find(([re]) => re.test(path))?.[1] ?? 'file'
</script>

<style lang="scss">
.abele-not-synced__group + .abele-not-synced__group {
  margin-block-start: var(--size-4-2);
}
// Several reasons read as a tree: the arrow on the edge, a group's lines under its words.
.abele-not-synced__group.is-nested > :not(.abele-fold-heading) {
  margin-inline-start: calc(var(--icon-xs) + var(--size-4-1));
}
.abele-not-synced__room {
  visibility: hidden;
}
.abele-not-synced__desc {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1) var(--size-4-2);
  margin-block: var(--size-4-1) var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-not-synced__retry {
  color: var(--text-accent);
}
.abele-not-synced__name {
  overflow-wrap: anywhere;
}
.abele-not-synced__part {
  white-space: nowrap;
  overflow-wrap: normal;
}
.abele-not-synced__folder {
  white-space: normal;
  overflow-wrap: anywhere;
}
.abele-not-synced__error {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin: 0;
  color: var(--text-error);
  font-size: var(--font-ui-small);
}
// A finger's height on a phone, taken back by margins so the words keep the desktop's spacing.
body.is-phone .abele-not-synced__retry {
  display: inline-flex;
  align-items: center;
  min-height: var(--touch-size-l, 2.75rem);
  min-width: var(--touch-size-l, 2.75rem);
  margin-block: calc((1lh - var(--touch-size-l, 2.75rem)) / 2);
}
</style>
