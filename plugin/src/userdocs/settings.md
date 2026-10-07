# Settings

What each tab of **Settings → Abele** holds. **Documentation**, at the top right of each tab,
opens the page for that tab.

## Links that write notes

An `obsidian://abele` link with note content now asks every time before writing. The preview
shows the path and the complete contents after the change, as plain text. Cancel writes nothing;
a missing daily note is created only after acceptance. Only ordinary Markdown notes are allowed,
not scripts, files inside the configured scripts folder, hidden folders or Obsidian's settings
folder. If the note changes while the preview is open, open the link again to review it.

Chart tooltips display note names and property values literally, not as HTML. The chart library
is updated; chart settings and data are unchanged.

## Sync

Abele Sync requires a self-hosted **abele-sync** server; there is no hosted service. Enter
that server's URL, sign in, and choose or create a vault on the Sync tab. This device keeps
its connection and selective-sync choices locally. Notes and canvases always sync; other
file types, folders, size limits and configuration sections can be selected separately.
Disconnect revokes this device without deleting its notes. Version history and deleted files
are kept on your server, under its retention policy.

The command palette provides **Sync now**, **Pause or resume sync**, **Open sync log** and
**Open deleted files**. Right-click a synced file for **Open version history**. Sharing,
joining a shared vault and publishing selected linked material use the same server; review
the proposed access before confirming.

## Tasks

The tasks folder, the quick choices of dates, times and repeats in the task editor, the busy day
threshold, whether the week starts on Monday, your birth date and life expectancy for the
calendar's life in weeks, and label colours. See [Tasks](tasks).

## Logs

Which note types make their paragraphs into logs. See [Logs](logs-and-journals#logs).

## Journals

Your journals: their names, path templates, templates, repeat period, and which one is the
default daily journal. See [Journals](logs-and-journals#journals).

## Calendars

Other calendars shown beside the tasks: each one's name, colour and secret link or CalDAV
account, how often they are read, and **Read now**. See
[Other calendars](logs-and-journals#other-calendars).

## Finance

Where transactions and accounts are saved, the transaction template, default and pinned
currencies, and the Firefly III connection. See [Finance](finance).

## Time Tracking

Where time entries are saved and which notes get a timer. See [Time tracking](time-tracking).

## AI Agent

The whole AI feature. **General** holds providers and models, the background model that names and
summarises chats, the chat and comment folders, web search, image and voice models, and the
background prompts. **Agents** holds your agents with their prompts, tools, scope, permissions,
memory and interceptor. **MCP** connects MCP servers whose tools agents can use. See
[AI chat and agents](ai-chat).

## Scripts

**Library**, **Header buttons**, **Automations** and **General**, where scripts are turned on. See
[Scripts and automations](scripts).

## Header buttons

Buttons on notes that run a command or a script, and which notes each one shows on. See
[Header buttons](scripts#header-buttons).

## Links

Named links that run a script or a command. See [Links](scripts#links).

## GitHub

Turning GitHub tabs on, the token and server, page width, how people are shown, and code search.
See [GitHub](github).

## Nodes

Connect this device to a local AbeleNode with a label, its loopback URL (default
`http://127.0.0.1:7777`) and an installation token from `abele-node token create`.
**Check** reports the connection, **Open session** creates or picks a fake session, and
**Remove** forgets only this device's connection, not the node's history or credential.
Connections and tokens never travel with settings or the synced key store. This stage is
local desktop only and does not execute agents or tools. See [Node sessions](ai-chat#node-sessions).

## Books

The reader's text and layout, reading aloud, where reading places are kept, where highlights go,
and the scripts offered on selected words. See [Books](books).

## Quick button

Turning the floating button on for a phone, and for a tablet, the side it stands at, putting it
back down, and the commands and scripts at the top of its menu. See [Quick button](quick-button).

## Linter

Folders the linter never looks in, each rule switched on or off, and where and how each applies.
See [Linter](linter#setting-it-up).

## Transfer

Sending settings to another device, receiving them, synced keys and the list of all keys. See
[Transfer and keys](transfer).

## Other

**Changelog → Open changelog** lists all versions and their changes, newest first. The
**Open changelog** command opens the same tab. **Show older versions** loads the next page;
all older versions remain available. On an update a brief notice offers the changes since
the last version run on this device, including intermediate versions you skipped. **What's
new** opens that range and **Show all versions** returns to the full history. Dismissing or
ignoring the notice does not reopen it on the next start. Nothing is shown on a fresh install.

The first version with this feature quietly starts tracking: earlier versions kept no
device-local record, so it cannot know what was installed before. Automatic update offers
become accurate on the following update. This is separate for each device and vault and
does not travel with settings. The changelog works offline. Dates are UTC commit dates,
not GitHub publication times. Dates marked “Recovered version history” belong to versions
recovered from old version-bump commits rather than verified release tags.

The CSS snippets folder, full-width sidebars on a phone and half-width on a tablet, the Mermaid
viewer, the plugin's own drawing of properties (see [Properties](writing#properties)), opening
notes where you left them (see [Where you left off](writing#where-you-left-off)), the
coordinates property and map style for maps, and keyboard diagnostics, a troubleshooting panel
for the on-screen keyboard.

**Open canvases in Abele** chooses the default for newly opened `.canvas` tabs. On uses the
read-only [diagram viewer](drawing#canvas-diagrams) with walkthrough steps; off uses native
Canvas. An individual viewer tab can always return to native Canvas from its header. This
preference travels with settings; diagram embeds keep their picture and Open/Play actions.

Service keys now stay with their configured address. If an address changes by sync, import,
or an agent, the key is held on this device. Run **Abele: Review key destinations** from the
command palette, or use **AI → General → Key destinations → Review**, to allow each address.
Changing an address yourself in its settings screen records that decision locally. Other
devices still ask once. Existing addresses are recorded automatically on the first upgrade.

Keys are sent over HTTPS. HTTP to this device's loopback address still works; a home-network
server needs an explicit **Allow unencrypted HTTP** decision in **Review key destinations**.
The warning explains that anyone on the network path can read the key. The exception includes
the port, stays on this device and can be removed in the same dialog. Public HTTP addresses
cannot receive keys. Services needing no key can still use HTTP.

On desktop, a service redirect to another origin no longer receives the request's
Authorization, API-key or cookie headers. Requests with a saved key in the redirected URL or
body stop instead. Mobile's native request transport does not expose redirect control, so
this protection is not yet available there. GitHub uses a separate transport.

A map style written in an `abele-map` block must use a public HTTPS address without a username
or password. A local or HTTP style in a note shows an error instead of loading. Your map style
in settings can still point at a local server or use HTTP.
