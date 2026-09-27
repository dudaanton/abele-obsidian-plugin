<template>
  <div class="abele-github-home">
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
      <div v-if="meta.topics.length" class="abele-github-home__topics">
        <Badge v-for="topic in meta.topics" :key="topic" :text="topic" color="blue" />
      </div>
      <div class="abele-github-home__stats">
        <Icon icon="star" no-hover :text-right="`${formatCount(meta.stars)} stars`" />
        <Icon icon="git-fork" no-hover :text-right="`${formatCount(meta.forks)} forks`" />
        <Icon icon="eye" no-hover :text-right="`${formatCount(meta.watchers)} watching`" />
        <Icon v-if="meta.license" icon="scale" no-hover :text-right="meta.license" />
        <Icon icon="git-branch" no-hover :text-right="`default ${meta.defaultBranch}`" />
      </div>
    </div>

    <div class="abele-github-home__bar">
      <Button
        class="abele-github-home__ref"
        icon="git-branch"
        :text="shortRef(home.ref)"
        tooltip="Switch to another branch or tag: the files and the README follow"
        @click="switchRef"
      />
      <Button
        v-if="home.ref !== meta.defaultBranch"
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

    <div class="abele-github-home__columns">
      <div class="abele-github-home__side">
        <GithubRepoList
          v-if="release.data.value || release.error.value"
          list="release"
          title="Latest release"
          :rows="releaseRows"
          :error="release.error.value"
          empty=""
          :all-url="`${web}/releases`"
          all-tooltip="Open every release on GitHub in the browser"
          all-external
          @retry="release.load"
        />
        <GithubRepoList
          list="pulls"
          title="Open pull requests"
          :rows="pullRows"
          :error="pulls.error.value"
          empty="No open pull requests."
          :all-url="`${web}/pulls`"
          all-tooltip="Every pull request, with filters, in a tab"
          @open="open"
          @retry="pulls.load"
        />
        <GithubRepoList
          v-if="meta.hasIssues"
          list="issues"
          title="Open issues"
          :rows="issueRows"
          :error="issues.error.value"
          empty="No open issues."
          :all-url="`${web}/issues`"
          all-tooltip="Every issue, with filters, in a tab"
          @open="open"
          @retry="issues.load"
        />
        <section v-if="languages.data.value?.length" class="abele-github-home__langs">
          <FoldHeading text="Languages" />
          <div class="abele-github-home__lang-bar" aria-hidden="true">
            <span
              v-for="(lang, i) in languages.data.value"
              :key="lang.name"
              class="abele-github-home__lang-part"
              :class="`abele-github-home__lang_${i % 8}`"
              :style="{ flexGrow: lang.percent }"
            />
          </div>
          <ul class="abele-github-home__lang-list">
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
import EmptyState from '../obsidian/EmptyState.vue'
import FoldHeading from '../obsidian/FoldHeading.vue'
import GithubFolder from './GithubFolder.vue'
import GithubRepoList, { type ListRow } from './GithubRepoList.vue'
import type { GithubClient } from '@/github/client'
import { useLoad } from '@/github/useLoad'
import { repoWeb } from '@/github/origin'
import { formatDate } from '@/github/format'
import { shortRef } from '@/github/itemHead'
import { GlobalStore } from '@/stores/GlobalStore'
import { RefPicker } from '@/github/repoPage/RefPicker'
import {
  formatCount,
  homeUrl as homeUrlOf,
  loadLanguages,
  loadLatestRelease,
  loadOpenIssues,
  loadOpenPulls,
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
  client: GithubClient
}>()

const emit = defineEmits<{
  (e: 'open', url: string, pane: PaneType | false): void
  /** Show the file tree panel. */
  (e: 'tree'): void
}>()

const meta = computed(() => props.home.meta)
const web = computed(() => repoWeb(props.repo))
const homeUrl = (r: RepoLike, ref: string | undefined) =>
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

const languages = useLoad(() => loadLanguages(props.client, props.repo))
const pulls = useLoad(() => loadOpenPulls(props.client, props.repo))
const issues = useLoad(() => loadOpenIssues(props.client, props.repo))
const release = useLoad(() => loadLatestRelease(props.client, props.repo))

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
    props.client,
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
