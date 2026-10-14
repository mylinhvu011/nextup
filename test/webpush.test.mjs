// Verifies src/webpush.js against the reference decryption library (http_ece)
// and Node's own ECDSA verification. Run: node test/webpush.test.mjs
import { createRequire } from 'module';
import nodeCrypto from 'crypto';
import assert from 'assert';
import { generateVapidKeys, encryptPayload, vapidAuthHeader, sendPush, b64urlDecode, b64urlEncode } from '../src/webpush.js';

const require = createRequire(import.meta.url);
const ece = require('http_ece');

// A fake browser subscription
const ua = nodeCrypto.createECDH('prime256v1');
ua.generateKeys();
const auth = nodeCrypto.randomBytes(16);
const sub = {
  endpoint: 'https://push.example.com/send/abc123',
  keys: { p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(auth) }
};

// 1) Encryption round-trips through the reference implementation
const msg = JSON.stringify({ title: "You're up next!", body: 'Game 4 is next on the field. 🏃' });
const body = await encryptPayload(sub, msg);
const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth });
assert.strictEqual(plain.toString('utf8'), msg);
console.log('✔ payload decrypts with reference http_ece');

// 2) VAPID JWT verifies with the public key
const keys = await generateVapidKeys();
assert.strictEqual(b64urlDecode(keys.publicKey).length, 65);
const header = await vapidAuthHeader(sub.endpoint, { ...keys, subject: 'mailto:test@example.com' });
const m = header.match(/^vapid t=([^,]+), k=(.+)$/);
assert.ok(m, header);
const [h, c, s] = m[1].split('.');
const claims = JSON.parse(Buffer.from(c, 'base64url'));
assert.strictEqual(claims.aud, 'https://push.example.com');
assert.ok(claims.exp > Date.now() / 1000);
const pub = b64urlDecode(m[2]);
const keyObj = nodeCrypto.createPublicKey({
  key: { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33)) }, format: 'jwk'
});
const okSig = nodeCrypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: keyObj, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
assert.ok(okSig, 'signature valid');
console.log('✔ VAPID JWT signature verifies');

// 3) sendPush builds the right request
let seen;
globalThis.fetch = async (url, init) => { seen = { url, init }; return new Response(null, { status: 201 }); };
const r = await sendPush(sub, { title: 'x' }, { ...keys });
assert.ok(r.ok);
assert.strictEqual(seen.url, sub.endpoint);
assert.strictEqual(seen.init.headers['Content-Encoding'], 'aes128gcm');
assert.strictEqual(seen.init.headers.TTL, '900');
const dec = ece.decrypt(Buffer.from(seen.init.body), { version: 'aes128gcm', privateKey: ua, authSecret: auth });
assert.deepStrictEqual(JSON.parse(dec), { title: 'x' });
console.log('✔ sendPush request is well formed');
