// Outbound voice layer: when to call, how often, and never outside the law.
//
// Same delivery model as the SMS/email sequence: nothing is ever scheduled inside
// Vapi or Twilio. A call plan is written per lead and nurture-poller.js dials the due
// attempt after re-checking every guard at call time. The global mode blob stops
// every call in under five minutes, with no redeploy.
//
// Legal frame: Telecommunications (Do Not Call Register) (Telemarketing and Research
// Calls) Industry Standard 2017. It allows weekdays 9:00-20:00 and Saturday 9:00-17:00,
// and forbids Sundays and public holidays. We deliberately sit INSIDE those bounds:
// weekdays only, 9:00-18:30 Brisbane. A Saturday call about business software costs
// more in goodwill than the extra slot is worth.

// Deliberately imports nothing from nurture.js: that module imports THIS one to plan
// the ladder at enrolment, and a cycle between them is a debugging trap nobody needs.
// brisbaneDay is two lines, so it lives here too.
const BNE_OFFSET = 10 * 3600e3; // Australia/Brisbane, UTC+10, no DST
const bris = ms => new Date(ms + BNE_OFFSET);
const brisbaneDay = ms => bris(ms).toISOString().slice(0, 10);

export const CALL_WINDOW_START = 9;      // 9:00 Brisbane, the legal floor
export const CALL_WINDOW_END = 18.5;     // 18:30 Brisbane, well inside the 20:00 ceiling
export const MAX_CALL_ATTEMPTS = 4;
export const DAILY_CALL_CAP = 30;
export const CALL_STALE_MS = 36 * 3600e3; // an attempt this late is dropped, never late-blasted
export const FIRST_CALL_DELAY_MS = 40 * 60e3; // let the plan email and SMS#1 land first

// Queensland public holidays 2026, verified against qld.gov.au on 31/07/2026. Calling
// on one of these is a breach, so this list is a hard dependency: re-verify every year.
// Two entries are deliberately conservative rather than strictly required: 24/12 is only
// a part-day holiday (18:00 to midnight) and 28/12 may or may not be gazetted as the
// Boxing Day substitute. Blocking a day we could legally have used costs one call slot;
// getting it wrong costs a breach.
export const QLD_PUBLIC_HOLIDAYS = [
  '2026-01-01', '2026-01-26', '2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-04-25', '2026-05-04', '2026-08-12', '2026-10-05', '2026-12-24', '2026-12-25',
  '2026-12-26', '2026-12-28',
];

// Time bands, in Brisbane hours. Retries rotate through them: calling the same person
// at the same hour four times just misses the same meeting four times.
export const CALL_BANDS = [
  { start: 10, end: 11.5, label: 'late morning' },
  { start: 15, end: 16.5, label: 'mid afternoon' },
  { start: 9, end: 10, label: 'early morning' },
  { start: 17, end: 18.5, label: 'end of day' },
];

// Business days between attempt N and attempt N+1. Spread widening on purpose: someone
// who has ignored three calls is not going to answer a fourth the next morning.
const ATTEMPT_GAP_DAYS = [0, 1, 3, 7];

export function isPublicHoliday(ms) {
  return QLD_PUBLIC_HOLIDAYS.includes(brisbaneDay(ms));
}

export function isCallableDay(ms) {
  const day = bris(ms).getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day >= 1 && day <= 5 && !isPublicHoliday(ms);
}

export function inCallWindow(ms) {
  if (!isCallableDay(ms)) return false;
  const d = bris(ms);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= CALL_WINDOW_START && h < CALL_WINDOW_END;
}

// Snap `fromMs` forward to the next callable moment, ignoring bands. Used for the FIRST
// attempt only: speed to lead is the whole point, so a lead who submits at 15:00 on a
// Friday gets called at 15:40 that Friday, not snapped into Monday's morning band.
export function nextCallableMoment(fromMs) {
  let cursor = fromMs;
  for (let i = 0; i < 30; i++) {
    const d = bris(cursor);
    if (isCallableDay(cursor)) {
      const h = d.getUTCHours() + d.getUTCMinutes() / 60;
      if (h < CALL_WINDOW_START) return cursor + Math.round((CALL_WINDOW_START - h) * 3600e3);
      if (h < CALL_WINDOW_END) return cursor;
    }
    cursor = cursor - ((d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()) * 1000) + 86400e3;
  }
  return null;
}

