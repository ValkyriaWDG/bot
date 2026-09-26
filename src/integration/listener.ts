import type { Server } from 'node:http';

/** Node may suppress both bind callback and error when close races with listen. */
export function listenUntilAborted(
  server: Server,
  options: { host: string; port: number },
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', aborted);
      server.off('error', failed);
      server.off('listening', listening);
    };
    const aborted = () => {
      cleanup();
      resolve(false);
    };
    const failed = (error: Error) => {
      cleanup();
      reject(error);
    };
    const listening = () => {
      cleanup();
      resolve(true);
    };
    if (signal.aborted) {
      resolve(false);
      return;
    }
    signal.addEventListener('abort', aborted, { once: true });
    server.once('error', failed);
    server.once('listening', listening);
    try {
      server.listen({ ...options, signal });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
