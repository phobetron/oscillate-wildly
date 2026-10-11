import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

/** Serve the built example and library for browser tests and preview capture. */
export async function startBrowserServer(port = 0) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      if (pathname === '/fixtures') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<!doctype html><html><head><title>Renderer fixtures</title></head><body></body></html>');
        return;
      }
      if (pathname === '/favicon.ico') {
        response.writeHead(204).end();
        return;
      }
      const library = pathname.startsWith('/lib/');
      const root = resolve(library ? 'dist' : 'demo-dist');
      const relative = library ? pathname.slice('/lib/'.length) : pathname === '/' ? 'index.html' : pathname.slice(1);
      const file = resolve(root, relative);
      if (!file.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': mimeTypes[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveReady);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Browser server has no TCP address');

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
      server.closeAllConnections();
    }),
  };
}
