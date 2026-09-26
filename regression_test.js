/**
 * regression_test.js — MABC_Final 핵심 사용자 흐름 회귀 테스트
 * Node.js로 실행: node regression_test.js
 *
 * 변경점:
 * - 단순 문자열 존재 확인 외에 실제 함수 eval + 렌더링 결과 검증 포함
 * - console.error 캡처로 런타임 오류 0건 확인
 */

const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, 'public', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf-8');

// === 유틸 ===
function assert(condition, message) {
  assertCount++;
  if (!condition) {
    console.error('FAIL:', message);
    process.exitCode = 1;
    return false;
  }
  console.log('PASS:', message);
  passCount++;
  return true;
}

let testCount = 0;
let passCount = 0;
let assertCount = 0;
function section(title) {
  testCount++;
  console.log(`\n=== 테스트 ${testCount}: ${title} ===`);
}

// === HTML에서 스크립트 추출 ===
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert(scriptMatch, 'index.html에 스크립트 블록이 있어야 함');
const code = scriptMatch[1];

// === 함수 추출 유틸리티 ===
function extractFunction(code, name) {
  const fnStart = `function ${name}(`;
  const startIdx = code.indexOf(fnStart);
  if (startIdx < 0) return null;
  let depth = 0;
  let i = startIdx;
  let opened = false;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '{') { depth++; opened = true; }
    if (ch === '}') {
      depth--;
      if (opened && depth === 0) return code.substring(startIdx, i + 1);
    }
    i++;
  }
  return null;
}

// === console.error 캡처 (런타임 오류 감지) ===
let capturedErrors = [];
const originalConsoleError = console.error;
console.error = function(...args) {
  capturedErrors.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
  originalConsoleError.apply(console, args);
};

// === 함수 eval로 전역 스코프에 올리기 ===
// 의존성: escapeHTML이 여러 함수에서 참조되므로 먼저 전역에 정의
global.escapeHTML = function(s) {
  return String(s).replace(/[&<>\"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":"&#39;" }[c];
  });
};
global.toast = function() {};

const fnNames = ['escapeHTML', 'electricalStatusClass', 'parseElectricalLines', 'electricalHTML', 'buildIntegrationSummaryHTML', 'sectionHTML', 'buildHcSr04BlockFixture', 'buildDemoResponse', 'nextHTML', 'identifyHTML', 'completenessHTML', 'updateDisplayFromCard'];
const fns = {};
fnNames.forEach(name => {
  const fnCode = extractFunction(code, name);
  if (fnCode) {
    try {
      eval(fnCode);
      global[name] = eval(name);
      fns[name] = global[name];
    } catch (e) {
      console.log('eval fail:', name, e.message);
    }
  } else {
    console.log('추출 실패:', name);
  }
});

// === 테스트 시작 ===

// 1. nextHTML 함수 존재 및 2개 제한
section('1. nextHTML 함수 및 2개 제한');
assert(typeof fns.nextHTML === 'function', 'nextHTML 함수가 정의돼 있어야 함');
const nextResult = fns.nextHTML(['하나', '둘', '셋'], 2);
assert(nextResult.includes('하나') && nextResult.includes('둘') && !nextResult.includes('셋'), 'nextHTML이 최대 2개만 렌더링해야 함');

// 2. submitToApi try/catch 분리 (코드 구조 확인)
section('2. submitToApi: API 호출과 렌더링 분리');
assert(html.includes('var apiError = null'), 'API 오류 별도 변수 사용');
assert(html.includes('catch (renderErr)'), '렌더링 오류 별도 catch 존재');
assert(html.includes('결과 표시 실패'), '렌더링 실패 시 결과 표시 실패 안내');

// 3. blocked 보정 (프론트 + API)
section('3. blocked 보정: 프론트와 API 양쪽');
const apiContent = fs.readFileSync(path.join(__dirname, 'api', 'card.js'), 'utf-8');
assert(apiContent.includes("item.trim() !== '없음'") || apiContent.includes("item.trim() !== ''"), 'api/card.js에서 blocked 의미 검증');
assert(apiContent.includes("card.completeness = 'BLOCKED'"), 'api/card.js에서 completeness BLOCKED 보정');

