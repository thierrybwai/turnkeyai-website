// Nurture delivery poller. Runs every 5 minutes (scheduled function, 30 s budget).
// Single writer for step delivery: re-checks every guard at send time, so flipping
// config.mode in Blobs stops everything within one tick, no redeploy, no distributed
// cancellation. Also syncs Calendly bookings (plan free = polling, no webhooks).
//
// Writer discipline: this function is the only writer of the 'ops' blob (meta:
// lastRun, mode, calEvents, lastDigest). The event journal lives under 'ops-events'
// and is only written by logOpsEvent, so neither can clobber the other.

import {
  nurtureStore, getConfig, isSuppressed, inWindow, reserveSmsSlot, suppress,
  sendSms, sendEmail, unsubUrlFor, leadKeyFor, logOpsEvent,
  PURGE_MS, STALE_MS, STEP_GAP, DEDUPE_MS, MAX_SEND_ATTEMPTS, PUBLIC_BASE, brisbaneHour,
} from './lib/nurture.js';
import { smsTextFor, emailPartsFor } from './lib/nurture-copy.js';

export const config = { schedule: '*/5 * * * *' };

const CALENDLY_ORG = process.env.CALENDLY_ORG
  || 'https://api.calendly.com/organizations/5053b67f-f4f3-46a3-91f7-80b48baff19f';
const TICK_BUDGET_MS = 18000; // leave room for the final ops write + digest inside the 30 s cap

