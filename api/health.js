// Simple health check for serverless + DB connectivity
import { Pool } from 'pg';

function setCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

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
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!pool) {
    res.status(500).json({ ok: false, db: false, error: 'DATABASE_URL not configured' });
    return;
  }

  try {
    const { rows } = await pool.query('select 1 as ok');
    const dbOk = rows && rows[0] && rows[0].ok === 1;
    res.status(200).json({ ok: true, db: !!dbOk, time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, db: false, error: 'DB query failed' });
  }
}

