# Hacienda Lucina

Sitio web del salón de eventos **Hacienda Lucina** — Torreón, Coahuila.

Sitio estático construido en HTML, CSS y JavaScript plano, sin build step ni dependencias de Node. Filosofía visual *old money*: tipografía serif fina (Cormorant Garamond + Jost), paleta tierra orgánica, sin border-radius, fondos crema/marfil únicamente.

## Estructura

```
lgl_hacienda_v1/
├── index.html      Markup semántico de la página
├── styles.css      Estilos completos (paleta, layout, componentes, responsive)
├── script.js       Lógica del calendario interactivo
├── assets/
│   ├── logo.png    Logo de la marca (transparente)
│   └── README.md   Especificaciones del logo
└── README.md
```

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
7. **Calendario** — Vista mensual con filtros por tipo de evento. Datos hardcoded en `script.js` (mayo–julio 2026, fácil de extender).
8. **Contacto** — Formulario sin border-radius (placeholder, no envía).
9. **Footer** — Verde olivo con logo invertido, links sociales y copyright.

## Personalización

- **Paleta:** edita las variables CSS en `:root` dentro de `styles.css`.
- **Reservas del calendario:** edita el array `BOOKINGS` en `script.js`. Cada entrada es `{ date: 'YYYY-MM-DD', start: 18, end: 26 }` donde `end > 24` representa madrugada (25 = 1 AM, 26 = 2 AM del día siguiente).
- **Logo:** sustituye `assets/logo.png`. Ver [`assets/README.md`](assets/README.md) para especificaciones.
- **Imágenes:** las URLs de Unsplash en `index.html` pueden reemplazarse por archivos en `assets/` cuando haya fotografía real.

## Notas

- El formulario de contacto no tiene backend conectado; el `submit` está prevenido con `event.preventDefault()`. Para enviar leads reales, integra con un servicio como Formspree, Resend, o un endpoint propio.
- El sitio es completamente responsivo (breakpoint en 900 px).