// 4. electrical "없음" 파싱 + 3/5 통과 조건
section('4. electrical "없음" 파싱 + 3/5 통과 조건');
assert(typeof fns.parseElectricalLines === 'function', 'parseElectricalLines 함수 정의');
// "없음"만 있는 배열은 null 반환
const noneResult = fns.parseElectricalLines(['없음', '- 없음', '']);
assert(noneResult === null, 'parseElectricalLines가 없음만 있는 배열을 null로 처리해야 함');
// buildIntegrationSummaryHTML이 verified > 0일 때만 통과
const summaryCode = extractFunction(code, 'buildIntegrationSummaryHTML');
assert(summaryCode && summaryCode.includes('verified > 0'), '3/5 통과 조건에 verified > 0 필요');

// 5. API JSON 스키마 구조화
section('5. API JSON 스키마: electrical 구조화');
assert(apiContent.includes('electrical: {') && apiContent.includes('items:') && apiContent.includes('conflicts:'), 'electrical 스키마가 items/conflicts 객체 구조');
assert(apiContent.includes("enum: ['verified', 'calc', 'unconfirmed', 'blocked']"), 'electrical.items[].status 열거형');
assert(apiContent.includes("required: ['source', 'claim', 'target', 'conflict', 'unblock']"), '5열 충돌표 필수 필드');

// 6. usage-examples.md 포함
section('6. usage-examples.md 시스템 프롬프트 포함');
assert(apiContent.includes("'usage-examples.md'") || apiContent.includes('usage-examples.md'), 'usage-examples.md 프롬프트 포함');

// 7. 시나리오 카드 검증 (실제 eval 결과)
section('7. 회귀 테스트: 시나리오별 기대 결과');
assert(typeof fns.buildDemoResponse === 'function', 'buildDemoResponse 함수 정의');

// 7-1. 빈 입력
const emptyCard = fns.buildDemoResponse(false);
assert(emptyCard.stage === 0, '빈 입력 시 카드 단계 0/5');
assert(emptyCard.completeness === 'PROVISIONAL', '빈 입력 시 완성도 PROVISIONAL');
assert(Array.isArray(emptyCard.electrical) || (emptyCard.electrical && typeof emptyCard.electrical === 'object'), 'electrical 존재');

// 7-2. 예시로 해보기 데모 응답 불변 조건: 10게이트, BLOCKED 1개, 차단 문구 존재
const filledCard = fns.buildDemoResponse(true);
assert(filledCard && filledCard.completeness === 'BLOCKED', 'buildDemoResponse(true) 완성도 BLOCKED');
assert(Array.isArray(filledCard.next_actions) && filledCard.next_actions.length <= 2, 'next_actions 최대 2개');
assert(filledCard && filledCard.electrical && Array.isArray(filledCard.electrical.items), 'buildDemoResponse(true) electrical.items 배열 존재');
assert(filledCard.electrical.items.length === 10, 'buildDemoResponse(true) 전기 게이트 10개');
assert(filledCard.electrical.items.filter(it => it.status === 'blocked').length === 1, 'buildDemoResponse(true) 차단 게이트 1개');
assert(filledCard.electrical.items.filter(it => it.status === 'verified').length === 0, 'buildDemoResponse(true) verified 0개');
assert(filledCard.electrical.items.filter(it => it.status === 'calc').length === 0, 'buildDemoResponse(true) calc 0개');
assert(filledCard && filledCard.blocked && filledCard.blocked.length > 0 && filledCard.blocked[0] !== '없음', 'buildDemoResponse(true) 차단 항목 존재');
assert(filledCard && filledCard.blocked[0].includes('직결') || filledCard.blocked[0].includes('ESP32'), 'buildDemoResponse(true) 직결/ESP32 위험 문구');
assert(filledCard && filledCard.blocked[0].includes('해제 조건'), 'buildDemoResponse(true) 차단 항목에 해제 조건 포함');

// 7-3. 판매 페이지 5V vs IC 3.6V: mpu6050-conflict 시나리오
assert(html.includes("case 'mpu6050-conflict':"), 'mpu6050-conflict 시나리오 존재');
const conflictCard = (function() {
  const scCode = extractFunction(code, 'buildScenarioCard');
  if (!scCode) return null;
  eval(scCode);
  const sc = eval('buildScenarioCard');
  return sc('mpu6050-conflict');
})();
assert(conflictCard !== null, 'mpu6050-conflict 시나리오 카드 생성 가능');
assert(conflictCard && conflictCard.electrical && conflictCard.electrical.conflicts && conflictCard.electrical.conflicts.length > 0, 'mpu6050-conflict에 5열 충돌표 존재');
assert(conflictCard && conflictCard.electrical.items && conflictCard.electrical.items.some(it => it.status === 'blocked'), 'mpu6050-conflict에 blocked 게이트 존재');

