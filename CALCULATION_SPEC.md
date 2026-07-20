# 정산 계산식 & 엑셀 템플릿 매핑 — 변경 금지 기준 문서

> **이 문서는 정산 계산 로직과 엑셀(`lib/template.xlsx`) 셀 매핑의 "정답 기준"입니다.**
> 다른 기능(차트, 요청사항, UI 스타일 등)을 수정하더라도, 아래 계산식과 매핑 규칙은
> **사용자(관리자)의 별도 요청이 없는 한 절대 변경하지 않습니다.**
> 만약 템플릿 구조가 바뀌어 셀 위치가 달라지면, 계산식 자체는 그대로 두고
> `app.js`의 `setCellValue` 셀 참조(ref)만 새 위치에 맞게 수정합니다.

> **코드 보호 마커 (v1.6.99+)**: `app.js`의 `// ⛔ CALCULATION_LOCKED` ~
> `// ⛔ CALCULATION_LOCKED END` 사이의 `SettlementValidator` 및 `SettlementCalculator`
> 블록은 수정 금지. 두 객체 모두 `Object.freeze()`로 런타임 변경도 차단됨.
> `calculate()` 호출 시 `SettlementValidator.validate()`가 자동 실행되어 계산 정합성을 교차 검증하며,
> 불일치 발생 시 콘솔 오류(`🚨`)와 화면 경고 배너(`#calc-validation-error-banner`)를 표시한다.

---

## 1. 정산 규칙 (Rules)

`app.js`의 `DefaultRules` (관리자 대시보드 "정산 구간 및 비율 설정"에서 전체 클럽 공통으로 수정 가능, `AppState.rules`에 저장):

```js
const DefaultRules = {
    limit1: 30000,       // 가. 지원 한도 (3만 원 이하 자부담 0%)
    limit2: 60000,       // 나. 구간 한도 (6만 원 이하)
    rate2: 0.2,          // 나. 자부담 비율 (20%)
    limit3: 120000,      // 다. 구간 한도 (12만 원 이하)
    rate3: 0.4,          // 다. 자부담 비율 (40%)
    deduction4: 85000    // 라. 초과 시 자부담 공제액 (8만 5천 원)
};
```

## 2. 핵심 계산식 — `SettlementCalculator.calculate(memberCount, expenseItems, previousPrizeTotal, rules)`

입력:
- `memberCount`: 정회원 참석자 수 (= `attendees.length`)
- `expenseItems`: 비용 항목 배열 (`{ description, amount, category, cardType, ... }`)
- `previousPrizeTotal`: 기존 상품비 누적액
- `rules`: 위 정산 규칙 (관리자 설정값 또는 기본값)

계산 순서:

1. **총 비용 (B)** `totalCost` = 모든 비용 항목 합계
2. **행사비 (C)** `eventCost` = `category === EVENT` 항목 합계
3. **시설 및 장비 이용료 (D)** `facilityCost` = `category === FACILITY` 항목 합계
4. **상품 (E)** `prizeCost` = `category === PRIZE` 항목 합계
5. **인당 행사비 (F)** `perPersonEventCost` = `memberCount > 0 ? eventCost / memberCount : 0`
6. **인당 자부담 비용(정책상 최소, 참고값)** `perPersonSelfPay` = `calculateSelfPayPerPerson(perPersonEventCost, rules)` (4단계 구간, 아래 3번 참조)
7. **총 자부담 금액(정책상 최소, 참고값)** `totalSelfPay` = `Math.round(perPersonSelfPay * memberCount)`
8. **자부담 비율(정책상 최소, 참고값)** `selfPayRatio` = `totalCost > 0 ? totalSelfPay / totalCost : 0`
9. **최종 지원금(정책상 최소, 참고값)** `finalSupportAmount` = `totalCost - totalSelfPay`
10. **항목별 실제 자부담(v1.6.215+, 실제 계산 기준)** `itemSelfPay` = 모든 비용 항목의 `personalAmount` 합계
    (카테고리 무관, `null`/`undefined`는 0으로 처리)
