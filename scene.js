'use strict';
// ─────────────────────────────────────────────────────────────
//  scene.js — turn a natural-language brief into a dtd2 SCENE.
//
//  This is the "★★★" half of the LLM integration: an LLM acts as the
//  *author of the rules*. Given a brief ("a small dental clinic…"), it
//  emits a room list + an adjacency table in exactly the schema the rest
//  of the app already speaks. The procedural engine then predicts/places
//  rooms and draws walls from that table, and the diffusion model could
//  learn the distribution it implies — same teacher→student pipeline,
//  now bootstrapped from one sentence instead of a hand-written table.
//
//  Zero-dependency on purpose (matches the rest of the backend): we call
//  the Anthropic Messages API with the built-in `fetch`. If you'd rather
//  use the official SDK, `npm i @anthropic-ai/sdk` and swap `callClaude`.
//
//  Shared by server.js (local) and api/scene.js (Vercel serverless).
// ─────────────────────────────────────────────────────────────

const MODEL = 'claude-haiku-4-5';            // cheap + fast — perfect for a small structured emit
const API_URL = 'https://api.anthropic.com/v1/messages';

// Fallback palette (light fill / darker stroke) — used when the model
// returns a missing or malformed color.
const PALETTE = [
  { fill: '#DBEAFE', stroke: '#2563EB' }, { fill: '#DCFCE7', stroke: '#16A34A' },
  { fill: '#FEF9C3', stroke: '#CA8A04' }, { fill: '#FEE2E2', stroke: '#DC2626' },
  { fill: '#FCE7F3', stroke: '#DB2777' }, { fill: '#EDE9FE', stroke: '#7C3AED' },
  { fill: '#CCFBF1', stroke: '#0D9488' }, { fill: '#FEF3C7', stroke: '#92400E' },
  { fill: '#E0E7FF', stroke: '#4338CA' }, { fill: '#F3F4F6', stroke: '#6B7280' },
];

// JSON schema for structured output. Dynamic-key maps (room→room→weight)
// don't fit strict structured output, so we ask for flat arrays and
// assemble the maps ourselves in normalizeScene().
const SCENE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    key: { type: 'string', description: 'short snake_case id, e.g. "dental_clinic"' },
    name: { type: 'string', description: 'human label, e.g. "Dental Clinic"' },
    startType: { type: 'string', description: 'room key the layout starts from (an entry/reception room)' },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', description: 'short snake_case id' },
          name: { type: 'string', description: 'human label' },
          fill: { type: 'string', description: 'light hex fill, e.g. "#DBEAFE"' },
          stroke: { type: 'string', description: 'darker hex stroke, e.g. "#2563EB"' },
          wMin: { type: 'integer' }, wMax: { type: 'integer' },
          hMin: { type: 'integer' }, hMax: { type: 'integer' },
          singleton: { type: 'boolean', description: 'true if there is normally only one of these' },
        },
        required: ['key', 'name', 'fill', 'stroke', 'wMin', 'wMax', 'hMin', 'hMax', 'singleton'],
      },
    },
    adjacencies: {
      type: 'array',
      description: 'symmetric room-pair preferences; weight 5=must be adjacent, 0=irrelevant',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'string' }, to: { type: 'string' }, weight: { type: 'integer' },
        },
        required: ['from', 'to', 'weight'],
      },
    },
  },
  required: ['key', 'name', 'startType', 'rooms', 'adjacencies'],
};

const SYSTEM = `You design floor-plan "scenes" for an architectural sketching tool.

A scene is a building type (apartment, clinic, mall…) described by:
- a set of room types, each with a color and a typical size, and
- an ADJACENCY TABLE: for every pair of room types, how strongly they should sit next to each other (0–5; 5 = must share a wall, 0 = irrelevant).

The adjacency table is the heart of the tool — a deterministic engine uses it to predict the next room, place rooms sensibly, and decide where doors go. Design it like a real architect would: a dialysis bay next to the nurse station (5), a waiting room off reception (5), storage off retail (4), a bathroom buried away from the kitchen (1).

Rules:
- 5–9 room types. Use clear, specific names for the requested building type.
- Always include ONE circulation room (corridor / hallway / atrium / concourse) and connect most rooms to it — real buildings need circulation.
- startType is the natural entry/anchor room (reception, entrance, lobby…).
- Adjacencies are symmetric: list each meaningful pair once. Cover every room with at least one edge. Aim for ~2–4 edges per room, weighted realistically.
- Sizes are in canvas units (~20 units per foot). Typical rooms 100–360 on a side; large halls up to ~520; tiny rooms (closets, restrooms) ~80–140. wMax≥wMin, hMax≥hMin.
- Colors: light pastel fill (#RRGGBB) + a darker stroke of the same hue. Use a distinct hue per room.

Return ONLY the scene object via the provided schema.`;

