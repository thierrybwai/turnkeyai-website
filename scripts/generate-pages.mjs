// Generates 4 geo + 10 industry SEO pages with unique content each.
// Run from project root: node scripts/generate-pages.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// ─────────────────────────────────────────────────────
// CITY DATA (4 entries, unique content per city)
// ─────────────────────────────────────────────────────
const CITIES = [
  {
    slug: 'brisbane',
    name: 'Brisbane',
    region: 'Queensland',
    population: '2.6 million',
    lat: -27.4698, lon: 153.0251,
    angle: 'capital of Queensland with 240,000 registered businesses across professional services, construction, and property management',
    localFlavor: 'From Newstead to Fortitude Valley, Brisbane SMEs are scaling lean. They aren\'t hiring 5 admins. They\'re hiring one and automating the rest.',
    topIndustries: ['Professional services', 'Construction & trades', 'Property management', 'Healthcare', 'Hospitality'],
    typicalDeployments: 'A South Brisbane accounting firm cutting their BAS prep from 14 hours to 90 minutes. A Newstead property manager handling 3x more listings without new hires. A Toowong dental practice automating reminders and recalls.',
    travelTime: 'Day-7 install on-site anywhere from CBD to Caboolture, no extra fee.',
    competitorAngle: 'Most Brisbane "AI consultants" sell you discovery sessions and 8-week timelines. We hand you a working system in 7 business days.',
  },
  {
    slug: 'gold-coast',
    name: 'Gold Coast',
    region: 'Queensland',
    population: '700,000',
    lat: -28.0167, lon: 153.4000,
    angle: 'lifestyle capital of QLD with a heavy concentration of property managers, hospitality operators, and trades',
    localFlavor: 'From Surfers Paradise to Burleigh, Gold Coast operators are juggling weekend volume with skeleton weekday teams. AI fills the gap that hiring can\'t.',
    topIndustries: ['Property management & holiday rentals', 'Hospitality', 'Trades', 'Real estate', 'Wellness & beauty'],
    typicalDeployments: 'A Burleigh STR manager triaging guest comms in 4 languages. A Robina trades business dispatching 80 jobs/week with 1 admin. A Coolangatta clinic running same-day intake for walk-ins.',
    travelTime: 'On-site install from Coolangatta to Coomera, included.',
    competitorAngle: 'Gold Coast SMEs don\'t need cloud subscriptions priced for Sydney enterprises. They need a $5,999 box that pays for itself in 4 weeks.',
  },
  {
    slug: 'sunshine-coast',
    name: 'Sunshine Coast',
    region: 'Queensland',
    population: '350,000',
    lat: -26.6500, lon: 153.0667,
    angle: 'fastest-growing region in Australia with strong concentrations in lifestyle services, healthcare, and tourism',
    localFlavor: 'From Noosa to Caloundra, the Sunshine Coast is full of operators who chose lifestyle over Brisbane. Lean teams, growing demand. AI keeps the workload sustainable.',
    topIndustries: ['Hospitality & tourism', 'Real estate', 'Allied health', 'Property management', 'Construction'],
    typicalDeployments: 'A Noosa B&B operator drafting all guest replies in their voice. A Maroochydore physio practice automating intake and rebooking. A Mooloolaba real estate agency handling 200% more enquiries with the same team.',
    travelTime: 'Same-day on-site from Caloundra to Cooroy, no surcharge.',
    competitorAngle: 'You moved here for the lifestyle. AI gives you the time to actually live it.',
  },
  {
    slug: 'cairns',
    name: 'Cairns',
    region: 'Queensland',
    population: '160,000',
    lat: -16.9203, lon: 145.7710,
    angle: 'gateway to the Reef and tropical north QLD, a magnet for tourism operators, allied health, and small trades',
    localFlavor: 'From the Esplanade to Smithfield, Cairns operators are drowning in seasonal volume with year-round teams that can\'t scale up and down. AI flexes where headcount can\'t.',
    topIndustries: ['Tourism & hospitality', 'Allied health', 'Trades & construction', 'Retail', 'Real estate'],
    typicalDeployments: 'A Trinity Beach tour operator handling 5x peak-season enquiries with the same 2 staff. A Cairns Central retail group automating stock alerts and supplier comms. A Manunda allied health clinic automating intake forms and Medicare follow-ups.',
    travelTime: 'On-site install across Cairns and northern beaches, including Port Douglas on request.',
    competitorAngle: 'There\'s no Cairns AI consultancy. You either fly someone up from Brisbane or wait. We come to you, install on day 7, leave you with a system that runs.',
  },
];

