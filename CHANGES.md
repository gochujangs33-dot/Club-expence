# 변경 사항 정리

---

## v1.6.201 — 전체 코드 검증(코드리뷰) 후속 수정

v1.6.197~200 작업분 전체를 다각도 코드리뷰로 검증한 결과 발견된 문제 수정.

### 버그 수정
- **이력 로드 전 Firebase 0원 덮어쓰기 사고 방지** (핵심):
  - `renderClubManagement()`가 globalHistory 로드 완료 **전**(빈 `lastHistoryList`)에 실행되면
    모든 클럽의 `prizeUsed`/`usedBudget`을 0으로 계산해 공유 `clubRegistry`에 **0을 써버리던 문제**
  - `historyLoaded` 플래그 추가 — globalHistory 최초 로드 완료 후에만 Firebase 동기화 쓰기 허용
  - 이것이 "잔여 예산이 가끔 안 보임" 증상의 근본 원인 (v1.6.199는 표시만 교정, 쓰기 사고는 잔존했음)
- **차트 예산 통계 타일 첫 로드 시 0원 표시**: `updateChartsBudgetStats`가 동기 블록에서만 호출되어
  로그인 후 첫 대시보드 진입 시 빈 이력 기준 0원으로 남던 문제 → globalHistory `.then()`에도 호출 추가
- **`_countAttendeesByEmpId` 상단 주석 정정**: 제거된 "이름 폴백" 동작을 여전히 설명하던 구식 주석
  → 실제 동작(사번 없으면 스킵) + 재도입 금지 경고로 교체 (주석만 수정, 로직 무변경)

### 개선
- **차트 3중 렌더 제거**: 차트 탭 클릭 시 renderAllCharts가 3회(동기 step 3 + rAF + `.then()`) 실행되며
  차트가 깜빡이던 문제 → step 3의 중복 호출 제거 (rAF 핸들러 + `.then()` 2경로가 담당)

### 검증 결과 이상 없음 확인 항목
- `CALCULATION_LOCKED` 영역(계산 로직)은 이번 작업분과 무관 — 미접촉 확인
- `.off('value')` 광역 해제로 인한 타 리스너 오삭제 없음 (clubRegistry value 리스너 등록처는 1곳뿐)
- `_buildIdToName`/`_countAttendeesByEmpId` 사번 String 변환 일관성 확인
- `recalculateDirectoryCountsFromGlobal`의 `this.render()`/`this.isLoggedIn` 유효성 확인

---

## v1.6.200 — 클럽 중복 생성 방지 + 클럽 목록 넘버링 추가

### 버그 수정
- **클럽 중복 생성 재발 원인 제거**: `loadClubRegistry()`가 탭 전환 때마다 새 Firebase `.on('value', ...)` 리스너를 누적 등록하던 문제 수정
  - `.on()` 등록 전 `.off('value')` 호출 추가 → 항상 리스너 1개만 유지
  - 복수 리스너가 동시에 `_autoDeduplicateClubs()`를 호출하며 Firebase에 충돌 write를 일으키던 경쟁조건 제거
- **`renderAdminDashboard`에서 `loadClubRegistry()` 재호출 제거**: 탭 전환 시 기존 실시간 리스너(`AppState.clubRegistry` 자동 최신화)를 재사용하도록 변경
  - 기존: `AppState.loadClubRegistry().then(...)` — 탭 전환마다 새 리스너 추가
  - 변경 후: `renderClubManagement()` 등 UI 함수 직접 호출

### 기능 추가
- **클럽 목록 넘버링**: 클럽 관리 탭 목록에 클럽명 왼쪽에 순서 번호(`1.` `2.` ...) 표시

---

## v1.6.199 — 잔여 예산 미반영 경쟁조건 수정

- **현상**: 관리자 대시보드에서 클럽 관리 탭 진입 시 모든 클럽의 잔여 예산이 0으로 표시되는 경우 발생
- **원인**: `clubRegistry` (빠름)가 `globalHistory` (느림)보다 먼저 로드 완료되어 `renderClubManagement()` 호출 시 `lastHistoryList = []` 상태
- **수정**: `globalHistory` `.then()` 블록에서 `lastHistoryList` 설정 직후 `renderClubManagement()` 재호출 추가
  → `globalHistory` 로드 완료 시점에 클럽 관리 UI가 정확한 사용액으로 갱신됨

---

## v1.6.198 — 전사원 명부 카운트 이름 기반 폴백 완전 제거

- **현상**: 동명이인(이진호 4035 / 이진호 4277) 중 사번 없는 구형 정산 기록이 이름 폴백으로 잘못된 인물에 카운트 귀속
- **원인**: `_countAttendeesByEmpId` 내 이름 기반 폴백 로직 — 사번 없으면 이름으로 `directory` 검색 후 카운트
- **수정**: 사번(`employeeId`) 없는 참석자 기록은 카운트에서 **완전 제외**
  - 이름 폴백 코드 전면 삭제, 사번 기준 단일 경로만 유지
  - `idToName` 맵에 없는 사번도 무시 (명부 미등록 사원 오귀속 방지)

