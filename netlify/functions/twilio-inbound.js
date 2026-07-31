// Inbound SMS webhook for the TKAI nurture number.
// Validates X-Twilio-Signature (any unsigned POST is dropped: no spam relay, no forged STOP).
// STOP words: global suppression (SMS + email) and sequence stop.
// Any other reply: pause the sequence (a human answered, the automation goes quiet)
// and forward the message to the team inbox.

import crypto from 'node:crypto';
import {
  nurtureStore, suppress, logOpsEvent, sendEmail, PUBLIC_BASE, safeEqual,
} from './lib/nurture.js';

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'STOP ALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPT OUT', 'OPTOUT']);
const START_WORDS = new Set(['START', 'YES', 'UNSTOP']);

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Fail-closed: with no auth token configured, an empty-key HMAC would be forgeable
  // by anyone. Refuse instead (503 = clearly "unconfigured" in the logs, no retry loop).
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error('twilio-inbound: TWILIO_AUTH_TOKEN absent, refusing (fail-closed)');
    return new Response('unconfigured', { status: 503 });
  }

  const raw = await req.text();
  const params = new URLSearchParams(raw);

  // Twilio signature: base64(HMAC-SHA1(authToken, url + concat(sorted key+value)))
  const url = `${PUBLIC_BASE}/.netlify/functions/twilio-inbound`;
  const sorted = [...params.keys()].sort().map(k => k + params.get(k)).join('');
  const expected = crypto.createHmac('sha1', authToken)
    .update(url + sorted).digest('base64');
  const given = req.headers.get('x-twilio-signature') || '';
  if (!safeEqual(expected, given)) {
    console.error('twilio-inbound: bad signature, dropping');
    return new Response('Forbidden', { status: 403 });
  }

  const from = (params.get('From') || '').trim();
  const body = (params.get('Body') || '').trim();
  const upper = body.toUpperCase().replace(/[.!]+$/, '').trim();

  const store = nurtureStore();
  let rec = null, key = null;
  try {
    const mapped = await store.get(`phone:${from}`, { type: 'json' });
    if (mapped?.key) { key = mapped.key; rec = await store.get(key, { type: 'json' }); }
  } catch { /* lookup is best effort */ }

  if (STOP_WORDS.has(upper)) {
    await suppress(store, { email: rec?.email, e164: from, source: 'sms-stop' });
    if (rec) {
      rec.stopped = true; rec.stopReason = 'sms-stop';
      await store.set(key, JSON.stringify(rec));
    }
    await logOpsEvent(store, { type: 'optout', channel: 'sms', leadId: rec?.leadId || from });
    console.log(`Opt-out via SMS from ${from} (${rec?.leadId || 'unknown lead'})`);
    // Advanced Opt-Out on the Messaging Service sends the carrier-level confirmation.
    return twiml();
  }

  if (START_WORDS.has(upper) && rec) {
    // "Yes" is only a carrier opt-in keyword when the number was actually suppressed.
    // From an active lead, "Yes" is THE expected human answer to sms2 ("did the plan
    // make sense?"): it must fall through to the pause + forward path below.
    const wasSuppressed = await store.get(`suppress:phone:${from}`).catch(() => null);
    if (wasSuppressed) {
      // Re-consent: lift phone suppression only. The sequence itself stays stopped;
      // a new voluntary submission is the only thing that restarts messaging.
      try { await store.delete(`suppress:phone:${from}`); } catch { /* ignore */ }
      await logOpsEvent(store, { type: 'optin', channel: 'sms', leadId: rec.leadId });
      return twiml();
    }
  }

  // Human reply: pause and forward.
  if (rec && !rec.stopped) {
    rec.paused = true; rec.pauseReason = 'lead-replied';
    await store.set(key, JSON.stringify(rec));
  }
  await logOpsEvent(store, { type: 'reply', leadId: rec?.leadId || from });
  try {
    await sendEmail({
      to: (process.env.LEAD_NOTIFY_EMAILS || 'start@tkai.com.au').split(',')[0].trim(),
      fromName: 'TurnkeyAI Nurture',
      subject: `SMS reply from ${rec?.first || from}${rec?.biz ? ' (' + rec.biz + ')' : ''}`,
      text: `Lead replied by SMS.\n\nFrom: ${from}${rec ? `\nName: ${rec.first}\nEmail: ${rec.email}` : '\n(no matching nurture sequence)'}\n\nMessage:\n${body}\n\nThe nurture sequence for this lead is now PAUSED. Reply to them directly by phone or email.`,
    });
  } catch (e) { console.error('Reply forward failed:', e.message); }

  return twiml();
};

function twiml() {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200, headers: { 'Content-Type': 'text/xml' },
  });
}