// ─────────────────────────────────────────────────────
// INDUSTRY DATA (10 entries, unique content per industry)
// ─────────────────────────────────────────────────────
const INDUSTRIES = [
  {
    slug: 'accountants',
    name: 'Accountants & Bookkeepers',
    shortName: 'accountants',
    h1: 'AI for accountants and bookkeepers, deployed in 7 days.',
    subhead: 'Automate BAS prep, invoice processing, and client comms. Save 12-18 hours a week per practitioner without hiring.',
    painPoints: 'BAS season eats your weekends. Receipts pile up. Client comms slip through the cracks. Junior staff turnover means rebuilding processes every 18 months.',
    workflows: [
      { name: 'BAS prep automation', detail: 'AI reads bank feeds and Xero data, drafts BAS in your format, flags exceptions for review. Time per BAS down from 6-14 hours to 30-90 minutes.' },
      { name: 'Receipt + invoice triage', detail: 'Forwarded receipts get categorised, GST extracted, attached to the right Xero transaction. Zero manual data entry.' },
      { name: 'Client query inbox', detail: 'AI drafts replies to "What\'s my GST balance?" and "Can I claim this?" using your client\'s actual data. You review and send.' },
      { name: 'Year-end follow-ups', detail: 'AI tracks which clients still owe info, drafts personalised follow-up emails in your voice, escalates only the unresponsive.' },
      { name: 'New client onboarding', detail: 'AI fills the engagement letter, generates the data request list specific to their business, sends the welcome sequence. You meet them ready.' },
    ],
    roiExample: 'A 3-partner Brisbane firm cut BAS time from 11h average to 1h45 per client. Net effect: capacity for 40 more clients without hiring.',
    relatedTools: ['Xero', 'MYOB', 'QuickBooks', 'Receipt Bank / Dext', 'Karbon', 'Microsoft 365', 'Slack'],
    keyPhrase: 'AI for accountants Australia',
  },
  {
    slug: 'real-estate',
    name: 'Real Estate & Property Management',
    shortName: 'real estate',
    h1: 'AI for real estate agencies and property managers.',
    subhead: 'Triage tenant comms, dispatch maintenance, draft listings. Run 200% more properties with the same team.',
    painPoints: 'Maintenance dispatch eats your week. Tenant comms after-hours kill your team. Listing copy takes 2 hours each. Owner reports take 4. New leads sit overnight.',
    workflows: [
      { name: 'Maintenance dispatch', detail: 'AI reads tenant requests, classifies urgency, matches to the right contractor by skill and availability, sends quote back to tenant. Only escalates exceptions.' },
      { name: 'Tenant comms triage', detail: 'AI replies to routine tenant queries in plain English, bookings, lease questions, payment dates. After-hours comms handled before you wake up.' },
      { name: 'Listing copy drafting', detail: 'You upload photos and basics. AI drafts headline, hero copy, and description in your agency\'s voice. Listing live in 10 minutes.' },
      { name: 'Owner reports', detail: 'Monthly owner statements drafted automatically with rent collection, maintenance summary, market notes. You sign off, AI sends.' },
      { name: 'Lead qualifier', detail: 'AI engages new enquiries within 2 minutes, qualifies budget and timeline, books inspections. Cold leads get to your inbox warm.' },
    ],
    roiExample: 'A Burleigh property manager went from 80 properties to 200 with the same 3-person team. Tenant satisfaction up 22%.',
    relatedTools: ['PropertyMe', 'PropertyTree', 'Rex CRM', 'Realhub', 'Console Cloud', 'Domain', 'realestate.com.au'],
    keyPhrase: 'AI for real estate agencies Australia',
  },
  {
    slug: 'law-firms',
    name: 'Law Firms & Legal Services',
    shortName: 'law firms',
    h1: 'AI for Australian law firms.',
    subhead: 'Automate intake, contract review, and matter updates. Bill 30% more hours without billing them.',
    painPoints: 'New client intake takes 90 minutes per matter. Contract review is paralegal-grade work eating partner hours. Matter status updates cost 4 hours of admin a week. NDA review is 80% repetition.',
    workflows: [
      { name: 'Client intake automation', detail: 'AI runs the intake interview via web form or Slack, drafts the conflict check, generates the engagement letter, files everything in your matter management system.' },
      { name: 'NDA + contract review', detail: 'AI flags non-standard clauses, missing protections, and risk-rated changes against your firm\'s playbook. Partner review time cut 60%.' },
      { name: 'Matter status updates', detail: 'AI drafts client updates from your matter notes weekly, includes outstanding actions and projected next steps. You sign and send.' },
      { name: 'Discovery + document review', detail: 'AI categorises and summarises discovery documents, flags privileged content, generates a chronology. Junior solicitor work, in minutes.' },
      { name: 'Time entry capture', detail: 'AI watches your calendar and email, drafts timesheet entries with matter codes and narratives. Accept, edit, or skip in your billing tool.' },
    ],
    roiExample: 'A 5-partner Gold Coast firm reclaimed 9 billable hours per partner per week. ROI of 18x in year one.',
    relatedTools: ['LEAP', 'Smokeball', 'Actionstep', 'Affinity', 'NetDocuments', 'Microsoft 365', 'Outlook'],
    keyPhrase: 'AI for law firms Australia',
  },
  {
    slug: 'medical-clinics',
    name: 'Medical & Allied Health Clinics',
    shortName: 'clinics',
    h1: 'AI for medical and allied health clinics.',
    subhead: 'Automate intake, scheduling, and Medicare follow-ups. See 25% more patients per week without burning out reception.',
    painPoints: 'Reception is 70% phone tag. Intake forms get lost. Recalls fall through. Medicare claims take 3 days to resubmit. Patient comms after-hours pile up overnight.',
    workflows: [
      { name: 'Patient intake automation', detail: 'AI runs the intake form via SMS or web, validates Medicare numbers, files the patient record, alerts reception only if action needed.' },
      { name: 'Smart scheduling + recalls', detail: 'AI books, reschedules, and sends recall reminders by SMS. 60% fewer no-shows, zero phone tag.' },
      { name: 'Medicare claim review', detail: 'AI checks claims against Medicare item rules before submission. Rejection rate drops from 12% to under 2%.' },
      { name: 'Triage and same-day routing', detail: 'AI screens incoming requests, identifies urgent presentations, routes to the right practitioner. Reception stops being a bottleneck.' },
      { name: 'After-hours patient comms', detail: 'AI replies to routine queries (next appointment, prescription renewal, results) overnight. Urgent cases escalated to on-call by SMS.' },
    ],
    roiExample: 'A 4-practitioner Sunshine Coast physio practice added 30 appointments per week without new staff. Reception stress cut massively.',
    relatedTools: ['Best Practice', 'Medical Director', 'Cliniko', 'Halaxy', 'PracSuite', 'HealthEngine', 'Hot Doc'],
    keyPhrase: 'AI for medical clinics Australia',
  },
  {
    slug: 'trades',
    name: 'Trades, Plumbing & Electrical',
    shortName: 'trades',
    h1: 'AI for trades, plumbers, and electricians.',
    subhead: 'Quote, schedule, and dispatch jobs in seconds. Run 3x more jobs per week without an extra admin.',
    painPoints: 'Quote requests pile up overnight. Scheduling is a Tetris nightmare. Job sheets get lost between truck and office. Invoices go out 2 weeks late. Bookkeeper bill is climbing.',
    workflows: [
      { name: 'Quote drafting from photo + description', detail: 'Customer texts a photo + description. AI drafts the quote against your pricebook, sends it back inside 3 minutes. You approve before it goes out.' },
      { name: 'Job dispatch + routing', detail: 'AI assigns jobs to the right tradie by location, skill, availability, and customer preference. Routes optimised for fuel and time.' },
      { name: 'Job sheet + photo capture', detail: 'AI prompts the tradie at site for before/after photos, materials used, and time. Job sheet auto-generated for the customer.' },
      { name: 'Invoice + follow-up', detail: 'Job complete = invoice in customer\'s inbox in 60 seconds. Auto-follow-ups at day 7, 14, 21 cut overdue receivables 70%.' },
      { name: 'Compliance + warranty tracking', detail: 'AI logs every certificate of compliance and warranty against the job. Audits and callbacks become 5-minute tasks.' },
    ],
    roiExample: 'A Robina plumbing business went from 40 to 110 jobs per week with the same 6 tradies and 1 admin. Invoicing cycle: 14 days to 2.',
    relatedTools: ['ServiceM8', 'simPRO', 'AroFlo', 'Tradify', 'Xero', 'MYOB', 'Slack'],
    keyPhrase: 'AI for trades Australia',
  },
  {
    slug: 'hospitality',
    name: 'Hospitality, Hotels & Holiday Rentals',
    shortName: 'hospitality',
    h1: 'AI for hospitality, hotels, and STR operators.',
    subhead: 'Automate guest comms, reviews, and turnovers. Run more rooms, faster, in 4 languages.',
    painPoints: 'Guest comms is a 24/7 job. Cleaners get the wrong checklist. Reviews go un-replied. OTA messages slip through. Repetitive questions burn your front desk.',
    workflows: [
      { name: 'Guest comms in 4 languages', detail: 'AI replies to bookings, check-in questions, restaurant recs, and complaints in English, French, Mandarin, and German. Tone matches your property.' },
      { name: 'Cleaner dispatch + checklists', detail: 'AI sends checkout-specific cleaning checklists to the right cleaner with photos of last guest\'s state. Issues reported back into ops.' },
      { name: 'Review reply automation', detail: 'AI drafts replies to every review, flags negatives for human attention. Response rate jumps to 100%, owner reads only the bad ones.' },
      { name: 'OTA message triage', detail: 'Booking.com, Airbnb, Expedia, all unified into one inbox with AI replying or escalating. No more juggling tabs.' },
      { name: 'Upsell automation', detail: 'AI offers late checkouts, room upgrades, breakfast adds at the right moment, in the guest\'s language. Conversion 2-4x manual.' },
    ],
    roiExample: 'A Noosa boutique hotel hit 96% guest comms within 5 minutes, up from 31%. Reviews up 0.4 stars in 60 days.',
    relatedTools: ['Hostaway', 'Guesty', 'Lodgify', 'Cloudbeds', 'Mews', 'Airbnb', 'Booking.com', 'Expedia'],
    keyPhrase: 'AI for hospitality Australia',
  },
  {
    slug: 'recruitment',
    name: 'Recruitment & HR Agencies',
    shortName: 'recruitment',
    h1: 'AI for recruitment agencies and internal HR.',
    subhead: 'Screen CVs, schedule interviews, draft offers. Place candidates 40% faster.',
    painPoints: 'CV pile is unmanageable. Interview scheduling takes 6 emails per slot. Reference checks fall behind. Onboarding paperwork is a 3-day exercise. Time-to-place keeps creeping up.',
    workflows: [
      { name: 'CV screening at scale', detail: 'AI reads every CV against the role brief, scores candidates, flags top 10%. Bad CVs filtered, good ones surfaced with notes.' },
      { name: 'Interview scheduling', detail: 'AI handles back-and-forth between candidate, hiring manager, and panel. Slot booked in 2 messages, not 12 emails.' },
      { name: 'Reference check automation', detail: 'AI sends, follows up, and summarises reference checks. Returns a 1-page summary per candidate within 48 hours.' },
      { name: 'Offer drafting', detail: 'AI generates offer letters from the role brief and candidate file, ready for sign-off in 2 minutes.' },
      { name: 'Onboarding sequence', detail: 'Day 1 paperwork, IT requests, calendar invites, welcome messages, all auto-generated and sent. Candidate ready to start, no admin chase.' },
    ],
    roiExample: 'A Brisbane recruitment agency cut average time-to-place from 23 days to 14. Consultant capacity up 40%.',
    relatedTools: ['Bullhorn', 'JobAdder', 'Workable', 'Greenhouse', 'LinkedIn Recruiter', 'Calendly'],
    keyPhrase: 'AI for recruitment agencies Australia',
  },
  {
    slug: 'marketing-agencies',
    name: 'Marketing & Creative Agencies',
    shortName: 'marketing agencies',
    h1: 'AI for marketing and creative agencies.',
    subhead: 'Automate reporting, content ops, and client comms. Take on 50% more retainers without growing headcount.',
    painPoints: 'Client reporting eats Fridays. Content briefs drag for 3 days. Status updates break flow. Analytics dashboards are stale. Junior turnover means re-onboarding every quarter.',
    workflows: [
      { name: 'Client reporting automation', detail: 'AI pulls from GA4, Meta, Google Ads, LinkedIn, drafts the monthly client report in your template with insights, not just numbers. Friday reclaimed.' },
      { name: 'Brief-to-draft', detail: 'Account manager drops the brief in Slack. AI generates first-draft copy, deck, or email matching the client\'s tone. Designer or strategist polishes.' },
      { name: 'Status update generator', detail: 'AI watches Asana / ClickUp / Notion, drafts weekly client updates with what shipped, what\'s pending, blockers. Account team reviews in 5 minutes.' },
      { name: 'Approval chasing', detail: 'AI follows up clients on pending approvals at the right cadence in your voice. Stuck assets unstuck without an awkward email from you.' },
      { name: 'Pitch deck assembler', detail: 'New brief in. AI assembles a custom pitch deck from your asset library, tailored to the prospect\'s industry and challenge. Delivered same-day.' },
    ],
    roiExample: 'A 12-person Melbourne agency added 8 clients without new hires. Reporting time per client: 6h to 35min.',
    relatedTools: ['Asana', 'ClickUp', 'Notion', 'Slack', 'Google Ads', 'Meta Business', 'LinkedIn Campaign Manager', 'GA4'],
    keyPhrase: 'AI for marketing agencies Australia',
  },
  {
    slug: 'ecommerce',
    name: 'E-Commerce & Online Retail',
    shortName: 'e-commerce',
    h1: 'AI for Australian e-commerce and online retail.',
    subhead: 'Automate customer service, supplier comms, and product ops. Free your team to grow the brand.',
    painPoints: 'CS tickets pile during sales. Refund requests drag the team. Supplier comms are a daily slog. Product description writing is a graveyard. Reviews go un-replied.',
    workflows: [
      { name: 'Customer service triage', detail: 'AI replies to "Where\'s my order?", "How do I return?", "Is X in stock?" in your brand voice. Escalates only complex cases.' },
      { name: 'Refund + return processing', detail: 'AI checks return policy against the order, drafts the refund flow, files in Shopify or your platform. Customer gets the answer in 90 seconds.' },
      { name: 'Supplier order management', detail: 'AI drafts POs from your stock thresholds, follows up suppliers on ETAs, alerts ops when shipments slip.' },
      { name: 'Product description generator', detail: 'New SKU? AI writes title, description, bullets, and SEO meta from the product brief and image. Live on store in 5 minutes.' },
      { name: 'Review + UGC management', detail: 'AI replies to every review, flags issues for product team, surfaces best UGC for marketing approval.' },
    ],
    roiExample: 'A Brisbane apparel brand handles 4x peak-sale CS volume with the same 2 staff. Average reply time: 6h to 3min.',
    relatedTools: ['Shopify', 'WooCommerce', 'Klaviyo', 'Gorgias', 'Zendesk', 'Slack', 'Xero'],
    keyPhrase: 'AI for ecommerce Australia',
  },
  {
    slug: 'consulting',
    name: 'Consulting & Professional Services',
    shortName: 'consulting',
    h1: 'AI for consulting and professional services firms.',
    subhead: 'Automate proposals, research, and client reporting. Bill more hours doing actual consulting.',
    painPoints: 'Proposals take 6 hours each. Research is junior-grade work eating senior hours. Decks are rebuilt from scratch every project. Client status reports drift behind schedule.',
    workflows: [
      { name: 'Proposal drafting', detail: 'AI generates proposals from the brief and your firm\'s case studies, methodology, and pricing. Senior reviews and customises in 30 minutes, not 6 hours.' },
      { name: 'Research + synthesis', detail: 'AI runs market and competitor research, summarises into the format your team uses, cites sources. Junior consultant work, in minutes.' },
      { name: 'Deck assembly', detail: 'AI builds the first-cut deck from your project brief and asset library, structured to your firm\'s template. Strategist polishes the punchlines.' },
      { name: 'Status reporting', detail: 'Weekly client status drafted from your Notion / Asana, includes risks, blockers, decisions needed. You review in 10 minutes.' },
      { name: 'Knowledge management', detail: 'Every project brief, deck, and outcome auto-indexed and searchable. Junior consultants find the right precedent in 30 seconds.' },
    ],
    roiExample: 'A 7-person Brisbane strategy firm bid on 60% more projects in Q2. Proposal time per opportunity: 6h to 1h15.',
    relatedTools: ['Notion', 'Asana', 'Microsoft 365', 'Google Workspace', 'Slack', 'Calendly', 'HubSpot'],
    keyPhrase: 'AI for consulting firms Australia',
  },
];

