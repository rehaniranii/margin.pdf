<div align="center">

# margin.pdf

**Edit the text inside any PDF, right in your browser.**

Your files never leave your device. No uploads, no account, works offline.

[**Open margin.pdf →**](https://marginpdf.xyz)

![React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-build-646cff?logo=vite&logoColor=white)
![MuPDF](https://img.shields.io/badge/MuPDF-WebAssembly-1a1a1a)
![PWA](https://img.shields.io/badge/PWA-works%20offline-5a0fc8)

</div>

---

## Why margin.pdf

Most "PDF editors" paste a white box over the old words and put new text on top, in the wrong font and slightly out of line. margin.pdf removes the original text and writes the replacement where it was, so the result is a real PDF edit you can search, copy and select.

Everything runs locally: the PDF engine ([MuPDF](https://mupdf.com)) is compiled to WebAssembly and runs in a Web Worker in your browser tab. There is no backend, and no code path that uploads a document.

## Features

### Edit existing text

- **Click a line and retype it.** The original text is removed and the replacement is drawn in its place.
- **Matching fonts.** Text set in Calibri, Cambria or LaTeX's Computer Modern is replaced with metric-compatible fonts (Carlito, Caladea, Latin Modern), so it takes the same space. The standard PDF fonts cover Arial, Times and Courier.
- **Bold and italic on a selection.** Select words and press <kbd>⌘/Ctrl</kbd>+<kbd>B</kbd> or <kbd>⌘/Ctrl</kbd>+<kbd>I</kbd>. Only those words change.
- **Room to grow.** Longer text expands into the empty space beside a line or below a paragraph without touching anything else. Click that empty space to start typing there. Right-aligned text, such as dates on a resume, grows to the left.
- **Links follow the text.** Edit a linked URL and change where it points, in one step.
- **Scanned documents.** On phone scans with a searchable text layer, the old words are covered with the paper's own color and the new text is drawn in the original ink color.
- **Safe by design.** Every edit is verified before it is applied. If a change would remove or overlap neighboring content, it is refused with a clear reason, and lines that can't be edited safely say why.

### Tools

| Edit | Organize | Convert | Stamp | Protect |
|---|---|---|---|---|
| Edit text | Merge | Compress | Watermark | Redact |
| Annotate | Split & extract | Images to PDF | Page numbers | Remove hidden data |
| Add text & images | Organize pages | PDF to images | | Protect with password |
| Fill and sign | Crop pages | Make searchable (OCR) | | Unlock |

### Private and offline

- Documents are processed in memory, in your browser, and only leave as a download you start.
- Installable as an app. After the first visit it works with no internet connection.
- Production builds use Vercel Web Analytics for anonymous page views only. No file names, text or edits are ever sent. See [Analytics](docs/GUIDE.md#vercel-web-analytics).

## Getting started

Requires **Node.js 20.19+ or 22.12+** and npm.

```sh
git clone https://github.com/rehaniranii/freepdftools.git
cd freepdftools
npm ci
npm run dev
```

Open the printed localhost URL and choose **Open editor**, or go straight to `/#/edit` and drop in a PDF.

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm test` | Run the test suite (Node's built-in test runner) |
| `npm run build` | Type-check and build the production app, including offline files |
| `npm run preview` | Serve the production build locally |

## How it works

```
React UI ──messages──▶ Web Worker ──▶ MuPDF (WebAssembly)
   │                       │
   │                       ├─ text analysis: which lines are safe to edit, and why not
   │                       ├─ edit compiler: remove original glyphs, write replacements
   │                       └─ verification: re-open the result and check every glyph
   ▼
Service worker: caches the app (never your files) for offline use
```

- **`src/engine/`**: PDF analysis, text editing, fonts, free-space and scan handling, page tools.
- **`src/components/`**: the editor UI, including the rich text field and the tool panels.
- **`src/workers/`**: the PDF and OCR workers that keep heavy work off the main thread.
- **`tests/`**: engine and model tests built on generated PDFs.

More detail is in [Architecture](docs/ARCHITECTURE.md), the [detailed guide](docs/GUIDE.md) and the [engine decision record](docs/ENGINE-DECISION.md).

## Limitations

- Replacement text uses Latin characters (accents included). Other scripts and emoji are not supported yet.
- Scanned pages need a searchable text layer. On shaded or textured paper, the cover patch can be visible.
- Very large or malformed PDFs can exceed browser memory limits.

## License

No license has been chosen for this project yet. MuPDF, the PDF engine it uses, is licensed under **AGPL-3.0-or-later**, with commercial licenses available from Artifex. Read the [engine decision record](docs/ENGINE-DECISION.md) before distributing the app or its WebAssembly binary. Bundled fonts are licensed under the SIL Open Font License or the GUST Font License; see [third-party notices](public/licenses/THIRD-PARTY-NOTICES.txt).
