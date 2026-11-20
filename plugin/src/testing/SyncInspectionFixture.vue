<template>
  <Modal
    title="sync.example"
    size="tall"
    modal-class="abele-sync-connection"
    @close="emit('close')"
  >
    <div v-if="area === 'check'" class="abele-sync-window__status">
      <StatusDot tone="green" :label="status" />
      <span>{{ status }}</span>
    </div>
    <AbeleSections
      v-if="area === 'sections'"
      ref="tree"
      :source="sections"
      :plugin-settings="step !== 11"
      @choice-closed="step === 9 && emit('close')"
    />
    <VaultCheckBlock v-else :source="check" />
    <template #footer>
      <Button
        style="margin-inline-end: auto"
        :text="t('sync.window.disconnect')"
        :tooltip="t('sync.window.disconnectTip')"
        warning
      />
      <Button
        :text="t('sync.window.close')"
        :tooltip="t('sync.window.closeTip')"
        @click="emit('close')"
      />
      <Button :text="t('sync.window.share')" :tooltip="t('sync.window.shareTip')" />
    </template>
  </Modal>
  <VersionHistoryModal
    v-if="area === 'check' && step === 6"
    path="Notes/sample-different.md"
    :source="history"
    @close="emit('close')"
  />
</template>
<script setup lang="ts">
import { nextTick, onMounted, ref, shallowRef } from 'vue'
import Modal from '@/components/obsidian/Modal.vue'
import Button from '@/components/obsidian/Button.vue'
import StatusDot from '@/components/obsidian/StatusDot.vue'
import VersionHistoryModal from '@/components/sync/VersionHistoryModal.vue'
import { t } from '@/i18n'
import { settingsSyncText, settingsSyncWhen } from '@/i18n/settingsSync'
import type { tokenHistory } from '@/sync/tokenHistory'
import type { V2EngineClient } from '@abele/sync-sdk/core'
import AbeleSections from '@/components/settings/sync/AbeleSections.vue'
import VaultCheckBlock from '@/components/sync/VaultCheckBlock.vue'
import { SECTIONS } from '@/transfer/entries'
import { settingsLabel } from '@/i18n/settingsLabels'
import { pageOf, pageSections } from '@/transfer/pages'
import type { SectionId } from '@/transfer/types'
import type { AbeleSectionsSource } from '@/sync/abeleSections'
import type { VaultCheckSource, VaultCheckState } from '@/sync/vaultCheck'

const props = defineProps<{ area: 'sections' | 'check'; step: number }>()
const emit = defineEmits<{ close: [] }>()
const tree = ref<InstanceType<typeof AbeleSections>>()
const rows = SECTIONS.filter((section) => section.id !== 'sync')
  .sort((a, b) => pageSections().indexOf(a.id) - pageSections().indexOf(b.id))
  .map((section) => ({
    id: section.id,
    label: settingsLabel(section.label),
    keys: [
      'ai-general',
      'ai-providers',
      'ai-image-providers',
      'ai-secrets',
      'ai-voice',
      'ai-mcp-servers',
      'github-connections',
      'finance',
      'calendars',
    ].includes(section.id)
      ? 1
      : 0,
    missing: props.step === 6 && ['ai-providers', 'ai-voice'].includes(section.id) ? 1 : 0,
    needs: section.id === 'ai-agents' ? (['ai-providers'] satisfies SectionId[]) : undefined,
  }))
