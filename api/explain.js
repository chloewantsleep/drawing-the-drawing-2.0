'use strict';
// ─────────────────────────────────────────────────────────────
//  api/explain.js — Vercel serverless: adjacency table → per-edge "why".
//    POST /api/explain  { buildingType, rooms:[{key,name}], edges:[{from,to,weight}] }
//                       →  { reasons:[{from,to,reason}] }
//  Needs ANTHROPIC_API_KEY. See scene.js → explainAdjacencies.
// ─────────────────────────────────────────────────────────────
const { explainAdjacencies } = require('../scene.js');

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
    const out = await explainAdjacencies(body, process.env.ANTHROPIC_API_KEY);
    res.status(200).json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
};
