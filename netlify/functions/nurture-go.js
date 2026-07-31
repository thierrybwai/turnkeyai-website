// Short-link redirector for nurture CTAs (rewritten from /c/*).
// /c/<step>?c=<leadId>  →  302 to Calendly with per-step UTMs + utm_content=<leadId>.
// Keeps SMS short and on a trusted domain, carries attribution server-side, and
// logs the click on the lead record (best effort).

import { nurtureStore, CALENDLY_URL, logOpsEvent } from './lib/nurture.js';

const STEPS = {
  t0: { medium: 'email', campaign: 't0' },
  s1: { medium: 'sms', campaign: 's1' },
  e2: { medium: 'email', campaign: 'e2' },
  e3: { medium: 'email', campaign: 'e3' },
};

export default async (req) => {
  const url = new URL(req.url);
  const step = (url.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();
  const leadId = (url.searchParams.get('c') || '').replace(/[^a-f0-9]/gi, '').slice(0, 12);
  const meta = STEPS[step];

  const target = new URL(CALENDLY_URL);
  if (meta) {
    target.searchParams.set('utm_source', 'nurture');
    target.searchParams.set('utm_medium', meta.medium);
    target.searchParams.set('utm_campaign', meta.campaign);
    if (leadId) target.searchParams.set('utm_content', leadId);
  }

  if (meta && leadId) {
    try {
      // Clicks live under their own key: this public, unauthenticated endpoint must
      // NEVER rewrite the lead record (a rewrite could resurrect a paused/stopped/
      // booked state lost-update style). byid existence gates junk-blob creation.
      const store = nurtureStore();
      const key = await store.get(`byid:${leadId}`);
      if (key) {
        const ck = `click:${leadId}`;
        const clicks = (((await store.get(ck, { type: 'json' })) || []).slice(-19));
        clicks.push({ step, at: Date.now() });
        await store.set(ck, JSON.stringify(clicks));
        await logOpsEvent(store, { type: 'click', step, leadId });
      }
    } catch { /* click logging must never block the redirect */ }
  }

  return new Response(null, { status: 302, headers: { Location: target.toString() } });
};
