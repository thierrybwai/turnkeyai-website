// Triggered automatically by Netlify whenever a form on the site is submitted.
// Background function (15-min timeout). Routes by form_name:
//   - 'ai-audit'       → lead form: Claude + PDFShift + branded PDF email
//   - 'support-ticket' → support ticket: confirmation email + team email + dispatch to ops Mac Mini agent
//
// All steps try/catch'd, email always sent.

import { handleSupportTicket } from './lib/support-handler.js';
import { fetchBrandAssets, buildEmail, buildPdfHtml } from './lib/lead-render.js';

export default async (req) => {
  try {
    const payload = await req.json();
    const data = payload?.payload?.data || {};
    const formName = payload?.payload?.form_name || '';

    // Route by form name
    if (formName === 'support-ticket') {
      return await handleSupportTicket({ data });
    }
    if (formName !== 'ai-audit' && formName !== 'ai-recommendations') {
      return new Response('Ignored: not a handled form', { status: 200 });
    }

    // The ads landing form ('ai-recommendations') uses shorter field names — map them
    // onto the ai-audit shape so the same CRM + plan + email pipeline runs for both.
    if (formName === 'ai-recommendations') {
      data.firstName = data.firstName || data.first || '';
    }

    const firstName = (data.firstName || 'there').trim();
    const lastName = (data.lastName || '').trim();
    const email = (data.email || '').trim();
    const phone = (data.phone || '').trim();
    const businessName = (data.businessName || '').trim();
    const website = (data.website || '').trim();
    const industry = (data.industry || '').trim();
    const packageInterest = (data.packageInterest || '').trim();
    const timeEater = (data.time_eater || '').trim();

    if (!email) {
      return new Response('No email on submission', { status: 200 });
    }

    const leadCtx = { firstName, lastName, email, phone, businessName, website, industry, packageInterest, timeEater };

    // 0. Push the lead into the Base44 SalesFlow CRM (TKAI pipeline) FIRST, so the lead is
    //    captured even if Claude / PDFShift / Resend later fail. Non-blocking, never throws.
    await pushToBase44CRM({
      ...leadCtx, formName,
      timeEater,
      keyword: (data.keyword || '').trim(),
      utm: {
        source: (data.leadSource || data.utm_source || '').trim(),
        medium: (data.leadMedium || data.utm_medium || '').trim(),
        campaign: (data.leadCampaign || data.utm_campaign || '').trim(),
        content: (data.leadContent || data.utm_content || '').trim(),
        term: (data.leadTerm || data.utm_term || '').trim(),
        placement: (data.leadPlacement || data.utm_placement || '').trim(),
        referrer: (data.leadReferrer || data.referrer || '').trim(),
        landingPage: (data.leadLandingPage || data.page || '').trim(),
        gclid: (data.gclid || '').trim(),
        gbraid: (data.gbraid || '').trim(),
        wbraid: (data.wbraid || '').trim(),
      },
    });

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

    // 1a-bis. Pull the lead's logo + brand colour for per-client co-branding (defensive; falls back to TurnkeyAI).
    let brand = { logoDataUri: null, accent: null };
    if (website) {
      try { brand = await fetchBrandAssets(website); console.log('Brand assets:', brand.logoDataUri ? 'logo + ' + (brand.accent || 'no accent') : 'none'); }
      catch (err) { console.error('Brand assets failed:', err.message); }
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
        const pdfHtml = buildPdfHtml({ businessName, industry, spin, brand });
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
      : `We've started, ${firstName}. Let's book your call.`;
    const { html, text } = buildEmail({ firstName, businessName, industry, packageInterest, hasPdf, brand });

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
async function pushToBase44CRM({ firstName, lastName, email, phone, businessName, website, industry, packageInterest, formName, timeEater, keyword, utm = {} }) {
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
    source: formName === 'ai-recommendations' ? 'website-ads-form' : 'website-audit-form',
    value: 0,
    utm: {
      source: utm.source || '',
      medium: utm.medium || '',
      campaign: utm.campaign || '',
      content: utm.content || '',
      term: utm.term || '',
      placement: utm.placement || '',
      referrer: utm.referrer || '',
      landingPage: utm.landingPage || '',
      gclid: utm.gclid || '',
      gbraid: utm.gbraid || '',
      wbraid: utm.wbraid || '',
    },
    metadata: {
      packageInterest: packageInterest || '',
      submittedVia: `turnkeyai.com.au ${formName || 'ai-audit'} form`,
      timeEater: timeEater || '',
      keyword: keyword || '',
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
async function generateSpinContent({ firstName, businessName, website, industry, packageInterest, timeEater, siteContent }) {
  const industryLabel = prettyIndustry(industry) || 'their business';
  const businessLabel = businessName || 'their business';
  const packageLabel = prettyPackage(packageInterest);
  const siteBlock = siteContent
    ? `\n\nReal website content from ${website} (use specific details from this — services they offer, team size, suburbs, named tools, anything that proves you actually read their site):\n----- SITE CONTENT START -----\n${siteContent}\n----- SITE CONTENT END -----\n\nReference at least 2 specific facts from the site in your output (e.g. an actual service they advertise, a suburb they serve, a tool they mention, a tagline they use). Make it obvious you've done your homework.`
    : '';

  const systemPrompt = `You are a senior sales strategist for TurnkeyAI, a done-for-you AI automation service for Australian SMEs.

TurnkeyAI's offer in one line: we deploy a complete AI system (powered by Claude) on a Mac Mini installed in the client's office, live in 7 business days, with hardware they own forever. Workflows are operated via Slack or Telegram in plain English.

Hard facts you can use (do not invent others):
- Packages: Cloud OpenClaw $2,999 AUD (hosted on a dedicated VPS we manage, 3 workflows, remote setup) and Mac Mini $5,999 AUD (1 Apple Mac Mini M4 yours to keep, 5 workflows, on-site setup in Gold Coast or Brisbane). We keep either system running for as long as the client uses it, with no monthly maintenance subscription. New workflows later are $200 AUD each. Pick the right package based on whether the client wants on-premise hardware or a cloud-managed setup.
- Average client savings: $1,500-$2,000 per week per Mac Mini.
- Average break-even: 3 weeks.
- Average Year-1 ROI: 13x.
- Industries we've done: accounting/bookkeeping, real estate/property management, law firms, medical/allied health clinics, trades (plumbing/electrical), hospitality/hotels/STR, recruitment, marketing agencies, e-commerce, consulting.
- Australian FTE cost reference: $65,000-$85,000/year base salary, before super/leave/turnover.

Brand voice rules:
- Direct, specific, chiffré. "Save 14 hours a week" beats "maximize productivity."
- Reader-centric (you/your), not "we help businesses".
- No em-dashes (—). Use periods, commas, colons.
- Banned words: elevate, seamless, leverage, robust, unleash, supercharge, unlock, journey, ecosystem, paradigm, synergy, holistic, cutting-edge, next-gen, world-class, best-in-class, game-changer, frictionless.
- No exclamation marks. No emojis.
- Sentences ≤22 words. Paragraphs ≤3 sentences.

Your task: generate a personalized SPIN-selling deployment plan for a specific lead. Reply with ONLY valid JSON matching the schema below. No prose, no markdown, no explanation. Make every value specific to the lead's industry. Use real numbers, real workflow names. Be honest and credible: under-promise specific figures, do not inflate. Always express any time or money saving as a prudent range (e.g. '6 to 10 hours'), never a single fabricated number.`;

  const userPrompt = `Lead context:
- First name: ${firstName}
- Business: ${businessLabel}
- Website: ${website || 'not provided'}
- Industry: ${industryLabel}
- Biggest time drain: ${timeEater || 'not provided'}${packageLabel ? `\n- Package they mentioned: ${packageLabel}` : ''}${siteBlock}

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
    "headline": "A credible cost-of-inaction line as a range, not a sharp number, e.g. 'Roughly a part-time salary, lost to admin every year'",
    "annual_cost_aud": "Numeric label, e.g. '$28,000 - $42,000'",
    "hours_per_week": "Numeric label, e.g. '12 to 18 hours'",
    "fte_equivalent": "Decimal FTE, e.g. '0.4 - 0.6 FTE'",
    "narrative": "2-3 sentences making the cost vivid for ${businessLabel}. Be specific to ${industryLabel}."
  },
  "workflows": [
    { "name": "Workflow name (≤4 words)", "what": "What it does for ${industryLabel} (≤25 words)", "saves": "Time saved as a prudent range, e.g. '5 to 8 hours per week'. Never a single sharp figure." },
    { "name": "Workflow 2 name", "what": "What it does", "saves": "Time saved" },
    { "name": "Workflow 3 name", "what": "What it does", "saves": "Time saved" }
  ],
  "recommended_package": "Cloud | Mac Mini",
  "package_rationale": "1 sentence (≤25 words) explaining why this tier fits their stage.",
  "year_one_roi": "ROI as a prudent range, e.g. '8x to 13x'",
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
      model: 'claude-opus-5',
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
    small_business: 'Small Business',
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
