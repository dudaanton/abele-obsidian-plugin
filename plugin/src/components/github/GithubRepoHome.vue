<template>
  <div class="abele-github-home" :class="{ 'abele-github-home_node': home.node }">
    <div class="abele-github-home__about">
      <p v-if="meta.description" class="abele-github-home__description">
        {{ meta.description }}
      </p>
      <a
        v-if="homepage"
        class="abele-github-home__homepage external-link"
        :href="homepage"
        target="_blank"
        rel="noopener"
        >{{ homepageLabel }}</a
      >
      <div v-if="source?.github && meta.topics.length" class="abele-github-home__topics">
        <Badge v-for="topic in meta.topics" :key="topic" :text="topic" color="blue" />
      </div>
      <div v-if="source?.github" class="abele-github-home__stats">
        <Icon icon="star" no-hover :text-right="`${formatCount(meta.stars)} stars`" />
        <Icon icon="git-fork" no-hover :text-right="`${formatCount(meta.forks)} forks`" />
        <Icon icon="eye" no-hover :text-right="`${formatCount(meta.watchers)} watching`" />
        <Icon v-if="meta.license" icon="scale" no-hover :text-right="meta.license" />
        <Icon icon="git-branch" no-hover :text-right="`default ${meta.defaultBranch}`" />
      </div>
    </div>

    <div v-if="!home.node" class="abele-github-home__bar">
      <Button
        class="abele-github-home__ref"
        icon="git-branch"
        :text="shortRef(nodeRevisionLabel(home.ref))"
        tooltip="Switch to another branch or tag: the files and the README follow"
        @click="switchRef"
      />
      <Button
        v-if="meta.defaultBranch && home.ref !== meta.defaultBranch"
        icon="undo-2"
        :text="meta.defaultBranch"
        tooltip="Back to the default branch"
        @click="emit('open', homeUrl(repo, undefined), false)"
      />
      <Button
        class="abele-github-home__files"
        icon="folder-tree"
        text="Files"
        tooltip="Show the repository's file tree beside the page"
        @click="emit('tree')"
      />
    </div>

    <template v-if="home.node">
      <section class="abele-github-home__workspaces" aria-label="Workspaces">
        <FoldHeading text="Workspaces" />
        <RepositoryRow
          v-for="workspace in home.node.workspaces"
          :key="workspace.id"
          :title="workspace.label"
          :meta="workspaceMeta(workspace)"
          kind="workspace"
          :icon="workspace.kind === 'external' ? 'folder-git-2' : 'folder'"
          :active="
            source?.identity.provider === 'node' && workspace.id === source.identity.workspace
          "
          :plain="workspace.availability !== 'available'"
          :status="
            workspace.dirty === true
              ? 'Changes'
              : workspace.dirty === false
                ? 'Clean'
                : 'Not checked'
          "
          @pick="emit('open', source!.navigation.workspace!(workspace.id), false)"
        />
      </section>
      <section aria-label="Uncommitted changes">
        <div class="abele-github-home__section-head">
          <FoldHeading text="Uncommitted changes" />
          <Icon
            v-if="
              home.node.status.revision?.kind === 'working-tree' && home.node.status.revision.head
            "
            class="clickable-icon"
            role="button"
            tabindex="0"
            tooltip="Review uncommitted changes"
            icon="file-diff"
            @click="
              emit(
                'open',
                source!.navigation.comparison(home.node.status.revision.head, 'Working tree', true),
                false
              )
            "
          />
        </div>
        <EmptyState v-if="!home.node.status.files.length" text="No local changes." />
        <RepositoryRow
          v-for="file in home.node.status.files"
          :key="file.path"
          :title="file.path.split('/').pop()!"
          :meta="file.path.includes('/') ? file.path : undefined"
          icon="file-diff"
          kind="change"
          :status="changeLabel(file)"
          :plain="file.status === 'deleted'"
          @pick="emit('open', source!.navigation.file('Working tree', file.path), false)"
        />
      </section>
      <section aria-label="Recent commits">
        <FoldHeading text="Recent commits" />
        <EmptyState v-if="!home.node.commits.length" text="No commits yet." />
        <RepositoryRow
          v-for="commit in home.node.commits.slice(0, 10)"
          :key="commit.sha"
          :title="commit.message.split('\n')[0]"
          :meta="`${commit.author} · ${formatDate(commit.date)}`"
          icon="git-commit-horizontal"
          kind="commit"
          :status="commit.sha.slice(0, 7)"
          @pick="emit('open', source!.navigation.commit(commit.sha), false)"
        />
      </section>
    </template>

    <div class="abele-github-home__columns">
      <div class="abele-github-home__side">
        <GithubRepoList
          v-if="release.data.value || release.error.value"
          list="release"
          title="Latest release"
          :rows="releaseRows"
          :error="release.error.value"
          empty=""
          :all-url="source?.github?.listUrl('releases')"
          all-tooltip="Open every release on GitHub in the browser"
          all-external
          @retry="release.load"
        />
        <GithubRepoList
          v-if="source?.github"
          list="pulls"
          title="Open pull requests"
          :rows="pullRows"
          :error="pulls.error.value"
          empty="No open pull requests."
          :all-url="source?.github?.listUrl('pulls')"
          all-tooltip="Every pull request, with filters, in a tab"
          @open="open"
          @retry="pulls.load"
        />
        <GithubRepoList
          v-if="source?.github && meta.hasIssues"
          list="issues"
          title="Open issues"
          :rows="issueRows"
          :error="issues.error.value"
          empty="No open issues."
          :all-url="source?.github?.listUrl('issues')"
          all-tooltip="Every issue, with filters, in a tab"
          @open="open"
          @retry="issues.load"
        />
        <section
          v-if="languages.data.value?.length || languages.error.value"
          class="abele-github-home__langs"
          data-list="languages"
        >
          <FoldHeading text="Languages" />
          <div v-if="languages.error.value" class="abele-github-home__langs-error">
            <EmptyState :text="languages.error.value" />
            <Icon icon="refresh-cw" tooltip="Ask GitHub again" @click="languages.load" />
          </div>
          <div
            v-if="languages.data.value?.length"
            class="abele-github-home__lang-bar"
            aria-hidden="true"
          >
            <span
              v-for="(lang, i) in languages.data.value"
              :key="lang.name"
              class="abele-github-home__lang-part"
              :class="`abele-github-home__lang_${i % 8}`"
              :style="{ flexGrow: lang.percent }"
            />
          </div>
          <ul v-if="languages.data.value?.length" class="abele-github-home__lang-list">
            <li v-for="(lang, i) in languages.data.value" :key="lang.name">
              <span
                class="abele-github-home__lang-dot"
                :class="`abele-github-home__lang_${i % 8}`"
              />
              <span class="abele-github-home__lang-name">{{ lang.name }}</span>
              <span class="abele-github-home__lang-share">{{ lang.percent }}%</span>
            </li>
          </ul>
        </section>
      </div>

      <div class="abele-github-home__main">
        <EmptyState v-if="home.empty" text="This repository is empty: it has no files yet." />
        <GithubFolder
          v-else
          :folder="home"
          :repo="repo"
          :client="client"
          @open="(url: string, pane: PaneType | false) => emit('open', url, pane)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import type { PaneType } from 'obsidian'