function pickColor(i) { return PALETTE[i % PALETTE.length]; }
const isHex = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

// Turn the model's flat arrays into the exact SCENES[key] shape the app uses.
function normalizeScene(raw) {
  if (!raw || !Array.isArray(raw.rooms) || !raw.rooms.length) throw new Error('model returned no rooms');

  const types = {}, order = [];
  raw.rooms.forEach((r, i) => {
    let key = slug(r.key) || slug(r.name) || `room${i + 1}`;
    while (types[key]) key += '_' + (i + 1);          // keep keys unique
    const pal = pickColor(i);
    let wMin = clampInt(r.wMin, 40, 600, 140), wMax = clampInt(r.wMax, 40, 600, 240);
    let hMin = clampInt(r.hMin, 40, 600, 120), hMax = clampInt(r.hMax, 40, 600, 200);
    if (wMax < wMin) [wMin, wMax] = [wMax, wMin];
    if (hMax < hMin) [hMin, hMax] = [hMax, hMin];
    types[key] = {
      name: String(r.name || key).slice(0, 40),
      fill: isHex(r.fill) ? r.fill : pal.fill,
      stroke: isHex(r.stroke) ? r.stroke : pal.stroke,
      wRange: [wMin, wMax], hRange: [hMin, hMax],
      _singleton: !!r.singleton,
    };
    order.push(key);
  });

  // remember per-room key under its original spelling too, so adjacency lookups match
  const keyAlias = {};
  raw.rooms.forEach((r, i) => { keyAlias[slug(r.key)] = order[i]; keyAlias[slug(r.name)] = order[i]; });
  const resolve = (k) => types[slug(k)] ? slug(k) : keyAlias[slug(k)];

  // build the symmetric adjacency map
  const adj = {}; order.forEach(k => adj[k] = {});
  for (const e of (raw.adjacencies || [])) {
    const a = resolve(e.from), b = resolve(e.to);
    if (!a || !b || a === b) continue;
    const w = clampInt(e.weight, 0, 5, 0);
    if (!w) continue;
    adj[a][b] = Math.max(adj[a][b] || 0, w);
    adj[b][a] = Math.max(adj[b][a] || 0, w);
  }

  let startType = resolve(raw.startType) || order[0];

  // safety net: any room the model forgot to connect gets linked to circulation
  // (the start room is a reasonable proxy for "the hub").
  const circ = order.find(k => /corridor|hall|atrium|concourse|lobby|circulation/.test(k)) || startType;
  for (const k of order) {
    if (k === circ) continue;
    if (!Object.keys(adj[k]).length) { adj[k][circ] = 2; adj[circ][k] = 2; }
  }

  // maxCount: singletons capped at 1 (start room always 1), everything else unlimited
  const maxCount = {};
  for (const k of order) maxCount[k] = (k === startType || types[k]._singleton) ? 1 : null;
  for (const k of order) delete types[k]._singleton;

  const key = slug(raw.key) || slug(raw.name) || 'custom';
  return { key, name: String(raw.name || 'Custom Scene').slice(0, 40), startType, types, adj, maxCount };
}

function post(apiKey, body) {
  return fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
}

