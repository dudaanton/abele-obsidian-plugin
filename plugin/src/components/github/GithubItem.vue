<template>
  <!-- A node's files are in its own side panel: the tab has no tree beside it. -->
  <GithubLayout
    :panel="panelShown && source?.identity.provider !== 'node'"
    @dismiss="setPanel(false)"
  >
    <template #panel>
      <GithubTreePanel
        :repo="repoRef!"
        :client="client()"
        :version-key="versionKey"
        :resolve="resolveVersion"
        :current="current"
        :comparison="blob?.comparison?.index"
        :base-sha="projectPin?.baseSha"
        :retry-counts="countRetry"
        @open="openFromPanel"
        @close="setPanel(false)"
      />
    </template>
    <div
      ref="root"
      class="abele-github"
      :class="{ 'abele-github_node': source?.identity.provider === 'node' }"
    >
      <DrawerViewSwitch
        v-if="!enabled || !target"
        icon="github"
        :name="t('streamB.github.f911e4')"
      />
      <EmptyState
        v-if="!enabled"
        icon="github"
        badge="power-off"
        :title="t('streamB.githubIsOff.f16b79')"
        :text="t('streamB.turnItOnToSeeIssuesPull.ee04f8')"
      >
        <template #action>
          <Button
            :text="t('streamB.openGithubSettings.a40b53')"
            :tooltip="t('streamB.turnGithubOnInTheSettings.5f00a5')"
            @click="openGithubSettings"
          />
        </template>
      </EmptyState>

      <div v-else-if="!target" class="abele-github__fallback">
        <EmptyState :text="t('streamB.thisIsNotAGithubLinkA.42c627')" />
        <Button
          v-if="model.url"
          :text="t('streamB.openInBrowser.62a2dc')"
          icon="external-link"
          :tooltip="t('streamB.openTheLinkInTheBrowserInstead.4a1897')"
          @click="openInBrowser(model.url)"
        />
      </div>

      <template v-else>
        <Button
          v-if="accountName"
          class="abele-github__account"
          :text="accountName"
          icon="user-round"
          :tooltip="t('streamB.openAsAnotherAccount.4e5a6d')"
          @click="onChooseAccount?.()"
        />
        <GithubFindBar
          v-if="tabSearch.findOpen.value && root"
          ref="findBar"
          :root="root"
          :hooks="tabSearch.finderHooks"
          @close="tabSearch.findOpen.value = false"
        />
        <GithubHeader
          :repo="`${target.owner}/${target.repo}`"
          :title="head.title"
          :number="head.number"
          :url="browserUrl"
          :state="head.state"
          :labels="head.labels"
          :meta="head.meta"
          :loading="main.loading.value"
          :chat="source?.identity.provider !== 'node' && !!model.screen.link && linker.canAsk()"
          :crumbs="crumbs"
          :ref-label="crumbRef"
          :tree="panelOpen"
          :swap="!!compared && source?.identity.provider !== 'node'"
          :compare="canPinBase && !pin"
          @tree="setPanel(!panelOpen)"
          @compare="baseBar?.choose()"
          @swap="swapSides"
          @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
          @refresh="reload(true)"
          @browser="openInBrowser(browserUrl)"
          @chat="chatAbout"
          @find="showFind"
          @search="tabSearch.openSearch"
        >
          <template v-if="source?.identity.provider === 'node'" #controls>
            <slot name="repository-controls" :file="blob" :version="nodeContentVersion">
              <span>{{ target.repo }}</span>
            </slot>
          </template>
          <template #actions>
            <span
              v-if="shown.kind === 'blob' && blob"
              ref="blobGlyphs"
              class="abele-github-header__page-glyphs"
            />
          </template>
          <template #file-actions>
            <div v-if="shown.kind === 'blob' && blob" ref="blobToolbar" />
          </template>
        </GithubHeader>

        <slot name="repository-details" :file="blob" />
        <GithubBaseBar
          v-if="canPinBase"
          ref="baseBar"
          :repo="repoRef"
          :client="client()"
          :pin="pin"
          :target-sha="blob?.comparison?.targetSha"
          :file="shown.kind === 'blob'"
          :original="model.originalFile"
          @original="setOriginal"
        />
        <EmptyState v-if="model.connectionNotice" :text="model.connectionNotice" />

        <!-- Kept while the tab follows a result, so the next result is still there to take. -->
        <GithubCodeSearch
          v-if="tabSearch.searchOpen.value"
          :code="tabSearch.code"
          :ready="!!main.data.value"
          :revision-key="
            source?.identity.provider === 'node' &&
            sourceLocation &&
            'ref' in sourceLocation &&
            sourceLocation.ref === 'Working tree'
              ? nodeContentUrl
              : undefined
          "
          :has-changes="tabSearch.hasChanges.value"
          :request="tabSearch.searchRequest.value"
          @open="(url: string, newTab: boolean) => props.onOpen?.(url, newTab ? 'tab' : false)"
          @close="tabSearch.searchOpen.value = false"
        />

        <span
          v-if="main.error.value && liveEditableFile && documentModel?.draft.value"
          role="status"
          >{{ t('streamBMeta.70c9a87a0b', { p0: String(main.error.value) }) }}</span
        >
        <div
          v-if="main.error.value && !(liveEditableFile && documentModel?.draft.value)"
          class="abele-github__error"
        >
          <GithubNotice :text="main.error.value" @retry="reload(true)" />
        </div>
        <EmptyState
          v-else-if="!main.data.value"
          :text="
            source?.identity.provider === 'node'
              ? t('streamB.loadingFromTheNode.a6287a')
              : isNativeForge(source?.identity.provider)
                ? t('streamB.reapply.2b976bb443', {
                    service: nativeLabel(source?.identity.provider),
                  })
                : t('streamB.loadingFromGithub.20d317')
          "
        />

        <template v-else-if="shown.kind === 'issue' && issue">
          <GithubThread
            :author="issue.author"
            :avatar="issue.authorAvatar"
            :created-at="issue.createdAt"
            :body="issue.body"
            :comments="issue.comments"
            :anchor="anchor"
            :incomplete="!issue.commentsComplete"
            :problem="presentUiField(issue, 'commentsProblem')"
            :retrying="conversationRetrying"
            @retry="retryConversation"
          />
        </template>

        <template v-else-if="shown.kind === 'discussion' && discussion">
          <GithubThread
            :author="discussion.author"
            :avatar="discussion.authorAvatar"
            :created-at="discussion.createdAt"
            :body="discussion.body"
            :comments="discussion.comments"
            :anchor="anchor"
            :missing="discussion.totalComments - discussion.comments.length"
          />
        </template>

        <template v-else-if="shown.kind === 'pull' && pull">
          <Tabs v-model="pullTab" :tabs="pullTabs" level="secondary" class="abele-github__tabs" />
          <GithubThread
            v-if="pullTab === 'conversation'"
            :author="pull.author"
            :avatar="pull.authorAvatar"
            :created-at="pull.createdAt"
            :body="pull.body"
            :comments="pull.comments"
            :anchor="anchor"
            :incomplete="!pull.commentsComplete"
            :problem="presentUiField(pull, 'commentsProblem')"
            :retrying="conversationRetrying"
            @retry="retryConversation"
          />
          <template v-else-if="pullTab === 'files'">
            <div v-if="files.error.value" class="abele-github__error">
              <GithubNotice :text="files.error.value" @retry="files.load" />
            </div>
            <EmptyState
              v-else-if="!files.data.value"
              :text="t('streamB.loadingTheChangedFiles.fe355d')"
            />
            <template v-else>
              <GithubNotice
                v-if="presentUiField(files.data.value, 'reviewCommentsProblem')"
                :text="presentUiField(files.data.value, 'reviewCommentsProblem')"
                :busy="files.loading.value"
                @retry="files.load"
              />
              <GithubFiles
                :files="files.data.value.files"
                :complete="files.data.value.complete"
                :anchor="fileAnchor"
                :comment-anchor="anchor"
                :refs="{ head: pull.headSha, base: pull.baseSha }"
                @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
              />
            </template>
          </template>
          <template v-else>
            <div v-if="commits.error.value" class="abele-github__error">
              <GithubNotice :text="commits.error.value" @retry="commits.load" />
            </div>
            <EmptyState
              v-else-if="!commits.data.value"
              :text="t('streamB.loadingTheCommits.71b89c')"
            />
            <GithubCommits v-else :commits="commits.data.value" @open="openCommit" />
          </template>
        </template>

        <template v-else-if="shown.kind === 'commit' && commit">
          <pre
            v-if="source?.identity.provider === 'node' && splitMessage(commit.message).body"
            class="abele-github__message"
            >{{ splitMessage(commit.message).body }}</pre
          >
          <GithubText
            v-else-if="splitMessage(commit.message).body && repo"
            class="abele-github__message"
            :text="splitMessage(commit.message).body"
            :repo="repo"
            as-document
          />
          <GithubFiles
            :files="commit.files"
            :anchor="fileAnchor"
            :refs="{ head: commit.sha, base: commit.parentSha }"
            @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
          />
        </template>

        <GithubCompare
          v-else-if="shown.kind === 'compare' && compared"
          :data="compared"
          :repo="shown"
          :tab="compareTab"
          :anchor="fileAnchor"
          @tab="(tab: CompareSection) => (compareTab = tab)"
          @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
        />

        <template v-else-if="shown.kind === 'blob' && blob">
          <EmptyState v-if="presentUiField(blob, 'note')" :text="presentUiField(blob, 'note')" />
          <Button
            v-if="blob.canLoadLarge && source?.largeBlob"
            :text="t('streamB.loadLargerFile.3df8d3')"
            :tooltip="t('streamB.loadThisRetainedVersionUpToThe.be4ae8')"
            icon="file-text"
            :disabled="largeBusy"
            @click="loadLarge"
          />
          <GithubPinnedFile
            v-if="blob.comparison"
            :file="blob.comparison"
            :repo="repoRef!"
            :range="blobRange"
            :nonce="model.nonce"
            :busy="largeBusy"
            @large="loadLarge"
            @open="(url: string) => onOpen?.(url, false)"
          />
          <GithubBlob
            v-else-if="!blob.note || (liveEditableFile && documentModel?.draft.value)"
            :text="blob.text"
            :file="blobFile!"
            :editor="liveEditableFile ? documentModel : undefined"
            :writable="editingAllowed"
            :offline="nodeOffline"
            :content-id="blob.contentId"
            :document-note="presentUiField(blob, 'note')"
            :range="blobRange"
            :plain="blobPlain"
            :mode="model.mode"
            :toolbar-host="blobToolbar"
            :glyph-host="blobGlyphs"
            :client="client()"
            :refresh="() => reload(true)"
            @mode="setMode"
            @open="(url: string) => onOpen?.(url)"
          />
        </template>

        <GithubRepoHome
          v-else-if="shown.kind === 'repo' && home"
          :home="home"
          :browse-ref="browseRef"
          :repo="repoRef!"
          :client="client()"
          @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
          @tree="setPanel(true)"
        />

        <GithubList
          v-else-if="shown.kind === 'list' && list"
          :target="shown"
          :data="list"
          :client="client()"
          @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
        />

        <template v-else-if="shown.kind === 'tree' && folder">
          <GithubFolder
            :folder="folder"
            :browse-ref="browseRef"
            :repo="repoRef!"
            :client="client()"
            @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
          />
        </template>

        <NativeActions
          v-if="
            source?.github?.writes &&
            !model.allowedConnections &&
            ((shown.kind === 'issue' && issue) ||
              (shown.kind === 'pull' && pull && pullTab === 'conversation'))
          "
          :key="`${source.cacheNamespace}:${shown.kind}:${head.number}`"
          :writer="source.github.writes"
          :number="shown.kind === 'issue' ? issue!.number : pull!.number"
          :head="pull?.headSha"
          :open="(issue || pull)?.state === 'open'"
          :pull="shown.kind === 'pull'"
          @refresh="reload(true)"
        />
        <GithubProseActions v-if="root && main.data.value" :root="root" />
      </template>
    </div>
  </GithubLayout>