// 7-4. HC-SR04 Echo 5V 직결: 공통 fixture 불변 조건
const hcFixtureCode = extractFunction(code, 'buildHcSr04BlockFixture');
assert(hcFixtureCode, 'buildHcSr04BlockFixture 함수 정의');
eval(hcFixtureCode);
const hcFixture = eval('buildHcSr04BlockFixture');
assert(typeof hcFixture === 'function', 'buildHcSr04BlockFixture 호출 가능');
const hcCard = hcFixture();
assert(hcCard !== null, 'hc-sr04-block fixture 카드 생성 가능');
assert(hcCard && hcCard.completeness === 'BLOCKED', 'hc-sr04-block 완성도 BLOCKED');
assert(hcCard && hcCard.blocked && hcCard.blocked.length > 0 && hcCard.blocked[0] !== '없음', 'hc-sr04-block 차단 내용 존재');
assert(hcCard && hcCard.electrical && hcCard.electrical.items && hcCard.electrical.items.length === 10, 'hc-sr04-block 전기 게이트 10개');
assert(hcCard && hcCard.electrical && hcCard.electrical.items.filter(it => it.status === 'blocked').length === 1, 'hc-sr04-block 차단 게이트 1개');
assert(hcCard && hcCard.electrical && hcCard.electrical.items.filter(it => it.status === 'verified').length === 0, 'hc-sr04-block verified 0개');
assert(hcCard && hcCard.electrical && hcCard.electrical.items.filter(it => it.status === 'calc').length === 0, 'hc-sr04-block calc 0개');
assert(hcCard && (hcCard.blocked[0].includes('직결') || hcCard.blocked[0].includes('ESP32')), 'hc-sr04-block 직결 금지/위험 문구');
assert(hcCard && hcCard.next_actions && hcCard.next_actions.length <= 2, 'hc-sr04-block 다음 행동 최대 2개');
assert(hcCard && hcCard.blocked[0].includes('해제 조건'), 'hc-sr04-block 차단 항목에 해제 조건 포함');

// 8. 렌더링 실패 시 폴백 없음
section('8. 렌더링 실패 시 다른 예시로 폴백하지 않음');
const renderCatch = html.match(/catch\s*\(renderErr\)\s*\{[\s\S]*?\}/);
if (renderCatch) {
  const body = renderCatch[0];
  assert(!body.includes('buildDemoResponse(true)'), '렌더링 실패 시 다른 예시 폴백 금지');
  assert(body.includes('결과 표시 실패') || body.includes('표시하지 못했습니다'), '결과 표시 실패 안내');
}

// 9. 저장/불러오기 일관성
section('9. 저장/불러오기 일관성');
assert(html.includes('loadCard(idx)') && html.includes('partName.value = c.partName'), 'loadCard가 파트 이름 복원');
assert(html.includes('updateDisplayFromCard(c.response, true, \'api\')') || html.includes('updateFromForm(true)'), 'loadCard가 응답 화면 표시');

// 10. 모드 표시 (실제 응답/데모 응답)
section('10. 모드 표시 (실제 응답/데모 응답)');
assert(html.includes("if (source === 'api')") && html.includes("modeLabel = '실제 응답'"), 'API 응답 시 모드 실제 응답');
assert(html.includes("if (source === 'demo')") && html.includes("modeLabel = '데모 응답'"), '데모 응답 시 모드 데모 응답');

// 11. 빈 구역 "없음" 표시
section('11. 빈 구역 "없음" 표시');
assert(html.includes("return '<p>- 없음</p>';") || html.includes("'- 없음'"), '빈 구역 "- 없음" 표시');

