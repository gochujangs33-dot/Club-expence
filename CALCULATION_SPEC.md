# 정산 계산식 & 엑셀 템플릿 매핑 — 변경 금지 기준 문서

> **이 문서는 정산 계산 로직과 엑셀(`lib/template.xlsx`) 셀 매핑의 "정답 기준"입니다.**
> 다른 기능(차트, 요청사항, UI 스타일 등)을 수정하더라도, 아래 계산식과 매핑 규칙은
> **사용자(관리자)의 별도 요청이 없는 한 절대 변경하지 않습니다.**
> 만약 템플릿 구조가 바뀌어 셀 위치가 달라지면, 계산식 자체는 그대로 두고
> `app.js`의 `setCellValue` 셀 참조(ref)만 새 위치에 맞게 수정합니다.

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
6. **인당 자부담 비용** `perPersonSelfPay` = `calculateSelfPayPerPerson(perPersonEventCost, rules)` (4단계 구간, 아래 3번 참조)
7. **총 자부담 금액(자동 계산 최소값)** `totalSelfPay` = `Math.round(perPersonSelfPay * memberCount)`
8. **자부담 비율(자동 계산)** `selfPayRatio` = `totalCost > 0 ? totalSelfPay / totalCost : 0`
9. **최종 지원금** `finalSupportAmount` = `totalCost - totalSelfPay`

### 경고 메시지 (warnings)
- 상품비(`prizeCost`) > 0 인데 `memberCount < 20` → "정회원 20명 이상 참석 시에만 상품비 사용이 가능합니다."
- `prizeCost + previousPrizeTotal > 500,000` → 초과 금액 경고
- `facilityCost > 1,000,000` → 별도 협의 필요 경고

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

## 4. "총 자부담 금액" 수동 수정(override) 로직

- 사용자가 정산 화면의 "총 자부담 금액(수정 가능)" 입력란을 직접 수정할 수 있음
  → `AppState.lastCalculatedSelfPay` 에 사용자가 입력한 값이 저장됨 (`applySelfPayChange()`)
- **최종 자부담 금액(`finalSelfPay`)** 결정 규칙:
  ```js
  finalSelfPay = (AppState.lastCalculatedSelfPay > 0)
      ? AppState.lastCalculatedSelfPay   // 사용자가 직접 수정한 값
      : calcResult.totalSelfPay;         // 수정 안 했으면 자동 계산된 최소값
  ```
- 화면 표시:
  - 인당 자부담 비용(강조 표시) = `calcResult.perPersonSelfPay` (자동 계산값 기준, 4-(6))
  - 자부담 비율 = `finalSelfPay / totalCost`
  - 최종 지원금 = `totalCost - finalSelfPay`

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
| `K24` | **실제 자부담 비용** | `finalSelfPay` (수동 수정값 우선, 없으면 `calcResult.totalSelfPay`) |
| `K25` | 실제 자부담 비율 | `finalSelfPay / K6` (totalCost=0이면 빈 문자열) |
| `L25` | 정산 결과 안내 문구 | `finalSelfPay - K21 ≥ 0` → `"정산 문제 없음. 최소 자부담 비용보다 {diff}원 추가 부담함"` / 미만이면 → `"최소 자부담 비용 미달. {-diff}원 추가 자부담 필요."` |
| `K30` | 총 회사 지원금 | `K6 - K24` = `calcResult.totalCost - finalSelfPay` |

### 5-1. 빈 셀 처리 규칙
- `setCellValue`에서 `isString=true`이고 값이 빈 문자열(`''`)이면, **`inlineStr("")`이 아닌 진짜 빈 셀(자체 닫힘 `<c r="REF" .../>`)**로 만든다.
  - 이유: `inlineStr("")`은 `COUNTA`에서 "비어있지 않은 셀"로 카운트되어 `K4`(참석자 수) 등의 집계가 틀어짐.

### 5-2. 사진 삽입 위치 (sheet3.xml / sheet4.xml)
- **행사 사진** (`AppState.eventPhoto`): `sheet3.xml`의 `B3`부터, 크기 240×180px
- **영수증 사진**: `sheet4.xml`
  - 법인카드 영수증: `B5`부터 아래로 (행 간격 16행), 크기 220×300px
  - 개인카드 영수증: `D5`부터 아래로 (행 간격 16행), 크기 220×300px
  - `cardType === 'split'` (법인+개인 동시 첨부)인 경우 `corporateReceiptImage`/`personalReceiptImage` 각각 위 위치에 삽입
  - `cardType === 'personal'`이고 `receiptImage`만 있는 경우 → 개인카드 위치(D열)
  - 그 외(`cardType` 기본값=법인) → 법인카드 위치(B열)

---

## 6. 변경 시 주의사항

- 위 계산식(2~4번)은 엑셀 템플릿의 정산 시트와 **수학적으로 동치**가 되도록 맞춰져 있음
  (단, K20/K21/K22의 "최소 자부담"은 항상 자동 계산값이고, K24/K25/K30은 사용자가
  직접 수정한 `finalSelfPay`를 반영한 "실제" 값 — 이 둘의 차이를 절대 혼동하지 말 것).
- `node --check app.js`로 문법 검증 후, `sw.js`의 `APP_VERSION`을 올리고
  `app/src/main/assets/`에 변경 파일을 동기화한 뒤 커밋/푸시한다.
