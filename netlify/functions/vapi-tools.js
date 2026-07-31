// The two tools the voice agent can call mid-conversation.
//
// Why it works this way: Calendly has NO public endpoint to create a booking (verified
// 31/07/2026, POST /scheduled_events returns 404), but `event_type_available_times` DOES
// work on the free plan and returns a per-slot scheduling URL. So the agent reads real
// availability out loud, the lead picks one, and we text them the direct link to that
// exact slot. One tap and it is in the diary. The agent never claims to have booked
// something it cannot book.
//
// Latency budget: the lead is on the phone. Every call here is capped, and every failure
// path returns a sentence the agent can say out loud rather than an error.

import {
  nurtureStore, sendSms, logOpsEvent, safeEqual, leadKeyFor, CALENDLY_URL,
} from './lib/nurture.js';

const BNE_OFFSET = 10 * 3600e3;
const CAL_TIMEOUT_MS = 6000;
const MIN_LEAD_TIME_MS = 2 * 3600e3;  // never offer a slot less than two hours out
const MAX_OPTIONS = 3;                // a phone call cannot hold more than three choices

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = process.env.VAPI_WEBHOOK_SECRET || '';
  if (!secret) return new Response('unconfigured', { status: 503 });
  if (!safeEqual(secret, req.headers.get('x-vapi-secret') || '')) {
    return new Response('Forbidden', { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const msg = body?.message || {};
  const toolCalls = msg.toolCalls || msg.tool_calls || [];
  if (!toolCalls.length) return json({ results: [] });

  const meta = msg.call?.metadata || {};
  const results = [];

  for (const tc of toolCalls) {
    const name = tc.function?.name || tc.name;
    let args = tc.function?.arguments ?? tc.arguments ?? {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }

    try {
      if (name === 'get_available_times') {
        results.push({ toolCallId: tc.id, result: await availableTimes() });
      } else if (name === 'send_booking_link') {
        results.push({ toolCallId: tc.id, result: await sendLink(meta, args) });
      } else {
        results.push({ toolCallId: tc.id, result: 'That tool is not available.' });
      }
    } catch (e) {
      console.error(`vapi-tools ${name} failed:`, e.message);
      // Never hand the agent a stack trace: hand it a sentence it can say.
      results.push({
        toolCallId: tc.id,
        result: 'I could not reach the calendar just now. Offer to text them the booking link instead.',
      });
    }
  }

  return json({ results });
};

async function calendlyFetch(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CAL_TIMEOUT_MS);
  try {
    const r = await fetch(`https://api.calendly.com${path}`, {
      headers: { Authorization: `Bearer ${process.env.CALENDLY_TOKEN}` },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`Calendly ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function slots() {
  const eventType = process.env.CALENDLY_EVENT_TYPE_URI;
  if (!eventType) throw new Error('CALENDLY_EVENT_TYPE_URI not set');
  const now = Date.now();
  // Calendly caps this endpoint at a 7 day span.
  const start = new Date(now + 60e3).toISOString().replace(/\.\d{3}/, '');
  const end = new Date(now + 6.5 * 86400e3).toISOString().replace(/\.\d{3}/, '');
  const d = await calendlyFetch(
    `/event_type_available_times?event_type=${encodeURIComponent(eventType)}`
    + `&start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`,
  );
  return (d.collection || [])
    .filter(s => s.status === 'available' && Date.parse(s.start_time) > now + MIN_LEAD_TIME_MS);
}

// Spread the options across different days and different times of day. Three slots
// thirty minutes apart on the same morning is not a choice, it is one option.
function spread(list) {
  const picked = [], seenDay = new Set();
  for (const s of list) {
    const day = new Date(Date.parse(s.start_time) + BNE_OFFSET).toISOString().slice(0, 10);
    if (seenDay.has(day)) continue;
    seenDay.add(day);
    picked.push(s);
    if (picked.length === MAX_OPTIONS) break;
  }
  return picked;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function speakable(iso) {
  const d = new Date(Date.parse(iso) + BNE_OFFSET);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${DAYS[d.getUTCDay()]} at ${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${ampm}`;
}

async function availableTimes() {
  const all = await slots();
  if (!all.length) {
    return 'No open times in the next week. Offer to text them the booking link so they can pick a later date.';
  }
  const picked = spread(all);
  const lines = picked.map(s => `${speakable(s.start_time)} (slot id ${s.start_time})`);
  return `Open times, all Brisbane time: ${lines.join('; ')}. `
    + `Offer these three out loud in natural language. When they pick one, call send_booking_link `
    + `with the exact slot id shown in brackets.`;
}

async function sendLink(meta, args) {
  const phone = String(meta.phone || '');
  const email = String(meta.email || '');
  const first = String(meta.firstName || '').trim();
  if (!phone) return 'No mobile on file for this lead, so I cannot text them. Read out the link instead: ' + CALENDLY_URL;

  const wanted = String(args.slot || args.startTime || '').trim();
  let url = CALENDLY_URL, when = 'a time that suits you';

  if (wanted) {
    // Re-check availability: between offering the slot and confirming it, someone else
    // may have taken it. Sending a link to a dead slot wastes the whole call.
    const still = (await slots()).find(s => s.start_time === wanted);
    if (!still) {
      return 'That time has just been taken. Apologise briefly, offer the next best time, and call get_available_times again.';
    }
    url = still.scheduling_url || `${CALENDLY_URL}/${wanted}`;
    when = speakable(wanted);
  }

  const qs = new URLSearchParams();
  if (first) qs.set('name', first);
  if (email) qs.set('email', email);
  const link = qs.toString() ? `${url}?${qs}` : url;

  const body = `${first ? first + ', ' : ''}here's the link to lock in ${when} with Mael at Turn Key AI: ${link} `
    + `One tap and you're in. Reply STOP to opt out.`;
  await sendSms({ to: phone, body });

  const store = nurtureStore();
  await logOpsEvent(store, { type: 'booking-link-sent', leadId: meta.leadId, slot: wanted || 'open' });
  if (email) {
    try {
      const key = leadKeyFor(email);
      const rec = await store.get(key, { type: 'json' });
      if (rec) {
        rec.calls = { ...(rec.calls || {}), linkSentAt: Date.now(), linkSlot: wanted || null };
        await store.set(key, JSON.stringify(rec));
      }
    } catch { /* the SMS is what matters, the record is bookkeeping */ }
  }

  return `Link texted for ${when}. Tell them it has just landed on their phone, ask them to tap it while you are still on the line if they can, then wrap up warmly.`;
}

function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
}
