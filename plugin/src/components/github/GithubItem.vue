<template>
  <GithubLayout :panel="panelShown" @dismiss="setPanel(false)">
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
      <EmptyState v-if="!enabled">
        The GitHub integration is off. Turn it on in Abele settings → GitHub.
      </EmptyState>

      <div v-else-if="!target" class="abele-github__fallback">
        <EmptyState text="This is not a GitHub link a tab here can show." />
        <Button
          v-if="model.url"
          text="Open in browser"
          icon="external-link"
          tooltip="Open the link in the browser instead"
          @click="openInBrowser(model.url)"
        />
      </div>

      <template v-else>
        <Button
          v-if="accountName"
          class="abele-github__account"
          :text="accountName"
          icon="user-round"
          tooltip="Open as another GitHub account"
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
          @tree="setPanel(!panelOpen)"
          @swap="swapSides"
          @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
          @refresh="reload(true)"
          @browser="openInBrowser(browserUrl)"
          @chat="chatAbout"
          @find="showFind"
          @search="tabSearch.openSearch"
        >
          <template v-if="source?.identity.provider === 'node'" #controls>
            <slot
              name="repository-controls"
              :file="blob"
              :version="(main.data.value as { ref?: string } | null)?.ref"
            >
              <span>{{ target.repo }}</span>
            </slot>
          </template>
          <template #file-actions>
            <div v-if="shown.kind === 'blob' && blob" ref="blobToolbar" />
          </template>
        </GithubHeader>

        <slot name="repository-details" :file="blob" />
        <GithubBaseBar
          v-if="
            source?.identity.provider !== 'node' &&
            repoRef &&
            ['blob', 'tree', 'repo'].includes(shown.kind)
          "
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
              ? (main.data.value as { url?: string } | null)?.url
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
          >Current disk version unavailable · your local draft is kept. {{ main.error.value }}</span
        >
        <div
          v-if="main.error.value && !(liveEditableFile && documentModel?.draft.value)"
          class="abele-github__error"
        >
          <EmptyState :text="main.error.value" />
          <Button
            text="Try again"
            icon="refresh-cw"
            tooltip="Ask GitHub again"
            @click="reload(true)"
          />
        </div>
        <EmptyState
          v-else-if="!main.data.value"
          :text="
            source?.identity.provider === 'node' ? 'Loading from the node…' : 'Loading from GitHub…'
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
            :problem="issue.commentsProblem"
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
            :problem="pull.commentsProblem"
            :retrying="conversationRetrying"
            @retry="retryConversation"
          />
          <template v-else-if="pullTab === 'files'">
            <div v-if="files.error.value" class="abele-github__error">
              <EmptyState :text="files.error.value" />
              <Button
                text="Try again"
                icon="refresh-cw"
                tooltip="Ask GitHub again"
                @click="files.load"
              />
            </div>
            <EmptyState v-else-if="!files.data.value" text="Loading the changed files…" />
            <template v-else>
              <GithubNotice
                v-if="files.data.value.reviewCommentsProblem"
                :text="files.data.value.reviewCommentsProblem"
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
              <EmptyState :text="commits.error.value" />
              <Button
                text="Try again"
                icon="refresh-cw"
                tooltip="Ask GitHub again"
                @click="commits.load"
              />
            </div>
            <EmptyState v-else-if="!commits.data.value" text="Loading the commits…" />
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
          <EmptyState v-if="blob.note" :text="blob.note" />
          <Button
            v-if="blob.canLoadLarge && source?.largeBlob"
            text="Load larger file"
            tooltip="Load this retained version up to the larger file limit"
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
            :document-note="blob.note"
            :range="blobRange"
            :plain="blobPlain"
            :mode="model.mode"
            :toolbar-host="blobToolbar"
            :client="client()"
            @mode="setMode"
            :refresh="() => reload(true)"
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

        <GithubProseActions v-if="root && main.data.value" :root="root" />
      </template>
    </div>
  </GithubLayout>
</template>

<script setup lang="ts">
import EmptyState from '../obsidian/EmptyState.vue'
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
</script>

<style lang="scss" src="./githubItem.scss"></style>
