# Groups and the note footer

How notes belong to each other through `groups`, and the lists the plugin draws under a note.

## Groups

`groups` is a frontmatter property holding links to the notes this one belongs to:

```yaml
groups:
  - "[[Garden]]"
  - "[[2026 Projects]]"
```

It is a graph, not a folder tree. A note can belong to several groups, and a group can belong to
another group. A tomato plant can be in `Garden`, and `Garden` in `Home`. Everything the plugin
shows about `Home` then includes the tomato too.

Groups decide what appears under a note, which tasks and transactions count towards a project,
where tracked time adds up, and which notes an AI agent may open.

**Create note in group** makes a new note that already belongs to the note you are in. It is also
in a note's right-click menu.

## The footer

Under every note, Abele draws what is connected to it. A list appears only when it has something
in it:

- **Tasks**: tasks linked to this note, open ones without a date first.
- **Calendar tasks**: dated tasks, by day.
- **Transactions** and, on an account note, a balance chart.
- **Time entries**: time tracked against this note.
- **Backlinks**: notes that link here or list it in `groups`, as cards.
- **Logs**: paragraphs written about this note elsewhere. See [Logs](logs-and-journals#logs).
- **Chats**: AI chats that changed this note or were attached to it.

The task, transaction and log lists have a search box, which looks through everything in that
list, and tasks can be filtered by label.

## Cards: description and cover

A backlink card shows two optional properties of the note it stands for:

- `description`: a sentence on what the note is. The card shows its first two lines.
- `cover`: a picture, as `"[[poster.jpg]]"`, a vault path or a web address.

They are worth filling on notes linked from many places, such as people, places and films.
**Set cover from first image/video in note** fills `cover` for you.

## The note header

Above a note, Abele can show buttons: a timer button on notes you track time for (see
[Time tracking](time-tracking)), and buttons that run your scripts on this note (see
[Header buttons](scripts#header-buttons)).
