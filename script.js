/* ── Hacienda Lucina · calendario por disponibilidad horaria ── */

// Ventana operativa: 6:00 a 2:00 del día siguiente (20 slots, h=6..25)
const DAY_START = 6;
const DAY_END = 26;
const DAY_SPAN = DAY_END - DAY_START; // 20 horas

// Cada reserva ocupa el rango [start, end) en horas 24h.
// start/end pueden llegar hasta 26 (= 2 AM del día siguiente).
// Se llena dinámicamente desde la vista public_availability de Supabase.
let BOOKINGS = [];

// Lee la ocupación pública (sin datos del cliente) desde Supabase.
// La vista public_availability solo expone fecha y horas.
async function loadBookings() {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg || !cfg.url || cfg.url.includes('YOUR-PROJECT-REF')) {
    console.warn('Supabase no configurado: el calendario se muestra vacío.');
    return;
  }
  try {
    const res = await fetch(
      cfg.url + '/rest/v1/public_availability?select=event_date,start_hour,end_hour,all_day',
      {
        headers: {
          apikey: cfg.anonKey,
          Authorization: 'Bearer ' + cfg.anonKey,
        },
      }
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    BOOKINGS = rows.map((r) => ({
      date: r.event_date,
      start: r.all_day ? DAY_START : r.start_hour,
      end: r.all_day ? DAY_END : r.end_hour,
    }));
  } catch (e) {
    console.error('No se pudo cargar la disponibilidad:', e);
    BOOKINGS = [];
  }
}

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const WEEKDAYS_ES = [
  'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado',
];

// Rango de años para el selector
const YEAR_MIN = 2026;
const YEAR_MAX = 2028;

let curYear = 2026;
let curMonth = 4; // mayo

function dk(y, m, d) {
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// Devuelve el conjunto de horas (6..25) ocupadas en un día.
function getOccupiedHours(key) {
  const set = new Set();
  for (const b of BOOKINGS) {
    if (b.date !== key) continue;
    const from = Math.max(DAY_START, b.start);
    const to = Math.min(DAY_END, b.end);
    for (let h = from; h < to; h++) set.add(h);
  }
  return set;
}

// Mapea % ocupación a clase de tonalidad.
function occClass(pct) {
  if (pct >= 1)    return 'occ-full';
  if (pct >= 0.76) return 'occ-4';
  if (pct >= 0.51) return 'occ-3';
  if (pct >= 0.26) return 'occ-2';
  if (pct > 0)     return 'occ-1';
  return 'occ-0';
}

function formatHour(h) {
  const h24 = h % 24;
  const period = h24 < 12 ? 'AM' : 'PM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return h12 + ':00 ' + period;
}

/* ── Filtros año / mes ── */
function buildFilters() {
  const monthSel = document.getElementById('monthSel');
  const yearSel = document.getElementById('yearSel');
  if (!monthSel || !yearSel) return;

  monthSel.innerHTML = MONTHS_ES
    .map((m, i) => '<option value="' + i + '">' + m + '</option>')
    .join('');
  monthSel.value = String(curMonth);

  let yearOptions = '';
  for (let y = YEAR_MIN; y <= YEAR_MAX; y++) {
    yearOptions += '<option value="' + y + '">' + y + '</option>';
  }
  yearSel.innerHTML = yearOptions;
  yearSel.value = String(curYear);

  monthSel.addEventListener('change', () => {
    curMonth = parseInt(monthSel.value, 10);
    showMonthView();
    buildCalendar();
  });
  yearSel.addEventListener('change', () => {
    curYear = parseInt(yearSel.value, 10);
    showMonthView();
    buildCalendar();
  });
}

/* ── Vista mes ── */
function buildCalendar() {
  const grid = document.getElementById('calGrid');
  if (!grid) return;

  const firstDay = new Date(curYear, curMonth, 1).getDay();
  const daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  const today = new Date();

  grid.innerHTML = '';
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    const dayNum = i - firstDay + 1;
    const isValid = dayNum >= 1 && dayNum <= daysInMonth;

    if (!isValid) {
      cell.className = 'cal-day empty';
      cell.setAttribute('aria-hidden', 'true');
      grid.appendChild(cell);
      continue;
    }

    const key = dk(curYear, curMonth, dayNum);
    const occupied = getOccupiedHours(key);
    const pct = occupied.size / DAY_SPAN;
    const klass = occClass(pct);

    const isToday =
      today.getFullYear() === curYear &&
      today.getMonth() === curMonth &&
      today.getDate() === dayNum;

    cell.className = 'cal-day ' + klass + (isToday ? ' today' : '');
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.dataset.day = String(dayNum);

    const label = pct >= 1
      ? 'Ocupado todo el día'
      : pct === 0
        ? 'Día libre'
        : Math.round(pct * 100) + '% ocupado';
    cell.setAttribute('aria-label',
      WEEKDAYS_ES[new Date(curYear, curMonth, dayNum).getDay()] +
      ' ' + dayNum + ' de ' + MONTHS_ES[curMonth] + ', ' + label
    );

    const num = document.createElement('div');
    num.className = 'cal-dnum';
    num.textContent = dayNum;
    cell.appendChild(num);

    if (pct > 0 && pct < 1) {
      const meter = document.createElement('div');
      meter.className = 'cal-meter';
      meter.textContent = occupied.size + 'h';
      cell.appendChild(meter);
    }

    cell.addEventListener('click', () => showDayDetail(curYear, curMonth, dayNum));
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showDayDetail(curYear, curMonth, dayNum);
      }
    });

    grid.appendChild(cell);
  }
}

