// Triggered automatically by Netlify whenever a form on the site is submitted.
// Sends a value-first confirmation email to the lead via Resend.

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

    const subject = `Thanks ${firstName}. Here's something useful while you wait.`;
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

Got your brief. Someone reads every one personally, and you'll hear back within 2 business hours with either a 15-minute call slot or an honest "not yet" if we're not the right fit.

${recap ? recap + '\n\n' : ''}While you wait, here's something most SMEs get wrong before they even talk to us.

The 3 questions that decide if AI will actually save you money

Most SMEs pick the wrong role to automate first. They go for the loud one (sales, marketing) when the real money is hiding in the boring one. Before our call, ask yourself:

1. Which role costs you the most in time, not salary?
The answer is rarely the highest-paid person. It's usually the role that interrupts everyone else. An admin who pings 4 people 20 times a day costs the business more than her $60k salary suggests.

2. Which task would you do yourself if you had to?
If the answer is "none of it, I'd hire someone first", that's the role to automate. You're already paying for it whether the seat is filled or not.

3. What breaks when that person is on holiday?
Whatever stops working is the workflow worth automating. Everything else is noise.

Bring your answers to the call. We'll map them to a 7-day deployment in 20 minutes.

What happens next:
- Your brief gets read today
- You receive a reply with a Calendly link (or a kind "not yet")
- If we're a fit, we scope your first 3 workflows on the call
- Day 7, your Mac Mini is running in your office

Talk soon,
TurnkeyAI

