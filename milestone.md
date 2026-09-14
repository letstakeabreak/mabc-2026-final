# MABC Final — UI 마일스톤

## 개요

대시보드(`web/dashboard.html`)의 카드 상태 모델과 7구역 출력을 SKILL.md 계약 의도에 맞게 단계적으로 손본다.
`api/card.js`는 이미 SKILL.md + references/ 3개 파일(source-evidence-rules, electrical-compatibility-gates, component-card-template)을 로딩하고 있고, usage-examples.md는 제외돼 있다.
로컬 dev 서버(`web/mabc-dev-server.js`, 포트 8091)와 프로덕션(`mabc-final-psi.vercel.app`) 모두 동작 중이다.

- 실제 부품 연결·측정은 하지 않는다. 카드는 재사용 가능한 정리 결과로 남긴다.
- 지금은 시뮬레이션/예시 모드에서 계약 UI가 먼저 보이게 하고, 이후 `/api/card` 연동으로 전환한다.
- 웹 검색 UI는 저작권 문제 확인 전 넣지 않는다. 부품 테이블로 대체 지향.

## 규칙

- SKILL.md 자체는 수정하지 않는다. UI가 SKILL.md 의도를 표현하는 쪽으로만 손본다.
- API는 시뮬레이션 시점에 플랫폼 문구("Hermes Agent + Solar Pro 4")를 삭제하거나 `[시뮬레이션]`으로 교체하고, 연동 후 복원한다.
- 정규식 판정 코드 제거 시 데모 프리셋/예시 시나리오는 유지하되 '예시'임을 명시한다.
- 커밋은 자잘하게, branch 없이 main에, convention(`접두사: 설명`).
- 브라우저 자동화 도구(browser-use / 브라우저 조작 도구)는 이 작업의 검증 수단으로 사용하지 않는다. UI 확인은 로컬 dev 서버와 curl, 그리고 실제 브라우저에서의 수동 확인으로 진행한다.

## 마일스톤

### ui-design-research-and-plan (신규)
의도: 서비스가 향하는 목적에 맞는 UI/UX 디자인 방향을 인터넷과 근거 자료로 정리하고, 장점만 추려 실행 계획으로 남긴다.

작업
- 1단계: 해당 서비스의 목적에 맞는 디자인의 필수 요소를 인터넷에서 충분히 리서치
- 2단계: 리서치 결과를 design_research.md로 정리 (디자인 요소·특징, UI/UX)
- 3단계: design_research.md의 장점만 뽑아서 design_plan.md에 UI/UX 디자인 계획 정리

검증
- design_research.md가 서비스의 목적·사용자·맥락을 반영한 근거를 포함하는지 확인
- design_plan.md가 research의 장점만을 추상화해 실행 가능한 항목으로 정리했는지 확인
- 두 파일이 milestone.md와 같은 루트에 존재하는지 확인

### ui-m1-card-state-model-ui (현재)
의도: 카드 상태 모델(0/5~5/5, PROVISIONAL/BLOCKED/VERIFIED)과 7구역 출력 계약이 화면에서 의도대로 보이게 한다.

작업
- `buildDemoResponse` 정의가 없으면 추가한다. 예시 버튼이 실제로 7구역을 채우게 한다.
- `updateDisplay`의 상태 바(state-badge/state-text/mode-pill)를 응답 단계·상태에 따라 계약 의도로 보이게 보정한다.
  - 첫 사용자 가시 문장은 항상 상태 줄([카드 N/5] ...)
  - PROVISIONAL / BLOCKED / VERIFIED 배지 색상·문구 구분
  - BLOCKED일 때 [현재 차단 항목]이 비어 있지 않으면 눈에 띄게
- `[지금 할 것]` 항목이 2개 초과면 2개 제한임을 UI에서 드러내거나 최소한 표시
- `[관찰 사실]`은 후속 답변에서 지워지지 않고 누적/유지되는 감각을 주도록 한다. (매 응답 덮어쓰기가 아니라 누적 표현 준비)
- 단계 표시는 0/5~5/5 중 확정된 한 단계만 보여주고, 미지 단계 문자나 "다음 단계 후보" 식 미확인 단계를 함부로 노출하지 않는다.
- 이전 증거 무효화/하향 표시를 위한 자리를 [확인된 자료] 쪽에 마련한다. (완전 구현이 아니라 표시 자리 마련 수준)

