// Vercel Serverless Function: Persist game suggestions using Postgres (Supabase)
// Env vars required (Vercel Project Settings → Environment Variables):
// - DATABASE_URL (use pooled connection string recommended by Supabase)
//   e.g. postgresql://postgres:YOUR_PASSWORD@<ref>.pooler.supabase.com:6543/postgres?sslmode=require
import { Pool } from 'pg';

function setCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Reuse the pool across invocations (Vercel optimization)
const pool = globalThis.pgPool || (() => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  const p = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  globalThis.pgPool = p;
  return p;
})();

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!pool) {
    res.status(500).json({ error: 'DATABASE_URL not configured' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const { rows } = await pool.query(
        'select id, name, email, title, description, created_at from public.suggestions order by created_at desc'
      );
      res.status(200).json({ items: rows || [] });
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

      const insertSQL = `
        insert into public.suggestions (name, email, title, description)
        values ($1, $2, $3, $4)
        returning id, name, email, title, description, created_at
      `;
      const values = [name, email, title, description];
      const { rows } = await pool.query(insertSQL, values);
      const row = rows?.[0];
      res.status(201).json({ ok: true, item: row });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save suggestion' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
