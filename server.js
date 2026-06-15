'use strict';
// ─────────────────────────────────────────────────────────────
//  server.js — zero-dependency backend for dtd2.1
//    GET  /                → the app (dtd2.1.html)
//    GET  /tuner           → the parameter dashboard (tuner.html)
//    GET  /api/config      → current tunable config (JSON)
//    POST /api/config      → persist a new config to arch-config.json
//    POST /api/arch        → { shapes, sceneKey, config? } → { runs }
//    POST /api/scene       → { brief } → { scene }  (needs ANTHROPIC_API_KEY)
//    POST /api/explain     → { rooms, edges } → { reasons }  (needs ANTHROPIC_API_KEY)
//    GET/POST /api/active  → which scene the app shows; the tuner follows it (SSE)
//  Run:  node server.js     (then open http://localhost:5178)
// ─────────────────────────────────────────────────────────────
const http = require('http'), fs = require('fs'), path = require('path');
const { genArch, DEFAULT_CONFIG } = require('./arch.js');
const { generateScene, explainAdjacencies } = require('./scene.js');

const DIR = __dirname, CFG_PATH = path.join(DIR, 'arch-config.json');
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); }
  catch (e) { fs.writeFileSync(CFG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2)); return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
}
let config = loadConfig();
let activeScene = null;   // {key} the app is currently showing — lets the tuner follow along (local dev only)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(body);
}
function readBody(req) { return new Promise(resolve => { let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d)); }); }

// ── live sync: clients (the app) subscribe via SSE; we push when the config changes ──
const clients = new Set();
function broadcast(event) { for (const res of clients) { try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (e) { } } }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost'), p = u.pathname;
  if (req.method === 'OPTIONS') return send(res, 204, '');

  // ── live update stream (Server-Sent Events) ──
  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // ── API ──
  if (p === '/api/config' && req.method === 'GET') return send(res, 200, JSON.stringify(config), 'application/json');
  if (p === '/api/config' && req.method === 'POST') {
    try { config = JSON.parse(await readBody(req)); fs.writeFileSync(CFG_PATH, JSON.stringify(config, null, 2)); broadcast({ type: 'config' }); send(res, 200, JSON.stringify({ ok: true }), 'application/json'); }
    catch (e) { send(res, 400, JSON.stringify({ error: String(e) }), 'application/json'); }
    return;
  }
  if (p === '/api/arch' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const cfg = body.config || config; // live preview may pass an unsaved config
      send(res, 200, JSON.stringify(genArch(body.shapes || [], body.sceneKey || null, cfg)), 'application/json');
    } catch (e) { send(res, 400, JSON.stringify({ error: String(e) }), 'application/json'); }
    return;
  }
  // ── LLM scene generation: brief → scene (claude-haiku-4-5) ──
  if (p === '/api/scene' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const scene = await generateScene(body.brief, process.env.ANTHROPIC_API_KEY);
      send(res, 200, JSON.stringify({ scene }), 'application/json');
    } catch (e) { send(res, e.status || 500, JSON.stringify({ error: String(e.message || e) }), 'application/json'); }
    return;
  }
  // ── LLM adjacency rationale: scene edges → per-edge "why" ──
  if (p === '/api/explain' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const out = await explainAdjacencies(body, process.env.ANTHROPIC_API_KEY);
      send(res, 200, JSON.stringify(out), 'application/json');
    } catch (e) { send(res, e.status || 500, JSON.stringify({ error: String(e.message || e) }), 'application/json'); }
    return;
  }
  // ── active scene sync: the app publishes which scene it's showing; the tuner follows ──
  if (p === '/api/active' && req.method === 'GET') return send(res, 200, JSON.stringify(activeScene || { key: null, rooms: [] }), 'application/json');
  if (p === '/api/active' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      activeScene = { key: body.key || null, rooms: Array.isArray(body.rooms) ? body.rooms : [], shapes: Array.isArray(body.shapes) ? body.shapes : [] };
      // generated scenes aren't in arch-config.json — inject so the tuner (which reads /api/config) can render them
      if (body.key && body.arch && !config.scenes[body.key]) config.scenes[body.key] = body.arch;
      broadcast({ type: 'active', key: activeScene.key, rooms: activeScene.rooms, shapes: activeScene.shapes });
      send(res, 200, JSON.stringify({ ok: true }), 'application/json');
    } catch (e) { send(res, 400, JSON.stringify({ error: String(e) }), 'application/json'); }
    return;
  }

  // ── static files (served from public/, matching the Vercel layout) ──
  const PUB = path.join(DIR, 'public');
  const file = p === '/' ? '/dtd2.1.html' : p === '/tuner' ? '/tuner.html' : p;
  const fp = path.join(PUB, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (fp.startsWith(PUB) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    send(res, 200, fs.readFileSync(fp), MIME[path.extname(fp)] || 'application/octet-stream');
  } else send(res, 404, 'Not found');
});

const PORT = process.env.PORT || 5178;
server.listen(PORT, () => {
  console.log(`dtd2 backend running:`);
  console.log(`  app    →  http://localhost:${PORT}/`);
  console.log(`  tuner  →  http://localhost:${PORT}/tuner`);
});
