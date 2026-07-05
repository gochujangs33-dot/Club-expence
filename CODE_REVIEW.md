# 코드 검증 결과 & 승인된 백로그 (매 작업 시작 전 필독)

- **검증일**: 2026-07-05
- **검증 범위**: v1.6.197 ~ v1.6.200 작업분 전체 (후속 수정 v1.6.201 포함)
- **검증 방법**: 다각도 코드리뷰 (라인 단위 스캔 / 제거된 동작 추적 / 호출처 전수 확인 / JS·Firebase 함정 점검 / 리스너 생명주기 / 효율·단순화 / CLAUDE.md 규약 대조)
- **승인 기록**: 사용자가 2026-07-05에 본 문서의 "보류 항목(백로그)" 착수를 승인함.
  단, 실제 착수는 **사용자가 해당 항목을 명시적으로 요청한 시점**에 진행한다 (임의 착수 금지).

---

## 1. v1.6.201에서 수정 완료 — 재수정·롤백 금지 ⛔

| # | 위치 (app.js) | 수정 내용 | 되돌리면 재발하는 버그 |
|---|---|---|---|
| 1 | `renderClubManagement` — `if (needsUpdate && firebaseDb && historyLoaded)` | `historyLoaded` 플래그: globalHistory **최초 로드 완료 후에만** prizeUsed/usedBudget Firebase 쓰기 허용 | 이력 로드 전 빈 리스트 기준 **0원이 공유 clubRegistry를 덮어씀** → 전 접속자 잔여예산 오표시 ("잔여 예산 가끔 안 보임"의 근본 원인) |
| 2 | `renderAdminDashboard` globalHistory `.then()` — `updateChartsBudgetStats(historyList)` 호출 | 이력 도착 시 차트 예산 통계 타일 갱신 | 로그인 후 차트 탭 첫 진입 시 사용예산/정산건수 **0원 고정** |
| 3 | `renderAdminDashboard` step 3 — `renderAllCharts` **호출 없음** (rAF 핸들러 + `.then()` 2경로가 담당) | 차트 3중 렌더 제거 | 차트 탭 클릭마다 전 차트 3회 파괴/재생성 → 깜빡임 |
| 4 | `_countAttendeesByEmpId` 상단 주석 | "이름 폴백" 설명 제거, 재도입 금지 경고로 교체 | 주석을 근거로 이름 폴백 "복원" → 동명이인 카운트 오귀속 재발 |

> v1.6.197~200의 수정 사항(사번 기준 카운트, `.off` 후 `.on`, step 3 loadClubRegistry 재호출 금지 등)은
> [`CLAUDE.md`](CLAUDE.md) §1-6 재수정 금지 표 참조.

---

## 2. 검증 결과 이상 없음 확인된 항목 (근거 포함)

| 항목 | 확인 근거 |
|---|---|
| 계산 로직 무접촉 | `CALCULATION_LOCKED` 영역은 app.js 90~223행뿐 — 이번 작업분 diff와 겹치지 않음 |
| `.off('value')` 광역 해제 부작용 없음 | `ref('clubRegistry')`에 value 리스너를 등록하는 곳은 `loadClubRegistry` 1곳뿐 |
| 사번 타입 일관성 | `_buildIdToName`·`_countAttendeesByEmpId` 모두 `String()` 변환 후 비교 |
| `recalculateDirectoryCountsFromGlobal`의 `this.render()` | `AppState.isLoggedIn`(228행)·`AppState.render`(1410행) 실존 확인 — 무한루프 없음 |
| 명부 카운트 진단 로그 (`[명부 카운트] ...`) | 의도적 잔류 (CHANGES.md v1.6.197 명시) — 제거하지 말 것 |
| 리스너 고아 Promise 위험 | `loadClubRegistry` 중복 호출 시 앞선 Promise가 resolve 안 될 수 있으나, `_onClubRegistryUpdate` 훅(2720행)이 매 스냅샷마다 동일 UI를 갱신하므로 실사용 영향 없음 |

---

## 3. 승인된 보류 항목 (백로그) — 사용자 요청 시 착수

### A. globalHistory 실시간 리스너 구조 전환 (효과 큼, 구조 변경)
- **현상**: 관리자/차트/클럽이력 탭 전환마다 `globalHistory` 전체 + `users` 전체를 `.once`로 재다운로드 (app.js ~4626행).
  이력이 쌓일수록 탭 전환이 느려지고 Firebase 대역폭 비용 증가.
- **개선안**: clubRegistry처럼 `.off('value')` 가드된 단일 `.on('value')` 리스너를 관리자 로그인 시 1회 등록,
  탭 전환은 캐시된 `lastHistoryList`로 순수 재렌더만 수행.
- **착수 시 주의**: `historyLoaded` 플래그 세팅 위치가 리스너 콜백으로 이동해야 함.
  tombstone(`deletedHistoryIds`) 필터링도 리스너 쪽에서 동일하게 처리할 것.

### B. `loadClubRegistry` Promise 재사용 가드 (위험도 낮음)
- **현상**: `.off` → `.on` 재등록 방식이라 호출이 겹치면 앞선 호출의 Promise가 영원히 resolve 안 될 수 있음 (이론상).
- **개선안**: 최초 로드 Promise를 `this._clubRegistryReady`에 보관, 이후 호출은 재등록 없이 같은 Promise 반환.
  에러 시 `_clubRegistryReady = null`로 초기화해 재시도 허용.
- **착수 시 주의**: CLAUDE.md §1-6 불변량(".on 직전 .off") 유지 — 가드는 그 앞단에 추가.

### C. 잠긴 함수 내 미세 최적화 2건 (이득 미미 — **그대로 두기 권장**)
- `_countAttendeesByEmpId` 452행: reduce 재합산 → `cur.count++` (동일 결과, O(1))
- 관리자 로그인 시 전체 렌더 2회 (recalc의 `render()` + 로그인 후속 `AppState.render()`)
- 성능 실측 영향이 미미하므로, 다른 작업으로 해당 함수를 열 때 같이 정리하는 정도만 권장.

### D. `clubTotalBudget` 실시간 갱신 (다중 관리자 환경에서만 의미)
- **현상**: 총 클럽비용은 `loadClubRegistry` 내 `.once`로만 로드 — 다른 관리자가 변경해도 새로고침 전까지 미반영.
- **개선안**: `.on('value')` 리스너로 전환 (단일 관리자 운영이면 불필요).

---

## 4. 다음 작업 시 체크리스트

1. 이 문서의 §1 수정 항목과 CLAUDE.md §1-6 표를 되돌리는 변경이 아닌지 확인
2. `renderClubManagement` 관련 작업 시: `historyLoaded` 가드가 살아있는지 확인
3. 백로그(§3) 항목은 사용자가 명시 요청할 때만 착수 (승인은 이미 완료 상태)
4. 완료 후 본 문서 갱신: 백로그 항목이 처리되면 §1로 이동시키고 버전 기록
