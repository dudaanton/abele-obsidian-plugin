# Comments

Your own comments on note text, and AI discussions anchored to a passage of a note, a message
in a chat, or words in a book.

## Adding your own comment

Select text in an ordinary note and choose **Add comment** in the editor menu or run
**Abele: Add comment**. In reading mode, select the words and use the command palette.
Choose a highlight colour or **Underline**, write in the full note editor, then press **Save**
(or Cmd/Ctrl+Enter). Enter starts a new line. This needs no AI provider, model or enabled AI.

A square speech-bubble mark opens the comments in both Live Preview and reading mode. The
round speech bubble still opens **Ask here**; if a passage has both, each has its own mark and
count. Add another entry in the same dialog to keep several comments stacked together.
Selecting the same passage again opens its existing thread.

Each entry shows its local creation date and time, and its edit time when changed. **Edit**
changes only that entry; **Delete** asks for confirmation. Removing the last entry removes the
mark, not the words in your note. Save a colour change without adding a new entry, too.
Closing with unsaved text or appearance asks before discarding it. A failed save keeps your
text in the dialog; a comment changed elsewhere must be reopened before you can overwrite it.
Text typed while deletion is in progress stays in the dialog, even if the thread was deleted.

The mark follows insertions before the passage and note/folder renames. If the words change
or disappear, the dimmed mark still opens the comment, but no longer claims a highlight over
different words. Some Markdown or content rendered by other plugins cannot be mapped safely: the mark
remains available without guessing which repeated text to highlight.

Comments are kept in separate `.abcomment` files in the configured comments folder (default
`AI/Comments`), not in chat history. If you remove a mark by hand, its comment file stays and
can be opened from that folder. **Republish marker** restores an unlinked saved thread without
creating another entry. For repeated passages, select the exact occurrence in the note and
choose **Add comment** to reopen that thread and republish there. If the original words no longer
exist, restore them first or create a new comment; recovery does not guess a replacement passage. Sync other file types in Obsidian Sync so these files reach
your other devices along with the note.

## Asking about a passage

Select some text in a note and choose **Ask here** from the right-click menu, or run
**Comment here**. The comment opens as a tab in the chat sidebar, on the comment agent, and a small
mark is left in the note after the passage. Without a selection, the comment is about that place
in the note.

The comment's agent can see this note and can edit the passage it is about. Press the mark to
open the conversation again. One comment is shown at a time: pressing another mark replaces it.
The comment agent and the folder comments are saved in are set on the **General** tab of the AI
settings. A discussion keeps the identity its note marker uses when its conversation file is
renamed; reopening and closing it still use the same discussion owner after restart.

## Keeping notes without asking

In a comment, **Alt+Enter** keeps what you typed as a note, without sending it to the agent.
A comment can be a set of margin notes that no agent ever answered.

## Comments inside a chat

Select words in any message of a chat, yours or the agent's, and choose **Ask here** — from the
right-click menu on a computer, or on a phone from the small bar that comes up under the words
once you lift your finger. A comment
opens on that message, on the chat's own agent, and knows what was said before it. A message in a
comment can be commented on in turn, to any depth. The trail at the top of a comment leads back
up. Both the back arrow and a level in the trail return to the selected words inside the parent
reply, briefly marking just that passage—even far down a long answer. Repeated words use the
recorded selection position. If those words have disappeared, or the comment was on the whole
message, you return to the message instead.

## Opening a comment as a full chat

A comment is an ordinary chat underneath. When a question turns into real work, open it as a full
chat and carry on there: it joins the chat history. The mark stays in the note and still leads to
it.

## Books

Words selected in the book reader can be asked about the same way. The discussion is kept with
the book's highlights. See [Books](books).

## Keeping a message in a note

**Insert into note** in a message's actions puts a card with the message into the note you were
working in. Pressing the card opens the chat at that message.

## What not to do

Do not edit or move the marks in the text by hand, such as `%%c:k7d2ph%%`. Editing the text
around them is fine. Deleting an AI discussion deletes every discussion under it; deleting a
free-form entry leaves the other entries in its thread.
