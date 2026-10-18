# Maps in Bases

Choose **Abele map** in a Base's view selector. It is a separate view type (`abele-map`), so
Obsidian Maps can remain enabled. Existing `map` views continue to belong to Obsidian Maps.
Switch a view yourself when you want to use Abele; opening a map never converts a Base or
rewrites its notes.

Select a coordinates property or formula in the view options. Coordinates can be a string
such as `"12.5, 24.5"` or a list `[12.5, 24.5]`, in latitude, longitude order. Zero is valid.
Missing, invalid or failed formula values are listed under the skipped-notes badge; they do
not become points at the origin. Bases evaluates formulas, filters, sorting and its toolbar
search. The map shows only the Base's current results.

Optional marker-icon and marker-color properties can also be formulas. Icons use the
registered Obsidian icon names, including Lucide icons. An unavailable icon becomes a dot.
Nearby places are grouped by default; turn off **Group nearby places** for separate markers.
Click a group to zoom in, or choose among places sharing one position.

Hover a marker on a computer to inspect the selected properties. Click to open the note;
use the usual modifier key to open another tab. The marker menu offers opening actions,
coordinate copying and deletion with confirmation. On a phone, tap opens a place card with an **Open** action. On a computer, choose
**Place card** from the marker menu to read it without leaving the map.

Right-click the map (press and hold on a phone) to create a note there, copy coordinates,
set the view's default centre or save its zoom. Creating a note uses Bases' native new-note
flow. When coordinates come from a formula, choose an ordinary note property first;
cancelling creates nothing. Camera movements are temporary until explicitly saved.

Add named backgrounds in **Settings → Abele → Other → Maps**. A background accepts a style
URL or raster tile templates; multiple templates draw multiple layers. Dark URLs are optional:
without them the light background is also used in dark mode. Per-view `mapTiles` and
`mapTilesDark` remain supported. Backgrounds can be copied from Obsidian Maps without changing
its settings. The layers button switches backgrounds for the current open map.
Style URLs in a `.base` file and the built-in defaults load through the browser and require
the provider to allow cross-origin requests. Named settings backgrounds can load style JSON
through Obsidian’s network API; their tiles, fonts and sprites still load through the browser.

The location button requests permission and follows your position. Panning pauses following;
press the button to resume, or press while following to stop. Closing the map releases its
location watch. **Copy current location coordinates** is also available in the command palette.

Backgrounds require a connection to their provider; no offline regions are downloaded.
When a background fails, places remain available and **Try again** reloads the background.
Map rendering requires WebGL graphics acceleration.

The place card shows the selected properties, read-only note content and pictures from
Abele galleries. Tap a picture to open the gallery viewer; closing it returns to the same
card. Missing pictures, deleted notes and read errors are shown in the card. The dialog keeps
**Open** visible while a long note scrolls.

Use the panel glyph to show **List beside the map**. On a phone, the list and map are two
faces switched with the list/map glyph. Selection, native Bases search and camera stay in
place when switching. Select a row to reveal its marker outside nearby groups; selecting a
marker highlights its row. At identical coordinates, the selected mark sits apart from the remaining
group so both remain accessible. Its stored coordinates stay the same. Use its menu to open
the card on a computer.

The sort menu offers the Base’s order, distance from the map centre, or distance from your
location when available. Distances are straight-line distances, not routes. Moving the map
keeps the current list order: the refresh glyph sorts from the new centre when you choose.