// ─────────────────────────────────────────────────────
// SHARED PARTS
// ─────────────────────────────────────────────────────
function navHtml(activePath = '') {
  return `<nav class="tk-nav">
  <div class="tk-nav-inner">
    <a href="/" class="tk-brand">TurnkeyAI</a>
    <ul class="tk-nav-links">
      <li><a href="/#packages" class="tk-nav-link">Packages</a></li>
      <li><a href="/#roi" class="tk-nav-link">ROI</a></li>
      <li><a href="/#how" class="tk-nav-link">How it works</a></li>
      <li><a href="/blog/" class="tk-nav-link">Blog</a></li>
      <li><a href="/#booking" class="tk-nav-link">Get started</a></li>
    </ul>
    <a href="/#booking" class="tk-btn tk-btn--primary tk-btn--sm">Get started</a>
  </div>
</nav>`;
}

function footerHtml() {
  return `<footer class="tk-footer-rich">
  <div class="tk-footer-grid">
    <div>
      <a href="/" class="tk-brand" style="margin-bottom: 16px;">TurnkeyAI</a>
      <p class="tk-small" style="margin-top: 12px; max-width: 280px;">
        Done-for-you AI automation for Australian SMEs. Live in 7 days, on a Mac Mini in your office.
      </p>
    </div>
    <div>
      <p class="tk-eyebrow" style="margin-bottom: 14px;">Locations</p>
      <ul class="tk-footer-links">
        <li><a href="/brisbane/">Brisbane</a></li>
        <li><a href="/gold-coast/">Gold Coast</a></li>
        <li><a href="/sunshine-coast/">Sunshine Coast</a></li>
        <li><a href="/cairns/">Cairns</a></li>
      </ul>
    </div>
    <div>
      <p class="tk-eyebrow" style="margin-bottom: 14px;">Industries</p>
      <ul class="tk-footer-links">
        <li><a href="/for-accountants/">Accountants</a></li>
        <li><a href="/for-real-estate/">Real estate</a></li>
        <li><a href="/for-trades/">Trades</a></li>
        <li><a href="/for-medical-clinics/">Clinics</a></li>
        <li><a href="/for-hospitality/">Hospitality</a></li>
      </ul>
    </div>
    <div>
      <p class="tk-eyebrow" style="margin-bottom: 14px;">Legal &amp; Contact</p>
      <ul class="tk-footer-links">
        <li><a href="/blog/">Blog</a></li>
        <li><a href="/legal/terms.html">Terms</a></li>
        <li><a href="/legal/privacy.html">Privacy</a></li>
        <li><a href="mailto:start@tkai.com.au">start@tkai.com.au</a></li>
      </ul>
    </div>
  </div>
  <div class="tk-footer-bottom">
    <span>&copy; 2026 TurnkeyAI. All prices AUD ex-GST.</span>
    <span class="tk-footer-pulse">
      <span class="tk-pulse-dot"></span>
      Currently accepting new clients
    </span>
  </div>
</footer>`;
}

