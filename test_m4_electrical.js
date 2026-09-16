// M4 전기 조건 렌더러 검증 (함수 직접 eval)
// regression_test.js와 동일한 추출·eval 패턴 사용
var fs = require('fs');
var html = fs.readFileSync('/Users/miro/Developer/MABC_Final/public/index.html', 'utf-8');
var scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.log('FAIL: 스크립트 없음'); process.exit(1); }
var code = scriptMatch[1];

function extractFunction(src, name) {
  var fnStart = 'function ' + name + '(';
  var startIdx = src.indexOf(fnStart);
  if (startIdx < 0) return null;
  var depth = 0;
  var i = startIdx;
  var opened = false;
  while (i < src.length) {
    var ch = src[i];
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
var fnNames = ['escapeHTML', 'electricalStatusClass', 'parseElectricalLines', 'electricalHTML', 'buildIntegrationSummaryHTML', 'sectionHTML', 'buildHcSr04BlockFixture', 'buildDemoResponse'];
fnNames.forEach(function(name) {
  var fnCode = extractFunction(code, name);
  if (fnCode) {
    try {
      eval(fnCode);
      global[name] = eval(name);
    } catch(e) { console.log('eval fail', name, e.message); }
  } else {
    console.log('추출 실패:', name);
  }
});

console.log('\n추출 결과:');
Object.keys(global).forEach(function(k) {
  if (typeof global[k] === 'function' && fnNames.indexOf(k) >= 0) {
    console.log('  ' + k + ': OK');
  }
});

if (typeof global.electricalHTML !== 'function') { console.log('FAIL: electricalHTML 없음'); process.exit(1); }
if (typeof global.buildDemoResponse !== 'function') { console.log('FAIL: buildDemoResponse 없음'); process.exit(1); }

var electricalHTML = global.electricalHTML;
var buildDemoResponse = global.buildDemoResponse;

var tests = [];
function pass(name, cond) {
  tests.push({name: name, pass: !!cond});
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
}

// === 1. buildDemoResponse(true) 현재 예시 구조 검증: HC-SR04 공통 fixture 기반 10게이트 BLOCKED ===
console.log('\n=== 1. buildDemoResponse(true) 공통 fixture 기반: HC-SR04 10게이트 BLOCKED ===');
var hcFixtureFnCode = extractFunction(code, 'buildHcSr04BlockFixture');
if (hcFixtureFnCode) {
  try { eval(hcFixtureFnCode); } catch(e) { console.log('eval fail buildHcSr04BlockFixture', e.message); }
}
var hcFixture = eval && eval('buildHcSr04BlockFixture');
if (typeof hcFixture === 'function') {
  var demoTrue = hcFixture();
  var elec = demoTrue.electrical;
  pass('공통 fixture로 demo 응답 생성 가능', typeof demoTrue === 'object' && demoTrue !== null);
  pass('타입: object', typeof elec === 'object' && !Array.isArray(elec));
  pass('items 있음', Array.isArray(elec.items));
  pass('items 길이 10', elec.items && elec.items.length === 10);
  pass('conflicts 있음 (빈 배열)', Array.isArray(elec.conflicts) && elec.conflicts.length === 0);
  pass('blocked 있음 (배열, "없음" 아님)', Array.isArray(demoTrue.blocked) && demoTrue.blocked.length > 0 && demoTrue.blocked[0] !== '없음');
  pass('completeness BLOCKED', demoTrue.completeness === 'BLOCKED');

  var gateNames = elec.items.map(function(it) { return it.gate; });
  var expectedGates = [
    'Echo 출력 전압',
    'Echo 로직 레벨',
    'Trig 입력 전압',
    'Trig 로직 레벨',
    '동작 전류',
    '대기 전류',
    '응답 시간',
    '동작 온도',
    '커넥터 핀 배열',
    'VCC-GND 극성'
  ];
  pass('게이트 이름 10개 일치', gateNames.length === 10 && gateNames.every(function(g, i) { return g === expectedGates[i]; }));
  pass('차단 게이트 정확히 1개', elec.items.filter(function(it) { return it.status === 'blocked'; }).length === 1);
  pass('차단 게이트가 Echo 또는 로직 레벨 직결 위험과 관련', elec.items.some(function(it) {
    return it.status === 'blocked' && (it.gate.includes('Echo') || it.gate.includes('로직 레벨') || it.evidence.includes('직결') || it.evidence.includes('5V') || it.evidence.includes('ESP32'));
  }));
  pass('verified 0개', elec.items.filter(function(it) { return it.status === 'verified'; }).length === 0);
  pass('calc 0개', elec.items.filter(function(it) { return it.status === 'calc'; }).length === 0);
  pass('나머지 9개는 unconfirmed', elec.items.filter(function(it) { return it.status === 'unconfirmed'; }).length === 9);
  pass('모든 항목 evidence 존재', elec.items.every(function(it) { return it.evidence && it.evidence.length > 0; }));
  pass('차단 항목에 해제 조건 포함', demoTrue.blocked.length > 0 && demoTrue.blocked[0].includes('해제 조건'));
  pass('차단 항목에 위험/직결 금지 문구 포함', demoTrue.blocked.length > 0 && (demoTrue.blocked[0].includes('직결') || demoTrue.blocked[0].includes('ESP32') || demoTrue.blocked[0].includes('5V')));
} else {
  pass('공통 fixture 없음 — skip 섹션1', false);
}
// === 2. electricalHTML 구조 객체 렌더링 (독립 합성 객체, 실제 HTML 출력 기준) ===
console.log('\n=== 2. electricalHTML — 구조 객체 (합성 10게이트, 실제 HTML 배드지·원칙 문구 기준) ===');
var structuredSec = {
  items: [
    { gate: '모듈 입력 전압 (VIN/캐리어 입력)', status: 'unconfirmed', evidence: '모듈 VIN·캐리어 입력 전압 범위를 출처에서 분리 확인하지 않음' },
    { gate: 'IC 동작 전압 (절대 최대 정격과 구분)', status: 'verified', evidence: '제조사 데이터시트에서 동작 전압 3.3V~5V 확인' },
    { gate: '로직 레벨 (GPIO HIGH/LOW, 3.3V vs 5V)', status: 'blocked', evidence: 'HC-SR04 ECHO 5V 출력이 ESP32 3.3V GPIO 허용 범위 초과 — 레벨 변환 없이 직결 금지' },
    { gate: '일반 소비 전류', status: 'calc', evidence: '공급 사양 기준 12mA로 가정 계산 (미측정)' },
    { gate: '최대·피크 소비 전류', status: 'unconfirmed', evidence: '피크 전류 값 출처 미확인' },
    { gate: '대상 보드 공급 한계 (GPIO/레일 전류)', status: 'unconfirmed', evidence: 'ESP32 GPIO/레일 공급 한계 미확인' },
    { gate: '전원/GND 경로 (공통 그라운드 여부)', status: 'verified', evidence: '공통 GND 연결 확인 (매뉴얼 4.2절)' },
    { gate: '직결/레벨 변환/보호 필요 여부', status: 'blocked', evidence: '레벨 시프터 필요 — 구매 페이지 5V 가능 문구로 해소 불가' },
    { gate: '극성·핀 방향 (VCC/GND 극성, 핀 배치 방향)', status: 'unconfirmed', evidence: 'VCC/GND 극성 및 핀 배치 방향 미확인 — 전원 인가 전 확인 필요' },
    { gate: '버스 게이트 (I2C 주소, 풀업, 버스 전압, 다중 장치)', status: 'unconfirmed', evidence: 'I2C address·풀업 저항·버스 전압·다중 장치 사용 여부 미확인' }
  ],
  conflicts: []
};
var out = electricalHTML(structuredSec, 3);
pass('gate-list 클래스 포함', out.includes('gate-list'));
pass('gate-item 10개', (out.match(/class="gate-item"/g) || []).length === 10);
pass('unconfirmed 배지 7개', (out.match(/badge unconfirmed/g) || []).length === 7);
pass('verified 배지 2개', (out.match(/badge verified/g) || []).length === 2);
pass('blocked 배지 2개', (out.match(/badge blocked/g) || []).length === 2);
pass('calc 배지 1개', (out.match(/badge calc/g) || []).length === 1);
pass('subhead "전기 호환성 게이트 항목"', out.includes('전기 호환성 게이트 항목'));
pass('gate-principle 포함', out.includes('gate-principle'));
pass('원칙 문구: IC 데이터시트 확정 금지', out.includes('원칙: IC 데이터시트 확정 금지'));
pass('원칙 문구: 5V 자동 해소 금지', out.includes('원칙: 5V 자동 해소 금지'));
pass('원칙 문구: 확인된 값만 기준', out.includes('원칙: 확인된 값만 기준'));
pass('conflict-table 없음 (예시에는 충돌 없음)', !out.includes('conflict-table'));

// === 3. 전기 조건에 충돌 있을 때 5열 표 ===
console.log('\n=== 3. 충돌 있을 때 5열 표 ===');
var withConflict = {
  items: structuredSec.items.slice(0, 2),
  conflicts: [{
    source: '구매 페이지: GY-521',
    claim: '입력 5V 가능',
    target: 'MPU-6050 IC (absolute maximum 3.6V)',
    conflict: '구매 페이지 5V 가능 주장과 IC absolute maximum 3.6V 충돌',
    unblock: '제조사 공식 데이터시트 리비전 명시, 공식 회로도, 실제 측정'
  }]
};
var out2 = electricalHTML(withConflict, 3);
pass('conflict-table 포함', out2.includes('conflict-table'));
pass('5열 헤더 (출처|주장|대상|충돌|해제 조건)', out2.includes('<th>출처</th>') && out2.includes('<th>해제 조건</th>'));
pass('충돌 행 1개', (out2.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []).length >= 1);
pass('출처 값 포함', out2.includes('구매 페이지: GY-521'));
pass('해제 조건 값 포함', out2.includes('제조사 공식 데이터시트 리비전 명시'));

// === 4. 상태별 배지 렌더링 ===
console.log('\n=== 4. 상태별 배지 ===');
var mixed = {
  items: [
    { gate: '전원 전압', status: 'verified', evidence: '데이터시트 확인' },
    { gate: '전류', status: 'calc', evidence: '계산값' },
    { gate: '로직 레벨', status: 'blocked', evidence: '5V→3.3V 직결 불가' },
    { gate: '극성', status: 'unconfirmed', evidence: '미확인' },
  ],
  conflicts: []
};
var out3 = electricalHTML(mixed, 3);
pass('verified 배지', out3.includes('badge verified'));
pass('calc 배지', out3.includes('badge calc'));
pass('blocked 배지', out3.includes('badge blocked'));
pass('unconfirmed 배지', out3.includes('badge unconfirmed'));
pass('증거 문구 포함 (데이터시트 확인)', out3.includes('데이터시트 확인'));
pass('차단 증거 문구 포함 (직결 불가)', out3.includes('5V→3.3V 직결 불가'));

// === 5. 문자열/배열 폴백 ===
console.log('\n=== 5. 문자열/배열 폴백 ===');
pass('문자열 "- 없음" → 단순 문단', electricalHTML('- 없음').trim() === '<p>- 없음</p>');
var arrOut = electricalHTML(['- 항목1: 설명', '- 항목2']);
pass('배열 → gate-list 파싱', arrOut.includes('gate-list') && arrOut.includes('항목1'));
pass('배열 파싱: 항목1 evidence 포함', arrOut.includes('설명'));
pass('빈 객체 → 없음 문단', electricalHTML({}).trim() === '<p>- 없음</p>');

// === 6. sectionHTML 회귀 ===
console.log('\n=== 6. sectionHTML 회귀 ===');
var obsOut = global.sectionHTML(['- 관찰1', '- 관찰2']);
pass('sectionHTML 정상 동작', obsOut.includes('<p>- - 관찰1</p>') && obsOut.includes('<p>- - 관찰2</p>'));

// === 집계 ===
var passed = tests.filter(function(t) { return t.pass; }).length;
var total = tests.length;
console.log('\n=================================');
console.log('M4 전기 조건 렌더러: ' + passed + '/' + total + ' 통과');
console.log('=================================');
if (passed < total) {
  console.log('\n실패:');
  tests.forEach(function(t) { if (!t.pass) console.log('  ' + t.name); });
}
process.exit(passed === total ? 0 : 1);
