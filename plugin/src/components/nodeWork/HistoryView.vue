<template>
  <div ref="root" class="abele-history">
    <!-- One commit: what it says, then every file it changed, compared the same way as a file. -->
    <template v-if="commit">
      <div class="abele-history__commit-head">
        <div class="abele-history__subject">{{ commit.subject }}</div>
        <div class="abele-history__facts">
          <span>{{ commit.author }}</span>
          <span>{{ commit.day }}, {{ commit.when }}</span>
          <span class="abele-history__hash">{{ commit.hash }}</span>
          <span>{{ plural(commit.files?.length ?? 0, 'file') }}</span>
        </div>
      </div>
      <FileView
        v-for="file in commit.files ?? []"
        :key="file.path"
        :path="file.path"
        :text="file.after"
        :change="asChange(file)"
        @menu="(e, selection) => emit('menu', e, file.path, selection)"
        @ask="emit('ask', file.path, $event)"
        @add="emit('add', file.path, $event)"
        @note="emit('note', file.path, $event)"
      />
    </template>

    <!-- The list: where the branch stands, then commits by day, newest first, on one line of
         history. A commit not in the main branch yet stands solid on it, one already there hollow;
         what came in since you last looked has the accent dot. The author is the git account that
         made it, whoever was typing. -->
    <template v-else>
      <div v-if="head" class="abele-history__branch">
        <Icon :icon="copy ? copyIcon(copy) : 'git-branch'" :interactive="false" />
        <span class="abele-history__branch-name">{{ copy?.branch }}</span>
        <span v-if="copy && copy.kind !== 'project'" class="abele-history__drift">
          <span
            ref="aheadEl"
            class="abele-history__count"
            :class="{ 'abele-history__count_on': (copy.ahead ?? 0) > 0 }"
            ><Icon icon="arrow-up" size="xs" :interactive="false" />{{ copy.ahead ?? '?' }}</span
          >
          <span
            ref="behindEl"
            class="abele-history__count"
            :class="{ 'abele-history__count_on': (copy.behind ?? 0) > 0 }"
            ><Icon icon="arrow-down" size="xs" :interactive="false" />{{ copy.behind ?? '?' }}</span
          >
        </span>
      </div>
      <div
        class="abele-history__list"
        :class="{ 'abele-history__list_more': more, 'abele-history__list_split': !!baseAt }"
      >
        <section v-for="day in days" :key="day.name" class="abele-history__day">
          <h3 class="abele-history__day-name">
            <span class="abele-history__rail" /> {{ day.name }}
          </h3>
          <div
            v-for="c in day.commits"
            :key="c.hash"
            class="abele-history__row"
            :class="{
              'abele-history__row_only': c.only,
              'abele-history__row_unseen': c.unseen,
              'abele-history__row_base': c.hash === baseAt,
            }"
            role="button"
            tabindex="0"
            @click="emit('open-commit', c.hash)"
            @keydown.enter.prevent="emit('open-commit', c.hash)"
            @contextmenu.prevent="emit('menu', $event, c.hash, '')"
          >
            <span class="abele-history__rail"
              ><span class="abele-history__dot" :data-tip="dotTip(c)"
            /></span>
            <span class="abele-history__body">
              <span class="abele-history__row-subject">{{ c.subject }}</span>
              <span class="abele-history__row-meta">
                <Avatar :name="c.author" />
                <span>{{ c.author }}</span>
                <span class="abele-history__sep">·</span>
                <span>{{ c.when }}</span>
                <template v-if="statsOf(c)">
                  <span class="abele-history__sep">·</span>
                  <span>{{ plural(statsOf(c)!.files, 'file') }}</span>
                </template>
                <span
                  v-if="c.hash === baseAt"
                  class="abele-history__tag"
                  :data-tip="t('streamB.isHere.1f91f3', { v0: String(base) })"
                  ><Icon icon="home" size="xs" :interactive="false" />{{ base }}</span
                >
              </span>
            </span>
            <span v-if="statsOf(c)" class="abele-history__lines"
              ><span v-if="statsOf(c)!.added" class="abele-history__added"
                >+{{ statsOf(c)!.added }}</span
              ><span v-if="statsOf(c)!.removed" class="abele-history__removed"
                >−{{ statsOf(c)!.removed }}</span
              ></span
            >
            <span class="abele-history__hash" :data-tip="c.hash">{{ c.hash.slice(0, 7) }}</span>
          </div>
        </section>
      </div>
      <div v-if="!commits.length" class="search-empty-state">
        {{ t('streamB.noCommitsYet.053cea') }}
      </div>
      <div v-if="more" class="abele-history__more">
        <Button
          :text="t('streamB.showOlder.ade7cb')"
          :tooltip="t('streamB.loadTheCommitsBeforeThese.416b88')"
          @click="emit('more')"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
