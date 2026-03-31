/**
 * Netlify Function: Form Submission Handler + Brevo Email
 * Sends auto-reply email when TurnkeyAI booking form is submitted
 */

const https = require('https');

// Get from Netlify environment variables
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'support@turnkeyai.com.au';

// Helper: POST to Brevo API
function sendBrevoEmail(emailData) {
  return new Promise((resolve, reject) => {
    // Brevo expects specific format
    const payload = {
      to: emailData.to,
      from: emailData.from,
      subject: emailData.subject,
      htmlContent: emailData.htmlContent
    };
    
    const data = JSON.stringify(payload);
    
    const options = {
      hostname: 'api.brevo.com',
      port: 443,
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY,
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, status: res.statusCode, body });
        } else {
          reject(new Error(`Brevo API error: ${res.statusCode} ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Main handler
exports.handler = async (event) => {
  // Only handle POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Parse form data
    const body = JSON.parse(event.body);
    const {
      firstName = '',
      lastName = '',
      email = '',
      phone = '',
      businessName = '',
      packageInterest = '',
      automationInterests = []
    } = body;

    // Validate required fields
    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email is required' })
      };
    }

    // Build auto-reply email
    const autoReplyEmail = {
      to: [{ email, name: firstName }],
      from: { email: SENDER_EMAIL, name: 'TurnkeyAI Team' },
      subject: "Your Free AI Audit Request — We're Ready! 🚀",
      htmlContent: `
        <html>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto;">
              <h2>Hi ${firstName},</h2>
              
              <p>Thank you for requesting a <strong>Free AI Audit</strong> from TurnkeyAI! 🚀</p>
              
              <p>We've received your request and our team will get back to you <strong>within 24 hours</strong> with:</p>
              <ul>
                <li>5 specific automations your business can run on Day 1</li>
                <li>Estimated weekly savings with AI</li>
                <li>A clear implementation timeline</li>
              </ul>
              
              <p><strong>In the meantime:</strong></p>
              <p>Check out our <a href="https://turnkeyai.com.au">full service packages</a> and see how other Australian businesses are deploying AI.</p>
              
              <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
              
              <p><strong>Quick facts:</strong></p>
              <ul>
                <li>✅ Live & running within 7 days</li>
                <li>✅ Average weekly saving: $1,500+</li>
                <li>✅ Break-even in 3 weeks</li>
                <li>✅ 5+ roles replaced or augmented</li>
              </ul>
              
              <p>Have any questions? Reply to this email or <a href="tel:+61413134388">call us at +61 413 134 388</a></p>
              
              <p>Best regards,<br>
              <strong>The TurnkeyAI Team</strong><br>
              Gold Coast, Australia</p>
              
              <p style="font-size: 12px; color: #999; margin-top: 30px;">
                This is an automated response. Your inquiry has been recorded and assigned to our team.
              </p>
            </div>
          </body>
        </html>
      `
    };

    // Send auto-reply email
    await sendBrevoEmail(autoReplyEmail);

    // Also send internal notification
    const internalEmail = {
      to: [{ email: 'thierry@bwpg.com.au', name: 'Thierry' }],
      from: { email: SENDER_EMAIL, name: 'TurnkeyAI System' },
      subject: `🔔 New AI Audit Request: ${businessName || 'Unknown'}`,
      htmlContent: `
        <html>
          <body style="font-family: Arial, sans-serif;">
            <h3>New Booking Request</h3>
            <p><strong>Name:</strong> ${firstName} ${lastName}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone}</p>
            <p><strong>Business:</strong> ${businessName}</p>
            <p><strong>Package Interest:</strong> ${packageInterest || 'Not specified'}</p>
            <p><strong>Automation Interests:</strong> ${automationInterests.join(', ') || 'Not specified'}</p>
            <p><em>Follow up within 24 hours</em></p>
          </body>
        </html>
      `
    };

    await sendBrevoEmail(internalEmail);

    // Return success
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Email sent successfully',
        recipientEmail: email
      })
    };
  } catch (error) {
    console.error('Form submission error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to process form submission',
        details: error.message
      })
    };
  }
};
