// M4 전기 조건 렌더러 검증 (함수 직접 eval)
var fs = require('fs');
var html = fs.readFileSync('/Users/miro/Developer/MABC_Final/public/index.html', 'utf-8');

// 함수 선언문 시작 위치부터 닫는 brace까지 추출
function extractFunctionByName(name, src) {
    // 'function name(' 패턴 검색
    var re = new RegExp('function\\s+' + name + '\\s*\\(', 'm');
    var startMatch = src.match(re);
    if (!startMatch) return null;
    var startPos = startMatch.index;
    var bracketCount = 0;
    var pos = startPos;
    while (pos < src.length) {
        var ch = src[pos];
        if (ch === '{') bracketCount++;
        if (ch === '}') {
            bracketCount--;
            if (bracketCount === 0) {
                // 함수 끝 위치 찾음
                var braceStart = src.indexOf('{', startPos);
                return src.substring(startPos, pos + 1);
            }
        }
        pos++;
    }
    return null;
}

var fnNames = ['electricalStatusClass', 'parseElectricalLines', 'electricalHTML', 'sectionHTML', 'escapeHTML', 'buildDemoResponse'];
var fns = {};
fnNames.forEach(function(name) {
    fns[name] = extractFunctionByName(name, html);
});

console.log('추출 결과:');
Object.keys(fns).forEach(function(k) {
    console.log('  ' + k + ': ' + (fns[k] ? 'OK (' + fns[k].length + '자)' : '없음'));
});

var missing = fnNames.filter(function(n) { return !fns[n]; });
if (missing.length > 0) {
    console.log('누락:', missing.join(', '));
    process.exit(1);
}

// 전역 스코프에 먼저 정의할 함수 (다른 함수가 참조)
global.escapeHTML = function(s) {
    return String(s).replace(/[&<>\"']/g, function(c) {
        return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "\'":'&#39;' }[c];
    });
};
global.toast = function() {};

// 각 함수 eval 시도 — eval은 전역 스코프에서 실행되도록 설계
var fnOrder = ['escapeHTML', 'electricalStatusClass', 'parseElectricalLines', 'sectionHTML', 'electricalHTML', 'buildDemoResponse'];
fnOrder.forEach(function(name) {
    if (!fns[name]) return;
    try {
        eval(fns[name]);
        ctx[name] = eval(name);
    } catch (e) {
        console.log('eval 실패 (' + name + '):', e.message);
    }
});

if (typeof ctx.electricalHTML !== 'function') { console.log('FAIL: electricalHTML 없음'); process.exit(1); }
if (typeof ctx.parseElectricalLines !== 'function') { console.log('FAIL: parseElectricalLines 없음'); process.exit(1); }
if (typeof ctx.electricalStatusClass !== 'function') { console.log('FAIL: electricalStatusClass 없음'); process.exit(1); }
if (typeof ctx.sectionHTML !== 'function') { console.log('FAIL: sectionHTML 없음'); process.exit(1); }

var electricalHTML = ctx.electricalHTML;
var parseElectricalLines = ctx.parseElectricalLines;
var electricalStatusClass = ctx.electricalStatusClass;
var sectionHTML = ctx.sectionHTML;

var tests = [];
function pass(name, cond) {
    tests.push({ name: name, pass: !!cond });
    console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
}

// ===== 1. 전기적 조건 구조 객체 렌더링 =====
console.log('\n=== 1. 구조 객체 렌더링 (10개 항목 + 충돌 + 원칙) ===');
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
        { gate: '버스 게이트 (I2C 주소, 풀업, 버스 전압, 다중 장치)', status: 'unconfirmed', evidence: 'I2C address·풀업 저항·버스 전압·다중 장치 사용 여부 미확인' },
    ],
    conflicts: [
        {
            source: '구매 페이지: GY-521 제품 페이지',
            claim: '입력 5V 가능',
            target: 'MPU-6050 IC (absolute maximum 3.6V)',
            conflict: '구매 페이지 5V 가능 주장과 IC absolute maximum 3.6V 충돌 — 자동 해소 금지',
            unblock: '제조사 공식 데이터시트 리비전 명시, 공식 회로도, 실제 측정'
        }
    ]
};

