// Unsubscribe + manual-stop endpoint (rewritten from /unsubscribe).
// GET renders a confirmation page with a POST button: link prefetchers and email
// scanners can never unsubscribe someone by merely fetching the URL.
// POST executes. RFC 8058 one-click (List-Unsubscribe-Post) arrives as a POST too.
// Actions: default = lead unsubscribe (global suppression, SMS + email);
//          a=stop  = team-only "stop nurture for this lead" (no suppression).

import {
  nurtureStore, suppress, hmacToken, safeEqual, normEmail, leadKeyFor, logOpsEvent, HMAC_READY,
} from './lib/nurture.js';

export default async (req) => {
  // Fail-closed: without a real secret, no token may ever be accepted (an empty-key
  // HMAC would let anyone unsubscribe or stop any lead by computing the token).
  if (!HMAC_READY) {
    console.error('nurture-unsub: NURTURE_HMAC_SECRET absent, refusing (fail-closed)');
    return page('Temporarily unavailable.', 'Reply to any of our emails and we will take care of it manually.', null, 503);
  }
  const url = new URL(req.url);
  const action = url.searchParams.get('a') === 'stop' ? 'stop' : 'unsub';
  const e = url.searchParams.get('e') || '';
  const t = url.searchParams.get('t') || '';

  let email = '';
  try { email = normEmail(Buffer.from(e, 'base64url').toString('utf8')); } catch { /* fallthrough */ }
  const valid = email && safeEqual(t, hmacToken(`${action}:${email}`));

  if (!valid) return page('This link is not valid.', 'It may have been truncated by your email client. Reply to any of our emails instead and we will take care of it.', null, 400);

  if (req.method === 'GET') {
    const label = action === 'stop'
      ? ['Stop the nurture sequence for this lead?', 'Team action. The lead stays contactable manually, automatic messages stop.', 'Stop the sequence']
      : ['Unsubscribe from Turn Key AI messages?', 'One click and we will not text or email you again.', 'Confirm unsubscribe'];
    return page(label[0], label[1], { e, t, a: action === 'stop' ? 'stop' : '', button: label[2] });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const store = nurtureStore();
  const key = leadKeyFor(email);
  let rec = null;
  try { rec = await store.get(key, { type: 'json' }); } catch { /* ignore */ }

  if (action === 'stop') {
    if (rec && !rec.stopped) {
      rec.stopped = true; rec.stopReason = 'manual-team-stop';
      await store.set(key, JSON.stringify(rec));
    }
    await logOpsEvent(store, { type: 'manual-stop', leadId: rec?.leadId || email });
    return page('Sequence stopped.', `No further automatic messages will be sent to ${email}.`);
  }

  await suppress(store, { email, e164: rec?.phone, source: 'email-unsub' });
  if (rec && !rec.stopped) {
    rec.stopped = true; rec.stopReason = 'email-unsub';
    await store.set(key, JSON.stringify(rec));
  }
  await logOpsEvent(store, { type: 'optout', channel: 'email', leadId: rec?.leadId || email });
  return page('You are unsubscribed.', 'We will not text or email you again. If you change your mind one day, just get in touch at start@tkai.com.au.');
};

function page(title, sub, form, status = 200) {
  const formHtml = form
    ? `<form method="POST" action="/unsubscribe?e=${encodeURIComponent(form.e)}&t=${encodeURIComponent(form.t)}${form.a ? '&a=' + form.a : ''}" style="margin-top:24px;">
        <button type="submit" style="background:#0a0a0a;color:#fff;font-size:15px;font-weight:500;padding:14px 26px;border-radius:100px;border:none;cursor:pointer;">${form.button}</button>
      </form>`
    : '';
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · Turn Key AI</title></head>
<body style="margin:0;background:#f2f2f4;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif;color:#1d1d1f;">
  <div style="max-width:480px;margin:12vh auto 0;background:#fff;border-radius:20px;padding:44px 40px;text-align:center;">
    <p style="font-size:15px;font-weight:600;margin:0 0 18px;"><span style="display:inline-block;width:8px;height:8px;background:#0071e3;border-radius:50%;margin-right:8px;"></span>TurnkeyAI</p>
    <h1 style="font-size:24px;letter-spacing:-0.01em;margin:0 0 12px;">${title}</h1>
    <p style="font-size:15px;color:#6e6e73;margin:0;">${sub}</p>
    ${formHtml}
  </div>
</body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