export default async () => {
  const t0 = Date.now();
  const store = nurtureStore();
  const cfg = await getConfig(store);
  const now = Date.now();
  const ops = (await store.get('ops', { type: 'json' })) || {};
  delete ops.events; // legacy field: the journal now lives under 'ops-events'
  ops.lastRun = now;
  ops.mode = cfg.mode;

  if (cfg.mode === 'off') {
    await store.set('ops', JSON.stringify(ops));
    return new Response('mode off');
  }

  // 1. Calendly sync: mark booked leads before any send decision.
  try { await syncCalendly(store, ops, now); }
  catch (e) { console.error('Calendly sync failed:', e.message); }

  // 2. Deliver due steps.
  const tick = { sent: [], dry: [], stopped: [] };
  let listing;
  try { listing = await store.list({ prefix: 'lead:' }); }
  catch (e) { console.error('Blobs list failed:', e.message); listing = { blobs: [] }; }

  const blobs = listing.blobs || [];
  let processed = 0;
  for (const b of blobs) {
    if (Date.now() - t0 > TICK_BUDGET_MS) {
      console.warn(`Tick budget reached, ${blobs.length - processed} leads deferred to next tick`);
      break;
    }
    processed++;

    let rec;
    try { rec = await store.get(b.key, { type: 'json' }); } catch { continue; }
    if (!rec) continue;

    const finished = rec.stopped || rec.booked
      || (rec.sms1?.status !== 'pending' && rec.sms1?.status !== 'queued'
          && rec.steps.every(s => s.status !== 'pending'));
    // Early purge: any sequence is mathematically over after DEDUPE_MS (plan 72h + stale 48h),
    // keeping the record longer only slows every tick. DEDUPE_MS also preserves dedupe.
    if (now - rec.createdAt > PURGE_MS || (finished && now - rec.createdAt > DEDUPE_MS)) {
      try {
        await store.delete(b.key);
        if (rec.phone) await store.delete(`phone:${rec.phone}`);
        if (rec.leadId) { await store.delete(`byid:${rec.leadId}`); await store.delete(`click:${rec.leadId}`); }
      } catch { /* best effort */ }
      continue;
    }
    if (rec.stopped || rec.booked || rec.paused) continue;

    const hasWork = (rec.sms1?.status === 'queued' && rec.sms1.due <= now)
      || rec.steps.some(s => s.status === 'pending' && s.due <= now);
    if (!hasWork) continue;

    if (await isSuppressed(store, rec.email, rec.phone)) {
      rec.stopped = true; rec.stopReason = 'suppressed';
      tick.stopped.push(rec.leadId);
      await store.set(b.key, JSON.stringify(rec));
      continue;
    }

    let changed = false;
    let lastSentAt = 0; // send-time spacing net: one message per lead per tick, max
    // 'test' mode: real sends only for test-listed leads, dry for real leads.
    const emode = cfg.mode === 'test' ? (rec.test ? 'live' : 'dry') : cfg.mode;

    // Queued SMS#1 (was submitted outside the window)
    if (rec.sms1?.status === 'queued' && rec.sms1.due <= now && (rec.accel || inWindow(now))) {
      changed = true;
      if (now - rec.sms1.due > STALE_MS) {
        rec.sms1 = { status: 'skipped-stale' };
      } else if (emode === 'dry') {
        rec.sms1 = { status: 'dry', at: now };
        tick.dry.push(`sms1:${rec.leadId}`);
      } else if (!(await reserveSmsSlot(store, now))) {
        changed = false; // cap reached: retry next tick
      } else {
        try {
          await sendSms({ to: rec.phone, body: smsTextFor('sms1', rec) });
          rec.sms1 = { status: 'sent', at: now };
          lastSentAt = now;
          tick.sent.push(`sms1:${rec.leadId}`);
          await logOpsEvent(store, { type: 'sent', step: 'sms1', leadId: rec.leadId });
        } catch (e) {
          if (/21610/.test(String(e.message))) {
            await suppress(store, { email: rec.email, e164: rec.phone, source: 'twilio-21610' });
            rec.stopped = true; rec.stopReason = 'twilio-21610';
            await logOpsEvent(store, { type: 'optout', channel: 'sms', leadId: rec.leadId });
          }
          rec.sms1 = { status: 'failed', err: String(e.message).slice(0, 150) };
          console.error(`sms1 send failed for ${rec.leadId}:`, e.message);
        }
      }
    }

    for (const step of rec.steps) {
      if (rec.stopped) break;
      if (step.status !== 'pending' || step.due > now) continue;
      if (!rec.accel && !inWindow(now)) break; // outside window: everything waits

      // Send-time spacing: after any send to this lead in this tick, push the next
      // step away and let a later tick re-evaluate all guards. Accelerated test
      // sequences get a proportionally shorter gap so the run stays observable.
      const gap = rec.accel ? Math.max(60e3, STEP_GAP / rec.accel) : STEP_GAP;
      if (lastSentAt && now - lastSentAt < gap) {
        step.due = lastSentAt + gap;
        changed = true;
        break;
      }

      if (now - step.due > STALE_MS) { step.status = 'skipped-stale'; changed = true; continue; }

      const isSms = step.id.startsWith('sms');
      if (isSms && !rec.phone) { step.status = 'skipped-no-phone'; changed = true; continue; }

      if (emode === 'dry') {
        step.status = 'dry'; step.at = now;
        tick.dry.push(`${step.id}:${rec.leadId}`);
        changed = true;
        continue;
      }

      if (isSms && !(await reserveSmsSlot(store, now))) break; // cap: retry next tick

      try {
        if (isSms) {
          await sendSms({ to: rec.phone, body: smsTextFor(step.id, rec) });
        } else {
          const unsubUrl = unsubUrlFor(rec.email);
          const parts = emailPartsFor(step.id, rec, unsubUrl);
          await sendEmail({ to: rec.email, ...parts, unsubUrl });
        }
        step.status = 'sent'; step.at = now;
        lastSentAt = now;
        tick.sent.push(`${step.id}:${rec.leadId}`);
        await logOpsEvent(store, { type: 'sent', step: step.id, leadId: rec.leadId });
        changed = true;
      } catch (e) {
        if (/21610/.test(String(e.message))) {
          await suppress(store, { email: rec.email, e164: rec.phone, source: 'twilio-21610' });
          rec.stopped = true; rec.stopReason = 'twilio-21610';
          await logOpsEvent(store, { type: 'optout', channel: 'sms', leadId: rec.leadId });
          changed = true;
          break;
        }
        step.attempts = (step.attempts || 0) + 1;
        if (step.attempts >= MAX_SEND_ATTEMPTS) { step.status = 'failed'; step.err = String(e.message).slice(0, 150); }
        changed = true;
        console.error(`${step.id} send failed for ${rec.leadId} (attempt ${step.attempts}):`, e.message);
      }
    }

    if (changed) await store.set(b.key, JSON.stringify(rec));
  }

  // 3. Dry-mode tick notification (only when something would have fired).
  if (cfg.mode === 'dry' && tick.dry.length) {
    await teamNote(`[DRY] Nurture would have sent: ${tick.dry.join(', ')}`).catch(() => {});
  }

  // 4. Daily digest, first tick after 8:00 Brisbane.
  try {
    const dayMs = 24 * 3600e3;
    if ((!ops.lastDigest || now - ops.lastDigest > dayMs - 10 * 60e3) && brisbaneHour(now) >= 8) {
      await sendDigest(store, cfg, now);
      ops.lastDigest = now;
    }
  } catch (e) { console.error('Digest failed:', e.message); }

  await store.set('ops', JSON.stringify(ops));
  return new Response(`ok: sent=${tick.sent.length} dry=${tick.dry.length}`);
};

