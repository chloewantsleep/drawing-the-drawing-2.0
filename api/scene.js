'use strict';
// ─────────────────────────────────────────────────────────────
//  api/scene.js — Vercel serverless function: brief → scene.
//    POST /api/scene  { brief }  →  { scene }  (SCENES[key] shape)
//  Needs the ANTHROPIC_API_KEY environment variable (Vercel project
//  settings → Environment Variables). See scene.js for the logic.
// ─────────────────────────────────────────────────────────────
const { generateScene } = require('../scene.js');

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) return resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d));
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const scene = await generateScene(body.brief, process.env.ANTHROPIC_API_KEY);
    res.status(200).json({ scene });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
};
