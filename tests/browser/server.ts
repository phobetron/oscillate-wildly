import { startBrowserServer } from './support/server';

const server = await startBrowserServer(Number(process.env.BROWSER_TEST_PORT ?? 4173));
console.log(`Browser fixtures available at ${server.url}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void server.close(); });
}
