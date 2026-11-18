<template>
  <Section
    :title="t('sync.check.title')"
    :desc="state.kind === 'never' ? t('sync.check.desc') : undefined"
  >
    <!-- Where the check stands, as one line with a dot, and the one thing to do about it. -->
    <div class="abele-vault-check__state">
      <StatusDot :tone="tone" :label="line" :pulse="state.kind === 'running'" />
      <div class="abele-vault-check__text">
        <span class="abele-vault-check__line" role="status">{{ line }}</span>
        <span v-if="meta" class="abele-vault-check__meta">{{ meta }}</span>
      </div>
      <Button
        v-if="state.kind === 'running'"
        :text="t('sync.check.stop')"
        :tooltip="t('sync.check.stopTip')"
        @click="source.stop()"
      />
      <Button
        v-else
        :text="state.kind === 'never' ? t('sync.check.start') : t('sync.check.again')"
        :tooltip="t('sync.check.startTip')"
        @click="source.start()"
      />
    </div>

    <template v-if="state.kind === 'running'">
      <Progress :label="line" :value="state.done" :max="state.total" />
      <p v-if="state.current" class="abele-vault-check__current">{{ state.current }}</p>
      <p class="abele-vault-check__note">{{ t('sync.check.background') }}</p>
    </template>

    <!-- What differs, grouped by why, as the "not synced" list draws its files. -->
    <div
      v-for="group in groups"
      :key="group.reason"
      class="abele-vault-check__group"
      :class="{ 'is-nested': groups.length > 1 }"
    >
      <FoldHeading
        v-if="groups.length > 1 || group.items.length > 20"
        :text="t(`sync.check.reason.${group.reason}`)"
        :count="group.items.length"
        collapsible
        :hang="false"
        :collapsed="!isOpen(group.reason)"
        @toggle="fold(group.reason)"
      />
      <template v-if="(groups.length === 1 && group.items.length <= 20) || isOpen(group.reason)">
        <div class="abele-vault-check__desc">{{ t(`sync.check.why.${group.reason}`) }}</div>
        <EntryRow v-for="item in group.items" :key="item.path" :data-path="item.path">
          <template #leading><Icon :icon="fileIcon(item.path)" :interactive="false" /></template>
          <span class="abele-vault-check__name">{{ fileName(item.path) }}</span>
          <template #actions>
            <Icon
              v-if="item.reason === 'unsent'"
              icon="upload"
              :tooltip="t('sync.check.send')"
              @click="send(item.path)"
            />
            <Icon
              v-else-if="item.reason === 'skipped'"
              icon="list-filter"
              :tooltip="t('sync.check.rule')"
              @click="emit('rule')"
            />
            <Icon
              v-else-if="item.reason === 'differs' || item.reason === 'server-only'"
              icon="history"
              :tooltip="t('sync.check.versions')"
              @click="versions = item.path"
            />
            <Icon v-else icon="history" class="abele-vault-check__room" interactive disabled />
            <Icon
              v-if="item.reason !== 'server-only'"
              icon="folder-open"
              :tooltip="t('sync.notSynced.reveal')"
              @click="emit('reveal', item.path)"
            />
            <Icon v-else icon="folder-open" class="abele-vault-check__room" interactive disabled />
          </template>
          <template #meta>
            <span class="abele-vault-check__meta-line">
              <span class="abele-vault-check__folder">{{ folderOf(item.path) }}</span>
              <template v-if="item.fact"
                ><span>{{ ' · ' }}</span
                ><span class="abele-vault-check__part">{{ item.fact }}</span></template
              >
            </span>
          </template>
        </EntryRow>
      </template>
    </div>
  </Section>
  <VersionHistoryModal v-if="versions" :path="versions" @close="versions = ''" />
</template>

<script setup lang="ts">
/**
 * "Check against the server" in the connection window. One line says where the check stands,
 * with the dot the connection's own state uses; the files that differ follow, grouped by why,
 * each with the one glyph that does something about it. The check itself changes nothing, so
 * starting it asks nothing.
 */
import { computed, reactive, ref } from 'vue'
import { Notice } from 'obsidian'
import { t } from '@/i18n'
import Section from '../obsidian/Section.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import Progress from '../obsidian/Progress.vue'
import EntryRow from '../obsidian/EntryRow.vue'
import FoldHeading from '../obsidian/FoldHeading.vue'
import VersionHistoryModal from './VersionHistoryModal.vue'
import { formatWhen } from '@/sync/format'
import { REASON_ORDER, type VaultCheckReason, type VaultCheckSource } from '@/sync/vaultCheck'

const props = defineProps<{ source: VaultCheckSource }>()
const emit = defineEmits<{ reveal: [path: string]; rule: [] }>()

const state = computed(() => props.source.state.value)
const n = (value: number) => value.toLocaleString()

