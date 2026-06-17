# 변경 사항 정리

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