var out = electricalHTML(structuredSec);
pass('gate-list 섹션 있음', out.indexOf('gate-list') !== -1);
pass('항목 10개 (gate-item)', (out.match(/class="gate-item"/g) || []).length === 10);
pass('VERIFIED 배지 있음 (IC 동작 전압)', out.indexOf('badge verified') !== -1);
pass('BLOCKED 배지 있음 (로직 레벨)', out.indexOf('badge blocked') !== -1);
pass('calc 배지 있음 (일반 소비 전류)', out.indexOf('badge calc') !== -1);
pass('unconfirmed 배지 7개', (out.match(/badge unconfirmed/g) || []).length === 7);
pass('conflict-table 섹션 있음', out.indexOf('conflict-table') !== -1);
pass('출처 충돌 행 1개', (out.match(/<tr[^>]*>/g) || []).length === 1);
pass('5열 표 헤더 (출처|주장|대상|충돌|해제 조건)', out.indexOf('<th>출처</th>') !== -1 && out.indexOf('<th>해제 조건</th>') !== -1);
pass('게이트 원칙 섹션 있음', out.indexOf('gate-principle') !== -1);
pass('원칙: IC 데이터시트 확정 금지 문구', out.indexOf('IC 데이터시트로 캐리어의 VIN') !== -1);
pass('원칙: 구매 페이지 5V 자동 해소 금지 문구', out.indexOf('판매 페이지의 5V 가능 문구로 IC absolute maximum 3.6V 충돌을 자동 해소하지 않습니다') !== -1);
pass('원칙: 확인된 값만 기준 문구', out.indexOf('확인된 값만 기준으로 판정하며') !== -1);
pass('차단 항목 증거 문구 (레벨 시프터 필요)', out.indexOf('레벨 시프터 필요 — 구매 페이지 5V 가능 문구로 해소 불가') !== -1);

// ===== 2. parseElectricalLines — 텍스트 → items 파싱 =====
console.log('\n=== 2. parseElectricalLines: 텍스트 → items 파싱 ===');
var text = [
    '- 모듈 입력 전압: VIN 미확인',
    '- IC 동작 전압: 제조사 데이터시트 3.3-5V 확인됨',
    '- 로직 레벨: 5V 출력 → 3.3V GPIO 직결 불가 (차단)',
    '- 일반 소비 전류: 10mA로 계산 (가정)',
    '- 전원/GND 경로: 공통 GND 확인',
    '- 없음',
    ''
].join('\n');

var parsed = parseElectricalLines(text);
pass('파싱 결과 items 5개', parsed && parsed.length === 5);
pass('첫 항목 gate', parsed && parsed[0].gate === '모듈 입력 전압');
pass('첫 항목 evidence', parsed && parsed[0].evidence === 'VIN 미확인');
pass('둘째 항목 status verified (데이터시트 확인됨)', parsed && parsed[1].status === 'verified');
pass('셋째 항목 status blocked (차단)', parsed && parsed[2].status === 'blocked');
pass('넷째 항목 status calc (계산)', parsed && parsed[3].status === 'calc');
pass('다섯째 항목 status verified (공통 GND 확인)', parsed && parsed[4].status === 'verified');
pass('"- 없음" 라인은 스킵', parsed && parsed.filter(function(it) { return it.gate === '없음'; }).length === 0);

// ===== 3: 폴백 경로 — 문자열/"- 없음" → sectionHTML 스타일 =====
console.log('\n=== 3. 폴백 경로 ===');
var plainText = '- 없음';
var fallbackOut = electricalHTML(plainText);
pass('"- 없음" 문자열 → 단순 문단', fallbackOut.trim() === '<p>- 없음</p>');

var arrayInput = ['- 항목1', '- 항목2: 상세'];
var arrayOut = electricalHTML(arrayInput);
pass('배열 입력 → parseElectricalLines 파싱 후 gate-list', arrayOut.indexOf('gate-list') !== -1 && arrayOut.indexOf('항목1') !== -1);

var emptyObj = electricalHTML({});
pass('빈 객체 → "- 없음"', emptyObj.trim() === '<p>- 없음</p>');

// ===== 4: electricalStatusClass 상태 매핑 =====
console.log('\n=== 4. electricalStatusClass 상태 매핑 ===');
pass('verified → verified', electricalStatusClass('verified') === 'verified');
pass('blocked → blocked', electricalStatusClass('blocked') === 'blocked');
pass('calc → calc', electricalStatusClass('calc') === 'calc');
pass('unconfirmed → unconfirmed', electricalStatusClass('unconfirmed') === 'unconfirmed');
pass('unknown → unconfirmed', electricalStatusClass('unknown') === 'unconfirmed');

// ===== 5: sources/observation 등 다른 구역은 sectionHTML 그대로 =====
console.log('\n=== 5. 다른 구역(sectionHTML) 영향 없음 ===');
var obsOut = sectionHTML(['- 관찰1', '- 관찰2']);
pass('관찰 사실 섹션은 기존 sectionHTML 유지', obsOut.indexOf('<p>- 관찰1</p>') !== -1 && obsOut.indexOf('<p>- 관찰2</p>') !== -1);

// ===== 결과 =====
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
