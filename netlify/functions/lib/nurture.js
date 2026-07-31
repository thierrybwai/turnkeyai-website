// Nurture sequence core: phone gate, market gate, schedule computation, Blobs state,
// send guards, HMAC tokens. AU-only by decision (31/07/2026): FR/NC leads never enter.
//
// Delivery model: cron-queue. Nothing is ever scheduled inside Twilio or Resend.
// The submission hook writes one sequence record; nurture-poller.js sends due steps
// after re-checking every guard at send time. Global mode lives in Blobs ('config'),
// NOT in an env var, so flipping it needs no redeploy and stops everything in <5 min.

import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { computeCallPlan } from './nurture-call.js';

const BNE_OFFSET = 10 * 3600e3; // Australia/Brisbane is UTC+10, no DST
const WINDOW_START = 9;         // 9:00 Brisbane
const WINDOW_END = 19;          // 19:00 Brisbane (exclusive)
export const STEP_GAP = 15 * 60e3;
export const DEDUPE_MS = 14 * 86400e3;
export const PURGE_MS = 90 * 86400e3;
export const STALE_MS = 48 * 3600e3; // a step overdue by more than this is skipped, never late-blasted
export const DAILY_SMS_CAP = 50;
export const MAX_SEND_ATTEMPTS = 3;

export const CALENDLY_URL = 'https://calendly.com/start-tkai/30min';
export const PUBLIC_BASE = (process.env.NURTURE_PUBLIC_BASE || 'https://turnkeyai.com.au').replace(/\/$/, '');

export function nurtureStore() {
  return getStore({ name: 'nurture', consistency: 'strong' });
}

// ── Identity, tokens ─────────────────────────────────
export function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }
export function normEmail(e) { return String(e || '').trim().toLowerCase(); }
export function leadKeyFor(email) { return `lead:${sha1(normEmail(email))}`; }
export function leadIdFor(email) { return sha1(normEmail(email)).slice(0, 12); }

// Fail-closed HMAC: with no secret (or a weak one), no token is ever generated or
// accepted. No module-scope throw: this file is imported by the submission function,
// and a broken import would kill the lead's t=0 email and trigger Netlify retries.
const HMAC_SECRET = process.env.NURTURE_HMAC_SECRET || '';
export const HMAC_READY = HMAC_SECRET.length >= 32;
export function hmacToken(payload) {
  if (!HMAC_READY) throw new Error('NURTURE_HMAC_SECRET missing or shorter than 32 chars');
  return crypto.createHmac('sha256', HMAC_SECRET).update(String(payload)).digest('hex').slice(0, 32);
}
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
export function unsubUrlFor(email) {
  const e = Buffer.from(normEmail(email)).toString('base64url');
  return `${PUBLIC_BASE}/unsubscribe?e=${e}&t=${hmacToken('unsub:' + normEmail(email))}`;
}
export function stopUrlFor(email) {
  const e = Buffer.from(normEmail(email)).toString('base64url');
  return `${PUBLIC_BASE}/unsubscribe?a=stop&e=${e}&t=${hmacToken('stop:' + normEmail(email))}`;
}

// ── Phone gate ───────────────────────────────────────
// { e164 } for an AU mobile, { nc: true } for an NC-looking number, {} otherwise.
// Landlines (02/03/07/08), overseas and garbage never get SMS (toll-fraud guard).
export function classifyPhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '').replace(/^00/, '+'); // 00687... = +687...
  if (!digits) return {};
  if (/^\+?687\d{6}$/.test(digits)) return { nc: true };
  if (/^\d{6}$/.test(digits)) return { nc: true }; // NC local format: 6 digits
  const d = digits.replace(/^\+/, '');
  if (/^614\d{8}$/.test(d)) return { e164: `+${d}` };
  if (/^04\d{8}$/.test(d)) return { e164: `+61${d.slice(1)}` };
  if (/^4\d{8}$/.test(d)) return { e164: `+61${d}` };
  return {};
}

// ── Market gate ──────────────────────────────────────
export function isFrenchLead(data, phoneInfo) {
  if (String(data?.page || '').startsWith('fr-')) return true;
  if (String(data?.leadLandingPage || '').includes('/fr/')) return true;
  if (phoneInfo && phoneInfo.nc) return true;
  return false;
}

