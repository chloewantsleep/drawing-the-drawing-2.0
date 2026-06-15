# Wall & Door Generation

All of this lives in [`arch.js`](../arch.js), in `genArch(shapes, sceneKey, cfg)`.
It is **pure geometry — no DOM**. The backend (`server.js`) and the tuner both
call it; the frontend never runs it and only renders the result.

## Input / Output

**Input**

- `shapes` — room rectangles: `[{ type:'rect', x, y, w, h, roomType }]` (an
  optional `poly` overrides the rectangle).
- `sceneKey` — which scene's adjacency matrix to use (`apartment`, `healthcare`,
  `mall`, `facade`, …).
- `cfg` — the tunable config (wall thickness, door width, threshold, the
  per-scene adjacency matrices).

**Output**

```js
{ runs: [ { ax, ay, bx, by, kind:'ext'|'int', len, nx, ny, t, door } ] }
```

Each `run` is one wall segment. `door` is `[c0, c1]` — the opening interval
measured along that wall — or `null` when there is no door.

---

## Part 1 — Walls (4 steps)

### 1. Split edges into minimal segments

Collect all four edges of every room. For each edge, find every point where
another edge crosses or touches it (`segSegOnAB`) and **cut it into minimal
sub-segments** at those points. This makes shared boundaries between adjacent
rooms line up exactly.

### 2. Classify: exterior vs. interior

For each minimal segment, take its midpoint, step a tiny offset to each side
along the normal, and use `pointInPoly` to ask which room (if any) sits on each
side:

- Empty on both sides → not a wall, discard.
- **Same** room on both sides → discard (it is inside a room, not a boundary).
- A room on one side, empty on the other → **exterior wall (`ext`)**.
- **Different** rooms on the two sides → **interior partition (`int`)**, and we
  record the room `pair`.

### 3. Merge collinear segments

Segments that share the same line + same `kind` + same `pair` are projected onto
the line direction and their overlapping intervals are merged into the **longest
continuous wall run**. So a full partition between two rooms becomes a single
run instead of a pile of fragments.

### 4. Thickness & facing

- `ext` walls get thickness `wallExt` (default 9); `int` walls get `wallInt`
  (default 6).
- The normal `(nx, ny)` is computed, and for `ext` walls it is flipped so it
  points toward the room interior (this decides which way a door swings).

---

## Part 2 — Doors

The door logic is two layers stacked: **adjacency decides where rooms *should*
connect**, and a **connectivity safety net guarantees everything is reachable**.

### 1. Candidate doors

Only `int` walls are considered, and only if a wall is long enough to hold a
door (`len > doorWidth + 24`). For each room pair we keep the **longest** such
wall as the place a door could go (`pairRun`).

### 2. Open doors by adjacency weight

Look up the adjacency weight in the scene's matrix `adj` (taking the larger of
the two directions):

- weight **≥ `doorThreshold`** (default 3) → open a door.
- room types unknown (no `roomType`) → also open a door.

This is exactly what the adjacency matrix in the tuner controls — it directly
decides which kinds of rooms get auto-connected.

### 3. Connectivity safety net (when `connectivity` is on)

A **union-find** structure guarantees every room is reachable from the
entrance. Find the entrance room (the scene's `startType`, otherwise room 0).
While any room is still disconnected, greedily add one more door, scored by:

- the door connects to the component that already contains the entrance →
  `+1e4` (top priority),
- adjacency weight × 100,
- longer wall → `+ len`.

Repeat until everything is connected, so there are no unreachable "island"
rooms.

### 4. Door placement & the entrance door

- A door is centered on its wall run: the interval
  `[(len - doorWidth) / 2, (len + doorWidth) / 2]`.
- The **entrance door** is placed on the longest **exterior** wall of the
  entrance room (or the longest exterior wall overall if there is no entrance
  room).

---

## Tunable parameters (the tuner sliders)

| Parameter        | Default | Effect                                                        |
| ---------------- | ------- | ------------------------------------------------------------- |
| `doorWidth`      | 40      | Door opening width (world units; 20 = 1 ft).                  |
| `wallExt`        | 9       | Exterior wall thickness.                                      |
| `wallInt`        | 6       | Interior wall thickness.                                      |
| `doorThreshold`  | 3       | Minimum adjacency weight needed to auto-open a door.          |
| `connectivity`   | true    | Whether the connectivity safety net runs.                     |
| `scenes[].adj`   | —       | Per-scene room adjacency matrix.                              |

---

## In one sentence

**Walls** come from geometrically cutting, classifying, and merging the room
rectangle boundaries; **doors** come from two layers — "the adjacency matrix
decides where rooms should connect" plus "a connectivity safety net ensures
every room stays reachable."
