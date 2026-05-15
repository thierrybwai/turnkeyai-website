// Triggered automatically by Netlify whenever the 'support-ticket' form is submitted.
// Background function (15-min timeout). Orchestrates:
//   1. Generate ticket ID (e.g. TK-202605-A1B2C3)
//   2. Send branded confirmation email to client (Resend)
//   3. Send detailed notification to team (start@tkai.com.au)
//   4. (Future Phase 2) Dispatch ticket to support agent on ops Mac Mini

export default async (req) => {
  try {
    const payload = await req.json();
    const data = payload?.payload?.data || {};
    const formName = payload?.payload?.form_name || '';

    if (formName !== 'support-ticket') {
      return new Response('Ignored: not the support form', { status: 200 });
    }

    // Anti-spam: honeypot check
    if ((data['hp-field'] || '').trim()) {
      console.log('Honeypot tripped, dropping submission');
      return new Response('Ignored: spam', { status: 200 });
    }

    const firstName = (data.firstName || 'there').trim();
    const lastName = (data.lastName || '').trim();
    const email = (data.email || '').trim();
    const phone = (data.phone || '').trim();
    const businessName = (data.businessName || '').trim();
    const planType = (data.planType || '').trim();
    const ticketType = (data.ticketType || '').trim();
    const urgency = (data.urgency || 'standard').trim();
    const problemDescription = (data.problemDescription || '').trim();
    const accessMethod = (data.accessMethod || 'openclaw-extension').trim();
    const dataBackupConfirmed = (data.dataBackupConfirmed || '').trim();
    const stripeSessionId = (data.stripeSessionId || '').trim();

    if (!email) {
      return new Response('No email on ticket', { status: 200 });
    }

    const ticketId = generateTicketId();
    const ctx = {
      ticketId,
      firstName, lastName, email, phone, businessName,
      planType, ticketType, urgency, problemDescription, accessMethod,
      dataBackupConfirmed, stripeSessionId,
      submittedAt: new Date().toISOString(),
    };

    // 1. Send confirmation email to client
    try {
      const { html: clientHtml, text: clientText } = buildClientEmail(ctx);
      const clientSubject = isPayPerIncident(planType)
        ? `Ticket ${ticketId} received. One step left: pay your $200 incident fee.`
        : `Ticket ${ticketId} received. Agent picking it up now.`;

      await sendResend({
        to: [email],
        subject: clientSubject,
        html: clientHtml,
        text: clientText,
      });
      console.log(`Client confirmation sent for ticket ${ticketId}`);
    } catch (err) {
      console.error('Failed to send client confirmation:', err.message);
    }

    // 2. Send detailed notification to team
    try {
      const teamForward = (process.env.LEAD_FORWARD_EMAIL || 'start@tkai.com.au').trim();
      const { html: teamHtml, text: teamText } = buildTeamEmail(ctx);
      await sendResend({
        to: [teamForward],
        subject: `[${urgency.toUpperCase()}] Ticket ${ticketId} · ${businessName || firstName} · ${prettyTicketType(ticketType)}`,
        html: teamHtml,
        text: teamText,
        reply_to: email,
      });
      console.log(`Team notification sent for ticket ${ticketId}`);
    } catch (err) {
      console.error('Failed to send team notification:', err.message);
    }

    // 3. Dispatch to the support agent on the ops Mac Mini (if configured)
    try {
      const agentUrl = (process.env.SUPPORT_AGENT_WEBHOOK_URL || '').trim();
      const agentSecret = (process.env.SUPPORT_AGENT_WEBHOOK_SECRET || '').trim();
      if (agentUrl && agentSecret) {
        const agentPayload = JSON.stringify(ctx);
        const sig = await hmacSha256Hex(agentSecret, agentPayload);
        const agentRes = await fetch(agentUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': sig,
          },
          body: agentPayload,
        });
        if (!agentRes.ok) {
          const errBody = await agentRes.text();
          console.error(`Agent webhook returned ${agentRes.status}: ${errBody.slice(0, 200)}`);
        } else {
          console.log(`Dispatched ticket ${ticketId} to support agent`);
        }
      } else {
        console.log('Agent webhook not configured (SUPPORT_AGENT_WEBHOOK_URL/SECRET missing) — skipping');
      }
    } catch (err) {
      console.error('Failed to dispatch to support agent:', err.message);
    }

    return new Response(`Ticket ${ticketId} processed`, { status: 200 });
  } catch (err) {
    console.error('support-submission-created-background error:', err);
    return new Response('Error', { status: 500 });
  }
};