// The history of a folder or a worktree in the main area, a tab of its own: commits by day like a
// repository's commit list, a click opens the commit with each file it changed compared. Above
// the list, how far the worktree has gone from the main branch, in arrows and numbers.
import { computed, onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Avatar from '../obsidian/Avatar.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import FileView from './FileView.vue'
import { copyIcon, plural } from './codes'
import type { CommitSummary, CopySummary, FileChange } from './types'
import type { FileSelection } from './fileSelection'

const props = withDefaults(
  defineProps<{
    commits: CommitSummary[]
    copy?: CopySummary
    /** The commit open now; none shows the list. */
    open?: string
    /** Older commits are there to load. */
    more?: boolean
    /** The folder's main branch, for the ahead and behind tooltips. */
    base?: string
    /** The branch and its arrows over the list; off where the page above already says them. */
    head?: boolean
  }>(),
  { copy: undefined, open: undefined, more: false, base: undefined, head: true }
)

const emit = defineEmits<{
  (e: 'open-commit', hash: string): void
  (e: 'more'): void
  (e: 'menu', event: MouseEvent, what: string, selection: string): void
  (e: 'ask', path: string, selection: FileSelection): void
  (e: 'add', path: string, selection: FileSelection): void
  (e: 'note', path: string, selection: FileSelection): void
}>()

const commit = computed(() => props.commits.find((c) => c.hash === props.open))
// One view of each file for as long as the file is the same object: as a big commit's files fill
// in one by one, the cards whose file did not change are not drawn again.
const changes = new WeakMap<FileChange, FileChange>()
const asChange = (file: FileChange) => {
  let change = changes.get(file)
  if (!change)
    changes.set(file, (change = { ...file, when: undefined, unseen: false, stage: undefined }))
  return change
}
const days = computed(() => {
  const out: { name: string; commits: CommitSummary[] }[] = []
  for (const c of props.commits) {
    const last = out[out.length - 1]
    if (last?.name === c.day) last.commits.push(c)
    else out.push({ name: c.day, commits: [c] })
  }
  return out
})

// Where the main branch stands in this list: the newest commit already in it, under a worktree's own.
const baseAt = computed(() =>
  props.commits.some((c) => c.only) ? props.commits.find((c) => !c.only)?.hash : undefined
)
const statsOf = (c: CommitSummary) =>
  c.stats ??
  (c.files?.length
    ? {
        files: c.files.length,
        added: c.files.reduce((n, f) => n + f.added, 0),
        removed: c.files.reduce((n, f) => n + f.removed, 0),
      }
    : undefined)
const dotTip = (c: CommitSummary) =>
  [
    c.unseen ? t('streamB.newSinceYouLastLooked.ea40a1') : '',
    c.only
      ? t('streamB.notInYet.afee32', { v0: String(props.base) })
      : t('streamB.in.8b3475', { v0: String(props.base) }),
  ]
    .filter(Boolean)
    .join(' · ')

const root = ref<HTMLElement>()
const aheadEl = ref<HTMLElement>()
const behindEl = ref<HTMLElement>()
const tips = () => {
  if (aheadEl.value)
    setTooltip(
      aheadEl.value,
      props.copy?.ahead === undefined
        ? t('streamB.aheadCountUnavailableSelectAReferenceBranch.743076')
        : t('streamB.aheadOf.671506', {
            v0: String(plural(props.copy.ahead, 'commit')),
            v1: String(props.base ?? t('streamB.theSelectedReference.7fff17')),
          })
    )
  if (behindEl.value)
    setTooltip(
      behindEl.value,
      props.copy?.behind === undefined
        ? t('streamB.behindCountUnavailableSelectAReferenceBranch.621d55')
        : t('streamB.behind.861d2a', {
            v0: String(plural(props.copy.behind, 'commit')),
            v1: String(props.base ?? t('streamB.theSelectedReference.7fff17')),
          })
    )
  root.value
    ?.querySelectorAll<HTMLElement>('[data-tip]')
    .forEach((el) => setTooltip(el, el.dataset.tip ?? ''))
}
onMounted(tips)
watch(() => [props.copy, props.open, props.commits], tips, { flush: 'post' })
</script>

<style lang="scss">
.abele-history {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-4);
  min-width: 0;
  container-type: inline-size;
}
.abele-history__branch {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  color: var(--text-normal);

  .abele-obsidian-icon {
    padding: 0;
  }
}
// The branch is the page's title: the largest, boldest text on it.
.abele-history__branch-name {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-medium);
  font-weight: var(--font-semibold);
}
.abele-history__drift {
  display: flex;
  gap: var(--size-4-2);
  margin-inline-start: var(--size-4-1);
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
.abele-history__count {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-1);
  font-variant-numeric: tabular-nums;
}
.abele-history__count_on {
  color: var(--text-normal);
}

