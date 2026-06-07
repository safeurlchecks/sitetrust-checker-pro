const MAX_HTML_BYTES = 950000;
const MAX_LINKS_RETURNED = 120;
const MAX_ITEMS_RETURNED = 80;
const FETCH_TIMEOUT_MS = 15000;
const QUICK_TIMEOUT_MS = 5000;

const SOCIAL_DOMAINS = ['facebook.com','fb.com','instagram.com','linkedin.com','twitter.com','x.com','youtube.com','youtu.be','tiktok.com','pinterest.com','threads.net','wa.me','whatsapp.com','telegram.me','t.me','discord.gg','discord.com','reddit.com','medium.com','github.com','behance.net','dribbble.com','snapchat.com'];
const IMPORTANT_PATH_WORDS = ['contact','about','support','help','faq','pricing','service','services','blog','news','career','careers','login','sign-in','signin','signup','register','privacy','terms','cookie','refund','shipping','sitemap','dashboard','account','download','resources','portfolio','case-study','booking','appointment'];
const LEGAL_WORDS = ['privacy','terms','cookie','refund','shipping','disclaimer','legal','gdpr','policy','return','cancellation','accessibility'];
const RESOURCE_EXTENSIONS = ['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.csv','.zip','.rar','.7z','.jpg','.jpeg','.png','.webp','.gif','.svg','.mp4','.mp3','.xml'];
const TRACKING_HINTS = [
  ['google-analytics.com','Google Analytics'], ['googletagmanager.com','Google Tag Manager'], ['gtag/js','Google gtag'], ['analytics.js','Google Analytics'],
  ['facebook.net','Meta Pixel'], ['connect.facebook.net','Meta Pixel'], ['hotjar.com','Hotjar'], ['clarity.ms','Microsoft Clarity'], ['doubleclick.net','Google Ads / DoubleClick'],
  ['adsbygoogle.js','Google AdSense'], ['googlesyndication.com','Google Ads'], ['segment.com','Segment'], ['mixpanel.com','Mixpanel'], ['hubspot.com','HubSpot'],
  ['intercom.io','Intercom'], ['tawk.to','Tawk.to Live Chat'], ['crisp.chat','Crisp Chat'], ['zendesk.com','Zendesk'], ['mailchimp.com','Mailchimp'], ['klaviyo.com','Klaviyo'],
  ['matomo','Matomo'], ['plausible.io','Plausible Analytics'], ['yandex.ru/metrika','Yandex Metrica']
];
const AD_HINTS = [['adsbygoogle','Google AdSense'], ['doubleclick.net','Google Ads'], ['googlesyndication.com','Google Ads'], ['taboola','Taboola'], ['outbrain','Outbrain'], ['adservice','Ad service'], ['gpt.js','Google Publisher Tags']];
const TECH_HINTS = [
  ['wp-content','WordPress'], ['wp-includes','WordPress'], ['woocommerce','WooCommerce'], ['cdn.shopify.com','Shopify'], ['myshopify.com','Shopify'], ['wixstatic.com','Wix'],
  ['squarespace.com','Squarespace'], ['webflow','Webflow'], ['_next/static','Next.js'], ['__NEXT_DATA__','Next.js'], ['nuxt','Nuxt'], ['react','React'], ['vue','Vue'], ['angular','Angular'],
  ['bootstrap','Bootstrap'], ['tailwind','Tailwind CSS'], ['laravel','Laravel'], ['cdn.jsdelivr.net','jsDelivr CDN'], ['cdnjs.cloudflare.com','Cloudflare cdnjs'], ['cloudflare','Cloudflare'],
  ['elementor','Elementor'], ['yoast','Yoast SEO'], ['rank-math','Rank Math SEO'], ['stripe.com','Stripe'], ['paypal.com','PayPal'], ['razorpay','Razorpay'], ['firebase','Firebase'],
  ['vercel','Vercel'], ['netlify','Netlify'], ['pages.dev','Cloudflare Pages']
];
const TYPE_RULES = [
  ['E-commerce / Online Shop', ['cart','checkout','add to cart','product','shopify','woocommerce','price','sku','order now','buy now','wishlist','payment']],
  ['News / Blog / Magazine', ['article','post','blog','news','editorial','author','published','category','tag','comment']],
  ['Education / Course / Institute', ['course','admission','university','college','school','ielts','student','tuition','curriculum','program']],
  ['Travel / Visa / Tourism', ['visa','umrah','hajj','travel','tour','ticket','hotel','passport','destination','booking','holiday']],
  ['Service Business / Agency', ['service','book now','appointment','consultation','quote','portfolio','client','case study','proposal']],
  ['SaaS / Software Tool', ['dashboard','api','pricing','login','signup','software','platform','app','integration','workspace']],
  ['Portfolio / Personal Brand', ['portfolio','resume','cv','personal','hire me','freelance','creator']],
  ['Government / Public Information', ['.gov','government','ministry','public service','citizen','official']],
  ['Nonprofit / Organization', ['donate','volunteer','ngo','non-profit','nonprofit','charity','fundraising']],
  ['Community / Forum', ['forum','community','thread','member','discussion','reply','moderator']]
];
const STOPWORDS = new Set('the and for are but not you your with from this that have has was were will can all any our their its into about more also when what who how why where there here home page website click read learn using use services service contact privacy terms a an to of in on at by as or is be it we us i they he she them his her if then than so do does done over under new get now just site www com org net html https http'.split(' '));

export async function onRequestOptions() { return json({ ok: true }, 200); }
export async function onRequestGet() { return json({ ok: true, message: 'SiteTrust analyze API is running. Send POST JSON: {"url":"https://example.com"}' }, 200); }

export async function onRequestPost({ request }) {
  const started = Date.now();
  let inputUrl = '';
  let normalizedUrl = '';
  try {
    const body = await request.json().catch(() => ({}));
    inputUrl = String(body.url || '').trim();
    if (!inputUrl) return json({ ok: false, error: 'URL is required.' }, 400);

    normalizedUrl = normalizeUrl(inputUrl);
    const parsed = safeUrl(normalizedUrl);
    if (!parsed) return json({ ok: false, error: 'Only valid HTTP/HTTPS URLs are supported.' }, 400);
    const blocked = blockedUrlReason(parsed);
    if (blocked) return json({ ok: false, error: blocked }, 400);

    try {
      return await buildFullReport({ inputUrl, normalizedUrl, parsed, started });
    } catch (scanError) {
      return json(buildLimitedReport({ inputUrl, normalizedUrl, parsed, started, reason: scanError.message || 'The target website could not be fetched.' }), 200);
    }
  } catch (error) {
    const parsed = safeUrl(normalizedUrl || inputUrl);
    if (parsed) return json(buildLimitedReport({ inputUrl, normalizedUrl: parsed.href, parsed, started, reason: error.message || 'Report generated in limited mode.' }), 200);
    return json({ ok: false, error: error.message || 'Report generation failed.' }, 400);
  }
}

