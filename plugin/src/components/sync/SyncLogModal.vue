<template>
  <ObsidianModal title="Sync log" size="tall" @close="emit('close')">
    <div class="abele-sync-log">
      <div class="abele-sync-log__head">
        <p class="abele-sync-log__desc">
          What sync has done since Obsidian started, newest at the bottom. The same lines are in the
          developer console.
        </p>
        <Button
          text="Copy"
          icon="copy"
          :disabled="lines.length === 0"
          :tooltip="
            lines.length === 0
              ? 'There is nothing to copy yet'
              : 'Copy the whole log to the clipboard'
          "
          @click="copy"
        />
      </div>

      <EmptyState
        v-if="lines.length === 0"
        text="Nothing has been logged yet. A device that is not connected to a server has nothing to say."
      />
      <div v-else ref="feed" class="abele-sync-log__feed" @scroll="onScroll">
        <div v-for="(line, index) in lines" :key="index" class="abele-sync-log__line">
          {{ line }}
        </div>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * The service's ring buffer, as something a person can read and send on.
 *
 * The buffer itself is the service's — the last few hundred lines, oldest first — and this is
 * a window onto it rather than a copy, so a sync running while the dialog is open writes into
 * the list being read. Newest at the bottom, the way a terminal reads and the way the daemon's
 * own log does; a reader who has scrolled up to look at something is left where they are, and
 * one sitting at the bottom is carried along.
 *
 * Copy is the point of the dialog. A sync failure is a thing somebody reports, and asking them
 * to retype thirty timestamped lines is asking them not to.
 */
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import { Notice } from 'obsidian'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import { SyncService } from '@/sync/SyncService'
import { reasonOf } from '@/sync/format'

const emit = defineEmits<{ (e: 'close'): void }>()

/**
 * How close to the end still counts as being at the end.
 *
 * A scroll position is fractional — zoom, a half-pixel line height — so `scrollTop + height`
 * is rarely exactly `scrollHeight` even when the feed is scrolled all the way down, and a
 * strict comparison would stop following after the first new line.
 */
const AT_BOTTOM = 4

const lines = SyncService.getInstance().log

const feed = useTemplateRef<HTMLElement>('feed')
/** Whether the reader is at the end of the log and wants to be carried along by it. */
const following = ref(true)

function scrollToEnd(): void {
  const el = feed.value
  if (el) el.scrollTop = el.scrollHeight
}

function onScroll(): void {
  const el = feed.value
  if (!el) return
  following.value = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM
}

/**
 * Through the element's own window: settings can open in a window of their own, and the
 * clipboard a dialog there writes to is that window's, not the main one's.
 */
async function copy(): Promise<void> {
  const win = feed.value?.win ?? window
  try {
    await win.navigator.clipboard.writeText(lines.value.join('\n'))
    new Notice('Sync log copied.')
  } catch (failure) {
    new Notice(`The log could not be copied: ${reasonOf(failure)}`)
  }
}

// The list is the service's own array, mutated in place, so its length is what moves.
watch(
  () => lines.value.length,
  async () => {
    if (!following.value) return
    await nextTick()
    scrollToEnd()
  },
  { immediate: true }
)
</script>

<style lang="scss">
.abele-sync-log {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

/**
 * The description and the button share a row and wrap onto two when the dialog is a phone's.
 */
.abele-sync-log__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-3);
}

.abele-sync-log__desc {
  flex: 1 1 12em;
  min-width: 0;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

/**
 * The one scroller in the dialog, and it scrolls one way only: a log line is a timestamp and a
 * sentence, and it wraps rather than running off the side.
 */
.abele-sync-log__feed {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--size-4-2);
  border-radius: var(--radius-s);
  background-color: var(--code-background);
  font-family: var(--font-monospace);
  font-size: var(--font-smaller);
  line-height: var(--line-height-tight);
  color: var(--text-muted);
}

/**
 * A hanging indent: a line of the log wraps to three or four rows on a phone, and flush with
 * the next line's timestamp its tail read as a line of its own. Indented, each entry is the
 * block that starts at the margin.
 */
.abele-sync-log__line {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding-inline-start: var(--size-4-4);
  text-indent: calc(-1 * var(--size-4-4));
}
</style>
