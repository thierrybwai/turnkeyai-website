// Vapi call outcomes come back here. Without this the voice layer is write-only:
// the agent could have a great conversation, or be told never to call again, and the
// SMS sequence would carry on the next morning as if nothing had happened.
//
// Auth: shared secret in the `x-vapi-secret` header, set on the assistant's server
// config. Fail-closed, like every other webhook here.

import {
  nurtureStore, suppress, logOpsEvent, sendEmail, leadKeyFor, safeEqual,
} from './lib/nurture.js';
import { MAX_CALL_ATTEMPTS } from './lib/nurture-call.js';

// A call shorter than this never contained a conversation, whatever Vapi reports:
// it is a pickup-and-hangup, a wrong number, or a voicemail beep.
const REAL_CONVERSATION_SECONDS = 20;

const VOICEMAIL_REASONS = new Set([
  'voicemail', 'assistant-ended-call-after-message-spoken', 'customer-did-not-give-microphone-permission',
]);
const NO_ANSWER_REASONS = new Set([
  'customer-did-not-answer', 'customer-busy', 'twilio-failed-to-connect-call',
  'call.in-progress.error-providerfault-transport-never-connected', 'phone-call-provider-closed-websocket',
]);

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = process.env.VAPI_WEBHOOK_SECRET || '';
  if (!secret) {
    console.error('vapi-webhook: VAPI_WEBHOOK_SECRET absent, refusing (fail-closed)');
    return new Response('unconfigured', { status: 503 });
  }
  if (!safeEqual(secret, req.headers.get('x-vapi-secret') || '')) {
    console.error('vapi-webhook: bad secret, dropping');
    return new Response('Forbidden', { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const msg = body?.message || {};

  // Only the end-of-call report changes state. Everything else is noise we ack.
  if (msg.type !== 'end-of-call-report') return json({ ok: true, ignored: msg.type || 'unknown' });

  const store = nurtureStore();
  const call = msg.call || {};
  const meta = call.metadata || {};
  const email = String(meta.email || '');
  const leadId = String(meta.leadId || '');
  const duration = Number(msg.durationSeconds || 0);
  const endedReason = String(msg.endedReason || '');
  const structured = msg.analysis?.structuredData || {};
  const summary = String(msg.analysis?.summary || '').slice(0, 1500);
  const customerNumber = call.customer?.number || meta.phone || '';

  // Classify before touching anything. Vapi's own labels are a hint, not the truth:
  // the duration floor is what stops a voicemail beep being recorded as a conversation.
  let outcome;
  if (NO_ANSWER_REASONS.has(endedReason)) outcome = 'no-answer';
  else if (VOICEMAIL_REASONS.has(endedReason) || /voicemail/i.test(endedReason)) outcome = 'voicemail';
  else if (duration < REAL_CONVERSATION_SECONDS) outcome = 'no-conversation';
  else outcome = String(structured.outcome || 'talked');

  const askedToStop = structured.askedToStopCalling === true
    || outcome === 'do-not-call'
    || /customer-asked/i.test(endedReason);

  await logOpsEvent(store, {
    type: 'call-result', leadId, outcome, endedReason,
    seconds: Math.round(duration), cost: msg.cost,
  });

  let rec = null, key = null;
  if (email) {
    key = leadKeyFor(email);
    try { rec = await store.get(key, { type: 'json' }); } catch { /* best effort */ }
  }

  if (rec) {
    const plan = rec.calls || {};
    const attempts = plan.attempts || [];
    const current = attempts.find(a => a.status === 'dialing') || attempts.find(a => a.status === 'pending');
    if (current) {
      current.status = outcome === 'no-answer' || outcome === 'voicemail' ? outcome : 'done';
      current.at = Date.now();
      current.endedReason = endedReason;
      current.seconds = Math.round(duration);
    }

    if (askedToStop) {
      // Highest priority, always. Suppress the phone AND stop the whole sequence:
      // someone who says "stop calling me" has not consented to keep getting texts.
      await suppress(store, { email, e164: customerNumber || rec.phone, source: 'call-do-not-call' });
      rec.stopped = true;
      rec.stopReason = 'asked-not-to-be-called-on-call';
      plan.stopped = 'do-not-call';
    } else if (structured.outcome === 'booked' || structured.booked === true) {
      rec.booked = true;
      plan.stopped = 'booked';
    } else if (outcome !== 'no-answer' && outcome !== 'voicemail' && outcome !== 'no-conversation') {
      // A real conversation happened. Stop calling, but leave the email sequence alone:
      // they may still book from the plan they already have.
      plan.stopped = 'spoke-to-lead';
      rec.paused = structured.outcome === 'interested-callback' ? true : rec.paused;
    } else if (attempts.every(a => a.status !== 'pending')) {
      plan.stopped = 'attempts-exhausted';
    }

    plan.lastOutcome = outcome;
    plan.lastSummary = summary;
    rec.calls = plan;
    try { await store.set(key, JSON.stringify(rec)); } catch (e) { console.error('call state write failed:', e.message); }
  }

  console.log(`vapi-webhook: ${leadId || 'unknown'} ${outcome} (${endedReason}, ${Math.round(duration)}s)`);

  // Mael only wants to hear about calls that mean something. A no-answer on attempt 1
  // of 4 is not news; a booking, a refusal or a real conversation is.
  const worthTelling = askedToStop
    || structured.outcome === 'booked'
    || (outcome !== 'no-answer' && outcome !== 'voicemail' && outcome !== 'no-conversation');
  if (worthTelling) {
    const who = rec ? `${rec.first || 'Lead'}${rec.biz ? ' (' + rec.biz + ')' : ''}` : (customerNumber || 'unknown lead');
    const subject = askedToStop
      ? `Do not call again: ${who}`
      : structured.outcome === 'booked'
        ? `Booked on the call: ${who}`
        : `Call outcome: ${who}, ${outcome}`;
    await notify(subject, [
      `Outcome: ${outcome}`,
      `Duration: ${Math.round(duration)}s`,
      `Ended reason: ${endedReason}`,
      rec ? `Email: ${rec.email}` : '',
      customerNumber ? `Phone: ${customerNumber}` : '',
      structured.bookedTime ? `Time discussed: ${structured.bookedTime}` : '',
      structured.notes ? `Agent notes: ${structured.notes}` : '',
      '',
      summary ? `Summary:\n${summary}` : '',
      '',
      askedToStop
        ? 'They asked not to be called. Phone and email are both suppressed, the whole sequence is stopped.'
        : plan_note(rec),
      msg.recordingUrl ? `\nRecording: ${msg.recordingUrl}` : '',
    ].filter(Boolean).join('\n'));
  }

  return json({ ok: true, outcome });
};

function plan_note(rec) {
  const p = rec?.calls;
  if (!p) return '';
  if (p.stopped) return `Call ladder stopped: ${p.stopped}.`;
  const left = (p.attempts || []).filter(a => a.status === 'pending').length;
  return `${left} of ${MAX_CALL_ATTEMPTS} call attempts left.`;
}

async function notify(subject, text) {
  const to = (process.env.NURTURE_DIGEST_EMAILS || 'help@bwpg.com.au').split(',')[0].trim();
  try {
    await sendEmail({ to, fromName: 'TurnkeyAI Calls', subject, text });
  } catch (e) { console.error('vapi-webhook alert failed:', e.message); }
}

function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
}
