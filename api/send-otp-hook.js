// ============================================================
// /api/send-otp-hook  (Vercel Serverless Function)
// ============================================================
// Endpoint del "Send SMS Hook" de Supabase Auth.
// Supabase llama aqui cuando alguien pide un OTP por telefono.
// Nosotros:
//   1. Verificamos la firma del hook (Standard Webhooks / svix).
//   2. Validamos que el telefono este en la allowlist.
//   3. Enviamos el OTP por WhatsApp con la plantilla "authentication".
//
// Variables de entorno requeridas:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SEND_SMS_HOOK_SECRET     (el secreto que Supabase genera para el hook,
//                             formato "v1,whsec_xxx")
//   META_WHATSAPP_TOKEN
//   META_PHONE_NUMBER_ID
//   META_OTP_TEMPLATE        (nombre de la plantilla de autenticacion)
//   META_TEMPLATE_LANG       (opcional, default "es_MX")
// ============================================================

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Verificacion Standard Webhooks (lo que usa Supabase via Svix).
// Firma = base64( HMAC-SHA256( `${id}.${timestamp}.${payload}`, secret ) )
function verifySignature(rawBody, headers, secret) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatureHeader = headers['webhook-signature'];
  if (!id || !timestamp || !signatureHeader) return false;

  // El secreto viene como "v1,whsec_base64"; tomamos la parte base64.
  const secretBytes = Buffer.from(
    secret.replace(/^v1,?/, '').replace(/^whsec_/, ''),
    'base64'
  );

  const signedContent = `${id}.${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // El header puede traer varias firmas separadas por espacio: "v1,sig v1,sig2"
  const passed = signatureHeader.split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
  return passed;
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
        {
          type: 'body',
          parameters: [{ type: 'text', text: code }],
        },
        {
          // Las plantillas de autenticacion de WhatsApp requieren el boton
          // copy-code con el OTP como parametro.
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

  let raw;
  try {
    raw = await readRawBody(req);
  } catch {
    return res.status(400).json({ error: 'No se pudo leer el cuerpo' });
  }

  const secret = process.env.SEND_SMS_HOOK_SECRET;
  if (!secret || !verifySignature(raw, req.headers, secret)) {
    return res.status(401).json({ error: 'Firma invalida' });
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'JSON invalido' });
  }

  // Estructura del hook: { user: { phone }, sms: { otp } }
  const phone = payload?.user?.phone
    ? `+${String(payload.user.phone).replace('+', '')}`
    : null;
  const otp = payload?.sms?.otp;

  if (!phone || !otp) {
    return res.status(400).json({ error: 'Payload sin phone u otp' });
  }

  // Validar allowlist con service role (ignora RLS).
  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: allowed, error: allowErr } = await admin
    .from('allowed_phones')
    .select('phone')
    .eq('phone', phone)
    .maybeSingle();

  if (allowErr) {
    return res.status(500).json({ error: `DB: ${allowErr.message}` });
  }
  if (!allowed) {
    // Telefono no autorizado: respondemos error al hook para abortar el envio.
    return res.status(403).json({
      error: { http_code: 403, message: 'Telefono no autorizado' },
    });
  }

  try {
    await sendWhatsAppOtp(phone, otp);
  } catch (e) {
    return res.status(500).json({
      error: { http_code: 500, message: `WhatsApp: ${e.message}` },
    });
  }

  // 200 vacio = Supabase no intenta enviar SMS por su cuenta.
  return res.status(200).json({});
}
