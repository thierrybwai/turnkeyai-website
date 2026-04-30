// Triggered automatically by Netlify whenever a form on the site is submitted.
// Sends an action-oriented confirmation email to the lead via Resend.

export default async (req) => {
  try {
    const payload = await req.json();
    const data = payload?.payload?.data || {};
    const formName = payload?.payload?.form_name || '';

    if (formName !== 'ai-audit') {
      return new Response('Ignored: not the lead form', { status: 200 });
    }

    const firstName = (data.firstName || 'there').trim();
    const email = (data.email || '').trim();
    const businessName = (data.businessName || '').trim();
    const industry = (data.industry || '').trim();
    const packageInterest = (data.packageInterest || '').trim();

    if (!email) {
      return new Response('No email on submission', { status: 200 });
    }

    const subject = `We've started, ${firstName}. One task from you to keep us moving.`;
    const { html, text } = buildEmail({ firstName, businessName, industry, packageInterest });

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'TurnkeyAI <start@tkai.com.au>',
        reply_to: 'start@tkai.com.au',
        to: [email],
        subject,
        html,
        text,
      }),
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text();
      console.error('Resend API error:', resendRes.status, errBody);
      return new Response(`Resend failed: ${resendRes.status}`, { status: 502 });
    }

    return new Response('Confirmation email sent', { status: 200 });
  } catch (err) {
    console.error('submission-created error:', err);
    return new Response('Error', { status: 500 });
  }
};

