// ============================================================
// Configuracion publica de Supabase (compartida por el sitio publico
// y el panel admin).
// ============================================================
// La URL y la anon key son PUBLICAS por diseno: la seguridad real vive
// en las politicas RLS y en las funciones serverless con service role.
// Reemplaza estos valores con los de tu proyecto Supabase
// (Project Settings -> API).
// ============================================================

window.SUPABASE_CONFIG = {
  url: 'https://fvdjkaluaqvdlywfgtqu.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2ZGprYWx1YXF2ZGx5d2ZndHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMzI3NjksImV4cCI6MjA5NzYwODc2OX0.9tGeKRkncRpA6-3OrEL3J8SHoXBc_VYJgv_Hvb5dUac',
};
