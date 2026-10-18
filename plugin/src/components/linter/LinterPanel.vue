<template>
  <div class="abele-linter">
    <div class="abele-linter__head">
      <div class="abele-linter__headline" data-testid="linter-headline">{{ headline }}</div>
      <div class="abele-linter__actions">
        <Button
          v-if="running"
          :text="t('streamC.cae7d57bc067a514')"
          :tooltip="t('streamC.10e4bb5da5dbdffe')"
          @click="service.cancel()"
        />
        <template v-else>
          <!-- One accent at a time: linting until there is a report, fixing once there is. -->
          <Icon
            v-if="report"
            icon="refresh-cw"
            :tooltip="t('streamC.9f55e591be6ea579', { v1: lintScope(report) })"
            @click="service.rerun()"
          />
          <Button
            :text="t('commands.linter-lint-vault')"
            :accent="!report"
            :tooltip="t('streamC.c13fca605559129b')"
            @click="run({ kind: 'vault' })"
          />
          <Button
            v-if="report"
            :text="t('streamC.9c6601edc6114a97')"
            :accent="!!counts.fixable"
            :disabled="!counts.fixable || !!fixing"
            :tooltip="
              counts.fixable
                ? t('streamC.f9af0997b840d4d8', {
                    v1: String(counts.fixable),
                    v2: String(counts.fixableNotes),
                  })
                : t('streamC.21f3a5d8646cf187')
            "
            @click="confirmingFixAll = true"
          />
        </template>
        <Icon icon="settings" :tooltip="t('streamC.111a6602cec2e1aa')" @click="openSettings" />
      </div>
    </div>

    <div v-if="fixing" class="abele-linter__note">
      <Progress
        :value="fixing.done"
        :max="fixing.total"
        :label="
          t('streamC.d25a152a27c87512', { v1: String(fixing.done), v2: String(fixing.total) })
        "
      />
      <span>{{ t('streamC.1b64458dc8462a21', { v1: fixing.done, v2: fixing.total }) }}</span>
    </div>
    <div
      v-for="(error, rule) in report?.ruleErrors ?? {}"
      :key="rule"
      class="abele-linter__note abele-linter__note_error"
    >
      {{ t('streamC.14737c67bc06e9e5', { v1: titleOf(String(rule)), v2: error }) }}
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
                :tooltip="t('streamC.b1d2100244425687')"
                @click="open(group.key, 0)"
              />
              <Icon
                v-if="group.kind === 'note' && group.fixable"
                icon="file-diff"
                :tooltip="t('streamC.06accf2779ad633b')"
                @click="showPreview(group.key)"
              />
              <Icon
                v-if="group.kind === 'note' && group.fixable"
                icon="wand-sparkles"
                :tooltip="t('streamC.4832a2894a11363d')"
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
                :tooltip="t('streamC.fcad7825dabb93cb', { v1: String(titleOf(issue.rule)) })"
                @click.stop="fixIssue(issue)"
              />
            </div>
            <Button
              v-if="group.issues.length > issueLimit(group.key)"
              class="abele-linter__more"
              :text="
                t('streamC.c4768d6c510ec49c', {
                  v1: String(Math.min(PAGE, group.issues.length - issueLimit(group.key))),
                })
              "
              :tooltip="t('streamC.080cc3b0beee3164')"
              @click="moreIssues(group.key)"
            />
          </div>
        </div>
        <Button
          v-if="groups.length > groupLimit"
          class="abele-linter__more"
          :text="
            t('streamC.0839719837a66052', {
              v1: String(Math.min(PAGE, groups.length - groupLimit)),
              v2: String(groups.length),
            })
          "
          :tooltip="t('streamC.2b8ca3f76b571343')"
          @click="groupLimit += PAGE"
        />
      </div>
    </template>
    <EmptyState v-else-if="!report" :text="t('streamC.d229ba1a04492441')" />
    <EmptyState v-else-if="!running" :text="t('streamC.e79677c818876872')" />

    <ConfirmModal
      v-if="confirmingFixAll"
      :title="t('streamC.9c6601edc6114a97')"
      :message="
        t('streamC.6737a83b8f4a2a41', {
          v1: String(counts.fixable),
          v2: String(counts.fixableNotes),
        })
      "
      :confirm-text="t('streamC.21f1595b614ffc31')"
      :confirm-tooltip="t('streamC.da1aab65cba58527', { v1: String(counts.fixableNotes) })"
      @confirm="fixAll"
      @close="confirmingFixAll = false"
    />

    <ObsidianModal
      v-if="preview"
      :title="t('streamC.6b1ee87f8b2e504e', { v1: String(preview.title) })"
      size="tall"
      @close="preview = null"
    >
      <div class="abele-linter__preview">
        <EmptyState v-if="preview.before === preview.after" :text="t('streamC.e5a7ffa6411a62f0')" />
        <Diff v-else :text-left="preview.before" :text-right="preview.after" />
      </div>
      <template #footer>
        <Button :text="t('kit.cancel')" :tooltip="t('kit.cancelTooltip')" @click="preview = null" />
        <Button
          :text="t('streamC.21f1595b614ffc31')"
          accent
          :disabled="preview.before === preview.after"
          :tooltip="t('streamC.681a8f0df93d5ddc')"
          @click="applyPreview"
        />
      </template>
    </ObsidianModal>
  </div>
</template>

<script setup lang="ts">
import { lintHeadline, lintScope } from '@/i18n/streamCLinter'
import { settingsLabel } from '@/i18n/settingsLabels'
import { t } from '@/i18n'

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
import Progress from '../obsidian/Progress.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Diff from '../Diff.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { LinterService } from '@/linter/LinterService'
import { UNREADABLE } from '@/linter/engine'
import { ScriptService } from '@/scripting/ScriptService'
import { openIssue } from '@/linter/openIssue'
import { groupIssues, reportCounts, type GroupBy, type IssueGroup } from '@/linter/grouping'
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
const headline = computed(() => lintHeadline(report.value))

const groupBy = ref<GroupBy>('note')
const groupTabs = [
  { id: 'note', label: t('streamC.b716655030acbc5b'), tooltip: t('streamC.90992ca042856827') },
  { id: 'rule', label: t('streamC.fe9cb0d88b402e30'), tooltip: t('streamC.f0974712f4a3a655') },
]

const titles = computed(() => {
  void ScriptService.getInstance().scriptList.value
  return new Map([
    ...service
      .allRules()
      .map(
        (r) => [r.id, r.source === 'builtin' ? settingsLabel(r.title) : r.title] as [string, string]
      ),
    [UNREADABLE, t('settings.CalendarsSettings.could_not_be_read.51a02791')] as [string, string],
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
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
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
