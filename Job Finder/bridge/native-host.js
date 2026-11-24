// Chrome native messaging host: Chrome starts this program itself when the extension asks
// Claude Code for a resume, talks to it over stdin/stdout (no network, so browser proxies
// don't matter), and it exits once it has answered.
//
// Registered by: node bridge/install-native-host.js
// Protocol: each message is a 4-byte little-endian length followed by that much UTF-8 JSON.
// Nothing else may be written to stdout.
const { handle } = require('./handlers');

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (buffer.length < 4 + len) break;
    const body = buffer.subarray(4, 4 + len).toString('utf8');
    buffer = buffer.subarray(4 + len);
    onMessage(body);
  }
});

// Chrome closes stdin when the extension is done with us.
process.stdin.on('end', () => process.exit(0));

async function onMessage(body) {
  let msg;
  try {
    msg = JSON.parse(body);
  } catch {
    return reply({ error: 'Invalid message.' });
  }
  try {
    reply(await handle(msg));
  } catch (e) {
    reply({ error: e.message });
  }
}

function reply(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}