// ─────────────────────────────────────────────────────
// CITY PAGE TEMPLATE
// ─────────────────────────────────────────────────────
function buildCityPage(city) {
  const url = `https://turnkeyai.com.au/${city.slug}/`;
  const title = `AI Automation in ${city.name}, QLD: Live in 7 Days | TurnkeyAI`;
  const description = `Done-for-you AI automation for ${city.name} SMEs. We deploy a working AI system on a Mac Mini in your office, live in 7 business days. Saves the average user $1,500-$2,000 a week.`;

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Service",
        "name": `AI Automation Services in ${city.name}`,
        "serviceType": "AI System Deployment",
        "provider": {
          "@type": "Organization",
          "name": "TurnkeyAI",
          "url": "https://turnkeyai.com.au/"
        },
        "areaServed": {
          "@type": "City",
          "name": city.name,
          "containedInPlace": {
            "@type": "AdministrativeArea",
            "name": "Queensland"
          }
        },
        "description": description
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://turnkeyai.com.au/" },
          { "@type": "ListItem", "position": 2, "name": `AI Automation ${city.name}`, "item": url }
        ]
      }
    ]
  };

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta name="geo.region" content="AU-QLD">
<meta name="geo.placename" content="${city.name}">
<meta name="geo.position" content="${city.lat};${city.lon}">
<meta name="ICBM" content="${city.lat}, ${city.lon}">
<link rel="stylesheet" href="/assets/brand.css">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
</head>
<body>

