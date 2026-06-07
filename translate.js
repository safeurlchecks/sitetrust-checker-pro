const MAX_TEXT = 5500;
const MAX_CHUNKS = 10;
const CHUNK_SIZE = 520;
const ALLOWED_LANG = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

export async function onRequestOptions() { return json({ ok: true }, 200); }
export async function onRequestGet() { return json({ ok: true, message: 'Translate API is running. Send POST JSON: {"text":"Hello","target":"bn"}' }, 200); }

export async function onRequestPost({ request }) {
  try {
    const body = await request.json().catch(() => ({}));
    const text = String(body.text || '').trim().slice(0, MAX_TEXT);
    const target = String(body.target || 'bn').trim();
    if (!text) return json({ ok: false, error: 'Text is required.' }, 400);
    if (!ALLOWED_LANG.test(target)) return json({ ok: false, error: 'Invalid target language code.' }, 400);
    if (target.toLowerCase() === 'en') return json({ ok: true, translatedText: text, target, provider: 'No translation needed' }, 200);

    const chunks = chunkText(text, CHUNK_SIZE).slice(0, MAX_CHUNKS);
    const translated = [];
    for (const chunk of chunks) {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|${encodeURIComponent(target)}`;
      const res = await fetch(url, { headers: { 'accept': 'application/json', 'user-agent': 'SiteTrustCheckerPro/3.0' } });
      const data = await res.json().catch(() => null);
      const t = data?.responseData?.translatedText;
      if (!res.ok || !t) throw new Error('Translation service did not return translated text.');
      translated.push(decodeHtml(t));
    }
    return json({ ok: true, target, translatedText: translated.join('\n\n'), provider: 'MyMemory public translation endpoint', truncated: text.length >= MAX_TEXT }, 200);
  } catch (error) {
    return json({ ok: false, error: error.message || 'Translation failed.' }, 500);
  }
}
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
function chunkText(text, size) {
  const lines = text.split(/\n+/);
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if ((current + '\n' + line).length > size && current) {
      chunks.push(current.trim());
      current = line;
    } else current += (current ? '\n' : '') + line;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
function decodeHtml(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