/* ── Vista día (in-place) ── */
function showDayDetail(year, month, day) {
  const monthView = document.getElementById('monthView');
  const dayView = document.getElementById('dayView');
  if (!monthView || !dayView) return;

  buildDaySchedule(year, month, day);
  monthView.hidden = true;
  dayView.hidden = false;
  dayView.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showMonthView() {
  const monthView = document.getElementById('monthView');
  const dayView = document.getElementById('dayView');
  if (!monthView || !dayView) return;

  dayView.hidden = true;
  monthView.hidden = false;
}

function buildDaySchedule(year, month, day) {
  const titleEl = document.getElementById('dayTitle');
  const summaryEl = document.getElementById('daySummary');
  const listEl = document.getElementById('daySchedule');
  if (!titleEl || !summaryEl || !listEl) return;

  const dt = new Date(year, month, day);
  const weekday = WEEKDAYS_ES[dt.getDay()];
  titleEl.textContent =
    weekday + ', ' + day + ' de ' + MONTHS_ES[month].toLowerCase() + ' de ' + year;

  const key = dk(year, month, day);
  const occupied = getOccupiedHours(key);
  const busy = occupied.size;
  const free = DAY_SPAN - busy;

  if (busy === 0) {
    summaryEl.textContent = 'Día libre · ' + DAY_SPAN + ' horas disponibles';
  } else if (busy === DAY_SPAN) {
    summaryEl.textContent = 'Día ocupado · sin disponibilidad';
  } else {
    summaryEl.textContent = busy + ' h ocupadas · ' + free + ' h libres';
  }

  listEl.innerHTML = '';
  for (let h = DAY_START; h < DAY_END; h++) {
    const li = document.createElement('li');
    const isBusy = occupied.has(h);
    li.className = 'hour-slot ' + (isBusy ? 'occupied' : 'free');

    const label = document.createElement('span');
    label.className = 'hour-label';
    label.textContent = formatHour(h);

    const status = document.createElement('span');
    status.className = 'hour-status';
    status.textContent = isBusy ? 'Ocupado' : 'Libre';

    li.appendChild(label);
    li.appendChild(status);
    listEl.appendChild(li);
  }
}

/* ── Mobile menu ── */
function initMobileMenu() {
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  if (!toggle || !links) return;

  const closeMenu = () => {
    links.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Abrir menú');
  };
  const openMenu = () => {
    links.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Cerrar menú');
  };

  toggle.addEventListener('click', () => {
    if (links.classList.contains('open')) closeMenu();
    else openMenu();
  });

  links.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', closeMenu);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && links.classList.contains('open')) closeMenu();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900 && links.classList.contains('open')) closeMenu();
  });
}

function initBack() {
  const back = document.getElementById('calBack');
  if (back) back.addEventListener('click', showMonthView);
}

async function init() {
  buildFilters();
  buildCalendar();
  initBack();
  initMobileMenu();
  await loadBookings();
  buildCalendar();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
