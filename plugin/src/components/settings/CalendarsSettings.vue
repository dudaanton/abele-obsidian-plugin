<template>
  <div class="abele-calendars-settings">
    <Section
      :title="t('settings.CalendarsSettings.calendars.e0b2b00c')"
      :desc="t('settings.CalendarsSettings.events_from_google_icloud_outlook.9b493b4b')"
    >
      <Setting
        :name="t('settings.CalendarsSettings.read_every_minutes.f4ca625e')"
        :desc="
          t('settings.CalendarsSettings.when_obsidian_starts_then_this.44513cbf', {
            value0: String(MIN_REFRESH_MINUTES),
          })
        "
      >
        <Input
          :model-value="String(settings.refreshMinutes)"
          :placeholder="String(DEFAULT_REFRESH_MINUTES)"
          @update:model-value="updateMinutes"
        />
      </Setting>
      <Setting :name="t('settings.CalendarsSettings.read_now.20d8b246')" :desc="readAllDesc">
        <Button
          :text="t('settings.CalendarsSettings.read_now.20d8b246')"
          :disabled="!settings.feeds.some((f) => f.enabled) || reading"
          :tooltip="
            settings.feeds.some((f) => f.enabled)
              ? t('settings.CalendarsSettings.read_every_calendar_that_is.7c3924c9')
              : t('settings.CalendarsSettings.no_calendar_is_shown_yet.ab997e6f')
          "
          @click="readAll"
        />
      </Setting>
    </Section>

    <!-- One row per calendar, as Obsidian lists its plugins: the name in its colour, how it
         is doing in a quiet line, on or off, and the rest in a window of its own. -->
    <Section :title="t('settings.CalendarsSettings.your_calendars.80ca6c5e')">
      <Setting
        v-for="feed in settings.feeds"
        :key="feed.id"
        class="abele-calendars-settings__feed"
        :class="`abele-calendars-settings__feed_${feed.color}`"
      >
        <template #name>
          <span class="abele-calendars-settings__name"
            ><Icon
              :icon="feed.source === 'caldav' ? 'server' : 'calendar'"
              no-hover
              class="abele-calendars-settings__glyph"
            />{{ feedLabel(feed) }}</span
          >
        </template>
        <template #desc>
          <span :class="{ 'mod-warning': feed.enabled && status(feed.id)?.error }">{{
            feed.enabled && status(feed.id)?.error
              ? t('settings.CalendarsSettings.not_read.e4f441c4') + status(feed.id)?.error
              : statusText(feed)
          }}</span>
        </template>
        <Icon
          icon="settings"
          :tooltip="t('settings.CalendarsSettings.change_this_calendar.a6ced910')"
          @click="editing = feed"
        />
        <Checkbox :is-enabled="feed.enabled" @toggle="update(feed, { enabled: !feed.enabled })" />
      </Setting>
      <Setting
        :name="
          settings.feeds.length
            ? t('settings.CalendarsSettings.add_another_calendar.744b9f9c')
            : t('settings.CalendarsSettings.no_calendars_yet.0097b3fe')
        "
        :desc="t('settings.CalendarsSettings.a_secret_link_from_google.21e49135')"
      >
        <Button
          :text="t('settings.CalendarsSettings.add_calendar.9067e0e8')"
          :tooltip="t('settings.CalendarsSettings.add_a_calendar_to_show.6973ff63')"
          @click="addAndEdit"
        />
      </Setting>
    </Section>

    <ObsidianModal v-if="editing" :title="feedLabel(editing)" @close="editing = null">
      <Setting
        :name="t('settings.CalendarsSettings.name.dcd1d522')"
        :desc="t('settings.CalendarsSettings.shown_beside_each_of_its.c8dbf6ee')"
      >
        <Input
          :model-value="editing.name"
          :placeholder="
            t('settings.CalendarsSettings.e_g_work.7f2ce0de', { literal0: String('Work') })
          "
          @update:model-value="updateLater(editing, { name: $event })"
        />
      </Setting>
      <Setting
        :name="t('settings.CalendarsSettings.colour.3a9dfa58')"
        :desc="t('settings.CalendarsSettings.its_events_are_marked_with.16eafb54')"
      >
        <Dropdown
          :options="colorOptions"
          :model-value="editing.color"
          @update:model-value="update(editing, { color: $event as KitColor })"
        />
      </Setting>
      <Setting
        :name="t('settings.CalendarsSettings.connected_by.9952ce52')"
        :desc="t('settings.CalendarsSettings.a_secret_link_to_the.9b051a7d')"
      >
        <Dropdown
          :options="sourceOptions"
          :model-value="editing.source"
          @update:model-value="changeSource(editing, $event as CalendarSource)"
        />
      </Setting>

      <template v-if="editing.source === 'ics'">
        <Setting :name="t('settings.CalendarsSettings.link.a6a32dbc')" :desc="LINK_HELP">
          <SecretField
            :model-value="typed[editing.id] ?? ''"
            :value="stored(editing)"
            :placeholder="t('settings.calendar.urlPlaceholder')"
            :replace-placeholder="t('settings.CalendarsSettings.new_link.f9e84245')"
            :save-tooltip="t('settings.CalendarsSettings.save_the_link.7b19a248')"
            :what="t('settings.CalendarsSettings.the_link.f0fb533a')"
            @update:model-value="type(editing, $event)"
            @save="saveSecret(editing)"
          >
            <template #actions>
              <Icon
                icon="trash-2"
                with-bg
                :tooltip="t('settings.CalendarsSettings.forget_the_link.45aee758')"
                @click="forgetSecret(editing)"
              />
            </template>
          </SecretField>
        </Setting>
        <p v-if="problem[editing.id]" class="setting-item-description mod-warning">
          {{ problem[editing.id] }}
        </p>
      </template>

      <template v-else>
        <Setting
          :name="t('settings.CalendarsSettings.server.aef7de28')"
          :desc="
            t('settings.CalendarsSettings.the_caldav_address_https_caldav.b4d38d72', {
              literal0: String('https://caldav.icloud.com'),
              literal1: String('https://caldav.fastmail.com'),
            })
          "
        >
          <Input
            :model-value="editing.server"
            placeholder="https://caldav.icloud.com"
            @update:model-value="updateLater(editing, { server: $event.trim() })"
          />
        </Setting>
        <Setting
          :name="t('settings.CalendarsSettings.username.e3b89e9d')"
          :desc="t('settings.CalendarsSettings.for_icloud_the_email_of.c5355f7f')"
        >
          <Input
            :model-value="editing.username"
            placeholder="name@example.com"
            @update:model-value="updateLater(editing, { username: $event.trim() })"
          />
        </Setting>
        <Setting :name="t('settings.CalendarsSettings.password.e7cf3ef4')" :desc="PASSWORD_HELP">
          <SecretField
            :model-value="typed[editing.id] ?? ''"
            :value="stored(editing)"
            :placeholder="t('settings.CalendarsSettings.app_specific_password.ffcc8f77')"
            :replace-placeholder="t('settings.CalendarsSettings.new_password.1abebe85')"
            :save-tooltip="t('settings.CalendarsSettings.save_the_password.acd9c185')"
            :what="t('settings.CalendarsSettings.the_password.3f4e5252')"
            @update:model-value="type(editing, $event)"
            @save="saveSecret(editing)"
          >
            <template #actions>
              <Icon
                icon="trash-2"
                with-bg
                :tooltip="t('settings.CalendarsSettings.forget_the_password.9d745dd0')"
                @click="forgetSecret(editing)"
              />
            </template>
          </SecretField>
        </Setting>
        <p v-if="problem[editing.id]" class="setting-item-description mod-warning">
          {{ problem[editing.id] }}
        </p>
        <Setting
          :name="t('settings.CalendarsSettings.calendar.d5d0a30b')"
          :desc="t('settings.CalendarsSettings.one_calendar_of_the_account.562ef915')"
        >
          <div class="abele-calendars-settings__row">
            <Dropdown
              :options="calendarOptions(editing)"
              :model-value="editing.calendarUrl"
              @update:model-value="update(editing, { calendarUrl: $event })"
            />
            <Button
              :text="t('settings.CalendarsSettings.find_calendars.d59c2286')"
              :disabled="
                finding === editing.id || !editing.server || !editing.username || !stored(editing)
              "
              :tooltip="
                !editing.server || !editing.username || !stored(editing)
                  ? t('settings.CalendarsSettings.set_the_server_the_username.111eaa0a')
                  : t('settings.CalendarsSettings.ask_the_server_which_calendars.f73e27cb')
              "
              @click="find(editing)"
            />
          </div>
        </Setting>
        <p v-if="found[editing.id]?.message" class="setting-item-description">
          {{ found[editing.id]?.message }}
        </p>
      </template>
      <template #footer>
        <div class="abele-modal__actions abele-calendars-settings__actions">
          <Button
            :text="t('settings.CalendarsSettings.delete.e2d0a549')"
            warning
            :tooltip="t('settings.CalendarsSettings.delete_this_calendar_from_the.f4c43787')"
            class="abele-calendars-settings__delete"
            @click="removing = editing"
          />
          <Button
            :text="t('settings.CalendarsSettings.done.11a6767d')"
            accent
            :tooltip="t('settings.CalendarsSettings.close_this_window_changes_are.91342d87')"
            @click="editing = null"
          />
        </div>
      </template>
    </ObsidianModal>

    <ConfirmModal
      v-if="removing"
      :title="t('settings.CalendarsSettings.delete_the_calendar.e601c301')"
      :message="
        t('settings.CalendarsSettings.delete_value_its_events_leave.e651a9e0', {
          value0: String(feedLabel(removing)),
          value1: String(
            removing.source === 'caldav' ? t('settings.terms.password') : t('settings.terms.link')
          ),
        })
      "
      :confirm-text="t('settings.CalendarsSettings.delete.e2d0a549')"
      :confirm-tooltip="t('settings.CalendarsSettings.delete_this_calendar_from_the.f4c43787')"
      @confirm="remove(removing)"
      @close="removing = null"
    />
  </div>
