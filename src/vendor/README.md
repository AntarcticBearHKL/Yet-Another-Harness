# Vendored viewer libraries

These files are served from `/vendor/` so the separate content windows can load
them under the local-server CSP without a network connection.

- `pdfjs/` - PDF.js 6.5.438 (`pdf.min.mjs`, worker, cmaps, standard fonts,
  wasm and iccs), Apache-2.0. See `pdfjs/LICENSE`.
- `prism/` - PrismJS 1.30.0 (`prism.js` plus the language components used by
  the code viewer), MIT. See `prism/LICENSE`.
