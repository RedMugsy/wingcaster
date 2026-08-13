# WhatsApp Listings Template Fonts

This directory hosts self-hosted fonts used by the thumbnail compositing engine
(`backend/src/modules/whatsapp-listings/infrastructure/templates/`).

## Bundled fonts

- `NotoSans-Regular.ttf` — Latin/Greek/Cyrillic sans-serif fallback.
- `NotoSansArabic-Regular.ttf` — Arabic script support for RTL text.

These fonts are embedded as base64 data URIs inside the SVG overlays generated
by each variant, so they do not need to be installed on the host OS.

## Fallback behavior

If a font file is missing, the engine falls back to system sans-serif fonts
(`DejaVu Sans`, `Arial`, generic `sans-serif`). This is handled automatically in
`utils.js::getFontFaces()`. Arabic text will still be rendered, but the
glyph quality depends on the fonts available on the server.

## Adding or replacing a font

1. Place the TTF/OTF file in this directory.
2. Update `FONT_FILES` in `../utils.js` if the filename changes.
3. Restart the process (font base64 strings are cached on first use).

## Note on ligatures and bidirectional text

`sharp` composites SVGs using librsvg. The embedded Arabic font covers basic
glyph display, but complex Arabic shaping (ligatures, joining, and bidirectional
layout) is not guaranteed. For best results, keep overlay text short and simple.