// ── Input sanitisers ─────────────────────────────────
// first/biz come from a public form and end up inside SMS/email we sign and pay for.
// A value that fails these checks flips the lead to an email-only, fallback-name sequence.
export function safeName(raw, max = 30) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim(); // also flattens CRLF
  if (!s || s.length > max || /\d/.test(s)) return '';
  return /^[\p{L}\p{M} '’.\-]+$/u.test(s) ? s : '';
}
export function safeBiz(raw, max = 40) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > max) return '';
  return /https?:|www\.|[<>]/i.test(s) ? '' : s;
}

export function isInternalOrTest(email) {
  const e = normEmail(email);
  return !e || e.includes('test') || e.endsWith('@tkai.com.au')
    || e.endsWith('@turnkeyai.com.au') || e.endsWith('@bwpg.com.au');
}

// ── Brisbane window ──────────────────────────────────
function bris(ms) { return new Date(ms + BNE_OFFSET); } // read wall clock via getUTC*
export function brisbaneDay(ms) { return bris(ms).toISOString().slice(0, 10); }
export function brisbaneHour(ms) { return bris(ms).getUTCHours(); }
export function inWindow(ms) {
  const d = bris(ms);
  return d.getUTCDay() !== 0 && d.getUTCHours() >= WINDOW_START && d.getUTCHours() < WINDOW_END;
}
export function clampWindow(ms) {
  const d = bris(ms);
  if (d.getUTCHours() >= WINDOW_END) { d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(WINDOW_START, 0, 0, 0); }
  else if (d.getUTCHours() < WINDOW_START) { d.setUTCHours(WINDOW_START, 0, 0, 0); }
  if (d.getUTCDay() === 0) { d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(WINDOW_START, 0, 0, 0); }
  return d.getTime() - BNE_OFFSET;
}

// Monotone one-pass clamp: order and 15-min spacing always preserved.
// accel (e.g. 60) divides the offsets and skips clamping: full test sequence in ~75 min.
export function computeSchedule(now, accel) {
  const plan = [['sms2', 2 * 3600e3], ['email2', 12 * 3600e3], ['sms3', 24 * 3600e3], ['email3', 72 * 3600e3]];
  const steps = [];
  let prev = now;
  for (const [id, off] of plan) {
    let t;
    if (accel) {
      t = Math.max(now + off / accel, prev + 60e3);
    } else {
      t = clampWindow(Math.max(now + off, prev + STEP_GAP));
      if (t < prev + STEP_GAP) t = clampWindow(prev + STEP_GAP);
    }
    steps.push({ id, due: t, status: 'pending', attempts: 0 });
    prev = t;
  }
  return steps;
}

// ── Config / suppression / counters ──────────────────
// mode: 'off' (nothing, ever) | 'dry' (log only) | 'test' (real sends for
// NURTURE_TEST_EMAILS leads, dry for everyone else) | 'live'
export async function getConfig(store) {
  const cfg = await store.get('config', { type: 'json' });
  return { mode: 'off', callMode: 'off', ...(cfg || {}) };
}
export async function isSuppressed(store, email, e164) {
  if (email && await store.get(`suppress:${sha1(normEmail(email))}`)) return true;
  if (e164 && await store.get(`suppress:phone:${e164}`)) return true;
  return false;
}
export async function suppress(store, { email, e164, source }) {
  const rec = JSON.stringify({ at: new Date().toISOString(), source: source || 'unknown' });
  if (email) await store.set(`suppress:${sha1(normEmail(email))}`, rec);
  if (e164) await store.set(`suppress:phone:${e164}`, rec);
}
// Atomic daily SMS slot: reserve BEFORE sending, compare-and-swap on the counter blob.
// The cap holds as a strict bound under any concurrency (parallel submissions included).
export async function reserveSmsSlot(store, nowMs, cap = DAILY_SMS_CAP) {
  const key = `counter:${brisbaneDay(nowMs)}`;
  for (let i = 0; i < 5; i++) {
    const got = await store.getWithMetadata(key, { type: 'json' });
    const cur = (got && got.data) || { sms: 0 };
    if (cur.sms >= cap) return false;
    const next = JSON.stringify({ sms: cur.sms + 1 });
    const res = got
      ? await store.set(key, next, { onlyIfMatch: got.etag })
      : await store.set(key, next, { onlyIfNew: true });
    if (res.modified) return true;
    await new Promise(r => setTimeout(r, 40 + Math.random() * 120));
  }
  return false; // persistent contention: prefer not sending
}