---

## v1.6.197 — 전사원 명부 카운트 0회 표시 수정

- **현상**: 정산 이력이 있음에도 전사원 명부의 "올해 누적 N회"가 0으로 표시
- **원인**: `recalculateDirectoryCountsFromGlobal()` 비동기 처리 완료 후 UI 갱신 누락 + `cur.count` 집계값 미동기화
- **수정**:
  - `_countAttendeesByEmpId`: `cur.counts[empId]` 업데이트 후 `cur.count`(집계합) 동기화 추가
  - `recalculateDirectoryCountsFromGlobal`: 처리 완료 후 `this.render()` 호출로 UI 즉시 반영
  - 진단용 콘솔 로그 추가: `[명부 카운트] YYYY년 정산 N건 처리, 명부 M명`

---

## v1.6.145 — 상품 카테고리 선택 안내 팝업 문구 다듬기

- 번역투 문장을 자연스러운 한국어로 수정
- "참석자 10명 이상 시에만 사용 가능합니다." → "참석자가 10명 이상일 때만 상품비를 사용할 수 있습니다."
- "한 해에 총 N원의 상품비 사용이 가능합니다." → "상품비는 한 해에 최대 N원까지 사용 가능합니다."
- (사용 중) "올해 최대 N원까지 상품비 사용 가능합니다." → "올해 남은 상품비 한도는 N원입니다."

---

## v1.6.144 — 상품 카테고리 선택 팝업 문구 2줄로 분리

- 상품 선택 시 안내(info) 팝업을 두 줄로 표시
  - 1줄: 참석자 10명 이상 조건 안내
  - 2줄: 연간 상품비 한도(`prizeLimit`, 기본 500,000원) 안내
- 이미 상품비 사용 중이면 2줄을 "올해 남은 한도" 안내로 전환

---

## v1.6.143 — 시설·장비 한도 관리자 설정 추가

- 관리자 정산 구간·비율 설정 패널에 "시설·장비 이사진 승인 시 법인카드 최대 한도" 입력란 추가
- `DefaultRules.facilityLimit = 85000` 기본값 추가 (관리자 수정 가능)
- 승인 팝업 금액은 `AppState.rules.facilityLimit`를 읽어 동적 표시

---

## v1.6.142 — 시설·장비 사전 승인 팝업 + 법인카드 한도 처리

- "시설 및 장비 이용료" 카테고리 선택 시 강조 경고 모달(⚠️ 주황 테마) 표시
- 안내: "사전 승인이 있어야 85,000원까지 법인카드 사용 가능합니다."
- ✅ 승인 완료 → 시설·장비(FACILITY) 유지, 법인카드 `facilityLimit`(기본 85,000원)까지
- ❌ 승인 없음 → 행사비(EVENT)로 자동 변경, 4구간 자부담 계산 적용
- `_facilityApproved` 플래그로 승인 상태 관리, 기존 시설비 항목 수정 시 자동 복원(재팝업 방지)

---

## v1.6.141 — APP_SPEC.md 전체 재작성

- 앱 전체 매뉴얼(`APP_SPEC.md`)을 `app.js` 실제 코드 기준으로 전면 재작성
- 항목별 계산방법 · 경우의 수 · 팝업/알림 문구 전체 망라 (17개 섹션)

---

## v1.6.120 — 금액 입력 시 법인/개인카드 토글 자동 설정

### 동작 방식
| 구간별 계산 결과 | 법인카드 토글 | 개인카드 토글 |
|---|---|---|
| 전액 법인 지원 (개인부담 0) | ✅ ON | ❌ OFF |
| 일부 자부담 발생 | ✅ ON | ✅ ON |
| 법인카드 0원 | ❌ OFF | ✅ ON |

- 금액 입력 또는 카테고리 변경 시 토글 자동 ON/OFF
- 법인카드 금액 자동 입력 후 수동 수정 가능
- 개인카드 = 총액 - 법인카드 (읽기 전용, 자동)
- 법인카드 토글 수동 ON 시: 토글 변경 없이 법인카드 금액만 재계산

---

## v1.6.119 — 브라우저 자동완성 선택 시 흰 배경 방지

- Microsoft Edge 등 브라우저 autofill 적용 시 입력 필드가 흰색으로 바뀌는 문제 수정
- `input:-webkit-autofill` CSS 오버라이드 적용 → 다크 테마 배경 및 글자색 유지

---

## v1.6.118 — 추가 차수 섹션 제거 + 비용 항목 자동 계산 통합

### 제거
- "추가 차수 임시 정산" HTML 섹션 완전 제거
- 관련 JS 함수 제거: `recalcExtraRounds`, `extraRoundBaseNum`, `relabelExtraRounds`, `addExtraRound`

