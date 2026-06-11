'use strict';
// ─────────────────────────────────────────────────────────────
//  arch.js — architectural-plan generation (walls + door openings)
//  Pure geometry, no DOM. Shared by the backend (server.js) and the
//  tuner. The frontend never runs this — it just renders the result.
// ─────────────────────────────────────────────────────────────
const EPS = 1e-7;

function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function rectToPoly(s) {
  return [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }];
}
// params t∈[0,1] on AB where AB meets CD (incl. collinear overlap)
function segSegOnAB(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, rxs = rx * sy - ry * sx;
  const qpx = c.x - a.x, qpy = c.y - a.y, out = [];
  if (Math.abs(rxs) < 1e-12) {
    if (Math.abs(qpx * ry - qpy * rx) < 1e-9) {
      const rr = rx * rx + ry * ry;
      for (const p of [c, d]) { const t = ((p.x - a.x) * rx + (p.y - a.y) * ry) / rr; if (t > EPS && t < 1 - EPS) out.push(t); }
    }
    return out;
  }
  const t = (qpx * sy - qpy * sx) / rxs, u = (qpx * ry - qpy * rx) / rxs;
  if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) out.push(Math.max(0, Math.min(1, t)));
  return out;
}

// shapes: [{type:'rect', x,y,w,h, roomType?, poly?}], sceneKey: string|null, cfg: config object
// returns { runs:[{ax,ay,bx,by,kind:'ext'|'int', len, nx,ny, t, door?:[c0,c1]}] }
function genArch(shapes, sceneKey, cfg) {
  const rooms = (shapes || []).filter(s => s.type === 'rect');
  if (!rooms.length) return { runs: [] };
  const polys = rooms.map(s => s.poly ? s.poly.map(p => ({ x: p.x, y: p.y })) : rectToPoly(s));

  const DOOR_W = num(cfg.doorWidth, 40), WALL_EXT = num(cfg.wallExt, 9), WALL_INT = num(cfg.wallInt, 6);
  const DOOR_TH = num(cfg.doorThreshold, 3), useNet = cfg.connectivity !== false;
  const scene = (cfg.scenes && cfg.scenes[sceneKey]) || null;
  const adj = scene ? scene.adj : null, startType = scene ? scene.startType : null;

  // every room edge → split at all mutual intersections into minimal segments
  const segs = [];
  for (const poly of polys) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) > EPS) segs.push([a, b]);
  }
  const minSegs = [];
  for (const seg of segs) {
    const [a, b] = seg, rx = b.x - a.x, ry = b.y - a.y; let ts = [0, 1];
    for (const o of segs) { if (o === seg) continue; for (const t of segSegOnAB(a, b, o[0], o[1])) ts.push(t); }
    ts.sort((u, v) => u - v); const uq = [];
    for (const t of ts) { if (!uq.length || t - uq[uq.length - 1] > 1e-6) uq.push(t); }
    for (let i = 0; i < uq.length - 1; i++) { const t0 = uq[i], t1 = uq[i + 1]; minSegs.push([{ x: a.x + rx * t0, y: a.y + ry * t0 }, { x: a.x + rx * t1, y: a.y + ry * t1 }]); }
  }
  // classify each minimal segment: exterior (room one side) vs interior partition (rooms both sides)
  const roomAt = pt => { for (let i = polys.length - 1; i >= 0; i--) if (pointInPoly(pt.x, pt.y, polys[i])) return i; return -1; };
  const seen = new Set(), walls = [];
  for (const [a, b] of minSegs) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy); if (len < EPS) continue;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, nx = -dy / len, ny = dx / len, off = Math.min(0.1, len / 4);
    const rl = roomAt({ x: mx + nx * off, y: my + ny * off }), rr = roomAt({ x: mx - nx * off, y: my - ny * off }), insL = rl >= 0, insR = rr >= 0;
    if (!insL && !insR) continue; if (insL && insR && rl === rr) continue;
    const mk = Math.round(mx * 100) + ',' + Math.round(my * 100) + ',' + Math.round(Math.abs(nx) * 1e3);
    if (seen.has(mk)) continue; seen.add(mk);
    const kind = (insL && insR) ? 'int' : 'ext', pair = kind === 'int' ? [Math.min(rl, rr), Math.max(rl, rr)].join('-') : 'ext' + (insL ? rl : rr);
    walls.push({ a, b, kind, pair });
  }
  // merge collinear segments (same line/kind/pair) into maximal wall runs
  const lineKey = w => {
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, len = Math.hypot(dx, dy); let nx = -dy / len, ny = dx / len;
    if (nx < -1e-9 || (Math.abs(nx) < 1e-9 && ny < 0)) { nx = -nx; ny = -ny; }
    return Math.round(nx * 1e3) + '|' + Math.round(ny * 1e3) + '|' + Math.round((w.a.x * nx + w.a.y * ny) * 1e3);
  };
  const groups = new Map();
  for (const w of walls) { const k = lineKey(w) + '#' + w.kind + '#' + w.pair; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(w); }
  const runs = [];
  for (const ws of groups.values()) {
    const d0 = ws[0], dx = d0.b.x - d0.a.x, dy = d0.b.y - d0.a.y, l0 = Math.hypot(dx, dy), ux = dx / l0, uy = dy / l0, base = d0.a;
    const proj = p => (p.x - base.x) * ux + (p.y - base.y) * uy;
    const ivs = ws.map(w => { const ta = proj(w.a), tb = proj(w.b); return [Math.min(ta, tb), Math.max(ta, tb)]; }).sort((p, q) => p[0] - q[0]);
    const merged = [];
    for (const iv of ivs) { if (merged.length && iv[0] <= merged[merged.length - 1][1] + 1e-6) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]); else merged.push([...iv]); }
    for (const [t0, t1] of merged) runs.push({ ax: base.x + ux * t0, ay: base.y + uy * t0, bx: base.x + ux * t1, by: base.y + uy * t1, kind: ws[0].kind, pair: ws[0].pair, len: t1 - t0 });
  }
  // swing normal (door opens toward a room interior) + thickness
  for (const r of runs) {
    const len = r.len || 1; let nx = -(r.by - r.ay) / len, ny = (r.bx - r.ax) / len;
    const cx = (r.ax + r.bx) / 2, cy = (r.ay + r.by) / 2;
    if (r.kind === 'ext' && roomAt({ x: cx + nx * 2, y: cy + ny * 2 }) < 0) { nx = -nx; ny = -ny; }
    r.nx = nx; r.ny = ny; r.t = r.kind === 'ext' ? WALL_EXT : WALL_INT;
  }
  // ── DOORS ──
  const typeOf = i => rooms[i] && rooms[i].roomType;
  const weightOf = (i, j) => { if (!adj) return null; const a = typeOf(i), b = typeOf(j); if (!a || !b) return null; return Math.max((adj[a] || {})[b] || 0, (adj[b] || {})[a] || 0); };
  // longest shared run per room-pair that can fit a door
  const pairRun = new Map();
  for (const r of runs) if (r.kind === 'int' && r.len > DOOR_W + 24) { if (!pairRun.has(r.pair) || r.len > pairRun.get(r.pair).len) pairRun.set(r.pair, r); }
  // open a door where adjacency is high (≥ threshold), or where types are unknown
  const open = new Set();
  for (const k of pairRun.keys()) { const [i, j] = k.split('-').map(Number), w = weightOf(i, j); if (w === null || w >= DOOR_TH) open.add(k); }
  // connectivity safety net — every room reachable from the entrance
  const nR = rooms.length, parent = Array.from({ length: nR }, (_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const uni = (a, b) => { parent[find(a)] = find(b); };
  for (const k of open) { const [i, j] = k.split('-').map(Number); uni(i, j); }
  let entRoom = -1; if (startType) for (let i = 0; i < nR; i++) if (rooms[i].roomType === startType) { entRoom = i; break; }
  const root = entRoom >= 0 ? entRoom : 0;
  if (useNet) for (let guard = 0; guard < nR * 2; guard++) {
    let allConn = true; for (let i = 0; i < nR; i++) if (find(i) !== find(root)) { allConn = false; break; }
    if (allConn) break;
    let best = null, bestScore = -1;
    for (const [k, r] of pairRun) {
      if (open.has(k)) continue; const [i, j] = k.split('-').map(Number); if (find(i) === find(j)) continue;
      const touchesRoot = find(i) === find(root) || find(j) === find(root), w = weightOf(i, j) || 0;
      const score = (touchesRoot ? 1e4 : 0) + w * 100 + r.len; if (score > bestScore) { bestScore = score; best = k; }
    }
    if (!best) break; open.add(best); const [bi, bj] = best.split('-').map(Number); uni(bi, bj);
  }
  for (const k of open) { const r = pairRun.get(k); if (r) r.door = [(r.len - DOOR_W) / 2, (r.len + DOOR_W) / 2]; }
  // entrance door: start-type room's longest exterior wall, else longest exterior overall
  let entr = null;
  if (entRoom >= 0) for (const r of runs) if (r.kind === 'ext' && parseInt(r.pair.slice(3)) === entRoom && r.len > DOOR_W + 24 && (!entr || r.len > entr.len)) entr = r;
  if (!entr) for (const r of runs) if (r.kind === 'ext' && r.len > DOOR_W + 24 && (!entr || r.len > entr.len)) entr = r;
  if (entr) entr.door = [(entr.len - DOOR_W) / 2, (entr.len + DOOR_W) / 2];

  // strip internal-only fields before returning
  return { runs: runs.map(r => ({ ax: r.ax, ay: r.ay, bx: r.bx, by: r.by, kind: r.kind, len: r.len, nx: r.nx, ny: r.ny, t: r.t, door: r.door || null })) };
}
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

// Default tunable config — numeric params + per-scene adjacency matrices.
// Seeded to match the app's original behaviour.
const DEFAULT_CONFIG = {
  doorThreshold: 3, wallExt: 9, wallInt: 6, doorWidth: 40, connectivity: true,
  scenes: {
    apartment: {
      startType: 'living',
      types: ['living', 'bedroom', 'bathroom', 'kitchen', 'dining', 'corridor', 'study', 'balcony'],
      adj: {
        living: { bedroom: 3, kitchen: 3, dining: 4, corridor: 2, balcony: 3, study: 2, bathroom: 1 },
        bedroom: { bathroom: 5, corridor: 3, living: 2, study: 3, bedroom: 2, balcony: 2 },
        bathroom: { bedroom: 4, corridor: 3, kitchen: 1, living: 1 },
        kitchen: { dining: 5, living: 3, corridor: 2, bathroom: 1 },
        dining: { kitchen: 5, living: 4, corridor: 2, balcony: 2 },
        corridor: { bedroom: 3, bathroom: 3, living: 2, kitchen: 2, study: 2, dining: 2 },
        study: { corridor: 3, bedroom: 3, living: 2, balcony: 2 },
        balcony: { living: 4, bedroom: 3, dining: 3 },
      },
    },
    office: {
      startType: 'reception',
      types: ['reception', 'openoffice', 'meeting', 'restroom', 'breakroom', 'corridor', 'storage', 'exec'],
      adj: {
        reception: { openoffice: 4, corridor: 4, meeting: 2, restroom: 1, exec: 2 },
        openoffice: { meeting: 4, corridor: 3, breakroom: 3, storage: 2, restroom: 2, exec: 2 },
        meeting: { corridor: 4, openoffice: 3, reception: 2, exec: 2 },
        restroom: { corridor: 5, openoffice: 2, reception: 1 },
        breakroom: { openoffice: 4, corridor: 3, restroom: 2 },
        corridor: { restroom: 4, meeting: 3, openoffice: 2, breakroom: 2, storage: 2, exec: 2 },
        storage: { corridor: 4, openoffice: 2, breakroom: 2 },
        exec: { corridor: 3, meeting: 3, openoffice: 2, reception: 2 },
      },
    },
    mall: {
      startType: 'entrance',
      types: ['entrance', 'atrium', 'corridor', 'retail', 'anchor', 'foodcourt', 'restroom', 'cinema', 'storage'],
      adj: {
        entrance: { atrium: 5, corridor: 4, retail: 2 },
        atrium: { corridor: 5, retail: 4, foodcourt: 3, anchor: 2, cinema: 2, restroom: 2 },
        corridor: { retail: 5, restroom: 4, anchor: 3, foodcourt: 3, cinema: 2, storage: 2 },
        retail: { corridor: 4, restroom: 2, storage: 3, retail: 2 },
        anchor: { corridor: 4, storage: 3, restroom: 2 },
        foodcourt: { corridor: 4, restroom: 4, atrium: 3, retail: 2 },
        restroom: { corridor: 5, foodcourt: 3, retail: 2 },
        cinema: { corridor: 4, atrium: 3, restroom: 3, retail: 2 },
        storage: { retail: 4, corridor: 3, anchor: 3, restroom: 2 },
      },
    },
  },
};

module.exports = { genArch, DEFAULT_CONFIG };
