# SiteTrust Checker Pro V3 Fixed

Cloudflare Pages-ready website intelligence checker.

## What is fixed in this version

- The main design CSS is embedded directly inside `index.html`, so the page will not break into plain unstyled HTML if CSS paths fail.
- The main JavaScript is embedded directly inside `index.html`, so the form, report rendering and fallback report work even when external JS paths fail.
- All visible UI text is English.
- A translation panel is included for translating the English report.
- The analyzer now returns a limited report instead of failing when a target site blocks fetch requests.
- The report shows output for valid public HTTP/HTTPS URLs even if live scanning is limited.

## Cloudflare Pages deployment

Recommended deployment: GitHub-connected Cloudflare Pages.

Settings:

- Framework preset: None
- Build command: leave empty
- Build output directory: /

Upload all files and folders from this project root, including the `functions` folder.

## Important limitation

The tool can show visible page links and outgoing external links. Real inbound backlinks require a backlink data source such as Ahrefs, Semrush, Moz, Majestic, or verified Google Search Console data.