### 추가 / 변경
- 비용 항목 추가 시 **금액 입력하면 구간별 계산식으로 법인카드 자동 입력** (수정 가능)
- 개인카드 = 총액 - 법인카드 자동 계산 (읽기 전용)
- 카테고리 변경 시에도 법인카드 재계산
- 법인카드 토글 ON → 법인카드 + 개인카드 금액 그룹 항상 표시
- 개인카드 영수증 업로드는 개인카드 토글 ON일 때만 표시

---

## v1.6.117 — 비용 항목 폼 토글 동작 개선

- 법인카드 토글만 ON → 총액 = 법인카드 자동 입력
- 법인카드 + 개인카드 모두 ON → 분배 모드 (법인카드 수동, 개인카드 자동)

---

## v1.6.116 — 차수별 법인카드 수동 입력 + 개인카드 자동 계산

- 각 추가 차수마다 법인카드 금액 직접 수정 가능 (기본값: 구간별 계산)
- 개인카드 = 총액 - 법인카드 자동 계산 (읽기 전용)

---

## v1.6.115 — 차수 번호 자동 매기기

- 비용 항목 N개 → 추가 차수는 (N+1)차부터 자동 라벨링

---

## v1.6.114 — 차수별 법인카드 구간별 계산

- 추가 차수 법인카드 금액을 참여 인원 기준 구간별 계산식으로 자동 계산 연동

---

## v1.6.113 — 추가 차수 임시 정산 (N차 동적 추가)

- "추가 차수 임시 정산" 섹션 추가 및 `+ 차수 추가` 버튼으로 N차까지 동적 추가 지원

---

## v1.6.112 — 2차 임시 정산 섹션 추가

- 1차 정산 외 추가 차수 입력을 위한 "2차 임시 정산" 간이 섹션 신규 구성

---

## v1.6.111 — 총 자부담 수정 팝업 메시지 개선

- 수동 수정 후 확인 팝업창에서 계산 전후의 차액 금액 계산 및 표기 가독성 개선

---

## v1.6.110 — 동명이인 사번 선택 중앙 오버레이 팝업 도입

- 다중 사번 소유 동명이인 사원 추가 시, 중앙 오버레이 팝업 창을 띄워 사번을 편리하게 선택하도록 UX 개편
- 단일 매칭 시 자동입력, 복수 매칭 시 팝업, 부분 매칭 시 인라인 검색결과 노출 지원

---

## v1.6.109 — bulkImportDirectory: JSON 이름 변경 시 구 항목 자동 정리

- `idToName` 역방향 매핑을 생성해 이름이 바뀐 사원(구 이름이 JSON에 없는 경우)의 기존 더미 항목을 로그인 시 검출 및 자동 정리

---

## v1.6.108 — employee_directory.json 내 이진호(PS) 데이터 정정

- 템플릿 명부 파일의 사번 4035의 이름을 "이진호(PS)" -> "이진호"로 수정하여 동명이인 자동 병합에 연동

---

## v1.6.107 — 이미 등록된 사번 복원 방지

- 로그인 시 `employee_directory.json` 복원 과정에서, 해당 사번이 이미 다른 이름으로 커스텀 등록되어 있는 경우 건너뛰도록 처리

---

## v1.6.106 — 전사원 명부 동명이인 별도 행 표시

- ids[]에 사번이 여러 개인 경우 각 사번을 독립된 행으로 렌더링하고, 카운트도 사원 인원수 기준으로 집계
- 삭제(×) 시 해당 사번만 리스트에서 제거

---

## v1.6.105 — 동명이인 이름 변경 시 ids[] 병합 처리

- 명부 등록 시 이미 존재하는 이름인 경우 덮어쓰지 않고 ids[]에 사번을 추가 병합

---

## v1.6.104 — 동명이인 사번 선택 드롭다운 추가

- 동일 이름의 복수 사번을 ids[]에 보관하고, 부분 매칭/정확 매칭/동명이인 상황에 맞춘 커스텀 드롭다운 `#attendee-name-dropdown` 구현

---

## v1.6.103 — Firebase 익명 인증 롤백

- 일부 환경의 인증 오류로 인해 익명인증 SDK 롤백 및 실시간 DB 접근 규칙을 기존과 같이 `true`/`true` 허용으로 복구

---

## v1.6.102 — Firebase 익명 인증 타이밍 재수정

- DB 클라이언트가 토큰을 동기화하기 전 접근 오류를 차단하기 위해 `onAuthStateChanged` 수신 후 Promise resolve 처리

---

## v1.6.101 — Firebase 익명 인증 타이밍 버그 수정

- 인증 완료 전에 데이터를 미리 로드하려던 레이스 컨디션을 해결하고자 `firebaseAuthReady` 대기 구조 적용

---

## v1.6.100 — Firebase 익명 인증 추가 및 DB 규칙 보안 강화

- `firebase-auth-compat.js` SDK 추가, `signInAnonymously()` 인증 및 DB 읽기/쓰기 조건에 `auth != null` 검증 적용

---

