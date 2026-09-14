# Milestone Bug Fix Log

최종 수정일: 2026-09-14
대상: 결선 배포본의 핵심 사용자 흐름 수정
규칙: 새 기능 추가 없음, 디자인 변경 없음, 보고된 문제만 수정

## 보고된 버그와 수정 내역

### 1. nextHTML 함수 부재로 모든 카드 렌더링 중단
**현상:** `updateDisplayFromCard`가 `nextHTML(card.next_actions, ...)`을 호출하지만 해당 함수가 존재하지 않아 런타임 에러 발생, 전체 렌더링 중단.
**수정:** `nextHTML` 함수를 추가. `next_actions`가 문자열 배열이거나 개행 포함 문자열일 때 모두 처리. 최대 2개 항목만 표시.
**파일과 변경:** `public/index.html` — `nextHTML` 함수 추가, 중복 `nextItemsCount` 본문 제거.

### 2. API 호출과 렌더링을 같은 try/catch로 묶어 렌더링 실패 시 다른 예시로 폴백
**현상:** `submitToApi`의 단일 try/catch에서 렌더링 예외가 발생하면 HC-SR04 입력 실패인데도 GY-521 고정 예시로 덮어쓰게 됨.
**수정:** API 호출과 렌더링을 분리. API 성공 후 렌더링 실패 시 다른 부품 예시로 폴백하지 않고, 기존 카드 상태를 유지하며 "결과 표시 실패" 안내.
**파일과 변경:** `public/index.html` — `submitToApi` 분리, 렌더링 실패 핸들러 추가.

### 3. blocked 배열에 "없음" 이외 항목이 있으면 completeness를 BLOCKED로 보정하지 않음
**현상:** 프론트에서만 부분 보정하고, api/card.js의 JSON.parse 직후에는 보정하지 않아 모델과 프론트 간 불일치 가능.
**수정:** 프론트와 api/card.js 양쪽에서 blocked 보정 적용. "없음" 외 항목이 하나라도 있으면 completeness를 BLOCKED로.
**파일과 변경:** `public/index.html`, `api/card.js`.

### 4. 전기 조건의 "없음" 배열을 게이트 이름 "음"으로 파싱 + 3/5 통과 요약 과다 표시
**현상:** `electrical`이 `['없음']`이면 `parseElectricalLines`가 "- 없음"을 파싱하여 게이트 이름 "음"으로 처리. 카드 0/5나 실제 게이트가 없는 상태에서도 3/5 통과 요약과 4/5 진입 조건 표시.
**수정:** "없음" 배열은 게이트 없음으로 처리. 단계 3/5 이상이고 실제 게이트가 존재하며 미해결 안전 항목·BLOCKED·충돌이 모두 0일 때만 통과 표시.
**파일과 변경:** `public/index.html` — `parseElectricalLines`, `buildIntegrationSummaryHTML` 조건 수정.

### 5. 실제 Solar 응답 JSON 스키마에서 전기 조건 항목과 출처 충돌 미구조화
**현상:** `api/card.js`의 JSON 스키마가 `electrical`을 문자열 배열로만 받아서, 실제 API 응답에서 5열 충돌표와 구조화된 게이트 항목이 나오지 않음.
**수정:** 스키마를 `electrical.items[]`와 `electrical.conflicts[]` 구조로 변경. 각 항목의 필수 필드 정의.
**파일과 변경:** `api/card.js` — JSON 스키마 수정.

### 6. usage-examples.md의 C1~C5 행동 미반영
**현상:** SKILL.md가 usage-examples.md의 C1~C5 행동을 실제 런타임 프롬프트에 반영하라고 요구하나, 현재 프롬프트에 포함되지 않음.
**수정:** system 프롬프트에 usage-examples.md를 포함하고, 필요에 따라 매칭되는 절만 선택하는 로직 추가.
**파일과 변경:** `api/card.js` — usage-examples.md 읽기 및 프롬프트 포함.

### 7. 회귀 테스트 부재
**현상:** 빈 입력, 정보 부족, 판매 페이지 5V 충돌, HC-SR04 차단, 실제 API 성공, 렌더링 실패, 저장 후 불러오기 시나리오에 대한 테스트 없음.
**수정:** 브라우저 기준 회귀 테스트 케이스 정의 및 실행.
**파일과 변경:** 테스트 실행 기록.

### 8. 상태 문구와 README 미정비
**현상:** "개발 중", "실제 입력 미연동", "[시뮬레이션] 모드" 문구가 현재 구현 상태와 불일치. README에 공개 URL 없음.
**수정:** 모든 테스트 통과 후 문구와 README 업데이트.
**파일과 변경:** `public/index.html`, `README.md`.

## 수정 순서
1. nextHTML 함수 추가
2. submitToApi try/catch 분리
3. blocked 보정 (프론트 + api/card.js)
4. electrical "없음" 파싱 및 3/5 통과 조건 수정
5. electrical JSON 스키마 구조화
6. usage-examples.md 포함
7. 회귀 테스트
8. 상태 문구 및 README
