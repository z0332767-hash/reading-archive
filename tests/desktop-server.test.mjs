import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('desktop server restricts access and keeps configuration outside app files', { timeout: 15000 }, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const data = await mkdtemp(join(tmpdir(), 'reading-archive-test-'));
  const child = spawn(process.execPath, [join(root, 'server.mjs')], { cwd: data, env: {
    ...process.env, PORT: '0', READING_ARCHIVE_ROOT: root, READING_ARCHIVE_DATA_DIR: data,
    READING_ARCHIVE_DESKTOP_TOKEN: 'test-session', OPENAI_API_KEY: '', WEREAD_API_KEY: ''
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Server exited early')); });
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/localhost:(\d+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    const origin = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(origin)).status, 403);
    const headers = { 'x-reading-archive-token': 'test-session' };
    assert.equal((await fetch(origin, { headers })).status, 200);
    assert.equal((await fetch(origin + '/.env.local', { headers })).status, 404);
    assert.equal((await fetch(origin + '/%ZZ', { headers })).status, 400);
    const saved = await fetch(origin + '/api/openai/config', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'sk-desktop-test-placeholder' }) });
    assert.equal(saved.status, 200);
    assert.match(await readFile(join(data, '.env.local'), 'utf8'), /sk-desktop-test-placeholder/);
  } finally {
    child.kill();
    await exited;
    await rm(data, { recursive: true, force: true });
  }
});
