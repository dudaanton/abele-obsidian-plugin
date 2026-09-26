<template>
  <div class="abele-calendars-settings">
    <Section
      title="Calendars"
      desc="Events from Google, iCloud, Outlook or any CalDAV server, shown beside the tasks: in the sidebar calendar, the timeline and a daily note. Read only — nothing is ever written to a calendar, and no note is made unless you ask for one from an event."
    >
      <Setting
        name="Read every (minutes)"
        :desc="`When Obsidian starts, then this often while it is open. ${MIN_REFRESH_MINUTES} at least; Google itself updates a link only every few hours.`"
      >
        <Input
          :model-value="String(settings.refreshMinutes)"
          :placeholder="String(DEFAULT_REFRESH_MINUTES)"
          @update:model-value="updateMinutes"
        />
      </Setting>
      <Setting name="Read now" :desc="readAllDesc">
        <Button
          text="Read now"
          :disabled="!settings.feeds.some((f) => f.enabled) || reading"
          :tooltip="
            settings.feeds.some((f) => f.enabled)
              ? 'Read every calendar that is shown again, now'
              : 'No calendar is shown yet'
          "
          @click="readAll"
        />
      </Setting>
    </Section>

    <EmptyState v-if="!settings.feeds.length" text="No calendars yet." />

    <CardGrid v-else stack>
      <Card
        v-for="feed in settings.feeds"
        :key="feed.id"
        :title="feedLabel(feed)"
        :icon="feed.source === 'caldav' ? 'server' : 'calendar'"
        :description="statusText(feed)"
      >
        <template #badges>
          <Badge :text="KIT_COLOR_NAMES[feed.color]" :color="feed.color" />
          <Badge v-if="!feed.enabled" text="Off" />
          <Badge v-else-if="status(feed.id)?.error" text="Not read" color="red" />
        </template>
        <template #actions>
          <Icon icon="trash" tooltip="Delete this calendar" @click="removing = feed" />
        </template>

        <p v-if="feed.enabled && status(feed.id)?.error" class="setting-item-description">
          {{ status(feed.id)?.error }}
        </p>

        <Setting name="Show this calendar" desc="Off keeps it set up here without reading it.">
          <Checkbox :is-enabled="feed.enabled" @toggle="update(feed, { enabled: !feed.enabled })" />
        </Setting>
        <Setting name="Name" desc="Shown beside each of its events.">
          <Input
            :model-value="feed.name"
            placeholder="e.g. Work"
            @update:model-value="updateLater(feed, { name: $event })"
          />
        </Setting>
        <Setting name="Colour" desc="Its events are marked with it.">
          <Dropdown
            :options="colorOptions"
            :model-value="feed.color"
            @update:model-value="update(feed, { color: $event as KitColor })"
          />
        </Setting>
        <Setting
          name="Connected by"
          desc="A secret link to the calendar, or a CalDAV account with its username and password."
        >
          <Dropdown
            :options="sourceOptions"
            :model-value="feed.source"
            @update:model-value="changeSource(feed, $event as CalendarSource)"
          />
        </Setting>

        <template v-if="feed.source === 'ics'">
          <Setting name="Link" :desc="LINK_HELP">
            <SecretField
              :model-value="typed[feed.id] ?? ''"
              :value="stored(feed)"
              placeholder="https://… or webcal://…"
              replace-placeholder="New link..."
              save-tooltip="Save the link"
              what="The link"
              @update:model-value="type(feed, $event)"
              @save="saveSecret(feed)"
            >
              <template #actions>
                <Icon
                  icon="trash-2"
                  with-bg
                  tooltip="Forget the link"
                  @click="forgetSecret(feed)"
                />
              </template>
            </SecretField>
          </Setting>
          <p v-if="problem[feed.id]" class="setting-item-description mod-warning">
            {{ problem[feed.id] }}
          </p>
        </template>

        <template v-else>
          <Setting
            name="Server"
            desc="The CalDAV address: https://caldav.icloud.com for iCloud, https://caldav.fastmail.com for Fastmail, your Nextcloud's address for Nextcloud."
          >
            <Input
              :model-value="feed.server"
              placeholder="https://caldav.icloud.com"
              @update:model-value="updateLater(feed, { server: $event.trim() })"
            />
          </Setting>
          <Setting name="Username" desc="For iCloud, the email of the Apple Account.">
            <Input
              :model-value="feed.username"
              placeholder="name@example.com"
              @update:model-value="updateLater(feed, { username: $event.trim() })"
            />
          </Setting>
          <Setting name="Password" :desc="PASSWORD_HELP">
            <SecretField
              :model-value="typed[feed.id] ?? ''"
              :value="stored(feed)"
              placeholder="App-specific password"
              replace-placeholder="New password..."
              save-tooltip="Save the password"
              what="The password"
              @update:model-value="type(feed, $event)"
              @save="saveSecret(feed)"
            >
              <template #actions>
                <Icon
                  icon="trash-2"
                  with-bg
                  tooltip="Forget the password"
                  @click="forgetSecret(feed)"
                />
              </template>
            </SecretField>
          </Setting>
          <p v-if="problem[feed.id]" class="setting-item-description mod-warning">
            {{ problem[feed.id] }}
          </p>
          <Setting
            name="Calendar"
            desc="One calendar of the account, or all of them. Find calendars asks the server which there are."
          >
            <div class="abele-calendars-settings__row">
              <Dropdown
                :options="calendarOptions(feed)"
                :model-value="feed.calendarUrl"
                @update:model-value="update(feed, { calendarUrl: $event })"
              />
              <Button
                text="Find calendars"
                :disabled="finding === feed.id || !feed.server || !feed.username || !stored(feed)"
                :tooltip="
                  !feed.server || !feed.username || !stored(feed)
                    ? 'Set the server, the username and the password first'
                    : 'Ask the server which calendars this account has'
                "
                @click="find(feed)"
              />
            </div>
          </Setting>
          <p v-if="found[feed.id]?.message" class="setting-item-description">
            {{ found[feed.id]?.message }}
          </p>
        </template>
      </Card>
    </CardGrid>

    <Button text="Add calendar" tooltip="Add a calendar to show beside the tasks" @click="add" />

    <ConfirmModal
      v-if="removing"
      title="Delete the calendar"
      :message="`Delete ${feedLabel(removing)}? Its events leave the lists, and its ${removing.source === 'caldav' ? 'password' : 'link'} is removed from the keychain. The calendar itself is not touched.`"
      confirm-text="Delete"
      confirm-tooltip="Delete this calendar from the settings and its key from the keychain"
      @confirm="remove(removing)"
      @close="removing = null"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Settings → Calendars: the external calendars shown beside the tasks, each connected by a
 * secret link or a CalDAV account. The link and the password go to the keychain (see
 * `SecretField`); the settings keep only the name they are stored under.
 */
