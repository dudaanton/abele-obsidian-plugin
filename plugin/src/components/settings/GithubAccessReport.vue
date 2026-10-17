<template>
  <CardGrid stack class="abele-github-access">
    <Card
      :title="t('settings.GithubAccessReport.token.d2089be6')"
      icon="key-round"
      :description="tokenLines"
    >
      <template #badges>
        <Badge
          :text="
            report.token.attached
              ? t('settings.GithubAccessReport.sent.c16bc82b')
              : t('settings.GithubAccessReport.not_sent.cd5f943d')
          "
          :color="report.token.attached ? 'green' : 'orange'"
        />
      </template>
    </Card>

    <Card
      v-for="row in report.rows"
      :key="row.permission"
      :title="row.permission"
      :icon="ICONS[row.state]"
      :subtitle="row.status ? `${row.request} → ${row.status}` : row.request"
      :description="rowLines(row)"
    >
      <template #badges>
        <Badge :text="LABELS[row.state]" :color="COLORS[row.state]" />
      </template>
    </Card>
  </CardGrid>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
/**
 * What "Check access" found: one card for the token — was it sent, whose is it, to which API —
 * and one per permission tried against the repository. The token itself is never shown; only
 * whether it went, its kind and its length, which is enough to tell a truncated paste.
 */
import { computed } from 'vue'
import Card from '../obsidian/Card.vue'
import CardGrid from '../obsidian/CardGrid.vue'
import Badge from '../obsidian/Badge.vue'
import type { KitColor } from '@/constants/colors'
import type { AccessReport, AccessRow, RowState } from '@/github/accessCheck'
import type { TokenKind } from '@/github/refusal'

const props = defineProps<{ report: AccessReport }>()

const ICONS: Record<RowState, string> = { ok: 'check', refused: 'x', skipped: 'minus' }
const LABELS: Record<RowState, string> = {
  ok: 'OK',
  refused: t('settings.GithubAccessReport.refused.66b87354'),
  skipped: t('settings.GithubAccessReport.skipped.12698ce1'),
}
const COLORS: Record<RowState, KitColor> = { ok: 'green', refused: 'red', skipped: 'grey' }

const KINDS: Record<TokenKind, string> = {
  none: '',
  'fine-grained': t('settings.GithubAccessReport.a_fine_grained_personal_access.04646cce'),
  classic: t('settings.GithubAccessReport.a_classic_personal_access_token.a9fcbcbc'),
  oauth: t('settings.GithubAccessReport.an_oauth_token.4e87c03e'),
  app: t('settings.GithubAccessReport.a_github_app_s_token.911c13a3'),
  unknown: t('settings.GithubAccessReport.an_access_token.14f95c33'),
}

const tokenLines = computed(() => {
  const r = props.report
  const lines: string[] = []
  lines.push(
    r.token.attached
      ? t('settings.GithubAccessReport.sent_with_every_request_value.a8affe59', {
          value0: String(KINDS[r.token.kind]),
          value1: String(r.token.length),
        })
      : t('settings.GithubAccessReport.no_token_was_sent_with.8d5461bf')
  )
  if (r.tokenNote) lines.push(r.tokenNote)
  if (r.tokenConfigured)
    lines.push(
      t('settings.GithubAccessReport.token_is_set_for_value.2c01fdf9', {
        value0: String(r.tokenHost),
      })
    )
  if (r.repo)
    lines.push(
      t('settings.GithubAccessReport.repository_value_value_on_value.b4b9db3e', {
        value0: String(r.repo.owner),
        value1: String(r.repo.repo),
        value2: String(r.host),
      })
    )
  if (r.login)
    lines.push(
      t('settings.GithubAccessReport.belongs_to_value.d316930d', { value0: String(r.login) })
    )
  if (r.expires)
    lines.push(
      t('settings.GithubAccessReport.expires_value.f820bc15', { value0: String(r.expires) })
    )
  if (r.scopes !== undefined && r.token.kind === 'classic') {
    lines.push(
      t('settings.GithubAccessReport.scopes_value.1d42883b', {
        value0: String(r.scopes || t('settings.terms.none')),
      })
    )
  }
  if (r.identityError) lines.push(r.identityError)
  lines.push(t('settings.GithubAccessReport.api_value.011cfaea', { value0: String(r.api) }))
  if (r.rateLimit) lines.push(`${r.rateLimit[0].toUpperCase()}${r.rateLimit.slice(1)}.`)
  return lines.join('\n')
})

const rowLines = (row: AccessRow): string | undefined => {
  const lines: string[] = []
  if (row.reason) lines.push(row.fix ? `${row.reason} ${row.fix}` : row.reason)
  if (row.needed)
    lines.push(
      t('settings.GithubAccessReport.needs_value.9e07998c', { value0: String(row.needed) })
    )
  if (row.githubSaid)
    lines.push(
      t('settings.GithubAccessReport.github_said_value.cc7a0df5', {
        value0: String(row.githubSaid),
      })
    )
  return lines.length ? lines.join('\n') : undefined
}
</script>
