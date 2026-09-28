# AGENTS.md

## Project overview

This repository is an e-commerce automation toolkit for processing order Excel files, generating product images, and managing product prices. Preserve the existing behavior and privacy boundaries unless the user explicitly requests a change.

## Technology and architecture

- The frontend uses Vanilla JavaScript with ES Modules, HTML5, Bootstrap 5, and custom CSS.
- Do not convert the project to React, Vue, Vite, TypeScript, or another framework without an explicit request.
- Preserve the existing Parser / Service / View separation.
- `js/app.js` registers the hash-based SPA routes.
- `js/order/` handles order parsing and output entirely in the browser.
- `js/price/` parses price workbooks and persists price data in IndexedDB.
- `api/product-capture.js` and `api/lib/` implement the Playwright and Sharp product-capture API.

## Privacy and data boundaries

- Never send order Excel contents or customer personal data to the server.
- Do not change the IndexedDB-based price storage model without an explicit request.
- Preserve the existing product-capture API boundary: only the product URL is sent to the server, and generated image data is returned to the client.
- Treat workbook data, URLs, scraped page content, filenames, and API responses as untrusted input.
- Prefer `textContent` or proper escaping when rendering external data. Never insert untrusted values directly into `innerHTML`.

## Secrets and configuration

- Never place secrets, credentials, tokens, passwords, or private customer data in source code, logs, documentation, or commits.
- Do not print secret values during diagnostics.
- Keep `.env` and `.env.*` files untracked. Frontend-visible variables must never contain secrets.
- Existing platform variables and local runtime options should be preserved unless a change is requested.

## Coding conventions

- Use ES Module `import` and `export` syntax.
- Use PascalCase for classes, camelCase for functions and variables, and UPPER_SNAKE_CASE for constants.
- Continue using JSDoc for type information; do not introduce TypeScript without an explicit request.
- Keep user-facing messages in Korean and log technical details with `console.error` where appropriate.
- Views that register listeners, timers, or other resources should return or expose cleanup behavior.
- When adding a supported shopping mall, check both frontend and server parser factories and add relevant tests.

## Change discipline

- Do not change existing behavior unless the user requests it.
- Do not perform unrequested refactors.
- Do not add libraries or packages unless the user requests or approves them.
- Do not modify unrelated files.
- Keep changes focused and consistent with the current architecture.
- Do not commit, push, pull, merge, rebase, or rewrite history unless the user explicitly requests that Git operation.

## Development commands

- `npm run dev:local`: run the local static server and product-capture API.
- `npm run dev`: run the Vercel development environment.
- `npm start`: run the static frontend only.
- `npm run install:browser`: install the Chromium browser defined by the project for Playwright.
- `npm run test:order`: run the existing order and price parser tests.
- `npm run build:portable`: build the Windows portable distribution. Run only when requested because it downloads and creates large artifacts.

## Validation

- Run `npm run test:order` after relevant changes.
- Syntax-check changed JavaScript and MJS files.
- For product-capture changes, verify supported and unsupported URLs, timeout handling, partial image-slot failures, and successful downloads.
- For UI changes, regression-check the order extractor, product extractor, and price manager flows affected by the change.
- Do not claim a build or browser-capture flow passed unless it was actually run successfully.
