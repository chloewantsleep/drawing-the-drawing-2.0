'use strict';
// ─────────────────────────────────────────────────────────────
//  api/active.js — Vercel parity stub for the app→tuner scene sync.
//    Live sync (SSE + shared memory) only works with the local server.js;
//    serverless functions are stateless, so this just accepts/echoes so
//    the tuner's fetch doesn't 404 on Vercel.
// ─────────────────────────────────────────────────────────────
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method === 'GET') { res.status(200).json({ key: null }); return; }
  if (req.method === 'POST') { res.status(200).json({ ok: true, ephemeral: true }); return; }
  res.status(405).json({ error: 'method' });
};
