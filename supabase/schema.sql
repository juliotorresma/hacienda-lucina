-- ============================================================
-- Hacienda Lucina - esquema de base de datos (Supabase / Postgres)
-- ============================================================
-- Ejecutar en el SQL Editor del proyecto Supabase.
-- Crea: profiles, events, allowed_phones, la vista publica de
-- disponibilidad, y las politicas RLS.
-- ============================================================

-- ----------------------------------------------------------------
-- Extensiones
-- ----------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------
-- Tabla: allowed_phones (allowlist de telefonos que pueden entrar)
-- ----------------------------------------------------------------
create table if not exists public.allowed_phones (
  phone text primary key,
  full_name text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- Tabla: profiles (un registro por usuario; a quienes se notifica)
-- ----------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- Tabla: events (reservas / bloqueos del calendario)
-- ----------------------------------------------------------------
-- Ventana operativa del salon: horas 6..26 (26 = 2 AM del dia siguiente).
-- Para "todo el dia" se usa all_day = true (start_hour=6, end_hour=26).
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null default '',
  event_type text not null,
  client_name text not null default '',
  client_phone text not null default '',
  event_date date not null,
  start_hour int not null default 6,
  end_hour int not null default 26,
  all_day boolean not null default false,
  notes text not null default '',
  constraint events_hours_chk check (start_hour >= 6 and end_hour <= 26 and start_hour < end_hour)
);

create index if not exists events_event_date_idx on public.events (event_date);

-- ----------------------------------------------------------------
-- Tabla: otp_codes (codigos de un solo uso para login por WhatsApp)
-- ----------------------------------------------------------------
-- Solo la accede el service role (las funciones serverless). Guarda el
-- hash del codigo, nunca el codigo en claro.
create table if not exists public.otp_codes (
  phone text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- Vista publica: solo ocupacion, sin datos del cliente
-- ----------------------------------------------------------------
-- security_invoker = off (default): la vista corre con privilegios del
-- owner y puede leer events aunque anon no tenga acceso directo.
create or replace view public.public_availability as
  select event_date, start_hour, end_hour, all_day
  from public.events;

-- ----------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------
alter table public.events enable row level security;
alter table public.profiles enable row level security;
alter table public.allowed_phones enable row level security;
alter table public.otp_codes enable row level security;

-- events: cualquier usuario autenticado (todos son admins predeterminados)
drop policy if exists "events_select_auth" on public.events;
create policy "events_select_auth" on public.events
  for select to authenticated using (true);

drop policy if exists "events_insert_auth" on public.events;
create policy "events_insert_auth" on public.events
  for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists "events_update_auth" on public.events;
create policy "events_update_auth" on public.events
  for update to authenticated using (true) with check (true);

drop policy if exists "events_delete_auth" on public.events;
create policy "events_delete_auth" on public.events
  for delete to authenticated using (true);

-- profiles: lectura para autenticados; sin escritura desde el cliente
drop policy if exists "profiles_select_auth" on public.profiles;
create policy "profiles_select_auth" on public.profiles
  for select to authenticated using (true);

-- allowed_phones: sin acceso desde cliente (solo service role lo lee).
-- No se crean politicas, asi anon/authenticated quedan sin acceso.

-- otp_codes: sin acceso desde cliente (solo service role). Sin politicas.

-- ----------------------------------------------------------------
-- Grants para la vista publica
-- ----------------------------------------------------------------
grant select on public.public_availability to anon, authenticated;

-- Nota: events / profiles / allowed_phones NO se otorgan a anon.
-- El service role (usado por las funciones serverless) ignora RLS.
