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
   holds, and nothing is asked; its card has a field for this device's name too. Clicking a vault
   that exists only opens the join dialog below — nothing is enrolled until its **Connect**, and
   **Cancel** enrols nothing. If this device left a vault while the server could not be told, the
   server is told first — for up to ten seconds, with the dialog saying "Telling *server* that
   *device* left…" — and the enrolment goes ahead either way.

### Joining a vault that already has files

The join dialog counts both sides first — "Here: 1240 files · On the server: 1180 files in all",
saying how many of them are Obsidian settings when any are — and asks according to what it finds.
The count here is what this device would sync; the server's is the whole vault, including what this
device leaves out, so fewer may come down than it says.

- **Only this vault holds files**: "Connect this vault to *X*? Its *N* files will be uploaded."
- **Only the server holds files**: "…The server holds *N* files in all; what this device takes of
  them will be downloaded."
- **Both hold files**: "Sync this vault with *X*?", and which copy is kept where both have a file
  with different contents:
  - **Merge both** (chosen to begin with) — files on both sides are combined. A note changed on
    both keeps both texts; for any other file the newer one wins. Nothing is deleted.
  - **This device wins** — where both have a file, this device's copy is kept everywhere.
  - **The server wins** — where both have a file, the server's copy is kept here. This one is
    chosen to begin with instead when all this vault holds is Obsidian's own settings, as in a
    vault just made: those defaults are newer than anything, so under **Merge both** they would
    replace the settings of every device. The dialog says so in a line of its own.
- **This device synced that vault before** and walked it to the end (a reconnect after
  **Disconnect**, with nothing forgotten): "Reconnect to *X*? This device picks up where it left
  off." There is nothing to choose.

**This device's name** — what the server will know it by — is asked in the same dialog.

What each choice does, file by file:

- A file both sides hold with the same contents is simply taken as synced; nothing moves.
- A file both sides hold with different contents is the only case where one copy replaces the
  other. The copy that loses is always on the server first, as an earlier version of that file in
  **Version history** — this device's copy is stored before anything is written over it here. It
  is kept there as long as the vault keeps history for its kind: by default a year for notes, a
  month for settings and two weeks for attachments (see the vault policy on the Sync tab).
- A file only this device holds is uploaded, and one only the server holds is downloaded,
  whichever side wins. So is a file this device holds that the server has in its trash: it is
  uploaded as a new file, and the one in the trash stays restorable. "The server wins" does not
  make this device a copy of the server.
- Files this device does not sync — its switches, `.abele-sync-ignore`, hidden files, anything over
  its size cap — are not touched on either side, whatever the choice.