11. **항목별 실제 지원금(v1.6.215+, 실제 계산 기준)** `itemSupportAmount` = `totalCost - itemSelfPay`

> **6~9번(구간표 기반)과 10~11번(항목 합계 기반)은 서로 다른 목적의 별개 값이다.**
> - 6~9번은 "정책상 최소 자부담" — 화면의 "인당 자부담 비용" 표시, 엑셀 `K20/K21/K22`에 계속 그대로 쓰인다.
>   4단계 구간 공식 자체는 **v1.6.215에서도 변경되지 않았다.**
> - 10~11번은 "실제 자부담/지원금" — 각 비용 항목에서 관리자가 법인카드/개인카드로 나눠 입력한 금액의
>   합계이며, **최종 지원금·클럽 잔여예산 차감·엑셀 `K24/K25/K30`은 이제 이 값을 기준으로 한다**
>   (구간표 값이 아님). 아래 4번 항목 참조.

### 경고 메시지 (warnings)
- `prizeCost + previousPrizeTotal > 500,000` → 초과 금액 경고
- (참고: "정회원 10명 이상 상품비 사용" 조건은 `calculate()` 내부가 아니라 UI 단(비용 항목 추가 폼)에서
  별도로 차단한다 — v1.6.187에서 `calculate()`의 중복 경고 문구를 제거함)
- (v1.6.227에서 `facilityCost > 1,000,000` 경고를 제거함 — 근거 문서·요구사항을 찾을 수 없어 사용자
  요청으로 삭제. 시설·장비 비용 자체 계산/한도(사전승인 `facilityLimit` 등)는 변경 없음)

## 3. 인당 자부담 비용 4단계 구간 — `calculateSelfPayPerPerson(cost, rules)`

```js
calculateSelfPayPerPerson(cost, rules) {
    if (cost <= rules.limit1) {                 // 가. cost ≤ 30,000원
        return 0.0;                             //     → 자부담 0% (전액 지원)
    } else if (cost <= rules.limit2) {          // 나. 30,000 < cost ≤ 60,000원
        return cost * rules.rate2;              //     → cost × 20%
    } else if (cost <= rules.limit3) {          // 다. 60,000 < cost ≤ 120,000원
        const part1 = rules.limit2 * rules.rate2;        // 60,000 × 20% = 12,000원 (나 구간 고정분)
        const part2 = (cost - rules.limit2) * rules.rate3; // (cost-60,000) × 40%
        return part1 + part2;
    } else {                                    // 라. cost > 120,000원
        return cost - rules.deduction4;         //     → cost - 85,000원
    }
}
```

## 4. "실제 자부담" 결정 규칙 (v1.6.215+)

**기본값(자동)은 이제 항목별 개인카드 금액의 합계(`itemSelfPay`)다.** 4단계 구간표 값이 아니다.
그 위에 "총 자부담 금액 직접 수정" 입력란으로 최종 조정할 수 있다 (기존과 동일하게 전체 교체 방식 —
부분 반영이 아니라 사용자가 입력한 값이 그대로 최종값이 됨).

- `AppState.selfPayManuallyOverridden`(boolean): 사용자가 "총 자부담 금액" 입력란을 직접
  blur/Enter로 확정한 적이 있으면 `true`. 항목 추가/삭제, 클럽 전환, 정산 확정, 이력 수정모드 진입/취소
  등 "자동값으로 되돌아가야 하는" 시점마다 `false`로 리셋된다.
  - **주의**: `AppState.lastCalculatedSelfPay > 0` 같은 truthy 체크를 기준으로 쓰면 안 된다.
    `itemSelfPay`가 정당하게 0원(전액 법인카드 처리)인 경우와 "아직 수정 안 함"을 구분할 수 없어서
    0원이어야 할 자부담이 구간표 참고값으로 잘못 새는 회귀가 생긴다 — 반드시 명시적 플래그로 구분한다.
