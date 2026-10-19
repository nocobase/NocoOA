/** Expose the running isolated preview on one local LAN interface without restarting its database or sessions.
 * Usage: node tests/fixtures/trial-data-localization/lan-proxy.mjs 192.168.11.30
 * TCP forwarding preserves HTTP Host/Origin and WebSocket handshakes; the existing Vite proxy checks Origin.
 */
import { readFile } from 'node:fs/promises';
import { createConnection, createServer, isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';
import process from 'node:process';
import { URL } from 'node:url';
import path from 'node:path';

const address = process.argv[2];
if (
  !address ||
  !isIPv4(address) ||
  !Object.values(networkInterfaces())
    .flat()
    .some((entry) => entry?.address === address && !entry.internal)
) {
  throw new Error('Provide an IPv4 address assigned to a local LAN interface.');
}
const preview = JSON.parse(
  await readFile(
    path.resolve(
      'storage/ui-workflow/bilingual-trial-isolated-browser/result.json',
    ),
    'utf8',
  ),
);
const local = new URL(preview.url);
const port = Number(local.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid preview port.');
const connections = new Set();
const server = createServer((client) => {
  const upstream = createConnection({ host: '127.0.0.1', port });
  connections.add(client);
  connections.add(upstream);
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.on('close', () => {
    connections.delete(client);
    upstream.destroy();
  });
  upstream.on('close', () => {
    connections.delete(upstream);
    client.destroy();
  });
  client.pipe(upstream).pipe(client);
});
server.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
server.listen(port, address, () => {
  const url = new URL(local);
  url.hostname = address;
  process.stdout.write(`LAN_PREVIEW_READY ${url.href}\n`);
});
const close = () => {
  for (const connection of connections) connection.destroy();
  server.close();
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
