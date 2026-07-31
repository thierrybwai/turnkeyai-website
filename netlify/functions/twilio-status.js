// Delivery status callback for nurture SMS. Logs failed/undelivered messages so a
// silently broken sender shows up in the daily digest instead of staying invisible.

import crypto from 'node:crypto';
import { nurtureStore, logOpsEvent, PUBLIC_BASE, safeEqual } from './lib/nurture.js';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return new Response('unconfigured', { status: 503 }); // fail-closed, never an empty HMAC key
  const raw = await req.text();
  const params = new URLSearchParams(raw);

  const url = `${PUBLIC_BASE}/.netlify/functions/twilio-status`;
  const sorted = [...params.keys()].sort().map(k => k + params.get(k)).join('');
  const expected = crypto.createHmac('sha1', authToken)
    .update(url + sorted).digest('base64');
  if (!safeEqual(expected, req.headers.get('x-twilio-signature') || '')) {
    return new Response('Forbidden', { status: 403 });
  }

  const status = params.get('MessageStatus') || '';
  if (status === 'failed' || status === 'undelivered') {
    const store = nurtureStore();
    await logOpsEvent(store, {
      type: 'sms-failed', status,
      to: (params.get('To') || '').slice(0, 6) + '…', // never store the full number here
      code: params.get('ErrorCode') || '',
    });
    console.error(`SMS ${status}: to=${params.get('To')} code=${params.get('ErrorCode')}`);
  }
  return new Response(null, { status: 204 });
};