import { computed, reactive, ref, watch } from 'vue'
import { debounce } from 'obsidian'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import Badge from '../obsidian/Badge.vue'
import Card from '../obsidian/Card.vue'
import CardGrid from '../obsidian/CardGrid.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import SecretField from './SecretField.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets } from '@/secrets/SecretStore'
import { KIT_COLORS, KIT_COLOR_NAMES, type KitColor } from '@/constants/colors'
import {
  DEFAULT_REFRESH_MINUTES,
  MIN_REFRESH_MINUTES,
  calendarKeyId,
  calendarLinks,
  calendarSettingsFrom,
  feedLabel,
  newFeed,
  type CalendarFeed,
  type CalendarSettings,
  type CalendarSource,
} from '@/calendars/settings'
import { calendars } from '@/calendars/CalendarService'
import { discoverCalendars, type CaldavCalendar } from '@/calendars/caldav'
import { obsidianRequester } from '@/calendars/http'
import { isKeychainId } from '@/secrets/keychainId'

const LINK_HELP =
  'Google: the calendar’s settings, “Secret address in iCal format”. iCloud: share the calendar as a public calendar and copy its link. Outlook: publish the calendar and copy the ICS link. Kept in the keychain — anyone with the link can read the calendar.'
const PASSWORD_HELP =
  'For iCloud, an app-specific password made at account.apple.com, not the account’s own. Kept in the keychain, never in the settings file.'

const config = AbeleConfig.getInstance()
const settings = reactive<CalendarSettings>(calendarSettingsFrom(config.calendars))
watch(config.version, () => Object.assign(settings, calendarSettingsFrom(config.calendars)))

/** What is being typed into each calendar's secret field, not yet saved. */
const typed = reactive<Record<string, string>>({})
/** Why the last link or password typed into a calendar was not saved. */
const problem = reactive<Record<string, string>>({})
const found = reactive<Record<string, { calendars: CaldavCalendar[]; message: string }>>({})
const finding = ref<string | null>(null)
const removing = ref<CalendarFeed | null>(null)
const reading = ref(false)

const colorOptions = KIT_COLORS.filter((c) => c !== 'grey').map((color) => ({
  value: color,
  display: KIT_COLOR_NAMES[color],
}))
const sourceOptions = [
  { value: 'ics', display: 'Secret link (ICS)' },
  { value: 'caldav', display: 'CalDAV account' },
]

const save = async () => {
  config.calendars = calendarSettingsFrom(JSON.parse(JSON.stringify(settings)))
  await config.saveSettings()
}
const saveLater = debounce((): void => void save(), 600, true)

const update = (feed: CalendarFeed, patch: Partial<CalendarFeed>) => {
  Object.assign(feed, patch)
  void save()
}
const updateLater = (feed: CalendarFeed, patch: Partial<CalendarFeed>) => {
  Object.assign(feed, patch)
  saveLater()
}

const updateMinutes = (value: string) => {
  const minutes = Number(value.trim())
  if (!Number.isFinite(minutes) || minutes < MIN_REFRESH_MINUTES) return
  settings.refreshMinutes = Math.round(minutes)
  saveLater()
}

