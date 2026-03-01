const WebSocket = require('ws');
const crypto = require('crypto');
function base64UrlEncode(buf) { return Buffer.from(buf).toString('base64url'); }

async function test() {
  const keyPair = crypto.generateKeyPairSync('ed25519');
  const rawPub = keyPair.publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
  const publicKeyRaw = base64UrlEncode(rawPub);
  const deviceId = crypto.createHash('sha256').update(rawPub).digest('hex');

  const ws = new WebSocket('wss://api.ottoarc.xyz', { headers: { Origin: 'https://ottoarc.xyz' } });
  const timeout = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 10000);
  ws.on('open', () => console.log('Connected'));
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    const errText = typeof msg.error === 'object' ? msg.error.message || msg.error.code : msg.error;
    console.log('MSG:', msg.type, msg.event || '', msg.id || '', msg.ok !== undefined ? 'ok=' + msg.ok : '', errText || '');
    if (msg.event === 'connect.challenge') {
      const nonce = msg.payload.nonce;
      const signedAtMs = Date.now();
      const payload = ['v3', deviceId, 'webchat', 'webchat', 'operator', 'operator.read,operator.write', String(signedAtMs), '', nonce, 'web', ''].join('|');
      const sig = crypto.sign(null, Buffer.from(payload), keyPair.privateKey);
      ws.send(JSON.stringify({
        type: 'req', id: '0', method: 'connect',
        params: {
          minProtocol: 3, maxProtocol: 3,
          client: { id: 'webchat', version: '1.0.0', platform: 'web', mode: 'webchat' },
          role: 'operator', scopes: ['operator.read', 'operator.write'],
          caps: [], commands: [], permissions: {}, auth: {},
          device: { id: deviceId, publicKey: publicKeyRaw, signature: base64UrlEncode(sig), signedAt: signedAtMs, nonce }
        }
      }));
    }
    if (msg.type === 'res') {
      if (msg.ok === false) { clearTimeout(timeout); ws.close(); }
      if (msg.ok === true && msg.id === '0') {
        console.log('AUTH OK! Payload:', JSON.stringify(msg.payload).slice(0, 200));
        clearTimeout(timeout); ws.close();
      }
    }
  });
  ws.on('error', (e) => { console.log('ERROR:', e.message); clearTimeout(timeout); process.exit(1); });
}
test();
