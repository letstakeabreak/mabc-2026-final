import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/card.js';
import fs from 'node:fs';
import vm from 'node:vm';

function useTestKey(t) {
  const previous = process.env.UPSTAGE_API_KEY;
  process.env.UPSTAGE_API_KEY = 'test-only-key';
  t.after(() => {
    if (previous === undefined) delete process.env.UPSTAGE_API_KEY;
    else process.env.UPSTAGE_API_KEY = previous;
  });
}

const validInput = { partName: 'HC-SR04', targetBoard: 'ESP32', observations: '보드 앞면 표기', photoLink: '', powerInfo: '' };
const validCard = {
  stage: 0, stage_title: '식별 근거 수집 중', observed: ['앞면 표기'],
  identification: { ic: '미확인', carrier: '미확인', target: 'ESP32' }, sources: ['없음'],
  electrical: { items: [], conflicts: [] }, blocked: ['없음'], next_actions: ['표기를 확인하세요'], completeness: 'PROVISIONAL',
};
function upstream(card = validCard) {
  return Response.json({ choices: [{ message: { content: JSON.stringify(card) } }], model: 'solar-pro4', usage: { total_tokens: 10 } });
}
function response() {
  return {
    code: 200, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
function request(overrides = {}) {
  return { method: 'POST', headers: { 'content-type': 'application/json', host: 'mabc-final-psi.vercel.app', origin: 'https://mabc-final-psi.vercel.app' }, body: { ...validInput }, ...overrides };
}

test('API security boundaries before any paid request', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return upstream(); });
  const cases = [
    ['GET', request({ method: 'GET' }), 405],
    ['unsupported type', request({ headers: { 'content-type': 'text/plain' } }), 415],
    ['array', request({ body: [] }), 400],
    ['null', request({ body: null }), 400],
    ['unknown field', request({ body: { ...validInput, model: 'other' } }), 400],
    ['object field', request({ body: { ...validInput, partName: {} } }), 400],
    ['null field', request({ body: { ...validInput, partName: null } }), 400],
    ['oversized field', request({ body: { ...validInput, observations: 'x'.repeat(4001) } }), 400],
    ['empty', request({ body: {} }), 400],
    ['NUL', request({ body: { partName: '\0' } }), 400],
    ['script URL', request({ body: { ...validInput, photoLink: 'javascript:alert(1)' } }), 400],
    ['credential URL', request({ body: { ...validInput, photoLink: 'https://user:password@example.com/' } }), 400],
    ['cross origin', request({ headers: { 'content-type': 'application/json', host: 'mabc-final-psi.vercel.app', origin: 'https://evil.example' } }), 403],
    ['null origin', request({ headers: { 'content-type': 'application/json', host: 'mabc-final-psi.vercel.app', origin: 'null' } }), 403],
    ['cross-site metadata', request({ headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } }), 403],
    ['insecure origin', request({ headers: { 'content-type': 'application/json', host: 'mabc-final-psi.vercel.app', origin: 'http://mabc-final-psi.vercel.app' } }), 403],
    ['declared oversized body', request({ headers: { 'content-type': 'application/json', 'content-length': '16385' } }), 413],
    ['actual UTF8 oversized body', request({ body: { partName: '한'.repeat(300), targetBoard: '글'.repeat(300), observations: '한'.repeat(4000), photoLink: 'https://example.com/' + 'x'.repeat(2000), powerInfo: '한'.repeat(500) } }), 413],
  ];
  for (const [label, req, status] of cases) {
    await t.test(label, async () => {
      const res = response();
      await handler(req, res);
      assert.equal(res.code, status);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    });
  }
  assert.equal(calls, 0, 'invalid requests never reach the billable API');
});

test('successful same-origin public workflow and block correction', async t => {
  useTestKey(t);
  let payload;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.upstage.ai/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-only-key');
    assert.ok(options.signal instanceof AbortSignal);
    payload = JSON.parse(options.body);
    return upstream({ ...validCard, blocked: ['전원 극성 미확인'] });
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.card.completeness, 'BLOCKED');
  assert.equal(JSON.parse(res.body.content).completeness, 'BLOCKED');
  assert.match(payload.messages[1].content, /HC-SR04/);
  assert.ok(!JSON.stringify(res.body).includes('test-only-key'));
});

