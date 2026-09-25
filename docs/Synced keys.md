# Synced keys

Every API key and token the plugin uses — AI providers, image providers, voice input, web
search, GitHub, the Firefly III token, the named keys scripts and fetch calls use — is kept in the keychain of the
device it was typed on. Without synced keys, each one has to be entered again on every device.

Synced keys keep all of them in one encrypted store that travels with the plugin's settings.
Each device needs only the passphrase, typed once.

**Settings → Abele → Transfer → Synced keys.**

## Setting it up

1. On the device that already has the keys: **Set up**, type a passphrase twice (at least 8
   characters), **Turn on**. Every key this device has moves into the store.
2. On each other device, once the settings have synced: the status says **Locked on this
   device**. Type the passphrase, **Unlock**. Every key is now on that device too, and any key
   that device had and the store did not is added to it.

From then on a key added, changed or removed on any unlocked device reaches the others with the
settings.

## What each state means

| Status | Meaning |
|---|---|
| Off | Each device keeps its own keys. |
| Locked on this device | A store exists; this device has not been given the passphrase. |
| Unlocked on this device | Keys read and write through the store here. |
| Out of date | The passphrase was changed on another device. Keys already here keep working; enter the new passphrase to receive changes again. |
| Damaged | The store in the settings file does not decrypt although the passphrase is right — the file was changed by something else. Keys already on this device keep working; **Start over** makes way for a new store. |

## All keys

**All keys → Show** lists every key the plugin knows on this device, whether synced keys are on
or not: each under the name of what it belongs to — the provider, the integration, the stored
key's own name — with every place it is used (a provider's key names the agents that run on that
provider too), its keychain id, whether it is set, and how it stands with the store:

| Badge | Meaning |
|---|---|
| On this device | Synced keys are off; the key is in this device's keychain. |
| Synced | In the store, and this device's keychain holds the same value. |
| Differs from keychain | In the store, and the keychain here holds another value — changed outside the plugin, through Obsidian's own keychain screen. The store's value is the one used. |
| Only in the store | In the store, missing from this device's keychain. The plugin still uses it. |
| Not in the store | Set on this device only. Setting it again puts it in the store. |
| Store locked | Set here; the store cannot be read on this device, so whether it matches is unknown. |
| Not set | No value on this device. |

With the store open, the list also shows when each key was last changed, and the keys the store
holds that no setting on this device uses (another device's, or left behind), by their keychain
id. With the store locked, the keys only it holds cannot be listed — their names are encrypted
along with their values — so the list says the store may hold more and offers the passphrase
right there; once unlocked, they appear.

- **Show** (the eye) shows one value. It hides itself after 30 seconds, when the window goes to
  the background, and when the list is closed.
- **Copy** puts one value on the clipboard without showing it. On the desktop the clipboard is
  cleared a minute later if it still holds that key, and left alone if something else was copied
  since. On iOS and Android it is not: reading the clipboard back there makes the system ask the
  person for permission (iOS shows its "Allow Paste" prompt), and a prompt out of nowhere a minute
  later is worse than the risk. The key stays until something else is copied — and on an Apple
  device, Universal Clipboard can carry it to the person's other devices meanwhile. The notice
  after each copy says which of the two happened.
- **Copy all** puts every key that is set on the clipboard as `name (keychain id) = value`
  lines, after a warning that every key goes onto the clipboard as plain text. The same clearing
  rule applies.

There is deliberately no *export to a file*. A file of keys in plain text lands in the vault or
next to it, and from there in whatever the vault is synced and backed up with — Obsidian Sync,
Syncthing, a git history — where it outlives the moment it was wanted for and cannot be recalled.
Moving keys to another device is what synced keys and the Transfer's **Include keys** already do,
encrypted; a person who wants them in a password manager has **Copy all**.

Values never reach the console or a log, and the list is out of reach of AI agents: the settings
tools return no value or keychain id, and nothing an agent runs can open the list.

## The other actions

- **Change passphrase** re-encrypts the store. Other devices keep their keys and show *Out of
  date* until given the new passphrase.
- **Remove from this device** takes the passphrase and every key in the store off this device's
  keychain. The store and other devices keep them; unlock again to get them back.
- **Turn off** takes the store out of the settings. Every device that was unlocked keeps its
  keys in its own keychain; a device that never unlocked gets nothing.
- **Start over** (when locked, out of date or damaged) removes the store from the settings, for
  when the passphrase is forgotten or the store is damaged. The keys this device has stay.

## How it is kept safe

- The store is encrypted with AES-GCM under a 256-bit key derived from the passphrase with
  PBKDF2-SHA-256 (600 000 rounds, a random salt). A fresh random nonce is used for every write.
  WebCrypto does the work, the same on desktop, iOS and Android.
- The passphrase is never stored. Each device keeps only the derived key, in Obsidian's
  keychain. The settings file alone — a backup, a synced copy, a file someone got hold of —
  reveals nothing: not the keys, not their names.
- A check value in the store tells a wrong passphrase from a damaged file, so a wrong
  passphrase never decrypts into garbage, and any change to the encrypted contents is detected.
- AI agents cannot see or change the store through the settings tools, and a settings transfer
  never carries it or the passphrase. A transfer can still carry keys themselves when **Include
  keys** is ticked, as before.

The Firefly III token used to be saved in the settings file in the clear. It is now moved into
the keychain the first time the plugin starts (or its settings are saved) and dropped from the
file, so it is synced like every other key.

## Sync conflicts

The store is kept inside the plugin's `data.json` rather than in a file of its own, because
Obsidian Sync carries only `data.json`, `main.js`, `manifest.json` and `styles.css` out of a
plugin's folder.

When two devices change keys at nearly the same moment, the settings file of one may replace the
other's. Each device remembers what it wrote, and when the settings arrive it merges key by key —
the later change of each key wins — and writes back anything that was missing. A Syncthing
conflict copy of the settings file (`data.sync-conflict-….json`) is read and merged the same way;
delete the copy yourself once you have looked at it.