import Badge from '../obsidian/Badge.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import RepositoryRow from '../repository/RepositoryRow.vue'
import { nodeRevisionLabel } from '@/repository/node'
import type { RepositoryWorkspace, RepositoryStatus } from '@/repository/source'
import EmptyState from '../obsidian/EmptyState.vue'
import FoldHeading from '../obsidian/FoldHeading.vue'
import GithubFolder from './GithubFolder.vue'
import GithubRepoList, { type ListRow } from './GithubRepoList.vue'
import type { GithubClient } from '@/github/client'
import { useRepositorySource } from '@/repository/context'

import { useLoad } from '@/github/useLoad'
import { formatDate } from '@/github/format'
import { shortRef } from '@/github/itemHead'
import { GlobalStore } from '@/stores/GlobalStore'
import { RefPicker } from '@/github/repoPage/RefPicker'
import {
  formatCount,
  homeUrl as homeUrlOf,
  type ItemRow,
  type RepoHomeData,
  type RepoLike,
} from '@/github/repoPage/repoHome'

/**
 * A repository's front page: what it says of itself, the ref shown and the way to another, the
 * freshest open pull requests and issues, the latest release and the languages beside its files
 * and README. The page arrives loaded; the lists beside it are asked for here, each on its own,
 * so a refusal of one leaves the others.
 */