## v1.6.99 — 계산식 보호 및 자동 검증 레이어 추가

- `SettlementValidator` 도입으로 calculate 결과(비용 합계, 인당 자부담 등 전 항목)를 독립 수식과 교차 검증 (허용오차 ±1원)
- 계산식 연동 영역 Object.freeze 런타임 변조 차단 및 실패 시 화면 경고 배너 렌더링
- app.js 내 `// ⛔ CALCULATION_LOCKED` 마커 도입

---

## v1.6.98 — 번역 누락 추가 수정

- '배정 합계 / 미배정' 영역 번역 및 '✔️ 저장되었습니다' 팝업 다국어 지원 보완

---

## v1.6.97 — 동적 렌더 영역 번역 적용

- 클럽 관리(배정/잔여 예산, 추가 배정 등), 이력 카드(정산인, 총소요 등)의 동적 영역 전체에 `t()` 동적 바인딩 적용

---

## v1.6.96 — 로그인 상태 배지 번역 덮어쓰기 버그 수정

- 로그인 상태 배지 다국어 전환 시 오프라인 배지로 회귀하는 버그 해결

---

## v1.6.95 — 번역 누락 전면 수정

- UI 텍스트(수정 모드 배너, 법인/개인카드, 영수증, 빈 상태 안내 등)에 `data-i18n` 속성 추가
- alert/confirm 25건을 `t()`로 전면 대체 및 신규 번역 키 50여 개 추가

---

## v1.6.83 — UI 정리 / 실시간 클럽 동기화 기반 구축

### 변경 내용
- "현재 정산 초기화" 버튼 라벨 → "정산 초기화"로 단축.
- 정산 이력 탭의 "모두 삭제" 버튼 제거 (관리자 탭에서 개별 삭제하는 방식으로 통일).
- 언어 전환 UI를 `<button>` 토글 → `<select>` 드롭다운으로 변경.
- `window._onClubRegistryUpdate` 전역 콜백 도입:
  `loadClubRegistry()`의 `.on('value')` 리스너가 갱신될 때마다
  `renderClubOptions()`, `renderClubManagement()`, `renderClubHistorySelect()`를 일괄 호출해
  관리자·유저 화면 클럽 목록이 실시간으로 동기화되도록 기반 마련.

---

## v1.6.84 — 숫자 입력 불가 긴급 수정

### 원인
- v1.6.83에서 `#clear-all-btn` 버튼을 HTML에서 제거했는데,
  `app.js`의 `DOMContentLoaded` 핸들러에서 해당 요소에 `.addEventListener()`를 호출하고 있었음.
- `null.addEventListener()` → `TypeError` 발생 → 이후 모든 이벤트 리스너(PIN 키패드, 금액 입력 등) 등록 실패.

### 수정
- `app.js`에서 `clear-all-btn` 이벤트 리스너 코드 완전 제거.

---

## v1.6.85 — 한국어/영어 전체 번역 지원

### 어떻게?
- `lib/i18n.js` 전면 재작성: `TRANSLATIONS.ko` / `TRANSLATIONS.en` 약 150개 키 정의.
  - 커버 범위: 헤더, 탭, 로그인/회원가입 모달, 정산 탭, 설정 패널, 참석자 탭, 명부 탭,
    이력 탭, 클럽별 이력 탭, 차트, 관리자 화면, 이메일·피드백·팝업·엑셀저장·초기화 모달 전체.
- `index.html` 전체 정적 요소에 `data-i18n` / `data-i18n-ph` / `data-i18n-title` 속성 부여.
- `applyTranslations()` 함수에 특수 처리 추가:
  - 탭 버튼의 동적 카운트 `<span>`을 innerHTML 재구성 방식으로 보존.
  - 카테고리 `<select>` 옵션, 클럽/관리자 선택 첫 번째 옵션 텍스트 갱신.
- 로그인 페이지에 `#login-lang-select` 드롭다운 추가.
- 동적으로 렌더링되는 텍스트(빈 상태 안내, 이력 카드 레이블 등)는 `t(key)` 함수로 출력.

---

## v1.6.86 — 언어 선택: 로그인 페이지 전용 / 전체 UI 즉시 갱신

### 변경 내용
- 헤더에 있던 `#lang-select` 드롭다운 제거
  (로그인 이후 화면에서는 언어 전환 불필요, full-width 표시 버그도 해소).
- 언어 변경 시 전체 UI 즉시 갱신 흐름 확립:
  `setLang()` → `AppState.render()` → `applyTranslations()`
  — `render()` 끝에서 `applyTranslations()`를 항상 호출해 동적 콘텐츠까지 반영.

---

## v1.6.87 — 클럽명 실시간 동기화 수정 + 삭제 팝업

### 문제
- 유저가 `register-new-club-btn`으로 클럽을 직접 등록할 때
  `AppState.clubId`가 저장되지 않아, 이후 관리자가 클럽명을 수정해도 유저 화면에 반영되지 않았음.