// One line of history down the left, a dot on it per commit, a mark per day. The rail is a fixed
// column, so dots and marks of every day stand in one line whatever the text beside them.
.abele-history {
  --abele-history-rail: var(--size-4-5);
  --abele-history-line: color-mix(in oklch, var(--text-faint) 45%, transparent);
  --abele-history-line-only: var(--text-muted);
}
.abele-history__day {
  display: flex;
  flex-direction: column;
}
.abele-history__rail {
  position: relative;
  display: flex;
  flex: 0 0 var(--abele-history-rail);
  align-self: stretch;
  justify-content: center;

  &::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: calc(50% - var(--border-width) / 2);
    width: var(--border-width);
    background-color: var(--abele-history-line);
  }
}
// The line runs on through the day headings, from the first commit's dot to the last one's, or on
// past it while older commits are there to load.
.abele-history__day-name .abele-history__rail::before {
  inset-block: calc(-1 * var(--size-4-3)) calc(-1 * var(--size-4-1));
}
.abele-history__day:first-child .abele-history__day-name .abele-history__rail::before {
  display: none;
}
.abele-history__day:first-child .abele-history__row:first-of-type .abele-history__rail::before {
  top: calc(var(--size-4-2) + 0.5lh);
}
.abele-history__list:not(.abele-history__list_more)
  .abele-history__day:last-child
  .abele-history__row:last-child
  .abele-history__rail::before {
  bottom: calc(100% - var(--size-4-2) - 0.5lh);
}
// The worktree's own commits run on a stronger line down to where the main branch stands.
.abele-history__row_only .abele-history__rail::before {
  background-color: var(--abele-history-line-only);
}
// The worktree's own commits are the newest, so a day holding any of them is on that line too.
.abele-history__day:has(.abele-history__row_only)
  .abele-history__day-name
  .abele-history__rail::before {
  background-color: var(--abele-history-line-only);
}

// A day as Obsidian's small section headings are: small, semibold, beside the line.
.abele-history__day-name {
  display: flex;
  align-items: center;
  margin: 0;
  padding-block: var(--size-4-3) var(--size-4-1);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-semibold);
  line-height: var(--line-height-tight);
}
.abele-history__day:first-child .abele-history__day-name {
  padding-block-start: var(--size-4-1);
}
.abele-history__day-name .abele-history__rail {
  align-items: center;
  margin-inline-end: var(--size-4-2);
}

