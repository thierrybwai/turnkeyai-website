import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = [
  'ai-for-small-business/index.html',
  'ai-for-real-estate/index.html',
  'ai-for-tradies/index.html',
];

for (const page of pages) {
  const html = readFileSync(page, 'utf8');

  assert(!html.includes('—'), `${page}: published copy contains an em dash`);
  assert(!html.includes('12 months hosting included'), `${page}: hosting is incorrectly time-limited`);
  assert(!html.includes('2 weeks dedicated support after launch'), `${page}: ongoing operation is presented as two weeks`);
  assert(!html.includes('2× more specific'), `${page}: unsupported 2x claim remains`);

  assert(!html.includes('id="step1"'), `${page}: mandatory pre-form step remains`);
  assert(!html.includes('id="step2"'), `${page}: hidden contact step remains`);
  assert(html.includes('id="leadform"'), `${page}: single-step lead form is missing`);
  assert(html.includes('Email my free workflow plan'), `${page}: CTA does not name the deliverable`);

  const requiredFields = [...html.matchAll(/<input\b[^>]*\brequired\b[^>]*>/g)];
  assert.equal(requiredFields.length, 2, `${page}: form must have exactly two required inputs`);
  assert(requiredFields.some(([tag]) => /name="first"/.test(tag)), `${page}: first name is not required`);
  assert(requiredFields.some(([tag]) => /name="email"/.test(tag)), `${page}: email is not required`);

  for (const field of ['gbraid', 'wbraid', 'leadContent', 'leadTerm', 'leadPlacement', 'leadReferrer']) {
    assert(html.includes(`name="${field}"`), `${page}: ${field} attribution field is missing`);
  }

  assert(html.includes("p.get('kw')"), `${page}: cleaned kw parameter is not read`);
  const keywordDelete = html.indexOf("searchParams.delete('keyword')");
  assert(keywordDelete >= 0, `${page}: keyword parameter is not removed`);
  assert(keywordDelete < html.indexOf("googletagmanager.com/gtag/js"), `${page}: keyword cleanup must run before GA4 loads`);
  assert(html.includes("p.get('gclid') || p.get('gbraid') || p.get('wbraid')"), `${page}: privacy-safe Google click IDs do not set paid-search attribution`);
  assert(html.includes("addEventListener('focusin'"), `${page}: form_start is not tied to field interaction`);
  assert(html.includes("e.target.matches('input:not([type=hidden]), select, textarea')"), `${page}: form_start includes non-field interactions`);
  assert(html.includes("form_submit_attempt"), `${page}: submit attempt event is missing`);
  assert(html.includes("form_submit_error"), `${page}: submit error event is missing`);
  assert(html.includes("form_submit_success"), `${page}: submit success event is missing`);
  assert(html.includes('new AbortController()'), `${page}: stalled form posts have no timeout`);
  assert(html.includes("email.indexOf('test') !== -1"), `${page}: internal test leads are not filtered from conversion pixels`);
  assert(html.includes('!isLocal && !isTestLead'), `${page}: local/test submissions can fire conversion pixels`);
  assert(html.includes('if(IS_LOCAL || sent[name]) return'), `${page}: local previews can pollute funnel events`);
  assert(!html.includes('attempt < 2'), `${page}: ambiguous automatic POST retry remains`);
  assert(html.includes('body.classList.toggle(\'form-visible\''), `${page}: sticky CTA is not hidden over the form`);
  assert(html.includes('role="alert"'), `${page}: form error is not announced`);
  assert(html.includes('role="status"'), `${page}: success state has no status role`);
  assert(html.includes('aria-live="polite"'), `${page}: success state is not announced`);
  assert(html.includes('tabindex="-1"'), `${page}: success state cannot receive focus`);
  assert(html.includes("addEventListener('keydown'"), `${page}: card CTAs are not keyboard accessible`);

  for (const [, source] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    assert.doesNotThrow(() => new Function(source), `${page}: inline JavaScript does not compile`);
  }
}

const handler = readFileSync('netlify/functions/submission-created-background.js', 'utf8');
for (const field of ['gclid', 'gbraid', 'wbraid']) {
  assert(handler.includes(`${field}:`), `CRM attribution does not forward ${field}`);
}
assert(handler.includes('data.utm_content'), 'backend does not fall back to utm_content');
assert(handler.includes('data.utm_term'), 'backend does not fall back to utm_term');
assert(handler.includes("small_business: 'Small Business'"), 'small-business industry context is missing');
assert(handler.includes("timeEater = (data.time_eater || '').trim()"), 'selected time drain is not normalized');
assert(handler.includes("Biggest time drain: ${timeEater || 'not provided'}"), 'selected time drain is not used in the generated plan');
assert(!handler.includes('30-day support'), 'generated plans still promise time-limited support');
assert(!handler.includes('12 months hosting included'), 'generated plans still contradict ongoing operation');

console.log(`Ad landing CRO regression checks passed for ${pages.length} pages.`);
