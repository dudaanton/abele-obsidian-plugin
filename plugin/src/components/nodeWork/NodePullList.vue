<template>
  <!-- The folder's open pull requests, one row each: its state as a glyph, its number and title,
       the branch it brings, its checks as a dot. Pressing a row opens it in a tab. -->
  <div class="abele-node-pulls">
    <template v-if="pulls.length">
      <EntryRow
        v-for="p in pulls"
        :key="p.number"
        class="abele-node-pulls__row"
        :class="{ 'is-active': p.number === selected }"
        role="button"
        tabindex="0"
        @click="emit('open', p.number)"
        @keydown.enter.prevent="emit('open', p.number)"
      >
        <template #leading>
          <Icon
            :icon="p.state === 'draft' ? 'git-pull-request-draft' : 'git-pull-request'"
            size="xs"
            :interactive="false"
            :tooltip="p.state === 'draft' ? t('streamB.draft.ebf12e') : t('streamB.open.ed077f')"
          />
        </template>
        {{ p.title }}
        <template #codes>
          <span class="abele-node-pulls__number">{{ mark }}{{ p.number }}</span>
          <span class="abele-node-pulls__branch">{{ p.branch }}</span>
          <StatusDot
            v-if="p.checks && p.checks !== 'none'"
            :tone="p.checks === 'passing' ? 'green' : p.checks === 'failing' ? 'red' : 'orange'"
            :pulse="p.checks === 'pending'"
            :label="
              p.checks === 'passing'
                ? t('streamB.checksPassed.b63c39')
                : p.checks === 'failing'
                  ? t('streamB.aCheckFailed.97a7bb')
                  : t('streamB.checksAreRunning.052330')
            "
          />
          <Icon
            v-if="p.review === 'approved'"
            icon="check"
            size="xs"
            :interactive="false"
            :tooltip="t('streamB.approved.87b42e')"
          />
          <Icon
            v-else-if="p.review === 'changes'"
            icon="message-square-warning"
            size="xs"
            :interactive="false"
            :tooltip="t('streamB.changesWereAskedFor.a90f15')"
          />
        </template>
      </EntryRow>
    </template>
    <EmptyState v-else-if="!remote" :text="t('streamB.theNodeDoesNotSayWhichRemote.a707a6')" />
    <EmptyState
      v-else-if="!connected"
      :text="t('streamB.pullRequestsComeFromTheGitService.758966')"
    >
      <template #action>
        <Button :text="t('streamB.connectAGitService.a3f1cc')" @click="emit('connect')" />
      </template>
    </EmptyState>
    <EmptyState v-else :text="t('streamB.noOpenPullRequests.ad909a')" />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
/** The node panel's pull requests mode: the open ones of the folder, from its git service. */
import Icon from '../obsidian/Icon.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import EntryRow from '../obsidian/EntryRow.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import Button from '../obsidian/Button.vue'
import type { PullRequestSummary } from './types'

withDefaults(
  defineProps<{
    pulls: (PullRequestSummary & { branch: string })[]
    /** The git service is connected; without it there is nothing to read them from. */
    connected: boolean
    /** The node reported the folder's remote; without it no service can be asked. */
    remote?: boolean
    selected?: number
    /** What the service marks a number with: # on GitHub, ! on GitLab. */
    mark?: string
  }>(),
  { mark: '#', selected: undefined, remote: true }
)
const emit = defineEmits<{ open: [number]; connect: [] }>()
</script>

<style lang="scss">
.abele-node-pulls {
  display: flex;
  flex-direction: column;
  padding-inline: var(--size-4-2);
}

.abele-node-pulls__number {
  font-variant-numeric: tabular-nums;
}

.abele-node-pulls__branch {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-monospace);
}
</style>
