import { createServer } from 'node:http';
export function createHealthServer(ready: () => Promise<boolean>, mode: 'live' | 'offline') {
  return createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.writeHead(405).end(JSON.stringify({ status: 'method_not_allowed' }));
      return;
    }
    if (request.url === '/health/live') {
      response.writeHead(200).end(JSON.stringify({ status: 'alive', mode }));
      return;
    }
    if (request.url !== '/health/ready') {
      response.writeHead(404).end(JSON.stringify({ status: 'not_found' }));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ok: boolean;
    try {
      ok =
        mode === 'live' &&
        (await Promise.race([
          ready(),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), 1500);
          }),
        ]));
    } catch {
      ok = false;
    } finally {
      clearTimeout(timer);
    }
    response
      .writeHead(ok ? 200 : 503)
      .end(JSON.stringify({ status: ok ? 'ready' : 'unavailable', mode }));
  });
}