const chosen = shallowRef<ReadonlySet<SectionId>>(
  new Set(
    rows
      .map((row) => row.id)
      .filter(
        (id) =>
          !([3, 9].includes(props.step) && id === 'reader') &&
          !([7, 8].includes(props.step) && id === 'ai-providers')
      )
  )
)
const sections: AbeleSectionsSource = {
  rows: shallowRef(rows),
  chosen,
  keys: shallowRef(props.step === 4 ? 'off' : props.step === 5 ? 'locked' : 'on'),
  kept: shallowRef(
    props.step === 10 ? [{ id: 'reader', from: 'Sample phone', at: Date.now() - 60_000 }] : []
  ),
  differs: async () => props.step === 9,
  choose: async (id, on) => {
    const next = new Set(chosen.value)
    if (on) next.add(id)
    else next.delete(id)
    chosen.value = next
  },
  restore: async () => {
    sections.kept.value = []
  },
  openKeys: () => {},
}
const at = Date.now() - 60_000
const status = settingsSyncText('Synced {when}', {
  when: settingsSyncWhen(new Date(at - 60_000).toISOString()),
})
const history: ReturnType<typeof tokenHistory> = {
  client: () =>
    ({
      versions: async () =>
        [2, 1].map((no) => ({
          version_id: `sample-v${no}`,
          seq: no,
          no,
          op: no === 1 ? 'create' : 'modify',
          path: 'Notes/sample-different.md',
          sha: `sample-sha-${no}`,
          size: no === 2 ? 3891 : 4301,
          mtime: at,
          actor: { kind: 'device', id: 'sample-device', name: 'Sample computer' },
          at: new Date(at - no * 60000).toISOString(),
          merge: null,
        })),
      versionBytes: async () => new TextEncoder().encode('Sample earlier contents\n'),
    }) as unknown as V2EngineClient,
  entryFor: async () => ({
    path: 'Notes/sample-different.md',
    wirePath: 'Notes/sample-different.md',
    fileId: 'sample-file',
    versionId: 'sample-v2',
    sha: 'sample-sha-2',
    size: 4301,
    mtime: at,
  }),
  syncNow: async () => {},
  note: () => {},
  status: { value: { state: 'idle' } },
  connection: { value: { vaultId: 'sample-vault' } },
}
const states: Record<number, VaultCheckState> = {
  1: { kind: 'never' },
  2: {
    kind: 'running',
    done: 18420,
    total: 33000,
    bytesDone: 2.8 * 1024 ** 3,
    bytesTotal: 5.1 * 1024 ** 3,
    current: 'Attachments/sample-image.jpg',
  },
  3: { kind: 'matched', total: 33000, bytes: 5.1 * 1024 ** 3, at },
  4: {
    kind: 'differs',
    total: 33000,
    bytes: 5.1 * 1024 ** 3,
    at,
    items: [
      { path: 'Notes/sample-pending.md', reason: 'unsent' },
      { path: 'Attachments/Audio/sample-audio.mp3', reason: 'skipped', rule: 'audio' },
      { path: 'Notes/sample-different.md', reason: 'differs', localSize: 4301, serverSize: 3891 },
      { path: 'Notes/sample-remote.md', reason: 'server-only' },
      { path: 'Notes/sample-local.md', reason: 'local-only' },
    ],
  },
  5: {
    kind: 'differs',
    total: 33000,
    bytes: 5.1 * 1024 ** 3,
    at,
    items: Array.from({ length: 214 }, (_, i) => ({
      path: `Attachments/sample-${i}.bin`,
      reason: 'skipped',
    })),
  },
  7: { kind: 'stopped', done: 18420, total: 33000, at },
  8: { kind: 'unreachable', at, reason: 'Sample local file could not be read' },
}
const check: VaultCheckSource = {
  state: shallowRef(states[props.step === 6 ? 4 : props.step] ?? states[1]),
  start: () => {},
  stop: () => {},
  send: async () => {},
}
onMounted(async () => {
  if (props.area !== 'sections') return
  const pages = new Set<string>()
  if ([2, 3, 9, 10].includes(props.step)) pages.add(pageOf('reader'))
  if ([2, 4, 5, 6, 8].includes(props.step)) pages.add(pageOf('ai-agents'))
  for (const page of pages) tree.value?.fold(page)
  await nextTick()
  if (props.step === 9)
    document
      .querySelector<HTMLElement>('[data-section="reader"] input')
      ?.dispatchEvent(new Event('change', { bubbles: true }))
})
</script>
