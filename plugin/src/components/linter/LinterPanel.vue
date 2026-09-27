<template>
  <div class="abele-linter">
    <div class="abele-linter__head">
      <div class="abele-linter__headline" data-testid="linter-headline">{{ headline }}</div>
      <div class="abele-linter__actions">
        <Button
          v-if="running"
          text="Stop"
          tooltip="Stop linting; what was found so far stays"
          @click="service.cancel()"
        />
        <template v-else>
          <Button
            text="Lint vault"
            :accent="!report"
            tooltip="Check every note of the vault against the rules"
            @click="run({ kind: 'vault' })"
          />
          <Button
            v-if="report"
            text="Again"
            :tooltip="`Lint ${report.scope} again`"
            @click="service.rerun()"
          />
          <Button
            text="Fix all"
            accent
            :disabled="!counts.fixable || !!fixing"
            :tooltip="
              counts.fixable
                ? `Fix the ${counts.fixable} issues the rules can fix, in ${counts.fixableNotes} notes`
                : 'Nothing found here can be fixed by itself'
            "
            @click="confirmingFixAll = true"
          />
        </template>
        <Icon
          icon="settings"
          tooltip="Choose the rules and where they apply"
          @click="openSettings"
        />
      </div>
    </div>

    <div v-if="fixing" class="abele-linter__note">
      Fixing {{ fixing.done }} of {{ fixing.total }} notes…
    </div>
    <div
      v-for="(error, rule) in report?.ruleErrors ?? {}"
      :key="rule"
      class="abele-linter__note abele-linter__note_error"
    >
      The rule {{ titleOf(String(rule)) }} failed and was skipped: {{ error }}
    </div>

    <template v-if="report && report.issues.length">
      <Tabs v-model="groupBy" :tabs="groupTabs" level="secondary" />
      <div class="abele-linter__groups">
        <div
          v-for="group in shownGroups"
          :key="group.key"
          class="abele-linter__group"
          :data-group="group.key"
        >
          <div class="abele-linter__group-head">
            <FoldHeading
              :text="group.title"
              :count="group.issues.length"
              collapsible
              :collapsed="isFolded(group.key)"
              @toggle="toggle(group.key)"
            />
            <div class="abele-linter__group-actions">
              <Icon
                v-if="group.kind === 'note'"
                icon="file-text"
                tooltip="Open the note"
                @click="open(group.key, 0)"
              />
              <Icon
                v-if="group.kind === 'note' && group.fixable"
                icon="file-diff"
                tooltip="See what fixing this note would change"
                @click="showPreview(group.key)"
              />
              <Icon
                v-if="group.kind === 'note' && group.fixable"
                icon="wand-sparkles"
                tooltip="Fix what can be fixed in this note"
                @click="fixNote(group.key)"
              />
            </div>
          </div>
          <div v-if="!isFolded(group.key)" class="abele-linter__issues">
            <div
              v-for="issue in issuesShown(group)"
              :key="`${issue.path}:${issue.rule}:${issue.line}:${issue.message}`"
              class="abele-linter__issue"
              role="button"
              tabindex="0"
              :data-path="issue.path"
              :data-rule="issue.rule"
              :data-line="issue.line"
              @click="open(issue.path, issue.line)"
              @keydown.enter.prevent="open(issue.path, issue.line)"
            >
              <span class="abele-linter__where">{{ whereOf(issue, group.kind) }}</span>
              <span class="abele-linter__message">{{ issue.message }}</span>
              <Badge
                :text="group.kind === 'note' ? titleOf(issue.rule) : issue.severity"
                :color="issue.severity === 'error' ? 'red' : 'yellow'"
              />
              <Icon
                v-if="issue.fixable"
                class="abele-linter__fix"
                icon="wand"
                :tooltip="`Fix this: ${titleOf(issue.rule)}`"
                @click.stop="fixIssue(issue)"
              />
            </div>
            <Button
              v-if="group.issues.length > issueLimit(group.key)"
              class="abele-linter__more"
              :text="`Show ${Math.min(PAGE, group.issues.length - issueLimit(group.key))} more`"
              tooltip="List more of what was found here"
              @click="moreIssues(group.key)"
            />
          </div>
        </div>
        <Button
          v-if="groups.length > groupLimit"
          class="abele-linter__more"
          :text="`Show ${Math.min(PAGE, groups.length - groupLimit)} more of ${groups.length}`"
          tooltip="List more of the notes or rules"
          @click="groupLimit += PAGE"
        />
      </div>
    </template>
    <EmptyState
      v-else-if="!report"
      text="Lint the vault, a folder or a note: the commands start with “Lint”, and a folder’s or a note’s menu has it too."
    />
    <EmptyState v-else-if="!running" text="Nothing found. Every note follows the rules." />

    <ConfirmModal
      v-if="confirmingFixAll"
      title="Fix all"
      :message="`Fix ${counts.fixable} issues in ${counts.fixableNotes} notes? The rules rewrite those notes; what they cannot fix stays in the list. A note that changes while it is being fixed is left as it is.`"
      confirm-text="Fix"
      :confirm-tooltip="`Rewrite the ${counts.fixableNotes} notes`"
      @confirm="fixAll"
      @close="confirmingFixAll = false"
    />

    <ObsidianModal
      v-if="preview"
      :title="`Fixing ${preview.title}`"
      size="tall"
      @close="preview = null"
    >
      <div class="abele-linter__preview">
        <EmptyState v-if="preview.before === preview.after" text="Fixing would change nothing." />
        <Diff v-else :text-left="preview.before" :text-right="preview.after" />
      </div>
      <template #footer>
        <Button text="Cancel" tooltip="Close this and change nothing" @click="preview = null" />
        <Button
          text="Fix"
          accent
          :disabled="preview.before === preview.after"
          tooltip="Write these changes into the note"
          @click="applyPreview"
        />
      </template>
    </ObsidianModal>
  </div>
