<template>
  <Modal :title="name" size="tall" phone-sheet @close="emit('close')">
    <div class="abele-sync-window">
      <!-- What the connection is doing, as the row says it, and a bar while it runs. -->
      <div class="abele-sync-window__state">
        <StatusDot :tone="tone" :label="line" :pulse="tone === 'accent'" />
        <span class="abele-sync-window__line">{{ line }}</span>
        <span class="abele-sync-window__server">{{ host }}</span>
      </div>
      <Progress
        v-if="progress"
        :label="`${progress.completed} of ${progress.total}`"
        :value="progress.completed"
        :max="progress.total"
      />
      <p v-if="failure" class="abele-sync-window__error mod-warning" role="alert">{{ failure }}</p>

      <Section v-if="refused.length" title="Not sent">
        <Setting v-for="item in refused" :key="item.path" :name="item.path" :desc="item.reason" />
      </Section>

      <Section
        v-if="conflicts.length"
        title="Conflict copies"
        desc="Both versions are kept. Open the copy, take what you need, then delete it."
      >
        <EntryRow
          v-for="path in conflicts"
          :key="path"
          role="button"
          tabindex="0"
          @click="emit('open', path)"
          @keydown.enter="emit('open', path)"
          >{{ path
          }}<template #actions
            ><Icon
              icon="file-text"
              tooltip="Open the conflict copy"
              @click.stop="emit('open', path)" /></template
        ></EntryRow>
      </Section>

      <Section v-if="held.length || changes.length" title="Waiting for you">
        <HeldDeletesBlock v-if="held.length" :held="held" />
        <StagedSettingsBlock v-if="changes.length" :changes="changes" :names="{}" />
      </Section>

      <SelectiveSync />

      <Section v-if="events.length" title="Recent">
        <ol class="abele-sync-window__events">
          <li v-for="(event, i) in events" :key="i">
            <span class="abele-sync-window__time">{{ when(event.at) }}</span>
            <span>{{ event.text }}</span>
          </li>
        </ol>
      </Section>
    </div>
    <template #footer>
      <Button
        text="Disconnect…"
        warning
        class="abele-sync-window__disconnect"
        tooltip="Stop syncing this connection; the files stay on this device"
        @click="emit('disconnect')"
      />
      <Button text="Close" tooltip="Close this window" @click="emit('close')" />
      <Button
        text="Share…"
        tooltip="Give a folder or group to someone, or connect another device of yours"
        @click="emit('share')"
      />
    </template>
  </Modal>
</template>

<script setup lang="ts">
/**
 * One connection, opened from its row: what it is doing, what it could not send, the conflict
 * copies it saved, what waits for the person, what this device takes, and the last few things
 * that happened. Sharing and disconnecting are at the foot, the dangerous one apart.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import Modal from '../obsidian/Modal.vue'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import EntryRow from '../obsidian/EntryRow.vue'
import Progress from '../obsidian/Progress.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import HeldDeletesBlock from './HeldDeletesBlock.vue'
import StagedSettingsBlock from './StagedSettingsBlock.vue'
import SelectiveSync from '../settings/sync/SelectiveSync.vue'
import { connectionName, type TokenUi } from '@/sync/tokenUi'
import { connectionLine, connectionProgress, connectionTone } from '@/sync/connectionLine'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import { historyConnection } from '@/sync/tokenHistory'
import type { HeldDelete } from '@abele/sync-core'
import type { ChangeItem } from '@abele/sync-protocol'

const props = defineProps<{ ui: TokenUi; connectionId: string; error?: string }>()
const emit = defineEmits<{
  close: []
  share: []
  disconnect: []
  open: [path: string]
}>()

const row = computed(() => props.ui.rows.value.find((one) => one.id === props.connectionId))
const activity = computed(() => props.ui.activity.value[props.connectionId])
const name = computed(() => (row.value ? connectionName(row.value).split(' · ')[0] : ''))
const host = computed(() => (row.value ? new URL(row.value.address).host : ''))
const line = computed(() => (row.value ? connectionLine(row.value, activity.value) : ''))
const tone = computed(() => (row.value ? connectionTone(row.value, activity.value) : 'faint'))
const progress = computed(() => connectionProgress(activity.value))
const failure = computed(() => props.error || activity.value?.error || '')
const refused = computed(() => activity.value?.refused ?? [])
const conflicts = computed(() => activity.value?.conflicts ?? [])
const events = computed(() => [...(activity.value?.events ?? [])].reverse().slice(0, 8))
const held = shallowRef<HeldDelete[]>([])
const changes = ref<ChangeItem[]>([])

const when = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

onMounted(async () => {
  historyConnection.value = props.connectionId
  try {
    const port = TokenSettingsPort.forConnection(props.ui, props.connectionId)
    await port.settingsPrompt.refresh()
    changes.value = port.settingsPrompt.staged.value
    held.value = (await props.ui.runtimes.get(props.connectionId)?.heldDeletes?.()) ?? []
  } catch {
    // The window still says what the row knows; what waits is shown again on the next open.
  }
})
</script>

<style lang="scss">
.abele-sync-window {
  .abele-section:first-of-type {
    margin-top: var(--size-4-6);
  }
}
.abele-sync-window__state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-2-3) var(--size-4-2);
  margin-bottom: var(--size-4-2);
}
.abele-sync-window__line {
  color: var(--text-normal);
}
.abele-sync-window__server {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-sync-window__error {
  margin-block: var(--size-4-2) 0;
  color: var(--text-error);
}
.abele-sync-window__events {
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    gap: var(--size-4-3);
    padding-block: var(--size-2-2);
    font-size: var(--font-ui-small);
  }
}
.abele-sync-window__time {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
// Apart from Share and Close, at the footer's start: it ends the connection.
.abele-sync-window__disconnect {
  margin-inline-end: auto;
}
</style>
