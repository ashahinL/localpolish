import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export type MockReply = { chunks: string[] } | { status: number; body: string };

// The extension posts plain JSON. Callers read whatever fields the request had.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PostedBody = any;

export interface MockOpenAI {
  url: string;
  requests: Array<{ body: PostedBody }>;
  reply(next: MockReply): void;
  close(): Promise<void>;
}

export const defaultReply: MockReply = { chunks: ['I went', ' home.'] };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
};

export function startMockOpenAI(): Promise<MockOpenAI> {
  const requests: Array<{ body: PostedBody }> = [];
  let next: MockReply = defaultReply;

  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    readBody(req)
      .then((raw) => {
        requests.push({ body: parseBody(raw) });
        writeReply(res, next);
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
        reply(value) {
          next = value;
        },
        close() {
          return new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
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

function writeReply(res: ServerResponse, reply: MockReply): void {
  if ('chunks' in reply) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'access-control-allow-origin': '*',
    });
    for (const chunk of reply.chunks) {
      const payload = JSON.stringify({ choices: [{ delta: { content: chunk } }] });
      res.write(`data: ${payload}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  res.writeHead(reply.status, { 'access-control-allow-origin': '*' });
  res.end(reply.body);
}
