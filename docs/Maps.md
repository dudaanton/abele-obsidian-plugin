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
coordinate copying and deletion with confirmation. On a phone, tap opens the note.

Right-click the map (press and hold on a phone) to create a note there, copy coordinates,
set the view's default centre or save its zoom. Creating a note uses Bases' native new-note
flow. When coordinates come from a formula, choose an ordinary note property first;
cancelling creates nothing. Camera movements are temporary until explicitly saved.

Add named backgrounds in **Settings → Abele → Other → Maps**. A background accepts a style
URL or raster tile templates; multiple templates draw multiple layers. Dark URLs are optional:
without them the light background is also used in dark mode. Per-view `mapTiles` and
`mapTilesDark` remain supported. Backgrounds can be copied from Obsidian Maps without changing
its settings. The layers button switches backgrounds for the current open map.

The location button requests permission and follows your position. Panning pauses following;
press the button to resume, or press while following to stop. Closing the map releases its
location watch. **Copy current location coordinates** is also available in the command palette.

Backgrounds require a connection to their provider; no offline regions are downloaded.
When a background fails, places remain available and **Try again** reloads the background.
Map rendering requires WebGL graphics acceleration.
