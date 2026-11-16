# Interactive Story Planner

A planner for branching, choose-your-path stories. Instead of trying to show the whole story at once, the map shows the part around where you are, like a mind map:

- **Comes from** (top): scenes that lead into the current one
- **You are here**: the scene you're working on
- **1–3 steps ahead** (below): where the choices lead

Tap any scene, or any choice label, to move there. Use **← Back** and **Forward →** (or Alt+←/→) to go back to where you just were, the same way a web browser does. The breadcrumb trail under the toolbar lets you jump several steps back at once.

## Running it

Open `index.html` in a browser. It needs no install and no server.

## Features

- **Edit as you go**: the side panel edits the current scene's title, text, private notes, and choices.
- **Add choices**: "+ Choice → new scene" creates a new branch. "+ Link to existing scene" connects to a scene you've already written, for paths that merge or loop back.
- **"+N" badges**: a scene with connections that don't fit on screen gets a "+N ›" badge. Click the scene to go there and see them.
- **Loops** (choices that lead back to an earlier scene) appear as dashed amber arcs marked ↺.
- **Jump to a scene**: the dropdown lists every scene and flags the start, the endings, and any **unreachable** scenes (scenes no path leads to).
- **Vertical or horizontal**: the ↕ / ↔ button switches the map between top-to-bottom and left-to-right. Each device remembers your choice.
- **Pan and zoom**: drag the map to pan, and scroll or pinch to zoom. ◎ re-centers the map.
- **Saving**: your work saves automatically in the browser. **Export** downloads the story as JSON and **Import** loads it back. Export regularly to keep a backup.

## Story file format

```json
{
  "title": "My Story",
  "startId": "start",
  "scenes": {
    "start": {
      "id": "start",
      "title": "Beginning",
      "text": "…",
      "notes": "",
      "choices": [{ "id": "c1", "label": "Open the door", "to": "hall" }]
    }
  }
}
```

A scene with no choices is an ending.
