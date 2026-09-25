# Transfer and keys

Moving your Abele setup to another device, and keeping API keys in step across devices.

## Sending settings to another device

**Settings → Abele → Transfer → Send to another device**: tick what should travel, section by
section, down to single agents, journals or header buttons. Script files, skills and prompts can
go along too. What you picked goes as QR codes, as a line of text to paste, or as a file.

**Include keys** sends the API keys the ticked settings need. A transfer that carries a key is
locked with a one-time code, shown on this device and typed on the other.

## Receiving

On the other device, **Receive from another device → Scan** reads the transfer: with the camera,
from a photo of the codes, from a file, or from the pasted text. You see what arrived before
anything is written.

A transfer saved as a file lands in the vault root as `Abele transfer <date> <time>.txt`. Delete
it once the transfer is done.

## Where keys are kept

API keys and tokens are kept in each device's own keychain. The settings only name the slot. So
by default every key has to be entered once on every device.

## Synced keys

**Settings → Abele → Transfer → Synced keys** keeps every key in one encrypted store inside the
plugin's settings file, so the keys travel with your settings:

1. On the device that has the keys: **Set up**, choose a passphrase of at least 8 characters,
   **Turn on**.
2. On each other device, once the settings have synced, the status says the store is locked.
   Type the passphrase and **Unlock**.

From then on a key added or changed on one device reaches the others. Nothing in the store can be
read without the passphrase. The same screen changes the passphrase, removes the keys from one
device, and turns the store off.

## All keys

**All keys** lists every key the plugin knows on this device: what it is for, where it is used,
whether it is set and synced. Each can be shown or copied, and all of them copied at once. Every
field where a key is entered has the same show and copy buttons.