</template>

<script setup lang="ts">
import { presentUiField } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import DrawerViewSwitch from '@/components/obsidian/DrawerViewSwitch.vue'
import { isNativeForge, nativeLabel } from '@/forge/native'
import { computed, ref } from 'vue'
import EmptyState from '../obsidian/EmptyState.vue'
import { openAbeleSettings } from '@/components/settings/settingsTab'
import { GlobalStore } from '@/stores/GlobalStore'
import Button from '../obsidian/Button.vue'
import Tabs from '../obsidian/Tabs.vue'
import GithubText from './GithubText.vue'
import GithubHeader from './GithubHeader.vue'
import GithubCommits from './GithubCommits.vue'
import GithubCompare, { type CompareSection } from './GithubCompare.vue'
import GithubThread from './GithubThread.vue'
import GithubFiles from './GithubFiles.vue'
import GithubBlob from './GithubBlob.vue'
import GithubPinnedFile from './GithubPinnedFile.vue'
import GithubBaseBar from './GithubBaseBar.vue'
import GithubNotice from './GithubNotice.vue'
import GithubFindBar from './GithubFindBar.vue'
import GithubCodeSearch from './GithubCodeSearch.vue'
import GithubFolder from './GithubFolder.vue'
import GithubRepoHome from './GithubRepoHome.vue'
import GithubList from './GithubList.vue'
import GithubProseActions from './GithubProseActions.vue'
import NativeActions from './NativeActions.vue'
import GithubTreePanel from './GithubTreePanel.vue'
import GithubLayout from './GithubLayout.vue'
import type { PaneType } from 'obsidian'
import { splitMessage } from '@/github/format'
import type { GithubItemProps } from '@/github/item/types'
import { useGithubItem } from '@/github/item/useGithubItem'

