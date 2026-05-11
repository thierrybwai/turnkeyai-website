// Local test of the full pipeline (Claude → PDFShift) without going through Netlify.
// Outputs the PDF to /tmp/test-deployment-plan.pdf so we can preview it visually.
//
// Usage: node scripts/test-pdf-pipeline.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load secrets from env (never commit the keys directly).
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... PDFSHIFT_API_KEY=sk_... node scripts/test-pdf-pipeline.mjs
if (!process.env.ANTHROPIC_API_KEY || !process.env.PDFSHIFT_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY and PDFSHIFT_API_KEY env vars before running.');
  process.exit(1);
}

// Read the function source so we can extract the helper functions (they're not exported).
const __dirname = dirname(fileURLToPath(import.meta.url));
const fnPath = resolve(__dirname, '..', 'netlify', 'functions', 'submission-created-background.js');
let src = readFileSync(fnPath, 'utf8');

// The default export uses `req.json()` (server context). We bypass it and call the inner
// helpers directly. Easiest: write a temp ESM that exports them.
const exposed = src
  .replace(/^export default async \(req\) => \{[\s\S]*?\n\};\n/m, '')
  + '\nexport { generateSpinContent, renderPdf, buildPdfHtml };\n';

const tmp = resolve(__dirname, '_pipeline-test-module.mjs');
writeFileSync(tmp, exposed);

const { generateSpinContent, renderPdf, buildPdfHtml } = await import('./_pipeline-test-module.mjs?t=' + Date.now());

const fakeLead = {
  firstName: 'Sarah',
  lastName: 'Mitchell',
  businessName: 'Brisbane Bookkeeping Co',
  industry: 'accounting',
  packageInterest: 'business',
};

console.log('\n=== Step 1: Calling Claude Sonnet 4.5 for SPIN content ===');
const t0 = Date.now();
const spin = await generateSpinContent(fakeLead);
console.log(`✓ Claude responded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`  headline: ${spin.headline}`);
console.log(`  recommended_package: ${spin.recommended_package}`);
console.log(`  observations: ${spin.situation_observations?.length || 0}`);
console.log(`  problems: ${spin.problems?.length || 0}`);
console.log(`  workflows: ${spin.workflows?.length || 0}`);

console.log('\n=== Step 2: Render HTML template ===');
const html = buildPdfHtml({ ...fakeLead, spin });
const htmlOut = '/tmp/test-deployment-plan.html';
writeFileSync(htmlOut, html);
console.log(`✓ HTML rendered: ${html.length.toLocaleString()} chars → ${htmlOut}`);

console.log('\n=== Step 3: Send to PDFShift ===');
const t1 = Date.now();
const base64 = await renderPdf(html);
console.log(`✓ PDF rendered in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
console.log(`  base64 size: ${base64.length.toLocaleString()} chars (~${Math.round(base64.length * 0.75 / 1024)} KB binary)`);

const pdfOut = '/tmp/test-deployment-plan.pdf';
writeFileSync(pdfOut, Buffer.from(base64, 'base64'));
console.log(`✓ Saved PDF to ${pdfOut}`);

console.log('\n=== FULL JSON FROM CLAUDE (for inspection) ===');
console.log(JSON.stringify(spin, null, 2));

// Clean up temp module
const fs = await import('node:fs');
fs.unlinkSync(tmp);

console.log('\n✅ Pipeline test complete.\n  → open /tmp/test-deployment-plan.pdf');