- **최종 자부담 금액(`finalSelfPay`)** 결정 규칙:
  ```js
  finalSelfPay = AppState.selfPayManuallyOverridden
      ? AppState.lastCalculatedSelfPay   // 사용자가 직접 수정한 값
      : calcResult.itemSelfPay;          // 수정 안 했으면 항목별 개인카드 합계
  ```
- 화면 표시:
  - 인당 자부담 비용(강조 표시) = `calcResult.perPersonSelfPay` (**변경 없음** — 계속 구간표 기반
    "정책상 최소" 참고값)
  - 자부담 비율 = `finalSelfPay / totalCost`
  - 최종 지원금 = `totalCost - finalSelfPay`
  - "총 자부담 금액" 입력란에 뜨는 초과/부족 안내 팝업(diff popup)은 **변경 없음** — 계속 구간표 기반
    `calcResult.totalSelfPay`(정책상 최소)와 비교해서 보여준다.

### 검증 예시 (v1.6.215 도입 시 대조용)

**예시 A — 항목별 배분이 구간표 최소값과 다른 경우**
- `memberCount=6`, EVENT 항목 1건 금액 360,000원 (인당 60,000원)
- 구간표 기준(정책 최소): `perPersonSelfPay=12,000원`(나 구간 20%) → `totalSelfPay=72,000원`,
  `finalSupportAmount(정책최소)=288,000원`
- 관리자가 항목에서 직접 배분: `corporateAmount=300,000 / personalAmount=60,000`
  → `itemSelfPay=60,000원`, `itemSupportAmount=300,000원` ← **이 값이 실제 지원금·예산차감·K24/K30에 쓰임**
  (정책최소 288,000원과는 다른 값이며, 이게 정상 동작)

**예시 B — 시설비 인당 flat 한도 초과분이 실제 자부담에 포함**
- `memberCount=1`, FACILITY 항목 1건 150,000원 (`facilityLimit=85,000`, §5-4 참조)
- 구간표 기준(정책 최소): EVENT 항목이 없으므로 `perPersonSelfPay=0`, `totalSelfPay=0`,
  `finalSupportAmount(정책최소)=150,000원` (시설비는 구간표 공식에 애초에 포함 안 됨 — 변경 없음)
- 인당 flat 한도 = `1 × 85,000 = 85,000원` → 항목 배분(자동 제안값 그대로 사용):
  `corporateAmount=85,000 / personalAmount=65,000`
  → `itemSelfPay=65,000원`, `itemSupportAmount=85,000원` ← 실제 지원금은 85,000원

**예시 C — 전액 법인카드(자부담 0원) 회귀 방지 확인용**
- `memberCount=10`, EVENT 항목 1건 800,000원 (인당 80,000원)
- 구간표 기준(정책 최소): `perPersonSelfPay=20,000원`(다 구간) → `totalSelfPay=200,000원`
- 관리자가 전액 법인카드 처리: `corporateAmount=800,000 / personalAmount=null`
  → `itemSelfPay=0원`, `itemSupportAmount=800,000원`
  → **반드시 0원으로 표시되어야 함** — `> 0` truthy 체크로 구현하면 `lastCalculatedSelfPay`가 0이라
    "수정 안 함"으로 오판해 구간표 값(200,000원)으로 새는 회귀가 생기므로, 위 `selfPayManuallyOverridden`
    플래그로만 판단한다.

---

## 5. 엑셀 템플릿(`lib/template.xlsx`, `xl/worksheets/sheet2.xml`) 셀 매핑

> **배경**: 일부 엑셀 뷰어가 수식의 캐시된 `<v>` 값을 재계산하지 않으므로,
> `generateExcelFile()`에서 아래 셀들을 앱이 직접 계산한 값으로 **덮어쓴다** (수식 제거,
> `setCellValue(sheet2, 'CELL', value, isString)` 사용).
> 템플릿이 교체되어도 **아래 셀 좌표 ↔ 의미 매핑은 그대로 유지**해야 하며,
> 좌표가 바뀌면 이 표를 갱신하고 `setCellValue` 호출의 ref만 수정한다.

