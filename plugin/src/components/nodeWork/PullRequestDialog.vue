<template>
  <div class="abele-pr-dialog">
    <div class="abele-pr-dialog__where">
      <Icon icon="git-pull-request-create" size="xs" :interactive="false" />
      <span
        ><b>{{ branch }}</b> {{ t('streamB.into.6b847a') }}
        <a
          class="abele-pr-dialog__base"
          role="button"
          tabindex="0"
          @click="emit('choose-base')"
          @keydown.enter.prevent="emit('choose-base')"
          >{{ base }}</a
        >
        · {{ plural(commits, 'commit') }} · {{ plural(files, 'file') }}</span
      >
    </div>
    <label class="abele-pr-dialog__field">
      <span class="setting-item-name">{{ t('streamB.title.7e8cd2') }}</span>
      <Input
        v-model="title"
        :aria-label="t('streamB.title.7e8cd2')"
        :placeholder="t('streamB.whatTheBranchDoes.dc5ac5')"
      />
    </label>
    <label class="abele-pr-dialog__field">
      <span class="setting-item-name">{{ t('streamB.description.526e00') }}</span>
      <textarea
        v-model="body"
        class="abele-pr-dialog__body"
        rows="6"
        :aria-label="t('streamB.description.526e00')"
        :placeholder="t('streamB.whyAndWhatToLookAt.04a840')"
      />
    </label>
    <Setting
      v-if="draftSupported"
      :name="t('streamB.draft.ebf12e')"
      :desc="t('streamB.notReadyForReviewYetItCan.4da700')"
    >
      <Checkbox
        :is-enabled="draft"
        :aria-label="t('streamB.openAsADraft.ee25cd')"
        @toggle="draft = !draft"
      />
    </Setting>
    <p v-else class="setting-item-description">
      {{ t('streamB.reapply.0aba8ff480') }}
    </p>
    <div class="modal-button-container">
      <Button
        :text="t('streamB.cancel.19766e')"
        :tooltip="t('streamB.closeWithoutOpeningAnything.d07e2a')"
        @click="emit('cancel')"
      />
      <Button
        :text="pushed ? t('streamB.create.475949') : t('streamB.pushAndCreate.64ee42')"
        accent
        :disabled="!title.trim()"
        :tooltip="
          pushed
            ? t('streamB.openThePullRequestOn.652a4b', { v0: String(host) })
            : t('streamB.pushFirstThenOpenThePullRequest.68d2ff', {
                v0: String(branch),
                v1: String(host),
              })
        "
        @click="emit('create', { title: title.trim(), body, draft })"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
// Opening a pull request for a worktree's branch: into which branch, a title and a description
// filled from its commits, as a draft or not. The branch is pushed first when it is not yet.
import { ref } from 'vue'
import Button from '../obsidian/Button.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Icon from '../obsidian/Icon.vue'
import Input from '../obsidian/Input.vue'
import Setting from '../obsidian/Setting.vue'
import { plural } from './codes'

const props = withDefaults(
  defineProps<{
    branch: string
    base: string
    commits: number
    files: number
    /** Filled from the branch's commits: the one subject, or the branch's name. */
    initialTitle: string
    initialBody?: string
    /** The branch is on the remote already. */
    pushed?: boolean
    /** Where the pull request opens ("GitHub"). */
    host?: string
    draftSupported?: boolean
  }>(),
  { initialBody: '', pushed: true, host: 'GitHub', draftSupported: true }
)
const emit = defineEmits<{
  (e: 'create', pr: { title: string; body: string; draft: boolean }): void
  (e: 'choose-base' | 'cancel'): void
}>()
const title = ref(props.initialTitle)
const body = ref(props.initialBody)
const draft = ref(false)
</script>

<style lang="scss">
.abele-pr-dialog {
  display: flex;
  flex-direction: column;
}
.abele-pr-dialog__where {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding-bottom: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-small);

  b {
    color: var(--text-normal);
    font-weight: var(--font-semibold);
  }
  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-pr-dialog__base {
  color: var(--text-accent);
  font-weight: var(--font-semibold);
  cursor: var(--cursor-link);
}
.abele-pr-dialog__field {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding: var(--size-4-2) 0;
}
.abele-pr-dialog__body {
  width: 100%;
  min-height: 7.5em;
  resize: vertical;
}
.abele-pr-dialog .modal-button-container {
  margin-top: var(--size-4-4);
}
</style>
