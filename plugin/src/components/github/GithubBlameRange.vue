<template>
  <div class="abele-github-blame-range">
    <Button
      class="clickable-icon abele-github-blame-range__open"
      :text="messageLabel"
      :disabled="!commit.sha"
      :tooltip="details"
      @click="open"
      @pointerdown="press"
      @pointerup="cancel"
      @pointercancel="cancel"
      @pointerleave="cancel"
      @pointermove="move"
      @contextmenu.prevent="showDetails"
    >
      <span class="abele-github-blame-range__author">
        <GithubUser v-if="commit.login" :login="commit.login" :avatar="commit.avatar" />
        <template v-else
          ><Avatar :src="commit.avatar" :name="authorLabel" />{{ authorLabel }}</template
        >
      </span>
      <span class="abele-github-blame-range__date">{{ relativeDate }}</span>
      <span class="abele-github-blame-range__message">{{ messageLabel }}</span>
    </Button>
    <ObsidianModal
      v-if="detailsOpen"
      :title="t('streamB.lineBlame.1194b3')"
      @close="detailsOpen = false"
    >
      <div class="abele-github-blame-detail-body">
        <p>{{ authorLabel }} · {{ formatDate(commit.date) }}</p>
        <p>{{ commit.sha }}</p>
        <div class="abele-github-blame-details">{{ commit.message }}</div>
        <Button
          :text="t('streamB.openCommit.f1ac56')"
          :tooltip="t('streamB.openThisCommitInTheGithubTab.2d2b83')"
          @click="openCommit"
        />
      </div>
    </ObsidianModal>
  </div>
</template>

<script setup lang="ts">
import { t, currentLocale, relativeFormatter } from '@/i18n'
import { streamBLabel } from '@/i18n/streamBLabels'
import { computed, onBeforeUnmount, ref } from 'vue'
import { formatDate, splitMessage } from '@/github/format'
import type { CommitSummary } from '@/repository/model'
import GithubUser from './GithubUser.vue'
import Avatar from '../obsidian/Avatar.vue'
import Button from '../obsidian/Button.vue'
import ObsidianModal from '../obsidian/Modal.vue'

const props = defineProps<{ commit: CommitSummary }>()
const emit = defineEmits<{ (e: 'open', sha: string): void }>()
const authorLabel = computed(() =>
  props.commit.sha ? props.commit.author : streamBLabel(props.commit.author)
)
const messageLabel = computed(() =>
  props.commit.sha ? splitMessage(props.commit.message).title : streamBLabel(props.commit.message)
)
const details = computed(
  () =>
    `${authorLabel.value} · ${formatDate(props.commit.date)}\n${props.commit.sha}\n${props.commit.sha ? props.commit.message : messageLabel.value}`
)
const relativeDate = computed(() => {
  const seconds = (Date.parse(props.commit.date) - Date.now()) / 1000
  if (!Number.isFinite(seconds)) return ''
  const format = relativeFormatter(currentLocale().format, { numeric: 'auto', style: 'short' })
  for (const [unit, length] of [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ] as const) {
    if (Math.abs(seconds) >= length) return format.format(Math.round(seconds / length), unit)
  }
  return format.format(0, 'second')
})
let timer: number | undefined
let held = false
let start = { x: 0, y: 0 }
/** The commit's author, date, sha and whole message, after a long press or a right click. */
const detailsOpen = ref(false)
const cancel = () => {
  window.clearTimeout(timer)
  timer = undefined
}
const showDetails = () => {
  if (!props.commit.sha) return
  cancel()
  held = true
  detailsOpen.value = true
}
const openCommit = () => {
  detailsOpen.value = false
  emit('open', props.commit.sha)
}
const press = (e: PointerEvent) => {
  held = false
  if (e.pointerType === 'mouse' || e.button !== 0) return
  start = { x: e.clientX, y: e.clientY }
  timer = window.setTimeout(showDetails, 500)
}
const move = (e: PointerEvent) => {
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel()
}
const open = () => {
  if (!props.commit.sha) return
  if (held) {
    held = false
    return
  }
  emit('open', props.commit.sha)
}
onBeforeUnmount(() => {
  cancel()
})
</script>

<style lang="scss">
.abele-github-blame {
  width: 20rem;
  max-width: 40vw;
  font-family: var(--font-interface);
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);

  .cm-gutterElement {
    padding: 0;
    text-align: start;
  }
  &__start {
    border-top: 1px solid var(--background-modifier-border);
  }
}
.abele-github-blame-range {
  width: 20rem;
  max-width: 40vw;
  height: 1lh;
  overflow: hidden;

  &__open.clickable-icon {
    display: flex;
    justify-content: flex-start;
    gap: var(--size-2-2);
    width: 100%;
    height: 100%;
    padding: 0 var(--size-2-2);
    font-size: inherit;
    color: var(--text-muted);
  }
  &__author {
    display: inline-flex;
    align-items: center;
    gap: var(--size-2-2);
    flex: 0 1 auto;
    min-width: 0;
    max-width: 45%;
    white-space: nowrap;
    overflow: hidden;
    .abele-github-user__label {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .abele-avatar {
      width: 1em;
      height: 1em;
      flex-shrink: 0;
    }
  }
  &__date {
    flex-shrink: 0;
  }
  &__message {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}
.is-mobile .abele-github-blame,
.is-mobile .abele-github-blame-range {
  width: 8.75rem;
  max-width: 36vw;
}
.is-mobile .abele-github-blame-range__date {
  display: none;
}
.abele-github-blame-detail-body {
  overflow-wrap: anywhere;
}
.abele-github-blame-details {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin-bottom: var(--size-4-3);
}
</style>
