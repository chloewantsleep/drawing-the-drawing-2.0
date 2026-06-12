#!/usr/bin/env python3
"""
diffuse.py — the smallest honest diffusion model for dtd2.

Scope (deliberately minimal): the Apartment scene, a FIXED set of 4 rooms
[living, bedroom, bathroom, kitchen]. We learn only WHERE each room's centre
sits — an 8-D distribution (4 rooms x, y). Sizes/types are fixed by index.

Pipeline:  rules -> synthetic data -> tiny DDPM (MLP) -> sample -> samples.json
The browser viewer (public/diffusion/viewer.html) renders the samples.

Run:  python diffusion/diffuse.py          (CPU, ~1 min)
"""
import os, json, math
import numpy as np
import torch
import torch.nn as nn

SEED = 0
np.random.seed(SEED); torch.manual_seed(SEED)
DEV = 'cpu'                       # tiny model — CPU is plenty
TYPES = ['living', 'bedroom', 'bathroom', 'kitchen']
DIM = len(TYPES) * 2             # 8-D: (cx, cy) per room

# ── 1. RULES → SYNTHETIC DATA ────────────────────────────────────────────────
# A 2x2 grid of cell centres. Edge-adjacent cell pairs (not diagonals):
CELLS = np.array([[-1, -1], [1, -1], [-1, 1], [1, 1]], dtype=np.float32)  # TL TR BL BR
EDGES = [(0, 1), (0, 2), (1, 3), (2, 3)]
# Symmetric adjacency weights from the project's Apartment table (the "teacher").
W = {('living', 'bedroom'): 3, ('living', 'kitchen'): 3, ('living', 'bathroom'): 1,
     ('bedroom', 'bathroom'): 5, ('bedroom', 'kitchen'): 0, ('bathroom', 'kitchen'): 1}
def wt(a, b): return W.get((a, b), W.get((b, a), 0))

def arrangement_score(perm):
    """How well a type->cell assignment respects the adjacency table."""
    return sum(wt(perm[i], perm[j]) for i, j in EDGES)

def gen_data(n=8000, jitter=0.17):
    """Reject-sample plausible 4-room arrangements, jitter, return (n, 8)."""
    from itertools import permutations
    perms = list(permutations(TYPES))
    scores = np.array([arrangement_score(p) for p in perms], dtype=np.float32)
    probs = scores / scores.sum()           # bias toward plausible layouts
    out = np.zeros((n, DIM), dtype=np.float32)
    for k in range(n):
        perm = perms[np.random.choice(len(perms), p=probs)]
        centres = CELLS + np.random.randn(4, 2).astype(np.float32) * jitter
        idx = {t: i for i, t in enumerate(perm)}            # which cell each type took
        for r, t in enumerate(TYPES):
            out[k, r*2:r*2+2] = centres[idx[t]]
    return out

# ── 2. TINY DDPM ─────────────────────────────────────────────────────────────
T = 50
betas = torch.linspace(1e-4, 0.06, T)
alphas = 1.0 - betas
abar = torch.cumprod(alphas, 0)             # cumulative product of alphas

def t_embed(t, d=32):
    """Sinusoidal timestep embedding."""
    half = d // 2
    freqs = torch.exp(-math.log(10000) * torch.arange(half, device=t.device) / half)
    a = t.float()[:, None] * freqs[None]
    return torch.cat([torch.sin(a), torch.cos(a)], -1)

class Denoiser(nn.Module):
    def __init__(self, d=128, temb=32):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(DIM + temb, d), nn.SiLU(),
            nn.Linear(d, d), nn.SiLU(),
            nn.Linear(d, DIM))
    def forward(self, x, t):
        return self.net(torch.cat([x, t_embed(t)], -1))