- `renderClubOptions()`가 레지스트리에 없는 구 클럽명을 phantom option으로 추가해
  삭제된 클럽이 드롭다운에 계속 표시되는 문제.

### 수정
1. **`register-new-club-btn` 핸들러**: 신규 클럽 생성 시 `AppState.clubId = newClubId` 저장.
   동일 이름 클럽이 이미 레지스트리에 있으면 기존 `clubId`를 재사용.
2. **`loadClubRegistry()` `.on('value')` 콜백**:
   - `clubId`가 있고 레지스트리에 존재 → 이름 변경 감지 시 `AppState.clubName` 즉시 갱신.
   - `clubId`가 있는데 레지스트리에 없음(삭제) → `clubName` / `clubId` 초기화 후 팝업 표시.
3. **`renderClubOptions()`**: phantom option 로직 제거. 레지스트리 기준으로만 렌더링.
   `clubId` 기준으로 현재 선택 클럽명 갱신, 없으면 초기화 + 팝업.
4. **`#club-not-found-modal`** 추가 (`index.html`):
   "기존 클럽이 삭제되었습니다. 클럽을 새로 선택해 주세요." 안내 후 확인 버튼으로 닫기.
5. `window.showClubNotFoundModal` 전역 등록 — `AppState` 내부에서도 호출 가능.

---

## v1.6.88 — 관리자 클럽명 변경 시 기존 정산 이력 소급 갱신

### 문제
- 관리자가 클럽명을 수정해도 과거 정산 이력의 `clubName` 필드는 변경 전 이름 그대로 남아,
  관리자 "클럽별 정산이력" 탭에서 구 이름으로 표시되었음.

### 수정
1. **`newHistoryItem`에 `clubId` 필드 추가** (`finalizeSettlement`):
   신규 정산부터 `clubId`가 이력에 저장되어 이름 변경 추적이 가능해짐.

2. **`AppState.renameClubInHistory(clubId, oldName, newName)` 메서드 추가**:
   - `globalHistory` 전체 스캔 → `clubId` 일치 또는 (기존 이력이라 `clubId` 없는 경우) `clubName` 일치 항목의 `clubName`을 새 이름으로 일괄 갱신.
   - `settlements/모든PIN/settlementHistory` 전체 스캔 → 동일 조건으로 개인 이력도 갱신.
   - Firebase 다중 경로 업데이트(`ref().update(updates)`)로 단일 트랜잭션 처리.

3. **관리자 클럽 폼 submit 핸들러**:
   `addOrUpdateClub()` 호출 전 구 이름을 저장, 이름이 실제로 변경된 경우에만 `renameClubInHistory()` 실행.

4. **`loadClubRegistry()` 콜백에서 메모리 이력 즉시 반영**:
   현재 로그인 중인 유저는 Firebase 갱신을 기다리지 않고 `AppState.settlementHistory` 배열을 즉시 수정해 화면에 바로 새 이름이 표시됨.

---

## v1.6.89 — 클럽 예산 실시간 동기화

### 변경 내용
- `loadClubRegistry()` `.on('value')` 콜백에서 클럽 `budget` 변경을 감지해
  `AppState.annualBudget`을 즉시 갱신.
- 관리자가 예산을 수정하는 순간 유저 화면에도 실시간 반영됨.

---

## v1.6.90 — 관리자 규칙 실시간 동기화 + 정산 이력 수정 모드

### 관리자 규칙 실시간 동기화
- `AppState.loadGlobalSettings()` 추가: `globalSettings/rules` 노드를 `.on('value')`로 구독.
  관리자가 자부담 구간·비율을 변경하면 모든 유저 화면에 즉시 반영됨.
- `AppState.saveGlobalRules()` 추가: `updateRules()` / `resetRules()` 호출 시 Firebase에 저장.
- `window._onGlobalSettingsUpdate` 전역 콜백 → `setSettingsFormValues()` 재호출.

### 정산 이력 수정 모드
- 정산 이력 카드에 **"✏️ 수정"** 버튼 추가.
- 버튼 클릭 시 `AppState.loadHistoryEntryForEdit(entry)` 호출:
  비용 항목·참석자·클럽명이 정산 탭으로 복원되고 **수정 모드 배너** 표시.
- 수정 후 **"엑셀로 저장"** 클릭 → `AppState.editingHistoryId`가 있으면
  신규 확정 대신 `updateHistoryEntry()` 실행해 기존 이력 덮어씀.
- 수정된 항목에 **"수정됨"** 오렌지 뱃지 표시 (`isEdited: true` 플래그).
- 관리자 "클럽별 정산이력"에도 수정 버튼·뱃지 동일 적용.

---

## v1.6.91 — 클럽 삭제 팝업 오탐 수정

### 문제
1. 클럽명 **변경** 시 (`clubId` 미설정 상태)에도 "삭제됨" 팝업이 표시되었음.
2. 초기 로그인 직후 레지스트리 첫 로드 시에도 팝업이 뜰 수 있었음.
3. 클럽 선택 변경 시 이전 클럽의 `usedBudget`이 남아 예산 계산 오류 발생.