async function buildFullReport({ inputUrl, normalizedUrl, parsed, started }) {
  const fetched = await fetchWithRedirects(parsed.href);
  const finalUrl = fetched.finalUrl || parsed.href;
  const finalParsed = safeUrl(finalUrl) || parsed;
  const headers = headersToObject(fetched.response.headers);
  const contentType = headers['content-type'] || '';
  const rawText = await readLimitedText(fetched.response, MAX_HTML_BYTES);
  const html = looksLikeHtml(contentType, rawText) ? rawText : '';
  const visibleText = html ? stripHtml(html) : rawText.slice(0, 20000);
  const lowerHtml = html.toLowerCase();
  const lowerText = visibleText.toLowerCase();

  const allLinks = uniqueByHref(extractLinks(html, finalUrl));
  const internalLinks = allLinks.filter(l => sameHost(l.href, finalParsed.hostname));
  const externalLinks = allLinks.filter(l => !sameHost(l.href, finalParsed.hostname));
  const socialLinks = externalLinks.filter(link => SOCIAL_DOMAINS.some(d => link.hostname === d || link.hostname.endsWith('.' + d)));
  const importantLinks = allLinks.filter(link => IMPORTANT_PATH_WORDS.some(w => (link.href + ' ' + link.text).toLowerCase().includes(w)));
  const legalLinks = allLinks.filter(link => LEGAL_WORDS.some(w => (link.href + ' ' + link.text).toLowerCase().includes(w)));
  const feedLinks = findFeedLinks(html, finalUrl);
  const resourceLinks = allLinks.filter(link => RESOURCE_EXTENSIONS.some(ext => link.pathname.toLowerCase().includes(ext)));

  const emails = unique(extractEmails(html + ' ' + visibleText)).slice(0, MAX_ITEMS_RETURNED);
  const phones = unique(extractPhones(visibleText)).slice(0, MAX_ITEMS_RETURNED);
  const schema = extractJsonLd(html);
  const schemaContacts = extractSchemaContacts(schema);
  const names = unique([...extractNames(html, schema), ...schemaContacts.names]).slice(0, MAX_ITEMS_RETURNED);
  const addresses = unique([...extractAddresses(visibleText), ...schemaContacts.addresses]).slice(0, MAX_ITEMS_RETURNED);
  const forms = analyzeForms(html, finalUrl);
  const seo = analyzeSeo(html, visibleText, finalUrl);
  const technology = analyzeTechnology(html, headers);
  const privacy = analyzePrivacy(html, allLinks, headers);
  const permissions = analyzePermissionHints(headers, html);
  const cookies = analyzeCookies(headers['set-cookie'] || '');
  const security = analyzeSecurity({ parsed: finalParsed, headers, html, forms, cookies, permissions, fetched, contentType });
  const classification = classifyWebsite({ finalParsed, lowerHtml, lowerText, technology, seo, allLinks });
  const robots = await quickFetchText(finalParsed.origin + '/robots.txt');
  const sitemap = await quickFetchText(finalParsed.origin + '/sitemap.xml');
  const content = analyzeContent(visibleText, html, schema);
  const capabilities = inferCapabilities({ classification, allLinks, forms, emails, phones, resourceLinks, feedLinks, socialLinks, lowerText, technology });
  const advantages = buildAdvantages({ security, seo, privacy, forms, emails, phones, feedLinks, socialLinks, allLinks, technology, robots, sitemap, content, legalLinks, capabilities });
  const disadvantages = buildDisadvantages({ security, seo, privacy, forms, emails, phones, feedLinks, socialLinks, allLinks, technology, robots, sitemap, content, legalLinks });
  const recommendations = buildRecommendations({ security, seo, privacy, forms, emails, phones, feedLinks, socialLinks, robots, sitemap, content, legalLinks, technology, externalLinks, classification });
  const featureChecks = buildFeatureChecks({ fetched, finalParsed, headers, html, visibleText, allLinks, internalLinks, externalLinks, socialLinks, importantLinks, legalLinks, feedLinks, resourceLinks, emails, phones, names, addresses, forms, seo, technology, privacy, permissions, cookies, security, robots, sitemap, content, classification, capabilities });

  return json({
    ok: true,
    partial: false,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    inputUrl,
    normalizedUrl,
    finalUrl,
    fetch: {
      ok: fetched.response.ok,
      status: fetched.response.status,
      statusText: fetched.response.statusText,
      contentType,
      sizeBytes: byteLength(rawText),
      readableHtml: !!html,
      redirected: fetched.redirects.length > 0,
      redirectCount: fetched.redirects.length,
      redirects: fetched.redirects,
      selectedHeaders: selectHeaders(headers)
    },
    classification,
    capabilities,
    counts: {
      totalLinks: allLinks.length,
      uniqueLinks: allLinks.length,
      internalLinks: internalLinks.length,
      externalOutgoingLinks: externalLinks.length,
      emails: emails.length,
      phones: phones.length,
      names: names.length,
      addresses: addresses.length,
      socialLinks: socialLinks.length,
      importantLinks: importantLinks.length,
      legalLinks: legalLinks.length,
      feedLinks: feedLinks.length,
      resourceLinks: resourceLinks.length,
      forms: forms.count,
      images: seo.imageCount,
      scripts: countRegex(html, /<script\b/gi),
      stylesheets: countRegex(html, /<link[^>]+rel=["']?stylesheet/gi)
    },
    links: {
      internal: internalLinks.slice(0, MAX_LINKS_RETURNED),
      externalOutgoing: externalLinks.slice(0, MAX_LINKS_RETURNED),
      social: socialLinks.slice(0, MAX_ITEMS_RETURNED),
      important: importantLinks.slice(0, MAX_ITEMS_RETURNED),
      legal: legalLinks.slice(0, MAX_ITEMS_RETURNED),
      feeds: feedLinks.slice(0, MAX_ITEMS_RETURNED),
      resources: resourceLinks.slice(0, MAX_ITEMS_RETURNED),
      note: 'This report shows links visible on the scanned page. Real inbound backlink data requires a backlink database or verified Search Console access.'
    },
    contacts: { emails, phones, names, addresses, forms },
    seo,
    security,
    privacy,
    permissions,
    cookies,
    technology,
    content,
    indexing: { robots, sitemap },
    advantages,
    disadvantages,
    recommendations,
    featureChecks
  }, 200);
}

function buildLimitedReport({ inputUrl, normalizedUrl, parsed, started, reason }) {
  const url = parsed || safeUrl(normalizedUrl) || { href: normalizedUrl || inputUrl, hostname: '', protocol: '' };
  const https = url.protocol === 'https:';
  const checks = [
    { category: 'URL', name: 'Valid URL format', status: 'pass', detail: url.href || normalizedUrl },
    { category: 'URL', name: 'HTTP/HTTPS protocol', status: ['http:', 'https:'].includes(url.protocol) ? 'pass' : 'fail', detail: url.protocol || 'unknown' },
    { category: 'Security', name: 'HTTPS URL', status: https ? 'pass' : 'warn', detail: https ? 'The URL uses HTTPS.' : 'The URL does not use HTTPS.' },
    { category: 'Fetch', name: 'Live HTML scan', status: 'warn', detail: reason || 'The public page could not be fetched by the scanner.' },
    { category: 'Privacy', name: 'Private/local URL blocked', status: 'pass', detail: 'Private network targets are blocked by this tool.' }
  ];
  return {
    ok: true,
    partial: true,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    inputUrl,
    normalizedUrl: url.href || normalizedUrl,
    finalUrl: url.href || normalizedUrl,
    fetch: { ok: false, status: null, statusText: 'Limited report', contentType: '', sizeBytes: 0, readableHtml: false, redirected: false, redirectCount: 0, redirects: [], selectedHeaders: {}, failureReason: reason },
    classification: { type: guessTypeFromHost(url.hostname), confidence: 'Low', purpose: 'The scanner could not read the public HTML. The report is based on the submitted URL only.' },
    capabilities: ['Open the public website in a browser', 'Manually check pages, contact details, legal pages and trust signals'],
    counts: { totalLinks: 0, uniqueLinks: 0, internalLinks: 0, externalOutgoingLinks: 0, emails: 0, phones: 0, names: 0, addresses: 0, socialLinks: 0, importantLinks: 0, legalLinks: 0, feedLinks: 0, resourceLinks: 0, forms: 0, images: 0, scripts: 0, stylesheets: 0 },
    links: { internal: [], externalOutgoing: [], social: [], important: [], legal: [], feeds: [], resources: [], note: 'Live links were not available because the target page could not be fetched.' },
    contacts: { emails: [], phones: [], names: [], addresses: [], forms: { count: 0, hasPassword: false, hasFileUpload: false, hasSearch: false, hasEmailInput: false, hasTextarea: false, forms: [] } },
    seo: { title: '', description: '', canonical: '', lang: '', viewport: '', h1: [], h2: [], h3: [], h1Count: 0, h2Count: 0, h3Count: 0, imageCount: 0, imagesMissingAlt: 0, issues: ['Live HTML was not available for SEO analysis.'] },
    security: { score: https ? 55 : 35, decision: https ? 'CAUTION' : 'NO', riskLevel: https ? 'Medium' : 'High', issues: [reason || 'The website blocked or failed the scanner fetch.', https ? 'Security headers could not be verified.' : 'The URL does not use HTTPS.'], headers: {}, forms: {}, cookies: {}, redirectChain: [] },
    privacy: { privacyPolicyLink: false, termsLink: false, cookiePolicyLink: false, trackers: [], adTech: [], issues: ['Privacy and tracker signals could not be verified from page HTML.'] },
    permissions: { geolocation: false, camera: false, microphone: false, notifications: false, clipboard: false, fullscreen: false },
    cookies: { setCookieHeader: false, secureFlag: null, httpOnlyFlag: null, sameSiteFlag: null },
    technology: { detected: [], cms: [], frameworks: [], analytics: [], payments: [], cdn: [], server: '' },
    content: { wordCount: 0, textLength: 0, sentenceCount: 0, averageSentenceWords: 0, topKeywords: [], schemaTypes: [], jsonLdCount: 0, readabilityHint: 'Unavailable' },
    indexing: { robots: { ok: false, status: null, url: safeOrigin(url) + '/robots.txt', preview: '' }, sitemap: { ok: false, status: null, url: safeOrigin(url) + '/sitemap.xml', preview: '' } },
    advantages: https ? ['The submitted URL uses HTTPS.'] : ['The URL format was accepted.'],
    disadvantages: [reason || 'The scanner could not read the target website.', 'Live links, contact details, SEO tags and headers could not be verified.'],
    recommendations: ['Try the final public homepage URL directly, including https://.', 'Deploy this project with the /functions folder included on Cloudflare Pages for full live reports.', 'If a site blocks scanners, manually verify SEO, legal pages, contact details and security headers.'],
    featureChecks: checks
  };
}

function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}
function safeUrl(raw) { try { const u = new URL(raw); if (!['http:', 'https:'].includes(u.protocol)) return null; return u; } catch { return null; } }
function safeOrigin(u) { try { return new URL(u.href || u).origin; } catch { return ''; } }
function blockedUrlReason(u) {
  const host = u.hostname.toLowerCase();
  const port = u.port;
  if (port && !['80','443'].includes(port)) return 'Only standard public HTTP/HTTPS ports are supported.';
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test')) return 'Private, local or internal hostnames are blocked for safety.';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const p = host.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0 || p[0] >= 224) return 'Private or reserved IP addresses are blocked.';
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return 'Private IP addresses are blocked.';
    if (p[0] === 192 && p[1] === 168) return 'Private IP addresses are blocked.';
    if (p[0] === 169 && p[1] === 254) return 'Link-local IP addresses are blocked.';
  }
  return '';
}
async function fetchWithRedirects(url) {
  let current = url;
  const redirects = [];
  for (let i = 0; i < 6; i++) {
    const response = await fetchWithTimeout(current, FETCH_TIMEOUT_MS, { redirect: 'manual' });
    const status = response.status;
    if ([301,302,303,307,308].includes(status)) {
      const loc = response.headers.get('location');
      if (!loc) return { response, finalUrl: current, redirects };
      const next = new URL(loc, current).href;
      const parsed = safeUrl(next);
      if (!parsed || blockedUrlReason(parsed)) return { response, finalUrl: current, redirects };
      redirects.push({ from: current, to: next, status });
      current = next;
      continue;
    }
    return { response, finalUrl: current, redirects };
  }
  const response = await fetchWithTimeout(current, FETCH_TIMEOUT_MS, { redirect: 'follow' });
  return { response, finalUrl: response.url || current, redirects };
}
async function fetchWithTimeout(url, timeoutMs, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        'user-agent': 'Mozilla/5.0 SiteTrustCheckerPro/3.0 (+defensive public website audit)'
      }
    });
  } finally { clearTimeout(timeout); }
}
async function quickFetchText(url) {
  try {
    const parsed = safeUrl(url);
    if (!parsed || blockedUrlReason(parsed)) return { ok: false, status: null, url, preview: '' };
    const res = await fetchWithTimeout(url, QUICK_TIMEOUT_MS, { redirect: 'follow' });
    const text = await readLimitedText(res, 16000);
    return { ok: res.ok, status: res.status, url: res.url || url, preview: text.slice(0, 1200) };
  } catch (e) { return { ok: false, status: null, url, preview: '', error: e.message || 'Fetch failed' }; }
}
function headersToObject(headers) { const o = {}; headers.forEach((v, k) => { o[k.toLowerCase()] = v; }); return o; }
function selectHeaders(h) { const keys = ['server','content-type','cache-control','strict-transport-security','content-security-policy','x-frame-options','x-content-type-options','referrer-policy','permissions-policy','cross-origin-opener-policy','cross-origin-resource-policy','set-cookie']; const out = {}; keys.forEach(k => { if (h[k]) out[k] = k === 'set-cookie' ? '[present]' : h[k]; }); return out; }
async function readLimitedText(response, maxBytes) { const text = await response.text(); return text.length > maxBytes ? text.slice(0, maxBytes) : text; }
function byteLength(str) { return new TextEncoder().encode(String(str || '')).length; }
function looksLikeHtml(contentType, text) { return /html|xml|text\/plain|application\/xhtml/i.test(contentType || '') || /<html|<head|<body|<a\s|<!doctype/i.test(text || ''); }
function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
function decodeHtml(s) { return String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim(); }
function stripTags(s) { return decodeHtml(String(s || '').replace(/<[^>]+>/g, ' ')); }
function getAttr(tag, attr) { const re = new RegExp(`${attr}\\s*=\\s*(["'])(.*?)\\1`, 'i'); const m = String(tag || '').match(re); if (m) return decodeHtml(m[2]); const re2 = new RegExp(`${attr}\\s*=\\s*([^\\s>]+)`, 'i'); const m2 = String(tag || '').match(re2); return m2 ? decodeHtml(m2[1]) : ''; }
function metaContent(html, nameOrProp) { const re = new RegExp(`<meta[^>]+(?:name|property)=["']${escapeRegExp(nameOrProp)}["'][^>]*>`, 'i'); const tag = String(html || '').match(re)?.[0] || ''; return tag ? getAttr(tag, 'content') : ''; }
function firstMatch(html, re) { return String(html || '').match(re)?.[1] || ''; }
function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const hrefRaw = decodeHtml(m[2] || '').trim();
    if (!hrefRaw || /^javascript:|^mailto:|^tel:|^#/.test(hrefRaw.toLowerCase())) continue;
    try {
      const u = new URL(hrefRaw, baseUrl);
      if (!['http:', 'https:'].includes(u.protocol)) continue;
      links.push({ href: u.href, text: stripTags(m[3]).slice(0, 120), hostname: u.hostname, pathname: u.pathname });
    } catch {}
  }
  return links;
}
function uniqueByHref(arr) { const map = new Map(); for (const item of arr) if (!map.has(item.href)) map.set(item.href, item); return [...map.values()]; }
function unique(arr) { return [...new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))]; }
function sameHost(href, hostname) { try { const a = new URL(href).hostname.replace(/^www\./,''); const b = String(hostname || '').replace(/^www\./,''); return a === b; } catch { return false; } }
function findFeedLinks(html, baseUrl) {
  const out = [];
  const linkRe = /<link\b[^>]+>/gi;
  let m;
  while ((m = linkRe.exec(String(html || '')))) {
    const tag = m[0];
    const rel = getAttr(tag, 'rel').toLowerCase();
    const type = getAttr(tag, 'type').toLowerCase();
    const href = getAttr(tag, 'href');
    if (href && (rel.includes('alternate') || type.includes('rss') || type.includes('atom') || href.includes('/feed'))) {
      try { out.push({ href: new URL(href, baseUrl).href, text: getAttr(tag, 'title') || type || 'Feed', hostname: new URL(href, baseUrl).hostname, pathname: new URL(href, baseUrl).pathname }); } catch {}
    }
  }
  return uniqueByHref(out);
}
function extractEmails(text) { return (String(text || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).filter(e => !/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i.test(e)); }
function extractPhones(text) { return (String(text || '').match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || []).map(p => p.replace(/\s+/g, ' ').trim()).filter(p => (p.match(/\d/g) || []).length >= 8 && (p.match(/\d/g) || []).length <= 16); }
function extractJsonLd(html) {
  const blocks = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try { blocks.push(JSON.parse(m[1].trim())); } catch {}
  }
  return blocks;
}
function flattenSchema(schema) { const out = []; const walk = (x) => { if (!x) return; if (Array.isArray(x)) x.forEach(walk); else if (typeof x === 'object') { out.push(x); Object.values(x).forEach(v => { if (v && typeof v === 'object') walk(v); }); } }; walk(schema); return out; }
function extractSchemaContacts(schema) {
  const names = [], addresses = [];
  for (const item of flattenSchema(schema)) {
    if (item.name && typeof item.name === 'string') names.push(item.name);
    if (item.legalName && typeof item.legalName === 'string') names.push(item.legalName);
    if (item.address) addresses.push(typeof item.address === 'string' ? item.address : [item.address.streetAddress, item.address.addressLocality, item.address.addressRegion, item.address.postalCode, item.address.addressCountry].filter(Boolean).join(', '));
  }
  return { names: unique(names), addresses: unique(addresses) };
}
function extractNames(html, schema) {
  const names = [];
  const siteName = metaContent(html, 'og:site_name'); if (siteName) names.push(siteName);
  const author = metaContent(html, 'author'); if (author) names.push(author);
  const appName = metaContent(html, 'application-name'); if (appName) names.push(appName);
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i); if (title) names.push(stripTags(title).split(/[|–—-]/)[0].trim());
  for (const item of flattenSchema(schema)) if (item['@type'] && ['Organization','LocalBusiness','Person','WebSite'].includes(String(item['@type'])) && item.name) names.push(item.name);
  return names.filter(n => n && n.length > 1 && n.length < 100);
}
function extractAddresses(text) {
  const lines = String(text || '').split(/(?<=[.!?])\s+|\n/).map(s => s.trim()).filter(Boolean);
  return lines.filter(line => /\b(road|rd\.?|street|st\.?|avenue|ave\.?|suite|floor|block|sector|city|zip|postal|dhaka|chittagong|chattogram|london|usa|uk|bangladesh|india|address)\b/i.test(line) && line.length < 220).slice(0, 30);
}
function analyzeForms(html, baseUrl) {
  const forms = [];
  const re = /<form\b[^>]*>([\s\S]*?)<\/form>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const tag = m[0].slice(0, m[0].indexOf('>') + 1);
    const body = m[1] || '';
    const method = (getAttr(tag, 'method') || 'GET').toUpperCase();
    const actionRaw = getAttr(tag, 'action') || '';
    let action = '';
    try { action = actionRaw ? new URL(actionRaw, baseUrl).href : baseUrl; } catch { action = actionRaw; }
    const lower = (tag + body).toLowerCase();
    forms.push({ method, action, hasPassword: /type=["']?password/.test(lower), hasFileUpload: /type=["']?file/.test(lower), hasSearch: /type=["']?search|name=["']?s["']?|search/.test(lower), hasEmailInput: /type=["']?email/.test(lower), hasTextarea: /<textarea\b/.test(lower) });
  }
  return { count: forms.length, hasPassword: forms.some(f => f.hasPassword), hasFileUpload: forms.some(f => f.hasFileUpload), hasSearch: forms.some(f => f.hasSearch), hasEmailInput: forms.some(f => f.hasEmailInput), hasTextarea: forms.some(f => f.hasTextarea), forms: forms.slice(0, 20) };
}
function analyzeSeo(html, visibleText, finalUrl) {
  const title = stripTags(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = metaContent(html, 'description');
  const canonicalTag = String(html || '').match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0] || '';
  let canonical = getAttr(canonicalTag, 'href');
  try { if (canonical) canonical = new URL(canonical, finalUrl).href; } catch {}
  const lang = String(html || '').match(/<html[^>]+lang=["']?([^"'\s>]+)/i)?.[1] || '';
  const viewport = metaContent(html, 'viewport');
  const robotsMeta = metaContent(html, 'robots');
  const h1 = extractHeadings(html, 'h1');
  const h2 = extractHeadings(html, 'h2');
  const h3 = extractHeadings(html, 'h3');
  const imgTags = String(html || '').match(/<img\b[^>]*>/gi) || [];
  const imagesMissingAlt = imgTags.filter(tag => !/\salt\s*=/.test(tag) || getAttr(tag, 'alt').trim() === '').length;
  const hasFavicon = /rel=["'][^"']*(?:icon|shortcut icon|apple-touch-icon)/i.test(html || '');
  const socialMeta = { openGraphTitle: !!metaContent(html, 'og:title'), openGraphDescription: !!metaContent(html, 'og:description'), openGraphImage: !!metaContent(html, 'og:image'), twitterCard: !!metaContent(html, 'twitter:card') };
  const issues = [];
  if (!title) issues.push('Missing title tag.'); else if (title.length < 25 || title.length > 70) issues.push('Title length is outside the common 25-70 character range.');
  if (!description) issues.push('Missing meta description.'); else if (description.length < 70 || description.length > 170) issues.push('Meta description length is outside the common 70-170 character range.');
  if (!canonical) issues.push('Missing canonical URL.');
  if (!viewport) issues.push('Missing viewport meta tag.');
  if (h1.length !== 1) issues.push(`Expected one H1 tag, found ${h1.length}.`);
  if (!h2.length) issues.push('No H2 headings found.');
  if (imagesMissingAlt) issues.push(`${imagesMissingAlt} image(s) are missing alt text.`);
  if (!socialMeta.openGraphTitle || !socialMeta.openGraphImage) issues.push('Open Graph title/image tags are incomplete.');
  return { title, titleLength: title.length, description, descriptionLength: description.length, canonical, lang, viewport, robotsMeta, h1, h2, h3, h1Count: h1.length, h2Count: h2.length, h3Count: h3.length, imageCount: imgTags.length, imagesMissingAlt, socialMeta, hasFavicon, issues };
}
function extractHeadings(html, tag) { const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'); const out = []; let m; while ((m = re.exec(String(html || '')))) out.push(stripTags(m[1]).slice(0, 160)); return out.slice(0, 30); }
function analyzeTechnology(html, headers) {
  const hay = `${html}\n${JSON.stringify(headers)}`.toLowerCase();
  const detected = unique(TECH_HINTS.filter(([needle]) => hay.includes(needle.toLowerCase())).map(([, name]) => name));
  const analytics = unique(TRACKING_HINTS.filter(([needle]) => hay.includes(needle.toLowerCase())).map(([, name]) => name));
  const payments = detected.filter(x => /stripe|paypal|razorpay/i.test(x));
  const cdn = detected.filter(x => /cloudflare|cdn|jsdelivr|cdnjs|vercel|netlify/i.test(x));
  const cms = detected.filter(x => /wordpress|shopify|wix|squarespace|webflow|woocommerce/i.test(x));
  const frameworks = detected.filter(x => /react|vue|angular|next|nuxt|bootstrap|tailwind|laravel|firebase/i.test(x));
  return { detected, cms, frameworks, analytics, payments, cdn, server: headers.server || '', poweredBy: headers['x-powered-by'] || '' };
}
function analyzePrivacy(html, allLinks, headers) {
  const text = String(html || '').toLowerCase();
  const privacyPolicyLink = allLinks.some(l => /privacy/.test((l.href + l.text).toLowerCase()));
  const termsLink = allLinks.some(l => /terms|conditions/.test((l.href + l.text).toLowerCase()));
  const cookiePolicyLink = allLinks.some(l => /cookie/.test((l.href + l.text).toLowerCase()));
  const trackers = unique(TRACKING_HINTS.filter(([needle]) => text.includes(needle.toLowerCase())).map(([, name]) => name));
  const adTech = unique(AD_HINTS.filter(([needle]) => text.includes(needle.toLowerCase())).map(([, name]) => name));
  const issues = [];
  if (!privacyPolicyLink) issues.push('No visible privacy policy link was found.');
  if (!termsLink) issues.push('No visible terms/conditions link was found.');
  if (trackers.length && !privacyPolicyLink) issues.push('Tracking signals are present but no privacy policy link was visible on the scanned page.');
  if (adTech.length && !cookiePolicyLink) issues.push('Ad technology signals are present but no cookie policy link was visible on the scanned page.');
  return { privacyPolicyLink, termsLink, cookiePolicyLink, trackers, adTech, issues, referrerPolicy: headers['referrer-policy'] || '' };
}
function analyzePermissionHints(headers, html) {
  const pp = String(headers['permissions-policy'] || '').toLowerCase();
  const hay = String(html || '').toLowerCase();
  return { geolocation: /geolocation|getcurrentposition/.test(pp + hay), camera: /camera|getusermedia/.test(pp + hay), microphone: /microphone|getusermedia/.test(pp + hay), notifications: /notification|pushmanager|serviceworker/.test(hay), clipboard: /clipboard|writeText|readText/i.test(html || ''), fullscreen: /fullscreen/.test(hay) };
}
function analyzeCookies(setCookie) {
  const s = String(setCookie || '');
  return { setCookieHeader: !!s, secureFlag: s ? /;\s*secure/i.test(s) : null, httpOnlyFlag: s ? /;\s*httponly/i.test(s) : null, sameSiteFlag: s ? /;\s*samesite=/i.test(s) : null };
}
function analyzeSecurity({ parsed, headers, html, forms, cookies, fetched }) {
  const issues = [];
  const check = (key, good, detail) => ({ status: good ? 'pass' : 'warn', detail: detail || (good ? 'Present' : 'Missing') });
  const securityHeaders = {
    'Strict-Transport-Security': check('strict-transport-security', !!headers['strict-transport-security'], headers['strict-transport-security'] || 'Missing'),
    'Content-Security-Policy': check('content-security-policy', !!headers['content-security-policy'], headers['content-security-policy'] ? 'Present' : 'Missing'),
    'X-Frame-Options': check('x-frame-options', !!headers['x-frame-options'], headers['x-frame-options'] || 'Missing'),
    'X-Content-Type-Options': check('x-content-type-options', /nosniff/i.test(headers['x-content-type-options'] || ''), headers['x-content-type-options'] || 'Missing'),
    'Referrer-Policy': check('referrer-policy', !!headers['referrer-policy'], headers['referrer-policy'] || 'Missing'),
    'Permissions-Policy': check('permissions-policy', !!headers['permissions-policy'], headers['permissions-policy'] || 'Missing')
  };
  let score = 100;
  if (parsed.protocol !== 'https:') { score -= 30; issues.push('The final URL does not use HTTPS.'); }
  if (!fetched.response.ok) { score -= 10; issues.push(`The server returned HTTP ${fetched.response.status}.`); }
  for (const [name, val] of Object.entries(securityHeaders)) if (val.status !== 'pass') { score -= name === 'Content-Security-Policy' ? 12 : 7; issues.push(`${name} header is missing or weak.`); }
  const mixedContentReferences = countRegex(html, /(?:src|href)=["']http:\/\//gi);
  if (mixedContentReferences) { score -= 12; issues.push(`${mixedContentReferences} HTTP resource reference(s) were found inside the page.`); }
  if (forms.hasPassword && parsed.protocol !== 'https:') { score -= 25; issues.push('A password form appears on a non-HTTPS URL.'); }
  if (forms.hasFileUpload) { score -= 5; issues.push('File upload form detected. This requires stronger server-side validation.'); }
  if (cookies.setCookieHeader && !cookies.secureFlag) { score -= 5; issues.push('A cookie was set without a visible Secure flag.'); }
  if (cookies.setCookieHeader && !cookies.httpOnlyFlag) { score -= 5; issues.push('A cookie was set without a visible HttpOnly flag.'); }
  if (cookies.setCookieHeader && !cookies.sameSiteFlag) { score -= 3; issues.push('A cookie was set without a visible SameSite flag.'); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const decision = score >= 78 ? 'YES' : score >= 52 ? 'CAUTION' : 'NO';
  const riskLevel = score >= 78 ? 'Low' : score >= 52 ? 'Medium' : 'High';
  return { score, decision, riskLevel, issues: unique(issues), headers: securityHeaders, forms: { mixedContentReferences }, cookies, redirectChain: [] };
}
function classifyWebsite({ finalParsed, lowerHtml, lowerText, technology, seo, allLinks }) {
  const hay = `${finalParsed.hostname} ${seo.title} ${seo.description} ${lowerHtml.slice(0, 60000)} ${technology.detected.join(' ')} ${allLinks.map(l => l.text + ' ' + l.href).join(' ')}`.toLowerCase();
  let best = { type: 'General Website / Information Page', score: 0 };
  for (const [type, words] of TYPE_RULES) {
    const score = words.reduce((n, w) => n + (hay.includes(w.toLowerCase()) ? 1 : 0), 0);
    if (score > best.score) best = { type, score };
  }
  const confidence = best.score >= 5 ? 'High' : best.score >= 2 ? 'Medium' : 'Low';
  const purposeMap = {
    'E-commerce / Online Shop': 'Sell products or services online, collect orders, support product discovery and possibly payment checkout.',
    'News / Blog / Magazine': 'Publish articles, updates, guides, opinions or editorial content for readers.',
    'Education / Course / Institute': 'Provide education information, courses, admission details, student support or learning resources.',
    'Travel / Visa / Tourism': 'Provide travel, visa, tourism, booking, destination or pilgrimage-related information and services.',
    'Service Business / Agency': 'Present services, build trust, generate leads, receive inquiries and convert visitors into clients.',
    'SaaS / Software Tool': 'Provide software, platform features, user login, pricing, dashboard or API-based services.',
    'Portfolio / Personal Brand': 'Show personal work, achievements, portfolio, content or professional profile.',
    'Government / Public Information': 'Provide official information, public services, forms, notices or citizen resources.',
    'Nonprofit / Organization': 'Present organization activities, collect support, publish impact information and invite participation.',
    'Community / Forum': 'Host discussions, member content, comments, threads or community interaction.'
  };
  return { type: best.type, confidence, purpose: purposeMap[best.type] || 'Provide information or services through a public website.' };
}
function guessTypeFromHost(host) { if (!host) return 'Unknown Website'; if (/shop|store|cart/i.test(host)) return 'Possible E-commerce Website'; if (/blog|news/i.test(host)) return 'Possible Blog / News Website'; if (/app|tool|software|saas/i.test(host)) return 'Possible SaaS / Software Tool'; return 'Website / Public URL'; }
function inferCapabilities(ctx) {
  const items = ['View public pages and information'];
  if (ctx.forms.count) items.push('Submit forms or search boxes');
  if (ctx.forms.hasSearch) items.push('Search inside the website');
  if (ctx.forms.hasPassword || ctx.allLinks.some(l => /login|sign-in|signin|account|dashboard/i.test(l.href + ' ' + l.text))) items.push('Log in or access an account area');
  if (ctx.allLinks.some(l => /register|signup|sign-up/i.test(l.href + ' ' + l.text))) items.push('Register or create an account');
  if (ctx.allLinks.some(l => /cart|checkout|buy|order|product|shop/i.test(l.href + ' ' + l.text)) || /e-commerce/i.test(ctx.classification.type)) items.push('Browse products, order items or start checkout');
  if (ctx.emails.length || ctx.phones.length || ctx.forms.hasEmailInput || ctx.forms.hasTextarea) items.push('Contact the website owner or business');
  if (ctx.resourceLinks.length) items.push('Download files or resources');
  if (ctx.feedLinks.length) items.push('Subscribe to RSS/Atom feed updates');
  if (ctx.socialLinks.length) items.push('Visit connected social media profiles');
  if (ctx.allLinks.some(l => /booking|appointment|consultation|quote/i.test(l.href + ' ' + l.text))) items.push('Book, request a quote or schedule an appointment');
  if (ctx.allLinks.some(l => /career|job|apply/i.test(l.href + ' ' + l.text))) items.push('View career pages or application options');
  return unique(items);
}
function analyzeContent(visibleText, html, schema) {
  const text = String(visibleText || '');
  const words = text.toLowerCase().match(/\b[a-z][a-z0-9'-]{2,}\b/g) || [];
  const filtered = words.filter(w => !STOPWORDS.has(w) && w.length > 2);
  const freq = new Map(); filtered.forEach(w => freq.set(w, (freq.get(w) || 0) + 1));
  const topKeywords = [...freq.entries()].sort((a,b) => b[1] - a[1]).slice(0, 20).map(([keyword, count]) => ({ keyword, count }));
  const sentenceCount = (text.match(/[.!?]+\s/g) || []).length;
  const wordCount = words.length;
  const schemaTypes = unique(flattenSchema(schema).map(x => Array.isArray(x['@type']) ? x['@type'].join(', ') : x['@type']).filter(Boolean));
  return { wordCount, textLength: text.length, sentenceCount, averageSentenceWords: sentenceCount ? Math.round(wordCount / sentenceCount) : 0, topKeywords, schemaTypes, jsonLdCount: schema.length, readabilityHint: wordCount < 250 ? 'Thin content signal' : wordCount > 900 ? 'Detailed content signal' : 'Moderate content signal' };
}
function buildAdvantages(ctx) {
  const a = [];
  if (ctx.security.score >= 78) a.push('Visible security score is acceptable.');
  if (ctx.seo.title && ctx.seo.description) a.push('Basic SEO title and meta description are present.');
  if (ctx.privacy.privacyPolicyLink) a.push('A privacy policy link was found.');
  if (ctx.legalLinks.length) a.push('Legal or policy pages are visible.');
  if (ctx.socialLinks.length) a.push('Social profile links are visible.');
  if (ctx.emails.length || ctx.phones.length || ctx.forms.count) a.push('Public contact options were found.');
  if (ctx.robots.ok) a.push('robots.txt is available.');
  if (ctx.sitemap.ok) a.push('sitemap.xml is available.');
  if (ctx.content.wordCount > 350) a.push('The page has enough visible text for basic content understanding.');
  if (ctx.technology.detected.length) a.push('Technology signals were detected.');
  if (ctx.capabilities.length > 2) a.push('The website has multiple visible user actions or navigation paths.');
  if (!a.length) a.push('The website returned a readable public page.');
  return unique(a).slice(0, 14);
}
function buildDisadvantages(ctx) {
  const d = [];
  d.push(...(ctx.security.issues || []).slice(0, 9));
  d.push(...(ctx.seo.issues || []).slice(0, 9));
  if (!ctx.privacy.privacyPolicyLink) d.push('No clear privacy policy link was found on the scanned page.');
  if (!ctx.legalLinks.length) d.push('No strong legal/policy page signal was found.');
  if (!ctx.emails.length && !ctx.phones.length && !ctx.forms.count) d.push('No direct public contact signal was found on the scanned page.');
  if (!ctx.robots.ok) d.push('robots.txt was not found or could not be fetched.');
  if (!ctx.sitemap.ok) d.push('sitemap.xml was not found or could not be fetched.');
  if (ctx.content.wordCount < 250) d.push('Visible content appears thin on the scanned page.');
  return unique(d).slice(0, 18);
}
function buildRecommendations(ctx) {
  const r = [];
  if ((ctx.security.issues || []).length) r.push('Fix missing security headers and form/cookie risks first.');
  if ((ctx.seo.issues || []).length) r.push('Fix SEO basics: title, meta description, canonical, H1, image alt text and viewport.');
  if (!ctx.privacy.privacyPolicyLink) r.push('Add a clear Privacy Policy link in the footer or navigation.');
  if (!ctx.legalLinks.length) r.push('Add Terms, Privacy, Cookie and relevant policy pages for user trust.');
  if (!ctx.sitemap.ok) r.push('Publish sitemap.xml and submit it to search engines.');
  if (!ctx.robots.ok) r.push('Publish robots.txt to guide search engine crawlers.');
  if (!ctx.emails.length && !ctx.phones.length && !ctx.forms.count) r.push('Add visible contact options if this is a business website.');
  if (ctx.content.wordCount < 250) r.push('Add more useful visible content so users and search engines can understand the page.');
  if (!ctx.technology.analytics.length && /business|agency|shop|service|saas/i.test(ctx.classification.type)) r.push('Add privacy-compliant analytics to measure traffic and conversions.');
  if (ctx.externalLinks.length > 80) r.push('Review excessive outgoing links and keep only trustworthy destinations.');
  if (!r.length) r.push('Run a deeper manual audit for reputation, malware, backlink and business compliance data.');
  return unique(r).slice(0, 14);
}
function buildFeatureChecks(ctx) {
  const f = [];
  const add = (category, name, status, detail) => f.push({ category, name, status, detail });
  add('Fetch', 'Website reachable', ctx.fetched.response.ok ? 'pass' : 'warn', `HTTP ${ctx.fetched.response.status}`);
  add('Fetch', 'Standard URL port', ['', '80', '443'].includes(ctx.finalParsed.port) ? 'pass' : 'fail', ctx.finalParsed.port || 'standard');
  add('Fetch', 'Redirect count', ctx.fetched.redirects.length <= 2 ? 'pass' : 'warn', `${ctx.fetched.redirects.length} redirect(s)`);
  add('Fetch', 'Readable HTML', ctx.html ? 'pass' : 'warn', ctx.html ? 'HTML content detected' : 'Non-HTML or unreadable content');
  add('Security', 'HTTPS', ctx.finalParsed.protocol === 'https:' ? 'pass' : 'fail', ctx.finalParsed.protocol);
  for (const [key, value] of Object.entries(ctx.security.headers || {})) add('Security Header', key, value.status, value.detail);
  add('Security', 'Mixed content references', ctx.security.forms.mixedContentReferences ? 'warn' : 'pass', `${ctx.security.forms.mixedContentReferences || 0} found`);
  add('Security', 'Password form risk', ctx.forms.hasPassword ? 'warn' : 'pass', ctx.forms.hasPassword ? 'Password form detected' : 'No password form detected');
  add('Security', 'File upload risk', ctx.forms.hasFileUpload ? 'warn' : 'pass', ctx.forms.hasFileUpload ? 'File upload form detected' : 'No file upload form detected');
  add('Cookie', 'Set-Cookie visible', ctx.cookies.setCookieHeader ? 'info' : 'info', ctx.cookies.setCookieHeader ? 'Cookie header visible' : 'No first-response cookie header');
  add('Cookie', 'Secure flag', ctx.cookies.secureFlag === true ? 'pass' : ctx.cookies.setCookieHeader ? 'warn' : 'info', String(ctx.cookies.secureFlag));
  add('Cookie', 'HttpOnly flag', ctx.cookies.httpOnlyFlag === true ? 'pass' : ctx.cookies.setCookieHeader ? 'warn' : 'info', String(ctx.cookies.httpOnlyFlag));
  add('Cookie', 'SameSite flag', ctx.cookies.sameSiteFlag === true ? 'pass' : ctx.cookies.setCookieHeader ? 'warn' : 'info', String(ctx.cookies.sameSiteFlag));
  add('SEO', 'Title tag', ctx.seo.title ? 'pass' : 'fail', ctx.seo.title || 'Missing');
  add('SEO', 'Title length', ctx.seo.titleLength >= 25 && ctx.seo.titleLength <= 70 ? 'pass' : 'warn', `${ctx.seo.titleLength} chars`);
  add('SEO', 'Meta description', ctx.seo.description ? 'pass' : 'fail', ctx.seo.description || 'Missing');
  add('SEO', 'Meta description length', ctx.seo.descriptionLength >= 70 && ctx.seo.descriptionLength <= 170 ? 'pass' : 'warn', `${ctx.seo.descriptionLength} chars`);
  add('SEO', 'Canonical tag', ctx.seo.canonical ? 'pass' : 'warn', ctx.seo.canonical || 'Missing');
  add('SEO', 'Viewport tag', ctx.seo.viewport ? 'pass' : 'fail', ctx.seo.viewport || 'Missing');
  add('SEO', 'Language declared', ctx.seo.lang ? 'pass' : 'warn', ctx.seo.lang || 'Missing');
  add('SEO', 'Robots meta', ctx.seo.robotsMeta ? 'info' : 'info', ctx.seo.robotsMeta || 'Not declared');
  add('SEO', 'H1 count', ctx.seo.h1Count === 1 ? 'pass' : 'warn', `${ctx.seo.h1Count} H1 tag(s)`);
  add('SEO', 'H2 count', ctx.seo.h2Count > 0 ? 'pass' : 'warn', `${ctx.seo.h2Count} H2 tag(s)`);
  add('SEO', 'H3 count', ctx.seo.h3Count > 0 ? 'pass' : 'info', `${ctx.seo.h3Count} H3 tag(s)`);
  add('SEO', 'Image alt text', ctx.seo.imagesMissingAlt === 0 ? 'pass' : 'warn', `${ctx.seo.imagesMissingAlt} missing alt`);
  add('SEO', 'Open Graph title', ctx.seo.socialMeta.openGraphTitle ? 'pass' : 'warn', String(ctx.seo.socialMeta.openGraphTitle));
  add('SEO', 'Open Graph description', ctx.seo.socialMeta.openGraphDescription ? 'pass' : 'warn', String(ctx.seo.socialMeta.openGraphDescription));
  add('SEO', 'Open Graph image', ctx.seo.socialMeta.openGraphImage ? 'pass' : 'warn', String(ctx.seo.socialMeta.openGraphImage));
  add('SEO', 'Twitter card', ctx.seo.socialMeta.twitterCard ? 'pass' : 'warn', String(ctx.seo.socialMeta.twitterCard));
  add('SEO', 'Favicon', ctx.seo.hasFavicon ? 'pass' : 'warn', String(ctx.seo.hasFavicon));
  add('Indexing', 'robots.txt', ctx.robots.ok ? 'pass' : 'warn', String(ctx.robots.status));
  add('Indexing', 'sitemap.xml', ctx.sitemap.ok ? 'pass' : 'warn', String(ctx.sitemap.status));
  add('Links', 'Total links', ctx.allLinks.length > 0 ? 'pass' : 'warn', `${ctx.allLinks.length} link(s)`);
  add('Links', 'Internal links', ctx.internalLinks.length > 0 ? 'pass' : 'warn', `${ctx.internalLinks.length} link(s)`);
  add('Links', 'External outgoing links', ctx.externalLinks.length > 0 ? 'info' : 'info', `${ctx.externalLinks.length} link(s)`);
  add('Links', 'Social links', ctx.socialLinks.length > 0 ? 'pass' : 'warn', `${ctx.socialLinks.length} link(s)`);
  add('Links', 'Important navigation links', ctx.importantLinks.length > 0 ? 'pass' : 'warn', `${ctx.importantLinks.length} link(s)`);
  add('Links', 'Legal links', ctx.legalLinks.length > 0 ? 'pass' : 'warn', `${ctx.legalLinks.length} link(s)`);
  add('Links', 'Feed links', ctx.feedLinks.length > 0 ? 'pass' : 'info', `${ctx.feedLinks.length} feed(s)`);
  add('Links', 'Resource/download links', ctx.resourceLinks.length > 0 ? 'info' : 'info', `${ctx.resourceLinks.length} resource(s)`);
  add('Contact', 'Email addresses', ctx.emails.length > 0 ? 'pass' : 'info', `${ctx.emails.length} found`);
  add('Contact', 'Phone numbers', ctx.phones.length > 0 ? 'pass' : 'info', `${ctx.phones.length} found`);
  add('Contact', 'Name/organization hints', ctx.names.length > 0 ? 'pass' : 'info', `${ctx.names.length} found`);
  add('Contact', 'Address hints', ctx.addresses.length > 0 ? 'pass' : 'info', `${ctx.addresses.length} found`);
  add('Forms', 'Forms detected', ctx.forms.count > 0 ? 'pass' : 'info', `${ctx.forms.count} form(s)`);
  add('Forms', 'Search form', ctx.forms.hasSearch ? 'pass' : 'info', String(ctx.forms.hasSearch));
  add('Forms', 'Email/contact form fields', ctx.forms.hasEmailInput || ctx.forms.hasTextarea ? 'pass' : 'info', String(ctx.forms.hasEmailInput || ctx.forms.hasTextarea));
  add('Privacy', 'Privacy policy link', ctx.privacy.privacyPolicyLink ? 'pass' : 'warn', String(ctx.privacy.privacyPolicyLink));
  add('Privacy', 'Terms link', ctx.privacy.termsLink ? 'pass' : 'warn', String(ctx.privacy.termsLink));
  add('Privacy', 'Cookie policy link', ctx.privacy.cookiePolicyLink ? 'pass' : 'info', String(ctx.privacy.cookiePolicyLink));
  add('Privacy', 'Tracker signals', ctx.privacy.trackers.length ? 'info' : 'pass', ctx.privacy.trackers.join(', ') || 'None detected');
  add('Privacy', 'Ad technology signals', ctx.privacy.adTech.length ? 'info' : 'pass', ctx.privacy.adTech.join(', ') || 'None detected');
  add('Permission', 'Geolocation hint', ctx.permissions.geolocation ? 'warn' : 'pass', String(ctx.permissions.geolocation));
  add('Permission', 'Camera hint', ctx.permissions.camera ? 'warn' : 'pass', String(ctx.permissions.camera));
  add('Permission', 'Microphone hint', ctx.permissions.microphone ? 'warn' : 'pass', String(ctx.permissions.microphone));
  add('Permission', 'Notification hint', ctx.permissions.notifications ? 'info' : 'pass', String(ctx.permissions.notifications));
  add('Permission', 'Clipboard hint', ctx.permissions.clipboard ? 'info' : 'pass', String(ctx.permissions.clipboard));
  add('Technology', 'CMS detected', ctx.technology.cms.length ? 'info' : 'info', ctx.technology.cms.join(', ') || 'None detected');
  add('Technology', 'Framework detected', ctx.technology.frameworks.length ? 'info' : 'info', ctx.technology.frameworks.join(', ') || 'None detected');
  add('Technology', 'Analytics detected', ctx.technology.analytics.length ? 'info' : 'info', ctx.technology.analytics.join(', ') || 'None detected');
  add('Technology', 'Payment tools detected', ctx.technology.payments.length ? 'info' : 'info', ctx.technology.payments.join(', ') || 'None detected');
  add('Technology', 'Server header', ctx.technology.server ? 'info' : 'info', ctx.technology.server || 'Not visible');
  add('Content', 'Visible word count', ctx.content.wordCount >= 250 ? 'pass' : 'warn', `${ctx.content.wordCount} words`);
  add('Content', 'Schema JSON-LD', ctx.content.jsonLdCount > 0 ? 'pass' : 'info', `${ctx.content.jsonLdCount} block(s)`);
  add('Content', 'Schema types', ctx.content.schemaTypes.length > 0 ? 'pass' : 'info', ctx.content.schemaTypes.join(', ') || 'None detected');
  add('Content', 'Top keywords generated', ctx.content.topKeywords.length > 0 ? 'pass' : 'warn', `${ctx.content.topKeywords.length} keyword(s)`);
  add('Classification', 'Website type detected', ctx.classification.confidence === 'High' ? 'pass' : 'info', `${ctx.classification.type} (${ctx.classification.confidence})`);
  add('Capabilities', 'User actions inferred', ctx.capabilities.length > 1 ? 'pass' : 'info', `${ctx.capabilities.length} action(s)`);
  return f;
}
function countRegex(text, re) { return (String(text || '').match(re) || []).length; }
function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}