def train(data, steps=4000, bs=256, lr=2e-3):
    x = torch.tensor(data, device=DEV)
    model = Denoiser().to(DEV)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    ab = abar.to(DEV)
    for s in range(steps):
        i = torch.randint(0, x.shape[0], (bs,), device=DEV)
        x0 = x[i]
        t = torch.randint(0, T, (bs,), device=DEV)
        noise = torch.randn_like(x0)
        a = ab[t][:, None]
        xt = a.sqrt() * x0 + (1 - a).sqrt() * noise     # forward (add noise)
        loss = ((model(xt, t) - noise) ** 2).mean()     # predict the noise
        opt.zero_grad(); loss.backward(); opt.step()
        if s % 800 == 0 or s == steps - 1:
            print(f"  step {s:>4}  loss {loss.item():.4f}")
    return model

@torch.no_grad()
def sample(model, n=24):
    """Ancestral sampling: pure noise -> denoise step by step -> layouts."""
    ab = abar.to(DEV); b = betas.to(DEV); al = alphas.to(DEV)
    x = torch.randn(n, DIM, device=DEV)
    for t in reversed(range(T)):
        tt = torch.full((n,), t, device=DEV, dtype=torch.long)
        eps = model(x, tt)
        mean = (x - b[t] / (1 - ab[t]).sqrt() * eps) / al[t].sqrt()
        x = mean + (b[t].sqrt() * torch.randn_like(x) if t > 0 else 0)
    return x.cpu().numpy()

# ── 3. EXPORT for the browser viewer ─────────────────────────────────────────
# default room sizes (grid units) — cosmetic, just for drawing the boxes.
SIZE = {'living': [1.5, 1.3], 'bedroom': [1.2, 1.1], 'bathroom': [0.85, 0.95], 'kitchen': [1.15, 1.0]}
def to_layouts(arr):
    layouts = []
    for row in arr:
        rooms = []
        for r, t in enumerate(TYPES):
            cx, cy = float(row[r*2]), float(row[r*2+1])
            w, h = SIZE[t]
            rooms.append({'type': t, 'cx': cx, 'cy': cy, 'w': w, 'h': h})
        layouts.append(rooms)
    return layouts

# ── 4. EXPORT the trained weights so the browser can run diffusion live ───────
def export_model(model, path):
    sd = model.state_dict()
    g = lambda n: sd[n].cpu().numpy().tolist()
    payload = {
        'w0': g('net.0.weight'), 'b0': g('net.0.bias'),   # Linear(40,128)
        'w2': g('net.2.weight'), 'b2': g('net.2.bias'),   # Linear(128,128)
        'w4': g('net.4.weight'), 'b4': g('net.4.bias'),   # Linear(128,8)
        'betas': betas.cpu().numpy().tolist(), 'T': T, 'dim': DIM, 'temb': 32,
        'types': TYPES, 'size': SIZE,
    }
    with open(path, 'w') as f:
        json.dump(payload, f)

def main():
    print("generating synthetic data from the adjacency rules…")
    data = gen_data()
    print(f"  {data.shape[0]} layouts, dim {data.shape[1]}")
    print("training tiny DDPM (CPU)…")
    model = train(data)
    print("sampling…")
    samples = to_layouts(sample(model, n=24))
    pub = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'public', 'diffusion'))
    os.makedirs(pub, exist_ok=True)
    with open(os.path.join(pub, 'samples.json'), 'w') as f:
        json.dump({'types': TYPES, 'layouts': samples,
                   'note': 'generated by a tiny 8-D DDPM trained on rule-based synthetic apartments'}, f)
    export_model(model, os.path.join(pub, 'model.json'))
    # tiny fixed-input check so the JS port can be verified against this run
    model.eval()
    with torch.no_grad():
        xt = torch.zeros(1, DIM); tt = torch.tensor([10])
        print("verify denoise(x=0,t=10)[:4] =", [round(v, 5) for v in model(xt, tt)[0][:4].tolist()])
    n_params = sum(p.numel() for p in model.parameters())
    print(f"done. {len(samples)} samples + model.json -> {pub}")
    print(f"model size: {n_params:,} parameters")

if __name__ == '__main__':
    main()
