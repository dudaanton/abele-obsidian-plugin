<template>
  <div class="abele-worktree-dialog">
    <Setting :name="t('streamB.branch.52656e')" :desc="branchNote" :error="problem">
      <Input
        ref="field"
        v-model="branch"
        :disabled="busy"
        :placeholder="t('streamBRest.newBranch')"
        :aria-label="t('streamB.branch.52656e')"
        :invalid="!!problem"
        autocomplete="off"
        spellcheck="false"
        @keydown.enter.prevent="create"
      />
    </Setting>
    <Setting
      :name="t('streamB.startFrom.eb3f51')"
      :desc="
        existing
          ? t('streamB.notNeededTheBranchIsAlreadyThere.df9541')
          : t('streamB.theBranchTheNewOneBeginsAt.ed8c2d')
      "
    >
      <Button
        :text="base"
        icon="git-branch"
        :disabled="existing || busy"
        :tooltip="t('streamB.chooseTheBranchToStartFrom.aea1e2')"
        class="abele-worktree-dialog__base"
        @click="emit('choose-base')"
      />
    </Setting>
    <div class="abele-worktree-dialog__where">
      <Icon icon="folder" size="xs" :interactive="false" />
      <span class="abele-worktree-dialog__path">{{ where }}</span>
    </div>
    <div class="modal-button-container">
      <Button
        :text="t('streamB.cancel.19766e')"
        :tooltip="t('streamB.closeWithoutMakingAnything.16ddc1')"
        @click="emit('cancel')"
      />
      <Button
        :text="t('streamB.create.475949')"
        :loading="busy"
        accent
        :disabled="!branch.trim() || !!problem"
        :tooltip="t('streamB.makeTheWorktreeOnTheNode.6bf7e0')"
        @click="create"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
// A new worktree of a repository: a branch, and the branch it starts from. Typing the name of a
// branch that is already there checks that one out instead, and the line under the name says
// so. The node picks the folder itself; the last line shows where.
import { computed, onMounted, ref } from 'vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import Input from '../obsidian/Input.vue'
import Setting from '../obsidian/Setting.vue'

const props = withDefaults(
  defineProps<{
    /** Branches the repository has. */
    branches: string[]
    /** Branches already checked out in a worktree, which git will not check out twice. */
    taken: string[]
    base: string
    busy?: boolean
    /** Where the node keeps worktrees of this repository. */
    home?: string
  }>(),
  { home: undefined, busy: false }
)

const emit = defineEmits<{
  (e: 'create', branch: string, base: string): void
  (e: 'choose-base'): void
  (e: 'cancel'): void
}>()

const branch = ref('')
const field = ref<InstanceType<typeof Input>>()
const name = computed(() => branch.value.trim())
const existing = computed(() => props.branches.includes(name.value))
const problem = computed(() =>
  props.taken.includes(name.value)
    ? t('streamB.isAlreadyOpenInAnotherWorktree.f512a1', { v0: String(name.value) })
    : /\s|\.\.|[~^:?*[\\]/.test(name.value)
      ? t('streamB.aBranchNameHasNoSpacesAnd.7799d9')
      : undefined
)
const branchNote = computed(() =>
  existing.value
    ? t('streamB.thisBranchIsAlreadyThereTheWorktree.9f5288')
    : t('streamB.aNewBranch.f45871')
)
const where = computed(() =>
  props.home
    ? `${props.home}/${name.value || '…'}`
    : t('streamB.theNodeChoosesTheFolderForThis.d87a64')
)

function create() {
  if (!props.busy && name.value && !problem.value) emit('create', name.value, props.base)
}
onMounted(() => window.setTimeout(() => field.value?.inputRef?.focus()))
</script>

<style lang="scss">
.abele-worktree-dialog {
  display: flex;
  flex-direction: column;
}
.abele-worktree-dialog__where {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  min-height: calc(var(--font-ui-smaller) * var(--line-height-normal));
  padding-top: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);

  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-worktree-dialog__path {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-monospace);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-worktree-dialog .modal-button-container {
  margin-top: var(--size-4-4);
}
</style>
