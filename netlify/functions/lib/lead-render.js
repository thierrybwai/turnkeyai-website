// lead-render.js — builds the lead email + PDF, with optional per-client co-branding.
// Co-branding rule (matches Mael's spec): if the lead gave a website and we can pull
// a usable logo + brand colour, the plan/email wear the CLIENT's logo (in a white chip)
// and their brand colour as the accent. If anything is missing or unsafe, we fall back
// to TurnkeyAI branding. Every function is defensive and never throws on bad input.

import zlib from 'node:zlib';

const TK_ACCENT = '#0071e3';

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── BRAND ASSETS ─────────────────────────────────────────────
// Returns { logoDataUri: string|null, accent: string|null }. Never throws.
export async function fetchBrandAssets(website, html) {
  const out = { logoDataUri: null, accent: null };
  if (!website) return out;
  try {
    const base = website.startsWith('http') ? website : 'https://' + website;
    const origin = new URL(base).origin;
    const pageHtml = html || (await safeText(base));
    if (!pageHtml) return out;

    // 1) brand accent from a declared theme-color (most reliable signal)
    const tc = pageHtml.match(/<meta[^>]+name=["']theme-color["'][^>]*content=["'](#[0-9a-fA-F]{3,6})["']/i);
    if (tc && isUsableAccent(tc[1])) out.accent = normHex(tc[1]);

    // 2) logo candidates, best first: apple-touch-icon, big rel=icon, og:image, img[logo]
    const cands = [];
    const push = (u) => { const a = absUrl(u, origin); if (a) cands.push(a); };
    for (const m of pageHtml.matchAll(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["']/gi)) push(m[1]);
    // rel=icon with a sizes hint -> prefer larger
    const icons = [...pageHtml.matchAll(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi)]
      .map(t => {
        const href = (t[0].match(/href=["']([^"']+)["']/i) || [])[1] || '';
        const sz = parseInt((t[0].match(/sizes=["'](\d+)/i) || [])[1]
          || (href.match(/(\d{2,4})\.(?:png|jpe?g|ico|webp|gif)(?:[?#]|$)/i) || [])[1] || '0', 10);
        return { href, size: sz };
      }).filter(i => i.href).sort((a, b) => b.size - a.size);
    icons.forEach(i => push(i.href));
    const og = pageHtml.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    if (og) push(og[1]);
    for (const m of pageHtml.matchAll(/<img[^>]+(?:src|class|alt)=["'][^"']*logo[^"']*["'][^>]*>/gi)) {
      const s = m[0].match(/src=["']([^"']+)["']/i); if (s) push(s[1]);
    }

    // 3) download the first candidate that is a real, reasonably-sized image
    for (const url of dedupe(cands).slice(0, 6)) {
      const img = await safeImage(url);
      if (!img) continue;
      out.logoDataUri = `data:${img.type};base64,${img.buf.toString('base64')}`;
      // 4) if we still have no accent and it's a PNG, sample its dominant vivid colour
      if (!out.accent && img.type === 'image/png') {
        const c = dominantPngColor(img.buf);
        if (c && isUsableAccent(c)) out.accent = c;
      }
      break;
    }
  } catch (_) { /* fall back to TurnkeyAI */ }
  return out;
}

function dedupe(a) { return [...new Set(a)]; }
function absUrl(u, origin) {
  if (!u) return null; u = u.trim();
  if (u.startsWith('data:')) return null;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('http')) return u;
  if (u.startsWith('/')) return origin + u;
  return origin + '/' + u;
}
async function safeText(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 TurnkeyAI' }, redirect: 'follow' });
    if (!r.ok) return null; return await r.text();
  } catch { return null; }
}
async function safeImage(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 TurnkeyAI' }, redirect: 'follow' });
    if (!r.ok) return null;
    let type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ab = await r.arrayBuffer(); const buf = Buffer.from(ab);
    if (buf.length < 80 || buf.length > 300000) return null; // too tiny / too heavy
    if (!type.startsWith('image/')) {
      if (buf[0] === 0x89 && buf[1] === 0x50) type = 'image/png';
      else if (buf[0] === 0xff && buf[1] === 0xd8) type = 'image/jpeg';
      else if (buf.slice(0, 4).toString() === 'RIFF') type = 'image/webp';
      else if (buf.slice(0, 4).toString() === '<svg' || buf.slice(0, 5).toString() === '<?xml') type = 'image/svg+xml';
      else return null;
    }
    return { buf, type };
  } catch { return null; }
}

// Accent must be vivid enough and mid-luminance so it reads as an accent on white.
function isUsableAccent(hex) {
  const c = hexToRgb(hex); if (!c) return false;
  const { r, g, b } = c;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum > 0.82 || lum < 0.06) return false;              // not near-white / near-black
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  return sat > 0.18;                                        // must have some colour
}
function normHex(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); return '#' + h.toLowerCase(); }
function hexToRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h.length === 4 ? '#' + h.slice(1).split('').map(x => x + x).join('') : h); if (!m) return null; const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }

// Pure-JS dominant vivid colour from an 8-bit PNG (color type 2 or 6, no interlace). Else null.
export function dominantPngColor(buf) {
  try {
    if (!(buf[0] === 0x89 && buf[1] === 0x50)) return null;
    let p = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
    const idat = [];
    while (p < buf.length) {
      const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8); const dataStart = p + 8;
      if (type === 'IHDR') {
        width = buf.readUInt32BE(dataStart); height = buf.readUInt32BE(dataStart + 4);
        bitDepth = buf[dataStart + 8]; colorType = buf[dataStart + 9]; interlace = buf[dataStart + 12];
      } else if (type === 'IDAT') idat.push(buf.slice(dataStart, dataStart + len));
      else if (type === 'IEND') break;
      p = dataStart + len + 4;
    }
    if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || width * height === 0) return null;
    const channels = colorType === 6 ? 4 : 3;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const counts = new Map();
    const step = Math.max(1, Math.floor(height / 120));
    const prev = Buffer.alloc(stride);
    let row = Buffer.alloc(stride);
    let rp = 0;
    for (let y = 0; y < height; y++) {
      const filter = raw[rp++]; const line = raw.slice(rp, rp + stride); rp += stride;
      row = unfilter(filter, line, prev, channels, stride);
      prev.set(row);
      if (y % step) continue;
      for (let x = 0; x < width; x += step) {
        const o = x * channels;
        const r = row[o], g = row[o + 1], b = row[o + 2], a = channels === 4 ? row[o + 3] : 255;
        if (a < 200) continue;
        if (r > 235 && g > 235 && b > 235) continue;
        if (r < 22 && g < 22 && b < 22) continue;
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    let best = -1, bestN = 0;
    for (const [k, n] of counts) if (n > bestN) { bestN = n; best = k; }
    if (best < 0) return null;
    const r = ((best >> 8) & 15) * 17, g = ((best >> 4) & 15) * 17, b = (best & 15) * 17;
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}
function unfilter(filter, line, prev, ch, stride) {
  const out = Buffer.from(line);
  for (let i = 0; i < stride; i++) {
    const a = i >= ch ? out[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
    let v = out[i];
    if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
    else if (filter === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
    out[i] = v & 255;
  }
  return out;
}

// ── PACKAGE MAP ──────────────────────────────────────────────
function packageInfo(rec) {
  const isMac = /mac\s*mini|mac/i.test(rec || '');
  return isMac
    ? { name: 'Mac Mini', price: '$5,999 AUD · one-time', blurb: 'An Apple Mac Mini M4 installed on-site in Gold Coast or Brisbane, yours to keep, running five workflows. 30 days of support included.' }
    : { name: 'Cloud', price: '$2,999 AUD · one-time', blurb: 'Three workflows on a dedicated cloud server we manage, with no hardware to handle and 12 months hosting included. You can move to a Mac Mini you keep later.' };
}

// ── PDF ──────────────────────────────────────────────────────
// brand = { logoDataUri, accent } | null
export function buildPdfHtml({ businessName, industry, spin, brand }) {
  const ACCENT = (brand && brand.accent) || TK_ACCENT;
  const logo = brand && brand.logoDataUri;
  const biz = businessName || 'your business';
  const s = spin || {};
  const obs = Array.isArray(s.situation_observations) ? s.situation_observations.slice(0, 3) : [];
  const probs = Array.isArray(s.problems) ? s.problems.slice(0, 3) : [];
  const wfs = Array.isArray(s.workflows) ? s.workflows.slice(0, 3) : [];
  const imp = s.implication || {};
  const pkg = packageInfo(s.recommended_package);
  const icons = ['🔧', '💬', '📊', '⚙️', '📨'];

  const chip = (h) => logo
    ? `<span style="display:inline-flex;align-items:center;background:#fff;border:1px solid var(--line);border-radius:${h > 30 ? 13 : 8}px;padding:${h > 30 ? '15px 22px' : '5px 9px'}"><img src="${logo}" style="height:${h}px;width:auto;max-width:${h > 30 ? 200 : 120}px;display:block" alt="${esc(biz)}"></span>`
    : '';
  const hdr = (pageNo) => `<div class="lockup"${logo ? ' style="border-bottom:2px solid var(--blue);padding-bottom:11px"' : ''}>
      <div class="brand"><span class="dot"></span>TurnkeyAI</div>
      <div class="prep" style="gap:9px"><span class="lbl">Prepared for${logo ? '' : '<br>' + esc(biz)}</span>${logo ? chip(16) : ''}</div>
    </div>`;
  const foot = (n) => `<div class="foot"><span class="cli">${esc(biz)}</span><span>${n}</span></div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AI Deployment Plan · ${esc(biz)}</title>
<style>
  @page{size:A4;margin:0}*{box-sizing:border-box;margin:0;padding:0}
  :root{--ink:#1d1d1f;--sub:#6e6e73;--faint:#86868b;--blue:${ACCENT};--green:#1d9d4f;--line:#e7e7ec;--ink2:#0a0a0a}
  body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact;line-height:1.5}
  .page{width:210mm;min-height:297mm;padding:24mm 22mm;position:relative;page-break-after:always;background:#fff}
  .page:last-child{page-break-after:auto}
  .lockup{display:flex;align-items:center;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:600;letter-spacing:-.01em}
  .brand .dot{width:9px;height:9px;border-radius:50%;background:var(--blue)}
  .prep{display:flex;align-items:center;gap:11px}
  .prep .lbl{font-size:9.5px;font-weight:680;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);text-align:right;line-height:1.3}
  .eyebrow{font-size:11px;font-weight:680;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
  .foot{position:absolute;bottom:14mm;left:22mm;right:22mm;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--faint);border-top:1px solid var(--line);padding-top:8px}
  h1{font-size:40px;line-height:1.08;letter-spacing:-.025em;font-weight:650}
  h2{font-size:13px;font-weight:680;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);margin-bottom:14px}
  h3{font-size:17px;font-weight:640;letter-spacing:-.01em}
  p{font-size:14.5px;color:#33333a;line-height:1.6}
  .lede{font-size:18px;color:var(--sub);line-height:1.5}
  .cover{background:var(--ink2);color:#fff;display:flex;flex-direction:column}
  .cover .brand,.cover h1{color:#fff}.cover .eyebrow,.cover .prep .lbl{color:#8a8a90}.cover h1{margin:18px 0 16px}
  .cover .sub{font-size:19px;color:rgba(255,255,255,.74);line-height:1.45;max-width:150mm}
  .cover .prepbig{margin-top:38px;padding-top:22px;border-top:1px solid rgba(255,255,255,.14);display:flex;align-items:center;gap:18px}
  .cover .prepbig .l{font-size:10px;font-weight:680;letter-spacing:.1em;text-transform:uppercase;color:#8a8a90}
  .cover .meta{margin-top:auto;display:flex;gap:32px;border-top:1px solid rgba(255,255,255,.14);padding-top:20px;font-size:13px;color:rgba(255,255,255,.7)}
  .cover .meta b{color:#fff;display:block;font-size:15px;margin-bottom:2px}
  .cover .foot{color:rgba(255,255,255,.5);border-top-color:rgba(255,255,255,.12)}
  .ob{display:flex;gap:13px;padding:12px 0;border-bottom:1px solid var(--line)}.ob:last-child{border-bottom:none}
  .ob .n{flex:none;width:22px;height:22px;border-radius:50%;background:#f1f4fb;color:var(--blue);font-size:12px;font-weight:680;display:flex;align-items:center;justify-content:center;margin-top:1px}
  .ob p{font-size:14.5px;color:var(--ink)}
  .prob{border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:13px}.prob h3{margin-bottom:5px}.prob p{font-size:13.5px;color:var(--sub)}
  .cost{background:#fff7f5;border:1px solid #ffd9cf;border-radius:18px;padding:24px 26px;margin:6px 0 18px}
  .cost .big{font-size:25px;font-weight:660;letter-spacing:-.02em;color:#c0392b;margin-bottom:14px}
  .cost .grid{display:flex;border-top:1px solid #ffd9cf;border-bottom:1px solid #ffd9cf;margin-bottom:14px}
  .cost .cell{flex:1;padding:14px 4px;text-align:center;border-right:1px solid #ffd9cf}.cost .cell:last-child{border-right:none}
  .cost .cell .v{font-size:19px;font-weight:680;letter-spacing:-.02em;color:var(--ink)}.cost .cell .l{font-size:11px;color:var(--sub);margin-top:3px}
  .cost p{font-size:13.5px;color:#6b4a44}
  .wf{display:flex;gap:16px;align-items:flex-start;padding:16px 0;border-bottom:1px solid var(--line)}.wf:last-child{border-bottom:none}
  .wf .ic{flex:none;width:40px;height:40px;border-radius:11px;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px}
  .wf .body{flex:1}.wf h3{font-size:16px;margin-bottom:3px}.wf p{font-size:13.5px;color:var(--sub)}
  .wf .save{flex:none;font-size:12.5px;font-weight:680;color:var(--green);background:#e9f8ef;padding:5px 11px;border-radius:99px;white-space:nowrap;margin-top:2px}
  .rec{background:#f6f7f9;border:1px solid #e7e9ee;border-radius:18px;padding:24px 26px;margin:6px 0 18px}
  .rec .tier{display:flex;align-items:baseline;gap:12px;margin-bottom:6px}.rec .tier .name{font-size:22px;font-weight:660;letter-spacing:-.02em}.rec .tier .price{font-size:15px;color:var(--blue);font-weight:600}
  .rec .stats{display:flex;gap:28px;margin-top:16px;border-top:1px solid #e7e9ee;padding-top:16px}.rec .stats .v{font-size:20px;font-weight:680;letter-spacing:-.02em}.rec .stats .l{font-size:11px;color:var(--sub)}
  .cta{background:var(--ink2);color:#fff;border-radius:18px;padding:26px 28px;margin-top:8px}.cta h3{color:#fff;font-size:20px;margin-bottom:8px}.cta p{color:rgba(255,255,255,.74);font-size:14.5px;margin-bottom:16px}
  .cta .btn{display:inline-block;background:#fff;color:#1d1d1f;font-weight:600;font-size:14px;padding:12px 22px;border-radius:100px;text-decoration:none}
  .disc{font-size:11px;color:var(--faint);margin-top:18px;line-height:1.6}
</style></head><body>

  <section class="page cover">
    <div class="lockup"><div class="brand"><span class="dot"></span>TurnkeyAI</div><div class="prep"><span class="lbl">Done-for-you AI<br>for Australian SMEs</span></div></div>
    <div style="margin-top:34mm">
      <p class="eyebrow">AI deployment plan</p>
      <h1>${esc(s.headline || `${biz}, your admin on autopilot.`)}</h1>
      <p class="sub">${esc(s.subheadline || 'A done-for-you AI agent built for your business, live in 7 business days.')}</p>
    </div>
    ${logo ? `<div class="prepbig"><span class="l">Prepared exclusively for</span>${chip(42)}</div>` : ''}
    <div class="meta"><div><b>${esc(prettyInd(industry))} · ${esc(biz)}</b>Based on your live website</div><div><b>${today()}</b>Prepared by TurnkeyAI</div></div>
    <div class="foot"><span>TurnkeyAI · Done-for-you AI for Australian SMEs</span><span>Personalized plan</span></div>
  </section>

  <section class="page">
    ${hdr(2)}
    <div style="margin-top:18mm">
      <h2>Where you are today</h2>
      <p class="lede">${esc(s.situation_intro || `We looked at ${biz} and where time goes in your day to day.`)}</p>
      <div style="margin-top:24px">${obs.map((o, i) => `<div class="ob"><span class="n">${i + 1}</span><p>${esc(o)}</p></div>`).join('')}</div>
    </div>
    ${foot(2)}
  </section>

  <section class="page">
    ${hdr(3)}
    <div style="margin-top:18mm">
      <h2>Where time and money leak</h2>
      ${probs.map(pr => `<div class="prob"><h3>${esc(pr.title)}</h3><p>${esc(pr.detail)}</p></div>`).join('')}
      <h2 style="margin-top:30px">What that costs you</h2>
      <div class="cost">
        <div class="big">${esc(imp.headline || 'Time and money are leaking every week.')}</div>
        <div class="grid">
          <div class="cell"><div class="v">${esc(imp.annual_cost_aud || '—')}</div><div class="l">per year</div></div>
          <div class="cell"><div class="v">${esc(imp.hours_per_week || '—')}</div><div class="l">per week</div></div>
          <div class="cell"><div class="v">${esc(imp.fte_equivalent || '—')}</div><div class="l">FTE equivalent</div></div>
        </div>
        <p>${esc(imp.narrative || '')} These are starting ranges, not promises. We confirm the real figure with you on the call.</p>
      </div>
    </div>
    ${foot(3)}
  </section>

  <section class="page">
    ${hdr(4)}
    <div style="margin-top:18mm">
      <h2>The workflows we'd build first</h2>
      <p style="margin-bottom:6px;color:var(--sub)">Each runs on your existing tools and is controlled in plain English over Slack or Telegram. Sensitive actions wait for your one-tap approval.</p>
      ${wfs.map((w, i) => `<div class="wf"><div class="ic">${icons[i] || '⚙️'}</div><div class="body"><h3>${esc(w.name)}</h3><p>${esc(w.what)}</p></div><span class="save">${esc(w.saves || '')}</span></div>`).join('')}
    </div>
    ${foot(4)}
  </section>

  <section class="page">
    ${hdr(5)}
    <div style="margin-top:18mm">
      <h2>What we'd recommend</h2>
      <div class="rec">
        <div class="tier"><span class="name">${esc(pkg.name)}</span><span class="price">${esc(pkg.price)}</span></div>
        <p>${esc(s.package_rationale || pkg.blurb)}</p>
        <div class="stats">
          <div><div class="v">${esc(s.year_one_roi || '—')}</div><div class="l">estimated year-1 return</div></div>
          <div><div class="v">${esc(String(s.break_even_weeks || '3-5'))} weeks</div><div class="l">to break even</div></div>
          <div><div class="v">7 business days</div><div class="l">to live, guaranteed</div></div>
        </div>
      </div>
      <h2 style="margin-top:28px">Your next step</h2>
      <div class="cta">
        <h3>Book 30 minutes to confirm and lock it in.</h3>
        <p>${esc(s.next_step || `We confirm the details, lock the workflows we build first for ${biz}, and answer anything open. No pressure, no obligation.`)}</p>
        <a class="btn" href="https://calendly.com/start-tkai/30min">Book your 30-minute call →</a>
      </div>
      <p class="disc">Figures in this plan are estimates based on typical workloads for your industry and your public information, shown as ranges on purpose. They are a starting point we confirm together, not a contractual promise. Live in 7 business days, or you don't pay.${logo ? ` The ${esc(biz)} logo is shown to indicate this plan was prepared for you; TurnkeyAI Pty Ltd is the author.` : ''} start@tkai.com.au · turnkeyai.com.au</p>
    </div>
    ${foot(5)}
  </section>
</body></html>`;
}

// ── EMAIL ────────────────────────────────────────────────────
export function buildEmail({ firstName, businessName, industry, packageInterest, hasPdf, brand }) {
  const ACCENT = (brand && brand.accent) || TK_ACCENT;
  const ACCENT_SOFT = tint(ACCENT, 0.62);
  const logo = brand && brand.logoDataUri;
  const biz = businessName || 'your business';
  const recap = [businessName && `Business: ${businessName}`, industry && `Industry: ${prettyInd(industry)}`, packageInterest && `Package: ${packageInterest}`].filter(Boolean).join(' · ');

  const text = `Hi ${firstName},

Got your brief. Your AI agent is on our build queue and we've started on our end.${hasPdf ? `\n\nAttached: a personalized deployment plan for ${biz}. It walks through what we'd build, the hours it could save you, and the package we'd recommend.` : ''}

Live in 7 business days, or you don't pay. 50+ Australian SMEs deployed, rated 5.0 on Google.

When you're ready, grab a 30 minute call and we'll walk through it together. No rush. We'll also reach out within 2 business hours either way:
https://calendly.com/start-tkai/30min

You don't set anything up. TurnkeyAI is done for you: we build it, configure it, and install it. No code, no new accounts, no IT project on your side.

${recap ? recap + '\n\n' : ''}Talk soon,
The TurnkeyAI team

You're receiving this because you submitted a brief on turnkeyai.com.au. Reply STOP and we won't email you again.`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${hasPdf ? 'Your personalized AI deployment plan' : "We've started"}, ${esc(firstName)}</title></head>
<body style="margin:0;padding:0;background:#f2f2f4;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;line-height:1.55;">
  <div style="display:none;max-height:0;overflow:hidden;color:#f2f2f4;font-size:1px;">${hasPdf ? `Your personalized AI deployment plan for ${esc(biz)} is attached. Live in 7 days, guaranteed.` : 'Your AI build has started.'}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f2f4;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
      <tr><td style="background:#0a0a0a;border-radius:20px 20px 0 0;padding:26px 40px;"><table role="presentation" width="100%"><tr>
        <td align="left" style="font-size:18px;font-weight:600;letter-spacing:-0.01em;color:#fff;"><span style="display:inline-block;width:8px;height:8px;background:${ACCENT};border-radius:50%;margin-right:10px;vertical-align:middle;"></span>TurnkeyAI</td>
        <td align="right">${logo ? `<span style="display:inline-block;background:#fff;border-radius:8px;padding:6px 10px;"><img src="${logo}" alt="${esc(biz)}" style="height:18px;width:auto;max-width:120px;vertical-align:middle;display:inline-block;"></span>` : `<span style="font-size:11px;color:#86868b;letter-spacing:0.05em;text-transform:uppercase;font-weight:600;">${hasPdf ? 'Plan attached' : 'Build started'}</span>`}</td>
      </tr></table></td></tr>
      <tr><td style="background:#fff;padding:54px 40px 26px;">
        <p style="margin:0 0 14px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${ACCENT};font-weight:600;">${hasPdf ? 'Personalized plan · attached' : 'Brief received'}</p>
        <h1 style="margin:0 0 20px;font-size:34px;line-height:1.12;letter-spacing:-0.02em;font-weight:600;">Thanks, ${esc(firstName)}.</h1>
        <p style="margin:0 0 12px;font-size:17px;">Your AI agent is on our build queue. We've started on our end.</p>
        ${hasPdf ? `<p style="margin:0 0 12px;font-size:17px;">Attached is a <strong>personalized deployment plan</strong> for ${esc(biz)}. It walks through what we'd build, the hours it could save you, and the package we'd recommend. Worth 5 minutes before we talk.</p>` : ''}
        <p style="margin:0;font-size:17px;">When you're ready, grab a 30 minute call below and we'll walk through it together. No rush. We'll also reach out within 2 business hours either way.</p>
      </td></tr>
      <tr><td style="background:#fff;padding:0 40px 26px;"><table role="presentation" width="100%" style="background:${ACCENT_SOFT};border:1px solid ${tint(ACCENT,0.5)};border-radius:14px;"><tr><td style="padding:18px 22px;font-size:14.5px;line-height:1.6;">
        <span style="color:#1d9d4f;font-weight:600;">✓ Live in 7 business days, or you don't pay.</span><br>50+ Australian SMEs deployed, rated 5.0 on Google.
      </td></tr></table></td></tr>
      <tr><td style="background:#fff;padding:0 40px 32px;"><table role="presentation" width="100%" style="background:#0a0a0a;border-radius:18px;"><tr><td style="padding:32px 36px;">
        <p style="margin:0 0 10px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${tint(ACCENT,0.35)};font-weight:600;">Whenever it suits you</p>
        <h2 style="margin:0 0 12px;font-size:23px;line-height:1.2;letter-spacing:-0.02em;font-weight:600;color:#fff;">Walk through your plan with us.</h2>
        <p style="margin:0 0 22px;font-size:15px;color:rgba(255,255,255,0.72);">Thirty minutes to answer your questions and confirm the workflows we'd build first. Pick a time that works for you, no back and forth.</p>
        <a href="https://calendly.com/start-tkai/30min" style="display:inline-block;background:#fff;color:#1d1d1f;font-weight:500;font-size:15px;padding:14px 24px;border-radius:100px;text-decoration:none;">See a time that suits you →</a>
      </td></tr></table></td></tr>
      ${recap ? `<tr><td style="background:#fff;padding:0 40px 32px;"><table role="presentation" width="100%" style="background:#f5f5f7;border-radius:14px;"><tr><td style="padding:18px 22px;font-size:14px;color:#424245;"><span style="display:inline-block;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#86868b;font-weight:600;margin-bottom:6px;">Your brief</span><br>${esc(recap)}</td></tr></table></td></tr>` : ''}
      <tr><td style="background:#fff;padding:0 40px 36px;">
        <p style="margin:0 0 16px;font-size:15.5px;line-height:1.6;">You don't set anything up. TurnkeyAI is done for you: we build it, configure it, and install it. No code, no new accounts, no IT project on your side.</p>
      </td></tr>
      <tr><td style="background:#fff;border-radius:0 0 20px 20px;padding:22px 40px 34px;border-top:1px solid #f0f0f2;">
        <p style="margin:0;font-size:14px;">Talk soon,<br><strong>The TurnkeyAI team</strong></p>
        <p style="margin:14px 0 0;font-size:11px;color:#b0b0b5;">You're receiving this because you submitted a brief on turnkeyai.com.au. Reply STOP and we won't email you again.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { html, text };
}

// soft tint of a hex toward white (amount 0..1 = how much white)
function tint(hex, amt) {
  const c = hexToRgb(hex) || { r: 0, g: 113, b: 227 };
  const m = (v) => Math.round(v + (255 - v) * amt);
  return '#' + [m(c.r), m(c.g), m(c.b)].map(v => v.toString(16).padStart(2, '0')).join('');
}
function prettyInd(slug) {
  if (!slug) return 'Your business';
  return String(slug).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function today() {
  // Stable, no timezone surprises: build a readable date.
  const d = new Date();
  const mo = ['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()];
  return `${d.getDate()} ${mo} ${d.getFullYear()}`;
}
