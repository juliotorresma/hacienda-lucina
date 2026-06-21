# Hacienda Lucina

Sitio web del salón de eventos **Hacienda Lucina** — Torreón, Coahuila.

Sitio estático construido en HTML, CSS y JavaScript plano, sin build step ni dependencias de Node. Filosofía visual *old money*: tipografía serif fina (Cormorant Garamond + Jost), paleta tierra orgánica, sin border-radius, fondos crema/marfil únicamente.

## Estructura

```
lgl_hacienda_v1/
├── index.html            Markup semántico de la página pública
├── styles.css            Estilos del sitio público
├── script.js             Calendario público (lee disponibilidad de Supabase)
├── supabase-config.js    URL + anon key públicas (compartido público/admin)
├── admin.html            Panel admin (/admin): login + CRUD de eventos
├── admin.js              Lógica del panel (auth por OTP, eventos)
├── admin.css             Estilos del panel admin
├── api/
│   ├── auth-request.js   Genera OTP y lo envía por WhatsApp (allowlist)
│   ├── auth-verify.js    Verifica OTP y emite el JWT de sesión (HS256)
│   └── notify-event.js   DB Webhook on INSERT → notifica eventos por WhatsApp
├── scripts/
│   └── seed-user.mjs     Pre-crea usuarios admin (auth + profile + allowlist)
├── supabase/
│   └── schema.sql        Tablas, vista pública y políticas RLS
├── package.json          Dependencia @supabase/supabase-js (para /api y seed)
├── .env.example          Plantilla de variables de entorno
├── vercel.json           cleanUrls, cache y no-store para /api
├── assets/
│   ├── logo.png          Logo de la marca (transparente)
│   └── README.md         Especificaciones del logo
└── README.md
```

## Panel admin + reservas dinámicas (Supabase + WhatsApp)

El calendario público dejó de usar datos hardcoded: ahora lee la vista
`public_availability` de Supabase (solo fecha y horas, sin datos del cliente).
El panel en `/admin` permite a usuarios predeterminados iniciar sesión con su
teléfono y un código que llega por **WhatsApp**, crear/eliminar eventos, y cada
creación dispara una notificación por WhatsApp a todos los usuarios.

### Arquitectura

El login **no usa el servicio de Auth/SMS de Supabase**: es un flujo de OTP
propio enteramente por WhatsApp.

- **`api/auth-request.js`** valida el teléfono contra la allowlist, genera un
  OTP de 6 dígitos (guarda solo su hash en `otp_codes`) y lo manda por WhatsApp
  con la Cloud API de Meta.
- **`api/auth-verify.js`** valida el código y, si es correcto, emite un **JWT
  firmado con el JWT Secret del proyecto** (HS256). Es el mismo formato que usa
  Supabase, así que **RLS funciona sin cambios**. El front guarda ese token en
  `localStorage` y lo manda como `Authorization` en cada consulta.
- **Tabla `events`** (protegida con RLS) guarda las reservas. Un *Database
  Webhook on INSERT* llama a `api/notify-event.js`, que notifica a todos.
- **Vista `public_availability`** es lo único que el público (anon) puede leer.
- Todos los secretos viven en variables de entorno de Vercel; las funciones
  `/api` los usan con la *service role key* (ignora RLS).

### Variables de entorno

Copia `.env.example` a `.env` (para scripts locales) y configura las mismas en
Vercel (Project Settings → Environment Variables):

| Variable | Dónde se usa | Pública |
|---|---|---|
| `SUPABASE_URL` | scripts, `/api`, `supabase-config.js` | sí |
| `SUPABASE_ANON_KEY` | `supabase-config.js` | sí |
| `SUPABASE_SERVICE_ROLE_KEY` | seed, `/api` | **no** |
| `SUPABASE_JWT_SECRET` | `api/auth-verify.js` | **no** |
| `META_WHATSAPP_TOKEN` | `/api` | **no** |
| `META_PHONE_NUMBER_ID` | `/api` | **no** |
| `META_OTP_TEMPLATE` | `api/auth-request.js` | no |
| `META_EVENT_TEMPLATE` | `api/notify-event.js` | no |
| `META_TEMPLATE_LANG` | `/api` (default `es_MX`) | no |
| `EVENT_WEBHOOK_SECRET` | `api/notify-event.js` | **no** |
| `OTP_TTL_SECONDS` | `api/auth-request.js` (default 300) | no |
| `OTP_RESEND_SECONDS` | `api/auth-request.js` (default 30) | no |
| `SESSION_TTL_SECONDS` | `api/auth-verify.js` (default 43200) | no |