/** Sizes in one unit picked by the larger, as sync's own progress writes them: "2.8 of 5.1 GB". */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
const unitOf = (bytes: number) => Math.min(4, Math.floor(Math.log2(Math.max(1, bytes)) / 10))
const inUnit = (bytes: number, unit: number) =>
  Number((bytes / 1024 ** unit).toFixed(1)).toLocaleString()
const size = (bytes: number) => `${inUnit(bytes, unitOf(bytes))} ${UNITS[unitOf(bytes)]}`
const when = (at: number) => formatWhen(new Date(at).toISOString())

const tone = computed(() => {
  switch (state.value.kind) {
    case 'running':
      return 'accent' as const
    case 'matched':
      return 'green' as const
    case 'differs':
      return 'orange' as const
    case 'unreachable':
      return 'red' as const
    default:
      return 'faint' as const
  }
})

const line = computed(() => {
  const s = state.value
  switch (s.kind) {
    case 'never':
      return t('sync.check.never')
    case 'running':
      return t('sync.check.running', { done: n(s.done), total: n(s.total) })
    case 'matched':
      return t('sync.check.matched', { count: s.total, total: n(s.total) })
    case 'differs': {
      const differ = s.items.length
      return t('sync.check.differs', {
        count: differ,
        differ: n(differ),
        match: n(s.total - differ),
      })
    }
    case 'stopped':
      return t('sync.check.stopped', { done: n(s.done), total: n(s.total) })
    case 'unreachable':
      return t('sync.check.unreachable')
  }
})

const meta = computed(() => {
  const s = state.value
  switch (s.kind) {
    case 'running': {
      const unit = unitOf(s.bytesTotal)
      return t('sync.check.bytes', {
        done: inUnit(s.bytesDone, unit),
        total: `${inUnit(s.bytesTotal, unit)} ${UNITS[unit]}`,
      })
    }
    case 'matched':
    case 'differs':
      return t('sync.check.checked', { size: size(s.bytes), when: when(s.at) })
    case 'stopped':
      return t('sync.check.stoppedMeta', { when: when(s.at) })
    case 'unreachable':
      return t('sync.check.unreachableMeta')
    default:
      return ''
  }
})

const groups = computed(() => {
  const s = state.value
  if (s.kind !== 'differs') return []
  return REASON_ORDER.map((reason) => ({
    reason,
    items: s.items.filter((item) => item.reason === reason),
  })).filter((group) => group.items.length)
})

/** A short group starts open, a long one folded, as the "not synced" list does. */
const opened = reactive<Partial<Record<VaultCheckReason, boolean>>>({})
const isOpen = (reason: VaultCheckReason) =>
  opened[reason] ?? (groups.value.find((group) => group.reason === reason)?.items.length ?? 0) <= 20
const fold = (reason: VaultCheckReason) => {
  opened[reason] = !isOpen(reason)
}

const versions = ref('')

async function send(path: string): Promise<void> {
  await props.source.send(path)
  new Notice(t('sync.check.sent', { name: fileName(path) }))
}

const fileName = (path: string) => path.split('/').pop() ?? path
const folderOf = (path: string) => path.split('/').slice(0, -1).join('/') || '/'
const ICONS: [RegExp, string][] = [
  [/\.(png|jpe?g|gif|webp|heic|svg)$/i, 'image'],
  [/\.(mov|mp4|mkv|webm)$/i, 'film'],
  [/\.(mp3|m4a|wav|flac)$/i, 'file-audio'],
  [/\.(pdf|md)$/i, 'file-text'],
]
const fileIcon = (path: string) => ICONS.find(([re]) => re.test(path))?.[1] ?? 'file'
</script>

<style lang="scss">
.abele-vault-check__state {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin-block-end: var(--size-4-2);
}
// The bar is a block of its own: inline, it sat in a line box and took that line's slack.
.abele-vault-check__state + .abele-progress {
  display: block;
  width: 100%;
}
.abele-vault-check__text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}
.abele-vault-check__meta,
.abele-vault-check__current,
.abele-vault-check__note {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-vault-check__current {
  margin: var(--size-4-1) 0 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  // Cut at the front: the file's name is what changes, its folder is what repeats.
  direction: rtl;
  text-align: left;
}
.abele-vault-check__note {
  margin: var(--size-4-1) 0 0;
}
.abele-vault-check__group + .abele-vault-check__group {
  margin-block-start: var(--size-4-2);
}
.abele-vault-check__group.is-nested > :not(.abele-fold-heading) {
  margin-inline-start: calc(var(--icon-xs) + var(--size-4-1));
}
.abele-vault-check__desc {
  margin-block: var(--size-4-1) var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-vault-check__room {
  visibility: hidden;
}
.abele-vault-check__name,
.abele-vault-check__folder {
  overflow-wrap: anywhere;
}
.abele-vault-check__part {
  white-space: nowrap;
}
</style>
