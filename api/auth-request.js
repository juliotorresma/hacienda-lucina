// ============================================================
// /api/auth-request  (Vercel Serverless Function)
// ============================================================
// Paso 1 del login propio por WhatsApp (sin usar Supabase Auth).
// Recibe { phone }, valida contra la allowlist, genera un OTP de 6
// digitos, guarda su hash en otp_codes y lo envia por WhatsApp con la
// plantilla de autenticacion de Meta.
//
// Variables de entorno requeridas:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   META_WHATSAPP_TOKEN
//   META_PHONE_NUMBER_ID
//   META_OTP_TEMPLATE
//   META_TEMPLATE_LANG      (opcional, default "es_MX")
//   OTP_TTL_SECONDS         (opcional, default 300)
//   OTP_RESEND_SECONDS      (opcional, default 30)
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

async function sendWhatsAppOtp(phone, code) {
  const lang = process.env.META_TEMPLATE_LANG || 'es_MX';
  const to = phone.replace('+', '');
  const url = `https://graph.facebook.com/v21.0/${process.env.META_PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: process.env.META_OTP_TEMPLATE,
      language: { code: lang },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: code }],
        },
      ],
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Meta API ${res.status}: ${txt}`);
  }
}

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
  if (!/^\+\d{8,15}$/.test(phone)) {
    return res.status(400).json({ error: 'Numero invalido' });
  }

  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Allowlist
  const { data: allowed, error: allowErr } = await admin
    .from('allowed_phones')
    .select('phone')
    .eq('phone', phone)
    .maybeSingle();
  if (allowErr) return res.status(500).json({ error: `DB: ${allowErr.message}` });
  if (!allowed) return res.status(403).json({ error: 'Numero no autorizado' });

  // Rate limit por reenvio
  const resendSecs = parseInt(process.env.OTP_RESEND_SECONDS || '30', 10);
  const { data: existing } = await admin
    .from('otp_codes')
    .select('created_at')
    .eq('phone', phone)
    .maybeSingle();
  if (existing) {
    const elapsed = (Date.now() - new Date(existing.created_at).getTime()) / 1000;
    if (elapsed < resendSecs) {
      return res
        .status(429)
        .json({ error: `Espera ${Math.ceil(resendSecs - elapsed)}s para reenviar` });
    }
  }

  // Generar y guardar OTP
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const ttl = parseInt(process.env.OTP_TTL_SECONDS || '300', 10);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const { error: upErr } = await admin.from('otp_codes').upsert(
    {
      phone,
      code_hash: hashCode(phone, code),
      expires_at: expiresAt,
      attempts: 0,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'phone' }
  );
  if (upErr) return res.status(500).json({ error: `DB: ${upErr.message}` });

  try {
    await sendWhatsAppOtp(phone, code);
  } catch (e) {
    return res.status(502).json({ error: `WhatsApp: ${e.message}` });
  }

  return res.status(200).json({ ok: true, expires_in: ttl });
}
