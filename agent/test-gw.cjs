const WebSocket = require('ws');

async function test() {
  const ws = new WebSocket('wss://api.ottoarc.xyz', { headers: { Origin: 'https://ottoarc.xyz' } });
  const timeout = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 15000);
  ws.on('open', () => console.log('1. Connected'));
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    const errText = typeof msg.error === 'object' ? msg.error.message || msg.error.code : msg.error;
    console.log('MSG:', msg.type, msg.event || '', msg.id || '', msg.ok !== undefined ? 'ok=' + msg.ok : '', errText || '');
    if (msg.event === 'connect.challenge') {
      ws.send(JSON.stringify({
        type: 'req', id: '0', method: 'connect',
        params: {
          minProtocol: 3, maxProtocol: 3,
          client: { id: 'openclaw-control-ui', version: '1.0.0', platform: 'web', mode: 'ui' },
          role: 'operator', scopes: ['operator.read', 'operator.write'],
          caps: [], commands: [], permissions: {},
          auth: { token: 'otto-demo-gw-2026' },
          locale: 'en-US', userAgent: 'otto-webchat/1.0.0'
        }
      }));
    }
    if (msg.type === 'res' && msg.id === '0') {
      if (msg.ok) {
        console.log('AUTH SUCCESS! Sending message...');
        ws.send(JSON.stringify({
          type: 'req', id: '1', method: 'chat.send',
          params: { sessionKey: 'test-' + Date.now(), message: 'what tools do you have?', deliver: false, idempotencyKey: 'test-1' }
        }));
      } else { clearTimeout(timeout); ws.close(); }
    }
    if (msg.type === 'res' && msg.id === '1') {
      console.log('chat.send ok=' + msg.ok);
    }
    if (msg.type === 'event' && msg.event === 'chat') {
      const s = msg.payload.state;
      const t = (msg.payload.text || '').slice(0, 150);
      if (s === 'delta') process.stdout.write('.');
      if (s === 'complete') {
        console.log('\nREPLY:', t);
        clearTimeout(timeout); ws.close();
      }
    }
  });
  ws.on('error', (e) => { console.log('ERROR:', e.message); clearTimeout(timeout); process.exit(1); });
}
test();
