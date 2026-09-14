// web/mabc-dev-server.js
// 로컬 검증용: web/ 정적 파일 서빙 + /api/card POST를 api/card.js handler로 전달
// 실제 Upstage 호출은 api/card.js가 수행하고, 응답을 그대로 돌려준다.
// 프로덕션/배포용 서버가 아님.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import handler from '../api/card.js';

const WEB_ROOT = '/Users/miro/Developer/MABC_Final/public';

try { process.loadEnvFile('.env'); } catch (e) { console.warn('mabc-dev-server: .env 로드 실패'); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/api/card') {
    // 요청 바디 파싱
    let bodyRaw = '';
    req.on('data', chunk => { bodyRaw += chunk; });
    await new Promise(resolve => req.on('end', resolve));

    let parsed = null;
    try { parsed = JSON.parse(bodyRaw); } catch (e) { parsed = null; }

    const reqObj = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: parsed,
    };

    let statusCode = 200;
    const responseHeaders = {};
    let responseBody = '';

    const resObj = {
      status(code) {
        statusCode = code;
        return {
          json(obj) {
            responseBody = JSON.stringify(obj);
            responseHeaders['Content-Type'] = 'application/json';
            return this;
          },
          end(str) {
            responseBody = String(str);
            return this;
          },
        };
      },
      setHeader(name, value) { responseHeaders[name] = value; },
    };

    try {
      await handler(reqObj, resObj);
    } catch (err) {
      console.error('mabc-dev-server: handler 예외', err);
      statusCode = 500;
      responseBody = JSON.stringify({ error: 'handler_error' });
      responseHeaders['Content-Type'] = 'application/json';
    }

    res.writeHead(statusCode, responseHeaders);
    res.end(responseBody);
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
  console.log(`mabc-dev-server: web/ 정적 파일 + /api/card POST -> api/card.js handler`);
  console.log(`mabc-dev-server: UPSTAGE_API_KEY 설정됨 = ${Boolean(process.env.UPSTAGE_API_KEY && process.env.UPSTAGE_API_KEY.trim())}`);
});