${navHtml(`/${city.slug}/`)}

<header class="tk-section tk-section--tight" style="padding-top: 80px; padding-bottom: 32px;">
  <div class="tk-content tk-fade-up">
    <p class="tk-eyebrow">For ${city.name}, ${city.region}</p>
    <h1 class="tk-h1" style="margin-bottom: 20px;">Working AI in your ${city.name} office, in seven business days.</h1>
    <p class="tk-lede tk-muted" style="max-width: 660px;">
      ${city.localFlavor} TurnkeyAI builds, configures, and installs a complete AI system on a Mac Mini in your office, no subscription, no developers, no waiting six months for a SaaS rollout.
    </p>
    <div style="display: inline-flex; gap: 12px; flex-wrap: wrap; margin-top: 28px;">
      <a href="/#booking" class="tk-btn tk-btn--primary tk-btn--lg">Get my AI running in 7 days <span class="arrow">→</span></a>
      <a href="/#roi" class="tk-btn tk-btn--ghost">Calculate my saving</a>
    </div>
  </div>
</header>

<section class="tk-section" style="padding-top: 32px; padding-bottom: 64px;">
  <div class="tk-wide">
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px;">
      <div class="tk-card" style="padding: 28px;">
        <p class="tk-eyebrow">Population</p>
        <p class="tk-h3" style="margin-top: 8px;">${city.population}</p>
        <p class="tk-small" style="margin-top: 8px;">${city.region} region</p>
      </div>
      <div class="tk-card" style="padding: 28px;">
        <p class="tk-eyebrow">Time to live</p>
        <p class="tk-h3" style="margin-top: 8px;">7 business days</p>
        <p class="tk-small" style="margin-top: 8px;">Day 1 onboarding to Day 7 install</p>
      </div>
      <div class="tk-card" style="padding: 28px;">
        <p class="tk-eyebrow">On-site</p>
        <p class="tk-h3" style="margin-top: 8px;">No surcharge</p>
        <p class="tk-small" style="margin-top: 8px;">${city.travelTime}</p>
      </div>
      <div class="tk-card" style="padding: 28px;">
        <p class="tk-eyebrow">Investment</p>
        <p class="tk-h3" style="margin-top: 8px;">From $5,999</p>
        <p class="tk-small" style="margin-top: 8px;">One-time. Mac Mini yours forever.</p>
      </div>
    </div>
  </div>
