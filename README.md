# SiteTrust Checker Pro V4

Cloudflare Worker + Static Assets website intelligence scanner.

## Routes

- `/` — web app
- `/api/health` — backend health check
- `/api/analyze` — POST `{ "url": "https://example.com" }`

## Deploy

```bash
npm install
npx wrangler login
npx wrangler deploy
```

This package is designed for Cloudflare Workers Static Assets, not Cloudflare Pages Functions.