.abele-history__row {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-3);
  padding-inline-end: var(--size-4-2);
  border-radius: var(--radius-s);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  cursor: var(--cursor);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
  &:focus-visible {
    box-shadow: 0 0 0 2px var(--background-modifier-border-focus);
    outline: none;
  }
}
.abele-history__row > .abele-history__rail {
  margin-inline-end: calc(var(--size-4-2) - var(--size-4-3));
}
// Rows a step apart, so their lights never touch; the line runs on through the step.
.abele-history__row + .abele-history__row {
  margin-top: var(--size-2-1);

  > .abele-history__rail::before {
    top: calc(-1 * var(--size-2-1));
  }
}
.abele-history__body,
.abele-history__lines,
.abele-history__hash {
  padding-block: var(--size-4-2);
}
// A commit already in the main branch: a hollow dot. Its own, not merged yet: solid. New since you
// looked: the accent, as everywhere else on the node.
.abele-history__dot {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  width: var(--size-4-2);
  height: var(--size-4-2);
  margin-top: calc(var(--size-4-2) + (1lh - var(--size-4-2)) / 2);
  border: var(--border-width) solid var(--text-faint);
  border-radius: 50%;
  background-color: var(--background-primary);
}
.abele-history__row_only .abele-history__dot,
.abele-history__list:not(.abele-history__list_split) .abele-history__dot {
  border-color: var(--text-muted);
  background-color: var(--text-muted);
}
.abele-history__list .abele-history__row_unseen .abele-history__dot {
  border-color: var(--interactive-accent);
  background-color: var(--interactive-accent);
}
.abele-history__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
}
// Subject first: the size of the text around it, weight above it. What came in unseen is bolder.
.abele-history__row-subject {
  overflow: hidden;
  color: var(--text-normal);
  font-size: var(--font-ui-medium);
  font-weight: var(--font-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
// Under a worktree with commits of its own, what is already in the main branch steps back.
.abele-history__list_split
  .abele-history__row:not(.abele-history__row_only)
  .abele-history__row-subject {
  color: var(--text-muted);
}
.abele-history__row_unseen .abele-history__row-subject {
  font-weight: var(--font-semibold);
}
.abele-history__row-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-4-1);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  line-height: var(--line-height-tight);

  .abele-avatar {
    width: var(--icon-s);
    height: var(--icon-s);
  }
}
.abele-history__sep {
  color: var(--text-faint);
}
.abele-history__tag {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-1);
  margin-inline-start: var(--size-4-1);
  padding: 0 var(--size-4-1);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  color: var(--text-muted);
  font-family: var(--font-monospace);

  .abele-obsidian-icon {
    padding: 0;
  }
}
// Lines added and removed in the comparison's own colours; numbers in fixed width, so they line up.
.abele-history__lines {
  display: flex;
  flex: 0 0 auto;
  gap: var(--size-4-2);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
  line-height: calc(var(--font-ui-medium) * var(--line-height-normal));
}
.abele-history__added {
  color: var(--text-success);
}
.abele-history__removed {
  color: var(--text-error);
}
.abele-history__hash {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  line-height: calc(var(--font-ui-medium) * var(--line-height-normal));
}
// The short hash, the whole one under the pointer. Where the page is narrow the subject keeps the
// room and the hash steps out; the commit's own page has it whole.
@container (max-width: 32em) {
  .abele-history__row .abele-history__hash {
    display: none;
  }
}
.abele-history__more {
  display: flex;
  padding-inline-start: calc(var(--abele-history-rail) + var(--size-4-2));
}
.abele-history__commit-head {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}
.abele-history__subject {
  color: var(--text-normal);
  font-size: var(--font-ui-medium);
  font-weight: var(--font-semibold);
}
.abele-history__facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1) var(--size-4-3);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
</style>