| 셀 | 의미 | 값 (app.js 변수) |
|---|---|---|
| `K4` | 참석자 수 (A) | `calcResult.memberCount` |
| `C5..C124`, `D5..D124` | 참석자 사번/이름 (최대 120명) | `attendees[idx].employeeId / .name` |
| `F5..F24`, `G5..G24`, `H5..H24` | 비용 항목 내역/금액/구분 (최대 20건) | `expenseItems[idx].description / .amount / category 한글명` |
| `K6` | 총 비용 (B) | `calcResult.totalCost` |
| `K7` | 행사비 (C) | `calcResult.eventCost` |
| `K8` | 시설 및 장비 이용료 (D) | `calcResult.facilityCost` |
| `K9` | 상품 (E) | `calcResult.prizeCost` |
| `K12` | 인당 행사비 (F) = (C)/(A) | `F = eventCost / memberCount` (memberCount=0이면 빈 문자열) |
| `L12` | 구간 안내 문구 (F 값 기준) | "전액지원" / "20% 자체 부담" / "'나' 구간 자부담 비용 + 60,000원 초과 금액에 대해 40% 자체 부담" / "85,000원 이외 금액 자체 부담(최대 인당 8.5만원 지원)" |
| `K15` | 가 구간 인당 비용 | `F ≤ 30,000 ? F : 0` |
| `K16` | 나 구간 인당 비용 | `30,000 < F ≤ 60,000 ? F : (F > 60,000 ? 60,000 : 0)` |
| `K17` | 다 구간 인당 비용 | `60,000 < F ≤ 120,000 ? F-60,000 : (F > 120,000 ? 60,000 : 0)` |
| `K18` | 라 구간 인당 비용 | `F > 120,000 ? F : 0` |
| `L15` | 가 구간 자부담 (0%) | `0` |
| `L16` | 나 구간 자부담 (20%) | `K16 × 0.2` |
| `L17` | 다 구간 자부담 (40%) | `K17 × 0.4` |
| `L18` | 라 구간 자부담 (-85,000) | `K18 === 0 ? 0 : K18 - 85,000` |
| `K20` | 인당 최소 자부담 비용 | `L15+L16+L17+L18` (= `calcResult.perPersonSelfPay`와 동일 값) |
| `K21` | 총 최소 자부담 비용 | `K20 × memberCount` (= `calcResult.totalSelfPay`와 동일 값) |
| `K22` | 총 최소 자부담 비율 | `K21 / K6` (totalCost=0이면 빈 문자열) |
| `K24` | **실제 자부담 비용** | `finalSelfPay` (수동 수정값 우선, 없으면 `calcResult.itemSelfPay` — v1.6.215+, 예전엔 `totalSelfPay`) |
| `K25` | 실제 자부담 비율 | `finalSelfPay / K6` (totalCost=0이면 빈 문자열) |
| `L25` | 정산 결과 안내 문구 | `finalSelfPay - K21 ≥ 0` → `"정산 문제 없음. 최소 자부담 비용보다 {diff}원 추가 부담함"` / 미만이면 → `"최소 자부담 비용 미달. {-diff}원 추가 자부담 필요."` (비교 기준 `K21`은 변경 없음 — 계속 정책상 최소) |
| `K30` | 총 회사 지원금 | `K6 - K24` = `calcResult.totalCost - finalSelfPay` |

### 5-1. 빈 셀 처리 규칙
- `setCellValue`에서 `isString=true`이고 값이 빈 문자열(`''`)이면, **`inlineStr("")`이 아닌 진짜 빈 셀(자체 닫힘 `<c r="REF" .../>`)**로 만든다.
  - 이유: `inlineStr("")`은 `COUNTA`에서 "비어있지 않은 셀"로 카운트되어 `K4`(참석자 수) 등의 집계가 틀어짐.

