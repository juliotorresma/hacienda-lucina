// ============================================================
// /api/contact  (Vercel Serverless Function)
// ============================================================
// Recibe el formulario de contacto del sitio publico y envia una
// notificacion por WhatsApp al dueno (Julio) con los datos ordenados,
// incluyendo el telefono de quien lo mando.
//
// Como el mensaje lo inicia el negocio, se usa una plantilla de Meta
// (categoria Utility) con 6 parametros de cuerpo:
//   {{1}} nombre  {{2}} telefono  {{3}} correo
//   {{4}} tipo de evento  {{5}} fecha tentativa  {{6}} mensaje
//
// El mismo mensaje se envia al dueno y a la persona que lleno el
// formulario (como confirmacion). El envio al dueno es obligatorio; el
// del solicitante es best-effort (no rompe la respuesta si falla).
//
// Variables de entorno requeridas:
//   META_WHATSAPP_TOKEN
//   META_PHONE_NUMBER_ID
//   META_CONTACT_TEMPLATE   (nombre de la plantilla, p.ej. hacienda_contacto)
//   META_TEMPLATE_LANG      (opcional, default "es_MX")
//   OWNER_WHATSAPP_PHONE    (opcional, default +528712832271)
// ============================================================

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
  if (!digits) return '';
  return '+' + digits;
}

// WhatsApp no permite saltos de linea, tabs ni 5+ espacios seguidos en
// los parametros de plantilla. Limpiamos y acotamos longitud.
function cleanParam(value, fallback = 'No especificado', max = 600) {
  let s = String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{4,}/g, '   ')
    .trim();
  if (!s) s = fallback;
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    return res.status(400).json({ error: 'JSON invalido' });
  }

  const name = cleanParam(body.name, '', 120);
  const phone = cleanParam(body.phone, '', 40);
  if (!name || name === 'No especificado' || !phone) {
    return res.status(400).json({ error: 'Nombre y teléfono son obligatorios' });
  }

  const params = [
    name,
    phone,
    cleanParam(body.email, 'No especificado', 120),
    cleanParam(body.eventType, 'No especificado', 60),
    cleanParam(body.date, 'No especificada', 40),
    cleanParam(body.message, 'Sin mensaje', 800),
  ];

  const lang = process.env.META_TEMPLATE_LANG || 'es_MX';
  const url = `https://graph.facebook.com/v21.0/${process.env.META_PHONE_NUMBER_ID}/messages`;

  async function sendTemplate(toPhone) {
    const to = String(toPhone).replace('+', '');
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: process.env.META_CONTACT_TEMPLATE,
          language: { code: lang },
          components: [
            { type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
          ],
        },
      }),
    });
    if (!r.ok) throw new Error(await r.text());
  }

  const owner = process.env.OWNER_WHATSAPP_PHONE || '+528712832271';

  // 1. Notificacion al dueno (obligatoria).
  try {
    await sendTemplate(owner);
  } catch (e) {
    return res.status(502).json({ error: `WhatsApp (dueño): ${e.message}` });
  }

  // 2. Confirmacion a la persona que lleno el formulario (best-effort).
  let confirmationSent = false;
  const requesterPhone = normalizePhone(body.phone);
  if (requesterPhone && requesterPhone.replace('+', '') !== owner.replace('+', '')) {
    try {
      await sendTemplate(requesterPhone);
      confirmationSent = true;
    } catch (e) {
      console.error('No se pudo enviar confirmacion al solicitante:', e.message);
    }
  }

  return res.status(200).json({ ok: true, confirmation_sent: confirmationSent });
}