</section>

<section class="tk-section tk-section--alt" style="padding-top: 96px; padding-bottom: 96px;">
  <div class="tk-content">
    <div class="tk-fade-up" style="max-width: 720px; margin-bottom: 40px;">
      <p class="tk-eyebrow">Built for ${city.name}</p>
      <h2 class="tk-h2" style="margin-bottom: 20px;">${city.name} runs on small businesses. We give them an unfair advantage.</h2>
      <p class="tk-lede tk-muted">
        ${city.name} is the ${city.angle}. Our deployments here typically replace 8 to 16 hours a week of admin work per Mac Mini. ${city.competitorAngle}
      </p>
    </div>

    <div class="tk-fade-up" style="margin-top: 40px;">
      <p class="tk-eyebrow">Top industries we serve in ${city.name}</p>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 16px;">
        ${city.topIndustries.map(ind => `<div style="padding: 18px 22px; background: var(--tk-bg-elev); border-radius: 14px; font-weight: 500;">${ind}</div>`).join('\n        ')}
      </div>
    </div>
  </div>
</section>

<section class="tk-section">
  <div class="tk-content tk-fade-up">
    <p class="tk-eyebrow">Real ${city.name} deployments</p>
    <h2 class="tk-h2" style="margin-bottom: 20px;">What live AI looks like in ${city.name}.</h2>
    <p class="tk-lede tk-muted" style="max-width: 660px;">
      ${city.typicalDeployments}
    </p>
  </div>
