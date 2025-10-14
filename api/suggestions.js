// Vercel Serverless Function: Persist game suggestions using Supabase
// Env vars (Vercel Project Settings → Environment Variables):
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY (preferred for writes, server-only)
// - SUPABASE_ANON_KEY (optional fallback if service role not set)
import { createClient } from '@supabase/supabase-js';

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

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || (!SERVICE_ROLE && !ANON)) {
    res.status(500).json({ error: 'Supabase env not configured' });
    return;
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE || ANON, {
    auth: { persistSession: false },
  });

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('suggestions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.status(200).json({ items: data || [] });
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

      const payload = { name, email, title, description };
      const { data, error } = await supabase
        .from('suggestions')
        .insert([payload])
        .select()
        .single();
      if (error) throw error;

      res.status(201).json({ ok: true, item: data });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save suggestion' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