- Obsidian settings that differ are treated like any other file that is not a note, except that
  where the server's copy wins it is not written straight away: it waits for **Reload now**, like
  any settings change from another device (see [Obsidian settings from another
  device](#obsidian-settings-from-another-device)). So the first sync of a join ends with that one
  question when the vault's settings differ from this device's.
- Abele's own settings file is left out of the join and taken up once it is done, the way it is on
  any device's first contact: the vault's copy wins, and this device's goes to that file's history
  (see [Abele's own settings](#what-syncs)). A new device's defaults never replace the settings
  everyone else has, whichever side was chosen.

The choice is kept with the connection until a sync gets through — across a restart, so a join
cut off half way (the network gone, Obsidian closed) finishes the way it was asked to. Then it is forgotten, a notice says the vault
is synced and where the other copies are, and the next sync fetches Abele's own settings file.

A device set up by a **transfer** gets the same dialog. It is connected as the transfer is
applied, but syncs nothing until the question is answered: the status bar says **Choose how to
join**, a notice says so when Obsidian starts, and the Sync tab opens the dialog by itself and keeps
a **Choose…** button for it (and **Disconnect**, to leave instead). What this device syncs can be
changed there before answering. A transfer onto the vault this device already synced to the end
asks nothing: it is a reconnect, and syncing starts at once.

The device is then enrolled and the tab shows **This device**: its status, the server, the vault
and its name, with **Sync now**, **Pause** (or **Resume**) and **Rescan**. **Rescan** walks the
whole vault again and fetches whatever this device is missing — for when something looks absent
that should not be. When sync has stopped on an error, **Sync now** is also what tries to start it
again, once the cause is fixed. While the device is paused, **Sync now** and **Rescan** are greyed
out, and from the command palette **Sync now** says sync is paused and moves nothing: **Resume**
comes first.

Below it, **Devices on this vault** lists every device of your account that syncs this vault, this
one included and marked **This device**: its name, whether it is a desktop, a phone or tablet or
the command-line client, which device enrolled it (a device made by a transfer is enrolled by the
one that sent it; one you signed in on was enrolled with the account password), and when it was
last seen syncing. The list is asked of the server with this device's own token, so no password is
needed. Every other device has **Revoke**, which asks first — "*device* stops syncing; its files
stay on it" — and then has the server stop accepting it at once. Nothing is deleted anywhere; the
revoked device shows **Sync error** at its next sync, saying to connect again, which needs the
password. This device has no **Revoke**: it leaves by
**Disconnect**, which also forgets its token. A device of another account that shares the vault,
or one of yours on another vault, is not listed.

To stop, **Disconnect** tells the server to stop accepting this device, then forgets the server
and the device's token and keeps everything else: your files, and what this device syncs. After
that no copy of the token anywhere can read or write the vault, and connecting again needs the
password. **Forget** does the same and also throws away this device's record of what was already
synced, so the next connect walks the whole vault again instead of picking up where it left off.
Neither deletes a file, here or on the server.

The server is told on the address the device signed in to, even if the address saved for it was
changed since. If it cannot be reached — no network, the server down, or no answer in ten
seconds — the Disconnect still goes ahead, and the token is kept under a name of its own to tell
the server later. That is tried again when Obsidian starts, when the Sync tab opens and before
every sign-in, for a month; after that it is given up and the log says so. Meanwhile the Sync tab
shows a line, **Waiting to tell the server** — "The server has not been told that *device* left
*server*. It will be retried." — with **Forget without telling the server**, which asks first and
then stops trying and forgets the token. The device then stays enrolled on that server, and anyone
holding a copy of its token can still sync the vault, until it is revoked there: under **Devices
on this vault** on any device that still syncs it. A device the server had already revoked disconnects the same way, with
nothing left to retry. In the rare case that the keychain will not take the kept copy, the
Disconnect is refused instead and the device goes on syncing, so a token is never lost while the
server still takes it.

A connected device stays on the server it signed in to. Its address cannot be changed to another
server, by the agent or anyone: the token is only ever sent to the server that minted it. To move
to another server, disconnect and sign in there.

A device connected over plain http to another machine before this rule does not sync: the tab
says the connection uses plain http and asks for a new sign-in with an https address. It is not
disconnected for you. Disconnecting it does not tell that server either, since the token is never
sent over plain http: the Sync tab then shows **Cannot tell the server**, saying the device is
still enrolled there, with **Forget without telling the server**. The token is kept until then. The rule reads the address you give; a server that answers an https address
by redirecting to plain http is not caught by it.

## What syncs

Notes and canvases always travel. Everything else is each device's own choice, under **What this
device syncs**, and it is kept on that device alone — changing it on a phone changes nothing on the
laptop:

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

Abele's own settings are one of those plugin settings: they follow **Plugin settings** like any
other plugin's, the synced keys among them, and a change made on one device is reloaded on the
others as it arrives. They name no device — the connection is kept in Obsidian's own storage for
the vault (see below) — and nothing under **What this device syncs** is in them. When two devices
change Abele's settings at nearly the same moment, the later save wins; the other is in the file's
version history. Abele's chat index (`chat-index.json` beside the settings) stays on each device
and is rebuilt from the chat files.

The first time a device syncs Abele's settings file — a new device, one set up by a settings
transfer, one upgraded from a version that kept the file to itself — the vault's copy wins
whatever the dates say: the device's own file, written at its first launch, goes to the file's
version history and the vault's settings are loaded in its place. Where the vault has no such
file yet, the device's becomes it. When the vault's settings say something other than the
device's did, a notice says so once and points to the file's version history. That matters most
for a device that already had settings of its own: one reconnected after a Disconnect, or a phone
that cleared Abele's sync database to free space, meets the file for the first time again, and
its settings give way to the vault's in the same way.

A settings change made on this device while another device's settings are arriving is kept: the
arrived file is taken in first and the change put back on top of it, so neither is lost. That
merge goes setting by setting, but a list — the agents, the providers, the links, the
automations — is one setting in it: when both devices changed the same list, this device's list
is kept whole, and the other device's version of it is in the file's version history. A
settings file that arrives unreadable is not loaded; the settings in memory stay, nothing is saved
until a readable one arrives, and a notice says so. Deleting the file does not reset anything —
the delete reaches every device, and each writes its settings back at its next save, or when
Abele is closed if that comes first.

### Obsidian settings from another device

Obsidian reads its settings, its hotkeys, its theme and every plugin's `data.json` once, when the
vault opens. A file changed underneath it is read by nothing, and the next save puts the old
values back. So a settings change that arrives from another device is not written at once: it
waits, and a dialog, **Settings changed on another device**, says what arrived — "Obsidian settings
changed on another device: App settings, Hotkeys, 2 plugins (Dataview, Tasks). Reload Obsidian to
apply them." — and which device it came from. Everything in the configuration folder waits this
way: Obsidian's own files, themes and snippets, and every plugin's files, including plugins that
are not switched on here. Abele's own settings are the one exception; they are applied as they
arrive, because Abele reloads them itself.

- **Reload now** writes what arrived and reloads Obsidian. A file changed on this device since it
  arrived is not written: this device's version of it goes to the other devices instead, and the
  notice says how many. Nothing more is synced from the moment the reload starts. Where Obsidian
  cannot reload itself at all the button says **Apply**, and the notice asks you to restart
  Obsidian — change no setting before you do, or its save puts the old values back everywhere.
- **Later** leaves everything waiting. It is asked again when Obsidian next starts, or when more
  settings arrive — not at every sync. Until then the Sync tab shows **Settings waiting (5)** with
  **Apply and reload** and **Keep this device's**, and the status bar's tooltip says so too.
- **Keep this device's** sends this device's files to the other devices over what arrived, so they
  get the same question in turn. It never deletes anything anywhere: a file that only the other
  device has — a plugin installed there, say — is left there and does not come here, and the
  notice says how many were left. A file whose path is taken here by another synced file cannot be
  kept until that is sorted out; the notice says how many, and the log names them.

Changing settings here before reloading keeps this device's version everywhere: the change is
sent as usual, and the one that was waiting for that file is dropped, with a line in the log
("your change to hotkeys.json on this device replaced the one from Laptop"). The command-line
client has no Obsidian to reload, and writes settings files as they arrive.

These switches only work when the configuration folder is called `.obsidian`. On a device where
Obsidian was told to use another folder (**Override config folder**, a phone on `.obsidian-mobile`
for instance), the configuration folder does not sync at all for now: the Sync tab says so instead
of showing the switches, nothing in it is sent, and the settings the other devices keep on the
server are left alone.

**Folders this device skips** leaves whole folders alone on this device; the other devices still
hold them. Taking a folder or a kind back in makes the next sync walk the vault again, so what this
device passed over arrives. **Skip a folder** offers the folders that hold at least one file.

Folders themselves do not sync, only the files in them. When another device renames or deletes a
folder, the files move or go here too, and a folder this left empty is removed. A folder you made
empty yourself, or one still holding a hidden file such as `.DS_Store`, stays.

These never travel, whatever the switches say:

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
(created, edited, deleted…) and when. A merged version also says whose version it kept, or
that it merged two devices' edits: the device named beside it is the one whose change caused the
merge, which is not always the one whose text won. Clicking a version of a text file shows how it differs from
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

**Restore all deleted since** brings back everything deleted since a moment: **the last hour**,
**today**, or **a time I choose**. The moment is compared with the time the server recorded each
delete, so a device whose clock is wrong does not change what is picked. The row says how many
files that is before anything happens; **Restore** then asks, naming the count, the first files
and which devices deleted them ("310 by MacBook, 2 by Phone"). The files come back in batches of a
thousand, and a notice counts what happened: "Restored 310; 2 came back under a new name because
the old one was taken; 0 failed". A file whose path was taken meanwhile comes back beside it under
the next free name. A file no longer in the trash, because it was restored meanwhile or swept,
does not come back and counts as failed. While sync is paused, the notice says the files arrive
when it is resumed. "The last hour" and "today" count from the moment **Restore** is pressed. If
the connection drops part way, what came back is synced to this device at once, and pressing
**Restore** again carries on: a batch the server took before its answer was lost counts as
restored, not failed.

## When many files disappear at once

A sync that finds many files deleted on this device holds those deletions back instead of sending
them. That is 50 files or more at once, or at least 10 that are also a quarter of what this device
syncs, counting what went in the last 15 minutes. It sends everything else as usual. The other
devices keep the files, and the server's copies are not touched, until someone decides. A folder
moved into one this device skips counts too, since the other devices see it as deleted. An
emptied vault, a disk that was not mounted, or a script gone wrong is caught this way before it
reaches every device.

The status bar then says **Deletions held (312)** in the theme's warning colour, and a dialog
asks, once for each new set of held files. On a desktop it asks when the hold is found; on a
phone it asks when the app is next in front. It lists the first twenty files, then "and 292 more",
and offers:

- **Delete everywhere**: asks first, then sends the deletions. The files go to the server's trash
  and disappear from every device. Deleted files can bring them back until the trash is swept.
- **Put them back**: the files come back to this device from the server.
- **Decide later**: the files stay held. The same question stays on the Sync tab, under
  **Deletions held back**, for as long as they are held.

The decision covers exactly the files the dialog showed — on the Sync tab, the files its
confirmation counted when it opened. If more files are deleted while it is open, they join the
hold, and the dialog asks again about all of them. A file that comes back by itself leaves the
hold. A decision taken while sync is paused, or whose sync then fails, is carried out when sync
resumes or next gets through, and the notice says so. Until then the Sync tab keeps the question
with a line saying what was decided ("Decided: delete everywhere (60 files), carried out when
sync is resumed"); answering again there replaces that answer. A hold survives a restart, and is
asked about again when Obsidian starts.

## The log and the status bar

**Abele: Open sync log**, or a click on the status bar item, shows what sync has done since
Obsidian started, newest at the bottom, with **Copy** for all of it. It holds the last 500 lines,
is not kept across restarts, and never contains a password or a token. The same lines are in the
developer console, prefixed `[abele-sync]`.

The status bar item is hidden on a device that is not connected. Otherwise it says:

| Status bar | Meaning |
|---|---|
| Fully synced | Nothing is left to send or fetch. |
| Syncing | A sync is running. The tooltip says how many changes it found to send. |
| Waiting (3) | A sync has finished, and it left these changes for the next one — they changed again while it was sending them, or the server refused them. The log says which. |
| Deletions held (312) | Many files were deleted on this device at once, and their deletions are held back until you decide. See [When many files disappear at once](#when-many-files-disappear-at-once). |
| Choose how to join | A transfer connected this device to a vault, and both hold files. Nothing syncs until the join dialog on the Sync tab is answered. See [Joining a vault that already has files](#joining-a-vault-that-already-has-files). |
| Paused | **Pause** was pressed. Nothing moves until **Resume**, and that survives a restart. |
| Offline | The server cannot be reached. It is tried again on its own. |
| Sync error | Something failed. The tooltip, and **Last failure** in the Sync tab, say what. A device the server no longer accepts says to connect again from the Sync settings. |

Hovering shows the whole status and when the last sync finished, and "Settings waiting (5) —
Apply and reload on the Sync tab." while settings from another device wait
([Obsidian settings from another device](#obsidian-settings-from-another-device)). **Abele: Sync now** and
**Abele: Pause or resume sync** are in the command palette too.

## On a phone

A phone keeps no connection open and runs nothing in the background, because the system suspends
the app the moment it leaves the screen. While Obsidian is in front, an edit on the phone is sent a
moment after it is made, just as on a laptop, and the phone asks the server for what other devices
changed once a minute. It also syncs when Obsidian starts, when the app comes back to the front,
when it leaves the front — so the last edit goes out before the phone is locked — and whenever
**Sync now** is pressed. A change made on a laptop reaches a phone in a pocket the next time it is
opened.

Obsidian hides the status bar on a phone, so the sync state is only shown in the Sync tab.

On a phone **Largest file** starts at 50 MB, so the vault's video and big scans stay off it while
every note arrives. The cap is always the phone's own: nothing that arrives from a laptop — a
transfer, a copied or synced `data.json` — sets it, so a laptop's "no cap" never fills a phone. Set
it to anything else, or empty, like on any device; the laptop does not see the change.

## The device token

Signing in gives this device a token of its own, and that token is what it syncs with from then
on. It is kept in Obsidian's keychain on this device only. It is never put in the synced keys, not
even with those turned on: a device holding another's token would sync as that device.

Where the device syncs — the server, the vault, the device it enrolled as, the name its token is
filed under, whether it is paused, and what it takes — is kept in Obsidian's own storage for this
vault, and not in Abele's `data.json`. Pausing is per device too: pausing the phone does not pause
the laptop.

That storage is per vault everywhere. The keychain is not: on a desktop Obsidian keeps one per
vault, but on a phone it is the system's secure storage, one for the whole app and read by every
vault on it. So on a phone two vaults can see the same token; what they cannot share is the
connection and the record of what was synced.

The **Sync** section of **Transfer → Send to another device** carries only what every device shares.
The connection travels in a section of its own, **Sync connection**, which a connected device
offers. Sent with keys, it gives the other device **a device of its own**: when the codes are made,
the dialog asks for a name for the other device ("Other device" unless you change it), and this
device asks the server to enrol a new device under that name on the same vault. The transfer
carries that device's token, never this one's, so the vault's device list shows both, and either
can disconnect without cutting off the other. The list shows the new one as enrolled by the device
that sent it. The server is asked once: if the answer is lost on the way, the device it made is
left with nobody holding its token — find it in the list by that "enrolled by" and revoke it. If the server
cannot be reached or refuses, the codes are made without a connection and the dialog says why, and
that the other device will sign in itself. Sent without keys, the section carries only what this device syncs, as a
starting point, and the other device signs in itself. The size cap never travels.

On the receiving device:

- one that syncs nothing takes the connection when the transfer is applied, and starts syncing as
  its own device; what the sender syncs is its starting point, with its own size cap kept;
- one that already syncs that vault on that server shows "Already connected to this vault" and
  skips it; the device made for it is revoked, so none is left over;
- one that syncs another vault or another server shows the section unticked, marked "Replaces this
  device's own connection". Ticked, **Apply** asks first, naming both vaults. Switching disconnects
  it from its vault — telling that server — and takes the new one. Declining applies the rest of the
  transfer, and the device made for it is revoked.

Closing the dialog without **Apply** revokes the device made for it too, when this device already
syncs that vault or the switch was left unticked. A switch that fails after this device was
disconnected from its own vault says so, and the device then syncs nothing until it signs in.

A transfer made by an older version of Abele still holds the sender's connection and token; the
receiving device takes neither. A device that was set up by such a transfer before this version,
though, took both at the time: it syncs as the sender — one device on the server, not two — and
keeps doing so after the upgrade, because the connection in its `data.json` and the token in its
keychain are really there. Now that Disconnect revokes, disconnecting either of the two would cut
off both. Disconnect the receiving one and connect it again once, to give it a device of its own.

What a transfer never carries either is the record of what this device has already synced. That
record belongs to one vault on one machine, and is kept in Obsidian's storage for that vault; a
device that connects starts a record of its own, so its first sync reads the whole vault from the
server and deletes nothing.

## What a copied vault does

A vault copied in Finder, a `data.json` carried over by another sync tool, or a vault opened on a
new machine is not connected: Obsidian keeps the connection under its own id for that vault, which
a copy does not share. Sign in on the copy to give it a device of its own. The same happens to a
vault folder renamed outside Obsidian — it gets a new id, and loses the connection (and, on a
desktop, the keychain); connect it again.

The first time this version of Abele starts on a device, it moves the connection an older version
kept in `data.json` into that storage, and writes `data.json` again without it. It takes the
connection only if this vault's own storage holds the record of what was synced for the vault the
file names, and the keychain holds the token it names — together, the proof that the file is this
vault's own on this device. The record is the half a copy never has, on a phone too, where the
keychain alone would not tell a copy apart. A `data.json` that came from another vault or device
fails the check: the device is then not connected, and keeps the other device's switches for what
to sync as a starting point, but not its size cap. The log says which of the two happened.

The move waits for a `data.json` it can read. If the file is missing when this version first
starts — a phone that has not downloaded it yet — or will not parse, nothing is moved and nothing
is marked as done; the next start that reads the file moves it. Nor is the file written again
until the connection is safely stored: if Obsidian's storage refused it, the file is left as it
was and the move is tried at the next start.

Every device on a vault should run this version or none: an older version still writes its own
connection into `data.json`, which this one ignores, and it reads the one it finds there as its
own. Its chat index, which it keeps inside `data.json`, is added to this device's when the file
arrives.