// Atomic phone reservation: the reservation itself is the dedupe barrier, not a read.
export async function reservePhone(store, e164, key, now) {
  const r = await store.set(`phone:${e164}`, JSON.stringify({ key, createdAt: now }), { onlyIfNew: true });
  if (r.modified) return true;
  const cur = await store.get(`phone:${e164}`, { type: 'json' });
  if (!cur) return false;
  if (cur.key === key) return true; // same lead re-submitting
  if (now - cur.createdAt >= DEDUPE_MS) {
    const meta = await store.getWithMetadata(`phone:${e164}`, { type: 'json' });
    const w = await store.set(`phone:${e164}`, JSON.stringify({ key, createdAt: now }), { onlyIfMatch: meta?.etag });
    return !!w.modified;
  }
  return false; // number already claimed by another lead < 14 days ago
}

// Ops journal lives under its own key ('ops-events') with a single writer path,
// so the poller's read-modify-write of 'ops' (meta) can never clobber it.
export async function logOpsEvent(store, ev) {
  try {
    const log = (await store.get('ops-events', { type: 'json' })) || {};
    log.events = (log.events || []).slice(-499);
    log.events.push({ at: Date.now(), ...ev });
    await store.set('ops-events', JSON.stringify(log));
  } catch { /* best effort */ }
}

