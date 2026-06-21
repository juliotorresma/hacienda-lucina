// ============================================================
// Panel Admin — Hacienda Lucina
// ============================================================
// Login por telefono + OTP (Supabase Auth, el OTP llega por WhatsApp
// gracias al Send SMS Hook). Guard de sesion y CRUD de eventos.
// Al crear un evento, el DB Webhook on INSERT dispara la notificacion
// por WhatsApp a todos los usuarios (no se llama desde el cliente).
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg = window.SUPABASE_CONFIG || {};
const supabase = createClient(cfg.url, cfg.anonKey);

const DAY_START = 6;
const DAY_END = 26;

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

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
  // Default Mexico si no traen lada internacional.
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

$('phoneForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMsg($('authMsg'));
  const phone = normalizePhone($('phoneInput').value);
  if (!/^\+\d{8,15}$/.test(phone)) {
    showMsg($('authMsg'), 'Número inválido. Usa formato +52...');
    return;
  }
  setBusy($('phoneBtn'), true, 'Enviando…');
  const { error } = await supabase.auth.signInWithOtp({ phone });
  setBusy($('phoneBtn'), false);
  if (error) {
    showMsg($('authMsg'), error.message || 'No se pudo enviar el código.');
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
  const token = $('otpInput').value.trim();
  if (!pendingPhone || !token) return;
  setBusy($('otpBtn'), true, 'Verificando…');
  const { error } = await supabase.auth.verifyOtp({
    phone: pendingPhone,
    token,
    type: 'sms',
  });
  setBusy($('otpBtn'), false);
  if (error) {
    showMsg($('authMsg'), error.message || 'Código incorrecto.');
    return;
  }
  // onAuthStateChange se encarga de mostrar el dashboard.
});

$('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
});

// ============================================================
// Sesion / guard
// ============================================================
let currentProfile = null;

async function loadProfile(user) {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, phone')
    .eq('id', user.id)
    .maybeSingle();
  currentProfile = data || {
    full_name: user.user_metadata?.full_name || '',
    phone: user.phone ? '+' + user.phone : '',
  };
}

async function renderSession(session) {
  if (session && session.user) {
    await loadProfile(session.user);
    $('authView').hidden = true;
    $('dashView').hidden = false;
    $('logoutBtn').hidden = false;
    const name = currentProfile?.full_name || currentProfile?.phone || 'Admin';
    $('adminUser').textContent = name;
    $('adminUser').hidden = false;
    fillHourSelects();
    await loadEvents();
  } else {
    $('authView').hidden = false;
    $('dashView').hidden = true;
    $('logoutBtn').hidden = true;
    $('adminUser').hidden = true;
    // reset login
    $('otpForm').hidden = true;
    $('phoneForm').hidden = false;
    $('otpInput').value = '';
    pendingPhone = null;
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  renderSession(session);
});

// ============================================================
// Eventos (CRUD)
// ============================================================
$('evAllDay').addEventListener('change', () => {
  $('hoursRow').style.display = $('evAllDay').checked ? 'none' : '';
});

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
      <button class="event-del" type="button" data-id="${ev.id}" aria-label="Eliminar evento">
        <i class="ti ti-trash" aria-hidden="true"></i>
      </button>
    `;
    node.querySelector('.event-del').addEventListener('click', () => deleteEvent(ev.id));
    list.appendChild(node);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function deleteEvent(id) {
  if (!confirm('¿Eliminar este evento? El horario quedará libre en el calendario.')) return;
  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) {
    alert('No se pudo eliminar: ' + error.message);
    return;
  }
  await loadEvents();
}

$('eventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMsg($('eventMsg'));

  const { data: sess } = await supabase.auth.getUser();
  const user = sess?.user;
  if (!user) {
    showMsg($('eventMsg'), 'Sesión expirada. Vuelve a entrar.');
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

  const payload = {
    created_by: user.id,
    created_by_name: currentProfile?.full_name || '',
    event_type: $('evType').value,
    client_name: $('evClient').value.trim(),
    client_phone: $('evPhone').value.trim(),
    event_date: $('evDate').value,
    start_hour: startHour,
    end_hour: endHour,
    all_day: allDay,
    notes: $('evNotes').value.trim(),
  };

  setBusy($('eventBtn'), true, 'Creando…');
  const { error } = await supabase.from('events').insert(payload);
  setBusy($('eventBtn'), false);

  if (error) {
    showMsg($('eventMsg'), 'No se pudo crear: ' + error.message);
    return;
  }

  showMsg($('eventMsg'), 'Evento creado. Se notificó por WhatsApp.', 'success');
  $('eventForm').reset();
  $('hoursRow').style.display = '';
  fillHourSelects();
  await loadEvents();
});

// ============================================================
// Arranque
// ============================================================
(async () => {
  if (!cfg.url || cfg.url.includes('YOUR-PROJECT-REF')) {
    showMsg($('authMsg'), 'Falta configurar Supabase en supabase-config.js.');
    return;
  }
  const { data } = await supabase.auth.getSession();
  await renderSession(data.session);
})();