// ─────────────────────────────────────────────────────
// Resend wrapper
// ─────────────────────────────────────────────────────
async function sendResend({ to, subject, html, text, reply_to }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'TurnkeyAI Support <support@tkai.com.au>',
      reply_to: reply_to || 'start@tkai.com.au',
      to, subject, html, text,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Resend ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────
// Ticket ID generation: TK-YYYYMM-XXXXXX
// ─────────────────────────────────────────────────────
function generateTicketId() {
  const now = new Date();
  const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  // 6-char base32-ish suffix (no ambiguous chars)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `TK-${yyyymm}-${suffix}`;
}

function isPayPerIncident(plan) {
  return plan === 'pay-per-incident';
}

function prettyPlan(plan) {
  return ({
    'pay-per-incident': 'Pay-per-Incident ($200 one-shot)',
    'always-on': 'Always-On subscriber ($1,000/mo)',
  })[plan] || plan || 'Unknown';
}

function prettyTicketType(t) {
  return ({
    broken: 'Broken / down',
    degraded: 'Performance degraded',
    question: 'Question / how-to',
    tweak: 'Workflow improvement',
    security: 'Security concern',
  })[t] || t || 'Unknown';
}

function prettyAccess(m) {
  return ({
    'openclaw-extension': 'OpenClaw support extension (recommended)',
    'screen-share': 'Slack / Telegram screen share',
    'time-limited-ssh': 'Time-limited SSH (1-hour key)',
  })[m] || m || 'Unknown';
}

function prettyUrgency(u) {
  return ({
    standard: 'Standard (4 business hours)',
    urgent: 'Urgent (1 hour, Always-On only)',
  })[u] || u || 'Standard';
}

// ─────────────────────────────────────────────────────
// Client confirmation email (branded, Apple-style)
// ─────────────────────────────────────────────────────
function buildClientEmail(ctx) {
  const { ticketId, firstName, businessName, ticketType, urgency, planType, problemDescription } = ctx;
  const isPpi = isPayPerIncident(planType);
  const slaLabel = prettyUrgency(urgency);
  const preview = isPpi
    ? `Ticket ${ticketId}. One quick step: pay your $200 incident fee to activate the agent.`
    : `Ticket ${ticketId}. Our support agent is picking it up right now.`;

  const text = `Hi ${firstName},

Ticket ${ticketId} received. ${isPpi ? 'Your support agent will start the moment we receive your $200 incident payment.' : 'Our support agent is picking it up right now.'}

Your ticket:
- Type: ${prettyTicketType(ticketType)}
- Urgency: ${slaLabel}
- Description: ${problemDescription.slice(0, 200)}${problemDescription.length > 200 ? '…' : ''}

${isPpi ? `Pay now to activate: https://buy.stripe.com/3cIbJ36cj0nmbFDdMv2Ji01
After payment, the agent picks up your ticket within 5 minutes.

` : `What happens next:
1. Agent reads your description and pulls Mac Mini logs.
2. Draft fix prepared, sent to you for one-click approval (destructive changes only).
3. Resolution emailed within ${slaLabel}.

`}You'll receive a resolution email with the full audit log: what we changed, what we ran, and how to prevent it next time.

Need to add details? Reply to this email directly. The thread is attached to ticket ${ticketId}.

TurnkeyAI Support
support@tkai.com.au · turnkeyai.com.au
`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Ticket ${ticketId} received</title>
</head>
<body style="margin:0;padding:0;background:#f2f2f4;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;line-height:1.55;-webkit-font-smoothing:antialiased;">

  <div style="display:none;font-size:1px;color:#f2f2f4;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preview)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f2f4;">
    <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

      <!-- BRAND HEADER -->
      <tr>
        <td style="background:#0a0a0a;border-radius:20px 20px 0 0;padding:28px 40px;" align="left">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="left" style="font-size:18px;font-weight:600;letter-spacing:-0.01em;color:#ffffff;">
                <span style="display:inline-block;width:8px;height:8px;background:#0071e3;border-radius:50%;margin-right:10px;vertical-align:middle;"></span>TurnkeyAI <span style="color:#86868b;font-weight:500;">Support</span>
              </td>
              <td align="right" style="font-size:12px;color:#86868b;letter-spacing:0.04em;text-transform:uppercase;font-weight:500;">Ticket received</td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- HERO -->
      <tr>
        <td style="background:#ffffff;padding:56px 40px 24px;" align="left">
          <p style="margin:0 0 14px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#0071e3;font-weight:600;">Ticket ${escapeHtml(ticketId)}</p>
          <h1 style="margin:0 0 20px;font-size:32px;line-height:1.1;letter-spacing:-0.02em;font-weight:600;color:#1d1d1f;">${isPpi ? `One step left, ${escapeHtml(firstName)}.` : `We're on it, ${escapeHtml(firstName)}.`}</h1>
          <p style="margin:0;font-size:17px;line-height:1.55;color:#1d1d1f;">
            ${isPpi
              ? `Your $200 incident fee activates the support agent. After payment, the agent picks up your ticket within 5 minutes.`
              : `Our support agent is reading your ticket right now. Expected resolution: <strong style="font-weight:600;">${escapeHtml(slaLabel)}</strong>.`}
          </p>
        </td>
      </tr>

      ${isPpi ? `
      <!-- PAYMENT CTA -->
      <tr>
        <td style="background:#ffffff;padding:24px 40px 32px;" align="left">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0a;border-radius:16px;">
            <tr>
              <td style="padding:28px 32px;" align="left">
                <p style="margin:0 0 10px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#4aa1ff;font-weight:600;">One quick step</p>
                <p style="margin:0 0 16px;font-size:20px;font-weight:600;color:#ffffff;line-height:1.25;">Pay your $200 incident fee.</p>
                <a href="https://buy.stripe.com/3cIbJ36cj0nmbFDdMv2Ji01" style="display:inline-block;background:#ffffff;color:#1d1d1f;font-weight:500;font-size:15px;padding:13px 22px;border-radius:100px;text-decoration:none;">Pay $200 &amp; activate ticket &rarr;</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      ` : ''}

      <!-- TICKET SUMMARY -->
      <tr>
        <td style="background:#ffffff;padding:0 40px 32px;" align="left">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;border-radius:14px;">
            <tr>
              <td style="padding:20px 22px;font-size:14px;color:#424245;line-height:1.6;">
                <span style="display:inline-block;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#86868b;font-weight:600;margin-bottom:8px;">Your ticket</span><br>
                <strong style="font-weight:600;color:#1d1d1f;">Type:</strong> ${escapeHtml(prettyTicketType(ticketType))}<br>
                <strong style="font-weight:600;color:#1d1d1f;">Urgency:</strong> ${escapeHtml(slaLabel)}<br>
                <strong style="font-weight:600;color:#1d1d1f;">Plan:</strong> ${escapeHtml(prettyPlan(planType))}<br>
                <br>
                <strong style="font-weight:600;color:#1d1d1f;">Description:</strong><br>
                <span style="color:#424245;">${escapeHtml(problemDescription.slice(0, 400))}${problemDescription.length > 400 ? '&hellip;' : ''}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- TIMELINE -->
      <tr>
        <td style="background:#ffffff;padding:24px 40px 48px;" align="left">
          <p style="margin:0 0 18px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#86868b;font-weight:600;">What happens next</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${[
              isPpi ? 'You pay your $200 fee (link above).' : 'Agent reads your ticket and pulls Mac Mini logs.',
              isPpi ? 'Agent picks up the ticket within 5 minutes.' : 'Draft fix prepared, sent to you for one-click approval if needed.',
              `Resolution email arrives within ${slaLabel.toLowerCase()}.`,
              'You receive the full audit log: what we changed, what we ran, prevention tips.',
            ].map((step, i) => `
            <tr>
              <td width="32" valign="top" style="padding:0 0 14px;">
                <div style="width:24px;height:24px;border-radius:50%;background:#0071e3;color:#fff;font-size:12px;font-weight:600;line-height:24px;text-align:center;">${i + 1}</div>
              </td>
              <td valign="top" style="padding:2px 0 14px;font-size:15px;color:#1d1d1f;line-height:1.5;">${step}</td>
            </tr>`).join('')}
          </table>
        </td>
      </tr>

      <!-- DARK FOOTER -->
      <tr>
        <td style="background:#0a0a0a;border-radius:0 0 20px 20px;padding:36px 40px;" align="left">
          <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#86868b;font-weight:600;">Reply to this email</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#f5f5f7;letter-spacing:-0.005em;">
            Need to add details? Just reply. The thread auto-attaches to ticket ${escapeHtml(ticketId)}.
          </p>
          <div style="height:1px;background:#1d1d1f;line-height:1px;font-size:1px;margin:0 0 20px;">&nbsp;</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="left" style="font-size:13px;color:#86868b;line-height:1.5;">
                <span style="display:inline-block;width:6px;height:6px;background:#0071e3;border-radius:50%;margin-right:8px;vertical-align:middle;"></span><span style="color:#f5f5f7;font-weight:600;">TurnkeyAI Support</span><br>
                <span style="font-size:11px;color:#6e6e73;">support@tkai.com.au</span>
              </td>
              <td align="right" style="font-size:11px;color:#6e6e73;">
                <a href="https://turnkeyai.com.au/support/" style="color:#86868b;text-decoration:none;">turnkeyai.com.au/support</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- LEGAL -->
      <tr>
        <td style="padding:20px 8px;text-align:center;font-size:11px;color:#86868b;line-height:1.6;">
          You're receiving this because you opened ticket ${escapeHtml(ticketId)} on turnkeyai.com.au/support.
        </td>
      </tr>

    </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { html, text };
}

// ─────────────────────────────────────────────────────
// Team notification email (data-dense for triage)
// ─────────────────────────────────────────────────────
function buildTeamEmail(ctx) {
  const {
    ticketId, firstName, lastName, email, phone, businessName,
    planType, ticketType, urgency, problemDescription, accessMethod,
    dataBackupConfirmed, stripeSessionId, submittedAt,
  } = ctx;
  const isPpi = isPayPerIncident(planType);

  const text = `New support ticket: ${ticketId}

Plan: ${prettyPlan(planType)}${isPpi ? ' — ⚠️ PAYMENT REQUIRED before action' : ''}
Urgency: ${prettyUrgency(urgency)}
Ticket type: ${prettyTicketType(ticketType)}

Lead:
- Name: ${firstName} ${lastName}
- Business: ${businessName}
- Email: ${email}
- Phone: ${phone || 'not provided'}

Access method: ${prettyAccess(accessMethod)}
Data backup confirmed: ${dataBackupConfirmed ? 'YES' : 'NO'}
Stripe session: ${stripeSessionId || 'none'}
Submitted at: ${submittedAt}

────── PROBLEM DESCRIPTION ──────

${problemDescription}

──────────────────────────────────

Reply to this email to respond directly to ${firstName} (Reply-To set to ${email}).
`;

  const urgencyColor = urgency === 'urgent' ? '#ff9500' : '#86868b';

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif;color:#1d1d1f;line-height:1.55;">
<div style="max-width:680px;margin:0 auto;padding:32px 24px;">

  <p style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#0071e3;font-weight:600;margin:0 0 8px;">Ticket ${escapeHtml(ticketId)}</p>
  <h1 style="font-size:22px;margin:0 0 20px;letter-spacing:-0.01em;">New support ticket from ${escapeHtml(firstName)} ${escapeHtml(lastName)}</h1>

  <table cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:14px;width:100%;border:1px solid #e8e8ed;">
    <tr>
      <td style="padding:16px 20px;border-bottom:1px solid #e8e8ed;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Plan</span>
        <p style="margin:4px 0 0;font-size:15px;font-weight:500;">${escapeHtml(prettyPlan(planType))}${isPpi ? ' <span style="color:#d70015;font-weight:600;">· PAYMENT REQUIRED</span>' : ''}</p>
      </td>
      <td style="padding:16px 20px;border-bottom:1px solid #e8e8ed;border-left:1px solid #e8e8ed;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Urgency</span>
        <p style="margin:4px 0 0;font-size:15px;font-weight:500;color:${urgencyColor};">${escapeHtml(prettyUrgency(urgency))}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 20px;border-bottom:1px solid #e8e8ed;" colspan="2">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Ticket type</span>
        <p style="margin:4px 0 0;font-size:15px;font-weight:500;">${escapeHtml(prettyTicketType(ticketType))}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 20px;border-bottom:1px solid #e8e8ed;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Business</span>
        <p style="margin:4px 0 0;font-size:15px;font-weight:500;">${escapeHtml(businessName)}</p>
      </td>
      <td style="padding:16px 20px;border-bottom:1px solid #e8e8ed;border-left:1px solid #e8e8ed;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Submitted at</span>
        <p style="margin:4px 0 0;font-size:13px;color:#6e6e73;">${escapeHtml(submittedAt)}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 20px;border-bottom:1px solid #e8e8ed;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Email</span>
        <p style="margin:4px 0 0;font-size:14px;"><a href="mailto:${escapeHtml(email)}" style="color:#0071e3;">${escapeHtml(email)}</a></p>
      </td>
      <td style="padding:16px 20px;border-bottom:1px solid #e8e8ed;border-left:1px solid #e8e8ed;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Phone</span>
        <p style="margin:4px 0 0;font-size:14px;">${escapeHtml(phone) || '<span style="color:#86868b;">not provided</span>'}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 20px;border-bottom:1px solid #e8e8ed;" colspan="2">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Access method</span>
        <p style="margin:4px 0 0;font-size:14px;">${escapeHtml(prettyAccess(accessMethod))}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 20px;" colspan="2">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Backup confirmed</span>
        <p style="margin:4px 0 0;font-size:14px;color:${dataBackupConfirmed ? '#1d9d4f' : '#d70015'};font-weight:500;">${dataBackupConfirmed ? '✓ YES' : '✗ NO'}</p>
      </td>
    </tr>
  </table>

  <div style="background:#f5f5f7;border-radius:14px;padding:20px;margin-top:20px;">
    <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;margin:0 0 10px;">Problem description</p>
    <p style="margin:0;font-size:15px;line-height:1.55;color:#1d1d1f;white-space:pre-wrap;">${escapeHtml(problemDescription)}</p>
  </div>

  <p style="font-size:12px;color:#86868b;margin-top:24px;text-align:center;">
    Reply to this email to respond directly to ${escapeHtml(firstName)} (Reply-To set to ${escapeHtml(email)}).
  </p>
</div>
</body></html>`;

  return { html, text };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// HMAC-SHA256 hex digest using Web Crypto (available in Netlify Functions runtime).
async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  const msgData = enc.encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
