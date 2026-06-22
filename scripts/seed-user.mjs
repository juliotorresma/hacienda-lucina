// ============================================================
// Seed del usuario admin de Hacienda Lucina
// ============================================================
// Pre-crea un usuario de Supabase Auth con telefono, su fila en
// "profiles" y su entrada en "allowed_phones". Solo los telefonos
// de la allowlist podran recibir el codigo OTP por WhatsApp.
//
// Uso:
//   1. Crea un .env en la raiz con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
//      (ver .env.example).
//   2. Corre:  node --env-file=.env scripts/seed-user.mjs
//
// Requiere Node 20+ (por --env-file). Tambien puedes exportar las
// variables manualmente y correr:  node scripts/seed-user.mjs
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  process.exit(1);
}

// ── Usuarios predeterminados a crear ──
// Telefono en formato E.164 (con +). Mexico: +52 + 10 digitos.
const USERS = [
  { phone: '+528712832271', full_name: 'Julio' },
  { phone: '+528712778976', full_name: 'David' },
  { phone: '+528716133342', full_name: 'Sofía' },
];

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByPhone(phone) {
  // Busca paginando (la cantidad de usuarios es pequena).
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.phone === phone.replace('+', '') || u.phone === phone);
    if (match) return match;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function seedUser({ phone, full_name }) {
  console.log(`\n→ ${full_name} (${phone})`);

  // 1. Allowlist
  {
    const { error } = await admin
      .from('allowed_phones')
      .upsert({ phone, full_name }, { onConflict: 'phone' });
    if (error) throw new Error(`allowed_phones: ${error.message}`);
    console.log('  allowlist  OK');
  }

  // 2. Usuario de auth (idempotente)
  let user = await findUserByPhone(phone);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
      user_metadata: { full_name },
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    user = data.user;
    console.log('  auth user  creado', user.id);
  } else {
    console.log('  auth user  ya existia', user.id);
  }

  // 3. Profile
  {
    const { error } = await admin
      .from('profiles')
      .upsert({ id: user.id, full_name, phone }, { onConflict: 'id' });
    if (error) throw new Error(`profiles: ${error.message}`);
    console.log('  profile    OK');
  }
}

(async () => {
  try {
    for (const u of USERS) await seedUser(u);
    console.log('\nListo. Usuarios sembrados correctamente.');
  } catch (e) {
    console.error('\nError:', e.message);
    process.exit(1);
  }
})();