</template>

<script setup lang="ts">
import { settingsCount } from '@/i18n/settingsCounts'
import { t } from '@/i18n'
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
import ObsidianModal from '../obsidian/Modal.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import SecretField from './SecretField.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets } from '@/secrets/SecretStore'
import { keyDestinations, acceptIntroducedDestinations } from '@/secrets/destinations'
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

const LINK_HELP = t('settings.CalendarsSettings.google_the_calendar_s_settings.065b586e')
const PASSWORD_HELP = t('settings.CalendarsSettings.for_icloud_an_app_specific.7d624f48')

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
/** The calendar open in its window. */
const editing = ref<CalendarFeed | null>(null)
const reading = ref(false)

const colorOptions = KIT_COLORS.filter((c) => c !== 'grey').map((color) => ({
  value: color,
  display: KIT_COLOR_NAMES[color],
}))
const sourceOptions = [
  { value: 'ics', display: t('settings.CalendarsSettings.secret_link_ics.a3f8db65') },
  { value: 'caldav', display: t('settings.CalendarsSettings.caldav_account.bb860701') },
]

const save = async () => {
  const before = keyDestinations(config)
  config.calendars = calendarSettingsFrom(JSON.parse(JSON.stringify(settings)))
  acceptIntroducedDestinations(before, keyDestinations(config))
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
    const what = feed.source === 'ics' ? t('settings.terms.link') : t('settings.terms.password')
    return t('settings.CalendarsSettings.the_value_could_not_be.3daaa765', {
      value0: String(what),
      value1: String((e as Error)?.message ?? e),
    })
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

/** A new calendar opens straight in its window, where its link or account is filled in. */
const addAndEdit = () => {
  add()
  editing.value = settings.feeds[settings.feeds.length - 1] ?? null
}

const remove = (feed: CalendarFeed) => {
  if (feed.keyId) secrets().set(feed.keyId, '')
  settings.feeds = settings.feeds.filter((f) => f.id !== feed.id)
  removing.value = null
  editing.value = null
  void save()
}

const find = async (feed: CalendarFeed) => {
  finding.value = feed.id
  found[feed.id] = {
    calendars: [],
    message: t('settings.CalendarsSettings.asking_the_server.fb689559'),
  }
  try {
    const list = await discoverCalendars(
      { server: feed.server, username: feed.username, password: stored(feed) },
      obsidianRequester
    )
    found[feed.id] = {
      calendars: list,
      message: list.length
        ? t('settings.calendar.found', { count: list.length })
        : t('settings.CalendarsSettings.the_account_has_no_calendar.a059bc95'),
    }
  } catch (e) {
    found[feed.id] = { calendars: [], message: (e as Error)?.message ?? String(e) }
  } finally {
    finding.value = null
  }
}

const calendarOptions = (feed: CalendarFeed) => {
  const options = [
    { value: '', display: t('settings.CalendarsSettings.all_calendars_of_the_account.3b138d44') },
  ]
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
  if (minutes < 1) return t('settings.CalendarsSettings.just_now.7ddb44d8')
  if (minutes < 60)
    return t('settings.CalendarsSettings.value_min_ago.c85acd7d', { value0: String(minutes) })
  const hours = Math.round(minutes / 60)
  if (hours < 24)
    return t('settings.CalendarsSettings.value_h_ago.d5aa4bb8', { value0: String(hours) })
  return t('settings.CalendarsSettings.value_d_ago.0f70078c', {
    value0: String(Math.round(hours / 24)),
  })
}

const statusText = (feed: CalendarFeed): string => {
  if (!feed.enabled) return t('settings.CalendarsSettings.not_shown.a08f0f94')
  const s = status(feed.id)
  if (s?.reading) return t('settings.CalendarsSettings.reading.874bfa5b')
  const count = calendars().state.events[feed.id]?.length ?? 0
  if (s?.at) {
    const events = settingsCount('event', count)
    return s.error
      ? t('settings.CalendarsSettings.value_from_value_kept.419ae64a', {
          value0: String(events),
          value1: String(ago(s.at)),
        })
      : t('settings.CalendarsSettings.value_read_value.6e58c8af', {
          value0: String(events),
          value1: String(ago(s.at)),
        })
  }
  if (!feed.keyId)
    return feed.source === 'caldav'
      ? t('settings.CalendarsSettings.no_password_yet.11f1e05e')
      : t('settings.CalendarsSettings.no_link_yet.60e5be61')
  return s?.error
    ? t('settings.CalendarsSettings.could_not_be_read.51a02791')
    : t('settings.CalendarsSettings.not_read_yet.fbe841ea')
}

const readAllDesc = computed(() => {
  void calendars().state.version
  const errors = settings.feeds.filter((f) => f.enabled && status(f.id)?.error).length
  if (reading.value) return t('settings.CalendarsSettings.reading_the_calendars.b8ec37a1')
  if (errors)
    return t('settings.CalendarsSettings.value_of_the_calendars_could.c86147d0', {
      value0: String(errors),
    })
  return t('settings.CalendarsSettings.read_every_calendar_again_now.d8b13597')
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

// A calendar's name with its glyph in the calendar's own colour, as its events wear it.
.abele-calendars-settings__name {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-calendars-settings__glyph {
  flex: 0 0 auto;
  --icon-size: var(--icon-s);
}

@each $color in red, orange, yellow, green, cyan, blue, purple, pink {
  .abele-calendars-settings__feed_#{$color} .abele-calendars-settings__glyph {
    color: var(--color-#{$color});
  }
}

// On and the way in to change it, at the end of the row; the row stays one line.
.abele-calendars-settings__feed > .setting-item-control {
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: var(--size-4-2);
}

.abele-calendars-settings__delete {
  margin-inline-end: auto;
}
</style>