</template>

<script setup lang="ts">
/**
 * The linter's tab: what the last run found, grouped by note or by rule, folded and paged so a
 * vault's worth of findings stays light; a line opens the note there, a wand fixes it, and the
 * whole lot can be fixed at once after saying how much that is.
 */
import { computed, reactive, ref, watch } from 'vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import Badge from '../obsidian/Badge.vue'
import Tabs from '../obsidian/Tabs.vue'
import FoldHeading from '../obsidian/FoldHeading.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Diff from '../Diff.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { LinterService } from '@/linter/LinterService'
import { UNREADABLE } from '@/linter/engine'
import { ScriptService } from '@/scripting/ScriptService'
import { openIssue } from '@/linter/openIssue'
import {
  groupIssues,
  reportCounts,
  reportHeadline,
  type GroupBy,
  type IssueGroup,
} from '@/linter/grouping'
import { openAbeleSettings } from '@/components/settings/settingsTab'
import type { LintIssue, LintTarget } from '@/linter/types'

/** Groups, and issues inside one, listed at a time. */
const PAGE = 50
/** Past this many groups they start folded, so the first screen is a list of names. */
const OPEN_UP_TO = 20

const service = LinterService.getInstance()
const app = GlobalStore.getInstance().app

const report = service.report
const fixing = service.fixing
const running = computed(() => !!report.value?.running)
const counts = computed(() => reportCounts(report.value))
const headline = computed(() => reportHeadline(report.value))

const groupBy = ref<GroupBy>('note')
const groupTabs = [
  { id: 'note', label: 'By note', tooltip: 'Each note with what was found in it' },
  { id: 'rule', label: 'By rule', tooltip: 'Each rule with the notes that break it' },
]