async function callClaude(brief, apiKey) {
  const base = {
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Design a scene for: ${brief}` }],
  };
  // Prefer structured outputs (guaranteed-valid JSON). If this API can't take
  // the `output_config` param, fall back to a plain request that asks for JSON.
  let res = await post(apiKey, { ...base, output_config: { format: { type: 'json_schema', schema: SCENE_SCHEMA } } });
  if (res.status === 400) {
    res = await post(apiKey, {
      ...base,
      messages: [{ role: 'user', content: `Design a scene for: ${brief}\n\nRespond with ONLY a minified JSON object: {"key","name","startType","rooms":[{"key","name","fill","stroke","wMin","wMax","hMin","hMax","singleton"}],"adjacencies":[{"from","to","weight"}]}. No prose, no markdown fences.` }],
    });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    throw new Error(`Anthropic API: ${msg}`);
  }
  if (data.stop_reason === 'refusal') throw new Error('the model declined this brief');
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) {                                   // tolerate prose around the JSON
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('model did not return JSON');
    parsed = JSON.parse(m[0]);
  }
  return parsed;
}

// Public entry point. Resolves to a SCENES[key]-shaped object, or throws
// an Error with a `.status` for the HTTP layer to surface.
async function generateScene(brief, apiKey) {
  brief = String(brief || '').trim();
  if (!brief) { const e = new Error('empty brief'); e.status = 400; throw e; }
  if (!apiKey) {
    const e = new Error('ANTHROPIC_API_KEY is not set on the server. Add it to your environment (local) or Vercel project settings, then redeploy.');
    e.status = 503; throw e;
  }
  try {
    const raw = await callClaude(brief, apiKey);
    return normalizeScene(raw);
  } catch (err) {
    if (!err.status) err.status = 502;
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
//  EXPLAIN — the "why" behind an adjacency table. Given a scene's rooms
//  and weighted edges, ask the LLM for a one-line architectural reason
//  per pair. Surfaces the *logic* of the rules (used by the tuner's
//  bubble diagram on hover). Same model, same zero-dep fetch.
// ─────────────────────────────────────────────────────────────
const EXPLAIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reasons: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'string' }, to: { type: 'string' }, reason: { type: 'string' },
        },
        required: ['from', 'to', 'reason'],
      },
    },
  },
  required: ['reasons'],
};

const EXPLAIN_SYSTEM = `You are an architect explaining a floor-plan adjacency table.
For each room pair given, write ONE short reason (≤ 14 words) for why those two spaces sit next to each other in this building type — concrete and functional (workflow, privacy, acoustics, code, circulation), not generic. If the weight is low (1–2), explain why the link is weak/optional. Use the exact room keys you were given in "from"/"to".`;

async function explainAdjacencies(payload, apiKey) {
  const buildingType = String((payload && payload.buildingType) || 'building').slice(0, 60);
  const rooms = Array.isArray(payload && payload.rooms) ? payload.rooms : [];
  const edges = Array.isArray(payload && payload.edges) ? payload.edges : [];
  if (!apiKey) { const e = new Error('ANTHROPIC_API_KEY is not set on the server.'); e.status = 503; throw e; }
  if (!edges.length) return { reasons: [] };

  const roomLines = rooms.map(r => `${r.key} = ${r.name}`).join('; ');
  const edgeLines = edges.map(e => `${e.from} ↔ ${e.to} (weight ${e.weight})`).join('\n');
  const user = `Building type: ${buildingType}\nRooms: ${roomLines}\n\nExplain each adjacency:\n${edgeLines}`;
  const base = { model: MODEL, max_tokens: 1200, system: EXPLAIN_SYSTEM, messages: [{ role: 'user', content: user }] };

  try {
    let res = await post(apiKey, { ...base, output_config: { format: { type: 'json_schema', schema: EXPLAIN_SCHEMA } } });
    if (res.status === 400) {
      res = await post(apiKey, { ...base, messages: [{ role: 'user', content: user + '\n\nRespond with ONLY minified JSON: {"reasons":[{"from","to","reason"}]}. No prose.' }] });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('model did not return JSON'); parsed = JSON.parse(m[0]); }
    const reasons = Array.isArray(parsed.reasons) ? parsed.reasons
      .filter(r => r && r.from && r.to && r.reason)
      .map(r => ({ from: String(r.from), to: String(r.to), reason: String(r.reason).slice(0, 160) })) : [];
    return { reasons };
  } catch (err) {
    if (!err.status) err.status = 502;
    throw err;
  }
}

module.exports = { generateScene, normalizeScene, explainAdjacencies, MODEL };
