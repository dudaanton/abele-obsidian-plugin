<template>
  <!-- A file of a note kept on the sync server only, where the note embeds it. A picture with a
       saved preview shows the preview with a cloud in its corner; anything else is one row, as
       Obsidian embeds a file it cannot show: its glyph, name and size, and the download glyph. -->
  <span
    v-if="file.preview && !card"
    class="internal-embed image-embed abele-external-embed abele-external-embed_image"
    :class="{ 'abele-external-embed_busy': state === 'downloading' }"
  >
    <img :src="file.preview" :alt="file.name" />
    <Icon
      class="abele-external-embed__plate"
      :icon="glyph"
      size="xs"
      :tooltip="tip"
      :disabled="state === 'offline' || state === 'downloading'"
      @click.stop="act"
    />
    <Progress
      v-if="state === 'downloading'"
      class="abele-external-embed__bar"
      :label="`Downloading ${file.name}`"
      :value="progress?.done"
      :max="progress?.total ?? file.size"
    />
  </span>
  <span
    v-else
    class="internal-embed file-embed mod-generic abele-external-embed abele-external-embed_card"
    role="link"
    tabindex="0"
    :aria-label="`Open ${file.name}`"
    @click="emit('open')"
    @keydown.enter.prevent="emit('open')"
  >
    <span class="abele-external-embed__row">
      <Icon class="file-embed-icon" :icon="externalIcon(file)" size="s" :interactive="false" />
      <span class="file-embed-title abele-external-embed__name">{{ file.name }}</span>
      <span class="abele-external-embed__facts">{{ facts }}</span>
      <Icon
        v-if="state === 'downloading'"
        class="abele-external-embed__act abele-external-embed__turning"
        icon="loader"
        size="xs"
        :interactive="false"
      />
      <Icon
        v-else
        class="abele-external-embed__act"
        :icon="glyph"
        size="xs"
        :tooltip="tip"
        :disabled="state === 'offline'"
        @click.stop="act"
      />
    </span>
    <Progress
      v-if="state === 'downloading'"
      class="abele-external-embed__bar"
      :label="`Downloading ${file.name}`"
      :value="progress?.done"
      :max="progress?.total ?? file.size"
    />
  </span>
</template>

<script setup lang="ts">
/**
 * An embed whose file is on the sync server only. Pressing the row opens the file's tab, as an
 * embedded file opens in Obsidian; the glyph at its end downloads. The note's text stays as it was; once the file
 * is downloaded the ordinary embed takes this one's place.
 */
import { computed } from 'vue'
import Icon from '../obsidian/Icon.vue'
import Progress from '../obsidian/Progress.vue'
import { externalFacts, externalIcon, formatBytes } from './externalFormat'
import type { ExternalFile, ExternalProgress, ExternalState } from './types'

const props = withDefaults(
  defineProps<{
    file: ExternalFile
    state?: ExternalState
    progress?: ExternalProgress
    /** Show the row even for a picture with a preview. */
    card?: boolean
  }>(),
  { state: 'remote', progress: undefined, card: false }
)
const emit = defineEmits<{ download: []; retry: []; open: [] }>()

const facts = computed(() =>
  props.state === 'downloading' && props.progress
    ? `${formatBytes(props.progress.done)} of ${formatBytes(props.progress.total)}`
    : externalFacts(props.file).slice(1).join(' · ')
)
const glyph = computed(() =>
  props.state === 'offline'
    ? 'cloud-off'
    : props.state === 'downloading'
      ? 'loader'
      : props.state === 'failed'
        ? 'rotate-ccw'
        : 'cloud-download'
)
const tip = computed(() => {
  const size = formatBytes(props.file.size)
  switch (props.state) {
    case 'offline':
      return `On the server only · ${size} · not available offline`
    case 'downloading':
      return 'Downloading…'
    case 'failed':
      return 'Did not download · try again'
    case 'changed':
      return `A newer version is on the server · ${size} · download`
    default:
      return `On the server only · ${size} · download`
  }
})
function act() {
  if (props.state === 'offline' || props.state === 'downloading') return
  emit(props.state === 'failed' ? 'retry' : 'download')
}
</script>

<style lang="scss">
.abele-external-embed_image {
  position: relative;
  display: inline-block;
  max-width: 100%;

  img {
    display: block;
    max-width: 100%;
  }
}

// The cloud on a plate in the picture's corner, readable on any picture.
.abele-external-embed__plate {
  position: absolute;
  inset-inline-end: var(--size-4-2);
  bottom: var(--size-4-2);
  background-color: var(--background-primary);
  border-radius: var(--radius-s);
  box-shadow: var(--shadow-s);
}

.abele-external-embed_image .abele-external-embed__bar {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
}

.abele-external-embed_card {
  display: block;
}

.abele-external-embed__row {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  min-width: 0;
}

.abele-external-embed__name {
  flex: 0 1 auto;
  min-width: 4em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// Where narrow the facts give way first; the name is what one reads.
.abele-external-embed__facts {
  flex: 0 4 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}

.abele-external-embed__act {
  margin-inline-start: auto;
}

.abele-external-embed_card .abele-external-embed__bar {
  margin-top: var(--size-4-1);
}

// The loader turns while the file comes.
.abele-external-embed_busy .abele-external-embed__plate svg,
.abele-external-embed__turning svg {
  animation: abele-external-spin 1.2s linear infinite;
}

@keyframes abele-external-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
