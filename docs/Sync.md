# Sync

Abele can keep a vault in step across devices through an Abele Sync server: every device holds
the whole vault, changes travel within seconds on a desktop, and the server keeps every file's
history and a trash of what was deleted. It does nothing until a device is connected, in
**Settings → Abele → Sync**.

It needs a server and an account on it. Accounts are made by whoever runs the server; the plugin
signs in to one, it does not create one.

## Connecting a device

1. **Server address** — an https address: `https://sync.example.com`. A path after the host is
   fine, for a server mounted under one behind a proxy. Plain `http://` is taken only for a
   server on this same device — `localhost`, `127.0.0.1` or `[::1]` — since the password and the
   device's token would otherwise cross the network readable by anyone on the way. Any other
   plain-http address is refused under the field, and **Sign in** stays off until it is fixed.
   A server on your home network needs a certificate too: a real one, since a phone will not
   take a self-signed one.
2. **Email** and **Password** of the account, then **Sign in**. The password is used for this one
   sign-in and is never stored — not in the settings, not in the log.
3. **Choose a vault**: click one of the account's vaults, or name a new one under **Create a new
   vault** and press **Create and connect**. A new vault is filled from what this device already
   holds. **This device's name** is what the vault's device list will call it; change it before
   choosing.

The device is then enrolled and the tab shows **This device**: its status, the server, the vault
and its name, with **Sync now**, **Pause** (or **Resume**) and **Rescan**. **Rescan** walks the
whole vault again and fetches whatever this device is missing — for when something looks absent
that should not be. When sync has stopped on an error, **Sync now** is also what tries to start it
again, once the cause is fixed.

To stop, **Disconnect** forgets the server and the device's token and keeps everything else: your
files, and what this device syncs. **Forget** does the same and also throws away this device's
record of what was already synced, so the next connect walks the whole vault again instead of
picking up where it left off. Neither deletes a file, here or on the server.

A device connected over plain http to another machine before this rule does not sync: the tab
says the connection uses plain http and asks for a new sign-in with an https address. It is not
disconnected for you. The rule reads the address you give; a server that answers an https address
by redirecting to plain http is not caught by it.

## What syncs

Notes and canvases always travel. Everything else is each device's own choice, under **What this
device syncs**:

| Switch | What it covers |
|---|---|
| Images | Screenshots, photos, drawings and diagrams. |
| Audio | Recordings and voice notes. |
| Video | The heaviest thing a vault usually holds. |
| PDFs | Papers, manuals and scans. |
| Everything else | Attachments of no listed type, and the scripts folder. |

**Largest file** skips anything bigger, in megabytes; empty takes everything. It takes effect when
you leave the field or press Enter, not while you type; a number typed and left there when the
settings close is kept too, and an emptied field is kept only by leaving it. The vault has a cap
of its own too, set on the server and shown under **Vault policy**.