// ── Senders (direct, never scheduled) ────────────────
export async function sendSms({ to, body }) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  const svc = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !tok || !svc) throw new Error('Twilio env not configured');
  if (String(body).length > 480) throw new Error('SMS body too long'); // cost backstop: no template may ever segment-bomb
  const params = new URLSearchParams({
    To: to, Body: body, MessagingServiceSid: svc,
    StatusCallback: `${PUBLIC_BASE}/.netlify/functions/twilio-status`,
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function sendEmail({ to, subject, html, text, unsubUrl, fromName }) {
  const payload = {
    from: `${fromName || 'Mael at TurnkeyAI'} <start@tkai.com.au>`,
    reply_to: 'start@tkai.com.au',
    to: [to],
    subject: String(subject).replace(/[\r\n]+/g, ' ').slice(0, 150),
    html, text,
  };
  if (unsubUrl) {
    payload.headers = {
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ── Enqueue (called from submission-created-background, must NEVER throw upward) ──
// Returns a status object for the team notification. Sends SMS#1 directly when possible.
export async function enqueueNurture({ email, firstName, businessName, phone, data, hasPdf, smsTextFor, industry, planSummary }) {
  const store = nurtureStore();
  const cfg = await getConfig(store);
  const now = Date.now();
  const em = normEmail(email);

  const testList = (process.env.NURTURE_TEST_EMAILS || '').toLowerCase()
    .split(',').map(s => s.trim()).filter(Boolean);
  const isTest = testList.includes(em);
  const accel = isTest ? 60 : 0;

  const phoneInfo = classifyPhone(phone);
  const result = { enrolled: false, leadId: null, stopUrl: null, sms1: 'skipped', note: '' };

  if (!HMAC_READY) { result.note = 'NURTURE_HMAC_SECRET not configured, enrolment refused'; return result; }
  if (isFrenchLead(data, phoneInfo)) { result.note = 'FR/NC lead, excluded (NC marketing stopped)'; return result; }
  if (!isTest && isInternalOrTest(em)) { result.note = 'internal or test email, excluded'; return result; }
  if (await isSuppressed(store, em, phoneInfo.e164)) { result.note = 'suppressed (opted out earlier)'; return result; }

  const key = leadKeyFor(em);
  const existing = await store.get(key, { type: 'json' });
  if (existing && now - existing.createdAt < DEDUPE_MS) { result.note = 'duplicate, sequence already exists'; return result; }

  // Sanitise form-controlled fields. A suspect first/biz keeps the lead but flips the
  // sequence to email-only with fallback wording: no attacker-authored SMS on our sender.
  const cleanFirst = safeName(firstName);
  const cleanBiz = safeBiz(businessName);
  const suspect = (!!String(firstName || '').trim() && !cleanFirst)
    || (!!String(businessName || '').trim() && !cleanBiz);
  const smsPhone = suspect ? null : (phoneInfo.e164 || null);

  if (smsPhone) {
    const okPhone = await reservePhone(store, smsPhone, key, now);
    if (!okPhone) { result.note = 'duplicate phone, sequence already exists'; return result; }
  }

  const runId = crypto.randomUUID();
  const leadId = leadIdFor(em);
  const record = {
    runId, leadId, email: em,
    first: cleanFirst || 'there',
    biz: cleanBiz,
    phone: smsPhone,
    hasPdf: !!hasPdf, accel, test: isTest,
    industry: safeBiz(industry, 40) || '',
    // Two or three lines of the PDF, spoken back on the call. This is the whole reason
    // the call is not a cold call: the agent knows what we already sent them.
    planSummary: String(planSummary || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    createdAt: now, booked: false, paused: false, stopped: false, stopReason: null,
    sms1: { status: smsPhone ? 'pending' : 'no-phone' },
    steps: computeSchedule(now, accel),
    // The call ladder is always PLANNED (planning costs nothing and keeps the record
    // complete); whether it ever dials is decided at call time by config.callMode.
    calls: smsPhone ? { attempts: computeCallPlan(now, { accel }), stopped: null } : { attempts: [], stopped: 'no-phone' },
  };
  await store.set(key, JSON.stringify(record));
  await store.set(`byid:${leadId}`, key);

  // Tie-break against a concurrent duplicate submission: last writer wins the record,
  // only the surviving runId proceeds to send.
  await new Promise(r => setTimeout(r, 1500));
  const check = await store.get(key, { type: 'json' });
  if (!check || check.runId !== runId) { result.note = 'concurrent duplicate, other writer won'; return result; }

  result.enrolled = true;
  result.leadId = leadId;
  result.stopUrl = stopUrlFor(em);

  // SMS#1: direct send (no sleep; the PDF pipeline already provides the natural ~2 min delay)
  const emode = cfg.mode === 'test' ? (isTest ? 'live' : 'dry') : cfg.mode;
  if (!record.phone) {
    result.sms1 = suspect ? 'suspect form values, email-only sequence' : 'no AU mobile, email-only sequence';
  } else if (emode === 'off') {
    record.sms1 = { status: 'held-off-mode' };
    result.sms1 = 'held (mode off)';
  } else if (emode === 'dry') {
    record.sms1 = { status: 'dry', at: now };
    result.sms1 = 'dry run, not sent';
  } else if (!accel && !inWindow(now)) {
    // Out of window: SMS#1 is queued for the next opening, and the WHOLE schedule is
    // re-anchored on that send time. Otherwise sms2 (nominal +2h, clamped to the same
    // 9:00) would fire back-to-back with sms1 in the first morning tick.
    const due = clampWindow(now);
    record.sms1 = { status: 'queued', due };
    record.steps = computeSchedule(due, accel);
    result.sms1 = 'queued for 9am Brisbane';
  } else if (!(await reserveSmsSlot(store, now))) {
    record.sms1 = { status: 'capped' };
    result.sms1 = 'daily SMS cap reached';
    await logOpsEvent(store, { type: 'cap-hit', leadId });
  } else {
    try {
      await sendSms({ to: record.phone, body: smsTextFor('sms1', record) });
      record.sms1 = { status: 'sent', at: now };
      result.sms1 = 'sent';
      await logOpsEvent(store, { type: 'sent', step: 'sms1', leadId });
    } catch (e) {
      if (/21610/.test(String(e.message))) {
        // Twilio-side opt-out list: convert into our global suppression so emails stop too.
        await suppress(store, { email: em, e164: record.phone, source: 'twilio-21610' });
        record.stopped = true; record.stopReason = 'twilio-21610';
        await logOpsEvent(store, { type: 'optout', channel: 'sms', leadId });
      }
      record.sms1 = { status: 'failed', err: String(e.message).slice(0, 150) };
      result.sms1 = 'failed: ' + String(e.message).slice(0, 80);
    }
  }
  await store.set(key, JSON.stringify(record));
  return result;
}
