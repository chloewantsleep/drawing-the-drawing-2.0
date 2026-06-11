# dtd2 · minimal diffusion prototype

The smallest *honest* diffusion model for this project — a research toy that
shows the procedural tool can bootstrap a **generative ML** model.

> Branch: `min-diffusion`. This is a prototype, kept separate from the main app.

## The idea (teacher → student)

1. **Teacher** — the project's hand-written adjacency rules generate thousands of
   plausible apartment layouts.
2. **Student** — a tiny diffusion model (DDPM) learns the *distribution* those
   layouts form, then samples brand-new ones from pure noise.

The model never sees the rules directly. It learns "what a good apartment looks
like" from examples and reproduces the structure — e.g. it discovers that the
kitchen tends to sit by the living room and the bathroom by the bedroom, because
those pairs dominate the training data.

## Scope (deliberately minimal)

- **One scene** (Apartment), a **fixed set of 4 rooms** `[living, bedroom, bathroom, kitchen]`.
- Learns **only room centres** → an **8-D** vector (4 rooms × x, y). Sizes/types are fixed by index.
- **~23k-parameter MLP** denoiser, **50** diffusion steps. Trains on **CPU in ~1 min**.

This is the floor: below "4 room positions" the distribution gets too trivial to
be worth learning. It's enough to demonstrate the pipeline, not to design real plans.

## Run

```bash
pip install -r diffusion/requirements.txt      # torch + numpy (already in conda base here)
python diffusion/diffuse.py                     # rules → data → train → sample
```

It writes `public/diffusion/samples.json`. View the results in a browser:

```
public/diffusion/viewer.html      # opens the generated layouts as a gallery
```

On the deployed site that's `…/diffusion/viewer.html`.

## Files

| File | Role |
|---|---|
| `diffuse.py` | data generation + DDPM + training + sampling, in one file |
| `../public/diffusion/viewer.html` | browser gallery of the generated layouts |
| `../public/diffusion/samples.json` | committed sample output (so the viewer works without Python) |

## How it would scale up (knobs, in order)

fixed 4 rooms → **variable room count** (add a mask) → **add sizes** `w,h` →
**add room types** (one-hot) → **condition on the adjacency table** →
swap the MLP for a **set-transformer** (the DiffuScene-style backbone).

Each knob makes it stronger and heavier. The current version intentionally turns
all of them off.

## Honest caveats

- It learns the distribution the **rules** define — so it can't (yet) discover
  patterns the rules don't already contain. Mixing in a real dataset
  (e.g. CubiCasa5K) is the next step toward genuine novelty.
- Small model + CPU = "you can clearly see it learning", not production quality.
