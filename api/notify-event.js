// ============================================================
// /api/notify-event  (Vercel Serverless Function)
// ============================================================
// Endpoint del Database Webhook de Supabase (on INSERT en "events").
// Cuando se crea un evento:
//   1. Verificamos un secreto compartido (header).
//   2. Cargamos todos los telefonos de "profiles".
//   3. Enviamos la plantilla "utility" por WhatsApp a cada usuario
//      con: tipo de evento, fecha y quien lo creo.
//
// Variables de entorno requeridas:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   EVENT_WEBHOOK_SECRET     (secreto compartido que se configura como
//                             header "x-webhook-secret" en el DB Webhook)
//   META_WHATSAPP_TOKEN
//   META_PHONE_NUMBER_ID
//   META_EVENT_TEMPLATE      (nombre de la plantilla de notificacion)
//   META_TEMPLATE_LANG       (opcional, default "es_MX")
// ============================================================

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

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatDate(dateStr) {
  // dateStr = "YYYY-MM-DD" -> "12 de mayo de 2026"
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return String(dateStr);
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

function hourLabel(h) {
  // Horas 6..26 (26 = 2 AM dia siguiente).
  const hh = ((h % 24) + 24) % 24;
  const suffix = hh < 12 ? 'AM' : 'PM';
  let display = hh % 12;
  if (display === 0) display = 12;
  return `${display}:00 ${suffix}`;
}

function scheduleLabel(event) {
  if (event.all_day) return 'Todo el dia';
  return `${hourLabel(event.start_hour)} a ${hourLabel(event.end_hour)}`;
}

async function sendWhatsAppNotice(phone, params) {
  const lang = process.env.META_TEMPLATE_LANG || 'es_MX';
  const to = phone.replace('+', '');
  const url = `https://graph.facebook.com/v21.0/${process.env.META_PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: process.env.META_EVENT_TEMPLATE,
      language: { code: lang },
      components: [
        {
          type: 'body',
          parameters: params.map((text) => ({ type: 'text', text })),
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
    throw new Error(`Meta API ${res.status} (${to}): ${txt}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const provided =
    req.headers['x-webhook-secret'] || req.headers['x-webhook-secret'.toLowerCase()];
  if (!process.env.EVENT_WEBHOOK_SECRET || provided !== process.env.EVENT_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Secreto invalido' });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch {
    return res.status(400).json({ error: 'No se pudo leer el cuerpo' });
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'JSON invalido' });
  }

  // Estructura del DB Webhook: { type, table, record, old_record }
  const event = payload?.record;
  if (!event || !event.event_date) {
    return res.status(400).json({ error: 'Payload sin record valido' });
  }

  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: profiles, error } = await admin.from('profiles').select('phone, full_name');
  if (error) {
    return res.status(500).json({ error: `DB: ${error.message}` });
  }

  const params = [
    event.created_by_name || 'Alguien',
    event.event_type || 'Evento',
    formatDate(event.event_date),
    scheduleLabel(event),
  ];

  const results = await Promise.allSettled(
    (profiles || [])
      .filter((p) => p.phone)
      .map((p) => sendWhatsAppNotice(p.phone, params))
  );

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    console.error('Notificaciones fallidas:', failed.map((f) => f.reason?.message));
  }

  return res.status(200).json({
    sent: results.length - failed.length,
    failed: failed.length,
  });
}
