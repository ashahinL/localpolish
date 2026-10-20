import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Only core probes use compiled source. Browser probes always load dist.
const modules = [
  'src/background/rewrite',
  'src/background/sse',
  'src/background/providers/cli',
  'src/core/cleanup',
  'src/core/messages',
  'src/core/settings',
  'src/core/prompts',
  'src/core/usage',
  'tests/e2e/extension-runtime',
  'tests/e2e/mock-openai',
];

export function compile(root, destination) {
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'package.json'), '{"type":"commonjs"}');
  fs.symlinkSync(
    path.join(root, 'node_modules'),
    path.join(destination, 'node_modules'),
    'junction',
  );
  for (const name of modules) {
    const source = fs.readFileSync(path.join(root, `${name}.ts`), 'utf8');
    const result = ts.transpileModule(source, {
      fileName: `${name}.ts`,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const file = path.join(destination, `${name}.js`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, result.outputText);
  }
  const require = createRequire(path.join(destination, 'package.json'));
  return (name) => require(path.join(destination, `${name}.js`));
}
