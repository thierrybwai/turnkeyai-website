// Resend delivery-failure webhook.
//
// Why this exists: a lead whose mailbox is dead used to keep receiving SMS pointing at
// a plan that would never arrive (real case 31/07, modrisromedan@gmail.com, hard-bounced
// on 14/07 and silently dropped by Resend's suppression list on every send since).
// Nothing detected it. Now a permanent failure stops the sequence at the source.
//
// Signature: Svix (svix-id / svix-timestamp / svix-signature), verified fail-closed.
// Acts on: email.bounced (Permanent only), email.complained, email.suppressed.
// Alerts on: everything above + email.failed and transient bounces (no suppression).

import crypto from 'node:crypto';
import {
  nurtureStore, suppress, logOpsEvent, sendEmail, leadKeyFor, normEmail, safeEqual,
} from './lib/nurture.js';

const TOLERANCE_MS = 5 * 60 * 1000; // Svix default: reject replayed timestamps

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Fail-closed: without the signing secret an empty-key HMAC would be forgeable by
  // anyone, and a forged bounce would silently kill a live lead's sequence.
  const secret = process.env.RESEND_WEBHOOK_SECRET || '';
  if (!secret) {
    console.error('resend-webhook: RESEND_WEBHOOK_SECRET absent, refusing (fail-closed)');
    return new Response('unconfigured', { status: 503 });
  }

  const raw = await req.text();
  const id = req.headers.get('svix-id') || '';
  const ts = req.headers.get('svix-timestamp') || '';
  const sigHeader = req.headers.get('svix-signature') || '';
  if (!id || !ts || !sigHeader) return new Response('Forbidden', { status: 403 });

  if (Math.abs(Date.now() - Number(ts) * 1000) > TOLERANCE_MS) {
    console.error('resend-webhook: timestamp outside tolerance, dropping');
    return new Response('Forbidden', { status: 403 });
  }

  // HMAC-SHA256 over "<id>.<timestamp>.<body>", key = base64-decoded secret after whsec_
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64');
  const given = sigHeader.split(' ').map(s => s.split(',')).filter(p => p[0] === 'v1').map(p => p[1]);
  if (!given.some(sig => safeEqual(expected, sig))) {
    console.error('resend-webhook: bad signature, dropping');
    return new Response('Forbidden', { status: 403 });
  }

  let evt;
  try { evt = JSON.parse(raw); } catch { return new Response('Bad JSON', { status: 400 }); }

  const store = nurtureStore();

  // Svix retries on any non-2xx: without this, one flaky response fans out into
  // duplicate alerts for the same event.
  try {
    const seen = await store.set(`hook:${id}`, ts, { onlyIfNew: true });
    if (!seen.modified) return new Response('duplicate', { status: 200 });
  } catch { /* dedupe is best effort, never block the handler */ }

  const type = String(evt.type || '');
  const to = normEmail(Array.isArray(evt.data?.to) ? evt.data.to[0] : evt.data?.to);
  const bounceType = String(evt.data?.bounce?.type || '');
  const detail = [evt.data?.bounce?.subType, evt.data?.bounce?.message]
    .filter(Boolean).join(' / ').slice(0, 300);

  if (!to) return new Response('no recipient', { status: 200 });

  // Alerts are sent through Resend too: alerting about a failure that HAPPENED to the
  // alert inbox would bounce, alert again, and loop. Team addresses are logged only.
  const teamList = (process.env.NURTURE_DIGEST_EMAILS || 'help@bwpg.com.au')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const isTeamInbox = teamList.includes(to);

  // Permanent = the mailbox is gone. Transient = full/temporarily unreachable, retryable.
  const kills = type === 'email.complained'
    || type === 'email.suppressed'
    || (type === 'email.bounced' && bounceType === 'Permanent');

  if (!kills) {
    if (type === 'email.failed' || type === 'email.bounced') {
      await logOpsEvent(store, { type: 'email-issue', kind: type, bounce: bounceType });
      if (!isTeamInbox) {
        await notify(`Resend ${type} for ${mask(to)} (${bounceType || 'no type'}), no action taken`,
          `${type}\nRecipient: ${to}\nBounce type: ${bounceType || 'n/a'}\n${detail}\n\nTransient or unclassified: the sequence keeps running. Watch for repeats.`);
      }
    }
    return new Response('logged', { status: 200 });
  }

  // Suppress the email address. The phone is deliberately NOT suppressed on a bounce:
  // a dead mailbox says nothing about the mobile, and a global phone block would be
  // hard to undo. A spam complaint is different, it means stop everything.
  await suppress(store, {
    email: to,
    e164: type === 'email.complained' ? await phoneOf(store, to) : null,
    source: `resend-${type.replace('email.', '')}`,
  });

  // Stop the live sequence immediately rather than waiting for the poller's next due
  // step: the whole point is that no further SMS references an unreachable inbox.
  let leadInfo = 'no active sequence';
  try {
    const k = leadKeyFor(to);
    const rec = await store.get(k, { type: 'json' });
    if (rec && !rec.stopped) {
      rec.stopped = true;
      rec.stopReason = `resend-${type.replace('email.', '')}${bounceType ? ':' + bounceType : ''}`;
      await store.set(k, JSON.stringify(rec));
      const pending = (rec.steps || []).filter(s => s.status === 'pending').map(s => s.id);
      leadInfo = `sequence stopped for ${rec.first || 'lead'}${rec.biz ? ' (' + rec.biz + ')' : ''}`
        + `, ${pending.length} step(s) cancelled: ${pending.join(', ') || 'none'}`
        + (rec.phone ? `\nStill reachable by SMS on ${rec.phone}.` : '');
    }
  } catch (e) { leadInfo = 'lookup failed: ' + String(e.message).slice(0, 80); }

  await logOpsEvent(store, { type: 'suppressed', channel: 'email', kind: type, bounce: bounceType });
  console.log(`resend-webhook: ${type} ${bounceType} -> suppressed ${to}`);

  if (!isTeamInbox) {
    await notify(`Nurture stopped: ${type.replace('email.', '')} for ${mask(to)}`,
      `${type}${bounceType ? ' (' + bounceType + ')' : ''}\nRecipient: ${to}\n${detail}\n\n${leadInfo}\n\n`
      + `This address is now on the nurture suppression list: no further email or SMS from the sequence.`);
  }

  return new Response('ok', { status: 200 });
};

async function phoneOf(store, email) {
  try {
    const rec = await store.get(leadKeyFor(email), { type: 'json' });
    return rec?.phone || null;
  } catch { return null; }
}

async function notify(subject, text) {
  const to = (process.env.NURTURE_DIGEST_EMAILS || 'help@bwpg.com.au').split(',')[0].trim();
  try {
    await sendEmail({ to, fromName: 'TurnkeyAI Nurture', subject, text });
  } catch (e) { console.error('resend-webhook alert failed:', e.message); }
}

function mask(e) {
  const [u, d] = String(e).split('@');
  return d ? `${u.slice(0, 2)}***@${d}` : '***';
}
