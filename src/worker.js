// SiteTrust Checker Pro V4
// Cloudflare Workers + Static Assets version
// API routes: /api/health, /api/analyze

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
  'x-content-type-options': 'nosniff'
};

export default {
  async fetch(request, env, ctx) {
    const reqUrl = new URL(request.url);

    try {
      if (reqUrl.pathname === '/api/health') {
        return json({
          ok: true,
          service: 'SiteTrust Checker Pro',
          version: '5.0-worker-static-assets-fixed',
          message: 'Backend API is connected. Website analysis can run.',
          time: new Date().toISOString()
        });
      }

      if (reqUrl.pathname === '/api/analyze') {
        if (request.method !== 'POST') {
          return json({ ok: false, error: 'Only POST requests are supported. Use the Analyze form.' }, 405);
        }
        const body = await request.json().catch(() => ({}));
        const report = await analyzeWebsite(body.url || '', body.options || {});
        return json(report, report.ok ? 200 : 200);
      }

      if (env && env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response('Static assets are not configured. Deploy with wrangler.jsonc and the public folder.', { status: 500 });
    } catch (err) {
      return json({
        ok: false,
        mode: 'Worker error',
        error: safeText(String(err && err.message ? err.message : err)),
        fix: 'Check Cloudflare deployment logs. Make sure wrangler.jsonc, src/worker.js and public/index.html were uploaded.'
      }, 500);
    }
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function analyzeWebsite(inputUrl, options = {}) {
  const started = Date.now();
  let normalized;

  try {
    normalized = normalizeAndValidate(inputUrl);
  } catch (err) {
    return errorReport(inputUrl, 'Invalid or blocked URL', safeText(err.message));
  }

  const target = normalized.href;
  const home = await fetchPage(target, 14000);

  if (!home.ok) {
    return errorReport(target, 'Live analysis failed', home.error || 'The website did not return readable public HTML.');
  }

  const finalUrl = new URL(home.finalUrl || target);
  const origin = finalUrl.origin;

  const pages = [{ url: finalUrl.href, label: 'Homepage', ...home }];

  // Crawl a few useful same-site pages to improve contact/link discovery without heavy crawling.
  const homeLinks = extractLinks(home.html, finalUrl.href);
  const crawlTargets = chooseCrawlTargets(homeLinks, origin);
  for (const crawlUrl of crawlTargets) {
    const p = await fetchPage(crawlUrl, 8000);
    if (p.ok) pages.push({ url: p.finalUrl || crawlUrl, label: 'Internal page', ...p });
    if (pages.length >= 5) break;
  }

  const combinedHtml = pages.map(p => p.html || '').join('\n');
  const combinedText = pages.map(p => visibleText(p.html || '')).join('\n');

  const allLinksRaw = [];
  for (const p of pages) allLinksRaw.push(...extractLinks(p.html || '', p.url || finalUrl.href));

  const allLinks = uniqueLinkObjects(allLinksRaw);
  const internalLinks = allLinks.filter(l => sameOrigin(l.url, origin));
  const externalLinks = allLinks.filter(l => !sameOrigin(l.url, origin) && /^https?:/i.test(l.url));
  const socialLinks = externalLinks.filter(l => isSocialUrl(l.url));
  const legalLinks = allLinks.filter(l => /privacy|terms|condition|cookie|policy|disclaimer|refund|return|shipping|legal/i.test((l.url + ' ' + l.text)));
  const contactLinks = allLinks.filter(l => /contact|about|support|help|customer-service|service|team|office/i.test((l.url + ' ' + l.text)));
  const resourceLinks = allLinks.filter(l => /download|resource|pdf|doc|template|guide|blog|article|case-study|whitepaper/i.test((l.url + ' ' + l.text)));
  const feedLinks = uniqueLinkObjects(extractFeedLinks(combinedHtml, finalUrl.href).concat(allLinks.filter(l => /rss|atom|feed/i.test(l.url + ' ' + l.text))));

  const title = safeText(firstMatch(home.html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const metaDescription = safeText(metaContent(home.html, 'description'));
  const canonical = attrFromTag(home.html, /<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i, 'href');
  const lang = attrFromTag(home.html, /<html\b[^>]*>/i, 'lang') || 'Unknown';

  const headings = {
    h1: extractTags(home.html, 'h1'),
    h2: extractTags(home.html, 'h2'),
    h3: extractTags(home.html, 'h3'),
    h4: extractTags(home.html, 'h4')
  };

  const imageCount = countMatches(combinedHtml, /<img\b/gi);
  const imagesMissingAlt = countImagesMissingAlt(combinedHtml);
  const scriptCount = countMatches(combinedHtml, /<script\b/gi);
  const stylesheetCount = countMatches(combinedHtml, /<link\b[^>]*rel=["'][^"']*stylesheet/gi);
  const formCount = countMatches(combinedHtml, /<form\b/gi);
  const inputCount = countMatches(combinedHtml, /<input\b/gi);
  const loginFormCount = countMatches(combinedHtml, /type=["']password["']|name=["']password["']|id=["']password["']/gi);
  const uploadFormCount = countMatches(combinedHtml, /type=["']file["']/gi);
  const searchFormCount = countMatches(combinedHtml, /type=["']search["']|name=["']s["']|name=["']q["']|placeholder=["'][^"']*search/gi);
  const newsletterSignals = countMatches(combinedHtml + combinedText, /newsletter|subscribe|subscription|email updates|mailchimp|klaviyo|sendgrid/gi);
  const ecommerceSignals = countMatches(combinedHtml + combinedText, /cart|checkout|add to cart|shop|product|payment|stripe|paypal|woocommerce|shopify/gi);

  const emails = unique(extractEmails(combinedHtml + '\n' + combinedText));
  const phones = unique(extractPhones(combinedText));
  const addressHints = unique(extractAddressHints(combinedText));
  const organizationHints = unique(extractOrganizationHints(combinedHtml, combinedText, title));

  const robots = await fetchSmallText(origin + '/robots.txt', 6500);
  const sitemap = await findSitemap(origin, robots.text || '');

  const security = securityReport(home.response, finalUrl, combinedHtml);
  const technology = technologyReport(combinedHtml, home.response.headers);
  const content = contentReport(combinedText, combinedHtml, lang);
  const websiteType = inferWebsiteType({ title, metaDescription, text: combinedText, host: finalUrl.hostname, links: allLinks, tech: technology, ecommerceSignals });
  const purpose = inferPurpose(websiteType, title, metaDescription, combinedText);
  const userActions = inferUserActions(combinedText, allLinks, { formCount, loginFormCount, uploadFormCount, searchFormCount, ecommerceSignals, newsletterSignals });

  const seo = seoReport({ html: home.html, title, metaDescription, canonical, headings, lang, imageCount, imagesMissingAlt, robots, sitemap });
  const counts = {
    scannedPages: pages.length,
    discoveredUniqueLinks: allLinks.length,
    internalLinks: internalLinks.length,
    outgoingExternalLinks: externalLinks.length,
    socialLinks: socialLinks.length,
    contactLinks: contactLinks.length,
    legalLinks: legalLinks.length,
    resourceLinks: resourceLinks.length,
    feedLinks: feedLinks.length,
    emails: emails.length,
    phones: phones.length,
    addressHints: addressHints.length,
    organizationHints: organizationHints.length,
    forms: formCount,
    inputs: inputCount,
    loginForms: loginFormCount,
    uploadForms: uploadFormCount,
    searchSignals: searchFormCount,
    newsletterSignals,
    images: imageCount,
    imagesMissingAlt,
    scripts: scriptCount,
    stylesheets: stylesheetCount,
    sitemapUrls: sitemap.urlCount || 0
  };

  const scoring = scoreWebsite({ seo, security, counts, content, technology, fetchStatus: home.status });
  const topFindings = buildTopFindings({ seo, security, counts, technology, content, websiteType, pages });
  const advantages = buildAdvantages({ seo, security, counts, technology, content });
  const weaknesses = buildWeaknesses({ seo, security, counts, technology, content });
  const recommendations = buildRecommendations({ seo, security, counts, technology, content });
  const checks = buildChecklist({ seo, security, counts, technology, content, websiteType, home, robots, sitemap });

  return {
    ok: true,
    mode: 'Live multi-page public HTML scan',
    analyzedUrl: target,
    finalUrl: finalUrl.href,
    scannedAt: new Date().toISOString(),
    responseTimeMs: Date.now() - started,
    importantNote: 'Counts are based on public HTML from the homepage plus a few important internal pages. A complete backlink database or full-site crawler requires external APIs and permission.',
    summary: {
      score: scoring.score,
      riskLevel: scoring.riskLevel,
      finalDecision: scoring.finalDecision,
      websiteType,
      purpose,
      executiveSummary: `${websiteType}. ${purpose} Scanned ${pages.length} public page(s), found ${allLinks.length} unique links, ${internalLinks.length} internal links, ${externalLinks.length} outgoing external links, ${emails.length} public email address(es), and ${phones.length} public phone number(s).`,
      userActions,
      topFindings
    },
    pagesScanned: pages.map(p => ({ url: p.url, label: p.label, status: p.status, contentType: p.contentType, size: p.html ? p.html.length : 0 })),
    counts,
    seo,
    security,
    contact: { emails, phones, addressHints, organizationHints },
    links: {
      all: allLinks.slice(0, 250),
      internal: internalLinks.slice(0, 180),
      outgoingExternal: externalLinks.slice(0, 160),
      social: socialLinks.slice(0, 60),
      contact: contactLinks.slice(0, 60),
      legal: legalLinks.slice(0, 60),
      resources: resourceLinks.slice(0, 80),
      feeds: feedLinks.slice(0, 30)
    },
    technology,
    content,
    robots: { found: robots.ok, status: robots.status, url: origin + '/robots.txt', size: robots.text ? robots.text.length : 0 },
    sitemap,
    backlink: {
      realBacklinkCountAvailable: false,
      message: 'Real backlinks are links from other websites pointing to this domain. They cannot be measured from the target website HTML alone. Use Ahrefs, Semrush, Moz, Majestic, or verified Google Search Console for real backlink counts.'
    },
    advantages,
    weaknesses,
    recommendations,
    checks,
    limitations: standardLimitations()
  };
}

async function fetchPage(url, timeoutMs) {
  try {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; SiteTrustCheckerPro/4.0; public-website-audit)',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.7,*/*;q=0.5',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache'
      }
    }, timeoutMs);

    const contentType = response.headers.get('content-type') || '';
    let text = await response.text();
    text = text.slice(0, 2500000);

    if (!text || text.length < 40) return { ok: false, status: response.status, finalUrl: response.url, error: 'The page returned almost no readable content.' };

    return {
      ok: true,
      status: response.status,
      finalUrl: response.url,
      contentType,
      html: text,
      response
    };
  } catch (err) {
    return { ok: false, error: safeText(err && err.message ? err.message : String(err)) };
  }
}

async function fetchWithTimeout(url, init, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort('timeout'), ms);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

async function fetchSmallText(url, timeoutMs) {
  try {
    const res = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow', headers: { 'user-agent': 'SiteTrustCheckerPro/4.0' } }, timeoutMs);
    const text = (await res.text()).slice(0, 500000);
    return { ok: res.ok && text.length > 0, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: '', error: safeText(err.message) };
  }
}

async function findSitemap(origin, robotsText) {
  const candidates = [];
  const re = /^\s*Sitemap:\s*(\S+)\s*$/gim;
  let m;
  while ((m = re.exec(robotsText || ''))) candidates.push(m[1]);
  candidates.push(origin + '/sitemap.xml', origin + '/sitemap_index.xml');
  const seen = new Set();
  for (const url of candidates) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const res = await fetchSmallText(url, 6500);
    if (res.ok && /<urlset|<sitemapindex|<loc>/i.test(res.text)) {
      return { found: true, url, status: res.status, size: res.text.length, urlCount: countMatches(res.text, /<loc>/gi) };
    }
  }
  return { found: false, url: origin + '/sitemap.xml', status: 0, size: 0, urlCount: 0 };
}

function normalizeAndValidate(input) {
  let value = String(input || '').trim();
  if (!value) throw new Error('URL is empty.');
  if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https URLs are supported.');
  if (u.username || u.password) throw new Error('URLs with username/password are blocked.');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('Unusual ports are blocked for safety.');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) throw new Error('Private/local hostnames are blocked.');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const p = host.split('.').map(Number);
    const privateIp = p[0] === 10 || p[0] === 127 || p[0] === 0 || p[0] >= 224 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 169 && p[1] === 254);
    if (privateIp) throw new Error('Private/internal IP addresses are blocked.');
  }
  return u;
}

function chooseCrawlTargets(links, origin) {
  const scored = [];
  const seen = new Set();
  for (const l of links) {
    if (!l.url || seen.has(l.url) || !sameOrigin(l.url, origin)) continue;
    seen.add(l.url);
    const s = (l.url + ' ' + l.text).toLowerCase();
    let score = 0;
    if (/contact|support|help|about|team|company|office|location/.test(s)) score += 100;
    if (/privacy|terms|policy|legal|cookie/.test(s)) score += 40;
    if (/services|pricing|product|shop|blog|resources/.test(s)) score += 25;
    if (/[?#]/.test(l.url)) score -= 15;
    if (score > 0) scored.push({ url: l.url, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 4).map(x => x.url);
}

function sameOrigin(url, origin) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

function extractLinks(html, baseUrl) {
  const out = [];
  const re = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const attrs = m[1] || '';
    const href = getAttr(attrs, 'href');
    if (!href) continue;
    if (/^(#|javascript:|mailto:|tel:|sms:|whatsapp:)/i.test(href.trim())) continue;
    try {
      const u = new URL(decodeHtml(href.trim()), baseUrl);
      if (!/^https?:$/i.test(u.protocol)) continue;
      u.hash = '';
      const text = cleanSpaces(stripTags(m[2] || '')).slice(0, 120);
      out.push({ url: u.href, text });
    } catch (_) {}
  }
  return out;
}

function extractFeedLinks(html, baseUrl) {
  const out = [];
  const re = /<link\b([^>]*?)>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const attrs = m[1] || '';
    const rel = getAttr(attrs, 'rel') || '';
    const type = getAttr(attrs, 'type') || '';
    const href = getAttr(attrs, 'href');
    if (!href) continue;
    if (/alternate|feed/i.test(rel) || /rss|atom/i.test(type)) {
      try { out.push({ url: new URL(href, baseUrl).href, text: type || rel || 'Feed' }); } catch (_) {}
    }
  }
  return out;
}

function uniqueLinkObjects(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    if (!item || !item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push({ url: item.url, text: item.text || '' });
  }
  return out;
}

function extractEmails(text) {
  const emails = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return emails.map(e => e.replace(/[.,;:)\]]+$/g, '')).filter(e => !/example\.|domain\.|email\.com|yourname/i.test(e));
}

function extractPhones(text) {
  const matches = String(text || '').match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
  return matches.map(p => cleanSpaces(p)).filter(p => {
    const digits = p.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15 && !/^20\d{6,}$/.test(digits);
  });
}

function extractAddressHints(text) {
  const lines = String(text || '').split(/[\n\r]+/).map(cleanSpaces).filter(Boolean);
  const out = [];
  const addrRe = /\b(road|rd\.?|street|st\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|suite|floor|building|block|sector|city|zip|postal|postcode|address|office|headquarters|hq)\b/i;
  for (const line of lines) {
    if (line.length >= 18 && line.length <= 180 && addrRe.test(line) && /\d/.test(line)) out.push(line);
    if (out.length >= 20) break;
  }
  return out;
}

function extractOrganizationHints(html, text, title) {
  const out = [];
  const ogSite = metaProperty(html, 'og:site_name');
  const appName = metaContent(html, 'application-name');
  [ogSite, appName, title].forEach(v => { if (v) out.push(safeText(v).slice(0, 100)); });
  const schemaNames = [...String(html || '').matchAll(/"(?:name|legalName)"\s*:\s*"([^"]{2,120})"/gi)].map(m => m[1]);
  out.push(...schemaNames.slice(0, 10));
  return out.filter(Boolean);
}

function securityReport(response, finalUrl, html) {
  const h = response.headers;
  const cookiesRaw = h.get('set-cookie') || '';
  const cookies = cookiesRaw ? cookiesRaw.split(/,(?=[^;]+?=)/g) : [];
  const secureCookies = cookies.filter(c => /;\s*secure/i.test(c)).length;
  const httpOnlyCookies = cookies.filter(c => /;\s*httponly/i.test(c)).length;
  const sameSiteCookies = cookies.filter(c => /;\s*samesite=/i.test(c)).length;
  const permissionHints = [];
  if (/Notification\.|permission|requestPermission/i.test(html)) permissionHints.push('Notifications');
  if (/geolocation|getCurrentPosition|watchPosition/i.test(html)) permissionHints.push('Geolocation');
  if (/getUserMedia|camera|microphone/i.test(html)) permissionHints.push('Camera/Microphone');
  if (/clipboard|writeText|readText/i.test(html)) permissionHints.push('Clipboard');
  if (/serviceWorker\.register/i.test(html)) permissionHints.push('Service Worker');

  return {
    https: finalUrl.protocol === 'https:',
    httpStatus: response.status,
    finalUrl: finalUrl.href,
    headers: {
      contentSecurityPolicy: h.get('content-security-policy') || '',
      strictTransportSecurity: h.get('strict-transport-security') || '',
      xFrameOptions: h.get('x-frame-options') || '',
      xContentTypeOptions: h.get('x-content-type-options') || '',
      referrerPolicy: h.get('referrer-policy') || '',
      permissionsPolicy: h.get('permissions-policy') || '',
      crossOriginOpenerPolicy: h.get('cross-origin-opener-policy') || '',
      crossOriginResourcePolicy: h.get('cross-origin-resource-policy') || '',
      server: h.get('server') || '',
      poweredBy: h.get('x-powered-by') || ''
    },
    cookies: {
      setCookieCount: cookies.length,
      secureFlagCount: secureCookies,
      httpOnlyFlagCount: httpOnlyCookies,
      sameSiteFlagCount: sameSiteCookies
    },
    permissionHints: unique(permissionHints),
    mixedContentHints: finalUrl.protocol === 'https:' && /(?:src|href)=["']http:\/\//i.test(html)
  };
}

function technologyReport(html, headers) {
  const signals = [];
  const tracking = [];
  const payments = [];
  const h = headers;
  const all = String(html || '') + '\n' + [...h.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');

  addIf(signals, /wp-content|wordpress|wp-json/i.test(all), 'WordPress');
  addIf(signals, /woocommerce/i.test(all), 'WooCommerce');
  addIf(signals, /elementor/i.test(all), 'Elementor');
  addIf(signals, /shopify|cdn\.shopify/i.test(all), 'Shopify');
  addIf(signals, /wixstatic|wix\.com/i.test(all), 'Wix');
  addIf(signals, /webflow/i.test(all), 'Webflow');
  addIf(signals, /squarespace/i.test(all), 'Squarespace');
  addIf(signals, /next\/static|__NEXT_DATA__/i.test(all), 'Next.js');
  addIf(signals, /nuxt|__NUXT__/i.test(all), 'Nuxt');
  addIf(signals, /react|data-reactroot/i.test(all), 'React');
  addIf(signals, /vue|data-v-/i.test(all), 'Vue');
  addIf(signals, /angular|ng-version/i.test(all), 'Angular');
  addIf(signals, /jquery/i.test(all), 'jQuery');
  addIf(signals, /bootstrap/i.test(all), 'Bootstrap');
  addIf(signals, /tailwind/i.test(all), 'Tailwind CSS');
  addIf(signals, /cloudflare/i.test(all), 'Cloudflare');

  addIf(tracking, /googletagmanager|gtm\.js/i.test(all), 'Google Tag Manager');
  addIf(tracking, /google-analytics|gtag\(|analytics\.js|GA_MEASUREMENT_ID/i.test(all), 'Google Analytics');
  addIf(tracking, /facebook\.net\/.*fbevents|fbq\(/i.test(all), 'Meta Pixel');
  addIf(tracking, /googlesyndication|adsbygoogle/i.test(all), 'Google AdSense/Ads');
  addIf(tracking, /clarity\.ms/i.test(all), 'Microsoft Clarity');
  addIf(tracking, /hotjar/i.test(all), 'Hotjar');
  addIf(tracking, /hubspot/i.test(all), 'HubSpot');

  addIf(payments, /stripe/i.test(all), 'Stripe');
  addIf(payments, /paypal/i.test(all), 'PayPal');
  addIf(payments, /razorpay/i.test(all), 'Razorpay');
  addIf(payments, /sslcommerz/i.test(all), 'SSLCommerz');

  return {
    platformHints: unique(signals),
    trackingHints: unique(tracking),
    paymentHints: unique(payments),
    serverHeader: h.get('server') || '',
    poweredBy: h.get('x-powered-by') || ''
  };
}

function seoReport({ html, title, metaDescription, canonical, headings, lang, imageCount, imagesMissingAlt, robots, sitemap }) {
  return {
    title,
    titleLength: title.length,
    metaDescription,
    metaDescriptionLength: metaDescription.length,
    canonical: canonical || '',
    lang,
    charset: /<meta\b[^>]*charset=/i.test(html),
    viewport: /<meta\b[^>]*name=["']viewport["']/i.test(html),
    robotsMeta: metaContent(html, 'robots') || '',
    noIndex: /<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html),
    headings,
    h1Count: headings.h1.length,
    h2Count: headings.h2.length,
    imageCount,
    imagesMissingAlt,
    openGraphCount: countMatches(html, /property=["']og:/gi),
    twitterCardCount: countMatches(html, /name=["']twitter:/gi),
    schemaCount: countMatches(html, /application\/ld\+json|itemscope|schema\.org/gi),
    robotsTxtFound: !!robots.ok,
    robotsTxtStatus: robots.status || 0,
    sitemapFound: !!sitemap.found,
    sitemapUrlCount: sitemap.urlCount || 0
  };
}

function contentReport(text, html, lang) {
  const clean = cleanSpaces(text || '');
  const words = clean ? clean.split(/\s+/).filter(Boolean) : [];
  const topKeywords = keywordFrequency(clean).slice(0, 20);
  return {
    language: lang || 'Unknown',
    characterCount: clean.length,
    wordCount: words.length,
    topKeywords,
    schemaCount: countMatches(html, /application\/ld\+json|itemscope|schema\.org/gi),
    hasPrivacySignal: /privacy policy|privacy/i.test(text + html),
    hasTermsSignal: /terms and conditions|terms of service|terms/i.test(text + html),
    hasCookieSignal: /cookie policy|cookies/i.test(text + html),
    hasContactSignal: /contact us|contact|support|help/i.test(text + html),
    hasAboutSignal: /about us|about/i.test(text + html)
  };
}

function inferWebsiteType({ title, metaDescription, text, host, links, tech, ecommerceSignals }) {
  const s = `${title} ${metaDescription} ${text} ${host} ${(tech.platformHints || []).join(' ')}`.toLowerCase();
  if (ecommerceSignals > 3 || /shop|cart|checkout|product|store|woocommerce|shopify|buy now|add to cart/.test(s)) return 'E-commerce / online store';
  if (/news|journal|magazine|breaking|article|editorial/.test(s)) return 'News / media website';
  if (/blog|post|author|category|tag/.test(s)) return 'Blog / content website';
  if (/university|college|school|academy|course|admission|student|education/.test(s)) return 'Education / training website';
  if (/doctor|clinic|hospital|health|medical|dental|patient|pharmacy/.test(s)) return 'Healthcare website';
  if (/portfolio|designer|developer|photographer|resume|cv/.test(s)) return 'Portfolio / personal brand website';
  if (/software|saas|platform|app|api|dashboard|automation|tool/.test(s)) return 'Software / SaaS website';
  if (/agency|marketing|consulting|service|solutions|company|business|corporate/.test(s)) return 'Business / service website';
  if (/nonprofit|charity|foundation|donate|ngo/.test(s)) return 'Nonprofit / organization website';
  if (/government|gov\.|public service|ministry|department/.test(s)) return 'Government / public service website';
  return 'General website';
}

function inferPurpose(type, title, desc, text) {
  const s = `${title}. ${desc}`.trim();
  if (s.length > 30) return `The site appears to present ${s.slice(0, 220)}.`;
  const map = {
    'E-commerce / online store': 'The site appears designed to display products, support shopping, and guide users toward purchase or checkout.',
    'News / media website': 'The site appears designed to publish articles, news updates, and media content.',
    'Blog / content website': 'The site appears designed to publish informational posts, guides, or opinion content.',
    'Education / training website': 'The site appears designed to provide educational information, courses, admissions, or learning resources.',
    'Healthcare website': 'The site appears designed to explain healthcare services, contact options, and patient-facing information.',
    'Business / service website': 'The site appears designed to present services, build trust, and generate inquiries or leads.',
    'Software / SaaS website': 'The site appears designed to explain a software product, features, pricing, and user onboarding.'
  };
  return map[type] || 'The site appears designed to publish information and guide users to relevant pages or actions.';
}

function inferUserActions(text, links, signals) {
  const s = String(text || '').toLowerCase();
  const out = [];
  if (signals.searchFormCount > 0 || /search/.test(s)) out.push('Search content or pages');
  if (signals.loginFormCount > 0 || /login|sign in|account/.test(s)) out.push('Log in or access an account area');
  if (signals.formCount > 0 || /contact|get quote|request|inquiry|book now/.test(s)) out.push('Submit a form or send an inquiry');
  if (signals.ecommerceSignals > 2) out.push('Browse products, cart, checkout, or payment-related pages');
  if (signals.newsletterSignals > 0) out.push('Subscribe to updates or newsletters');
  if (signals.uploadFormCount > 0) out.push('Upload files through a form');
  if (links.some(l => /blog|article|news|resources/i.test(l.url + l.text))) out.push('Read blog posts, resources, or articles');
  if (links.some(l => /contact|support|help/i.test(l.url + l.text))) out.push('Find contact, support, or help information');
  if (!out.length) out.push('Read website information and navigate to public pages');
  return unique(out).slice(0, 10);
}

function scoreWebsite({ seo, security, counts, content, technology, fetchStatus }) {
  let score = 50;
  if (fetchStatus >= 200 && fetchStatus < 400) score += 8;
  if (security.https) score += 10; else score -= 15;
  if (security.headers.contentSecurityPolicy) score += 6; else score -= 4;
  if (security.headers.strictTransportSecurity && security.https) score += 5;
  if (security.headers.xFrameOptions) score += 4;
  if (security.headers.xContentTypeOptions) score += 4;
  if (security.headers.referrerPolicy) score += 3;
  if (security.mixedContentHints) score -= 10;
  if (seo.title && seo.titleLength >= 10 && seo.titleLength <= 70) score += 6; else score -= 4;
  if (seo.metaDescription && seo.metaDescriptionLength >= 50 && seo.metaDescriptionLength <= 180) score += 5; else score -= 2;
  if (seo.h1Count === 1) score += 4; else if (seo.h1Count === 0) score -= 3;
  if (seo.viewport) score += 3;
  if (seo.sitemapFound) score += 4;
  if (seo.robotsTxtFound) score += 3;
  if (content.wordCount > 250) score += 4; else score -= 4;
  if (counts.internalLinks > 5) score += 3;
  if (counts.contactLinks > 0 || counts.emails > 0 || counts.phones > 0) score += 4;
  if (content.hasPrivacySignal) score += 4; else score -= 4;
  if (content.hasTermsSignal) score += 3;
  if (counts.images > 0 && counts.imagesMissingAlt / Math.max(1, counts.images) > 0.55) score -= 4;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const riskLevel = score >= 80 ? 'Low' : score >= 60 ? 'Medium' : score >= 40 ? 'High' : 'Very High / Unknown';
  const finalDecision = score >= 80 ? 'Good: safe to review and use normally' : score >= 60 ? 'Acceptable: use with normal caution' : score >= 40 ? 'Caution: review issues before trusting' : 'Avoid or verify manually before using';
  return { score, riskLevel, finalDecision };
}

function buildTopFindings({ seo, security, counts, technology, content, websiteType, pages }) {
  const out = [];
  out.push(`Detected website type: ${websiteType}.`);
  out.push(`Scanned ${pages.length} public page(s) and discovered ${counts.discoveredUniqueLinks} unique public links.`);
  out.push(`Found ${counts.internalLinks} internal links and ${counts.outgoingExternalLinks} outgoing external links.`);
  if (counts.emails || counts.phones) out.push(`Found ${counts.emails} email address(es) and ${counts.phones} phone number(s) in public HTML.`);
  else out.push('No public email or phone number was found in scanned HTML.');
  out.push(security.https ? 'HTTPS is enabled.' : 'HTTPS is not enabled or final URL is not HTTPS.');
  if (!security.headers.contentSecurityPolicy) out.push('Content-Security-Policy header is missing.');
  if (!seo.metaDescription) out.push('Meta description is missing.');
  if (!seo.sitemapFound) out.push('Sitemap was not found in common locations or robots.txt.');
  if ((technology.platformHints || []).length) out.push(`Technology hints: ${technology.platformHints.join(', ')}.`);
  return unique(out).slice(0, 12);
}

function buildAdvantages({ seo, security, counts, technology, content }) {
  const out = [];
  if (security.https) out.push('Uses HTTPS for encrypted browsing.');
  if (seo.title) out.push('Has an HTML title tag.');
  if (seo.metaDescription) out.push('Has a meta description for search snippets.');
  if (seo.h1Count > 0) out.push('Uses H1 heading structure.');
  if (seo.sitemapFound) out.push('Sitemap detected, helping search engines discover URLs.');
  if (seo.robotsTxtFound) out.push('robots.txt detected.');
  if (counts.internalLinks > 5) out.push('Internal navigation links were detected.');
  if (counts.contactLinks > 0 || counts.emails > 0 || counts.phones > 0) out.push('Contact or support signals were detected.');
  if (content.wordCount > 300) out.push('The scanned pages contain a useful amount of text content.');
  if ((technology.trackingHints || []).length) out.push('Analytics/tracking tools were detected, which may help the site measure traffic.');
  return out.length ? out : ['Basic public website response was available for analysis.'];
}

function buildWeaknesses({ seo, security, counts, technology, content }) {
  const out = [];
  if (!security.https) out.push('Final URL does not use HTTPS.');
  if (!security.headers.contentSecurityPolicy) out.push('Missing Content-Security-Policy header.');
  if (!security.headers.strictTransportSecurity && security.https) out.push('Missing HSTS header.');
  if (!security.headers.xFrameOptions) out.push('Missing X-Frame-Options header.');
  if (!security.headers.referrerPolicy) out.push('Missing Referrer-Policy header.');
  if (security.mixedContentHints) out.push('Possible mixed-content HTTP assets detected on an HTTPS page.');
  if (!seo.title) out.push('Missing page title.');
  if (!seo.metaDescription) out.push('Missing meta description.');
  if (seo.h1Count === 0) out.push('No H1 heading detected on homepage.');
  if (seo.h1Count > 1) out.push('Multiple H1 headings detected.');
  if (!seo.viewport) out.push('Viewport meta tag missing, which can affect mobile responsiveness.');
  if (!seo.sitemapFound) out.push('No sitemap detected.');
  if (!seo.robotsTxtFound) out.push('No robots.txt detected.');
  if (counts.images > 0 && counts.imagesMissingAlt > 0) out.push(`${counts.imagesMissingAlt} image(s) may be missing alt text.`);
  if (!content.hasPrivacySignal) out.push('Privacy policy signal not detected in scanned pages.');
  if (!counts.contactLinks && !counts.emails && !counts.phones) out.push('Contact information was not found in scanned public HTML.');
  return out.length ? out : ['No major weaknesses were detected from the limited public scan.'];
}

function buildRecommendations({ seo, security, counts, technology, content }) {
  const out = [];
  if (!security.https) out.push('Enable HTTPS and redirect all HTTP pages to HTTPS.');
  if (!security.headers.contentSecurityPolicy) out.push('Add a Content-Security-Policy header to reduce script injection risk.');
  if (!security.headers.strictTransportSecurity && security.https) out.push('Add Strict-Transport-Security after confirming HTTPS works everywhere.');
  if (!security.headers.xFrameOptions) out.push('Add X-Frame-Options or frame-ancestors CSP to reduce clickjacking risk.');
  if (!security.headers.referrerPolicy) out.push('Add Referrer-Policy to control what referrer data is shared.');
  if (!seo.title || seo.titleLength < 10 || seo.titleLength > 70) out.push('Improve the title tag; keep it descriptive and roughly 10-70 characters.');
  if (!seo.metaDescription || seo.metaDescriptionLength < 50 || seo.metaDescriptionLength > 180) out.push('Add or improve the meta description; aim for roughly 50-180 characters.');
  if (seo.h1Count !== 1) out.push('Use one clear H1 heading on the homepage.');
  if (!seo.sitemapFound) out.push('Create and submit a sitemap.xml file.');
  if (!seo.robotsTxtFound) out.push('Add a robots.txt file.');
  if (counts.imagesMissingAlt > 0) out.push('Add descriptive alt text to important images.');
  if (!content.hasPrivacySignal) out.push('Add a visible privacy policy page if collecting user data.');
  if (!content.hasTermsSignal) out.push('Add terms of use/service if users submit forms, create accounts, or make purchases.');
  if (!counts.contactLinks && !counts.emails && !counts.phones) out.push('Add a visible contact or support page to improve trust.');
  out.push('For real backlink counts, connect a backlink data provider such as Ahrefs, Semrush, Moz, Majestic, or verified Google Search Console.');
  return unique(out).slice(0, 18);
}

function buildChecklist({ seo, security, counts, technology, content, websiteType, home, robots, sitemap }) {
  const rows = [];
  const add = (name, pass, note) => rows.push({ name, status: pass ? 'Pass' : 'Needs review', note });
  add('Live HTML fetch', home.status >= 200 && home.status < 400, `HTTP status ${home.status || 'unknown'}`);
  add('HTTPS enabled', security.https, security.https ? 'Final URL uses HTTPS.' : 'Final URL is not HTTPS.');
  add('Content-Security-Policy', !!security.headers.contentSecurityPolicy, security.headers.contentSecurityPolicy ? 'Header present.' : 'Header missing.');
  add('HSTS', !!security.headers.strictTransportSecurity || !security.https, security.https ? (security.headers.strictTransportSecurity ? 'Header present.' : 'Header missing.') : 'Not applicable without HTTPS.');
  add('X-Frame-Options', !!security.headers.xFrameOptions, security.headers.xFrameOptions ? 'Header present.' : 'Header missing.');
  add('X-Content-Type-Options', !!security.headers.xContentTypeOptions, security.headers.xContentTypeOptions ? 'Header present.' : 'Header missing.');
  add('Referrer-Policy', !!security.headers.referrerPolicy, security.headers.referrerPolicy ? 'Header present.' : 'Header missing.');
  add('Permissions-Policy', !!security.headers.permissionsPolicy, security.headers.permissionsPolicy ? 'Header present.' : 'Header missing.');
  add('Mixed content', !security.mixedContentHints, security.mixedContentHints ? 'HTTP assets detected on HTTPS page.' : 'No obvious mixed content found.');
  add('Title tag', !!seo.title, seo.title ? `${seo.titleLength} characters.` : 'Missing.');
  add('Meta description', !!seo.metaDescription, seo.metaDescription ? `${seo.metaDescriptionLength} characters.` : 'Missing.');
  add('One H1 heading', seo.h1Count === 1, `${seo.h1Count} H1 heading(s).`);
  add('Viewport meta', !!seo.viewport, seo.viewport ? 'Mobile viewport present.' : 'Missing.');
  add('Charset meta', !!seo.charset, seo.charset ? 'Charset present.' : 'Missing.');
  add('Open Graph', seo.openGraphCount > 0, `${seo.openGraphCount} Open Graph tag(s).`);
  add('Twitter cards', seo.twitterCardCount > 0, `${seo.twitterCardCount} Twitter/X card tag(s).`);
  add('Schema data', seo.schemaCount > 0, `${seo.schemaCount} schema signal(s).`);
  add('robots.txt', !!robots.ok, robots.ok ? `Found, status ${robots.status}.` : 'Not found.');
  add('sitemap.xml', !!sitemap.found, sitemap.found ? `Found ${sitemap.urlCount || 0} URL(s).` : 'Not found.');
  add('Internal links', counts.internalLinks > 0, `${counts.internalLinks} internal link(s).`);
  add('Outgoing links', counts.outgoingExternalLinks > 0, `${counts.outgoingExternalLinks} outgoing external link(s).`);
  add('Contact signals', counts.contactLinks > 0 || counts.emails > 0 || counts.phones > 0, `${counts.contactLinks} contact link(s), ${counts.emails} email(s), ${counts.phones} phone(s).`);
  add('Legal/trust pages', counts.legalLinks > 0 || content.hasPrivacySignal || content.hasTermsSignal, `${counts.legalLinks} legal link(s).`);
  add('Image alt coverage', counts.images === 0 || counts.imagesMissingAlt < counts.images, `${counts.imagesMissingAlt}/${counts.images} image(s) missing alt.`);
  add('Forms detected', counts.forms > 0, `${counts.forms} form(s) detected.`);
  add('Technology hints', (technology.platformHints || []).length > 0, (technology.platformHints || []).join(', ') || 'None detected.');
  add('Analytics/ads hints', (technology.trackingHints || []).length > 0, (technology.trackingHints || []).join(', ') || 'None detected.');
  add('Payment hints', (technology.paymentHints || []).length > 0, (technology.paymentHints || []).join(', ') || 'None detected.');
  add('Content volume', content.wordCount > 250, `${content.wordCount} words detected.`);
  add('Detected website type', websiteType !== 'General website', websiteType);
  return rows;
}

function errorReport(url, title, detail) {
  return {
    ok: false,
    mode: 'Analysis error',
    analyzedUrl: String(url || ''),
    scannedAt: new Date().toISOString(),
    errorTitle: title,
    errorDetail: detail,
    summary: {
      score: 0,
      riskLevel: 'Unknown',
      finalDecision: 'Analysis failed. The backend is connected, but this URL could not be scanned.',
      websiteType: 'Unknown',
      purpose: 'Not available because live public HTML could not be fetched.',
      executiveSummary: `${title}: ${detail}`,
      userActions: [],
      topFindings: [detail]
    },
    counts: emptyCounts(),
    recommendations: [
      'First test https://example.com to confirm the tool works.',
      'If example.com works but this website fails, the target website may be blocking server-side scanners.',
      'Try the homepage URL instead of a deep page URL.',
      'Some JavaScript-heavy sites expose very little public HTML to scanners.'
    ],
    limitations: standardLimitations()
  };
}

function emptyCounts() {
  return { scannedPages: 0, discoveredUniqueLinks: 0, internalLinks: 0, outgoingExternalLinks: 0, socialLinks: 0, contactLinks: 0, legalLinks: 0, resourceLinks: 0, feedLinks: 0, emails: 0, phones: 0, addressHints: 0, organizationHints: 0, forms: 0, inputs: 0, loginForms: 0, uploadForms: 0, images: 0, imagesMissingAlt: 0, scripts: 0, stylesheets: 0, sitemapUrls: 0 };
}

function standardLimitations() {
  return [
    'The scan reads public HTML only. It does not log in, click buttons, submit forms, bypass protection, or access private data.',
    'Counts are from the homepage plus a few important internal pages, not a guaranteed full crawl of every page on the domain.',
    'Real backlinks require external databases or verified Google Search Console; they cannot be counted from one website HTML.',
    'JavaScript-rendered websites may show less information to server-side scanners than to a normal browser.',
    'Websites with anti-bot protection may block the scanner.'
  ];
}

function visibleText(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
       .replace(/<style[\s\S]*?<\/style>/gi, ' ')
       .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
       .replace(/<!--([\s\S]*?)-->/g, ' ')
       .replace(/<br\s*\/?>/gi, '\n')
       .replace(/<\/p>|<\/div>|<\/li>|<\/h\d>/gi, '\n')
       .replace(/<[^>]+>/g, ' ');
  return cleanSpaces(decodeHtml(s));
}

function stripTags(s) { return decodeHtml(String(s || '').replace(/<[^>]+>/g, ' ')); }
function cleanSpaces(s) { return safeText(s).replace(/\s+/g, ' ').trim(); }
function safeText(s) { return decodeHtml(String(s || '')).replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); }
function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function firstMatch(s, re) { const m = re.exec(String(s || '')); return m ? m[1] : ''; }
function countMatches(s, re) { return (String(s || '').match(re) || []).length; }
function unique(arr) { return [...new Set((arr || []).map(x => safeText(x)).filter(Boolean))]; }
function addIf(arr, condition, value) { if (condition) arr.push(value); }

function getAttr(attrs, name) {
  const re = new RegExp("\\b" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i");
  const m = re.exec(attrs || '');
  if (m) return decodeHtml(m[2]);
  const re2 = new RegExp('\\b' + name + '\\s*=\\s*([^\\s>]+)', 'i');
  const m2 = re2.exec(attrs || '');
  return m2 ? decodeHtml(m2[1]) : '';
}

function attrFromTag(html, tagRe, attr) {
  const m = tagRe.exec(String(html || ''));
  return m ? getAttr(m[0], attr) : '';
}

function metaContent(html, name) {
  const re = new RegExp("<meta\\b[^>]*(?:name|property)=[\"']" + escapeRegExp(name) + "[\"'][^>]*>", "i");
  return attrFromTag(html, re, 'content');
}
function metaProperty(html, prop) { return metaContent(html, prop); }
function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function extractTags(html, tag) {
  const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
  const out = [];
  let m;
  while ((m = re.exec(String(html || ''))) && out.length < 30) {
    const t = cleanSpaces(stripTags(m[1])).slice(0, 180);
    if (t) out.push(t);
  }
  return out;
}

function countImagesMissingAlt(html) {
  const imgs = String(html || '').match(/<img\b[^>]*>/gi) || [];
  return imgs.filter(tag => !/\balt\s*=\s*(["']).*?\1/i.test(tag)).length;
}

function keywordFrequency(text) {
  const stop = new Set('the a an and or but in on at to for from with by of is are was were be been this that these those it its as into about your you we our us they their home contact privacy terms more all can will not have has had do does new use using get page website site online official'.split(' '));
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w) && !/^\d+$/.test(w));
  const map = new Map();
  for (const w of words) map.set(w, (map.get(w) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([word, count]) => `${word} (${count})`);
}

function isSocialUrl(url) {
  return /facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com|pinterest\.com|reddit\.com|github\.com|discord\.gg|telegram\.me|t\.me|wa\.me|whatsapp\.com/i.test(url || '');
}
