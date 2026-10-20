import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export type MockReply =
  { chunks: string[]; hold?: boolean; intervalMs?: number } | { status: number; body: string };

// The extension posts plain JSON. Callers read whatever fields the request had.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PostedBody = any;

export interface MockOpenAI {
  url: string;
  requests: Array<{ body: PostedBody; authorization?: string }>;
  streams: { started: number; active: number; cancelled: number; finished: number };
  reply(next: MockReply): void;
  releaseHeld(): void;
  close(): Promise<void>;
}

export const defaultReply: MockReply = { chunks: ['I went', ' home.'] };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
};

export function startMockOpenAI(): Promise<MockOpenAI> {
  const requests: MockOpenAI['requests'] = [];
  let next: MockReply = defaultReply;
  const streams = { started: 0, active: 0, cancelled: 0, finished: 0 };
  const held = new Set<() => void>();

  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    readBody(req)
      .then((raw) => {
        requests.push({ body: parseBody(raw), authorization: req.headers.authorization });
        const reply = next;
        if (!('chunks' in reply)) {
          writeReply(res, reply);
          return;
        }
        streams.started++;
        streams.active++;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
          held.delete(finish);
          if (!res.destroyed && !res.writableEnded) {
            res.end('data: [DONE]\n\n');
          }
        };
        res.once('close', () => {
          clearTimeout(timer);
          held.delete(finish);
          streams.active--;
          if (res.writableEnded) streams.finished++;
          else streams.cancelled++;
        });
        res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream' });
        let index = 0;
        const send = () => {
          if (res.destroyed) return;
          while (index < reply.chunks.length) {
            const payload = JSON.stringify({
              choices: [{ delta: { content: reply.chunks[index++] } }],
            });
            res.write(`data: ${payload}\n\n`);
            if (reply.intervalMs) {
              timer = setTimeout(send, reply.intervalMs);
              return;
            }
          }
          if (reply.hold) held.add(finish);
          else finish();
        };
        send();
      })
      .catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Mock OpenAI server did not bind to a TCP port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        streams,
        reply(value) {
          next = value;
        },
        releaseHeld() {
          for (const finish of held) finish();
        },
        close() {
          return new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
            server.closeAllConnections();
          });
        },
      });
    });
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseBody(raw: string): PostedBody {
  if (raw === '') return undefined;
  return JSON.parse(raw);
}

function writeReply(res: ServerResponse, reply: { status: number; body: string }): void {
  res.writeHead(reply.status, { 'access-control-allow-origin': '*' });
  res.end(reply.body);
}