### 5-2. 사진 삽입 위치 (sheet3.xml / sheet4.xml)
- **행사 사진** (`AppState.eventPhotos`): `sheet3.xml`의 `B3`부터 5열 간격으로 배치, 장당 240×180px.
  과거 정산 엑셀은 해당 이력의 `eventPhotos`만 사용하며 사진 필드가 없는 구버전 이력은 빈 사진으로 처리한다.
- 행사 사진은 저장 전에 긴 변 960px·목표 70KB 수준의 JPEG로 변환한다. 확정 이력의 원본은 `globalHistory`에서 불러오며, 정산 연도 다음 해 4월 1일부터 사진·영수증은 삭제될 수 있어 이후 엑셀에는 첨부되지 않는다.
- **영수증 사진**: `sheet4.xml`
  - 법인카드 영수증: `B5`부터 아래로 (행 간격 16행), 크기 220×300px
  - 개인카드 영수증: `D5`부터 아래로 (행 간격 16행), 크기 220×300px
  - `cardType === 'split'` (법인+개인 동시 첨부)인 경우 `corporateReceiptImage`/`personalReceiptImage` 각각 위 위치에 삽입
  - `cardType === 'personal'`이고 `receiptImage`만 있는 경우 → 개인카드 위치(D열)
  - 영수증은 저장 전에 긴 변 1280px·목표 120KB 수준의 JPEG로 변환하며, 행사 사진과 합산한 첨부 총량은 정산 1건당 Base64 기준 6MB 이하로 제한한다.
  - 그 외(`cardType` 기본값=법인) → 법인카드 위치(B열)

---

## 5-3. 신규 항목 법인카드 자동 제안 — 예산 인지 (v1.6.216+)

`_calcCorpForItem(amount, category)`(CALCULATION_LOCKED 아님, 잠금 블록 밖의 헬퍼)는 새/수정 항목의
법인카드 제안액을 계산할 때 두 값을 **분리해서** 구한다:
- `policyDelta` — 구간표 기반 한계기여분("이 항목만 놓고 보면 정책상 적정 법인부담"), 예산과 무관
- `realRemaining` — `클럽 잔여예산 - 이번 세션에서 다른 항목에 이미 실제로 배정된 corporateAmount 합계`
  (관리자가 앞선 항목의 법인카드 금액을 정책 제안치보다 많이/적게 **수동 조정**한 경우도 실제 값 기준으로 반영)
- 최종 제안 = `min(policyDelta, realRemaining, amount)`

이 둘을 하나로 합쳐서(예: 두 캡을 동일한 값에 각각 적용한 뒤 차감) 계산하면 안 된다 — 관리자가 앞 항목의
법인카드 금액을 수동으로 예산 전액까지 올린 경우에도 뒤에 추가하는 항목에 계속 법인카드를 제안하는
회귀가 재발한다 (v1.6.216에서 실사용 중 발견·수정).

## 5-4. 시설·장비(FACILITY) 항목 법인카드 제안 — 인당 flat 한도 (v1.6.232, 최종)

시설·장비는 `calculate()`의 `eventCost`(4구간 공식 대상)에 애초에 포함되지 않는다 — 이 규칙 자체는
변경 없음(엑셀 K8 `facilityCost` 등 실제 정산 계산은 그대로).

**시설·장비는 행사비와 달리 인원수에 비례하는 "정액성 비용"이 아니라는 점에서 인당 4구간 자부담
공식을 적용하지 않는다.** 대신 `_calcCorpForItem`은 이 카테고리에 대해 항상 아래 한 가지 공식만 쓴다:

```js
const perPersonCap = memberCount * (rules.facilityLimit || 85000); // 인당 flat 한도 (기본 85,000원)
corp = Math.min(amount, perPersonCap, realRemaining);              // realRemaining = 클럽 잔여예산 - 이번 세션 기배정 법인카드 합계
personal(자부담) = amount - corp;
```

- 항목 금액이 `perPersonCap`(인당 85,000원 × 참석 인원수)을 넘으면, **초과분은 자동으로 개인카드(자부담)
  로 배정**된다.
