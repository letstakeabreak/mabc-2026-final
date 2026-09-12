// web/mabc-dev-server.js
// 로컬 검증용: web/ 정적 파일 서빙 + /api/card POST 미러
// 실제 Upstage 호출은 하지 않고, 유효한 카드 응답 형태만 돌려서 프론트 흐름만 확인한다.
// 프로덕션/배포용 서버가 아님.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

const WEB_ROOT = path.resolve(path.dirname(pathToFileURL(import.meta.url).pathname), '.');

let apiKeyLoaded = false;
try { loadEnvFile('.env'); } catch (e) { console.warn('mabc-dev-server: .env 로드 실패'); }
try {
  const dotenv = process.env.UPSTAGE_API_KEY || '';
  apiKeyLoaded = dotenv && dotenv.trim().length > 0;
} catch (e) {}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/api/card') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    let body = '';
    req.on('data', chunk => { body += chunk; });

    await new Promise(resolve => req.on('end', resolve));

    let parsed = null;
    try { parsed = JSON.parse(body); } catch (e) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: 'invalid_request_body' }));
    }

    const partName = String(parsed.partName || '').trim();
    const targetBoard = String(parsed.targetBoard || '').trim();
    const observations = String(parsed.observations || '').trim();
    const photoLink = String(parsed.photoLink || '').trim();
    const powerInfo = String(parsed.powerInfo || '').trim();

    if (!partName && !observations) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: 'invalid_request_body' }));
    }

    if (!apiKeyLoaded) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: 'upstage_api_key_not_configured' }));
    }

    // 실제 연동 전 미러 응답: 호출될 스킬 응답의 최소 유효 형태
    const content = [
      '[카드 0/5] 식별 근거 수집 중',
      '',
      '[관찰 사실]',
      '- 부품/모듈 이름: ' + (partName || '(없음)'),
      '- 타겟 보드: ' + (targetBoard || '(없음)'),
      '- 관찰 사실: ' + (observations || '(없음)'),
      '- 사진/구매 링크: ' + (photoLink || '(없음)'),
      '- 사용 전원/전압: ' + (powerInfo || '(없음)'),
      '',
      '[식별 상태]',
      '- PROVISIONAL',
      '',
      '[확인된 자료]',
      '- 없음',
      '',
      '[확인된 전기 조건]',
      '- 없음',
      '',
      '[현재 차단 항목]',
      '- 없음',
      '',
      '[지금 할 것]',
      '- 칩 글자와 핀 이름이 보이는 앞뒤 사진을 준비한다.',
      '- 가능하면 구매 링크나 제품명을 알려준다.',
      '',
      '[카드 완성도]',
      '- PROVISIONAL',
      '',
    ].join('\n');

    const response = {
      ok: true,
      content,
      model: 'solar-pro4 (미러)',
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    };

    res.statusCode = 200;
    res.end(JSON.stringify(response));
    return;
  }

  // 정적 파일 서빙
  let filePath = pathname === '/' ? path.join(WEB_ROOT, 'index.html') : path.join(WEB_ROOT, pathname);
  const ext = path.extname(filePath).toLowerCase();
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  } [ext] || 'text/plain; charset=utf-8';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.statusCode = 404;
        res.end('Not Found');
      } else {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
      return;
    }
    res.setHeader('Content-Type', mime);
    res.end(data);
  });
});

const port = 8091;
server.listen(port, '127.0.0.1', () => {
  console.log(`mabc-dev-server: http://127.0.0.1:${port}`);
  console.log(`mabc-dev-server: web/ 정적 파일 + /api/card POST 미러`);
  console.log(`mabc-dev-server: api key 로드됨 = ${apiKeyLoaded}`);
});
