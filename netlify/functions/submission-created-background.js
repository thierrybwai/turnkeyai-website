// Triggered automatically by Netlify whenever a form on the site is submitted.
// Background function (15-min timeout). Routes by form_name:
//   - 'ai-audit'       → lead form: Claude + PDFShift + branded PDF email
//   - 'support-ticket' → support ticket: confirmation email + team email + dispatch to ops Mac Mini agent
//
// All steps try/catch'd, email always sent.

import { handleSupportTicket } from './lib/support-handler.js';

export default async (req) => {
  try {
    const payload = await req.json();
    const data = payload?.payload?.data || {};
    const formName = payload?.payload?.form_name || '';

    // Route by form name
    if (formName === 'support-ticket') {
      return await handleSupportTicket({ data });
    }
    if (formName !== 'ai-audit') {
      return new Response('Ignored: not a handled form', { status: 200 });
    }

    const firstName = (data.firstName || 'there').trim();
    const lastName = (data.lastName || '').trim();
    const email = (data.email || '').trim();
    const phone = (data.phone || '').trim();
    const businessName = (data.businessName || '').trim();
    const website = (data.website || '').trim();
    const industry = (data.industry || '').trim();
    const packageInterest = (data.packageInterest || '').trim();

    if (!email) {
      return new Response('No email on submission', { status: 200 });
    }

    const leadCtx = { firstName, lastName, email, phone, businessName, website, industry, packageInterest };

    // 0. Push the lead into the Base44 SalesFlow CRM (TKAI pipeline) FIRST, so the lead is
    //    captured even if Claude / PDFShift / Resend later fail. Non-blocking, never throws.
    await pushToBase44CRM(leadCtx);

    // 1a. Fetch the lead's website (graceful skip if missing/fails)
    let siteContent = null;
    if (website) {
      try {
        siteContent = await fetchSiteContent(website);
        console.log(`Site content fetched: ${siteContent ? siteContent.length + ' chars' : 'empty'}`);
      } catch (err) {
        console.error('Site fetch failed:', err.message);
      }
    }

    // 1b. Generate SPIN content via Claude (graceful fallback if it fails)
    let spin = null;
    try {
      spin = await generateSpinContent({ ...leadCtx, siteContent });
      console.log('Claude SPIN content generated successfully');
    } catch (err) {
      console.error('Claude generation failed:', err.message);
    }

    // 2. Render PDF via PDFShift (skip if no SPIN content)
    let pdfBase64 = null;
    if (spin) {
      try {
        const pdfHtml = buildPdfHtml({ ...leadCtx, spin });
        pdfBase64 = await renderPdf(pdfHtml);
        console.log('PDFShift rendered PDF, size:', pdfBase64.length, 'chars (base64)');
      } catch (err) {
        console.error('PDFShift rendering failed:', err.message);
      }
    }

    // 3. Build & send email (with or without PDF attachment)
    const hasPdf = !!pdfBase64;
    const subject = hasPdf
      ? `${firstName}, your personalized AI deployment plan (PDF attached)`
      : `We've started, ${firstName}. One quick task for you.`;
    const { html, text } = buildEmail({ firstName, businessName, industry, packageInterest, hasPdf });

    const emailPayload = {
      from: 'TurnkeyAI <start@tkai.com.au>',
      reply_to: 'start@tkai.com.au',
      to: [email],
      // Send the team an exact copy of what the lead receives, PDF attachment included.
      // (Restores the pre-7cf7e54 behaviour: the dedicated team notification has no PDF.)
      bcc: (process.env.LEAD_BCC_EMAILS || 'start@tkai.com.au').split(',').map(s => s.trim()).filter(Boolean),
      subject,
      html,
      text,
    };

    if (hasPdf) {
      emailPayload.attachments = [{
        filename: `TurnkeyAI-deployment-plan-${slugify(businessName || firstName)}.pdf`,
        content: pdfBase64,
        content_type: 'application/pdf',
      }];
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text();
      console.error('Resend API error:', resendRes.status, errBody);
      // Still try to alert the team even if the lead email failed — a lead is too valuable to lose silently.
      await sendTeamLeadNotification(leadCtx, hasPdf).catch(() => {});
      return new Response(`Resend failed: ${resendRes.status}`, { status: 502 });
    }

    // Dedicated team notification — a clear "new lead" alert, separate from the lead's audit email.
    await sendTeamLeadNotification(leadCtx, hasPdf);

    return new Response(`Email sent${hasPdf ? ' with PDF' : ' (no PDF)'}`, { status: 200 });
  } catch (err) {
    console.error('submission-created-background error:', err);
    return new Response('Error', { status: 500 });
  }
};

// ─────────────────────────────────────────────────────
// TEAM LEAD NOTIFICATION — a clear "new lead" alert to the team.
// Separate from the lead's audit email. Never throws.
// Recipients: LEAD_NOTIFY_EMAILS (comma-separated) | LEAD_FORWARD_EMAIL | start@tkai.com.au
// ─────────────────────────────────────────────────────
async function sendTeamLeadNotification(lead, hasPdf) {
  try {
    const notifyRaw = (process.env.LEAD_NOTIFY_EMAILS || process.env.LEAD_FORWARD_EMAIL || 'start@tkai.com.au').trim();
    const to = notifyRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!to.length) return;

    const { firstName, lastName, email, phone, businessName, website, industry, packageInterest } = lead;
    const name = `${firstName} ${lastName}`.trim() || 'New lead';
    const industryLabel = prettyIndustry(industry) || industry || 'Not specified';
    const subject = `🔔 New lead: ${name}${businessName ? ' — ' + businessName : ''} (${industryLabel})`;

    const rows = [
      ['Name', name],
      ['Business', businessName || '—'],
      ['Email', email || '—'],
      ['Phone', phone || '—'],
      ['Website', website || '—'],
      ['Industry', industryLabel],
      ['Package interest', prettyPackage(packageInterest) || '—'],
      ['Audit PDF', hasPdf ? 'Generated + emailed to the lead' : 'Not generated (Claude/PDF step failed)'],
    ];

    const text = `New lead from the website form.\n\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
      `\n\nThe lead is in the TKAI pipeline (Base44). Reply to this email to reach ${firstName} directly.`;

    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif;color:#1d1d1f;line-height:1.55;">
<div style="max-width:600px;margin:0 auto;padding:32px 24px;">
  <p style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#0071e3;font-weight:600;margin:0 0 8px;">New website lead</p>
  <h1 style="font-size:22px;margin:0 0 20px;letter-spacing:-0.01em;">${escapeHtml(name)}${businessName ? ' &middot; ' + escapeHtml(businessName) : ''}</h1>
  <table cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:14px;width:100%;border:1px solid #e8e8ed;">
    ${rows.map(([k, v], i) => `<tr><td style="padding:13px 18px;${i < rows.length - 1 ? 'border-bottom:1px solid #f0f0f2;' : ''}width:38%;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#86868b;font-weight:600;vertical-align:top;">${escapeHtml(k)}</td><td style="padding:13px 18px;${i < rows.length - 1 ? 'border-bottom:1px solid #f0f0f2;' : ''}font-size:14px;color:#1d1d1f;">${k === 'Email' ? `<a href="mailto:${escapeHtml(v)}" style="color:#0071e3;">${escapeHtml(v)}</a>` : k === 'Website' && v !== '—' ? `<a href="${escapeHtml(v.startsWith('http') ? v : 'https://' + v)}" style="color:#0071e3;">${escapeHtml(v)}</a>` : escapeHtml(v)}</td></tr>`).join('')}
  </table>
  <p style="font-size:13px;color:#6e6e73;margin-top:20px;">The lead is in your TKAI pipeline (Base44). Reply to this email to reach ${escapeHtml(firstName)} directly.</p>
</div></body></html>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'TurnkeyAI Leads <start@tkai.com.au>',
        reply_to: email || 'start@tkai.com.au',
        to,
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      console.error(`Team lead notification failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    } else {
      console.log(`Team lead notification sent to ${to.join(', ')}`);
    }
  } catch (err) {
    console.error('sendTeamLeadNotification error:', err.message);
  }
}