const props = defineProps<GithubItemProps>()
const {
  root,
  blobToolbar,
  liveEditableFile,
  browseRef,
  target,
  pin,
  setOriginal,
  shown,
  projectPin,
  client,
  source,
  main,
  files,
  commits,
  panelOpen,
  panelShown,
  setPanel,
  repoRef,
  versionKey,
  resolveVersion,
  current,
  crumbs,
  crumbRef,
  openFromPanel,
  findBar,
  tabSearch,
  showFind,
  issue,
  pull,
  discussion,
  commit,
  blob,
  largeBusy,
  countRetry,
  loadLarge,
  folder,
  home,
  list,
  compared,
  anchor,
  fileAnchor,
  blobRange,
  blobPlain,
  blobFile,
  setMode,
  pullTab,
  compareTab,
  pullTabs,
  conversationRetrying,
  retryConversation,
  browserUrl,
  head,
  linker,
  repo,
  chatAbout,
  openInBrowser,
  swapSides,
  openCommit,
  reload,
} = useGithubItem(props)

const nodeContentVersion = computed(() => {
  const data = main.data.value
  return data && 'ref' in data ? data.ref : undefined
})
const nodeContentUrl = computed(() => {
  const data = main.data.value
  return data && 'url' in data ? data.url : undefined
})

/** Remote repository files, folders and home can be compared against a pinned version. */
const canPinBase = computed(
  () =>
    ['github', 'forgejo', 'gitea'].includes(source.value?.identity.provider) &&
    !!repoRef.value &&
    ['blob', 'tree', 'repo'].includes(shown.value.kind)
)
const baseBar = ref<InstanceType<typeof GithubBaseBar> | null>(null)
/** Where a file puts its own glyphs: the header's row, before the tab's. */
const blobGlyphs = ref<HTMLElement | null>(null)

const openGithubSettings = () => openAbeleSettings(GlobalStore.getInstance().app, 'github')
</script>

<style lang="scss" src="./githubItem.scss"></style>
