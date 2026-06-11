'use strict';
// ─────────────────────────────────────────────────────────────
//  api/config.js — Vercel serverless function for the tunable config
//    GET  /api/config → current config (JSON)
//    POST /api/config → accepted, but NOT persisted on Vercel
//      (serverless filesystem is read-only/ephemeral). Live tuning +
//      persistence only work with the local server.js. The tuner still
//      drives a live preview via the `config` field on /api/arch.
// ─────────────────────────────────────────────────────────────
const fs = require('fs'), path = require('path');
const { DEFAULT_CONFIG } = require('../arch.js');

function loadConfig() {
  for (const p of [path.join(__dirname, '..', 'arch-config.json'), path.join(process.cwd(), 'arch-config.json')]) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {}
  }
  return DEFAULT_CONFIG;
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method === 'GET') { res.status(200).json(loadConfig()); return; }
  if (req.method === 'POST') { res.status(200).json({ ok: true, ephemeral: true }); return; }
  res.status(405).json({ error: 'method' });
};
