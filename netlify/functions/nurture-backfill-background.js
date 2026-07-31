// One-off backfill: re-engage existing CRM leads that never got a follow-up.
// For each lead it rebuilds a real plan (site fetch -> Claude -> PDFShift), re-sends the
// t=0 email with the honest "we owed you a follow-up" opener, then enrols the lead in
// the nurture sequence. Admin only, HMAC-authenticated, dry-run by default.
//
// SMS is opt-in PER LEAD (`sms: true`), never inferred: leads who enquired before the
// SMS consent line went live must not be texted unless explicitly included in the batch.

import { fetchBrandAssets, buildEmail, buildPdfHtml } from './lib/lead-render.js';
import {
  generateSpinContent, fetchSiteContent, renderPdf, slugify,
} from './submission-created-background.js';
import {
  enqueueNurture, leadIdFor, unsubUrlFor, hmacToken, safeEqual, HMAC_READY,
  nurtureStore, leadKeyFor, DEDUPE_MS,
} from './lib/nurture.js';
import { smsTextFor } from './lib/nurture-copy.js';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!HMAC_READY) return new Response('unconfigured', { status: 503 });

  const token = req.headers.get('x-backfill-token') || '';
  if (!safeEqual(token, hmacToken('backfill'))) return new Response('Forbidden', { status: 403 });

  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const dry = body.dry !== false; // dry unless explicitly disabled
  const leads = Array.isArray(body.leads) ? body.leads.slice(0, 60) : [];
  if (!leads.length) return json({ error: 'no leads' }, 400);

  const store = nurtureStore();
  const report = [];
  for (const lead of leads) {
    const email = String(lead.email || '').trim();
    const firstName = String(lead.firstName || 'there').trim() || 'there';
    const businessName = String(lead.businessName || '').trim();
    const website = String(lead.website || '').trim();
    const industry = String(lead.industry || '').trim();
    const phone = lead.sms ? String(lead.phone || '').trim() : ''; // no SMS unless opted in for this lead
    const row = { email: mask(email), firstName, biz: businessName, sms: !!lead.sms, steps: [] };

    if (!email) { row.steps.push('skipped: no email'); report.push(row); continue; }

    // Idempotence: a lead already enrolled must never get a second plan email.
    // This run may be a retry after a timeout, so check BEFORE any send.
    try {
      const existing = await store.get(leadKeyFor(email), { type: 'json' });
      if (existing && Date.now() - existing.createdAt < DEDUPE_MS) {
        row.steps.push('skipped: already enrolled');
        report.push(row);
        continue;
      }
    } catch { /* on a read failure, fall through to the enqueue dedupe */ }

    if (dry) {
      row.steps.push('DRY: would rebuild plan, re-send t=0 email, enrol' + (lead.sms ? ' with SMS' : ' email-only'));
      report.push(row);
      continue;
    }

    const leadId = leadIdFor(email);
    let unsubUrl = null;
    try { unsubUrl = unsubUrlFor(email); } catch { /* link only */ }

    // 1. Rebuild the plan from scratch.
    let siteContent = null, brand = { logoDataUri: null, accent: null };
    if (website) {
      try { siteContent = await fetchSiteContent(website); } catch (e) { row.steps.push('site fetch failed'); }
      try { brand = await fetchBrandAssets(website); } catch { /* fallback branding */ }
    }
    let spin = null;
    try {
      spin = await generateSpinContent({ firstName, businessName, website, industry, packageInterest: '', timeEater: '', siteContent });
      row.steps.push('plan generated');
    } catch (e) { row.steps.push('plan FAILED: ' + String(e.message).slice(0, 80)); }

    let pdfBase64 = null;
    if (spin) {
      try {
        pdfBase64 = await renderPdf(buildPdfHtml({ businessName, industry, spin, brand, leadId }));
        row.steps.push('pdf rendered');
      } catch (e) { row.steps.push('pdf FAILED: ' + String(e.message).slice(0, 80)); }
    }
    const hasPdf = !!pdfBase64;

    // 2. Re-send the t=0 email, with the returning-lead opener.
    const { html, text } = buildEmail({
      firstName, businessName, industry, packageInterest: '', hasPdf, brand, leadId, unsubUrl, returning: true,
    });
    const payload = {
      from: 'TurnkeyAI <start@tkai.com.au>',
      reply_to: 'start@tkai.com.au',
      to: [email],
      subject: hasPdf
        ? `${firstName}, your AI plan for ${businessName || 'your business'} (rebuilt, PDF attached)`
        : `${firstName}, we owe you a follow-up`,
      html, text,
    };
    if (unsubUrl) {
      payload.headers = {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };
    }
    if (hasPdf) {
      payload.attachments = [{
        filename: `TurnkeyAI-deployment-plan-${slugify(businessName || firstName)}.pdf`,
        content: pdfBase64,
        content_type: 'application/pdf',
      }];
    }
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
      row.steps.push('t=0 email sent');
    } catch (e) {
      row.steps.push('EMAIL FAILED: ' + String(e.message).slice(0, 100));
      report.push(row);
      continue; // no sequence for someone who did not get the plan
    }

    // 3. Enrol in the nurture sequence. Same guards as a live submission.
    try {
      const res = await enqueueNurture({
        email, firstName, businessName, phone,
        data: { page: 'crm-backfill' }, hasPdf, smsTextFor,
      });
      row.steps.push(`enrolled: ${res.enrolled ? 'yes' : 'no (' + res.note + ')'}${res.enrolled ? ', sms1 ' + res.sms1 : ''}`);
    } catch (e) {
      row.steps.push('ENROL FAILED: ' + String(e.message).slice(0, 100));
    }
    report.push(row);
  }

  // Background function: the caller already got a 202, so the report goes to the
  // ops journal and to the team inbox instead of the HTTP response.
  const done = report.filter(r => r.steps.some(s => s.includes('t=0 email sent'))).length;
  const skipped = report.filter(r => r.steps.some(s => s.includes('already enrolled'))).length;
  const failed = report.filter(r => r.steps.some(s => s.includes('FAILED'))).length;
  const summary = `Backfill finished. ${done} plans sent, ${skipped} already enrolled (skipped), ${failed} failed, ${report.length} processed.`;
  console.log(summary, JSON.stringify(report));
  if (!dry) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'TurnkeyAI Nurture <start@tkai.com.au>',
          to: [(process.env.NURTURE_DIGEST_EMAILS || 'help@bwpg.com.au').split(',')[0].trim()],
          subject: summary.slice(0, 90),
          text: summary + '\n\n' + report.map(r => `${r.email} sms=${r.sms} :: ${r.steps.join(' | ')}`).join('\n'),
        }),
      });
    } catch (e) { console.error('Backfill report email failed:', e.message); }
  }
  return json({ dry, count: report.length, done, skipped, failed, report });
};

function mask(e) {
  const [u, d] = String(e).split('@');
  return d ? `${u.slice(0, 2)}***@${d}` : '***';
}
function json(o, status = 200) {
  return new Response(JSON.stringify(o, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}
