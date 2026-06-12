# dtd2

A browser-based floor-plan sketching tool. Draw rooms, snap them together, merge
them into irregular shapes, label and dimension them, and let the tool predict the
next room to add based on the scene type (Apartment / Office / Mall).

## Files / what's what

| File | Role |
|---|---|
| `dtd2.html` | The pure-frontend sketcher + next-room **prediction** (all client-side). |
| `dtd2.1.html` | Same sketcher **plus** Plan mode (walls + doors from the backend) **plus** a built-in **讲解 / Explain** layer that narrates the algorithm live. |
| `arch.js` | The wall/door **generation algorithm** (pure geometry, no DOM). |
| `server.js` | Zero-dependency Node backend: serves the app + `/api/arch`, `/api/config`, SSE live-sync. |
| `tuner.html` | Parameter dashboard — sliders + adjacency matrix that live-tune `arch.js`, plus a Procedural/Diffusional view of both algorithms. |
| `api/arch.js`, `api/config.js` | Vercel serverless versions of the API (so it deploys without `server.js`). |
| `diffusion/diffuse.py` | Trains a tiny diffusion model (DDPM) on rule-generated layouts; exports weights to `model.json`. |
| `public/diffusion/viewer.html` | Gallery of generated layouts with a Raw / Refined toggle. |

## How diffusion and procedural cooperate

Two engines, one loop. **Procedural** is the deterministic, explainable side
(hand-tuned adjacency rules → prediction + wall/door geometry). **Diffusion** is the
generative ML side (a tiny DDPM that samples new layouts from noise). They don't
compete — the rules **teach, judge, and clean up** the model, and the model gives the
rules something they lack: sampling from a learned distribution.

```
            ┌──────────────────────── PROCEDURAL (rules) ────────────────────────┐
            │  adjacency table + arch.js geometry — deterministic, explainable    │
            └─────────────────────────────────────────────────────────────────────┘
                 │ ①  teacher: rules score & generate                ▲
                 │     thousands of plausible layouts                │ ③  rules clean up:
                 │     (diffuse.py · gen_data)                       │     snap floating centres
                 ▼                                                   │     into a wall-sharing plan,
            ┌──────────────────── DIFFUSION (learned) ──────────┐    │     add missing rooms,
            │  tiny DDPM learns the *distribution* the rules     │    │     then arch.js draws walls
            │  imply, then samples NEW layouts from pure noise   │────┘     (_gRefine / viewer refine)
            └────────────────────────────────────────────────────┘
                 │ ②  student: denoise noise → room centres
                 ▼
            a brand-new arrangement the rules never enumerated
```

**The three hand-offs**

1. **Rules → data (teacher).** `diffusion/diffuse.py` has no external dataset. `gen_data()`
   scores every room arrangement against the project's adjacency table and samples ~8000
   plausible apartments. The model trains on those — so it learns the distribution the
   rules define.
2. **Diffusion generates (student).** The DDPM denoises random noise into 4 room *centres*
   (an 8-D vector). This is real sampling, not enumeration — it produces arrangements that
   were never in a lookup table.
3. **Rules render & complete (clean-up).** The model's centres float and don't share walls,
   so the rules snap them into a gap-free, wall-sharing plan (`_gRefine` in `dtd2.1.html`,
   `refine` in the viewer). In the main app's **Generate** button the rules then add the
   rooms the 4-room model doesn't know (a dining beside the kitchen, a corridor), and
   `arch.js` draws the walls and doors.

**Why pair them:** the rules solve diffusion's two weak spots (no training data → rules make
it; messy output → rules tidy it), while diffusion gives the rules sampling/novelty they
can't do alone. Evidence it works: in ~19/24 generated samples the model keeps the kitchen
next to the living room and the bathroom next to the bedroom — the two strongest adjacencies
in the table — even though it was never shown the rules directly.

**See it three ways:** `/diffusion/viewer.html` (Raw vs Refined toggle), `/tuner`
(Procedural / Diffusional tabs over one canvas), and the main app's **Generate** button
(the full pipeline on the drawing canvas).

## Run locally

```bash
node server.js                 # → http://localhost:5178  (app)
#                                 → http://localhost:5178/tuner  (parameter dashboard)
```

Or open `dtd2.html` directly (frontend-only; Plan mode needs the server).

## 讲解 / Explain layer (for walking someone through how it works)

In `dtd2.1.html`, click **讲解** in the top bar (or press **X**). A side panel opens and:

- **Section 1 — Prediction**: for the current scene + rooms it shows each suggestion's
  `type fit`, `wall fit`, the adjacency-weight sum behind it, and the formula
  `confidence = type fit × (0.6 + 0.4 × wall fit)`.
- **Section 2 — Walls + doors**: in Plan mode it shows live counts (wall runs, ext/int,
  doors) and walks the 6-stage pipeline (split → classify → merge → open doors →
  connectivity net → entrance).
