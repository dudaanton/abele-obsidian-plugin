# Scripts and automations

Small JavaScript programs kept in your vault, for anything the plugin does not do by itself.

## Turning scripts on

Scripts run inside Obsidian with full access to your vault, so they are off until you turn them on
in **Settings → Abele → Scripts → General** and choose the folder they live in. Only run scripts
you have read or trust.

## A script

A script is a `.js` file in the scripts folder that starts with a header:

```js
// @name Tag untagged notes
// @description Finds notes without tags and adds one
// @icon tag
// @param tag string "Tag to add" = "todo"

const tasks = await find({ property: "type", value: "task" })
log(`Found ${tasks.length} tasks`)
return 'Done'
```

`@param` lines become a form when you run the script yourself (a parameter ending in
`selection` starts out as the words you have selected), and arguments when an agent or
another script calls it. **Create script** starts a new one. **Show script API reference** lists
everything a script can use: notes and search, templates, forms and dialogs, web requests, dates,
and `agent()` to hand the fuzzy part of a job to a model. An AI agent can write scripts for you.

## Running a script

- From the command palette: every script is a command, **Script: <name>**.
- From **Settings → Abele → Scripts → Library**, which lists every script with its description.
- From a button in a note's header, which runs it on that note.
- From the toolbar: see below.
- On words selected in a book, from the bar under the page: see [Books](books).
- From a link, inside or outside Obsidian.
- By an AI agent, which sees your scripts as tools.
- By itself, through an automation.
- Each time Obsidian starts: see below.

## Script runs

**Show script runs** lists every run of this session: its status, its log lines, what it returned
or why it failed. A run can be stopped, run again, or run again with changed values. While a
script runs, the status bar says so.

## The toolbar

Pin a script in **Settings → Abele → Scripts → Library** (the pin on its card), or add a
`// @toolbar` line to its header, and it is on the toolbar:

- on a computer, an icon on the left ribbon, the strip of icons at the edge of the window, with
  the script's name as its tooltip. It runs the script on the note in front and on the words
  selected in it. Reorder or hide it in Obsidian's **Settings → Appearance → Ribbon menu configuration**, like
  any other; renaming the script keeps its place.
- on a phone, a button at the start of the toolbar above the keyboard. Move it or take it off in
  Obsidian's **Settings → Toolbar**, like any other; one you took off stays off until you pin it
  again.

Unpin it and it goes from both. Every script is also a command, so you can give it a hotkey or put
it on the phone's toolbar yourself without pinning it.

## Startup scripts

Press the power button on a script's card in **Settings → Abele → Scripts → Library**, or add a
`// @startup` line to its header, and it runs each time Obsidian starts, once your vault is open.
The **Startup** tab next to the library lists them: put them in the order they should run, and
choose for each whether it runs on every device, only on computers, or only on phones and tablets
(a header line can say `// @startup desktop` or `// @startup mobile`). Your scripts sync to every
device, so this is how one stays off the phone.

They run one after another. A script's parameters get their defaults, since nobody is asked
anything at startup; one that needs a value without a default is skipped, and a notice says so. A
script that fails does not stop the others, and one that takes longer than half a minute is left
to go on in the background while the next starts. Turning the plugin off and on or updating it
counts as a start too.

If a startup script goes wrong, turn on **Don't run startup scripts** in the Startup tab, which
skips all of them until you switch it back. A script that froze Obsidian is skipped by itself the
next time Obsidian starts, with a notice naming it, so you can reach the settings — on a phone too.

## Scripts from other devices

A script runs code on every device your vault reaches. If you would rather a script that arrives
from elsewhere — through Obsidian Sync, iCloud, Syncthing or git — did not run until you have
looked at it, turn on **Confirm scripts from other devices** under **Settings → Abele → Scripts →
General**. It is off unless you turn it on.

With it on, a script that appears or changes without being written on this device waits. Buttons,
automations, startup and agents do not run it, a notice says it arrived, and its card in the
library says **Waiting to be confirmed**. Press its button, its review icon, or the notice's
**Review**, or run **Review scripts waiting for confirmation** from the command palette: you see
the script — what changed since you last confirmed it, or the whole of it if it is new — and
**Confirm** lets it run. A button you pressed runs the script right after.

Scripts you write on this device, in the code editor or through an agent or a transfer, count as
confirmed. Turning the setting on accepts every script in the folder as it is at that moment.
What you confirmed is remembered on this device only, so each device asks for itself. Turned on
anywhere, it turns on on your other devices as the settings reach them; turned off, it goes off
only on the device where you do it.

## Header buttons

**Settings → Abele → Header buttons** (also under **Scripts**) puts buttons on notes. A button
runs either a command or a script.

