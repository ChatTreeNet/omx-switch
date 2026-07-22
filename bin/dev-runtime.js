#!/usr/bin/env node

const { spawn } = require('child_process');

const defaultPort = process.env.PORT || '3457';

function main() {
  const [, , ...runtimeArgs] = process.argv;
  // Legacy role flags (hub/node/--serve) are accepted but ignored: the app
  // always runs as a single local Next.js dev server.
  const nextArgs = runtimeArgs.filter((arg) => arg !== 'hub' && arg !== 'node' && arg !== '--serve');
  const nextBin = require.resolve('next/dist/bin/next');

  const child = spawn(process.execPath, [nextBin, 'dev', '-p', defaultPort, ...nextArgs], {
    stdio: 'inherit',
    env: { ...process.env },
  });

  child.on('error', (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
