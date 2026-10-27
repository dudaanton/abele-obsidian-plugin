<template>
  <div class="abele-github-compare">
    <div v-if="source?.identity.provider === 'node'" class="abele-github-compare__choices">
      <Icon
        class="clickable-icon"
        role="button"
        tabindex="0"
        icon="git-branch"
        :tooltip="t('streamB.chooseAVersionToCompareWith.0ba68b')"
        @click="chooseBase"
        @keydown.enter.prevent="chooseBase"
      />
      <Icon
        v-if="data.head.startsWith('working-')"
        class="clickable-icon"
        role="button"
        tabindex="0"
        icon="list-filter"
        :text-right="modes.find((mode) => mode.value === (data.mode || 'endpoint'))?.display"
        :tooltip="t('streamB.chooseChangesToReview.b4e34d')"
        @click="chooseMode"
        @keydown.enter.prevent="chooseMode"
      />
    </div>
    <GithubNotice
      v-if="presentUiField(data, 'note')"
      :text="presentUiField(data, 'note')"
      :retry="false"
    />
    <EmptyState
      v-if="data.status === 'identical'"
      :text="t('streamB.theseTwoAreTheSameThereIs.b24ad1')"
    />
    <template v-else>
      <Tabs
        :model-value="tab"
        :tabs="tabs"
        level="secondary"
        class="abele-github__tabs"
        @update:model-value="(id: string) => emit('tab', id as CompareSection)"
      />
      <template v-if="tab === 'files'">
        <GithubFiles
          v-if="data.files.length || data.filesComplete"
          :files="data.files"
          :complete="data.filesComplete"
          :anchor="anchor"
          :analysis-ref="data.headSha"
          :refs="
            data.mode === 'staged' || data.mode === 'unstaged'
              ? undefined
              : { head: data.headSha, base: data.mergeBaseSha }
          "
          @open="(url: string, pane: PaneType | false) => emit('open', url, pane)"
        />
      </template>
      <template v-else>
        <EmptyState
          v-if="!data.commits.length"
          :text="
            t('streamB.hasNoCommitsThatHasNot.945f58', {
              v0: String(data.head),
              v1: String(data.base),
            })
          "
        />
        <GithubCommits v-else :commits="data.commits" @open="openCommit" />
        <div v-if="!data.commitsComplete" class="abele-github-compare__more">
          <template v-if="source?.identity.provider === 'node'">{{
            t('streamB.theCommitListIsABoundedWindow.593273')
          }}</template>
          <template v-else>{{
            t('streamBMeta.03e06e2d54', {
              p0: String(data.commits.length),
              p1: String(data.totalCommits),
            })
          }}</template>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { presentUiField } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import { computed } from 'vue'
import { Menu, type PaneType } from 'obsidian'
import EmptyState from '../obsidian/EmptyState.vue'
import Tabs from '../obsidian/Tabs.vue'
import Icon from '../obsidian/Icon.vue'
import { RefPicker } from '@/github/repoPage/RefPicker'
import { GlobalStore } from '@/stores/GlobalStore'
import type { RepositoryComparisonMode } from '@/repository/source'
import GithubFiles from './GithubFiles.vue'
import GithubCommits from './GithubCommits.vue'
import GithubNotice from './GithubNotice.vue'
import type { CompareData } from '@/repository/model'
import type { DiffFileAnchor } from '@/github/urls'
import { useRepositorySource } from '@/repository/context'
import { repoWeb } from '@/github/origin'

import type { CompareSection } from '@/github/compareSection'
export type { CompareSection } from '@/github/compareSection'

/** A comparison's body under its header: what it could not show, then its files or commits. */
const props = defineProps<{
  data: CompareData
  repo: { host: string; owner: string; repo: string }
  tab: CompareSection
  anchor?: DiffFileAnchor
}>()

const emit = defineEmits<{
  tab: [tab: CompareSection]
  open: [url: string, pane: PaneType | false]
}>()

const tabs = computed(() => [
  {
    id: 'files',
    label: t('streamB.files.f92746', {
      v0: String(props.data.files.length),
      v1: String(props.data.filesComplete ? '' : '+'),
    }),
    icon: 'file-diff',
  },
  {
    id: 'commits',
    label: t('streamB.commits.48c0fb', { v0: String(props.data.totalCommits) }),
    icon: 'git-commit-horizontal',
  },
])

const source = useRepositorySource()
const modes = [
  { value: 'endpoint', display: t('streamB.allChanges.a0a8c3') },
  { value: 'staged', display: t('streamB.readyForCommit.a9d967') },
  { value: 'unstaged', display: t('streamB.otherEdits.62210d') },
  { value: 'merge-base', display: t('streamB.fromCommonAncestor.886311') },
]
const chooseMode = (event?: MouseEvent | KeyboardEvent) => {
  const menu = new Menu()
  for (const mode of modes)
    menu.addItem((item) =>
      item
        .setTitle(mode.display)
        .setChecked(mode.value === (props.data.mode || 'endpoint'))
        .onClick(() => {
          source.value!.assertCurrent()
          emit(
            'open',
            source.value!.navigation.comparison(
              props.data.base,
              props.data.head,
              mode.value !== 'merge-base',
              mode.value as RepositoryComparisonMode,
              props.data.baseName
            ),
            false
          )
        })
    )
  const rect = (event?.currentTarget as HTMLElement | null)?.getBoundingClientRect()
  menu.showAtPosition({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 })
}
const chooseBase = () =>
  new RefPicker(
    GlobalStore.getInstance().app,
    source.value!,
    props.repo,
    props.data.base,
    '',
    (ref) => emit('open', source.value!.navigation.comparison(ref, props.data.head, true), false)
  ).open()
const openCommit = (sha: string) =>
  emit(
    'open',
    source.value?.navigation.commit(sha) ?? `${repoWeb(props.repo)}/commit/${sha}`,
    false
  )
</script>

<style lang="scss">
.abele-github-compare {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);

  &__choices {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-4-2);
  }

  &__more {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
}
</style>