const titles = computed(() => {
  void ScriptService.getInstance().scriptList.value
  return new Map([
    ...service.allRules().map((r) => [r.id, r.title] as [string, string]),
    [UNREADABLE, 'Could not be read'] as [string, string],
  ])
})
const titleOf = (id: string): string => titles.value.get(id) ?? id

const groups = computed<IssueGroup[]>(() =>
  groupIssues(report.value?.issues ?? [], groupBy.value, titleOf)
)
const groupLimit = ref(PAGE)
const shownGroups = computed(() => groups.value.slice(0, groupLimit.value))

/** What the person folded or opened by hand; the rest follows `OPEN_UP_TO`. */
const folded = reactive(new Map<string, boolean>())
const isFolded = (key: string): boolean => folded.get(key) ?? groups.value.length > OPEN_UP_TO
const toggle = (key: string) => folded.set(key, !isFolded(key))

const issueLimits = reactive(new Map<string, number>())
const issueLimit = (key: string): number => issueLimits.get(key) ?? PAGE
const issuesShown = (group: IssueGroup): LintIssue[] => group.issues.slice(0, issueLimit(group.key))
const moreIssues = (key: string) => issueLimits.set(key, issueLimit(key) + PAGE)

// A new run, or another grouping, starts from the top with nothing folded by hand.
watch([() => report.value?.startedAt, groupBy], () => {
  groupLimit.value = PAGE
  folded.clear()
  issueLimits.clear()
})

const whereOf = (issue: LintIssue, kind: GroupBy): string => {
  const line = issue.line ? `L${issue.line}` : ''
  if (kind === 'note') return line
  const name = issue.path.replace(/\.md$/i, '').split('/').pop() ?? issue.path
  return line ? `${name} · ${line}` : name
}

const run = (target: LintTarget) => void service.run(target)
const open = (path: string, line: number) => void openIssue(app, path, line)
const openSettings = () => openAbeleSettings(app, 'linter')

const fixIssue = (issue: LintIssue) => void service.fix(issue.path, issue.rule)
const fixNote = (path: string) => void service.fix(path)

const confirmingFixAll = ref(false)
const fixAll = () => void service.fixAll()

const preview = ref<{ path: string; title: string; before: string; after: string } | null>(null)
const showPreview = async (path: string) => {
  const diff = await service.preview(path)
  if (diff) preview.value = { path, title: path.replace(/\.md$/i, ''), ...diff }
}
const applyPreview = async () => {
  const shown = preview.value
  preview.value = null
  if (!shown) return
  // What was shown is what is written; a note changed since is shown again instead.
  const outcome = await service.applyPreview(shown.path, shown)
  if (outcome === 'changed-underneath') await showPreview(shown.path)
}
</script>

<style lang="scss">
.abele-linter {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  padding: var(--size-4-3) var(--size-4-4);
}

.abele-linter__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
}

.abele-linter__headline {
  flex: 1 1 16em;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-linter__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-linter__note {
  color: var(--text-muted);
  font-size: var(--font-ui-small);

  &_error {
    color: var(--text-error);
  }
}

.abele-linter__groups {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.abele-linter__group-head {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);

  > :first-child {
    flex: 1;
    min-width: 0;
  }
}

.abele-linter__group-actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--size-2-1);
}

.abele-linter__issues {
  display: flex;
  flex-direction: column;
  padding-left: var(--size-4-5);
}

.abele-linter__issue {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-2-2) var(--size-4-2);
  padding: var(--size-2-2) var(--size-4-2);
  border-radius: var(--radius-s);
  cursor: var(--cursor-link);

  &:hover,
  &:focus-visible {
    background-color: var(--background-modifier-hover);
  }
}

.abele-linter__where {
  flex-shrink: 0;
  color: var(--text-faint);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}

.abele-linter__message {
  flex: 1 1 12em;
  min-width: 0;
  overflow-wrap: anywhere;
}

.abele-linter__fix {
  margin-left: auto;
}

.abele-linter__more {
  align-self: flex-start;
}

.abele-linter__preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
