# Ābele Obsidian plugin

An Obsidian plugin that adds a lot of functionality I personally find missing:

- Tasks
- Calendar
- Journals
- Logs
- Templates
- Various helper tools, etc.

I've been working on this plugin for several years. Originally, it was more of a collection of helpers that were hard to adapt to workflows different from my own. It was also heavily dependent on the Dataview API. Recently, I decided to rewrite it from scratch to make it more universal and as independent as possible from other plugins. My goal is to consolidate all the functionality I need into a single plugin.

## Features

Currently, the plugin has the following features.

### Logs

This is the first and probably the most important feature for my Obsidian workflow. Logs are individual paragraphs or entire notes that are displayed in full, in chronological order, within related notes. I write most of my notes in daily notes. For example, I can write something like:

```
Met with [[John]] and [[Anna]] at [[Coffee House]], then went to the movies to watch [[Interstellar]]
```

and this entry will appear in the timeline of each linked note — `[[John]]`, `[[Anna]]`, `[[Coffee House]]`, and `[[Interstellar]]` — so when I visit them, I'll know the context and when I interacted with them.

What's also important is the cross-linking of logs, tasks, and other notes. My notes are grouped using the frontmatter property `groups`. For example, `[[Interstellar]]` would have a `groups` link to `[[Movies]]`, and if I visit Movies, I'll see in chronological order which movies I watched and when, along with the context.

As mentioned above, logs can be individual paragraphs or entire notes. If a link to a related note is only in the note's text, only that paragraph will be displayed in the logs of the related note. But you can make an entire note a log by linking it via the `groups` property. This is how I write meeting reports, for example, since they usually span more than one paragraph.

### Tasks

There are many ways to manage tasks in Obsidian. I used to use the excellent Tasks plugin, which treated markdown checkboxes as tasks and allowed managing them via Dataview. It was generally convenient, and its functionality was enough for me for a long time, but eventually I decided to switch to a more Obsidian-native approach.

In Ābele, tasks are notes. All their information — deadlines, completion status, creation date, etc. — is stored in their properties. Tasks are displayed in several ways: in the general timeline, in related notes, in daily notes, and as a general list. I intentionally avoided complicating them with priorities, nesting, tags, etc., as I find these distracting. I currently have over 1000 tasks (both open and closed) in Obsidian, and I no longer maintain any other personal task lists anywhere. I find this approach maximally effective.

Having tasks as separate notes allows for very detailed descriptions, attaching all necessary information. The automatic title setting makes it possible to write titles with links to other notes, so the task appears in all relevant contexts.

### Journals

Besides daily notes, I keep monthly and yearly ones, as well as a separate daily health journal where I collect data exported from Apple Health — and I don't want to mix it with my main journal. To manage them effectively, navigate between adjacent notes, quickly create them, and have quick access to them, I developed the journals functionality. It groups notes belonging to one journal, automatically creates them using configurable paths for each journal, allows switching between multiple journals for a specific date, opens them via calendar click, and shows which dates have journal notes and open tasks.

### Templates

For templates, I used to use the powerful Templater plugin for Obsidian. Personally, I didn't find it very convenient, and it seemed unsafe since it executed JS directly from notes. I wanted a more lightweight solution with more convenient template selection, so I wrote my own templating implementation. It's functional now but will be expanded further.

### Find and replace

In addition to the above functionality, the plugin also includes a very powerful find-and-replace tool for note contents. I created it to facilitate vault migration between different structures.

When I first started using Obsidian, out of habit I created many different root and nested folders, trying to organize my vault that way. But over time, I started relying heavily on internal links and increasingly navigated to notes from the context of other notes. I also read [@kepano's approach](https://stephango.com/vault) to organizing his vault and decided to switch to an almost completely flat structure. Almost all my notes (except journal ones, located in `Journals/YYYY` folders) are in a single `Notes` folder. At the time of migration, my vault had around 6000 notes, so I needed a flexible tool that could bulk-update note properties based on their directories, move them, add new properties (including link and list types), merge values of multiple properties, replace text in notes containing specific properties, and much more.

For these purposes, I wrote the find-and-replace module, which works with conditions, allows smart frontmatter property replacement, and much more.

## Roadmap

The plugin currently implements only a portion of the functionality I planned during the design phase. In my first version of the plugin, I used a custom backend built on Strapi for uploading media to my server, creating Anki language cards using LLM, loading content from social networks, viewing images, and much more. The old version also had AnkiConnect integration, which I want to port to this version in a more universal way. Additionally, I planned to add better image gallery handling and optional, transparent LLM functionality. All of this will be implemented in the near future.

## Development approach

The core of the plugin was written by me manually (~90% at the time of publishing the code on GitHub was written without LLM code generation). Over the past six months, I've started using LLM more actively in my work, so some code is now LLM-generated. However, I don't use agents (my workflow is based on CodeCompanion in Neovim), as I still consider them unreliable, and I review generated code in real time. In any case, I think it's right to mention this here.

The plugin is currently in very active development, so bugs are expected. I also haven't written detailed documentation yet. However, if you want to try it and can't get it running, please open an Issue — I'll try to help.

## Installation

TODO

## License

[GPL-3.0](LICENSE)

---

And yes, this README was translated by an LLM, so if you notice any inaccuracies — please let me know.
