<template>
  <div class="abele-history">
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
        :change="{ ...file, when: undefined, unseen: false, stage: undefined }"
        @menu="(e, selection) => emit('menu', e, file.path, selection)"
      />
    </template>

    <!-- The list: where the branch stands, then commits by day, newest first. -->
    <template v-else>
      <div class="abele-history__branch">
        <Icon :icon="copy ? copyIcon(copy) : 'git-branch'" size="xs" :interactive="false" />
        <span class="abele-history__branch-name">{{ copy?.branch }}</span>
        <span v-if="copy && copy.kind !== 'project'" class="abele-history__drift">
          <span ref="aheadEl" class="abele-history__count"
            ><Icon icon="arrow-up" size="xs" :interactive="false" />{{ copy.ahead ?? 0 }}</span
          >
          <span ref="behindEl" class="abele-history__count"
            ><Icon icon="arrow-down" size="xs" :interactive="false" />{{ copy.behind ?? 0 }}</span
          >
        </span>
      </div>
      <section v-for="day in days" :key="day.name" class="abele-history__day">
        <h3 class="abele-history__day-name">{{ day.name }}</h3>
        <div
          v-for="c in day.commits"
          :key="c.hash"
          class="abele-history__row"
          role="button"
          tabindex="0"
          @click="emit('open-commit', c.hash)"
          @keydown.enter.prevent="emit('open-commit', c.hash)"
          @contextmenu.prevent="emit('menu', $event, c.hash, '')"
        >
          <span class="abele-history__row-subject">{{ c.subject }}</span>
          <span class="abele-history__row-meta">{{ c.author }} · {{ c.when }}</span>
          <span class="abele-history__hash">{{ c.hash }}</span>
        </div>
      </section>
      <div v-if="!commits.length" class="search-empty-state">No commits yet.</div>
      <div v-if="more" class="abele-history__more">
        <Button text="Show older" tooltip="Load the commits before these" @click="emit('more')" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// The history of a folder or a worktree in the main area, a tab of its own: commits by day like a
// repository's commit list, a click opens the commit with each file it changed compared. Above
// the list, how far the worktree has gone from the main branch, in arrows and numbers.
import { computed, onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import FileView from './FileView.vue'
import { copyIcon, plural } from './codes'
import type { CommitSummary, CopySummary } from './types'

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
  }>(),
  { copy: undefined, open: undefined, more: false, base: 'main' }
)

const emit = defineEmits<{
  (e: 'open-commit', hash: string): void
  (e: 'more'): void
  (e: 'menu', event: MouseEvent, what: string, selection: string): void
}>()

const commit = computed(() => props.commits.find((c) => c.hash === props.open))
const days = computed(() => {
  const out: { name: string; commits: CommitSummary[] }[] = []
  for (const c of props.commits) {
    const last = out[out.length - 1]
    if (last?.name === c.day) last.commits.push(c)
    else out.push({ name: c.day, commits: [c] })
  }
  return out
})

const aheadEl = ref<HTMLElement>()
const behindEl = ref<HTMLElement>()
const tips = () => {
  if (aheadEl.value)
    setTooltip(aheadEl.value, `${plural(props.copy?.ahead ?? 0, 'commit')} ahead of ${props.base}`)
  if (behindEl.value)
    setTooltip(behindEl.value, `${plural(props.copy?.behind ?? 0, 'commit')} behind ${props.base}`)
}
onMounted(tips)
watch(() => [props.copy, props.open], tips, { flush: 'post' })
</script>

<style lang="scss">
.abele-history {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-4);
  min-width: 0;
}
.abele-history__branch {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-small);

  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-history__branch-name {
  color: var(--text-normal);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
.abele-history__drift {
  display: flex;
  gap: var(--size-4-2);
}
.abele-history__count {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-1);
  font-variant-numeric: tabular-nums;
}
.abele-history__day {
  display: flex;
  flex-direction: column;
}
// A day as Obsidian's small section headings are: muted, small, semibold.
.abele-history__day-name {
  margin: 0 0 var(--size-4-1);
  padding-inline: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-semibold);
}
.abele-history__row {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-3);
  padding: var(--size-4-1) var(--size-4-2);
  border-radius: var(--radius-s);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  cursor: var(--cursor);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}
body.is-phone .abele-history__row {
  flex-wrap: wrap;
  row-gap: 0;
  min-height: var(--touch-size-m);
  align-content: center;
}
.abele-history__row-subject {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-history__row-meta {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-history__hash {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
body.is-phone .abele-history__row .abele-history__hash {
  display: none;
}
body.is-phone .abele-history__row-subject {
  flex-basis: 100%;
}
.abele-history__more {
  display: flex;
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