### 수정
- `renderClubOptions()`에서 팝업 호출 완전 제거.
  삭제 팝업은 `loadClubRegistry()` 콜백에서만 발생(확인된 삭제 시).
- `loadClubRegistry()`에 `initialLoad` 플래그 도입:
  첫 번째 `on('value')` 콜백에서는 팝업 억제.
- 클럽 변경 핸들러에서 `AppState.usedBudget = 0` 리셋 추가.

---

## v1.6.92 — 예산 표시 항상 관리자 레지스트리 기준

### 문제
- `annualBudget` / `usedBudget`이 유저별 localStorage에 캐시되어
  관리자가 설정한 값과 다르게 표시되었음.

### 수정
- `AppState.getClubBudget()` 추가:
  `clubId → clubName → annualBudget 캐시` 3단계 폴백으로 항상 레지스트리 값 반환.
- `AppState.getClubUsedBudget()` 추가:
  `priorUsed(관리자 설정) + 올해 정산 이력 합산`으로 실사용액 계산.
- 모든 예산 표시 위치(`render()`, `setSettingsFormValues()`, `updateRemainingDisplay()`)를
  새 메서드로 교체.
- `setting-annual-budget` 인풋을 `readonly`로 변경.

---

## v1.6.93 — 예산 표시 수정 (type=number 콤마 호환)

### 문제
- `setting-annual-budget` 인풋이 `type="number"`인데
  `formatAmount()` 포맷된 문자열("800,000")을 대입하면 number 입력이 콤마를 거부해 0으로 표시됨.
- 일부 클럽만 예산이 정상 표시되는 현상 원인.

### 수정
- `index.html`: `setting-annual-budget` 인풋을 `type="number"` → `type="text"`로 변경.
- `app.js`: `getClubBudget()` 3단계 폴백 명확화 (clubId → 이름 → annualBudget 캐시).
- `getClubUsedBudget()` 로직 리팩터링(가독성 개선, null 체크 강화).

---

## v1.6.94 — 코드 버그 3종 수정 + 언어 선택 UI 개선

### 크리티컬 버그 수정

**1. `updateHistoryEntry` Firebase 경로 오류 (P0)**
- Firebase는 JS 배열을 `{0: {...}, 1: {...}}` 객체로 저장하므로,
  배열 인덱스(`/settlementHistory/0`)로 접근하면 실제 키와 불일치 → 업데이트 실패.
- **수정**: 개인 `settlementHistory` 저장 시 배열 전체를 `set()`으로 덮어쓰는 방식으로 변경.
  네트워크 실패 시 사용자에게 경고 alert 추가.

**2. `recalculateDirectoryCounts` 중복 카운트 (P0)**
- 수정 이력(`isEdited: true`)과 원본 이력이 동일 `id`라도 각각 카운트되어 참석 횟수가 2배가 될 수 있었음.
- **수정**: `seenIds` Set으로 동일 `id` 이력은 1회만 집계.

**3. `loadHistoryEntryForEdit` 구버전 데이터 호환 (P1)**
- 구버전 이력(clubId 없음)을 수정 모드로 열 때 `clubId`가 빈 채로 진입.
- `entry.memberCount` 누락 시 참석자 수 0으로 표시.
- **수정**: entry 유효성 검사 추가, `memberCount` → `attendees.length` 폴백,
  `clubId` 없으면 이름으로 레지스트리에서 역조회해 복원.

### UI 개선
- 로그인 페이지 언어 선택: `<select>` 드롭다운 → pill 토글 버튼으로 변경.
  선택된 언어는 흰 배경·밝은 색으로 강조, 미선택은 반투명 처리.

---

# 변경 사항 정리 (v1.4.1 → v1.5.2)

## 1. 비용 항목 추가 폼 재설계 (법인카드 / 개인카드)

### 왜?
- 기존에는 결제수단을 `<select>`(법인카드/개인카드/분할)로 선택하는 방식이라 분할결제 시 입력이 직관적이지 않았음.
- "한 항목을 법인카드+개인카드로 나눠 결제"하는 경우가 많아, 각 카드별 금액과 영수증을 따로 입력할 수 있어야 했음.

### 어떻게?
- 카드 종류 선택을 `<select>` → **체크박스 2개**(법인카드/개인카드)로 변경.
  - 둘 다 체크 해제는 불가능(`updateCardTypeUI()`에서 자동으로 법인카드 재체크).
  - 법인카드만 체크 → 법인카드 금액/영수증 입력칸만 표시.
  - 개인카드만 체크 → 개인카드 금액/영수증 입력칸만 표시.
  - 둘 다 체크(분할결제) → 두 입력칸 모두 표시 + **개인카드 금액 = 총금액 - 법인카드 금액** 자동 계산.
