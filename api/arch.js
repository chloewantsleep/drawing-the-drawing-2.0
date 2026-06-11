'use strict';
// ─────────────────────────────────────────────────────────────
//  api/arch.js — Vercel serverless function wrapping arch.js
//    POST /api/arch  → { shapes, sceneKey, config? } → { runs }
//  Mirrors the /api/arch route in server.js so the frontend
//  works unchanged whether it runs locally or on Vercel.
// ─────────────────────────────────────────────────────────────
const fs = require('fs'), path = require('path');
const { genArch, DEFAULT_CONFIG } = require('../arch.js');

function loadConfig() {
  for (const p of [path.join(__dirname, '..', 'arch-config.json'), path.join(process.cwd(), 'arch-config.json')]) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {}
  }
  return DEFAULT_CONFIG;
}
function readRaw(req) { return new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); }); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  try {
    let body = req.body;
    if (body === undefined || body === null) body = await readRaw(req);
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
    const cfg = body.config || loadConfig(); // live preview may pass an unsaved config
    res.status(200).json(genArch(body.shapes || [], body.sceneKey || null, cfg));
  } catch (e) { res.status(400).json({ error: String(e) }); }
};
