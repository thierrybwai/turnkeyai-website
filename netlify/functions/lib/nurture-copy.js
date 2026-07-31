// Nurture sequence copy (EN / AU only). Approved by Mael 31/07/2026 (plan BAT).
// Rules enforced here: no em dashes, single real Google review (never plural),
// best-effort guarantee wording only, no phone-AI mentions, straight apostrophes
// in SMS bodies (GSM-7 charset, 1-2 segments).

const PUBLIC_BASE = (process.env.NURTURE_PUBLIC_BASE || 'https://turnkeyai.com.au').replace(/\/$/, '');

// Defensive re-validation at read time: records already sitting in Blobs never go
// back through the enqueue sanitisers, so the templates re-check before interpolating.
function firstOf(rec) {
  const s = String(rec.first || '').trim();
  return /^[\p{L}\p{M} '’.\-]{1,30}$/u.test(s) && !/\d/.test(s) ? s : 'there';
}
function bizOf(rec) {
  const s = String(rec.biz || '').trim();
  if (!s || s.length > 40 || /https?:|www\.|[<>]/i.test(s)) return 'your business';
  return s;
}
function link(step, rec) { return `${PUBLIC_BASE}/c/${step}?c=${rec.leadId}`; }
const subj = s => String(s).replace(/[\r\n]+/g, ' ').slice(0, 150);

// ── SMS ──────────────────────────────────────────────
export function smsTextFor(stepId, rec) {
  const first = firstOf(rec), biz = bizOf(rec);
  if (stepId === 'sms1') {
    // No-PDF variant makes no delivery-time promise: hasPdf=false means the plan
    // pipeline FAILED and only a human retry can send one.
    return rec.hasPdf
      ? `Hi ${first}, Mael from Turn Key AI. Your AI plan for ${biz} just landed in your inbox. If you'd rather walk through it together, grab a time that suits you: ${link('s1', rec)} No pressure at all. Reply STOP to opt out.`
      : `Hi ${first}, Mael from Turn Key AI. We've started on your plan for ${biz} and I'll personally make sure it reaches your inbox. Meanwhile you can grab a time to talk it through: ${link('s1', rec)} Reply STOP to opt out.`;
  }
  if (stepId === 'sms2') {
    return rec.hasPdf
      ? `Hi ${first}, it's Mael from Turn Key AI. Quick one: did the plan make sense for ${biz}? If anything looks off or unclear, just reply here, I read every answer myself. Reply STOP to opt out.`
      : `Hi ${first}, it's Mael from Turn Key AI. Your plan is taking longer than usual on our end, I'm chasing it up myself. Anything specific you want it to cover? Just reply here. Reply STOP to opt out.`;
  }
  if (stepId === 'sms3') {
    return `${first}, Mael again from Turn Key AI. I emailed you yesterday about how we work with businesses like ${biz}, worth 2 minutes when you get a sec. Check your inbox (or spam, it happens). Reply STOP to opt out.`;
  }
  throw new Error(`Unknown SMS step: ${stepId}`);
}

// ── Email shell ──────────────────────────────────────
const ACCENT = '#0071e3';
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function shell({ title, bodyHtml, unsubUrl }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f2f2f4;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;line-height:1.6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f2f4;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
      <tr><td style="background:#0a0a0a;border-radius:20px 20px 0 0;padding:22px 40px;">
        <span style="font-size:17px;font-weight:600;letter-spacing:-0.01em;color:#fff;"><span style="display:inline-block;width:8px;height:8px;background:${ACCENT};border-radius:50%;margin-right:10px;vertical-align:middle;"></span>TurnkeyAI</span>
      </td></tr>
      <tr><td style="background:#fff;padding:44px 40px 36px;font-size:16px;">
        ${bodyHtml}
      </td></tr>
      <tr><td style="background:#fff;border-radius:0 0 20px 20px;padding:20px 40px 30px;border-top:1px solid #f0f0f2;">
        <p style="margin:0;font-size:12px;color:#86868b;line-height:1.7;">Turn Key AI &middot; turnkeyai.com.au &middot; <a href="mailto:start@tkai.com.au" style="color:#86868b;">start@tkai.com.au</a><br>
        You're receiving this because you asked for an AI plan on turnkeyai.com.au. <a href="${esc(unsubUrl)}" style="color:#86868b;">Unsubscribe</a> and we won't message you again.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
function cta(href, label) {
  return `<p style="margin:26px 0;"><a href="${esc(href)}" style="display:inline-block;background:#0a0a0a;color:#fff;font-weight:500;font-size:15px;padding:14px 26px;border-radius:100px;text-decoration:none;">${esc(label)}</a></p>`;
}

// ── Emails ───────────────────────────────────────────
export function emailPartsFor(stepId, rec, unsubUrl) {
  const first = firstOf(rec), biz = bizOf(rec);

  if (stepId === 'email2') {
    const subject = subj(biz !== 'your business' ? `How we'd actually do this for ${biz}, ${first}` : `How we'd actually do this, ${first}`);
    const planRef = rec.hasPdf
      ? `Yesterday you got a plan with the workflows we'd build for ${biz}.`
      : `You asked us for an AI plan for ${biz}.`;
    const bookUrl = link('e2', rec);

    const text = `Hi ${first},

${planRef} Here's the part the PDF doesn't show: how it actually happens.

1. A free audit call, 15 minutes. We look at your plan together and I tell you straight whether AI genuinely saves you time or not. If we're not the right fit, I'll say so and point you in a better direction. It costs nothing and commits you to nothing.

2. We build it, in 7 business days. You don't set anything up. No code, no new accounts, no IT project on your side.

3. We run it. One fixed price from A$2,999, no subscription. You own it.

Three we have actually built, so you can picture it:

Smooth Flow Group, civil contracting and traffic management in South Australia. A Mac Mini sitting in their office, running an assistant that answers in their Slack and reads their Microsoft 365, their Xero, and Traffio, the system their crews actually work in.

Perth Landscape Guys, landscaping in WA. Same idea, their software: an assistant in their Slack, wired into their Outlook, their Xero and their HubSpot.

Black and White Property Group, real estate on the Gold Coast. Their website form had never been connected to anything, and 372 enquiries were sitting inside it, unread. We built the path. Every enquiry now reaches their CRM and their Slack within 15 minutes, sorted by the page it came from.

That's the pattern. We don't hand you another app to learn. We connect to the software you already pay for and already run, and you ask it things in plain English.

We're Australian-built and run, and our first public review on Google is 5.0.

If you want the audit, pick any time here:
${bookUrl}

Talk soon,
Mael Demets
Turn Key AI

Turn Key AI · turnkeyai.com.au · start@tkai.com.au
Unsubscribe: ${unsubUrl}`;

    const bodyHtml = `
<p style="margin:0 0 16px;">Hi ${esc(first)},</p>
<p style="margin:0 0 16px;">${esc(planRef)} Here's the part the PDF doesn't show: how it actually happens.</p>
<p style="margin:0 0 12px;"><strong>1. A free audit call, 15 minutes.</strong> We look at your plan together and I tell you straight whether AI genuinely saves you time or not. If we're not the right fit, I'll say so and point you in a better direction. It costs nothing and commits you to nothing.</p>
<p style="margin:0 0 12px;"><strong>2. We build it, in 7 business days.</strong> You don't set anything up. No code, no new accounts, no IT project on your side.</p>
<p style="margin:0 0 16px;"><strong>3. We run it.</strong> One fixed price from A$2,999, no subscription. You own it.</p>
<p style="margin:0 0 14px;">Three we have actually built, so you can picture it:</p>
<p style="margin:0 0 12px;"><strong>Smooth Flow Group</strong>, civil contracting and traffic management in South Australia. A Mac Mini sitting in their office, running an assistant that answers in their Slack and reads their Microsoft 365, their Xero, and Traffio, the system their crews actually work in.</p>
<p style="margin:0 0 12px;"><strong>Perth Landscape Guys</strong>, landscaping in WA. Same idea, their software: an assistant in their Slack, wired into their Outlook, their Xero and their HubSpot.</p>
<p style="margin:0 0 16px;"><strong>Black and White Property Group</strong>, real estate on the Gold Coast. Their website form had never been connected to anything, and 372 enquiries were sitting inside it, unread. We built the path. Every enquiry now reaches their CRM and their Slack within 15 minutes, sorted by the page it came from.</p>
<p style="margin:0 0 16px;">That's the pattern. We don't hand you another app to learn. We connect to the software you already pay for and already run, and you ask it things in plain English.</p>
<p style="margin:0 0 8px;">We're Australian-built and run, and our first public review on Google is 5.0.</p>
${cta(bookUrl, 'Book your free 15-minute audit')}
<p style="margin:0;">Talk soon,<br><strong>Mael Demets</strong><br>Turn Key AI</p>`;

    return { subject, text, html: shell({ title: subject, bodyHtml, unsubUrl }) };
  }

  if (stepId === 'email3') {
    const subject = subj(`Last note from me, ${first}`);
    const bookUrl = link('e3', rec);
    const planLine = rec.hasPdf
      ? 'Your plan already names yours.'
      : "Reply to this email and I'll tell you which one I'd pick for yours.";

    const text = `Hi ${first},

I won't keep filling your inbox. This is my last email unless you reach out.

Before I go, one thing worth keeping even if we never talk: the businesses that actually save time with AI don't start with ten tools. They pick the one job that eats their week (quotes, follow-ups, reminders) and automate that first. ${planLine}

If you ever want to look at it together, the door stays open, and it stays free: a 15-minute audit where I tell you honestly whether it's worth doing. No commitment, and if we're not the right people for it, I'll tell you that too.
${bookUrl}

And if you just want information with zero strings, reply to this email with any question. I answer every one myself.

Either way, glad you asked for the plan. Good luck with ${biz}.

Mael Demets
Turn Key AI

Turn Key AI · turnkeyai.com.au · start@tkai.com.au
Unsubscribe: ${unsubUrl}`;

    const bodyHtml = `
<p style="margin:0 0 16px;">Hi ${esc(first)},</p>
<p style="margin:0 0 16px;">I won't keep filling your inbox. This is my last email unless you reach out.</p>
<p style="margin:0 0 16px;">Before I go, one thing worth keeping even if we never talk: the businesses that actually save time with AI don't start with ten tools. They pick the one job that eats their week (quotes, follow-ups, reminders) and automate that first. ${esc(planLine)}</p>
<p style="margin:0 0 16px;">If you ever want to look at it together, the door stays open, and it stays free: a 15-minute audit where I tell you honestly whether it's worth doing. No commitment, and if we're not the right people for it, I'll tell you that too.</p>
${cta(bookUrl, 'Book a time, whenever suits')}
<p style="margin:0 0 16px;">And if you just want information with zero strings, reply to this email with any question. I answer every one myself.</p>
<p style="margin:0 0 16px;">Either way, glad you asked for the plan. Good luck with ${esc(biz)}.</p>
<p style="margin:0;"><strong>Mael Demets</strong><br>Turn Key AI</p>`;

    return { subject, text, html: shell({ title: subject, bodyHtml, unsubUrl }) };
  }

  throw new Error(`Unknown email step: ${stepId}`);
}
