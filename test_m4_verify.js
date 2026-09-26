// M4 전기 조건 렌더러 검증 (standalone)
// regression_test.js와 동일한 추출·eval 패턴 사용
const fs = require('fs');
const html = fs.readFileSync('/Users/miro/Developer/MABC_Final/public/index.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.log('FAIL: 스크립트 없음'); process.exit(1); }
const code = scriptMatch[1];

function extractFunction(src, name) {
  const fnStart = 'function ' + name + '(';
  const startIdx = src.indexOf(fnStart);
  if (startIdx < 0) return null;
  let depth = 0;
  let i = startIdx;
  let opened = false;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') { depth++; opened = true; }
    if (ch === '}') {
      depth--;
      if (opened && depth === 0) return src.substring(startIdx, i + 1);
    }
    i++;
  }
  return null;
}

// 의존성: escapeHTML을 전역에 먼저 정의
global.escapeHTML = function(s) {
  return String(s).replace(/[&<>\"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":"&#39;" }[c];
  });
};
global.toast = function() {};

// 함수 eval로 올리기 (regression_test.js와 동일 패턴)
const fnNames = ['escapeHTML', 'electricalStatusClass', 'parseElectricalLines', 'electricalHTML', 'buildIntegrationSummaryHTML', 'sectionHTML', 'buildHcSr04BlockFixture', 'buildDemoResponse'];
fnNames.forEach(function(name) {
  const fnCode = extractFunction(code, name);
  if (fnCode) {
    try {
      eval(fnCode);
      global[name] = eval(name);
    } catch(e) { console.log('eval fail', name, e.message); }
  } else {
    console.log('추출 실패:', name);
  }
});

if (typeof global.electricalHTML !== 'function') { console.log('FAIL: electricalHTML 없음'); process.exit(1); }
if (typeof global.buildDemoResponse !== 'function') { console.log('FAIL: buildDemoResponse 없음'); process.exit(1); }

const electricalHTML = global.electricalHTML;
const buildDemoResponse = global.buildDemoResponse;

const tests = [];
function pass(name, cond) {
  tests.push({name, pass: !!cond});
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
}

// === 1. buildDemoResponse 전기 조건 구조 (HC-SR04 demo fixture) ===
console.log('\n=== 1. buildDemoResponse 전기 조건 ===');
const demoTrue = buildDemoResponse(true);
const elec = demoTrue.electrical;
pass('타입: object', typeof elec === 'object' && !Array.isArray(elec));
pass('items 있음', Array.isArray(elec.items));
pass('items 길이 10', elec.items && elec.items.length === 10);
pass('conflicts 있음 (빈 배열)', Array.isArray(elec.conflicts));
const blockedItems = elec.items.filter(it => it.status === 'blocked');
const unconfirmedItems = elec.items.filter(it => it.status === 'unconfirmed');
const verifiedItems = elec.items.filter(it => it.status === 'verified');
const calcItems = elec.items.filter(it => it.status === 'calc');
pass('BLOCKED 항목 1개', blockedItems.length === 1);
pass('unconfirmed 항목 9개', unconfirmedItems.length === 9);
pass('verified 항목 0개', verifiedItems.length === 0);
pass('calc 항목 0개', calcItems.length === 0);
pass('차단 항목 Echo/로직 레벨 직결 위험과 관련', blockedItems.length === 1 &&
  (blockedItems[0].gate.includes('Echo') || blockedItems[0].evidence.includes('직결') || blockedItems[0].evidence.includes('5V')));
pass('blocked 배열 비어 있지 않고 "없음"이 아님', demoTrue.blocked && demoTrue.blocked.length > 0 && demoTrue.blocked[0] !== '없음');
pass('카드 완성도 BLOCKED', demoTrue.completeness === 'BLOCKED');
pass('차단 집계와 실제 items 상태 일치', elec.conflicts.length === 0 && blockedItems.length === 1);
const gateNames = elec.items.map(it => it.gate);
const expectedGates = [
  'HC-SR04 VCC 공급 전압',
  'HC-SR04 Echo 출력 전압',
  'ESP32 GPIO 입력 내성',
  '로직 레벨 (GPIO HIGH/LOW)',
  '일반 소비 전류',
  '최대·피크 소비 전류',
  '전원/GND 경로 (공통 그라운드 여부)',
  '직결/레벨 변환/보호 필요 여부',
  '극성·핀 방향 (VCC/GND 극성, 핀 배치 방향)',
  '버스 게이트 (I2C 주소, 풀업, 버스 전압, 다중 장치)'
];
pass('게이트 이름 10개 일치', gateNames.length === 10 && gateNames.every((g, i) => g === expectedGates[i]));
pass('모든 항목 evidence 존재', elec.items.every(it => it.evidence && it.evidence.length > 0));