function buildEmail({ firstName, businessName, industry, packageInterest }) {
  const recap = [
    businessName && `Business: ${businessName}`,
    industry && `Industry: ${prettyIndustry(industry)}`,
    packageInterest && `Package: ${prettyPackage(packageInterest)}`,
  ].filter(Boolean).join(' · ');

  const text = `Hi ${firstName},

Got your brief. We've already started building your AI agent on our end.

There's one thing we need from you to keep us moving:

Create a new email address for your AI agent.

Why a separate address?
Your agent will read its own inbox, send its own replies, and connect to your tools (CRM, calendar, accounting, support). Keeping it separate from your personal or main business email keeps audit trails clean and access easy to revoke later. We apply this to every deployment.

What to do (5 minutes):

1. Create a new mailbox at your business domain, for example: ai@yourbusiness.com.au. Or a fresh Google Workspace or Microsoft 365 account if that's faster.

2. Reply to this email with:
   - The new email address
   - A temporary password (we change it once setup is complete)
   - Whether it's hosted on Google Workspace, Microsoft 365, or another provider

3. That's it. We take it from there.

${recap ? recap + '\n\n' : ''}A note on security: any credentials you share are stored encrypted, used only for the one-time setup, and either rotated or fully revoked at your discretion once your agent is operational.

What happens next:
- You send us the new email address (today).
- We configure your agent and connect it to your tools (within 24 hours of receiving your details).
- We run pre-flight checks. You hear back from us within 2 business hours of completion.
- Day 7: your Mac Mini is in your office, your AI agent is running.

Talk soon,
TurnkeyAI

P.S. The faster the email credentials reach us, the faster we ship. Most clients reply within an hour and have their agent running by day 5.
`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>We've started, ${escapeHtml(firstName)}</title>
<!--[if mso]>
<style>table,td,div,h1,h2,h3,p {font-family: Helvetica, Arial, sans-serif !important;}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background:#f2f2f4;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;line-height:1.55;-webkit-font-smoothing:antialiased;">

  <!-- Preheader (hidden) -->
  <div style="display:none;font-size:1px;color:#f2f2f4;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    Your AI agent build has started. One quick task from you to keep us moving.
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
                    Build started
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td style="background:#ffffff;padding:56px 40px 32px;" align="left">
              <p style="margin:0 0 14px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#0071e3;font-weight:600;">Brief received · work has started</p>
              <h1 style="margin:0 0 20px;font-size:36px;line-height:1.1;letter-spacing:-0.02em;font-weight:600;color:#1d1d1f;">Thanks, ${escapeHtml(firstName)}.</h1>
              <p style="margin:0;font-size:17px;line-height:1.55;color:#1d1d1f;">
                Your AI agent is on our build queue. We've started on our end. To keep us moving, there's <strong style="font-weight:600;">one task for you today</strong>.
              </p>
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
                Your agent will read its own inbox, send its own replies, and connect to your tools (CRM, calendar, accounting, support). Keeping it separate from your personal or main business email keeps audit trails clean and access easy to revoke later. We apply this to every deployment.
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
                    <p style="margin:0;font-size:15px;line-height:1.6;color:#424245;">At your business domain, for example: <span style="font-family:ui-monospace,'SF Mono',Menlo,monospace;background:#f5f5f7;padding:1px 6px;border-radius:4px;">ai@yourbusiness.com.au</span>. Or a fresh Google Workspace / Microsoft 365 account if that's faster.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- STEP 2 -->
          <tr>
            <td style="background:#ffffff;padding:32px 40px 0;" align="left">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="56" valign="top" style="font-size:48px;line-height:1;font-weight:600;letter-spacing:-0.04em;color:#0071e3;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding-right:16px;">02</td>
                  <td valign="top">
                    <h3 style="margin:0 0 10px;font-size:18px;line-height:1.35;letter-spacing:-0.01em;font-weight:600;color:#1d1d1f;">Reply to this email with the details</h3>
                    <p style="margin:0;font-size:15px;line-height:1.6;color:#424245;">The new email address, a temporary password (we rotate it after setup), and whether it's hosted on Google Workspace, Microsoft 365, or another provider.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- STEP 3 -->
          <tr>
            <td style="background:#ffffff;padding:32px 40px 48px;" align="left">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="56" valign="top" style="font-size:48px;line-height:1;font-weight:600;letter-spacing:-0.04em;color:#0071e3;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding-right:16px;">03</td>
                  <td valign="top">
                    <h3 style="margin:0 0 10px;font-size:18px;line-height:1.35;letter-spacing:-0.01em;font-weight:600;color:#1d1d1f;">We take it from there</h3>
                    <p style="margin:0;font-size:15px;line-height:1.6;color:#424245;">Configuration, integration, testing. Within 24 hours of receiving your details, we run pre-flight checks and you hear back with confirmation that everything is set up.</p>
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
                    Any credentials you share are stored encrypted, used only for the one-time setup, and either rotated or fully revoked at your discretion once your agent is operational. We never store passwords in plain text.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- WHAT HAPPENS NEXT -->
          <tr>
            <td style="background:#ffffff;padding:0 40px 56px;border-radius:0 0 0 0;" align="left">
              <p style="margin:0 0 24px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#86868b;font-weight:600;">What happens next</p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="32" valign="top" style="padding:0 0 18px;">
                    <div style="width:24px;height:24px;border-radius:50%;background:#0071e3;color:#fff;font-size:12px;font-weight:600;line-height:24px;text-align:center;">1</div>
                  </td>
                  <td valign="top" style="padding:2px 0 18px;font-size:15px;color:#1d1d1f;line-height:1.5;">You send us the new email address (today).</td>
                </tr>
                <tr>
                  <td width="32" valign="top" style="padding:0 0 18px;">
                    <div style="width:24px;height:24px;border-radius:50%;background:#0071e3;color:#fff;font-size:12px;font-weight:600;line-height:24px;text-align:center;">2</div>
                  </td>
                  <td valign="top" style="padding:2px 0 18px;font-size:15px;color:#1d1d1f;line-height:1.5;">We configure your agent and connect it to your tools (within 24 hours).</td>
                </tr>
                <tr>
                  <td width="32" valign="top" style="padding:0 0 18px;">
                    <div style="width:24px;height:24px;border-radius:50%;background:#0071e3;color:#fff;font-size:12px;font-weight:600;line-height:24px;text-align:center;">3</div>
                  </td>
                  <td valign="top" style="padding:2px 0 18px;font-size:15px;color:#1d1d1f;line-height:1.5;">We run pre-flight checks. You hear back within 2 business hours of completion.</td>
                </tr>
                <tr>
                  <td width="32" valign="top">
                    <div style="width:24px;height:24px;border-radius:50%;background:#0071e3;color:#fff;font-size:12px;font-weight:600;line-height:24px;text-align:center;">4</div>
                  </td>
                  <td valign="top" style="padding:2px 0 0;font-size:15px;color:#1d1d1f;line-height:1.5;"><strong style="font-weight:600;">Day 7</strong>: your Mac Mini is in your office, your agent is running.</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- DARK FOOTER -->
          <tr>
            <td style="background:#0a0a0a;border-radius:0 0 20px 20px;padding:40px;" align="left">
              <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#86868b;font-weight:600;">P.S.</p>
              <p style="margin:0 0 28px;font-size:17px;line-height:1.5;color:#f5f5f7;letter-spacing:-0.01em;">
                The faster the email credentials reach us, the faster we ship. Most clients reply within an hour and have their agent running by day 5.
              </p>
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
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
    professional: 'Professional ($5,999)',
    business: 'Business ($10,999)',
    enterprise: 'Enterprise ($24,999)',
    unsure: 'Help me decide',
  };
  return map[slug] || slug;
}
