import fs from 'node:fs';
import path from 'node:path';
import { coreSession } from './core.mjs';

const [root, parentTemp] = process.argv.slice(2);
const temp = fs.mkdtempSync(path.join(parentTemp, 'core-'));
const run = coreSession(root, temp);
process.send({ ready: true });
process.on('message', async (message) => {
  if (message.close) {
    fs.rmSync(temp, { recursive: true, force: true });
    process.disconnect();
    return;
  }
  try {
    const result = await run(message.name);
    process.send({ result });
  } catch (error) {
    process.send({ error: error.stack });
  }
});
process.on('disconnect', () => {
  fs.rmSync(temp, { recursive: true, force: true });
});
