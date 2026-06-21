// ============================================================
// /api/auth-verify  (Vercel Serverless Function)
// ============================================================
// Paso 2 del login propio por WhatsApp. Recibe { phone, code },
// valida el OTP guardado y, si es correcto, emite un JWT firmado con
// el JWT Secret del proyecto (HS256). Ese token es el mismo formato
// que usa Supabase, asi que el cliente puede llamar a PostgREST con
// RLS sin pasar por Supabase Auth.
//
// Variables de entorno requeridas:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_JWT_SECRET     (Project Settings -> API -> JWT Settings)
//   SESSION_TTL_SECONDS     (opcional, default 43200 = 12 h)
// ============================================================

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function normalizePhone(raw) {
  const trimmed = String(raw || '').replace(/[\s()-]/g, '');
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return '+52' + digits;
  return '+' + digits;
}

function hashCode(phone, code) {
  return crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex');
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

const MAX_ATTEMPTS = 5;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = await readJson(req);
  } catch {
    return res.status(400).json({ error: 'JSON invalido' });
  }

  const phone = normalizePhone(payload.phone);
  const code = String(payload.code || '').trim();
  if (!/^\+\d{8,15}$/.test(phone) || !/^\d{4,8}$/.test(code)) {
    return res.status(400).json({ error: 'Datos invalidos' });
  }

  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ error: 'Falta SUPABASE_JWT_SECRET' });
  }

  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: row, error } = await admin
    .from('otp_codes')
    .select('code_hash, expires_at, attempts')
    .eq('phone', phone)
    .maybeSingle();
  if (error) return res.status(500).json({ error: `DB: ${error.message}` });
  if (!row) return res.status(401).json({ error: 'Solicita un codigo nuevo' });

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await admin.from('otp_codes').delete().eq('phone', phone);
    return res.status(401).json({ error: 'El codigo expiro' });
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await admin.from('otp_codes').delete().eq('phone', phone);
    return res.status(429).json({ error: 'Demasiados intentos, pide otro codigo' });
  }

  const ok = crypto.timingSafeEqual(
    Buffer.from(row.code_hash),
    Buffer.from(hashCode(phone, code))
  );
  if (!ok) {
    await admin
      .from('otp_codes')
      .update({ attempts: row.attempts + 1 })
      .eq('phone', phone);
    return res.status(401).json({ error: 'Codigo incorrecto' });
  }

  // OTP correcto: consumirlo
  await admin.from('otp_codes').delete().eq('phone', phone);

  // Buscar el profile (debe existir, sembrado previamente)
  const { data: profile, error: pErr } = await admin
    .from('profiles')
    .select('id, full_name, phone')
    .eq('phone', phone)
    .maybeSingle();
  if (pErr) return res.status(500).json({ error: `DB: ${pErr.message}` });
  if (!profile) {
    return res.status(403).json({ error: 'Usuario no registrado' });
  }

  const ttl = parseInt(process.env.SESSION_TTL_SECONDS || '43200', 10);
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt(
    {
      sub: profile.id,
      role: 'authenticated',
      aud: 'authenticated',
      phone,
      iat: now,
      exp: now + ttl,
      app_metadata: { provider: 'whatsapp', providers: ['whatsapp'] },
      user_metadata: { full_name: profile.full_name },
    },
    jwtSecret
  );

  return res.status(200).json({
    access_token: token,
    expires_at: (now + ttl) * 1000,
    user: { id: profile.id, full_name: profile.full_name, phone: profile.phone },
  });
}