- **한도는 정산 1건 전체 기준(v1.6.233)** — 같은 세션의 다른 시설비 항목에 이미 배정된 법인카드를
  합산해 잔여분만 제안한다(항목을 쪼개서 한도를 우회할 수 없음). 또한 법인카드 금액을 **수동으로
  한도 초과 입력해도 항목 추가 시 차단**되며(⓪-2 검증), 확인 시 법인카드가 잔여 한도로 자동 조정된다.
- 이 계산은 **행사비 항목과는 전혀 풀링/합산되지 않는다** — 세션에 다른 행사비가 얼마나
  있든, 이 시설비 항목의 법인카드 제안액은 시설비 자신의 금액·인원수·잔여예산으로만 결정된다.
  (v1.6.228~229에서 한때 행사비와 "인당 지원 한도 풀"에 합산하는 방식을 시도했었으나, 사용자가
  "시설비는 인원수와 무관한 정액 비용"이라는 점을 재확인하면서 v1.6.232에서 이 단순한 flat 한도
  방식으로 최종 정리됨 — CHANGES.md 참조.)
- 시설·장비 카테고리를 선택하면 "시설 및 장비 이용에 대해 임원진의 승인을 받으셨나요?" 안내 팝업
  (`showFacilityApprovalModal`)이 뜨지만, **이 팝업은 확인 버튼 하나뿐이며 계산 분기가 전혀 없다** —
  단순히 임원진 승인 여부를 상기시키는 알림일 뿐, 위 공식은 팝업 응답과 무관하게 항상 동일하게 적용된다.
- 상품(PRIZE) 항목은 이 규칙과 무관 — 기존과 동일하게 marginal-delta 계산에서 카테고리를 그대로
  유지(PRIZE는 애초에 `eventCost`에 안 잡히므로 사실상 100% 법인 제안, 변경 없음).
- 이 값은 어디까지나 "법인카드 입력칸의 기본 제안값"일 뿐이며, 관리자는 항목 추가 폼에서 언제든
  자유롭게 실제 법인카드/개인카드 금액을 수동으로 덮어쓸 수 있다(기존 항목별 수동 조정 구조 그대로).

**검증 예시(v1.6.232)**: 참석자 4명, 시설비 900,000원 → `perPersonCap = 4 × 85,000 = 340,000원` →
법인카드 340,000원, 나머지 560,000원은 자동으로 개인카드(자부담) 배정. 세션에 다른 행사비 항목이
있어도 이 결과는 전혀 달라지지 않는다.

## 6. 변경 시 주의사항

- 위 계산식(2~4번)은 엑셀 템플릿의 정산 시트와 **수학적으로 동치**가 되도록 맞춰져 있음
  (단, K20/K21/K22의 "최소 자부담"은 항상 구간표 자동 계산값이고, K24/K25/K30은 항목별 개인카드
  합계(`itemSelfPay`) 또는 사용자가 직접 수정한 `finalSelfPay`를 반영한 "실제" 값 — 이 둘의 차이를
  절대 혼동하지 말 것. v1.6.215부터 "실제" 값의 자동 기준이 구간표 → 항목 합계로 바뀌었을 뿐,
  "최소 vs 실제"라는 구조 자체는 동일하다).
- **알려진 한계 (v1.6.215)**: 2026-06-10 `corporateAmount`/`personalAmount` 필드 도입 이전에 저장된
  정산 이력을 다시 열어 수정하면, 그 이력의 항목들은 `personalAmount`가 없어 `itemSelfPay` 계산 시
  0으로 처리된다. 아주 오래된 이력을 수정하는 드문 경우에만 해당하며 별도 마이그레이션은 하지 않았다.
- `node --check app.js`로 문법 검증 후, `sw.js`의 `APP_VERSION`을 올리고 커밋/푸시한다
  (APK 자산 동기화는 현재 하지 않음 — CLAUDE.md §1-3 참조).
