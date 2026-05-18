// Support ticket handler — called from submission-created-background.js
// when form_name === 'support-ticket'.
//
// Orchestrates:
//   1. Generate ticket ID (e.g. TK-202605-A1B2C3)
//   2. Send branded confirmation email to client (Resend)
//   3. Send detailed notification to team (start@tkai.com.au)
//
// Note: this used to dispatch to an autonomous Claude agent over a webhook.
// The product now routes every ticket straight to a human on the team — no AI
// repair, no SSH, just a real person replying within one business day.

export async function handleSupportTicket({ data }) {
  try {
    // Anti-spam: honeypot check
    if ((data['hp-field'] || '').trim()) {
      console.log('Honeypot tripped, dropping support ticket');
      return new Response('Ignored: spam', { status: 200 });
    }

    const firstName = (data.firstName || 'there').trim();
    const lastName = (data.lastName || '').trim();
    const email = (data.email || '').trim();
    const phone = (data.phone || '').trim();
    const businessName = (data.businessName || '').trim();
    const ticketType = (data.ticketType || '').trim();
    const urgency = (data.urgency || 'standard').trim();
    const problemDescription = (data.problemDescription || '').trim();
    const deploymentType = (data.deploymentType || '').trim();
    const referrer = (data.referrer || '').trim();
    const stripeSessionId = (data.stripeSessionId || '').trim();

    if (!email) {
      return new Response('No email on ticket', { status: 200 });
    }

    const ticketId = generateTicketId();
    const ctx = {
      ticketId,
      firstName, lastName, email, phone, businessName,
      ticketType, urgency, problemDescription, deploymentType, referrer,
      stripeSessionId,
      submittedAt: new Date().toISOString(),
    };

    // 1. Send confirmation email to client
    try {
      const { html: clientHtml, text: clientText } = buildClientEmail(ctx);
      await sendResend({
        to: [email],
        subject: `Ticket ${ticketId} received. Your $200 intervention is logged.`,
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

    return new Response(`Ticket ${ticketId} processed`, { status: 200 });
  } catch (err) {
    console.error('handleSupportTicket error:', err);
    return new Response('Error', { status: 500 });
  }
}

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
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `TK-${yyyymm}-${suffix}`;
}

function prettyTicketType(t) {
  return ({
    broken: 'Broken / down',
    degraded: 'Performance degraded',
    question: 'Question / how-to',
    tweak: 'Workflow improvement',
    'new-workflow': 'New workflow request',
    security: 'Security concern',
  })[t] || t || 'Unknown';
}

function prettyDeployment(d) {
  return ({
    cloud: 'Cloud OpenClaw (VPS hosted)',
    'mac-mini': 'Mac Mini (on-premise)',
  })[d] || (d ? d : 'Not specified');
}

function prettyUrgency(u) {
  return ({
    standard: 'Standard (within 1 business day)',
    urgent: 'Urgent (same-day if possible)',
  })[u] || u || 'Standard';
}

// ─────────────────────────────────────────────────────
// Client confirmation email (branded, Apple-style)
// ─────────────────────────────────────────────────────
function buildClientEmail(ctx) {
  const { ticketId, firstName, ticketType, urgency, problemDescription, stripeSessionId } = ctx;
  const slaLabel = prettyUrgency(urgency);
  const preview = `Ticket ${ticketId}. Your $200 intervention is logged. A real person replies within one business day.`;

  const text = `Hi ${firstName},

Ticket ${ticketId} received and your $200 intervention is logged. A real person on our team will reply within one business day, usually faster.

Your ticket:
- Type: ${prettyTicketType(ticketType)}
- Urgency: ${slaLabel}
- Description: ${problemDescription.slice(0, 200)}${problemDescription.length > 200 ? '…' : ''}
${stripeSessionId ? `- Stripe reference: ${stripeSessionId}\n` : ''}
What happens next:
1. Your ticket lands at start@tkai.com.au.
2. A real person reads it, pulls up your deployment notes, and drafts a reply.
3. You receive a reply within one business day.
4. The thread stays open in email until everything works — or you get a full refund if we can't fix it.

Need to add details? Just reply to this email — the thread is attached to ticket ${ticketId}.

TurnkeyAI Support
start@tkai.com.au · turnkeyai.com.au
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
          <p style="margin:0 0 14px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#0071e3;font-weight:600;">Ticket ${escapeHtml(ticketId)} &middot; $200 intervention</p>
          <h1 style="margin:0 0 20px;font-size:32px;line-height:1.1;letter-spacing:-0.02em;font-weight:600;color:#1d1d1f;">Got it, ${escapeHtml(firstName)}.</h1>
          <p style="margin:0;font-size:17px;line-height:1.55;color:#1d1d1f;">
            Your $200 intervention is logged. A real person on our team will reply within <strong style="font-weight:600;">one business day</strong>, usually faster. Sit tight &mdash; or reply to this email if anything's changed. Refund in full if we can't fix it.
          </p>
        </td>
      </tr>

      <!-- TICKET SUMMARY -->
      <tr>
        <td style="background:#ffffff;padding:0 40px 32px;" align="left">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;border-radius:14px;">
            <tr>
              <td style="padding:20px 22px;font-size:14px;color:#424245;line-height:1.6;">
                <span style="display:inline-block;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#86868b;font-weight:600;margin-bottom:8px;">Your ticket</span><br>
                <strong style="font-weight:600;color:#1d1d1f;">Type:</strong> ${escapeHtml(prettyTicketType(ticketType))}<br>
                <strong style="font-weight:600;color:#1d1d1f;">Urgency:</strong> ${escapeHtml(slaLabel)}<br>
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
              'Your ticket lands at start@tkai.com.au.',
              'A real person reads it, pulls up your deployment notes, and drafts a reply.',
              'You receive a reply within one business day.',
              "The thread stays open in email until everything works.",
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
                <span style="font-size:11px;color:#6e6e73;">start@tkai.com.au</span>
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
    ticketType, urgency, problemDescription, deploymentType,
    referrer, stripeSessionId, submittedAt,
  } = ctx;

  const text = `New support ticket: ${ticketId}

Stripe payment: ${stripeSessionId ? `${stripeSessionId} (verify at https://dashboard.stripe.com/payments)` : '⚠️ NO STRIPE SESSION ID — verify before responding'}
Urgency: ${prettyUrgency(urgency)}
Ticket type: ${prettyTicketType(ticketType)}
Deployment: ${prettyDeployment(deploymentType)}

Client:
- Name: ${firstName} ${lastName}
- Business: ${businessName}
- Email: ${email}
- Phone: ${phone || 'not provided'}

Submitted at: ${submittedAt}
Referrer: ${referrer || 'direct'}

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
      <td style="padding:16px 20px;border-bottom:1px solid #e8e8ed;" colspan="2">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Stripe payment ($200 intervention)</span>
        <p style="margin:4px 0 0;font-size:14px;font-family:ui-monospace,SFMono-Regular,monospace;color:${stripeSessionId ? '#1d9d4f' : '#d70015'};font-weight:500;">${stripeSessionId ? '✓ ' + escapeHtml(stripeSessionId) : '⚠️ NO STRIPE SESSION ID — verify before responding'}</p>
        ${stripeSessionId ? `<p style="margin:6px 0 0;font-size:11px;color:#86868b;"><a href="https://dashboard.stripe.com/payments" style="color:#0071e3;">Verify in Stripe dashboard &rarr;</a></p>` : ''}
      </td>
    </tr>
    <tr>
      <td style="padding:16px 20px;border-bottom:1px solid #e8e8ed;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Urgency</span>
        <p style="margin:4px 0 0;font-size:15px;font-weight:500;color:${urgencyColor};">${escapeHtml(prettyUrgency(urgency))}</p>
      </td>
      <td style="padding:16px 20px;border-bottom:1px solid #e8e8ed;border-left:1px solid #e8e8ed;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Ticket type</span>
        <p style="margin:4px 0 0;font-size:15px;font-weight:500;">${escapeHtml(prettyTicketType(ticketType))}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 20px;border-bottom:1px solid #e8e8ed;" colspan="2">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Deployment</span>
        <p style="margin:4px 0 0;font-size:15px;font-weight:500;">${escapeHtml(prettyDeployment(deploymentType))}</p>
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
      <td style="padding:16px 20px;" colspan="2">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#86868b;font-weight:600;">Referrer</span>
        <p style="margin:4px 0 0;font-size:13px;color:#6e6e73;">${escapeHtml(referrer) || 'direct'}</p>
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