// Snap `fromMs` forward to the next moment inside `band` on a callable day.
export function nextSlotInBand(fromMs, band) {
  let cursor = fromMs;
  for (let i = 0; i < 30; i++) { // 30 days is far beyond any real schedule
    const d = bris(cursor);
    if (isCallableDay(cursor)) {
      const h = d.getUTCHours() + d.getUTCMinutes() / 60;
      if (h < band.start) {
        return cursor + Math.round((band.start - h) * 3600e3);
      }
      if (h < band.end) return cursor; // already inside the band
    }
    // Move to the start of the next Brisbane day and retry.
    const startOfNextDay = cursor - ((d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()) * 1000)
      + 86400e3;
    cursor = startOfNextDay;
  }
  return null; // no slot found: caller must treat this as "do not call"
}

// One pass, monotone: every attempt is strictly after the previous one, inside a
// callable window, in a different time band from the attempt before it.
export function computeCallPlan(now, { accel = 0 } = {}) {
  const attempts = [];
  let prev = now;
  for (let i = 0; i < MAX_CALL_ATTEMPTS; i++) {
    let due;
    if (accel) {
      // Test mode: the whole ladder collapses into minutes, windows ignored.
      due = Math.max(now + (i === 0 ? 60e3 : 0) + i * 4 * 60e3, prev + 60e3);
    } else if (i === 0) {
      due = nextCallableMoment(now + FIRST_CALL_DELAY_MS);
      if (due === null) break;
    } else {
      const band = CALL_BANDS[i % CALL_BANDS.length];
      due = nextSlotInBand(Math.max(addBusinessDays(prev, ATTEMPT_GAP_DAYS[i]), prev + 3600e3), band);
      if (due === null) break;
    }
    attempts.push({
      n: i + 1,
      due,
      status: 'pending',
      attempts: 0,
      band: accel ? 'accel' : (i === 0 ? 'asap' : CALL_BANDS[i % CALL_BANDS.length].label),
    });
    prev = due;
  }
  return attempts;
}

function addBusinessDays(fromMs, days) {
  let cursor = fromMs, added = 0;
  while (added < days) {
    cursor += 86400e3;
    if (isCallableDay(cursor)) added++;
  }
  return cursor;
}

// An attempt stuck in 'dialing' means the end-of-call webhook never arrived. Without
// this the whole ladder wedges on one lost webhook.
export const DIALING_TIMEOUT_MS = 15 * 60e3;

// Place the call. The Twilio number is passed TRANSIENTLY (phoneNumber, not
// phoneNumberId) on purpose: importing it into Vapi would rewrite the number's voice
// webhook and kill the inbound forwarding to Mael's mobile, and with smsEnabled unset
// it would also hijack the SMS webhook that carries every STOP. Transient keeps Twilio
// untouched while the lead still sees the number that texted them.
export async function placeVapiCall({ rec, attempt }) {
  const key = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  const from = process.env.TKAI_CALL_FROM || '+61485035252';
  if (!key || !assistantId) throw new Error('VAPI_API_KEY or VAPI_ASSISTANT_ID missing');

  const payload = {
    assistantId,
    phoneNumber: {
      twilioPhoneNumber: from,
      twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
      twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
      smsEnabled: false, // never let Vapi touch the messaging webhook
    },
    customer: { number: rec.phone, name: rec.first || undefined },
    name: `nurture-${rec.leadId}-attempt-${attempt.n}`,
    metadata: {
      leadId: rec.leadId,
      email: rec.email,
      phone: rec.phone,
      firstName: rec.first || '',
      attempt: attempt.n,
    },
    assistantOverrides: {
      variableValues: {
        firstName: rec.first || 'there',
        businessName: rec.biz || 'your business',
        industry: rec.industry || '',
        planSummary: rec.planSummary || '',
        daysSincePlan: String(Math.max(0, Math.round((Date.now() - (rec.createdAt || Date.now())) / 86400e3))),
        attemptNumber: String(attempt.n),
      },
    },
  };

  const r = await fetch('https://api.vapi.ai/call', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Vapi ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Atomic daily call cap, same compare-and-swap pattern as the SMS cap. A runaway
// scheduler must not be able to dial a thousand numbers on our Twilio balance.
export async function reserveCallSlot(store, nowMs, cap = DAILY_CALL_CAP) {
  const key = `callcount:${brisbaneDay(nowMs)}`;
  for (let i = 0; i < 5; i++) {
    const got = await store.getWithMetadata(key, { type: 'json' });
    const cur = (got && got.data) || { calls: 0 };
    if (cur.calls >= cap) return false;
    const next = JSON.stringify({ calls: cur.calls + 1 });
    const res = got
      ? await store.set(key, next, { onlyIfMatch: got.etag })
      : await store.set(key, next, { onlyIfNew: true });
    if (res.modified) return true;
    await new Promise(r => setTimeout(r, 40 + Math.random() * 120));
  }
  return false; // persistent contention: prefer not calling
}