Además, pon `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `supabase-config.js`
(son públicas por diseño).

### Checklist de configuración

**1. Supabase — base de datos**

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En *SQL Editor*, pega y ejecuta `supabase/schema.sql`.
3. En *Project Settings → API*, copia `URL`, `anon key`, `service_role key` y
   el **JWT Secret** (*JWT Settings*) → ponlo en `SUPABASE_JWT_SECRET`.

**2. Seed del usuario admin**

```bash
npm install
# llena .env con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
npm run seed
```

Esto crea a Julio (`+528712832271`) en `auth.users` (para tener un `id` estable),
`profiles` y `allowed_phones`. Para agregar más usuarios, edita el array `USERS`
en `scripts/seed-user.mjs`. El login en sí **no** usa el Auth de Supabase.

**3. Meta WhatsApp Cloud API**

1. Crea una app en [developers.facebook.com](https://developers.facebook.com)
   con el producto *WhatsApp* y obtén el *Phone Number ID* y un *token
   permanente*.
2. Crea y espera aprobación de dos plantillas:
   - **Autenticación** (categoría *Authentication*) para el OTP. Debe tener un
     parámetro de cuerpo y el botón *copy-code*. Pon su nombre en
     `META_OTP_TEMPLATE`.
   - **Utility** para avisar de eventos, con 4 parámetros de cuerpo en orden:
     `{{1}}` quién creó, `{{2}}` tipo de evento, `{{3}}` fecha, `{{4}}` horario.
     Pon su nombre en `META_EVENT_TEMPLATE`.

**4. Supabase — Database Webhook (notificación de eventos)**

No hace falta tocar *Authentication* (el login es propio por WhatsApp).

1. *Database → Webhooks*: crea uno *on INSERT* en la tabla `events`, tipo
   *HTTP Request → POST* a `https://TU-DOMINIO/api/notify-event`, y agrega un
   header `x-webhook-secret` con el mismo valor que `EVENT_WEBHOOK_SECRET`.

**5. Deploy en Vercel**

1. Configura todas las variables de entorno (tabla de arriba).
2. Actualiza `supabase-config.js` con la URL y anon key reales.
3. Deploy. El panel queda en `/admin` (gracias a `cleanUrls`).

## Cómo abrirlo

### Opción 1 — Doble clic

Abre `index.html` directamente en tu navegador. Las fuentes de Google, los íconos Tabler y las imágenes de Unsplash se cargan vía CDN, así que solo necesitas conexión a internet.

### Opción 2 — Servidor local (recomendado)

Desde la raíz del proyecto, con Python:

```bash
python3 -m http.server 8080
```

O con Node:

```bash
npx serve .
```

Luego abre `http://localhost:8080`.

## Secciones

1. **Nav fija** — logo, menú y CTA de cotización.
2. **Hero** — `100vh` con grid de 3 fotos atenuadas, overlay radial crema, logo, título, tagline y CTAs.
3. **Gallery strip** — 4 imágenes con labels en itálica (Bodas, Jardines, Celebraciones, Salones).
4. **Nosotros** — Arquitectura, Exclusividad, Naturaleza.
5. **Conceptos** — Bodas, XV, Corporativo, Cumpleaños, Graduación, Eventos privados (con punto de color por categoría).
6. **Galería** — Grid asimétrico 2fr/1fr/1fr.
7. **Calendario** — Vista mensual con disponibilidad leída en vivo desde la vista `public_availability` de Supabase.
8. **Contacto** — Formulario sin border-radius (placeholder, no envía).
9. **Footer** — Verde olivo con logo invertido, links sociales y copyright.

## Personalización

- **Paleta:** edita las variables CSS en `:root` dentro de `styles.css`.
- **Reservas del calendario:** se administran desde el panel `/admin`. El horario va de 6:00 a 2:00 del día siguiente (las horas internas usan `end > 24` para la madrugada: 25 = 1 AM, 26 = 2 AM).
- **Logo:** sustituye `assets/logo.png`. Ver [`assets/README.md`](assets/README.md) para especificaciones.
- **Imágenes:** las URLs de Unsplash en `index.html` pueden reemplazarse por archivos en `assets/` cuando haya fotografía real.

## Notas

- El formulario de contacto no tiene backend conectado; el `submit` está prevenido con `event.preventDefault()`. Para enviar leads reales, integra con un servicio como Formspree, Resend, o un endpoint propio.
- El sitio es completamente responsivo (breakpoint en 900 px).
- Si `supabase-config.js` aún tiene los valores placeholder, el calendario público se muestra vacío y el panel `/admin` avisa que falta configurar Supabase.