// === 2. electricalHTML 구조 객체 렌더링 ===
console.log('\n=== 2. electricalHTML — 구조 객체 ===');
const out = electricalHTML(elec, 3);
pass('gate-list 클래스 포함', out.includes('gate-list'));
pass('gate-item 10개', (out.match(/class="gate-item"/g) || []).length === 10);
pass('unconfirmed 배지 수 = 미확인 항목 수', (out.match(/badge unconfirmed/g) || []).length === unconfirmedItems.length);
pass('subhead "전기 호환성 게이트 항목"', out.includes('전기 호환성 게이트 항목'));
pass('gate-principle 포함', out.includes('gate-principle'));
pass('conflict-table 없음 (예시에는 충돌 없음)', !out.includes('conflict-table'));
pass('차단 항목 존재 (예시 단계는 1/5가 아니라 1/10 차단)', out.includes('차단: <strong>1</strong> / 10'));

// === 3. 전기 조건에 충돌 있을 때 5열 표 ===
console.log('\n=== 3. 충돌 있을 때 5열 표 ===');
const withConflict = {
  items: elec.items.slice(0, 2),
  conflicts: [{
    source: '구매 페이지: GY-521',
    claim: '입력 5V 가능',
    target: 'MPU-6050 IC (absolute maximum 3.6V)',
    conflict: '구매 페이지 5V 가능 주장과 IC absolute maximum 3.6V 충돌',
    unblock: '제조사 공식 데이터시트 리비전 명시, 공식 회로도, 실제 측정'
  }]
};
const out2 = electricalHTML(withConflict, 3);
pass('conflict-table 포함', out2.includes('conflict-table'));
pass('5열 헤더 (출처|주장|대상|충돌|해제 조건)', out2.includes('<th>출처</th>') && out2.includes('<th>해제 조건</th>'));
pass('충돌 행 1개', (out2.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []).length >= 1);
pass('출처 값 포함', out2.includes('구매 페이지: GY-521'));
pass('해제 조건 값 포함', out2.includes('제조사 공식 데이터시트 리비전 명시'));

// === 4. 상태별 배지 렌더링 ===
console.log('\n=== 4. 상태별 배지 ===');
const mixed = {
  items: [
    { gate: '전원 전압', status: 'verified', evidence: '데이터시트 확인' },
    { gate: '전류', status: 'calc', evidence: '계산값' },
    { gate: '로직 레벨', status: 'blocked', evidence: '5V→3.3V 직결 불가' },
    { gate: '극성', status: 'unconfirmed', evidence: '미확인' },
  ],
  conflicts: []
};
const out3 = electricalHTML(mixed, 3);
pass('verified 배지', out3.includes('badge verified'));
pass('calc 배지', out3.includes('badge calc'));
pass('blocked 배지', out3.includes('badge blocked'));
pass('unconfirmed 배지', out3.includes('badge unconfirmed'));
pass('증거 문구 포함 (데이터시트 확인)', out3.includes('데이터시트 확인'));
pass('차단 증거 문구 포함 (직결 불가)', out3.includes('5V→3.3V 직결 불가'));

// === 5. 문자열/배열 폴백 ===
console.log('\n=== 5. 문자열/배열 폴백 ===');
pass('문자열 "- 없음" → 단순 문단', electricalHTML('- 없음').trim() === '<p>- 없음</p>');
const arrOut = electricalHTML(['- 항목1: 설명', '- 항목2']);
pass('배열 → gate-list 파싱', arrOut.includes('gate-list') && arrOut.includes('항목1'));
pass('배열 파싱: 항목1 evidence 포함', arrOut.includes('설명'));
pass('빈 객체 → 없음 문단', electricalHTML({}).trim() === '<p>- 없음</p>');

// === 6. sectionHTML 회귀 (다른 구역 영향 없음) ===
console.log('\n=== 6. sectionHTML 회귀 ===');
const obsOut = global.sectionHTML(['- 관찰1', '- 관찰2']);
pass('sectionHTML 정상 동작', obsOut.includes('<p>- - 관찰1</p>') && obsOut.includes('<p>- - 관찰2</p>'));

// === 집계 ===
const passed = tests.filter(t => t.pass).length;
const total = tests.length;
console.log('\n=================================');
console.log('M4 전기 조건 렌더러: ' + passed + '/' + total + ' 통과');
console.log('=================================');
if (passed < total) {
  console.log('\n실패:');
  tests.forEach(t => { if (!t.pass) console.log('  ' + t.name); });
}
process.exit(passed === total ? 0 : 1);