- **A command** — any command Obsidian has: its own, another plugin's, the plugin's, or a
  script's, since every script is a command too. Choose it from a searchable list. The button
  sits among the icons at the top right of the note, with its name as the tooltip. If the plugin
  that gives the command is switched off, the button hides until it is back. On a phone the header
  holds two of them; the rest are at the top of the note's **More options** menu. Turn on **Also
  on other files** to have it on PDFs, canvases, books and other files opened in a tab too.
- **A script** — the button sits in the plugin's own header inside the note and can hand the
  script values from the note, such as its title or a property.

A new button runs a command and shows on every note. Narrow it down to notes of some types, with
some tags (nested tags count), in some folders — `Projects/*/Notes` for the notes folder of every
project — and to notes whose properties match conditions you set. The order in the list is the
order in the header. Pick its icon from a grid.

## Automations

**Settings → Abele → Scripts → Automations** runs a script by itself when something happens: a task
completed, reopened, created, changed or moved to another date; a note created, changed, renamed
or deleted. A rule can be limited to note types, folders or a property value, and to at most one
run every so many seconds per note.

An automation runs on the device where the change was made. Changes that arrived by sync are
skipped unless the rule says **Also for changes from other devices**. If automations start
setting each other off too often, they pause until you edit one or restart Obsidian.

## Links

**Settings → Abele → Links** gives a script or a command a name, so a link can start it:

```
obsidian://abele?name=add-expense&amount=12
```

The link's extra values reach the script as parameters. Such a link works from a note, a browser,
a shortcut on your phone or another app. **Wait for sync** holds it until Obsidian has finished
syncing after launch.

## Script views

A script can open a tab of its own with cards, buttons, fields, tables and its own HTML: a feed of
notes, flashcards, a dashboard. The tab is saved with your workspace and comes back after a
restart.

## Lint rules

A script whose header says `// @lint` is a rule of the [linter](linter) rather than something to
run. It declares a `check` that is handed each note and gives back what is wrong with it — a list
of messages, or of `{ message, line }` — and may declare a `fix` that gives back the note's whole
new text:

```js
// @name No spaces at line ends
// @description Lines do not end in spaces
// @lint warning

function check(note) {
  return note.lines.flatMap((text, i) =>
    /[ \t]+$/.test(text) ? [{ message: 'Spaces at the end of the line', line: i + 1 }] : []
  )
}

function fix(note) {
  return note.lines.map((text) => text.replace(/[ \t]+$/, '')).join('\n')
}
```

The note has its `path`, `name`, `folder`, whole `content` and its `lines`, the `frontmatter` as
properties (or `null`), the `body` under them and the line it starts on, `bodyStart`. Without
`warning` in the header a finding is an error. The rule is listed in **Settings → Abele →
Linter** with the others, where it can be switched off or kept to some folders. A lint script is
not a command and not a tool for the agent: the linter is what runs it. It can read the vault
but not change it — writing, asking, opening or fetching stops it with an error — so a note only
changes through the text its fix returns, when you or the agent apply the fix.

## Chat interceptors

A script whose header says `// @interceptor` can stand in front of an agent. Pick it as the
**Interceptor** in the agent's settings, or in one chat's settings. Each message you send there
reaches the script first, as `message`, with the chat around it as `chat`: the conversation so
far, what is attached, the note open in the editor and the agent's settings. What the script
returns decides what happens:

```js
// @name Quick tasks
// @interceptor 10

// Picked with "Only messages matching" set to ^/todo
const task = message.text.replace(/^\/todo\s*/, '')
const line = '- [ ] ' + task + '\n'
const text = await read('Tasks.md').catch(() => null)
if (text === null) await create('Tasks.md', line)
else await write('Tasks.md', text + line)
return { reply: 'Added: ' + task }
```

Return nothing to send the message as it is, a text to send that instead, `{ reply }` to answer
it yourself, or `{ hold: 'why' }` to keep it back as a draft. Beside a send, `approve` and
`deny` answer for you on the actions the agent takes for that message: `approve: ['edit']`,
`approve: true`, or a function that looks at each one. The full list is in the script reference.

The number after `@interceptor` is how many seconds the script may take, 30 if you leave it out.
A script that fails, takes longer, or waits to be confirmed on this device never loses your
message: it goes to the agent as you wrote it, with the reason under it. An interceptor script is
not a command and not a tool for the agent.

## CSS snippets

Choose a snippets folder in **Settings → Abele → Other**. The CSS files in it are loaded, and
reloaded as you edit them. **Create CSS snippet** makes a new one; **Reload CSS snippets** loads
them all again.