const stored = (feed: CalendarFeed): string => {
  void secrets().version.value
  return feed.keyId ? secrets().get(feed.keyId) : ''
}

const type = (feed: CalendarFeed, value: string) => {
  typed[feed.id] = value
  problem[feed.id] = ''
}

/** Puts a feed's secret into the keychain; the reason it could not, or ''. */
const keep = (feed: CalendarFeed, value: string): string => {
  const keyId = isKeychainId(feed.keyId) ? feed.keyId : calendarKeyId(feed.id)
  try {
    secrets().set(keyId, value)
  } catch (e) {
    const what = feed.source === 'ics' ? 'link' : 'password'
    return `The ${what} could not be kept in the keychain: ${(e as Error)?.message ?? e}`
  }
  feed.keyId = keyId
  return ''
}

/**
 * A link is taken apart first: a Google page stands for the feeds of the calendars on it, and
 * every calendar past the first on an embed page becomes a calendar of its own.
 */
const saveSecret = (feed: CalendarFeed) => {
  const raw = (typed[feed.id] ?? '').trim()
  if (!raw) return
  const values = feed.source === 'ics' ? calendarLinks(raw) : { urls: [raw] }
  if (values.problem) {
    problem[feed.id] = values.problem
    return
  }
  const [first, ...more] = values.urls
  const failed = keep(feed, first)
  if (failed) {
    problem[feed.id] = failed
    return
  }
  for (const url of more) {
    const extra = { ...newFeed(settings.feeds), name: feed.name }
    if (!keep(extra, url)) settings.feeds.push(extra)
  }
  typed[feed.id] = ''
  problem[feed.id] = ''
  void save()
}

const forgetSecret = (feed: CalendarFeed) => {
  if (feed.keyId) secrets().set(feed.keyId, '')
  update(feed, { keyId: '' })
}

const changeSource = (feed: CalendarFeed, source: CalendarSource) => {
  if (source === feed.source) return
  // A link is no password: the key belongs to the old way of connecting and goes with it.
  forgetSecret(feed)
  update(feed, { source, calendarUrl: '' })
}

const add = () => {
  settings.feeds.push(newFeed(settings.feeds))
  void save()
}

const remove = (feed: CalendarFeed) => {
  if (feed.keyId) secrets().set(feed.keyId, '')
  settings.feeds = settings.feeds.filter((f) => f.id !== feed.id)
  removing.value = null
  void save()
}

const find = async (feed: CalendarFeed) => {
  finding.value = feed.id
  found[feed.id] = { calendars: [], message: 'Asking the server…' }
  try {
    const list = await discoverCalendars(
      { server: feed.server, username: feed.username, password: stored(feed) },
      obsidianRequester
    )
    found[feed.id] = {
      calendars: list,
      message: list.length
        ? `${list.length} ${list.length === 1 ? 'calendar' : 'calendars'} found.`
        : 'The account has no calendar with events.',
    }
  } catch (e) {
    found[feed.id] = { calendars: [], message: (e as Error)?.message ?? String(e) }
  } finally {
    finding.value = null
  }
}

const calendarOptions = (feed: CalendarFeed) => {
  const options = [{ value: '', display: 'All calendars of the account' }]
  for (const c of found[feed.id]?.calendars ?? []) options.push({ value: c.url, display: c.name })
  if (feed.calendarUrl && !options.some((o) => o.value === feed.calendarUrl)) {
    const name = decodeURIComponent(feed.calendarUrl.split('/').filter(Boolean).pop() ?? '')
    options.push({ value: feed.calendarUrl, display: name || feed.calendarUrl })
  }
  return options
}

const status = (feedId: string) => calendars().state.status[feedId]

const ago = (ms: number): string => {
  const minutes = Math.round((Date.now() - ms) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

const statusText = (feed: CalendarFeed): string => {
  if (!feed.enabled) return 'Not shown'
  const s = status(feed.id)
  if (s?.reading) return 'Reading…'
  const count = calendars().state.events[feed.id]?.length ?? 0
  if (s?.at) {
    const events = `${count} ${count === 1 ? 'event' : 'events'}`
    return s.error ? `${events} from ${ago(s.at)}, kept` : `${events}, read ${ago(s.at)}`
  }
  if (!feed.keyId) return feed.source === 'caldav' ? 'No password yet' : 'No link yet'
  return s?.error ? 'Could not be read' : 'Not read yet'
}

const readAllDesc = computed(() => {
  void calendars().state.version
  const errors = settings.feeds.filter((f) => f.enabled && status(f.id)?.error).length
  if (reading.value) return 'Reading the calendars…'
  if (errors) return `${errors} of the calendars could not be read; each says why below.`
  return 'Read every calendar again now rather than at the next interval.'
})

const readAll = async () => {
  reading.value = true
  try {
    await calendars().refresh()
  } finally {
    reading.value = false
  }
}
</script>

<style lang="scss">
.abele-calendars-settings {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

// On a phone Obsidian makes each control in a settings row full width, so the picker and the
// button take a line each there rather than squeezing the picker to nothing.
.abele-calendars-settings__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-1);
}
</style>
