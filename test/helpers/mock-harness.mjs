// shared mock postgrest harness (spawned child process; the main thread
// blocks in the store's atomics handshake, so the mock must be another
// process). exported for reuse by any test file.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SupabaseStore } from '../../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const INSTANCE_KEY = Buffer.from('11'.repeat(32), 'hex');

class MockServer {
  constructor(port, proc) {
    this.port = port;
    this.proc = proc;
  }
  static async start() {
    const proc = spawn(process.execPath, [path.join(HERE, 'mock-server.mjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('mock postgrest did not start in 5s')), 5000);
      proc.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`mock postgrest exited before starting (code ${code})`));
      });
      proc.stdout.once('data', (d) => {
        try {
          const parsed = JSON.parse(d.toString());
          clearTimeout(timer);
          resolve(parsed.port);
        } catch (e) { reject(e); }
      });
    });
    return new MockServer(port, proc);
  }
  async _test(pathname, method = 'GET', body = null) {
    const res = await fetch(`http://127.0.0.1:${this.port}${pathname}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
  }
  async filterLog() { return (await this._test('/_test/filterlog')).log; }
  async corruptVersion(table, id) { return this._test('/_test/corrupt-version', 'POST', { table, id }); }
  async stop() {
    this.proc.kill('SIGTERM');
    await new Promise((r) => this.proc.on('exit', r));
  }
}

async function withMock(fn) {
  const mock = await MockServer.start();
  const store = new SupabaseStore({ url: `http://127.0.0.1:${mock.port}`, key: 'test-key' });
  try {
    return await fn(mock, store);
  } finally {
    await store.close();
    await mock.stop();
  }
}

// a condensed version of the conformance world, run identically against both
// stores to prove parity.

export { MockServer, withMock };
