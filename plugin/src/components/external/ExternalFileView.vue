<template>
  <!-- A file kept on the sync server only, in its own tab: what it is in the middle, as Obsidian's
       empty tab stands, and the one thing to do with it under that. -->
  <div class="abele-external-view" :class="{ 'abele-external-view_narrow': narrow }">
    <div v-if="file.preview" class="abele-external-view__preview">
      <img :src="file.preview" :alt="file.name" />
      <span ref="previewBadge" class="abele-external-view__preview-badge" aria-hidden="true" />
    </div>
    <EmptyState
      centered
      :icon="file.preview ? undefined : externalIcon(file)"
      :badge="file.preview ? undefined : state === 'offline' ? 'cloud-off' : 'cloud'"
      :title="file.name"
      :variant="state === 'failed' ? 'error' : 'empty'"
    >
      <span class="abele-external-view__facts">{{ externalFacts(file).join(' · ') }}</span>
      <span class="abele-external-view__where" :class="whereClass">{{ where }}</span>
      <template #action>
        <div v-if="state === 'downloading'" class="abele-external-view__progress">
          <Progress
            :label="t('streamC.fd7881a3dd88b6a4', { v1: String(file.name) })"
            :value="progress?.done"
            :max="progress?.total ?? file.size"
          />
          <div class="abele-external-view__progress-line">
            <span>{{
              progress
                ? t('streamC.16b40c1318912162', {
                    v1: String(formatBytes(progress.done)),
                    v2: String(formatBytes(progress.total)),
                  })
                : t('streamC.bbe5fc3b9ef39f99')
            }}</span>
            <Button
              :text="t('kit.cancel')"
              quiet
              :tooltip="t('streamC.e5e373eab56d6532')"
              @click="emit('cancel')"
            />
          </div>
        </div>
        <div v-else class="abele-external-view__actions">
          <Button
            :text="
              state === 'failed' ? t('streamC.d8b8392e2c542950') : t('streamC.d6eafe8235910042')
            "
            icon="download"
            accent
            :block="narrow"
            :disabled="state === 'offline'"
            :tooltip="
              state === 'offline'
                ? t('streamC.8aab7890501c8d51')
                : state === 'changed'
                  ? t('streamC.c8ecbb6c20f7c61d')
                  : t('streamC.d0121119ce10108a')
            "
            @click="emit(state === 'failed' ? 'retry' : 'download')"
          />
          <Button
            :text="t('commands.external-file-pin')"
            icon="pin"
            :block="narrow"
            :disabled="state === 'offline'"
            :tooltip="t('streamC.d27f523cddd156dc')"
            @click="emit('keep')"
          />
        </div>
      </template>
    </EmptyState>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

/**
 * The tab of a file kept on the sync server only. Its stub names the file; this says what it is,
 * where it is now and offers to bring it here, once or to keep. Offline, a newer version on the
 * server and a failed download each say so on the line under the facts.
 */
import { computed, ref, watch } from 'vue'
import { setIcon } from 'obsidian'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import Progress from '../obsidian/Progress.vue'
import { externalFacts, externalIcon, formatBytes } from './externalFormat'
import type { ExternalFile, ExternalProgress, ExternalState } from './types'

const props = withDefaults(
  defineProps<{
    file: ExternalFile
    state?: ExternalState
    progress?: ExternalProgress
    /** Why the last download failed, in words. */
    error?: string
    /** A phone: the buttons one under the other, across. */
    narrow?: boolean
  }>(),
  { state: 'remote', progress: undefined, error: undefined, narrow: false }
)
const emit = defineEmits<{ download: []; keep: []; cancel: []; retry: [] }>()

const where = computed(() => {
  switch (props.state) {
    case 'offline':
      return t('streamC.8aab7890501c8d51')
    case 'changed':
      return t('streamC.ba5ea463055e38ff')
    case 'failed':
      return props.error
        ? t('streamC.170593a68983c251', { v1: props.error })
        : t('streamC.130a2155aee9da72')
    default:
      return t('streamC.22a2962c55c4cfe0', { v1: props.file.since })
  }
})
const whereClass = computed(() => ({
  'abele-external-view__where_error': props.state === 'failed',
  'abele-external-view__where_note': props.state === 'changed',
}))

const previewBadge = ref<HTMLElement>()
watch(
  [previewBadge, () => props.state],
  ([el, state]) => {
    if (!el) return
    el.empty()
    setIcon(el, state === 'offline' ? 'cloud-off' : 'cloud')
  },
  { immediate: true }
)
</script>

<style lang="scss">
.abele-external-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--size-4-3);
  min-height: 100%;
  padding: var(--size-4-8) var(--size-4-4);
}

.abele-external-view__preview {
  position: relative;
  max-width: min(100%, 320px);

  img {
    display: block;
    max-width: 100%;
    max-height: 240px;
    border-radius: var(--radius-m);
    opacity: 0.85;
  }
}

// The cloud in the picture's corner, on a plate so it reads on any picture.
.abele-external-view__preview-badge {
  position: absolute;
  inset-inline-end: var(--size-4-2);
  bottom: var(--size-4-2);
  display: flex;
  padding: var(--size-2-2);
  border-radius: 50%;
  background-color: var(--background-primary);
  color: var(--text-muted);
  --icon-size: var(--icon-xs);
  --icon-stroke: var(--icon-xs-stroke-width);
}

.abele-external-view__facts,
.abele-external-view__where {
  display: block;
}

.abele-external-view__where {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}

.abele-external-view__where_error {
  color: var(--text-error);
}

.abele-external-view__where_note {
  color: var(--text-accent);
}

.abele-external-view__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--size-4-2);
}

.abele-external-view_narrow {
  align-items: stretch;

  .abele-empty-state,
  .abele-empty-state__action {
    align-self: stretch;
  }

  .abele-external-view__actions {
    flex-direction: column;
  }
}

.abele-external-view__progress {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  width: min(320px, 80vw);
}

.abele-external-view__progress-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
</style>