// ── Calendly ─────────────────────────────────────────
async function syncCalendly(store, ops, now) {
  const tok = process.env.CALENDLY_TOKEN;
  if (!tok) return;
  const seen = ops.calEvents || {};
  const min = new Date(now - 2 * 86400e3).toISOString();
  const url = `https://api.calendly.com/scheduled_events?organization=${encodeURIComponent(CALENDLY_ORG)}&min_start_time=${encodeURIComponent(min)}&status=active&count=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  if (!res.ok) throw new Error(`Calendly ${res.status}`);
  const events = (await res.json()).collection || [];

  for (const ev of events) {
    const uuid = (ev.uri || '').split('/').pop();
    if (!uuid || seen[uuid]) continue;
    const ir = await fetch(`${ev.uri}/invitees?count=10`, { headers: { Authorization: `Bearer ${tok}` } });
    if (!ir.ok) continue;
    const invitees = (await ir.json()).collection || [];
    for (const inv of invitees) {
      let key = null;
      if (inv.email) key = leadKeyFor(inv.email);
      let rec = key ? await store.get(key, { type: 'json' }) : null;
      if (!rec && inv.tracking?.utm_content) {
        const mapped = await store.get(`byid:${inv.tracking.utm_content}`);
        if (mapped) { key = mapped; rec = await store.get(key, { type: 'json' }); }
      }
      if (rec && !rec.booked) {
        rec.booked = true; rec.bookedAt = now;
        rec.bookedVia = inv.tracking?.utm_campaign || 'direct';
        await store.set(key, JSON.stringify(rec));
        await logOpsEvent(store, { type: 'booked', leadId: rec.leadId, via: rec.bookedVia });
        console.log(`Lead ${rec.leadId} booked (via ${rec.bookedVia}), sequence stopped.`);
      }
    }
    seen[uuid] = now;
  }
  // prune the seen cache
  const keys = Object.keys(seen);
  if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete seen[k];
  ops.calEvents = seen;
  ops.lastCalendlySync = now;
}

// ── Ops messaging ────────────────────────────────────
// Digest and dry-run notes go to the nurture OWNER only (Mael), never to the
// whole lead-notification list: ops chatter is not a team-wide alert.
function teamRecipients() {
  return (process.env.NURTURE_DIGEST_EMAILS || 'help@bwpg.com.au')
    .split(',').map(s => s.trim()).filter(Boolean);
}
async function teamNote(text) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'TurnkeyAI Nurture <start@tkai.com.au>',
      to: teamRecipients(),
      subject: text.replace(/[\r\n]+/g, ' ').slice(0, 90),
      text,
    }),
  });
}

async function sendDigest(store, cfg, now) {
  const dayAgo = now - 24 * 3600e3;
  const journal = (await store.get('ops-events', { type: 'json' })) || {};
  const events = (journal.events || []).filter(e => e.at > dayAgo);
  const sent = events.filter(e => e.type === 'sent').length;
  const booked = events.filter(e => e.type === 'booked');
  const optouts = events.filter(e => e.type === 'optout').length;
  const clicks = events.filter(e => e.type === 'click').length;
  const failures = events.filter(e => e.type === 'sms-failed').length;

  let active = 0;
  try { active = ((await store.list({ prefix: 'lead:' })).blobs || []).length; } catch { /* ignore */ }

  const sid = process.env.TWILIO_ACCOUNT_SID, tokn = process.env.TWILIO_AUTH_TOKEN;
  const auth = sid && tokn ? 'Basic ' + Buffer.from(`${sid}:${tokn}`).toString('base64') : null;

  let balance = '';
  try {
    if (auth) {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`, { headers: { Authorization: auth } });
      if (r.ok) { const j = await r.json(); balance = `${Number(j.balance).toFixed(2)} ${j.currency}`; }
    }
  } catch { /* ignore */ }

  // Live preflight: if the STOP webhook is not actually wired to us, Spam Act
  // compliance is broken silently. Surface it loudly in every digest.
  let webhookAlert = '';
  try {
    const svc = process.env.TWILIO_MESSAGING_SERVICE_SID;
    if ((cfg.mode === 'live' || cfg.mode === 'test') && auth && svc) {
      const r = await fetch(`https://messaging.twilio.com/v1/Services/${svc}`, { headers: { Authorization: auth } });
      if (r.ok) {
        const j = await r.json();
        const expected = `${PUBLIC_BASE}/.netlify/functions/twilio-inbound`;
        if (j.inbound_request_url !== expected) {
          webhookAlert = `⚠️ ALERT: Messaging Service inbound webhook is "${j.inbound_request_url || 'unset'}", expected "${expected}". STOP replies are NOT reaching us: do not stay in live mode.`;
        }
      }
    } else if (cfg.mode === 'live' && !svc) {
      webhookAlert = '⚠️ ALERT: TWILIO_MESSAGING_SERVICE_SID missing while mode=live.';
    }
  } catch { /* ignore */ }

  const lines = [
    `Nurture daily digest (poller alive).`,
    `Mode: ${cfg.mode}`,
    `Last 24h: ${sent} messages sent, ${booked.length} Calendly bookings, ${clicks} CTA clicks, ${optouts} opt-outs, ${failures} SMS delivery failures.`,
    booked.length ? `Booked: ${booked.map(b => `${b.leadId} (via ${b.via})`).join(', ')}` : null,
    `Sequences in store: ${active}.`,
    balance ? `Twilio balance: ${balance}.` : null,
    webhookAlert || null,
  ].filter(Boolean);

  await teamNote(lines.join('\n'));
}
