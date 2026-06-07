SiteTrust Checker Pro V4 - Simple Setup
======================================

এই version আগের Pages / functions folder না।
এটা Cloudflare Worker + Static Assets version.
আপনার screenshot-এ যে Worker project দেখা যাচ্ছে, সেটার জন্য এই version সঠিক।

ফাইল structure:
- wrangler.jsonc
- package.json
- deploy-windows.bat
- src/worker.js
- public/index.html
- public/about/index.html
- public/privacy/index.html
- public/terms/index.html
- public/contact/index.html

কাজ করার নিয়ম:
1) ZIP extract করুন।
2) Computer-এ Node.js LTS install করুন।
3) Extract করা folder open করুন।
4) deploy-windows.bat double click করুন।
5) Browser খুললে Cloudflare login/allow করুন।
6) CMD শেষ হলে যে workers.dev link দেখাবে সেটা open করুন।
7) /api/health test করুন। Example:
   https://YOUR-WORKER.safeurlchecks.workers.dev/api/health
8) যদি ok true আসে, analysis কাজ করবে।
9) Main page এ https://example.com দিয়ে test করুন।

GitHub method:
- এই package-এর সব file GitHub repo root-এ upload করুন।
- Cloudflare Workers & Pages project-এর Build settings এ deploy command থাকবে: npx wrangler deploy
- Root directory: /
- তারপর New deployment / Retry deployment দিন।

ভুল করবেন না:
- শুধুমাত্র public/index.html upload করলে analysis হবে না।
- src/worker.js এবং wrangler.jsonc অবশ্যই থাকতে হবে।
- আগের functions/api/analyze.js দরকার নেই।

কেন সব website এ data আসবে না:
- কিছু website scanner block করে।
- কিছু website JavaScript দিয়ে content load করে।
- email/phone public HTML এ না থাকলে tool পাবে না।
- real backlink count HTML থেকে পাওয়া যায় না।