</section>

<section class="tk-section" style="padding-top: 0;">
  <div class="tk-cta-banner tk-fade-up">
    <h2 class="tk-h2" style="font-size: 36px;">Ready to run your ${city.name} business on AI?</h2>
    <p>Submit your brief. Reply within 2 business hours. Day 7, your Mac Mini is in your office.</p>
    <a href="/#booking" class="tk-btn tk-btn--primary tk-btn--lg">Get my AI running in 7 days <span class="arrow">→</span></a>
  </div>
</section>

${footerHtml()}

<script src="/assets/shared.js" defer></script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────
// INDUSTRY PAGE TEMPLATE
// ─────────────────────────────────────────────────────
function buildIndustryPage(ind) {
  const url = `https://turnkeyai.com.au/for-${ind.slug}/`;
  const title = `${ind.name}: AI Automation Live in 7 Days | TurnkeyAI`;
  const description = `${ind.subhead} Done-for-you AI for ${ind.shortName} across Australia. From $5,999, Mac Mini yours forever.`;

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Service",
        "name": ind.h1,
        "serviceType": "AI Automation",
        "provider": {
          "@type": "Organization",
          "name": "TurnkeyAI",
          "url": "https://turnkeyai.com.au/"
        },
        "areaServed": { "@type": "Country", "name": "Australia" },
        "description": description,
        "audience": { "@type": "BusinessAudience", "audienceType": ind.name }
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://turnkeyai.com.au/" },
          { "@type": "ListItem", "position": 2, "name": ind.name, "item": url }
        ]
      }
    ]
  };

  const workflowsHtml = ind.workflows.map((w, i) => `
        <div class="tk-fade-up" style="padding: 32px; background: var(--tk-bg-elev); border-radius: 22px; box-shadow: 0 1px 1px rgba(0,0,0,0.03), 0 12px 32px -16px hsl(var(--tk-shadow-color) / 0.15);">
          <div style="display: flex; align-items: baseline; gap: 14px; margin-bottom: 12px;">
            <span style="font-family: var(--tk-font-display); font-size: 36px; line-height: 1; letter-spacing: -0.04em; font-weight: 600; color: var(--tk-accent);">0${i + 1}</span>
            <h3 class="tk-h3" style="font-size: 20px;">${w.name}</h3>
          </div>
          <p style="margin: 0; color: var(--tk-fg-muted); line-height: 1.6;">${w.detail}</p>
        </div>`).join('');

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<link rel="stylesheet" href="/assets/brand.css">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
</head>
<body>

${navHtml(`/for-${ind.slug}/`)}

<header class="tk-section tk-section--tight" style="padding-top: 80px; padding-bottom: 32px;">
  <div class="tk-content tk-fade-up">
    <p class="tk-eyebrow">For ${ind.name}</p>
    <h1 class="tk-h1" style="margin-bottom: 20px;">${ind.h1}</h1>
    <p class="tk-lede tk-muted" style="max-width: 680px;">
      ${ind.subhead}
    </p>
    <div style="display: inline-flex; gap: 12px; flex-wrap: wrap; margin-top: 28px;">
      <a href="/#booking" class="tk-btn tk-btn--primary tk-btn--lg">Get my AI running in 7 days <span class="arrow">→</span></a>
      <a href="/#roi" class="tk-btn tk-btn--ghost">Calculate my saving</a>
    </div>
  </div>
</header>

