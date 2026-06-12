# drawing-the-drawing 2.0

A browser-based floor-plan tool where **two engines design rooms together**:

- **Procedural** — hand-tuned adjacency rules that predict the next room, place rooms
  sensibly, and generate walls + doors. Deterministic and fully explainable.
- **Diffusion** — a tiny generative ML model (DDPM) that learns the distribution those
  rules imply and samples brand-new layouts from noise.

The rules **teach, judge, and clean up** the model; the model gives the rules something
they lack — sampling from a learned distribution. The whole thing runs in the browser
(the diffusion model too) with a zero-dependency Node backend for the wall/door geometry.

**Live:** https://drawing-the-drawing-20.vercel.app
· [app](https://drawing-the-drawing-20.vercel.app)
· [tuner](https://drawing-the-drawing-20.vercel.app/tuner)

---

## How diffusion and procedural cooperate

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

1. **Rules → data (teacher).** `diffusion/diffuse.py` has no external dataset. `gen_data()`
   scores every room arrangement against the adjacency table and samples ~8000 plausible
   apartments. The model trains on those — it learns the distribution the rules define.
2. **Diffusion generates (student).** The DDPM denoises random noise into 4 room *centres*
   (an 8-D vector). Real sampling, not enumeration — arrangements that were never in a table.
3. **Rules render & complete (clean-up).** The model's centres float and don't share walls,
   so the rules snap them into a gap-free plan, add rooms the 4-room model doesn't know
   (a dining beside the kitchen, a corridor), and `arch.js` draws the walls and doors.

**Why pair them:** the rules solve diffusion's two weak spots (no training data → rules make
it; messy output → rules tidy it); diffusion gives the rules sampling/novelty. Evidence it
works: in ~19/24 generated samples the model keeps the kitchen next to the living room and the
bathroom next to the bedroom — the two strongest adjacencies in the table — though it was
never shown the rules directly.

---

## The app (`dtd2.1.html`)

Pick a **scene** (Apartment / Healthcare / Mall); each defines room types (colors, typical
sizes) and an adjacency table. Then:

| Feature | What it does |
|---|---|
| **Prediction** | With a scene active, dashed "ghost" rooms suggest the next room, each with a **confidence %**. Press `E` / middle-click for a radial picker. |
| **Type** | Type a program — *"living, kitchen, 2 bedroom, bathroom, corridor"* — and the placement engine lays it out (adjacency-aware, parses counts & synonyms, infers the scene). No API. |
| **Demo** | A side panel that narrates the algorithm live + a ▶ Demo that auto-plays scene → predict → place → walls. |
| **Generate** | Runs the trained diffusion model in-browser, refines the output into a wall-sharing apartment, and drops it on the canvas. |
| **Plan** (`B`) | Sends the layout to the backend; `arch.js` returns walls + doors and the app draws them. |
| **Edit** | Select a room → a floating icon bar (rename / duplicate / rotate / mirror / color / delete). Free rotation handle, drag-to-resize, merge with `Enter`. |

### Controls

| Action | Input |
|---|---|
| Rectangle / Line tool | `R` `V` / `L` |
| Pan · Zoom · Fit | `H` or Space-drag · `Cmd`+scroll or `+`/`-` · `F` |
| Type-to-generate · Demo panel · Plan | `Type` button · `X` · `B` |
| Next-room picker · accept 1/2/3 | `E` / middle-click · `1` `2` `3` |
| Rotate (free) | drag the handle above a selected room (`⇧` snaps 15°) |
| Merge selected · Select all | `Enter` · `Cmd`+`A` |
| Copy / Paste / Duplicate · Undo / Redo | `Cmd`+`C`/`V`/`D` · `Cmd`+`Z`/`Shift`+`Z` |
| Delete · Rename · Toggle unit / grid | `Del` · double-click · `T` / `G` |

## The tuner (`tuner.html`)

The operating console for both engines, side by side:

- **Procedural** — sliders for door/wall params + an editable **adjacency heatmap**; a live
  wall/door preview and a **next-room prediction** that re-ranks as you edit the matrix.
- **Diffusional** — a gallery of **24 samples all animating their own diffusion at once**
  (noise → room centres → rule-refined plan), with a **Raw / Refined** toggle. Fullscreen (`⤢`).
- Collapsible + draggable left panel.

## How the prediction % works

A deterministic heuristic — no LLM, no network:

- **Type fit (dominant)** — sums the scene's adjacency weights between existing rooms and the
  candidate type, penalized for duplicates / max counts, normalized against the best suggestion.
- **Wall fit (modifier)** — how fully the candidate shares a wall with its neighbor.

```
confidence = type fit × (0.6 + 0.4 × wall fit)
```

---

## Run locally

```bash
node server.js          # → http://localhost:5178  (app)  ·  /tuner  (console)
```

Re-train the diffusion model (optional; weights are committed):

```bash
pip install -r diffusion/requirements.txt      # torch + numpy
python diffusion/diffuse.py                     # rules → data → train → model.json + samples.json
```

## Files

| File | Role |
|---|---|
| `public/dtd2.1.html` | The main app (everything above). |
| `public/dtd2.html` | Earlier pure-frontend sketcher + prediction (no backend). |
| `public/tuner.html` | Procedural / Diffusional console. |
| `arch.js` | Wall + door **generation** (pure geometry, no DOM). |
| `arch-config.json` | Tunable params + per-scene adjacency tables. |
| `server.js` | Zero-dependency Node backend (`/api/arch`, `/api/config`, SSE live-sync). |
| `api/arch.js`, `api/config.js` | Vercel serverless versions of the API. |
| `diffusion/diffuse.py` | Trains the DDPM on rule-generated data; exports `model.json`. |
| `public/diffusion/` | `model.json` (browser weights), `samples.json`, viewer → redirects to `/tuner`. |
| `vercel.json` | Routing + no-cache HTML headers. |
