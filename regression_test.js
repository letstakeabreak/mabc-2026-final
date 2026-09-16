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

const fnNames = ['escapeHTML', 'electricalStatusClass', 'parseElectricalLines', 'electricalHTML', 'sectionHTML', 'buildDemoResponse', 'nextHTML', 'identifyHTML', 'completenessHTML', 'updateDisplayFromCard'];
const fns = {};
fnNames.forEach(name => {
  const fnCode = extractFunction(code, name);
  if (fnCode) {
    try {
      eval(fnCode);
      fns[name] = eval(name);
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

// 7-2. 정보 부족: next_actions 최대 2개
const filledCard = fns.buildDemoResponse(true);
assert(Array.isArray(filledCard.next_actions) && filledCard.next_actions.length <= 2, 'next_actions 최대 2개');

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

// 7-4. HC-SR04 Echo 5V 직결: hc-sr04-block 시나리오
const hcCard = (function() {
  const scCode = extractFunction(code, 'buildScenarioCard');
  if (!scCode) return null;
  eval(scCode);
  const sc = eval('buildScenarioCard');
  return sc('hc-sr04-block');
})();
assert(hcCard !== null, 'hc-sr04-block 시나리오 카드 생성 가능');
assert(hcCard && hcCard.completeness === 'BLOCKED', 'hc-sr04-block 완성도 BLOCKED');
assert(hcCard && hcCard.blocked && hcCard.blocked.length > 0 && hcCard.blocked[0] !== '없음', 'hc-sr04-block 차단 내용 존재');
assert(hcCard && hcCard.electrical && hcCard.electrical.items && hcCard.electrical.items.some(it => it.status === 'blocked'), 'hc-sr04-block 전기 게이트에 blocked 존재');
assert(hcCard && (hcCard.blocked[0].includes('직결') || hcCard.blocked[0].includes('ESP32')), 'hc-sr04-block 직결 금지/위험 문구');

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

// === 결과 요약 ===
console.log('\n=============================');
console.log(`총 테스트: ${testCount}`);
console.log(`성공: ${passCount}/${testCount}`);
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