// ─────────────────────────────────────────────────────
// BASE44 SalesFlow CRM — push lead into the TKAI pipeline
// Calls the receiveTurnkeyLead cloud function. Dedups by email on Base44's side.
// Never throws: a CRM failure must not block the lead's audit email.
// ─────────────────────────────────────────────────────
async function pushToBase44CRM({ firstName, lastName, email, phone, businessName, website, industry, packageInterest }) {
  const url = (process.env.BASE44_RECEIVE_LEAD_URL || '').trim();
  const secret = (process.env.TURNKEY_WEBSITE_SECRET || '').trim();
  if (!url || !secret) {
    console.log('Base44 CRM not configured (BASE44_RECEIVE_LEAD_URL / TURNKEY_WEBSITE_SECRET missing) — skipping');
    return;
  }

  const endpoint = `${url}?secret=${encodeURIComponent(secret)}`;
  const body = JSON.stringify({
    firstName, lastName, email, phone, businessName, website,
    industry: prettyIndustry(industry) || industry || '',
    source: 'website-audit-form',
    value: 0,
    metadata: {
      packageInterest: packageInterest || '',
      submittedVia: 'turnkeyai.com.au ai-audit form',
    },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`Base44 CRM push failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    } else {
      const out = await res.json().catch(() => ({}));
      console.log(`Base44 CRM: deal ${out.deal_id || '?'} (isNew=${out.isNew})`);
    }
  } catch (err) {
    console.error('Base44 CRM push error:', err.message);
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────
// CLAUDE — SPIN content generation
// ─────────────────────────────────────────────────────
async function generateSpinContent({ firstName, businessName, website, industry, packageInterest, siteContent }) {
  const industryLabel = prettyIndustry(industry) || 'their business';
  const businessLabel = businessName || 'their business';
  const packageLabel = prettyPackage(packageInterest);
  const siteBlock = siteContent
    ? `\n\nReal website content from ${website} (use specific details from this — services they offer, team size, suburbs, named tools, anything that proves you actually read their site):\n----- SITE CONTENT START -----\n${siteContent}\n----- SITE CONTENT END -----\n\nReference at least 2 specific facts from the site in your output (e.g. an actual service they advertise, a suburb they serve, a tool they mention, a tagline they use). Make it obvious you've done your homework.`
    : '';

  const systemPrompt = `You are a senior sales strategist for TurnkeyAI, a done-for-you AI automation service for Australian SMEs.

TurnkeyAI's offer in one line: we deploy a complete AI system (powered by Claude) on a Mac Mini installed in the client's office, live in 7 business days, with hardware they own forever. Workflows are operated via Slack or Telegram in plain English.

Hard facts you can use (do not invent others):
- Packages: Cloud OpenClaw $2,999 AUD (hosted on a dedicated VPS we manage, 3 workflows, remote setup, 30-day support, 12 months hosting included) and Mac Mini $5,999 AUD (1 Apple Mac Mini M4 yours to keep, 5 workflows, on-site setup in Gold Coast or Brisbane, 30-day support). Pick the right one based on whether the client wants on-premise hardware or a cloud-managed setup.
- Average client savings: $1,500-$2,000 per week per Mac Mini.
- Average break-even: 3 weeks.
- Average Year-1 ROI: 13x.
- 50+ Australian SMEs deployed.
- Industries we've done: accounting/bookkeeping, real estate/property management, law firms, medical/allied health clinics, trades (plumbing/electrical), hospitality/hotels/STR, recruitment, marketing agencies, e-commerce, consulting.
- Australian FTE cost reference: $65,000-$85,000/year base salary, before super/leave/turnover.

Brand voice rules:
- Direct, specific, chiffré. "Save 14 hours a week" beats "maximize productivity."
- Reader-centric (you/your), not "we help businesses".
- No em-dashes (—). Use periods, commas, colons.
- Banned words: elevate, seamless, leverage, robust, unleash, supercharge, unlock, journey, ecosystem, paradigm, synergy, holistic, cutting-edge, next-gen, world-class, best-in-class, game-changer, frictionless.
- No exclamation marks. No emojis.
- Sentences ≤22 words. Paragraphs ≤3 sentences.

Your task: generate a personalized SPIN-selling deployment plan for a specific lead. Reply with ONLY valid JSON matching the schema below. No prose, no markdown, no explanation. Make every value specific to the lead's industry. Use real numbers, real workflow names. Be honest and credible — under-promise specific figures, don't inflate.`;

  const userPrompt = `Lead context:
- First name: ${firstName}
- Business: ${businessLabel}
- Website: ${website || 'not provided'}
- Industry: ${industryLabel}${packageLabel ? `\n- Package they mentioned: ${packageLabel}` : ''}${siteBlock}

Generate JSON in this exact shape:

{
  "headline": "Cover headline (max 9 words, second person, addresses their business by name)",
  "subheadline": "One sentence (max 22 words) framing why this plan is for them specifically.",
  "situation_intro": "One short paragraph (2 sentences) acknowledging what we understand about their business and industry.",
  "situation_observations": [
    "Observation 1 (specific to ${industryLabel}, ≤22 words)",
    "Observation 2",
    "Observation 3"
  ],
  "problems": [
    { "title": "Problem 1 short title (≤6 words)", "detail": "Detail in their language (≤30 words). Where time and money leak in ${industryLabel}." },
    { "title": "Problem 2 short title", "detail": "Detail." },
    { "title": "Problem 3 short title", "detail": "Detail." }
  ],
  "implication": {
    "headline": "The cost-of-inaction punchline, e.g. '$32,000 walks out the door this year'",
    "annual_cost_aud": "Numeric label, e.g. '$28,000 - $42,000'",
    "hours_per_week": "Numeric label, e.g. '12 to 18 hours'",
    "fte_equivalent": "Decimal FTE, e.g. '0.4 - 0.6 FTE'",
    "narrative": "2-3 sentences making the cost vivid for ${businessLabel}. Be specific to ${industryLabel}."
  },
  "workflows": [
    { "name": "Workflow name (≤4 words)", "what": "What it does for ${industryLabel} (≤25 words)", "saves": "Specific time saved, e.g. '8h per week'" },
    { "name": "Workflow 2 name", "what": "What it does", "saves": "Time saved" },
    { "name": "Workflow 3 name", "what": "What it does", "saves": "Time saved" }
  ],
  "recommended_package": "Cloud | Mac Mini",
  "package_rationale": "1 sentence (≤25 words) explaining why this tier fits their stage.",
  "year_one_roi": "ROI figure, e.g. '13x' or '$78,000 net first year'",
  "break_even_weeks": "Integer or short range, e.g. '3' or '3-4'",
  "next_step": "One specific call to action for ${firstName} (≤20 words). Don't be generic."
}

Industry-specific notes for ${industryLabel}:
- If accountants: workflows like BAS prep, receipt triage, client query inbox, year-end follow-ups, new client onboarding.
- If real estate: maintenance dispatch, tenant comms, listing copy, owner reports, lead qualifier.
- If law firms: client intake, contract review, matter status updates, discovery review, time entry capture.
- If medical/clinics: patient intake, smart scheduling and recalls, Medicare claim review, triage routing, after-hours patient comms.
- If trades: photo-to-quote, job dispatch, job sheet capture, invoicing + follow-up, compliance and warranty tracking.
- If hospitality: guest comms in multiple languages, cleaner dispatch, review reply automation, OTA inbox unification, upsell automation.
- If recruitment: CV screening, interview scheduling, reference checks, offer drafting, onboarding sequence.
- If marketing: client reporting automation, brief-to-draft, status updates, approval chasing, pitch deck assembler.
- If e-commerce: CS triage, refund/return processing, supplier orders, product description generator, review management.
- If consulting: proposal drafting, research and synthesis, deck assembly, status reporting, knowledge management.
- For other industries: infer credible 3 workflows that fit a 5-50 person Australian SME in that sector.

Reply with the JSON object only. No backticks, no markdown fences.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const json = await res.json();
  const text = json?.content?.[0]?.text || '';
  // Strip any accidental markdown fences
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(cleaned);
  return parsed;
}

// ─────────────────────────────────────────────────────
// SITE FETCH — pull text content from lead's website for hyper-personalization
// ─────────────────────────────────────────────────────
async function fetchSiteContent(rawUrl) {
  // Normalize URL: add https:// if missing, strip whitespace
  let url = String(rawUrl).trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  // Validate it's a plausible URL (basic safety filter — no internal/private addresses)
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.') || host.endsWith('.local')) {
    return null; // refuse internal/local hosts
  }

  // Fetch with hard timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let html = '';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'TurnkeyAI-Audit/1.0 (+https://turnkeyai.com.au)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-AU,en;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    // Cap raw response at 200KB to avoid pulling massive pages
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < 200_000) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    reader.cancel();
    const buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
    html = buf.toString('utf8');
  } catch (err) {
    clearTimeout(timeout);
    console.error('fetchSiteContent network error:', err.message);
    return null;
  }

  // Extract title + meta description for high-signal context
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
                 || html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);

  // Strip scripts, styles, html comments, and remaining tags
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const meta = [];
  if (titleMatch?.[1]) meta.push(`TITLE: ${titleMatch[1].trim()}`);
  if (descMatch?.[1]) meta.push(`DESCRIPTION: ${descMatch[1].trim()}`);

  // Cap at 8000 chars total. Front-load with title + description.
  const metaBlock = meta.length ? meta.join('\n') + '\n\nPAGE TEXT:\n' : '';
  const remainingBudget = Math.max(0, 8000 - metaBlock.length);
  return (metaBlock + stripped.slice(0, remainingBudget)).trim();
}

// ─────────────────────────────────────────────────────
// PDFSHIFT — HTML → PDF rendering
// ─────────────────────────────────────────────────────
async function renderPdf(html) {
  const auth = Buffer.from(`api:${process.env.PDFSHIFT_API_KEY}`).toString('base64');
  const res = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: html,
      format: 'A4',
      margin: '0',
      use_print: false,
      sandbox: false, // false = real credit consumed; set to true while QA-ing
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`PDFShift API ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

// ─────────────────────────────────────────────────────
// PDF HTML TEMPLATE — branded, 8 pages, A4 portrait
// ─────────────────────────────────────────────────────
function buildPdfHtml({ firstName, lastName, businessName, industry, packageInterest, spin }) {
  const businessDisplay = businessName || `${firstName}'s business`;
  const industryDisplay = prettyIndustry(industry) || 'your sector';
  const dateLabel = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  const recommendedRaw = (spin.recommended_package || 'Mac Mini').toLowerCase().trim();
  // Normalize Claude's output: accept "cloud", "cloud openclaw", "vps", "mac mini", "mac-mini", "mini"
  const isCloud = /^(cloud|vps)/.test(recommendedRaw);
  const packagePrice = isCloud
    ? { name: 'Cloud OpenClaw', price: '$2,999 AUD', specs: 'Hosted VPS · 3 workflows · remote setup · 30-day support · 12 months hosting included' }
    : { name: 'Mac Mini', price: '$5,999 AUD', specs: '1 Mac Mini M4 yours to keep · 5 workflows · on-site setup · 30-day support' };

  const observationRows = (spin.situation_observations || []).slice(0, 3).map((obs, i) => `
    <div class="obs-row">
      <div class="obs-num">${String(i + 1).padStart(2, '0')}</div>
      <p class="obs-text">${escapeHtml(obs)}</p>
    </div>
  `).join('');

  const problemRows = (spin.problems || []).slice(0, 3).map((p, i) => `
    <div class="problem-card">
      <div class="problem-num">${String(i + 1).padStart(2, '0')}</div>
      <h3 class="problem-title">${escapeHtml(p.title)}</h3>
      <p class="problem-detail">${escapeHtml(p.detail)}</p>
    </div>
  `).join('');

  const workflowRows = (spin.workflows || []).slice(0, 3).map((w) => `
    <div class="workflow-row">
      <div class="workflow-name-col">
        <p class="workflow-eyebrow">Workflow</p>
        <h3 class="workflow-name">${escapeHtml(w.name)}</h3>
      </div>
      <p class="workflow-what">${escapeHtml(w.what)}</p>
      <div class="workflow-saves">
        <p class="workflow-saves-label">Time reclaimed</p>
        <p class="workflow-saves-value">${escapeHtml(w.saves)}</p>
      </div>
    </div>
  `).join('');

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>TurnkeyAI deployment plan — ${escapeHtml(businessDisplay)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Helvetica", "Arial", sans-serif;
    color: #1d1d1f;
    background: #ffffff;
    -webkit-font-smoothing: antialiased;
    letter-spacing: -0.011em;
  }
  .page {
    width: 210mm;
    height: 297mm;
    padding: 22mm 20mm;
    page-break-after: always;
    position: relative;
    overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }

  /* Brand bar (top of every non-cover page) */
  .brand-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #86868b;
    font-weight: 600;
    margin-bottom: 14mm;
  }
  .brand-mark {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #1d1d1f;
    font-size: 13px;
    font-weight: 600;
    text-transform: none;
    letter-spacing: -0.01em;
  }
  .brand-mark::before {
    content: '';
    display: inline-block;
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #0071e3;
  }

  /* Typography */
  .eyebrow {
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #0071e3;
    font-weight: 600;
    margin-bottom: 8mm;
  }
  h1.display {
    font-size: 48pt;
    line-height: 1.02;
    letter-spacing: -0.035em;
    font-weight: 600;
    color: #1d1d1f;
    margin-bottom: 8mm;
  }
  h2.section {
    font-size: 28pt;
    line-height: 1.1;
    letter-spacing: -0.028em;
    font-weight: 600;
    color: #1d1d1f;
    margin-bottom: 8mm;
  }
  h3.sub {
    font-size: 14pt;
    line-height: 1.25;
    letter-spacing: -0.018em;
    font-weight: 600;
    color: #1d1d1f;
    margin-bottom: 4mm;
  }
  p.lede {
    font-size: 13pt;
    line-height: 1.45;
    color: #424245;
    max-width: 145mm;
  }
  p.body {
    font-size: 11pt;
    line-height: 1.55;
    color: #424245;
  }

  /* ── COVER PAGE ── */
  .page-cover {
    background: #0a0a0a;
    color: #ffffff;
    padding: 22mm 20mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    position: relative;
  }
  .page-cover::before {
    content: '';
    position: absolute;
    width: 100mm; height: 100mm;
    right: -30mm; top: -30mm;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(0,113,227,0.40) 0%, rgba(0,113,227,0) 70%);
  }
  .page-cover::after {
    content: '';
    position: absolute;
    width: 80mm; height: 80mm;
    left: -25mm; bottom: -25mm;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(0,113,227,0.22) 0%, rgba(0,113,227,0) 70%);
  }
  .cover-top { display: flex; align-items: center; gap: 8px; position: relative; z-index: 2; }
  .cover-top .dot { width: 10px; height: 10px; border-radius: 50%; background: #0071e3; }
  .cover-top .brand { font-size: 14pt; font-weight: 600; letter-spacing: -0.015em; }
  .cover-meta {
    position: relative; z-index: 2;
    font-size: 10pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.55);
    font-weight: 600;
    margin-left: auto;
  }
  .cover-headline-block { position: relative; z-index: 2; }
  .cover-eyebrow {
    font-size: 11pt;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: #4aa1ff;
    font-weight: 600;
    margin-bottom: 8mm;
  }
  .cover-headline {
    font-size: 50pt;
    line-height: 0.98;
    letter-spacing: -0.04em;
    font-weight: 600;
    color: #ffffff;
    margin-bottom: 8mm;
    max-width: 170mm;
  }
  .cover-headline .accent {
    background: linear-gradient(180deg, #4aa1ff 0%, #0071e3 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .cover-sub {
    font-size: 14pt;
    line-height: 1.4;
    color: rgba(255,255,255,0.78);
    max-width: 160mm;
    margin-bottom: 8mm;
  }
  .cover-disclaimer {
    font-size: 10pt;
    line-height: 1.5;
    color: rgba(255,255,255,0.50);
    max-width: 160mm;
    font-style: italic;
    padding-top: 6mm;
    border-top: 1px solid rgba(255,255,255,0.12);
  }
  .cover-footer {
    position: relative; z-index: 2;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding-top: 12mm;
    border-top: 1px solid rgba(255,255,255,0.12);
  }
  .cover-prepared {
    font-size: 9pt;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.55);
    font-weight: 600;
    margin-bottom: 3mm;
  }
  .cover-name {
    font-size: 18pt;
    font-weight: 600;
    color: #ffffff;
    letter-spacing: -0.015em;
    margin-bottom: 1mm;
  }
  .cover-business {
    font-size: 11pt;
    color: rgba(255,255,255,0.65);
  }
  .cover-url {
    font-size: 11pt;
    color: rgba(255,255,255,0.65);
  }

  /* ── SITUATION PAGE ── */
  .obs-row {
    display: flex;
    gap: 8mm;
    padding: 8mm 0;
    border-bottom: 1px solid #e8e8ed;
  }
  .obs-row:last-child { border-bottom: none; }
  .obs-num {
    font-size: 22pt;
    line-height: 1;
    font-weight: 600;
    letter-spacing: -0.035em;
    color: #0071e3;
    min-width: 16mm;
  }
  .obs-text {
    font-size: 13pt;
    line-height: 1.4;
    color: #1d1d1f;
    flex: 1;
  }

  /* ── PROBLEM PAGE ── */
  .problem-grid {
    display: flex;
    flex-direction: column;
    gap: 6mm;
  }
  .problem-card {
    padding: 8mm 9mm;
    background: #f5f5f7;
    border-radius: 6mm;
    border-left: 3pt solid #0071e3;
  }
  .problem-num {
    font-size: 11pt;
    font-weight: 600;
    color: #0071e3;
    letter-spacing: 0.06em;
    margin-bottom: 2mm;
  }
  .problem-title {
    font-size: 15pt;
    line-height: 1.25;
    font-weight: 600;
    letter-spacing: -0.018em;
    color: #1d1d1f;
    margin-bottom: 3mm;
  }
  .problem-detail {
    font-size: 11pt;
    line-height: 1.55;
    color: #424245;
  }

  /* ── IMPLICATION PAGE ── */
  .impl-headline {
    font-size: 32pt;
    line-height: 1.08;
    letter-spacing: -0.035em;
    font-weight: 600;
    color: #1d1d1f;
    margin-bottom: 8mm;
    max-width: 160mm;
  }
  .impl-headline .accent {
    background: linear-gradient(180deg, #4aa1ff 0%, #0071e3 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .impl-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6mm;
    margin-bottom: 10mm;
  }
  .impl-stat {
    padding: 8mm;
    background: #fafafa;
    border-radius: 5mm;
  }
  .impl-stat-label {
    font-size: 9pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #86868b;
    font-weight: 600;
    margin-bottom: 4mm;
  }
  .impl-stat-value {
    font-size: 22pt;
    line-height: 1;
    font-weight: 600;
    letter-spacing: -0.028em;
    color: #1d1d1f;
  }
  .impl-narrative {
    font-size: 12pt;
    line-height: 1.55;
    color: #424245;
  }

  /* ── WORKFLOW PAGE ── */
  .workflow-row {
    display: grid;
    grid-template-columns: 55mm 1fr 42mm;
    gap: 6mm;
    padding: 8mm 0;
    align-items: center;
    border-bottom: 1px solid #e8e8ed;
  }
  .workflow-row:last-child { border-bottom: none; }
  .workflow-eyebrow {
    font-size: 9pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #0071e3;
    font-weight: 600;
    margin-bottom: 2mm;
  }
  .workflow-name {
    font-size: 14pt;
    line-height: 1.2;
    font-weight: 600;
    letter-spacing: -0.018em;
    color: #1d1d1f;
  }
  .workflow-what {
    font-size: 11pt;
    line-height: 1.5;
    color: #424245;
  }
  .workflow-saves {
    text-align: right;
    padding-left: 6mm;
    border-left: 1px solid #e8e8ed;
  }
  .workflow-saves-label {
    font-size: 9pt;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #86868b;
    font-weight: 600;
    margin-bottom: 2mm;
  }
  .workflow-saves-value {
    font-size: 13pt;
    font-weight: 600;
    color: #0071e3;
    letter-spacing: -0.018em;
  }

  /* ── PREVIEW CALLOUT (used on workflows page) ── */
  .preview-callout {
    margin-top: 10mm;
    padding: 8mm 9mm;
    background: rgba(0,113,227,0.06);
    border-radius: 5mm;
    border-left: 3pt solid #0071e3;
  }
  .preview-callout-label {
    font-size: 9pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #0071e3;
    font-weight: 600;
    margin-bottom: 3mm;
  }
  .preview-callout p:not(.preview-callout-label) {
    font-size: 10pt;
    line-height: 1.55;
    color: #424245;
  }

  /* ── HOW IT WORKS PAGE ── */
  .how-step {
    display: flex;
    gap: 8mm;
    padding: 7mm 0;
    border-bottom: 1px solid #e8e8ed;
    align-items: center;
  }
  .how-step:last-child { border-bottom: none; }
  .how-day {
    min-width: 28mm;
  }
  .how-day-label {
    font-size: 9pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #86868b;
    font-weight: 600;
  }
  .how-day-value {
    font-size: 28pt;
    line-height: 1;
    font-weight: 600;
    letter-spacing: -0.035em;
    color: #0071e3;
  }
  .how-content h3 { font-size: 13pt; font-weight: 600; margin-bottom: 2mm; color: #1d1d1f; }
  .how-content p { font-size: 11pt; line-height: 1.5; color: #424245; }

  /* ── INVESTMENT PAGE ── */
  .invest-card {
    padding: 12mm;
    background: linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%);
    border-radius: 6mm;
    margin-bottom: 8mm;
    position: relative;
  }
  .invest-card.featured {
    background: #0a0a0a;
    color: #ffffff;
  }
  .invest-recommended-tag {
    position: absolute;
    top: 6mm; right: 8mm;
    background: #0071e3;
    color: #ffffff;
    font-size: 8pt;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    font-weight: 600;
    padding: 2mm 4mm;
    border-radius: 100px;
  }
  .invest-eyebrow {
    font-size: 10pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #4aa1ff;
    font-weight: 600;
    margin-bottom: 4mm;
  }
  .invest-name {
    font-size: 26pt;
    line-height: 1;
    font-weight: 600;
    letter-spacing: -0.028em;
    color: inherit;
    margin-bottom: 3mm;
  }
  .invest-price {
    font-size: 36pt;
    line-height: 1;
    font-weight: 600;
    letter-spacing: -0.035em;
    color: inherit;
    margin-bottom: 4mm;
  }
  .invest-specs {
    font-size: 11pt;
    line-height: 1.45;
    color: rgba(255,255,255,0.72);
    margin-bottom: 6mm;
  }
  .invest-card:not(.featured) .invest-specs { color: #6e6e73; }
  .invest-rationale {
    font-size: 12pt;
    line-height: 1.5;
    color: #ffffff;
    padding-top: 6mm;
    border-top: 1px solid rgba(255,255,255,0.15);
  }
  .invest-roi-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6mm;
    margin-top: 8mm;
  }
  .invest-roi-stat {
    padding: 8mm;
    background: #ffffff;
    border-radius: 5mm;
    border: 1px solid #e8e8ed;
  }
  .invest-roi-label {
    font-size: 9pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #86868b;
    font-weight: 600;
    margin-bottom: 4mm;
  }
  .invest-roi-value {
    font-size: 24pt;
    line-height: 1;
    font-weight: 600;
    letter-spacing: -0.028em;
    color: #0071e3;
  }

  /* ── NEXT STEP PAGE ── */
  .next-step-card {
    padding: 14mm;
    background: #0a0a0a;
    color: #ffffff;
    border-radius: 6mm;
    margin-bottom: 8mm;
    position: relative;
    overflow: hidden;
  }
  .next-step-card::before {
    content: '';
    position: absolute;
    width: 70mm; height: 70mm;
    right: -20mm; top: -20mm;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(0,113,227,0.35) 0%, rgba(0,113,227,0) 70%);
  }
  .next-step-eyebrow {
    font-size: 11pt;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: #4aa1ff;
    font-weight: 600;
    margin-bottom: 6mm;
    position: relative; z-index: 2;
  }
  .next-step-headline {
    font-size: 26pt;
    line-height: 1.1;
    letter-spacing: -0.028em;
    font-weight: 600;
    color: #ffffff;
    margin-bottom: 6mm;
    max-width: 150mm;
    position: relative; z-index: 2;
  }
  .next-step-body {
    font-size: 13pt;
    line-height: 1.5;
    color: rgba(255,255,255,0.85);
    position: relative; z-index: 2;
  }
  .signature {
    margin-top: auto;
    padding-top: 10mm;
    border-top: 1px solid #e8e8ed;
  }
  .sig-label {
    font-size: 9pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #86868b;
    font-weight: 600;
    margin-bottom: 3mm;
  }
  .sig-name {
    font-size: 14pt;
    font-weight: 600;
    letter-spacing: -0.018em;
    color: #1d1d1f;
    margin-bottom: 1mm;
  }
  .sig-meta {
    font-size: 10pt;
    color: #6e6e73;
  }

  /* Footer (subtle on each non-cover page) */
  .page-foot {
    position: absolute;
    bottom: 14mm;
    left: 20mm;
    right: 20mm;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 8pt;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #86868b;
    font-weight: 600;
  }
</style>
</head>
<body>

  <!-- ─────── PAGE 1: COVER ─────── -->
  <section class="page page-cover">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div class="cover-top">
        <span class="dot"></span>
        <span class="brand">TurnkeyAI</span>
      </div>
      <span class="cover-meta">Deployment plan · ${escapeHtml(dateLabel)}</span>
    </div>

    <div class="cover-headline-block">
      <p class="cover-eyebrow">A preview · personalized for ${escapeHtml(businessDisplay)}</p>
      <h1 class="cover-headline">${escapeHtml(spin.headline || `${firstName}, your AI deployment plan.`)}<span class="accent">.</span></h1>
      <p class="cover-sub">${escapeHtml(spin.subheadline || `What we'd build for ${businessDisplay} and what it would save you in year one.`)}</p>
      <p class="cover-disclaimer">A 5-minute preview of what's possible. The full plan, mapped to your exact workflows, tools, and team, lands on our 20-minute call.</p>
    </div>

    <div class="cover-footer">
      <div>
        <p class="cover-prepared">Prepared for</p>
        <p class="cover-name">${escapeHtml(firstName)} ${escapeHtml(lastName)}</p>
        <p class="cover-business">${escapeHtml(businessDisplay)} · ${escapeHtml(industryDisplay)}</p>
      </div>
      <p class="cover-url">turnkeyai.com.au</p>
    </div>
  </section>

  <!-- ─────── PAGE 2: SITUATION ─────── -->
  <section class="page">
    <div class="brand-bar">
      <span class="brand-mark">TurnkeyAI</span>
      <span>Situation · 01</span>
    </div>

    <p class="eyebrow">Where you are</p>
    <h2 class="section">Here's what we see about ${escapeHtml(businessDisplay)}.</h2>
    <p class="lede" style="margin-bottom: 14mm;">${escapeHtml(spin.situation_intro || `As a ${industryDisplay.toLowerCase()} business in Australia, you're navigating the same operational gravity we've seen across our deployments.`)}</p>

    <div>${observationRows}</div>

    <div class="page-foot">
      <span>${escapeHtml(businessDisplay)}</span>
      <span>1 of 8</span>
    </div>
  </section>

  <!-- ─────── PAGE 3: PROBLEM ─────── -->
  <section class="page">
    <div class="brand-bar">
      <span class="brand-mark">TurnkeyAI</span>
      <span>Problem · 02</span>
    </div>

    <p class="eyebrow">Where time and money leak</p>
    <h2 class="section">Three friction points we'd resolve first.</h2>
    <p class="lede" style="margin-bottom: 12mm;">In ${industryDisplay.toLowerCase()}, the same patterns repeat. The good news: each is automatable with a 7-day deployment.</p>

    <div class="problem-grid">${problemRows}</div>

    <div class="page-foot">
      <span>${escapeHtml(businessDisplay)}</span>
      <span>2 of 8</span>
    </div>
  </section>

  <!-- ─────── PAGE 4: IMPLICATION ─────── -->
  <section class="page">
    <div class="brand-bar">
      <span class="brand-mark">TurnkeyAI</span>
      <span>Implication · 03</span>
    </div>

    <p class="eyebrow">The cost of doing nothing</p>
    <h1 class="impl-headline">${escapeHtml(spin.implication?.headline || 'Time and money are leaving the building.')}<span class="accent">.</span></h1>

    <div class="impl-grid">
      <div class="impl-stat">
        <p class="impl-stat-label">Hours / week</p>
        <p class="impl-stat-value">${escapeHtml(spin.implication?.hours_per_week || '12 - 18h')}</p>
      </div>
      <div class="impl-stat">
        <p class="impl-stat-label">Annual cost</p>
        <p class="impl-stat-value">${escapeHtml(spin.implication?.annual_cost_aud || '$30k+')}</p>
      </div>
      <div class="impl-stat">
        <p class="impl-stat-label">FTE equivalent</p>
        <p class="impl-stat-value">${escapeHtml(spin.implication?.fte_equivalent || '0.4 FTE')}</p>
      </div>
    </div>

    <p class="impl-narrative">${escapeHtml(spin.implication?.narrative || '')}</p>

    <div class="page-foot">
      <span>${escapeHtml(businessDisplay)}</span>
      <span>3 of 8</span>
    </div>
  </section>

  <!-- ─────── PAGE 5: NEED-PAYOFF (WORKFLOWS) ─────── -->
  <section class="page">
    <div class="brand-bar">
      <span class="brand-mark">TurnkeyAI</span>
      <span>Solution · 04</span>
    </div>

    <p class="eyebrow">What we'd deploy</p>
    <h2 class="section">Three workflows. Live in seven days.</h2>
    <p class="lede" style="margin-bottom: 12mm;">Each runs on a Mac Mini in your office, operated through Slack or Telegram in plain English. No SaaS subscription. No developers.</p>

    <div>${workflowRows}</div>

    <div class="preview-callout">
      <p class="preview-callout-label">A small example</p>
      <p>These are three of the workflows we'd build for you. The full deployment is broader: typically 5 to 10 workflows tailored to your exact tools and pain points. We map the complete scope on our 20-minute call.</p>
    </div>

    <div class="page-foot">
      <span>${escapeHtml(businessDisplay)}</span>
      <span>4 of 8</span>
    </div>
  </section>

  <!-- ─────── PAGE 6: HOW IT WORKS ─────── -->
  <section class="page">
    <div class="brand-bar">
      <span class="brand-mark">TurnkeyAI</span>
      <span>Timeline · 05</span>
    </div>

    <p class="eyebrow">How it works</p>
    <h2 class="section">From brief to running, in 7 days.</h2>
    <p class="lede" style="margin-bottom: 10mm;">Same playbook we've run 50+ times. No surprises, no scope creep, on-site install on day 7.</p>

    <div class="how-step">
      <div class="how-day"><p class="how-day-label">Day</p><p class="how-day-value">01</p></div>
      <div class="how-content">
        <h3>Onboarding</h3>
        <p>45-minute call. We learn your tools, your workflows, your success criteria. By evening, you have a written deployment plan.</p>
      </div>
    </div>

    <div class="how-step">
      <div class="how-day"><p class="how-day-label">Days</p><p class="how-day-value">02-06</p></div>
      <div class="how-content">
        <h3>Build &amp; stress-test</h3>
        <p>We provision the Mac Mini, build your workflows, wire Slack and Telegram, test against real-looking data. Two Loom videos delivered along the way.</p>
      </div>
    </div>

    <div class="how-step">
      <div class="how-day"><p class="how-day-label">Day</p><p class="how-day-value">07</p></div>
      <div class="how-content">
        <h3>On-site install</h3>
        <p>9am we arrive at your office. By 11am the Mac Mini is plugged in, your team is trained, and the system is running. From that hour, every task it handles is money you're no longer paying a person to do.</p>
      </div>
    </div>

    <div class="page-foot">
      <span>${escapeHtml(businessDisplay)}</span>
      <span>5 of 8</span>
    </div>
  </section>

  <!-- ─────── PAGE 7: INVESTMENT ─────── -->
  <section class="page">
    <div class="brand-bar">
      <span class="brand-mark">TurnkeyAI</span>
      <span>Investment · 06</span>
    </div>

    <p class="eyebrow">Investment &amp; return</p>
    <h2 class="section">${escapeHtml(packagePrice.name)} is what we'd recommend.</h2>
    <p class="lede" style="margin-bottom: 10mm;">${escapeHtml(spin.package_rationale || `Fits the stage and shape of ${businessDisplay}.`)}</p>

    <div class="invest-card featured">
      <span class="invest-recommended-tag">Recommended</span>
      <p class="invest-eyebrow">Package</p>
      <p class="invest-name">${escapeHtml(packagePrice.name)}</p>
      <p class="invest-price">${escapeHtml(packagePrice.price)}</p>
      <p class="invest-specs">${escapeHtml(packagePrice.specs)}</p>
      <p class="invest-rationale">One-time. Hardware yours forever. No subscription. No SaaS.</p>
    </div>

    <div class="invest-roi-grid">
      <div class="invest-roi-stat">
        <p class="invest-roi-label">Break-even</p>
        <p class="invest-roi-value">${escapeHtml(String(spin.break_even_weeks || 3))} weeks</p>
      </div>
      <div class="invest-roi-stat">
        <p class="invest-roi-label">Year-1 ROI</p>
        <p class="invest-roi-value">${escapeHtml(spin.year_one_roi || '13x')}</p>
      </div>
    </div>

    <div class="page-foot">
      <span>${escapeHtml(businessDisplay)}</span>
      <span>6 of 8</span>
    </div>
  </section>

  <!-- ─────── PAGE 8: NEXT STEP ─────── -->
  <section class="page" style="display: flex; flex-direction: column;">
    <div class="brand-bar">
      <span class="brand-mark">TurnkeyAI</span>
      <span>Next step · 07</span>
    </div>

    <div class="next-step-card">
      <p class="next-step-eyebrow">What happens next</p>
      <h2 class="next-step-headline">${escapeHtml(spin.next_step || `${firstName}, here's the one move that gets your AI running.`)}</h2>
      <p class="next-step-body">We've already started on our end. Your brief is in our build queue. We'll be in touch within 2 business hours to schedule your setup call. In the meantime, check your inbox for the one quick task we need from you to keep day 7 on schedule.</p>
    </div>

    <p class="body" style="margin-bottom: 8mm;">If you'd rather reply directly: <strong>start@tkai.com.au</strong>. We read every message and respond personally.</p>

    <div class="signature">
      <p class="sig-label">Prepared by</p>
      <p class="sig-name">TurnkeyAI</p>
      <p class="sig-meta">Done-for-you AI automation for Australian SMEs. Gold Coast, Queensland. · turnkeyai.com.au</p>
    </div>

    <div class="page-foot">
      <span>${escapeHtml(businessDisplay)}</span>
      <span>7 of 8</span>
    </div>
  </section>

</body>
</html>`;
}

// ─────────────────────────────────────────────────────
// EMAIL — text + HTML body (kept clean since the PDF carries the heavy story)
// ─────────────────────────────────────────────────────
function buildEmail({ firstName, businessName, industry, packageInterest, hasPdf }) {
  const recap = [
    businessName && `Business: ${businessName}`,
    industry && `Industry: ${prettyIndustry(industry)}`,
    packageInterest && `Package: ${prettyPackage(packageInterest)}`,
  ].filter(Boolean).join(' · ');

  const text = `Hi ${firstName},

Got your brief. Your AI agent is on our build queue and we've started on our end.${hasPdf ? '\n\nAttached: a personalized deployment plan for your business. It walks through what we\'d build, what it would save you in year one, and the package we\'d recommend.' : ''}

Book a 30-minute call with us to walk through your plan, answer your questions, and lock in your build slot:

→ https://calendly.com/start-tkai/30min

Prefer to wait? We'll reach out within 2 business hours either way.

In the meantime, there's one task for you, and it takes 5 minutes:

Create a new email address for your AI agent.

Why a separate address?
Your agent will read its own inbox, send its own replies, and connect to your tools (CRM, calendar, accounting, support). Keeping it separate from your personal or main business email keeps audit trails clean and access easy to revoke later. We apply this to every deployment.

What to do (5 minutes):

1. Create a new mailbox at your business domain, for example: ai@yourbusiness.com.au. Or a fresh Google Workspace or Microsoft 365 account if that's faster.

2. That's it. Just have the address and a temporary password ready for our call.

${recap ? recap + '\n\n' : ''}On the call, we'll walk through the onboarding form together (it captures all the access details and workflow specifics), and you'll be set up by Day 7.

A note on security: we never ask for passwords by email. All credentials shared on the call are stored encrypted, used only for the one-time setup, and either rotated or fully revoked at your discretion once your agent is operational.

What happens next:
- You create the email address (today, 5 minutes).
- We contact you within 2 business hours to schedule the call.
- On the call, we complete the onboarding form together and capture credentials securely.
- Day 7: your Mac Mini is in your office, your AI agent is running.

Talk soon,
TurnkeyAI

P.S. ${hasPdf ? 'The attached plan is built for ' + (businessName || 'your business') + ' specifically. Read it, then book your call: https://calendly.com/start-tkai/30min' : 'The faster you create the address, the smoother the call. Book a slot when you\'re ready: https://calendly.com/start-tkai/30min'}
`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${hasPdf ? 'Your personalized AI deployment plan' : 'We\'ve started'}, ${escapeHtml(firstName)}</title>
<!--[if mso]>
<style>table,td,div,h1,h2,h3,p {font-family: Helvetica, Arial, sans-serif !important;}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background:#f2f2f4;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;line-height:1.55;-webkit-font-smoothing:antialiased;">

  <!-- Preheader (hidden) -->
  <div style="display:none;font-size:1px;color:#f2f2f4;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${hasPdf ? 'Your personalized AI deployment plan is attached. Book a 30-min call to walk through it together.' : 'Your AI agent build has started. Book a 30-min call to discuss your project.'}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f2f4;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

          <!-- BRAND HEADER -->
          <tr>
            <td style="background:#0a0a0a;border-radius:20px 20px 0 0;padding:28px 40px;" align="left">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" style="font-size:18px;font-weight:600;letter-spacing:-0.01em;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                    <span style="display:inline-block;width:8px;height:8px;background:#0071e3;border-radius:50%;margin-right:10px;vertical-align:middle;"></span>TurnkeyAI
                  </td>
                  <td align="right" style="font-size:12px;color:#86868b;letter-spacing:0.04em;text-transform:uppercase;font-weight:500;">
                    ${hasPdf ? 'Plan attached' : 'Build started'}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td style="background:#ffffff;padding:56px 40px 32px;" align="left">
              <p style="margin:0 0 14px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#0071e3;font-weight:600;">${hasPdf ? 'Personalized plan · attached' : 'Brief received · work has started'}</p>
              <h1 style="margin:0 0 20px;font-size:36px;line-height:1.1;letter-spacing:-0.02em;font-weight:600;color:#1d1d1f;">Thanks, ${escapeHtml(firstName)}.</h1>
              <p style="margin:0 0 12px;font-size:17px;line-height:1.55;color:#1d1d1f;">
                Your AI agent is on our build queue. We've started on our end.
              </p>
              ${hasPdf ? `<p style="margin:0 0 12px;font-size:17px;line-height:1.55;color:#1d1d1f;">
                Attached is a <strong style="font-weight:600;">personalized deployment plan</strong> for ${escapeHtml(businessName || 'your business')}. It walks through what we'd build, what it would save you in year one, and the package we'd recommend. Worth 5 minutes before our call.
              </p>` : ''}
              <p style="margin:0;font-size:17px;line-height:1.55;color:#1d1d1f;">
                Book a 30-minute call below to walk through it together &mdash; or we'll reach out within 2 business hours either way. Then there's <strong style="font-weight:600;">one quick task</strong> for you that takes 5 minutes.
              </p>
            </td>
          </tr>

          <!-- BOOK A CALL CTA -->
          <tr>
            <td style="background:#ffffff;padding:0 40px 32px;" align="left">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0a;border-radius:18px;">
                <tr>
                  <td style="padding:34px 36px;" align="left">
                    <p style="margin:0 0 10px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#4aa1ff;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Lock in your slot</p>
                    <h2 style="margin:0 0 12px;font-size:24px;line-height:1.2;letter-spacing:-0.02em;font-weight:600;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      Book a 30-min call with us.
                    </h2>
                    <p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:rgba(255,255,255,0.72);">
                      We'll walk through your deployment plan, answer questions about your specific workflows, and reserve your build slot. Pick a time that works for you &mdash; no back-and-forth.
                    </p>
                    <a href="https://calendly.com/start-tkai/30min" style="display:inline-block;background:#ffffff;color:#1d1d1f;font-weight:500;font-size:15px;padding:14px 24px;border-radius:100px;text-decoration:none;letter-spacing:-0.01em;">
                      Book your 30-min call &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${recap ? `
          <!-- RECAP -->
          <tr>
            <td style="background:#ffffff;padding:0 40px 32px;" align="left">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;border-radius:14px;">
                <tr>
                  <td style="padding:18px 22px;font-size:14px;color:#424245;line-height:1.6;">
                    <span style="display:inline-block;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#86868b;font-weight:600;margin-bottom:6px;">Your brief</span><br>
                    ${escapeHtml(recap)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ''}

          <!-- DIVIDER -->
          <tr>
            <td style="background:#ffffff;padding:0 40px;">
              <div style="height:1px;background:#e8e8ed;line-height:1px;font-size:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- ACTION REQUIRED -->
          <tr>
            <td style="background:#ffffff;padding:48px 40px 16px;" align="left">
              <p style="margin:0 0 14px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#86868b;font-weight:600;">Your one task</p>
              <h2 style="margin:0 0 18px;font-size:28px;line-height:1.15;letter-spacing:-0.02em;font-weight:600;color:#1d1d1f;">
                Create a new email address<br>for your AI agent.
              </h2>
              <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#424245;">
                Your agent will read its own inbox, send its own replies, and connect to your tools (CRM, calendar, accounting, support). Keeping it separate from your personal or main business email keeps audit trails clean and access easy to revoke later.
              </p>
            </td>
          </tr>

          <!-- STEP 1 -->
          <tr>
            <td style="background:#ffffff;padding:32px 40px 0;" align="left">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="56" valign="top" style="font-size:48px;line-height:1;font-weight:600;letter-spacing:-0.04em;color:#0071e3;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding-right:16px;">01</td>
                  <td valign="top">
                    <h3 style="margin:0 0 10px;font-size:18px;line-height:1.35;letter-spacing:-0.01em;font-weight:600;color:#1d1d1f;">Create a new mailbox</h3>
                    <p style="margin:0;font-size:15px;line-height:1.6;color:#424245;">At your business domain, e.g. <span style="font-family:ui-monospace,'SF Mono',Menlo,monospace;background:#f5f5f7;padding:1px 6px;border-radius:4px;">ai@yourbusiness.com.au</span>. Or a fresh Google Workspace / Microsoft 365 account.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- STEP 2 -->
          <tr>
            <td style="background:#ffffff;padding:32px 40px 48px;" align="left">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="56" valign="top" style="font-size:48px;line-height:1;font-weight:600;letter-spacing:-0.04em;color:#0071e3;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding-right:16px;">02</td>
                  <td valign="top">
                    <h3 style="margin:0 0 10px;font-size:18px;line-height:1.35;letter-spacing:-0.01em;font-weight:600;color:#1d1d1f;">Have it ready for our call</h3>
                    <p style="margin:0;font-size:15px;line-height:1.6;color:#424245;">Just have the email address and a temporary password ready when we call. We'll walk through onboarding and capture everything securely on the call.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- SECURITY CALLOUT -->
          <tr>
            <td style="background:#ffffff;padding:0 40px 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;border-radius:16px;">
                <tr>
                  <td style="padding:24px 28px;font-size:14px;line-height:1.55;color:#424245;">
                    <span style="display:inline-block;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#86868b;font-weight:600;margin-bottom:8px;">On security</span><br>
                    We never ask for passwords by email. All credentials shared on the call are stored encrypted, used only for the one-time setup, and either rotated or fully revoked at your discretion once your agent is operational.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- DARK FOOTER -->
          <tr>
            <td style="background:#0a0a0a;border-radius:0 0 20px 20px;padding:40px;" align="left">
              <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#86868b;font-weight:600;">P.S.</p>
              <p style="margin:0 0 20px;font-size:17px;line-height:1.5;color:#f5f5f7;letter-spacing:-0.01em;">
                ${hasPdf ? `The attached plan is built for ${escapeHtml(businessName || 'your business')} specifically. Read it, then book your call.` : 'The faster you create the address, the smoother the call.'}
              </p>
              <a href="https://calendly.com/start-tkai/30min" style="display:inline-block;background:#ffffff;color:#1d1d1f;font-weight:500;font-size:14px;padding:11px 20px;border-radius:100px;text-decoration:none;letter-spacing:-0.005em;margin-bottom:28px;">
                Book your 30-min call &rarr;
              </a>
              <div style="height:1px;background:#1d1d1f;line-height:1px;font-size:1px;margin:0 0 24px;">&nbsp;</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" style="font-size:14px;color:#86868b;line-height:1.5;">
                    <span style="display:inline-block;width:6px;height:6px;background:#0071e3;border-radius:50%;margin-right:8px;vertical-align:middle;"></span><span style="color:#f5f5f7;font-weight:600;">TurnkeyAI</span><br>
                    <span style="font-size:12px;color:#6e6e73;">Done-for-you AI automation. 7 days. Hardware yours forever.</span>
                  </td>
                  <td align="right" style="font-size:12px;color:#6e6e73;">
                    <a href="https://turnkeyai.com.au" style="color:#86868b;text-decoration:none;">turnkeyai.com.au</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- LEGAL -->
          <tr>
            <td style="padding:24px 8px;text-align:center;font-size:11px;color:#86868b;line-height:1.6;">
              You're receiving this because you submitted a brief on turnkeyai.com.au.<br>
              Reply to this email to reach us directly.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

  return { html, text };
}

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'lead';
}