P.S. Every day without your AI running is a day you're paying people to do work it could already handle.
`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Thanks ${escapeHtml(firstName)}</title>
<!--[if mso]>
<style>table,td,div,h1,h2,h3,p {font-family: Helvetica, Arial, sans-serif !important;}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background:#f2f2f4;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;line-height:1.55;-webkit-font-smoothing:antialiased;">

  <!-- Preheader (hidden) -->
  <div style="display:none;font-size:1px;color:#f2f2f4;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    The 3 questions that decide if AI will actually save you money. Plus what happens next.
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
                    Confirmation
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td style="background:#ffffff;padding:56px 40px 32px;" align="left">
              <p style="margin:0 0 14px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#0071e3;font-weight:600;">Brief received</p>
              <h1 style="margin:0 0 20px;font-size:36px;line-height:1.1;letter-spacing:-0.02em;font-weight:600;color:#1d1d1f;">Thanks, ${escapeHtml(firstName)}.</h1>
              <p style="margin:0;font-size:17px;line-height:1.55;color:#1d1d1f;">
                Someone reads every brief personally. You'll hear back <strong style="font-weight:600;">within 2 business hours</strong> with either a 15-minute call slot, or an honest "not yet" if we're not the right fit.
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

          <!-- EDITORIAL SECTION -->
          <tr>
            <td style="background:#ffffff;padding:48px 40px 16px;" align="left">
              <p style="margin:0 0 14px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#86868b;font-weight:600;">While you wait</p>
              <h2 style="margin:0 0 18px;font-size:28px;line-height:1.15;letter-spacing:-0.02em;font-weight:600;color:#1d1d1f;">
                The 3 questions that decide<br>if AI will actually save you money.
              </h2>
              <p style="margin:0;font-size:16px;line-height:1.6;color:#424245;">
                Most SMEs pick the wrong role to automate first. They go for the loud one, sales, marketing, when the real money is hiding in the boring one. Before our call, ask yourself:
              </p>
            </td>
          </tr>

          <!-- QUESTION 1 -->
          <tr>
            <td style="background:#ffffff;padding:32px 40px 0;" align="left">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="56" valign="top" style="font-size:48px;line-height:1;font-weight:600;letter-spacing:-0.04em;color:#0071e3;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding-right:16px;">01</td>
                  <td valign="top">
                    <h3 style="margin:0 0 10px;font-size:18px;line-height:1.35;letter-spacing:-0.01em;font-weight:600;color:#1d1d1f;">Which role costs you the most in time, not salary?</h3>
                    <p style="margin:0;font-size:15px;line-height:1.6;color:#424245;">The answer is rarely the highest-paid person. It's usually the role that interrupts everyone else. An admin who pings 4 people 20 times a day costs the business more than her $60k salary suggests.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- QUESTION 2 -->
          <tr>
            <td style="background:#ffffff;padding:32px 40px 0;" align="left">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="56" valign="top" style="font-size:48px;line-height:1;font-weight:600;letter-spacing:-0.04em;color:#0071e3;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding-right:16px;">02</td>
                  <td valign="top">
                    <h3 style="margin:0 0 10px;font-size:18px;line-height:1.35;letter-spacing:-0.01em;font-weight:600;color:#1d1d1f;">Which task would you do yourself if you had to?</h3>
                    <p style="margin:0;font-size:15px;line-height:1.6;color:#424245;">If the answer is "none of it, I'd hire someone first," that's the role to automate. You're already paying for it whether the seat is filled or not.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- QUESTION 3 -->
          <tr>
            <td style="background:#ffffff;padding:32px 40px 48px;" align="left">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="56" valign="top" style="font-size:48px;line-height:1;font-weight:600;letter-spacing:-0.04em;color:#0071e3;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding-right:16px;">03</td>
                  <td valign="top">
                    <h3 style="margin:0 0 10px;font-size:18px;line-height:1.35;letter-spacing:-0.01em;font-weight:600;color:#1d1d1f;">What breaks when that person is on holiday?</h3>
                    <p style="margin:0;font-size:15px;line-height:1.6;color:#424245;">Whatever stops working is the workflow worth automating. Everything else is noise.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CALLOUT -->
          <tr>
            <td style="background:#ffffff;padding:0 40px 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;border-radius:16px;">
                <tr>
                  <td style="padding:24px 28px;font-size:16px;line-height:1.55;color:#1d1d1f;">
                    Bring your answers to the call. We'll map them to a <strong style="font-weight:600;">7-day deployment</strong> in 20 minutes.
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
                  <td valign="top" style="padding:2px 0 18px;font-size:15px;color:#1d1d1f;line-height:1.5;">Your brief gets read today.</td>
                </tr>
                <tr>
                  <td width="32" valign="top" style="padding:0 0 18px;">
                    <div style="width:24px;height:24px;border-radius:50%;background:#0071e3;color:#fff;font-size:12px;font-weight:600;line-height:24px;text-align:center;">2</div>
                  </td>
                  <td valign="top" style="padding:2px 0 18px;font-size:15px;color:#1d1d1f;line-height:1.5;">You receive a reply with a Calendly link, or a kind "not yet."</td>
                </tr>
                <tr>
                  <td width="32" valign="top" style="padding:0 0 18px;">
                    <div style="width:24px;height:24px;border-radius:50%;background:#0071e3;color:#fff;font-size:12px;font-weight:600;line-height:24px;text-align:center;">3</div>
                  </td>
                  <td valign="top" style="padding:2px 0 18px;font-size:15px;color:#1d1d1f;line-height:1.5;">If we're a fit, we scope your first 3 workflows on the call.</td>
                </tr>
                <tr>
                  <td width="32" valign="top">
                    <div style="width:24px;height:24px;border-radius:50%;background:#0071e3;color:#fff;font-size:12px;font-weight:600;line-height:24px;text-align:center;">4</div>
                  </td>
                  <td valign="top" style="padding:2px 0 0;font-size:15px;color:#1d1d1f;line-height:1.5;"><strong style="font-weight:600;">Day 7</strong>: your Mac Mini is running in your office.</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- DARK FOOTER -->
          <tr>
            <td style="background:#0a0a0a;border-radius:0 0 20px 20px;padding:40px;" align="left">
              <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#86868b;font-weight:600;">P.S.</p>
              <p style="margin:0 0 28px;font-size:17px;line-height:1.5;color:#f5f5f7;letter-spacing:-0.01em;">
                Every day without your AI running is a day you're paying people to do work it could already handle.
              </p>
              <div style="height:1px;background:#1d1d1f;line-height:1px;font-size:1px;margin:0 0 24px;">&nbsp;</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" style="font-size:14px;color:#86868b;line-height:1.5;">
                    <span style="display:inline-block;width:6px;height:6px;background:#0071e3;border-radius:50%;margin-right:8px;vertical-align:middle;"></span><span style="color:#f5f5f7;font-weight:600;">TurnkeyAI</span><br>
                    <span style="font-size:12px;color:#6e6e73;">Done-for-you AI automation. 7 days. Hardware yours forever.</span>
                  </td>
                  <td align="right" style="font-size:12px;color:#6e6e73;">
                    <a href="https://tkai.com.au" style="color:#86868b;text-decoration:none;">tkai.com.au</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- LEGAL -->
          <tr>
            <td style="padding:24px 8px;text-align:center;font-size:11px;color:#86868b;line-height:1.6;">
              You're receiving this because you submitted a brief on tkai.com.au.<br>
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