검증
- 로컬 dev 서버에서 예시 버튼 → 7구역 채워짐 확인
- 예시 응답과 실제 `/api/card` 응답 둘 다 상태 바·7구역이 계약 의도와 맞는지 확인
- 브라우저에서 상태 바 배지와 구역 내용이 어긋나지 않는지 확인

### ui-m2-api-call-center
의도: 시뮬레이션/데모 고정 응답 중심에서 `/api/card` 호출 중심으로 전환한다. 연동 불가 시에만 예시임을 명시하고 폴백한다.

작업
- `submitToApi()`의 실제 `/api/card` POST ↔ `parseCardResponse` ↔ `updateDisplay` 플로우가 예시와 동일한 UI로 떨어지는지 확인
- 시뮬레이션 모드일 때 플랫폼 문구를 삭제하거나 `[시뮬레이션]`으로 교체
- 실제 호출 불가 시 예시 응답 사용 조건과 안내 문구 정리
- 에러 처리(`handleApiError`)가 계약 오류·키 미설정·빈 응답 등을 충분히 구분하는지 확인

검증
- 로컬 dev 서버에서 실제 `/api/card` 호출 → 7구역 렌더링 확인
- 모의 실패 상황에서 에러 안내가 뜨는지 확인

### ui-m3-card-save-load-export
의도: 저장된 카드 간 이동 시 상태·단계·관찰 사실 관계가 자연스럽게 이어지게 한다.

작업
- 저장/불러오기/내보내기(JSON) 흐름 확인
- 카드 불러오기 시 폼 입력과 7구역이 함께 복원되는지 확인
- 저장 시점에 현재 응답(stateLine, stage, state, sections)이 온전히 저장되는지 확인
- 목록 화면에서 단계·상태·보관 시각이 명확히 보이는지 확인

검증
- 저장 → 새로고침/다른 카드 불러오기 → 내용 유지 확인
- JSON 내보내기 파일의 구조 확인

### ui-m4-electrical-compatibility-gate-ui
의도: 3/5 전기 호환성 판정 게이트를 `electrical-compatibility-gates.md`에 맞춰 항목별로 보이게 한다.

작업
- 전원·전류·로직 레벨·극성·GND·핀·버스 게이트를 VERIFIED / 미확인 / planned로 항목별로 표시
- 출처 충돌 시 5열 표(source | claim | target | conflict | unblock)를 카드 본문 안에 표시
- IC 데이터시트로 캐리어 VIN·레귤레이터·레벨 시프터·핀 배치를 확정하지 않는다는 원칙, 판매 페이지 5V 가능 문구로 IC absolute maximum 3.6V 충돌을 자동 해소하지 않는다는 원칙을 UI 문구로 반영
- 3/5 진입 조건(2/5 매핑 완료, 미해결 안전 출처 충돌 0개)과 4/5 진입 조건(3/5 전 게이트 통과, BLOCKED 0개)을 UI에서 단계 전제와 연결해 보이게

검증
- 전기 조건 항목이 없는 카드와 있는 카드에서 표시 차이가 나는지 확인
- 출처 충돌이 있는 예시에서 5열 표가 보이는지 확인

## 참고 파일

- `web/dashboard.html` — 대시보드 UI (현재 메인 작업 대상)
- `public/index.html` — `web/dashboard.html`과 동일 파일 (Vercel 정적 루트용)
- `web/mabc-dev-server.js` — 로컬 검증용 서버, 포트 8091
- `api/card.js` — Vercel 서버리스 함수, SKILL.md + references/ 로딩
- `.hermes/skills/component-integration-card/SKILL.md` — 카드 상태 모델·7구역 계약·단계 정의 (수정 금지)
- `.hermes/skills/component-integration-card/references/component-card-template.md`
- `.hermes/skills/component-integration-card/references/electrical-compatibility-gates.md`
- `.hermes/skills/component-integration-card/references/source-evidence-rules.md`
- `.hermes/skills/component-integration-card/references/usage-examples.md` — 현재는 시스템 프롬프트에서 제외
- `vercel.json` — `includeFiles: ".hermes/skills/component-integration-card/**/*"`