const props = defineProps<{
  home: RepoHomeData
  repo: RepoLike
  client?: GithubClient
}>()

const emit = defineEmits<{
  (e: 'open', url: string, pane: PaneType | false): void
  /** Show the file tree panel. */
  (e: 'tree'): void
}>()

const source = useRepositorySource(
  () => props.client,
  () => props.repo
)
const meta = computed(() => props.home.meta)
const workspaceMeta = (w: RepositoryWorkspace) =>
  [
    w.kind === 'external'
      ? 'External · read only'
      : w.kind === 'managed'
        ? 'Workspace'
        : 'Project folder',
    w.branch?.replace(/^refs\/heads\//, '') || (w.head ? 'Detached' : 'No commits'),
    w.head?.slice(0, 7),
    w.availability !== 'available' ? w.availability : '',
    w.locked ? 'Locked' : '',
    w.prunable ? 'Prunable' : '',
  ]
    .filter(Boolean)
    .join(' · ')
const changeLabel = (file: RepositoryStatus['files'][number]) =>
  file.untracked
    ? 'New'
    : file.staged && file.unstaged
      ? 'Partly ready'
      : file.staged
        ? 'Ready'
        : file.status === 'deleted'
          ? 'Deleted'
          : 'Edited'
const homeUrl = (r: RepoLike, ref: string | undefined) =>
  source.value?.navigation.home(ref, meta.value.defaultBranch) ??
  homeUrlOf(r, ref, meta.value.defaultBranch)

/** Only a web address becomes a link; a homepage field holds whatever the owner typed. */
const homepage = computed(() => {
  const raw = meta.value.homepage
  if (!raw) return ''
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : ''
  } catch {
    return ''
  }
})
const homepageLabel = computed(() => homepage.value.replace(/^https?:\/\//, '').replace(/\/$/, ''))

const languages = useLoad(() => source.value?.github?.languages() ?? Promise.resolve([]))
const pulls = useLoad(() => source.value?.github?.pulls() ?? Promise.resolve([]))
const issues = useLoad(() => source.value?.github?.issues() ?? Promise.resolve([]))
const release = useLoad(() => source.value?.github?.release() ?? Promise.resolve(null))

// Asked again for another repository; the same one at another ref has the same lists.
watch(
  () => `${props.repo.host}/${props.repo.owner}/${props.repo.repo}`,
  () => {
    void languages.load()
    void pulls.load()
    if (meta.value.hasIssues) void issues.load()
    void release.load()
  },
  { immediate: true }
)

const itemRows = (items: ItemRow[] | null, kind: 'pull' | 'issue'): ListRow[] | null =>
  items?.map((i) => ({
    key: String(i.number),
    text: i.title,
    icon: kind === 'issue' ? 'circle-dot' : i.draft ? 'git-pull-request-draft' : 'git-pull-request',
    flair: `#${i.number}`,
    url: i.url,
  })) ?? null

const pullRows = computed(() => itemRows(pulls.data.value, 'pull'))
const issueRows = computed(() => itemRows(issues.data.value, 'issue'))
const releaseRows = computed<ListRow[] | null>(() => {
  const r = release.data.value
  if (!r) return null
  const when = r.publishedAt ? formatDate(r.publishedAt).split(',')[0] : ''
  return [
    {
      key: r.tag,
      text: r.name === r.tag ? r.name : `${r.name} (${r.tag})`,
      icon: 'tag',
      flair: [r.prerelease ? 'pre-release' : '', when].filter(Boolean).join(' · '),
      url: r.url,
      external: true,
    },
  ]
})

const open = (url: string, pane: PaneType | false) => emit('open', url, pane)

const switchRef = () => {
  new RefPicker(
    GlobalStore.getInstance().app,
    source.value,
    props.repo,
    props.home.ref,
    meta.value.defaultBranch,
    (ref) => emit('open', homeUrl(props.repo, ref), false)
  ).open()
}
</script>

<style lang="scss">
.abele-github-home {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-4);
  container-type: inline-size;

  &__section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--size-4-2);
  }

  &__workspace-meta {
    padding-inline-start: var(--size-4-6);
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    overflow-wrap: anywhere;
  }

  &__about {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
  }

  &__description {
    margin: 0;
    font-size: var(--font-ui-medium);
    overflow-wrap: anywhere;
  }

  &__homepage {
    overflow-wrap: anywhere;
    align-self: flex-start;
  }

  &__topics,
  &__stats,
  &__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-4-1) var(--size-4-3);
  }

  &__stats {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  &__bar {
    gap: var(--size-4-2);
  }

  // One column on a narrow pane — the lists first, then the files and the README; beside each
  // other once there is room for both.
  &__columns {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-6);
  }

  &__side,
  &__main {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-4);
    min-width: 0;
  }

  &__langs {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
  }

  &__langs-error {
    display: flex;
    align-items: flex-start;
    gap: var(--size-4-2);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  &__lang-bar {
    display: flex;
    gap: var(--size-2-1);
    height: var(--size-4-2);
    border-radius: var(--radius-s);
    overflow: hidden;
  }

  &__lang-part {
    flex-basis: 0;
    min-width: var(--size-2-1);
  }

  &__lang-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-4-1) var(--size-4-3);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--font-ui-small);

    li {
      display: flex;
      align-items: center;
      gap: var(--size-2-2);
    }
  }

  &__lang-dot {
    width: var(--size-4-2);
    height: var(--size-4-2);
    border-radius: 50%;
  }

  &__lang-share {
    color: var(--text-muted);
  }

  // A language's colour is one of Obsidian's named ones by its place in the list, so the bar
  // follows the theme; GitHub's own colours per language would be a palette of our own.
  @each $i, $name in (0: blue, 1: orange, 2: green, 3: purple, 4: yellow, 5: cyan, 6: pink, 7: red)
  {
    &__lang_#{$i} {
      background-color: var(--color-#{$name});
    }
  }
}

.abele-github-home_node .abele-github-folder__list {
  border: none;
  padding: 0;
  .tree-item-self {
    padding-inline-start: var(--size-4-6);
  }
  .tree-item-inner {
    color: var(--text-normal);
  }
}

body.is-phone .abele-github-home_node .clickable-icon {
  min-width: calc(var(--size-4-10) + var(--size-4-1));
  min-height: calc(var(--size-4-10) + var(--size-4-1));
}
body.is-phone .abele-github-home_node .tree-item-self {
  min-height: calc(var(--size-4-10) + var(--size-4-1));
}

@container (min-width: 760px) {
  .abele-github-home__columns {
    flex-direction: row-reverse;
    align-items: flex-start;
  }

  .abele-github-home__main {
    flex: 1 1 0;
  }

  .abele-github-home__side {
    flex: 0 0 30%;
  }
}
</style>
