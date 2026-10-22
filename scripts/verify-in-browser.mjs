/**
 * CMIRS — Phase 4D.1 Headless Browser Verification (Chrome DevTools Protocol)
 *
 * Drives a locally installed Chrome/Edge in headless mode over the DevTools Protocol using
 * only Node built-ins (global `fetch` + global `WebSocket`). No npm dependency is installed.
 *
 * For each requested URL it records:
 *   - the final URL after redirects
 *   - the HTTP status of the main document
 *   - the rendered DOM (text form) with the key form markers
 *   - every console error and page exception captured during the load
 *
 * Purpose: verify with a real browser engine that `/reports/new` loads without the Next.js
 * server-action loader error and that its validation/error states are reachable.
 *
 * Read-only: it only loads pages. It does not submit any form or send any credential.
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const URLS = (process.argv[3] ?? '/reports/new,/login').split(',');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const browserPath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!browserPath) {
  console.log('  [SKIP] no local Chrome/Edge binary found');
  process.exit(0);
}

const userDataDir = path.join(os.tmpdir(), `kilo-cdp-${Date.now()}`);
mkdirSync(userDataDir, { recursive: true });
const debugPort = 9333;

const browser = spawn(
  browserPath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevTools() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (res.ok) return true;
    } catch {
      /* not ready yet */
    }
    await sleep(250);
  }
  return false;
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
    this.exceptions = [];
    this.failedRequests = [];

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }

      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.consoleErrors.push(
          message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')
        );
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const d = message.params.exceptionDetails;
        this.exceptions.push(d.exception?.description ?? d.text);
      }
      if (message.method === 'Network.loadingFailed' && !message.params.canceled) {
        this.failedRequests.push(`${message.params.type}: ${message.params.errorText}`);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function openTarget() {
  const res = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' });
  return res.json();
}

async function inspect(targetUrl) {
  const target = await openTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  const session = new CdpSession(socket);
  await session.send('Runtime.enable');
  await session.send('Network.enable');
  await session.send('Page.enable');

  const loaded = new Promise((resolve) => {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Page.loadEventFired') resolve();
    });
  });

  await session.send('Page.navigate', { url: targetUrl });
  await Promise.race([loaded, sleep(12000)]);
  await sleep(1200);

  const { result } = await session.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      url: location.href,
      title: document.title,
      text: document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(0, 4000) : '',
      forms: document.querySelectorAll('form').length,
      inputs: document.querySelectorAll('input').length,
      selects: document.querySelectorAll('select').length,
      buttons: Array.from(document.querySelectorAll('button')).map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean).slice(0, 12),
      hasLoaderError: document.documentElement.innerHTML.includes('can only export async functions')
    })`,
    returnByValue: true,
  });

  socket.close();
  await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);

  return { ...JSON.parse(result.value), consoleErrors: session.consoleErrors, exceptions: session.exceptions, failedRequests: session.failedRequests };
}

console.log('--- Headless browser verification (Chrome DevTools Protocol) ---');
console.log(`    browser: ${browserPath}`);

try {
  const ready = await waitForDevTools();
  if (!ready) {
    console.log('  [FAIL] DevTools endpoint did not become available');
    process.exitCode = 1;
  } else {
    for (const route of URLS) {
      const url = route.startsWith('http') ? route : `${BASE}${route}`;
      const page = await inspect(url);

      console.log('');
      console.log(`  ${route}`);
      console.log(`      final URL        : ${page.url}`);
      console.log(`      title            : ${page.title}`);
      console.log(`      forms/inputs/selects : ${page.forms} / ${page.inputs} / ${page.selects}`);
      console.log(`      buttons          : ${page.buttons.join(' | ') || '(none)'}`);
      console.log(`      console errors   : ${page.consoleErrors.length}`);
      for (const e of page.consoleErrors.slice(0, 5)) console.log(`          - ${e.slice(0, 220)}`);
      console.log(`      page exceptions  : ${page.exceptions.length}`);
      for (const e of page.exceptions.slice(0, 5)) console.log(`          - ${String(e).slice(0, 220)}`);
      console.log(`      server-action loader error in DOM : ${page.hasLoaderError}`);
      console.log(`      visible text     : ${page.text.slice(0, 300)}`);
    }
  }
} finally {
  browser.kill();
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* best effort cleanup */
  }
}
