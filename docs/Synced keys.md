# Synced keys

Every API key and token the plugin uses — AI providers, image providers, voice input, web
search, GitHub, the named keys scripts and fetch calls use — is kept in the keychain of the
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

## Sync conflicts

The store is kept inside the plugin's `data.json` rather than in a file of its own, because
Obsidian Sync carries only `data.json`, `main.js`, `manifest.json` and `styles.css` out of a
plugin's folder.

When two devices change keys at nearly the same moment, the settings file of one may replace the
other's. Each device remembers what it wrote, and when the settings arrive it merges key by key —
the later change of each key wins — and writes back anything that was missing. A Syncthing
conflict copy of the settings file (`data.sync-conflict-….json`) is read and merged the same way;
delete the copy yourself once you have looked at it.