- **▶ 演示 (Demo)**: one click auto-plays the whole story — pick a scene, accept a few
  predictions, then switch to Plan mode — narrating each step.

## Deploy on Vercel

The repo is Vercel-ready (`vercel.json` + `api/*.js`). Import it on vercel.com (or run
`vercel`). Caveat: the tuner's **save/live-sync** relies on a writable filesystem + SSE,
which Vercel's serverless functions don't provide — on Vercel the config is read-only
(falls back to `arch.js`'s `DEFAULT_CONFIG`). Wall/door generation and prediction work
fully. For live tuning, run `server.js` locally.

## Core concepts

- **Scenes** — pick Apartment, Healthcare, or Mall. Each scene defines room types
  (with colors and typical sizes) and an adjacency model used for prediction.
- **Rooms** — rectangles (axis-aligned, or irregular polygons after merging).
  Color and room type are **independent**: the right-click palette only recolors,
  while **renaming** a room to a type name (e.g. "Study") assigns that type and its
  color. Only typed rooms feed the prediction model.
- **Merge** — select 2+ rooms and press `Enter` to union them into one shape.
  Merged shapes become editable polygons; irregular (slanted) edges are preserved.
- **Prediction** — with a scene active, the tool suggests the next likely room as
  dashed ghosts on canvas (each showing a **confidence %** + bar) and via a radial
  picker on middle-click / `E`. `Esc` dismisses the dashed suggestions.

## Controls

| Action | Input |
|---|---|
| Rectangle tool | `R` / `V` |
| Line tool | `L` |
| Pan | `H`, or hold `Space`, or middle-drag |
| Zoom | `Cmd/Ctrl` + scroll, or `+` / `-` |
| Fit to screen | `F` |
| Toggle grid | `G` |
| Toggle unit (px / ft) | `T`, or the `unit` button |
| Next-room picker (radial) | middle-click, or `E` |
| Accept suggestion 1 / 2 / 3 | `1` / `2` / `3` |
| Dismiss prediction ghosts | `Esc` |
| Merge selected rooms | `Enter` |
| Marquee add to selection | `Shift`-drag empty space |
| Select all | `Cmd/Ctrl` + `A` |
| Copy / Paste / Duplicate | `Cmd/Ctrl` + `C` / `V` / `D` |
| Undo / Redo | `Cmd/Ctrl` + `Z` / `Shift`+`Z` |
| Delete | `Del` / `Backspace` |
| Rename a room | double-click it |
| Edit a dimension | click the orange dimension label |

## Editing shapes

- **Plain rectangle** — drag a corner to scale (`Shift` locks aspect ratio,
  `Alt`-drag a corner to free-reshape into a polygon). Drag an edge to resize that
  side; click an edge to set its wall type (default / thick / glass / opening).
- **Merged polygon** — drag a bounding-box corner to scale, drag a vertex to
  reshape, or **drag a wall edge to move that whole wall**. The `+` buttons on each
  side duplicate the shape.
- **Color** — right-click a room and pick a swatch to recolor it. This never
  changes the room-type name; to change the type (and auto-apply its color), rename
  the room to a type name.

## How the prediction % works

The confidence shown on each suggestion is a **deterministic heuristic** — no LLM,
no network. It combines two signals:

- **Room-type fit (dominant)** — sums the scene's adjacency weights between the
  existing rooms and the candidate type, penalized if you already have several of
  that type or hit its max count, then normalized against the strongest suggestion.
- **Placement fit (modifier)** — how fully the candidate shares a wall with its
  neighbor (shared length / shorter touching side). A snug wall keeps the full
  score; a barely-touching spot attenuates it down to ~60%.

Room **size** is just the type's typical dimensions (not part of the %), and the
preference for placing next to the *selected* room steers *where* a suggestion goes
but is excluded from the confidence.

## Recent changes

- **Confidence is placement-aware** — the % now reflects how good the *specific*
  suggestion is (type fit × wall fit), and is **visualized on canvas** as a number
  and a bar inside each ghost.
- **Color detached from room type** — recoloring no longer renames; renaming to a
  type re-applies its color.
- **Merge preserves irregular shapes** — slanted / non-orthogonal walls survive a
  merge (general polygon union); axis-aligned merges keep the original fast path.
- **Prediction survives merges** — merged (polygon) rooms still feed the model.
- `Esc` **dismisses** the dashed prediction ghosts.
- **Bounding dimensions restored** on merged shapes; **room labels recentered**
  with a true interior centroid; **merged-shape walls are draggable**.
- Removed the **Grid / Snap / Export SVG** top-bar buttons (grid still toggles with
  `G`); the **ft** toggle is now labelled **unit**.
- Removed the crosshair drawing cursor and the yellow grid-snap marker.
