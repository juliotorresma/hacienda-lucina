# Assets — Hacienda Lucina

Coloca aquí los archivos de imagen que el sitio referencia.

## Logo

**Archivo actual:** `logo.png` (PNG con transparencia — ideal para que el footer pueda invertirlo a blanco).

**Especificaciones recomendadas:**

- **Ancho:** ~300 px (se renderiza a 148 px en el hero y a 56 px en el footer, pero conviene una resolución mayor para pantallas retina).
- **Formato:** JPG con fondo crema/claro, o PNG con transparencia si quieres que se integre mejor con cualquier fondo.
- **Estilo:** Monograma o lockup tipográfico minimalista. El footer aplica `filter: brightness(0) invert(1) opacity(0.55)` por lo que el logo se renderiza en blanco translúcido sobre el verde olivo — esto significa que **el logo debe tener un alpha/silueta clara** para que funcione bien invertido.

## Comportamiento si falta el logo

Tanto el hero como el footer usan `onerror="this.style.display='none'"`, así que si `logo.png` no existe el sitio sigue viéndose correctamente: solo se omite la imagen y el nombre tipográfico ("Hacienda Lucina" en Cormorant) queda como elemento principal.

## Otras imágenes

El resto de imágenes (hero, gallery strip, galería) están servidas desde Unsplash vía CDN. Si en algún momento quieres reemplazarlas por fotografía real de la hacienda, sube los archivos a esta carpeta y actualiza los `src` correspondientes en `index.html`.