- 체크박스를 카드 헤더 우측에 배치하고, 토글 스위치 형태(`.card-toggle`)로 스타일링.
- 라벨을 "법인카드 결제 금액 (원)" → "법인카드"로 단순화하고, 영수증 첨부 버튼을 같은 줄에 배치(파일 input은 숨기고 `<label class="btn-secondary">영수증</label>`로 트리거).
- 엑셀 내보내기는 분할결제여도 **항목당 1줄**로 정리되는 기존 로직 유지(`addExpense()`에서 `cardType: 'split'/'corporate'/'personal'`로 구분해 저장).

### 관련 함수 (app.js)
- `addExpense()`, `startEditExpense()`, `cancelEdit()`, `updateCardTypeUI()`

---

## 2. 전사원 명부 - EMP ID 정규화 (4자리 숫자)

### 왜?
- 기존 `lib/employee_directory.json`에는 `CG000424`, `KO003098`, `01147900` 등 형식이 제각각이었음.
- 실제 엑셀(클럽비용정산 양식.xlsx)의 "Global ID" 시트 기준, **EMP ID는 전부 4자리 숫자**(예: `0424`, `4121`)이어야 함.

### 어떻게?
- 업로드된 엑셀의 "Global ID" 시트(B열=EMP ID, C열=이름)를 파싱해서 이름→EMP ID(4자리, zero-pad) 매핑 생성.
- `lib/employee_directory.json`을 이 매핑 기준으로 재구성 (1315명 → 중복 제거 후 1272명, 이후 1273명).
- 시트에 없는 일부 인원(`이진호(PS)` 등)은 Global ID 시트의 동일인 항목(`이진호(2)`, EMP ID 4035)으로 매칭해 수동 보정.

### ⚠️ 기존 사용자 데이터(로컬/Firebase) 마이그레이션
- 문제: 사용자가 이미 PIN 로그인해서 사용 중이면, 본인 localStorage/Firebase에 **예전 ID(CG00xxxx, 8자리 Global ID 등)가 그대로 저장**되어 있어서 새 `employee_directory.json`을 덮어써도 반영이 안 됨.
- 해결: `bulkImportDirectory()`에 **마이그레이션 로직 추가** — 이름이 일치하는데 기존 ID가 `4자리 숫자` 형식이 아니면, 새 EMP ID로 자동 갱신.
  ```js
  } else if (typeof entry === 'object' && entry.id !== employeeId && !/^\d{4}$/.test(String(entry.id))) {
      entry.id = employeeId;
      updated++;
  }
  ```
- 이 로직은 **앱 로드 시 / PIN 로그인 시 매번 자동 실행**되므로, 사용자가 새로고침하면 자동으로 최신 EMP ID로 갱신됨.

---

## 3. 전사원 등록 폼 - EMP ID/이름 라벨 및 안내

### 왜?
- "사번"이라는 용어보다 "EMP ID"가 실제 엑셀 컬럼명과 일치.
- 신규 등록 시 동명이인 여부를 미리 확인하지 못해 중복/오기입 위험.

### 어떻게?
- "사번" 라벨 → "EMP ID"로 변경, placeholder도 `CG001234` → `1234`로 변경.
- 이름 입력 시, 동일 이름이 명부에 이미 있으면 **"등록된 EMP ID: XXXX"** 힌트를 바로 아래 표시.
- EMP ID까지 입력했을 때:
  - 이름+EMP ID가 **완전히 동일** → 제출 시 에러 팝업("이미 동일한 이름과 EMP ID로 등록되어 있습니다").
  - 이름은 같은데 EMP ID가 **다름** → 실시간으로 빨간 경고 문구 표시: **"동일한 이름이 존재합니다. 이름뒤에 (부서명)을 적어주세요."** (동명이인 구분 유도)

### 관련 함수 (app.js)
- `updateDirNameHint()`, `trySubmitDir()`, `getExistingId()`

---

## 4. 전사원 명부 삭제 권한 제한

### 왜?
- 명부 데이터(1300명 가까운 인원)를 아무나 실수로 삭제하면 복구가 어려움.

### 어떻게?
- 명부 추가(등록)는 **누구나 가능**.
- 명부 삭제(× 버튼, `deleteFromDirectory()`)는 **관리자(PIN 000000) 또는 개발자(PIN 002531/김종필)만 가능**하도록 제한.
  - 권한 없는 사용자에게는 × 버튼 자체가 렌더링되지 않음.
  - 함수 내부에서도 한 번 더 권한 체크 후 `alert()`로 안내.

---

## 5. 버전 관리 (sw.js)

매번 `index.html` / `app.js` / `style.css` 수정 후:
1. (APK 빌드 안 함 — `app/src/main/assets/` 동기화 단계는 더 이상 수행하지 않음, 웹 버전만 운영)
2. `sw.js`의 `APP_VERSION` 1단계씩 증가 → 사용자에게 "업데이트 있음" 알림 자동 표시
3. git commit & push

현재 버전: **1.6.51**

---

