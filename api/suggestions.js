// Vercel Serverless Function: Persist game suggestions using Vercel KV
// Requires env vars (set in Vercel Project Settings):
// - KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN, KV_REST_API_READ_ONLY_TOKEN
import { kv } from '@vercel/kv';

function setCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    try {
      const raw = await kv.lrange('game_suggestions', 0, -1);
      const items = (raw || []).map((r) => {
        try { return JSON.parse(r); } catch { return null; }
      }).filter(Boolean);
      res.status(200).json({ items });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch suggestions' });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const name = String(body?.name || '').trim();
      const email = String(body?.email || '').trim();
      const title = String(body?.title || '').trim();
      const description = String(body?.description || '').trim();

      if (!name || !email || !title || !description || !/.+@.+\..+/.test(email)) {
        res.status(400).json({ error: 'Invalid payload' });
        return;
      }

      const id = (globalThis.crypto?.randomUUID?.()) || String(Date.now());
      const item = { id, name, email, title, description, createdAt: new Date().toISOString() };
      await kv.rpush('game_suggestions', JSON.stringify(item));

      res.status(201).json({ ok: true, item });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save suggestion' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