**Obsidian settings** decides how much of the configuration folder travels: **App settings**,
**Appearance** (theme, snippets, fonts), **Hotkeys**, **Core plugins**, **Community plugins** (the
plugins themselves, so a new device installs what this one runs) and **Plugin settings** (each
community plugin's `data.json`). The workspace, the graph and every plugin's cache never travel.

These switches only work when the configuration folder is called `.obsidian`. On a device where
Obsidian was told to use another folder (**Override config folder**, a phone on `.obsidian-mobile`
for instance), the configuration folder does not sync at all for now: the Sync tab says so instead
of showing the switches, nothing in it is sent, and the settings the other devices keep on the
server are left alone.

**Folders this device skips** leaves whole folders alone on this device; the other devices still
hold them. Taking a folder or a kind back in makes the next sync walk the vault again, so what this
device passed over arrives.

These never travel, whatever the switches say:

- **Abele's own `data.json`.** It holds this device's identity — the vault, the device id, and
  the name of the keychain entry the device token is in — and a vault is exactly what gets copied
  to another machine. So Abele's settings, the synced keys among them, do not reach your other
  devices through Abele Sync; the Transfer tab, or whatever else syncs your settings, carries them.
- **Hidden files and folders**, anything with a name starting with a dot — `.git/`, `.gitignore`,
  `.DS_Store`, `.stfolder`, `.trash/` — except the configuration folder. Obsidian does not show
  them to plugins, so the plugin neither fetches nor sends them, and never deletes them on the
  server either. The command-line client can still sync them between folders it runs on.
- **`.abele-sync-ignore`** at the vault root. Each device may have one, and it stays on that
  device. It takes gitignore patterns, one per line, and whatever it matches is neither sent nor
  fetched by this device:

  ```
  Archive/Video/
  *.tmp
  ```

## When two devices change one file

A note changed on two devices before either saw the other's change is resolved on the server as
the vault's policy says — **Vault policy → When two devices change one note**, shared by every
device on the vault:

- **Merge the two versions** (the default). Both edits end up in the one note. Edits to different
  places merge cleanly. Where both changed the same words, the note keeps both versions of that
  passage, one after the other, and it is yours to tidy. A merge that would break the note's
  frontmatter is not written; the other version goes to a conflict file instead.
- **Write a conflict file.** Your note is left as the server had it, and the other version is
  written beside it as `Note (Conflicted copy laptop 202609041530).md` — the device that sent it
  and the time, in UTC. Read both, keep what you want, delete the copy.

Either way the result arrives through Obsidian like any other change, so an open note updates in
place.

Anything that is not a note — a canvas, a picture, a PDF, a settings file — is never merged or
copied: the version with the newer modification time wins. An edit and a delete that cross each
other keep the edit, and the file comes back.

## Version history

Right-click a file in the file list and choose **Open version history (Abele)** (shown only while
this device is connected; Obsidian's own Sync, when it is on, adds an item of its own without the
suffix). Every version the server keeps is listed with its number, what happened
(created, edited, deleted…) and when. Clicking a version of a text file shows how it differs from
the file as it is now. **Restore** makes that version the current one on every device, after a
confirmation; nothing is lost, since what the file held becomes a version of its own. A restore
brings back content, never a name: a version from before a rename is restored under the current
name.

How long history is kept is the server's to decide, per kind of file, and **Vault policy → History
kept** shows it. **What the vault holds** shows the room it takes: live files, history and trash,
per kind, and the files with the heaviest histories.

## Deleted files

**Abele: Open deleted files** from the command palette lists what has been deleted anywhere in the
vault and not yet swept by the server. **Restore** brings a file back to the path it had, on every
device.

## The log and the status bar

**Abele: Open sync log**, or a click on the status bar item, shows what sync has done since
Obsidian started, newest at the bottom, with **Copy** for all of it. It holds the last 500 lines,
is not kept across restarts, and never contains a password or a token. The same lines are in the
developer console, prefixed `[abele-sync]`.

The status bar item is hidden on a device that is not connected. Otherwise it says:

| Status bar | Meaning |
|---|---|
| Fully synced | Nothing is left to send or fetch. |
| Syncing (3) | A sync is running; the number is what is still to be sent. |
| Paused | **Pause** was pressed. Nothing moves until **Resume**, and that survives a restart. |
| Offline | The server cannot be reached. It is tried again on its own. |
| Sync error | Something failed. The tooltip, and **Last failure** in the Sync tab, say what. A device the server no longer accepts says to connect again from the Sync settings. |

Hovering shows the whole status and when the last sync finished. **Abele: Sync now** and
**Abele: Pause or resume sync** are in the command palette too.

## On a phone

A phone keeps no connection open and runs nothing in the background, because the system suspends
the app the moment it leaves the screen. It syncs when Obsidian starts and every time the app comes
back to the front, and whenever **Sync now** is pressed. A change made on a laptop reaches the phone
the next time the phone is opened, not while it sits in a pocket.

On a phone whose settings hold no sync section yet, **Largest file** starts at 50 MB, so the
vault's video and big scans stay off it while every note arrives. Settings that arrived with a sync
section already in them — sent from a laptop with **Transfer**, or brought in by whatever syncs
Abele's `data.json` — keep the cap they came with, which on a laptop is usually none. Set it to
anything else, or empty, like on any device.

## The device token

Signing in gives this device a token of its own, and that token is what it syncs with from then
on. It is kept in Obsidian's keychain on this device only. It is never put in the synced keys, not
even with those turned on: a device holding another's token would sync as that device.

The one way it leaves the device is on purpose. **Transfer → Send to another device** with the
**Sync** section and **Include keys** ticked carries the token, behind the one-time code, so the
other device arrives connected without the password being typed on a phone. The two devices then
share one identity — the vault's device list shows one device where there are two — until either
of them connects again, which enrols it afresh with a token of its own. Without **Include keys**
the other device receives the settings but no token, and shows as not connected until it signs in.

What the transfer never carries is the record of what this device has already synced. That record
belongs to one vault on one machine, and is kept in Obsidian's storage for that vault rather than in
any file; the receiving vault starts a record of its own, so its first sync reads the whole vault
from the server and deletes nothing. The same holds for a vault copied in Finder, or a `data.json`
carried over by another sync tool.
