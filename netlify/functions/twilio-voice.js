// Inbound VOICE handler for the TKAI nurture number (+61485035252).
// No AI agent on calls (product decision 02/07): plain call forwarding to the
// TKAI business mobile, voicemail fallback, missed-call + voicemail email alerts.
// Stages via ?stage= (answer -> dialdone -> vmdone), each request signature-checked.

import crypto from 'node:crypto';
import { PUBLIC_BASE, safeEqual, sendEmail } from './lib/nurture.js';

const FORWARD_TO = process.env.NURTURE_VOICE_FORWARD || '+61438000371';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return new Response('unconfigured', { status: 503 }); // fail-closed

  const raw = await req.text();
  const params = new URLSearchParams(raw);

  // Voice webhooks are signed over the FULL URL including the query string.
  const u = new URL(req.url);
  const url = `${PUBLIC_BASE}${u.pathname}${u.search}`;
  const sorted = [...params.keys()].sort().map(k => k + params.get(k)).join('');
  const expected = crypto.createHmac('sha1', authToken).update(url + sorted).digest('base64');
  if (!safeEqual(expected, req.headers.get('x-twilio-signature') || '')) {
    console.error('twilio-voice: bad signature, dropping');
    return new Response('Forbidden', { status: 403 });
  }

  const stage = u.searchParams.get('stage') || 'answer';
  const from = params.get('From') || 'unknown';

  if (stage === 'answer') {
    // Forward the call; the caller's own number stays as caller ID so the team
    // can call straight back. 20 s before falling through to voicemail.
    return twiml(`<Dial action="${esc(`${PUBLIC_BASE}${u.pathname}?stage=dialdone`)}" method="POST" timeout="20">${FORWARD_TO}</Dial>`);
  }

  if (stage === 'dialdone') {
    const status = params.get('DialCallStatus') || '';
    if (status === 'completed') return twiml('<Hangup/>');
    // Not answered: alert the team, then take a voicemail.
    notifyTeam(`Missed call on the TurnkeyAI number`, `Missed call from ${from} on +61485035252 (forwarded to ${FORWARD_TO}, status: ${status}). If they leave a voicemail you'll get a second email with the recording.`).catch(() => {});
    return twiml(
      `<Say language="en-AU">You have reached Turn Key A I. We cannot take your call right now. Leave your name and number after the beep and we will call you back.</Say>` +
      `<Record maxLength="90" playBeep="true" action="${esc(`${PUBLIC_BASE}${u.pathname}?stage=vmdone`)}" method="POST"/>` +
      `<Say language="en-AU">We did not get a recording. Goodbye.</Say>`
    );
  }

  if (stage === 'vmdone') {
    const rec = params.get('RecordingUrl') || '';
    const dur = params.get('RecordingDuration') || '?';
    notifyTeam(`Voicemail from ${from} (TurnkeyAI number)`, `Voicemail from ${from} on +61485035252, ${dur}s.\nRecording (Twilio login required): ${rec}.mp3\nCall them back on ${from}.`).catch(() => {});
    return twiml(`<Say language="en-AU">Thanks. We will call you back. Goodbye.</Say><Hangup/>`);
  }

  return twiml('<Hangup/>');
};

async function notifyTeam(subject, text) {
  const to = (process.env.LEAD_NOTIFY_EMAILS || 'start@tkai.com.au').split(',')[0].trim();
  await sendEmail({ to, subject, text, html: `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, fromName: 'TurnkeyAI Calls' });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function twiml(inner) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    status: 200, headers: { 'Content-Type': 'text/xml' },
  });
}