## 6. 금액 입력란 1,000단위 콤마(,) 자동 표시 (v1.6.50)

### 어떻게?
- `app.js` 최상단(모듈 스코프, `updatePerPersonSelfPayIcon` 근처)에 헬퍼 3종 추가:
  - `formatAmount(num)`: `Number(num||0).toLocaleString('ko-KR')` — 화면 표시용 콤마 포맷.
  - `parseAmount(val)`: 문자열에서 숫자 외 문자 제거 후 `parseInt` — 입력값 읽기용.
  - `setupCurrencyInput(el)`: `input` 이벤트마다 콤마를 다시 적용(커서 위치 보정 포함).
- 대상 입력란(모두 `type="number"` → `type="text" inputmode="numeric"`로 변경):
  `prev-prize-input`, `expense-amount-input`, `expense-corporate-amount-input`,
  `expense-personal-amount-input`, `setting-used-budget`, `result-total-self-pay-input`,
  `admin-setting-limit1/2/3`, `admin-setting-deduction4`, `club-total-budget-input`, `club-budget-form-input`.
- 초기화(`DOMContentLoaded`) 시점에 위 ID 배열을 순회하며 `setupCurrencyInput()` 일괄 적용.
- 기존에 `parseInt(x.value, 10)`로 읽던 부분은 모두 `parseAmount(x.value)`로 교체.
- 화면에 값을 세팅(`.value = ...`)하던 부분은 모두 `formatAmount(...)`로 교체(빈 문자열 리셋은 그대로 `''` 유지).

### 새 입력란을 추가할 때
- 금액 입력란이면 `type="text" inputmode="numeric"`로 만들고, 위 배열에 ID를 추가하거나 직접 `setupCurrencyInput(el)` 호출.
- 값을 읽을 때는 `parseAmount()`, 화면에 쓸 때는 `formatAmount()`를 사용해야 콤마가 깨지지 않음.

---

## 7. 클럽 "이전 사용 금액" 입력 위치 변경 (v1.6.50)

### 왜?
- 관리자가 클럽별로 "이전 사용 금액"을 입력하던 방식은, 실제로는 각 사용자(클럽 담당자)가 자신의
  누적 사용 금액을 더 잘 알고 있어 입력 주체를 바꾸는 것이 자연스러움.

### 어떻게?
- 관리자 클럽 관리 폼(`#club-form`)에서 `#club-prior-used-form-input` 입력란 삭제.
  대신 안내 문구로 "사용자가 ⚙️ 설정의 '기존에 사용한 누적 금액'에서 직접 입력"하도록 안내.
- `AppState.addOrUpdateClub(clubId, name, budget, priorUsed)`의 `priorUsed`는 그대로 유지하되,
  관리자 폼 제출 시 기존 클럽의 `priorUsed` 값을 그대로 보존(편집해도 변경되지 않음, 신규 클럽은 0).
- 기존 `AppState.usedBudget` ↔ `club.priorUsed` 동기화 로직(`syncBudgetFromClub`, v1.6.42)은 그대로 유지됨
  → ⚠️ 이 부분은 [CALCULATION_SPEC.md](CALCULATION_SPEC.md)와 무관하므로 자유롭게 조정 가능.

---

## 8. 클럽별 "추가 배정" 버튼 (v1.6.50)

### 어떻게?
- `index.html`에 새 모달 `#add-club-budget-modal` 추가 (입력란 `#add-club-budget-input`,
  버튼 `#add-club-budget-confirm-btn` / `#add-club-budget-cancel-btn`).
- `app.js`에 `openAddClubBudgetModal(clubName, onConfirm)` 모듈 함수 추가
  (`showDiffPopup` 함수 바로 위에 위치) — 모달을 열고 확인 시 `onConfirm(amount)` 콜백 호출.
- `renderClubManagement()`의 각 클럽 행에 "추가 배정" 버튼(`.btn-add-club-budget`) 추가.
  클릭 시 입력한 금액을 `club.budget`에 더해 `AppState.addOrUpdateClub()`으로 저장 후 재렌더링.

---

## 9. 헤더 디자인 변경 (v1.6.51)

- 부제목(`<p class="subtitle">엑셀 정산 양식의 핵심 계산...</p>`) 삭제.
- 로고 아이콘(📊) → 빨간색 굵은 글씨 "3M" 텍스트로 변경.
- 제목을 "클럽 비용 정산기" → "클럽 비용 정산"으로 줄여 한 줄에 표시되도록 수정
  (`logo-area`에 `flex-wrap:nowrap`, `<h1>`에 `white-space:nowrap` 적용).
  - `app.js`의 `setAdminMode()`에서 멤버 모드 제목도 동일하게 "클럽 비용 정산"으로 동기화.
- 우측 상단 "📩 요청사항" 버튼 → "📝 요청"으로 텍스트 단축 + 테마 색상(그라데이션 pill, `#feedback-list-open-btn`과 동일한 스타일 톤)으로 재디자인.
