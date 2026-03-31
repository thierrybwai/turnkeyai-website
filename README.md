# TurnkeyAI Website

AI-powered business automation platform for Australian SMEs.

**Website:** https://turnkeyai.com.au

## Overview

- **Hosted on:** Netlify
- **Form Automation:** Netlify Functions + Brevo email service
- **Form Submissions:** Auto-reply emails + internal notifications

## Folder Structure

```
turnkeyai-website/
├── functions/
│   └── contact-form.js    # Netlify Function — handles form submissions
├── netlify.toml           # Netlify configuration
├── package.json           # Node dependencies (if needed)
└── README.md              # This file
```

## Form Automation

### `/contact-form` Function

**Endpoint:** `/.netlify/functions/contact-form`

**What it does:**
- Receives form submissions from the "Book Your Free AI Audit" form
- Sends auto-reply email to submitter (via Brevo)
- Sends internal notification to thierry@bwpg.com.au

**Required Environment Variables (in Netlify):**
- `BREVO_API_KEY` — Brevo API key (from https://brevo.com)
- `SENDER_EMAIL` — Verified sender email (default: support@turnkeyai.com.au)

**Form Fields:**
- firstName (required)
- lastName (required)
- email (required)
- phone (optional)
- businessName (required)
- packageInterest (required)
- automationInterests (optional, array)

## Setup

### 1. Connect to Netlify

```bash
netlify link --id=95daee06-11dd-46f0-baf2-490ecf10bdf1
```

### 2. Set Environment Variables

In Netlify dashboard:
1. Go to **Site Settings** → **Build & Deploy** → **Environment**
2. Add:
   - `BREVO_API_KEY`: Your Brevo API key
   - `SENDER_EMAIL`: Your verified sender email

### 3. Deploy

```bash
netlify deploy --prod
```

## Testing the Form

```bash
curl -X POST https://turnkeyai.com.au/.netlify/functions/contact-form \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "User",
    "email": "test@example.com",
    "phone": "+61413134388",
    "businessName": "Test Co",
    "packageInterest": "Professional",
    "automationInterests": ["Emails", "CRM"]
  }'
```

## Support

Contact: thierry@bwpg.com.au