test('local HTTP browser and non-browser callers remain supported', async t => {
  useTestKey(t);
  t.mock.method(globalThis, 'fetch', async () => upstream());
  for (const headers of [
    { 'content-type': 'application/json; charset=utf-8', host: '127.0.0.1:8091', origin: 'http://127.0.0.1:8091' },
    { 'content-type': 'application/json' },
  ]) {
    const res = response();
    await handler(request({ headers }), res);
    assert.equal(res.code, 200);
  }
});

test('provider errors never echo raw response or card text', async t => {
  useTestKey(t);
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  for (const upstreamResponse of [
    new Response('private provider diagnostic: test-only-key', { status: 500 }),
    Response.json({ choices: [{ message: { content: 'private malformed card' } }] }),
    upstream(null), upstream([]), upstream({ ...validCard, electrical: null }),
    Response.json({ choices: [null] }), Response.json(null),
  ]) {
    t.mock.method(globalThis, 'fetch', async () => upstreamResponse);
    const res = response();
    await handler(request(), res);
    assert.equal(res.code, 502);
    assert.ok(!JSON.stringify(res.body).includes('private'));
    assert.ok(!JSON.stringify(res.body).includes('test-only-key'));
  }
  assert.ok(!errors.join('\n').includes('private'));
  assert.ok(!errors.join('\n').includes('test-only-key'));
});

test('upstream response size limit applies to streaming responses without content-length', async t => {
  useTestKey(t);
  t.mock.method(console, 'error', () => {});
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(128 * 1024 + 1)); },
    cancel() { cancelled = true; },
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(body));
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 502);
  assert.equal(cancelled, true);
});

test('stalled provider request aborts with a bounded timeout', async t => {
  useTestKey(t);
  t.mock.method(console, 'error', () => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fetching;
  const started = new Promise(resolve => { fetching = resolve; });
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    fetching();
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const res = response();
  const pending = handler(request(), res);
  await started;
  t.mock.timers.tick(25_000);
  await pending;
  assert.equal(res.code, 504);
  assert.deepEqual(res.body, { error: 'upstage_timeout' });
});


test('model and stored-card text is escaped by the actual frontend renderers', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  function extract(name) {
    const start = script.indexOf('function ' + name + '(');
    assert.ok(start >= 0);
    let depth = 0;
    let opened = false;
    for (let i = start; i < script.length; i++) {
      if (script[i] === '{') { depth++; opened = true; }
      if (script[i] === '}' && --depth === 0 && opened) return script.slice(start, i + 1);
    }
    throw new Error('Missing function ' + name);
  }
  const context = vm.createContext({ STATE_BADGE_CLASS: { PROVISIONAL: 'provisional', BLOCKED: 'blocked', VERIFIED: 'verified' } });
  const names = ['escapeHTML', 'sectionHTML', 'identifyHTML', 'nextHTML', 'completenessHTML', 'parseElectricalLines', 'electricalStatusClass', 'buildIntegrationSummaryHTML', 'electricalHTML'];
  for (const name of names) vm.runInContext(extract(name), context);
  const attack = '\"><img src=x onerror=alert(1)><script>alert(1)</script>';
  const outputs = [
    context.sectionHTML([attack]),
    context.identifyHTML({ ic: attack, carrier: attack, target: attack }),
    context.nextHTML([attack], 2),
    context.completenessHTML({ completeness: attack }),
    context.electricalHTML({ items: [{ gate: attack, status: 'unconfirmed', evidence: attack }], conflicts: [{ source: attack, claim: attack, target: attack, conflict: attack, unblock: attack }] }, 3),
  ];
  for (const output of outputs) {
    assert.ok(!output.includes('<img'));
    assert.ok(!output.includes('<script'));
    assert.ok(output.includes('&lt;img'));
  }
});