// 12. HTML 구조
section('12. HTML 구조 검증');
assert((html.match(/data-section="[^"]+"/g) || []).length >= 7, '7개 구역 section 존재');
const nameInHead = html.match(/<span class="section-head"[^>]*>[\s\S]*?<span class="name">/);
assert(!nameInHead, 'section-head 안에 중복 name span 없음');

// 13. 실제 런타임: 함수 eval 성공 + 콘솔 오류 0건
section('13. 런타임 검증: function eval 성공 & console.error 0건');
assert(typeof fns.electricalHTML === 'function', 'electricalHTML eval 성공');
assert(typeof fns.parseElectricalLines === 'function', 'parseElectricalLines eval 성공');
assert(typeof fns.buildDemoResponse === 'function', 'buildDemoResponse eval 성공');
assert(typeof fns.nextHTML === 'function', 'nextHTML eval 성공');
assert(typeof fns.identifyHTML === 'function', 'identifyHTML eval 성공');
assert(typeof fns.completenessHTML === 'function', 'completenessHTML eval 성공');
assert(capturedErrors.length === 0, `console.error 0건 (현재 ${capturedErrors.length}건)`);

// 14. 2026-09-26 수정분 회귀 방지 (문자열 존재가 아니라 실제 호출 결과로 확인)
section('14. 빈 구역·3/5 판정·실패 경로 정리');

assert(fns.sectionHTML([]).includes('없음'), 'sectionHTML([])이 빈 문자열이 아니라 "- 없음"');

function gates(counts) {
  const items = [];
  Object.keys(counts).forEach(st => {
    for (let i = 0; i < counts[st]; i++) items.push({ gate: st + i, status: st, evidence: 'e' });
  });
  return items;
}
const unresolvedOut = fns.electricalHTML({ items: gates({ verified: 1, unconfirmed: 2 }), conflicts: [] }, 3);
assert(!unresolvedOut.includes('3/5 통과 —'), '미확인이 남으면 3/5 통과로 표시하지 않음 (SKILL.md 카드 3/5 종료 증거)');
assert(unresolvedOut.includes('미확인 2건'), '미통과 원인에 미확인 건수 표시');
const conflictOnly = fns.electricalHTML({ items: gates({ verified: 2 }),
  conflicts: [{ source: 's', claim: 'c', target: 't', conflict: 'x', unblock: 'u' }] }, 3);
assert(conflictOnly.includes('출처 충돌 1건') && !conflictOnly.includes('차단 0건'), '미통과 원인에 실제로 남은 것만 표시');
const allResolved = fns.electricalHTML({ items: gates({ verified: 3, calc: 1 }), conflicts: [] }, 3);
assert(allResolved.includes('3/5 통과 —'), '확인·계산만 남으면 3/5 통과');

// submitToApi: 성공·실패 어느 경로로 끝나도 버튼과 타이머가 정리돼야 한다
async function runSubmit(fetchImpl) {
  const src = extractFunction(code, 'submitToApi');
  const saved = { setTimeout: global.setTimeout, setInterval: global.setInterval, clearInterval: global.clearInterval };
  const state = { cleared: 0, rendered: null };
  global.setTimeout = () => 0;
  global.setInterval = () => 1;
  global.clearInterval = () => { state.cleared++; };
  global.fetch = fetchImpl;
  const field = v => ({ value: v });
  Object.assign(global, {
    partName: field('HC-SR04'), targetBoard: field(''), observations: field('x'), photoLink: field(''), powerInfo: field(''),
    submitBtn: { disabled: false, textContent: '관찰 사실 반영' },
    inputHint: { textContent: '' }, progressEl: { style: { display: '' } }, progressVisible: false,
    updateProgress: () => {}, handleApiError: () => {},
    updateDisplayFromCard: (c, f, source) => { state.rendered = source; },
  });
  try {
    eval('async ' + src);
    await eval('submitToApi')();
  } finally {
    Object.assign(global, saved);
  }
  return { btn: global.submitBtn, ...state };
}
const json = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });
const settled = r => !r.btn.disabled && r.btn.textContent === '관찰 사실 반영' && r.cleared === 1;

(async () => {
  const r502 = await runSubmit(json(502, { error: 'upstage_empty_response' }));
  assert(settled(r502), 'API가 502 JSON 에러를 줘도 버튼·타이머 정리');
  assert(r502.rendered === 'demo', '502 에러 시 데모 응답으로 폴백 (배지로 구분)');
  const rNet = await runSubmit(async () => { throw new Error('offline'); });
  assert(settled(rNet), '네트워크 오류에서도 버튼·타이머 정리');
  const rOk = await runSubmit(json(200, { ok: true, card: fns.buildDemoResponse(true) }));
  assert(settled(rOk) && rOk.rendered === 'api', '성공 경로는 그대로 정리되고 실제 응답으로 표시');

// === 결과 요약 ===
console.log('\n=============================');
console.log(`구역: ${testCount}개`);
console.log(`단언: ${passCount}/${assertCount} 통과`);
console.log(`console.error 캡처: ${capturedErrors.length}건`);
if (capturedErrors.length > 0) {
  console.log('캡처된 오류:');
  capturedErrors.forEach(e => console.log('  -', e));
}
console.log('=============================\n');

if (process.exitCode === 1) {
  console.log('일부 테스트가 실패했습니다. 위 FAIL 메시지를 확인하세요.');
} else {
  console.log('모든 테스트가 통과했습니다.');
}

// 콘솔.error 복원
console.error = originalConsoleError;
})();
