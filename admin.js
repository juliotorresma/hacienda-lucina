// ============================================================
// Panel Admin — Hacienda Lucina
// ============================================================
// Login propio por WhatsApp (sin Supabase Auth):
//   1. /api/auth-request  -> envia OTP por WhatsApp
//   2. /api/auth-verify   -> valida OTP y devuelve un JWT (HS256)
// El JWT se guarda en localStorage y se usa como Authorization en el
// cliente de Supabase, de modo que el CRUD de eventos respeta RLS.
// Al crear un evento, el DB Webhook on INSERT dispara la notificacion
// por WhatsApp a todos los usuarios (no se llama desde el cliente).
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg = window.SUPABASE_CONFIG || {};
const SESSION_KEY = 'hl_admin_session';

const DAY_START = 6;
const DAY_END = 26;

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// Cliente actual (anon hasta que haya sesion).
let supabase = createClient(cfg.url, cfg.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let session = null; // { access_token, expires_at, user }

function clientWithToken(token) {
  return createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// ── Helpers de UI ──
const $ = (id) => document.getElementById(id);

function showMsg(el, text, kind = 'error') {
  el.textContent = text;
  el.className = 'auth-msg ' + kind;
  el.hidden = false;
}
function clearMsg(el) {
  el.hidden = true;
  el.textContent = '';
}
function setBusy(btn, busy, label) {
  btn.disabled = busy;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.textContent = label || 'Procesando…';
  } else if (btn.dataset.label) {
    btn.textContent = btn.dataset.label;
  }
}

function normalizePhone(raw) {
  const trimmed = String(raw || '').replace(/[\s()-]/g, '');
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return '+52' + digits;
  return '+' + digits;
}

function hourLabel(h) {
  const hh = ((h % 24) + 24) % 24;
  const suffix = hh < 12 ? 'AM' : 'PM';
  let display = hh % 12;
  if (display === 0) display = 12;
  return `${display}:00 ${suffix}`;
}

function formatDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return String(dateStr);
  return `${d} de ${MONTHS_ES[m - 1]} de ${y}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Persistencia de sesion ──
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.access_token || !s.expires_at || s.expires_at < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}
function saveSession(s) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ============================================================
// Login
// ============================================================
let pendingPhone = null;

function fillHourSelects() {
  const start = $('evStart');
  const end = $('evEnd');
  start.innerHTML = '';
  end.innerHTML = '';
  for (let h = DAY_START; h < DAY_END; h++) {
    start.insertAdjacentHTML('beforeend', `<option value="${h}">${hourLabel(h)}</option>`);
  }
  for (let h = DAY_START + 1; h <= DAY_END; h++) {
    end.insertAdjacentHTML('beforeend', `<option value="${h}">${hourLabel(h)}</option>`);
  }
  start.value = '18';
  end.value = '26';
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* respuesta sin cuerpo */
  }
  return { ok: res.ok, status: res.status, data };
}

$('phoneForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMsg($('authMsg'));
  const phone = normalizePhone($('phoneInput').value);
  if (!/^\+\d{8,15}$/.test(phone)) {
    showMsg($('authMsg'), 'Número inválido. Usa formato +52...');
    return;
  }
  setBusy($('phoneBtn'), true, 'Enviando…');
  const { ok, data } = await postJson('/api/auth-request', { phone });
  setBusy($('phoneBtn'), false);
  if (!ok) {
    showMsg($('authMsg'), data.error || 'No se pudo enviar el código.');
    return;
  }
  pendingPhone = phone;
  $('phoneForm').hidden = true;
  $('otpForm').hidden = false;
  $('otpHint').textContent = `Código enviado por WhatsApp a ${phone}.`;
  $('otpInput').focus();
});

$('otpBack').addEventListener('click', () => {
  clearMsg($('authMsg'));
  $('otpForm').hidden = true;
  $('phoneForm').hidden = false;
  pendingPhone = null;
});

$('otpForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMsg($('authMsg'));
  const code = $('otpInput').value.trim();
  if (!pendingPhone || !code) return;
  setBusy($('otpBtn'), true, 'Verificando…');
  const { ok, data } = await postJson('/api/auth-verify', { phone: pendingPhone, code });
  setBusy($('otpBtn'), false);
  if (!ok) {
    showMsg($('authMsg'), data.error || 'Código incorrecto.');
    return;
  }
  session = {
    access_token: data.access_token,
    expires_at: data.expires_at,
    user: data.user,
  };
  saveSession(session);
  supabase = clientWithToken(session.access_token);
  await enterDashboard();
});

$('logoutBtn').addEventListener('click', () => {
  clearSession();
  session = null;
  supabase = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  showAuth();
});

// ============================================================
// Vistas
// ============================================================
function showAuth() {
  $('authView').hidden = false;
  $('dashView').hidden = true;
  $('logoutBtn').hidden = true;
  $('adminUser').hidden = true;
  $('otpForm').hidden = true;
  $('phoneForm').hidden = false;
  $('otpInput').value = '';
  pendingPhone = null;
}

async function enterDashboard() {
  $('authView').hidden = true;
  $('dashView').hidden = false;
  $('logoutBtn').hidden = false;
  const name = session.user?.full_name || session.user?.phone || 'Admin';
  $('adminUser').textContent = name;
  $('adminUser').hidden = false;
  fillHourSelects();
  await loadEvents();
  loadImagesSection();
}

// ============================================================
// Eventos (CRUD)
// ============================================================
$('evAllDay').addEventListener('change', () => {
  $('hoursRow').style.display = $('evAllDay').checked ? 'none' : '';
});

function handleAuthError(error) {
  // Token expirado o invalido -> volver al login.
  if (error && (error.code === 'PGRST301' || /jwt|expired|401/i.test(error.message || ''))) {
    clearSession();
    session = null;
    showAuth();
    showMsg($('authMsg'), 'Tu sesión expiró. Vuelve a entrar.');
    return true;
  }
  return false;
}

async function loadEvents() {
  const list = $('eventsList');
  const empty = $('eventsEmpty');
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .gte('event_date', today)
    .order('event_date', { ascending: true });

  list.querySelectorAll('.event-item').forEach((n) => n.remove());

  if (error) {
    if (handleAuthError(error)) return;
    empty.hidden = false;
    empty.textContent = 'No se pudieron cargar los eventos.';
    return;
  }
  if (!data || data.length === 0) {
    empty.hidden = false;
    empty.textContent = 'No hay eventos próximos.';
    return;
  }
  empty.hidden = true;

  for (const ev of data) {
    const schedule = ev.all_day
      ? 'Todo el día'
      : `${hourLabel(ev.start_hour)} – ${hourLabel(ev.end_hour)}`;
    const node = document.createElement('div');
    node.className = 'event-item';
    node.innerHTML = `
      <div class="event-info">
        <div class="event-top">
          <span class="event-type">${escapeHtml(ev.event_type)}</span>
          <span class="event-date">${formatDate(ev.event_date)}</span>
        </div>
        <div class="event-meta">
          <span><i class="ti ti-clock" aria-hidden="true"></i> ${schedule}</span>
          ${ev.client_name ? `<span><i class="ti ti-user" aria-hidden="true"></i> ${escapeHtml(ev.client_name)}</span>` : ''}
          ${ev.created_by_name ? `<span class="event-author">por ${escapeHtml(ev.created_by_name)}</span>` : ''}
        </div>
        ${ev.notes ? `<p class="event-notes">${escapeHtml(ev.notes)}</p>` : ''}
      </div>
      <div class="event-buttons">
        <button class="event-edit" type="button" aria-label="Editar evento">
          <i class="ti ti-pencil" aria-hidden="true"></i>
        </button>
        <button class="event-del" type="button" aria-label="Eliminar evento">
          <i class="ti ti-trash" aria-hidden="true"></i>
        </button>
      </div>
    `;
    node.querySelector('.event-edit').addEventListener('click', () => startEditEvent(ev));
    node.querySelector('.event-del').addEventListener('click', () => deleteEvent(ev.id));
    list.appendChild(node);
  }
}

function resetEventForm() {
  $('eventForm').reset();
  $('evId').value = '';
  $('eventFormTitle').textContent = 'Nuevo evento';
  $('eventBtn').textContent = 'Crear evento';
  $('eventCancel').hidden = true;
  $('hoursRow').style.display = '';
  fillHourSelects();
}

function startEditEvent(ev) {
  clearMsg($('eventMsg'));
  $('evId').value = ev.id;
  $('evType').value = ev.event_type || '';
  $('evClient').value = ev.client_name || '';
  $('evPhone').value = ev.client_phone || '';
  $('evDate').value = ev.event_date || '';
  $('evAllDay').checked = !!ev.all_day;
  $('hoursRow').style.display = ev.all_day ? 'none' : '';
  if (!ev.all_day) {
    $('evStart').value = String(ev.start_hour);
    $('evEnd').value = String(ev.end_hour);
  }
  $('evNotes').value = ev.notes || '';
  $('eventFormTitle').textContent = 'Editar evento';
  $('eventBtn').textContent = 'Guardar cambios';
  $('eventCancel').hidden = false;
  $('eventFormTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteEvent(id) {
  if (!confirm('¿Eliminar este evento? El horario quedará libre en el calendario.')) return;
  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) {
    if (handleAuthError(error)) return;
    alert('No se pudo eliminar: ' + error.message);
    return;
  }
  await loadEvents();
}

$('eventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMsg($('eventMsg'));

  if (!session) {
    showMsg($('eventMsg'), 'Sesión expirada. Vuelve a entrar.');
    showAuth();
    return;
  }

  const allDay = $('evAllDay').checked;
  let startHour = DAY_START;
  let endHour = DAY_END;
  if (!allDay) {
    startHour = parseInt($('evStart').value, 10);
    endHour = parseInt($('evEnd').value, 10);
    if (!(startHour < endHour)) {
      showMsg($('eventMsg'), 'La hora de inicio debe ser menor que la de fin.');
      return;
    }
  }

  const editingId = $('evId').value;
  const payload = {
    event_type: $('evType').value,
    client_name: $('evClient').value.trim(),
    client_phone: $('evPhone').value.trim(),
    event_date: $('evDate').value,
    start_hour: startHour,
    end_hour: endHour,
    all_day: allDay,
    notes: $('evNotes').value.trim(),
  };

  if (editingId) {
    setBusy($('eventBtn'), true, 'Guardando…');
    const { error } = await supabase.from('events').update(payload).eq('id', editingId);
    setBusy($('eventBtn'), false);
    if (error) {
      if (handleAuthError(error)) return;
      showMsg($('eventMsg'), 'No se pudo guardar: ' + error.message);
      return;
    }
    showMsg($('eventMsg'), 'Cambios guardados.', 'success');
    resetEventForm();
    await loadEvents();
    return;
  }

  payload.created_by = session.user.id;
  payload.created_by_name = session.user.full_name || '';

  setBusy($('eventBtn'), true, 'Creando…');
  const { error } = await supabase.from('events').insert(payload);
  setBusy($('eventBtn'), false);

  if (error) {
    if (handleAuthError(error)) return;
    showMsg($('eventMsg'), 'No se pudo crear: ' + error.message);
    return;
  }

  showMsg($('eventMsg'), 'Evento creado. Se notificó por WhatsApp.', 'success');
  resetEventForm();
  await loadEvents();
});

$('eventCancel').addEventListener('click', () => {
  clearMsg($('eventMsg'));
  resetEventForm();
});

// ============================================================
// Imágenes del sitio
// ============================================================
const IMAGE_BUCKET = 'site-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_SLOTS = [
  { key: 'hero_1', group: 'hero', label: 'Portada 1', def: 'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=900&q=80' },
  { key: 'hero_2', group: 'hero', label: 'Portada 2', def: 'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=900&q=80' },
  { key: 'hero_3', group: 'hero', label: 'Portada 3', def: 'https://images.unsplash.com/photo-1510076857177-7470076d4098?w=900&q=80' },
  { key: 'strip_1', group: 'strip', label: 'Bodas', def: 'https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=800&q=80' },
  { key: 'strip_2', group: 'strip', label: 'Jardines', def: 'https://images.unsplash.com/photo-1464983953574-0892a716854b?w=800&q=80' },
  { key: 'strip_3', group: 'strip', label: 'Celebraciones', def: 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=800&q=80' },
  { key: 'strip_4', group: 'strip', label: 'Salones', def: 'https://images.unsplash.com/photo-1505236858219-8359eb29e329?w=800&q=80' },
  { key: 'gallery_1', group: 'gallery', label: 'Ceremonia en jardín', def: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1000&q=80' },
  { key: 'gallery_2', group: 'gallery', label: 'Gran salón principal', def: 'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=700&q=80' },
  { key: 'gallery_3', group: 'gallery', label: 'Detalles florales', def: 'https://images.unsplash.com/photo-1509927083803-4bd519298ac4?w=700&q=80' },
  { key: 'gallery_4', group: 'gallery', label: 'Mesa de gala', def: 'https://images.unsplash.com/photo-1555244162-803834f70033?w=700&q=80' },
  { key: 'gallery_5', group: 'gallery', label: 'Terraza y jardines', def: 'https://images.unsplash.com/photo-1527529482837-4698179dc6ce?w=700&q=80' },
];

async function fetchSiteImages() {
  const { data, error } = await supabase.from('site_images').select('key,url');
  if (error) {
    if (handleAuthError(error)) return {};
    return {};
  }
  const map = {};
  for (const row of data || []) map[row.key] = row.url;
  return map;
}

function renderImageSlots(urlMap) {
  for (const group of ['hero', 'strip', 'gallery']) {
    const grid = document.querySelector(`.images-grid[data-group="${group}"]`);
    if (!grid) continue;
    grid.innerHTML = '';
    for (const slot of IMAGE_SLOTS.filter((s) => s.group === group)) {
      const url = urlMap[slot.key] || slot.def;
      const card = document.createElement('div');
      card.className = 'image-slot';
      card.innerHTML = `
        <div class="image-thumb">
          <img src="${escapeHtml(url)}" alt="${escapeHtml(slot.label)}" loading="lazy">
        </div>
        <span class="image-label">${escapeHtml(slot.label)}</span>
        <label class="admin-btn image-btn">
          <span class="image-btn-text">Cambiar</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden>
        </label>
        <p class="image-msg" hidden></p>
      `;
      const input = card.querySelector('input[type=file]');
      input.addEventListener('change', () => uploadSlotImage(slot, card, input));
      grid.appendChild(card);
    }
  }
}

// Redimensiona en el navegador: limita el lado mayor y comprime a JPEG.
// Así las fotos del teléfono (que pueden pesar 8-10 MB) quedan ligeras.
function resizeImage(file, maxDim = 2000, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo procesar la imagen'))),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Archivo de imagen inválido'));
    };
    img.src = url;
  });
}

async function uploadSlotImage(slot, card, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const msg = card.querySelector('.image-msg');
  const btnText = card.querySelector('.image-btn-text');

  if (!/^image\//.test(file.type)) {
    msg.hidden = false;
    msg.className = 'image-msg error';
    msg.textContent = 'Selecciona un archivo de imagen.';
    input.value = '';
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    msg.hidden = false;
    msg.className = 'image-msg error';
    msg.textContent = 'La imagen supera los 5 MB.';
    input.value = '';
    return;
  }

  msg.hidden = false;
  msg.className = 'image-msg';
  msg.textContent = 'Procesando…';
  btnText.textContent = 'Subiendo…';

  try {
    let upload = file;
    let ext = 'jpg';
    try {
      upload = await resizeImage(file);
    } catch {
      // Si falla el redimensionado, sube el archivo original.
      upload = file;
      ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    const path = `${slot.key}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, upload, { cacheControl: '3600', upsert: true, contentType: upload.type || 'image/jpeg' });
    if (upErr) throw upErr;

    const { data: pub } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    const { error: dbErr } = await supabase
      .from('site_images')
      .upsert({ key: slot.key, url: publicUrl, updated_at: new Date().toISOString() });
    if (dbErr) throw dbErr;

    card.querySelector('.image-thumb img').src = publicUrl;
    msg.className = 'image-msg success';
    msg.textContent = '¡Actualizada!';
  } catch (err) {
    if (handleAuthError(err)) return;
    msg.className = 'image-msg error';
    msg.textContent = 'No se pudo subir: ' + (err.message || 'error');
  } finally {
    btnText.textContent = 'Cambiar';
    input.value = '';
  }
}

async function loadImagesSection() {
  const urlMap = await fetchSiteImages();
  renderImageSlots(urlMap);
}

// ============================================================
// Arranque
// ============================================================
(async () => {
  if (!cfg.url || cfg.url.includes('YOUR-PROJECT-REF')) {
    showMsg($('authMsg'), 'Falta configurar Supabase en supabase-config.js.');
    return;
  }
  session = loadSession();
  if (session) {
    supabase = clientWithToken(session.access_token);
    await enterDashboard();
  } else {
    showAuth();
  }
})();