function prettyIndustry(slug) {
  const map = {
    accounting: 'Accounting / Bookkeeping',
    real_estate: 'Real Estate',
    ecommerce: 'E-Commerce',
    healthcare: 'Healthcare',
    legal: 'Legal Services',
    marketing: 'Marketing Agency',
    cleaning: 'Cleaning Services',
    trades: 'Plumbing / Trades',
    consulting: 'Consulting',
    dental: 'Dental Practice',
    beauty: 'Hair / Beauty',
    restaurant: 'Restaurant / Cafe',
    fitness: 'Fitness / Gym',
    education: 'Education / Training',
    insurance: 'Insurance',
    recruitment: 'Recruitment / HR',
    it_services: 'IT Services',
    hospitality: 'Hospitality',
    manufacturing: 'Manufacturing',
    financial: 'Financial Services',
    other: 'Other',
  };
  return map[slug] || slug;
}

function prettyPackage(slug) {
  const map = {
    cloud: 'Cloud OpenClaw ($2,999)',
    'mac-mini': 'Mac Mini ($5,999)',
    professional: 'Mac Mini ($5,999)', // legacy form values
    business: 'Mac Mini ($5,999)',     // legacy form values
    enterprise: 'Mac Mini ($5,999)',   // legacy form values
    unsure: 'Help me decide',
  };
  return map[slug] || slug;
}