<section class="tk-section" style="padding-top: 32px; padding-bottom: 64px;">
  <div class="tk-content tk-fade-up">
    <div class="tk-card" style="padding: 32px; background: var(--tk-bg-deep); color: #f5f3f0;">
      <p class="tk-eyebrow" style="color: rgba(255,255,255,0.55);">The honest version</p>
      <p style="margin: 12px 0 0; font-size: 19px; line-height: 1.55; color: #f5f3f0;">
        ${ind.painPoints}
      </p>
    </div>
  </div>
</section>

<section class="tk-section tk-section--alt">
  <div class="tk-wide">
    <div class="tk-fade-up" style="max-width: 720px; margin-bottom: 48px;">
      <p class="tk-eyebrow">Workflows we deploy</p>
      <h2 class="tk-h2" style="margin-bottom: 20px;">Five working AI systems for ${ind.shortName}, live on day 7.</h2>
      <p class="tk-lede tk-muted">
        Each workflow runs on the Mac Mini in your office. Your team interacts with it via Slack or Telegram in plain English. No developers, no SaaS subscriptions, no integrations to wire up.
      </p>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">
        ${workflowsHtml}
    </div>
  </div>
</section>

<section class="tk-section">
  <div class="tk-content tk-fade-up">
    <p class="tk-eyebrow">What this looks like in practice</p>
    <h2 class="tk-h2" style="margin-bottom: 20px;">Real example.</h2>
    <p class="tk-lede tk-muted" style="max-width: 720px;">
      ${ind.roiExample}
    </p>
  </div>
</section>

<section class="tk-section" style="padding-top: 0;">
  <div class="tk-content tk-fade-up">
    <p class="tk-eyebrow">Already integrated with the tools you use</p>
    <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px;">
      ${ind.relatedTools.map(t => `<span style="padding: 10px 18px; background: var(--tk-bg-alt); border-radius: 100px; font-size: 14px; font-weight: 500;">${t}</span>`).join('\n      ')}
    </div>
  </div>
</section>

<section class="tk-section" style="padding-top: 32px;">
  <div class="tk-cta-banner tk-fade-up">
    <h2 class="tk-h2" style="font-size: 36px;">Built for ${ind.shortName}. Live in 7 days.</h2>
    <p>One brief. Reply within 2 business hours. From $5,999. Mac Mini yours forever.</p>
    <a href="/#booking" class="tk-btn tk-btn--primary tk-btn--lg">Get my AI running in 7 days <span class="arrow">→</span></a>
  </div>
</section>

${footerHtml()}

<script src="/assets/shared.js" defer></script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────
// WRITE FILES + UPDATE SITEMAP
// ─────────────────────────────────────────────────────
function writeFile(relativePath, content) {
  const fullPath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  console.log('✓ wrote', relativePath);
}

console.log('\n=== Generating CITY pages ===');
for (const c of CITIES) {
  writeFile(`${c.slug}/index.html`, buildCityPage(c));
}

console.log('\n=== Generating INDUSTRY pages ===');
for (const ind of INDUSTRIES) {
  writeFile(`for-${ind.slug}/index.html`, buildIndustryPage(ind));
}

console.log('\n=== Updating sitemap.xml ===');
const today = '2026-04-28';
const sitemapEntries = [
  { loc: 'https://turnkeyai.com.au/', lastmod: today, change: 'weekly', pri: '1.0' },
  { loc: 'https://turnkeyai.com.au/blog/', lastmod: today, change: 'weekly', pri: '0.9' },
  { loc: 'https://turnkeyai.com.au/blog/posts/the-3-questions.html', lastmod: today, change: 'monthly', pri: '0.8' },
  { loc: 'https://turnkeyai.com.au/blog/posts/why-mac-mini.html', lastmod: '2026-04-22', change: 'monthly', pri: '0.8' },
  { loc: 'https://turnkeyai.com.au/blog/posts/7-day-deployment.html', lastmod: '2026-04-15', change: 'monthly', pri: '0.8' },
  ...CITIES.map(c => ({ loc: `https://turnkeyai.com.au/${c.slug}/`, lastmod: today, change: 'monthly', pri: '0.85' })),
  ...INDUSTRIES.map(i => ({ loc: `https://turnkeyai.com.au/for-${i.slug}/`, lastmod: today, change: 'monthly', pri: '0.85' })),
  { loc: 'https://turnkeyai.com.au/legal/terms.html', lastmod: today, change: 'yearly', pri: '0.4' },
  { loc: 'https://turnkeyai.com.au/legal/privacy.html', lastmod: today, change: 'yearly', pri: '0.4' },
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.map(e => `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.change}</changefreq>
    <priority>${e.pri}</priority>
  </url>`).join('\n')}
</urlset>
`;
writeFile('sitemap.xml', sitemap);

console.log('\n✅ Done. Generated', CITIES.length, 'city pages +', INDUSTRIES.length, 'industry pages + sitemap.');
