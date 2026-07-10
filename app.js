/**
 * Club Expense Settlement App - Main JavaScript Logic
 */
const APP_VERSION      = '1.6.187';
const APP_VERSION_DATE = '2026.07.02';

// 인당 자부담 비용에 따라 강조 박스의 아이콘/색상을 전환 (100원 이상이면 🔥, 0이면 😊)
function updatePerPersonSelfPayIcon(perPersonSelfPay) {
    const iconEl = document.getElementById('result-per-person-icon');
    const boxEl = document.getElementById('result-per-person-box');
    if (!iconEl || !boxEl) return;
    if (perPersonSelfPay >= 100) {
        iconEl.textContent = '🔥';
        boxEl.classList.remove('no-self-pay');
    } else {
        iconEl.textContent = '😊';
        boxEl.classList.add('no-self-pay');
    }
}

// 1000단위 콤마(,) 표시/파싱 헬퍼
function formatAmount(num) {
    return Number(num || 0).toLocaleString('ko-KR');
}
function parseAmount(val) {
    if (typeof val !== 'string') return Number(val) || 0;
    return parseInt(val.replace(/[^0-9]/g, ''), 10) || 0;
}
// 금액 입력란에 입력하는 즉시 1000단위 콤마(,)를 적용
function setupCurrencyInput(el) {
    if (!el) return;
    el.addEventListener('input', () => {
        const cursorFromEnd = el.value.length - el.selectionStart;
        const num = parseAmount(el.value);
        el.value = num === 0 ? (el.value.replace(/[^0-9]/g, '') === '' ? '' : '0') : formatAmount(num);
        const pos = Math.max(0, el.value.length - cursorFromEnd);
        el.setSelectionRange(pos, pos);
    });
}

// --- Firebase Config & Initialization ---
// 구글 Firebase 콘솔에서 발급받은 실제 설정 키값들을 아래에 입력하시면 클라우드 연동이 활성화됩니다.
const firebaseConfig = {
    apiKey: "AIzaSyA_vDZaJvmPiiWTmFxJju6rWuv7g5g9Jk",
    authDomain: "club-expence.firebaseapp.com",
    databaseURL: "https://club-expence-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "club-expence",
    storageBucket: "club-expence.firebasestorage.app",
    messagingSenderId: "679102443088",
    appId: "1:679102443088:web:ef82b35806569c5b2aab55"
};

let firebaseDb = null;
try {
    if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY") {
        firebase.initializeApp(firebaseConfig);
        firebaseDb = firebase.database();
        console.log("Firebase initialized successfully.");
    }
} catch (error) {
    console.error("Firebase initialization failed:", error);
}

// --- 1. Expense Category Definitions & Rules ---
const ExpenseCategory = {
    EVENT: 'EVENT',
    FACILITY: 'FACILITY',
    PRIZE: 'PRIZE'
};

// Map category key to Korean display name
const categoryNameMap = {
    [ExpenseCategory.EVENT]: '행사비',
    [ExpenseCategory.FACILITY]: '시설 및 장비 이용료',
    [ExpenseCategory.PRIZE]: '상품'
};

// Default calculation thresholds and rates
const DefaultRules = {
    limit1: 30000,       // 가. 지원 한도 (3만 원 이하 자부담 0%)
    limit2: 60000,       // 나. 구간 한도 (6만 원 이하)
    rate2: 0.2,          // 나. 자부담 비율 (20%)
    limit3: 120000,      // 다. 구간 한도 (12만 원 이하)
    rate3: 0.4,          // 다. 자부담 비율 (40%)
    deduction4: 85000,      // 라. 초과 시 자부담 공제액 (8만 5천 원)
    prizeLimit: 500000,     // 상품비 연간 최대 사용 금액
    facilityLimit: 85000    // 시설·장비 이사진 승인 시 법인카드 최대 한도
};

// ⛔ CALCULATION_LOCKED ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 아래 SettlementCalculator / SettlementValidator 블록은
// 관리자(사용자)의 명시적 서면 요청 없이는 절대 수정 금지.
// 수정이 필요하면 CALCULATION_SPEC.md를 먼저 갱신하고 검증 예시값과 대조 후 진행.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// --- 2-A. 독립 검증기 (SettlementCalculator와 별도 로직으로 교차 검증) ---
// calculate() 완료 직후 자동 호출되어 결과값의 수학적 정합성을 재확인한다.
const SettlementValidator = Object.freeze({
    // 허용 오차: 반올림 차이 최대 ±1원
    TOLERANCE: 1,

    // 인당 자부담 독립 계산 (SettlementCalculator.calculateSelfPayPerPerson 와 동일 공식)
    _selfPay(cost, rules) {
        if (cost <= rules.limit1) return 0;
        if (cost <= rules.limit2) return cost * rules.rate2;
        if (cost <= rules.limit3) return rules.limit2 * rules.rate2 + (cost - rules.limit2) * rules.rate3;
        return cost - rules.deduction4;
    },

    validate(memberCount, expenseItems, rules, result) {
        const errs = [];
        const r = result;
        const T = this.TOLERANCE;

        // ① 카테고리별 비용 합계
        const expTotal    = expenseItems.reduce((s, i) => s + i.amount, 0);
        const expEvent    = expenseItems.filter(i => i.category === 'EVENT').reduce((s, i) => s + i.amount, 0);
        const expFacility = expenseItems.filter(i => i.category === 'FACILITY').reduce((s, i) => s + i.amount, 0);
        const expPrize    = expenseItems.filter(i => i.category === 'PRIZE').reduce((s, i) => s + i.amount, 0);

        if (Math.abs(r.totalCost    - expTotal)    > T) errs.push(`totalCost: 기대 ${expTotal}, 실제 ${r.totalCost}`);
        if (Math.abs(r.eventCost    - expEvent)    > T) errs.push(`eventCost: 기대 ${expEvent}, 실제 ${r.eventCost}`);
        if (Math.abs(r.facilityCost - expFacility) > T) errs.push(`facilityCost: 기대 ${expFacility}, 실제 ${r.facilityCost}`);
        if (Math.abs(r.prizeCost    - expPrize)    > T) errs.push(`prizeCost: 기대 ${expPrize}, 실제 ${r.prizeCost}`);

        // ② 인당 행사비
        const expPPE = memberCount > 0 ? expEvent / memberCount : 0;
        if (Math.abs(r.perPersonEventCost - expPPE) > T) errs.push(`perPersonEventCost: 기대 ${expPPE}, 실제 ${r.perPersonEventCost}`);

        // ③ 인당 자부담 (4단계 구간)
        const expSP = this._selfPay(expPPE, rules);
        if (Math.abs(r.perPersonSelfPay - expSP) > T) errs.push(`perPersonSelfPay: 기대 ${expSP}, 실제 ${r.perPersonSelfPay}`);

        // ④ 총 자부담 (반올림)
        const expTSP = Math.round(expSP * memberCount);
        if (Math.abs(r.totalSelfPay - expTSP) > T) errs.push(`totalSelfPay: 기대 ${expTSP}, 실제 ${r.totalSelfPay}`);

        // ⑤ 최종 지원금
        const expSupport = expTotal - expTSP;
        if (Math.abs(r.finalSupportAmount - expSupport) > T) errs.push(`finalSupportAmount: 기대 ${expSupport}, 실제 ${r.finalSupportAmount}`);

        // ⑥ 자부담 비율
        const expRatio = expTotal > 0 ? expTSP / expTotal : 0;
        if (Math.abs(r.selfPayRatio - expRatio) > 0.0001) errs.push(`selfPayRatio: 기대 ${expRatio.toFixed(4)}, 실제 ${r.selfPayRatio.toFixed(4)}`);

        if (errs.length > 0) {
            console.error('🚨 [정산 계산 검증 실패] — 즉시 확인 필요!\n' + errs.join('\n'));
        }
        return { valid: errs.length === 0, errors: errs };
    }
});

// --- 2-B. Settlement Calculator Logic ---
const SettlementCalculator = Object.freeze({
    calculate(memberCount, expenseItems, previousPrizeTotal = 0, rules = DefaultRules) {
        const totalCost = expenseItems.reduce((sum, item) => sum + item.amount, 0);
        const eventCost = expenseItems
            .filter(item => item.category === ExpenseCategory.EVENT)
            .reduce((sum, item) => sum + item.amount, 0);
        const facilityCost = expenseItems
            .filter(item => item.category === ExpenseCategory.FACILITY)
            .reduce((sum, item) => sum + item.amount, 0);
        const prizeCost = expenseItems
            .filter(item => item.category === ExpenseCategory.PRIZE)
            .reduce((sum, item) => sum + item.amount, 0);

        const perPersonEventCost = memberCount > 0 ? eventCost / memberCount : 0.0;

        const selfPayPerPerson = this.calculateSelfPayPerPerson(perPersonEventCost, rules);
        const totalSelfPay = Math.round(selfPayPerPerson * memberCount);
        const selfPayRatio = totalCost > 0 ? totalSelfPay / totalCost : 0.0;
        const finalSupportAmount = totalCost - totalSelfPay;

        const warnings = [];

        if (prizeCost + previousPrizeTotal > (rules.prizeLimit || 500000)) {
            warnings.push("상품비 연 한도 50만원을 초과할 수 없습니다.");
        }
        if (facilityCost > 1000000) {
            warnings.push("시설 및 장비 이용료가 1,000,000원을 초과하여 별도 협의가 필요합니다.");
        }

        const result = {
            memberCount,
            totalCost,
            eventCost,
            facilityCost,
            prizeCost,
            perPersonEventCost,
            perPersonSelfPay: selfPayPerPerson,
            totalSelfPay,
            selfPayRatio,
            finalSupportAmount,
            warnings
        };

        // ━━ 자동 교차 검증 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const validation = SettlementValidator.validate(memberCount, expenseItems, rules, result);
        result._validation = validation; // 호출자가 필요시 참조 가능
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        return result;
    },

    calculateSelfPayPerPerson(cost, rules = DefaultRules) {
        if (cost <= rules.limit1) {
            return 0.0;
        } else if (cost <= rules.limit2) {
            return cost * rules.rate2;
        } else if (cost <= rules.limit3) {
            const part1 = rules.limit2 * rules.rate2; // 60,000원 * 20% = 12,000원
            const part2 = (cost - rules.limit2) * rules.rate3; // 초과액 * 40%
            return part1 + part2;
        } else {
            return cost - rules.deduction4;
        }
    },

    formatCurrency(value) {
        return new Intl.NumberFormat('ko-KR').format(Math.round(value)) + '원';
    }
});
// ⛔ CALCULATION_LOCKED END ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// --- 3. App State Management ---
const AppState = {
    // 로그인 상태 관련
    isLoggedIn: false,
    currentPin: null,
    firebaseDb: firebaseDb,

    memberCount: 0,
    previousPrizeTotal: 0,
    expenseItems: [],
    attendees: [],
    directory: {},
    editingItemId: null,
    editingAttendeeId: null,
    editingDirName: null,
    rules: { ...DefaultRules },
    tempCorpReceiptImage: null,
    tempPersonalReceiptImage: null,
    lastCalculatedSelfPay: 0,
    annualBudget: 0,
    usedBudget: 0,
    reportEmail: 'finance@club.com',
    eventPhotos: [],
    clubName: '',
    clubId: '',
    settlementHistory: [],
    clubHistory: [],
    clubRegistry: {},
    clubTotalBudget: 0,
    editingHistoryId: null,   // 수정 모드 중인 이력 항목 ID

    // Load initial state if storage exists (optional local storage helper)
    load() {
        try {
            const savedItems = localStorage.getItem('club_expense_items');
            if (savedItems) {
                const parsed = JSON.parse(savedItems);
                if (Array.isArray(parsed)) this.expenseItems = parsed;
            }
            const savedMemberCount = localStorage.getItem('club_expense_members');
            if (savedMemberCount) {
                this.memberCount = parseInt(savedMemberCount, 10) || 0;
            }
            // previousPrizeTotal은 clubRegistry.prizeUsed 기준 — localStorage 구버전 값 무시
            // rules는 globalSettings/rules (관리자 설정) 기준 — localStorage 구버전 무시
            const savedAttendees = localStorage.getItem('club_expense_attendees');
            if (savedAttendees) {
                const parsed = JSON.parse(savedAttendees);
                if (Array.isArray(parsed)) {
                    this.attendees = parsed;
                    this.memberCount = this.attendees.length;
                }
            }
            const savedDirectory = localStorage.getItem('club_expense_directory');
            if (savedDirectory) {
                const parsed = JSON.parse(savedDirectory);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.directory = parsed;
            }
            // annualBudget → clubRegistry.budget, usedBudget → 동적 계산 — localStorage 구버전 무시
            const savedReportEmail = localStorage.getItem('club_report_email');
            if (savedReportEmail) this.reportEmail = savedReportEmail;
            const savedEventPhotos = localStorage.getItem('club_event_photos');
            if (savedEventPhotos) {
                try { this.eventPhotos = JSON.parse(savedEventPhotos); } catch(_) {}
            } else {
                const legacy = localStorage.getItem('club_event_photo');
                if (legacy) this.eventPhotos = [legacy];
            }
            const savedClubName = localStorage.getItem('club_name');
            if (savedClubName) this.clubName = savedClubName;
            const savedClubId = localStorage.getItem('club_id');
            if (savedClubId) this.clubId = savedClubId;
            const savedHistory = localStorage.getItem('club_settlement_history');
            if (savedHistory) {
                const parsed = JSON.parse(savedHistory);
                if (Array.isArray(parsed)) this.settlementHistory = parsed;
            }
            const savedCountYear = localStorage.getItem('club_directory_count_year');
            this.directoryCountYear = savedCountYear ? parseInt(savedCountYear, 10) : new Date().getFullYear();
        } catch (e) {
            console.error("Local storage load failed:", e);
        }

        this.resetDirectoryCountsIfNewYear();
    },

    // 누적 사원 명부의 "올해 누적 참석 횟수"는 연 단위 카운트 - 새해가 되면 0으로 초기화
    resetDirectoryCountsIfNewYear() {
        const currentYear = new Date().getFullYear();
        if (this.directoryCountYear !== currentYear) {
            const prevYear = this.directoryCountYear;
            Object.keys(this.directory).forEach(name => {
                let entry = this.directory[name];
                if (typeof entry !== 'object') {
                    entry = { id: entry, count: 0 };
                    this.directory[name] = entry;
                }
                if (entry.count > 0) {
                    if (!entry.history) entry.history = {};
                    entry.history[prevYear] = entry.count;
                }
                entry.count = 0;
            });
            this.directoryCountYear = currentYear;
            localStorage.setItem('club_directory_count_year', currentYear.toString());
            this.save();
        }
    },

    // 전사원 명부 일괄 등록: 기존에 등록된 이름은 건드리지 않고, 새 이름만 추가
    // 동명이인은 ids 배열에 누적 보관 (사번 선택 드롭다운용)
    bulkImportDirectory(list) {
        let added = 0;
        let updated = 0;
        // JSON에 있는 이름 집합 (이름 변경 감지용)
        const jsonNameSet = new Set(list.map(([n]) => n));

        // 역방향 맵: 사번 → 현재 등록된 이름
        const idToName = {};
        Object.entries(this.directory).forEach(([n, val]) => {
            const ids = (typeof val === 'object' && Array.isArray(val.ids))
                ? val.ids.map(String)
                : [String(typeof val === 'object' ? val.id : val)];
            ids.forEach(id => { if (!idToName[id]) idToName[id] = n; });
        });

        list.forEach(([name, employeeId]) => {
            if (!name || !employeeId) return;
            const eid = String(employeeId);
            const existingName = idToName[eid];

            if (existingName && existingName !== name && !jsonNameSet.has(existingName)) {
                // JSON에서 이름이 바뀐 경우 (예: "이진호(PS)" → "이진호")
                // 구 항목에서 이 사번 제거
                const oldEntry = this.directory[existingName];
                if (oldEntry) {
                    const oldIds = Array.isArray(oldEntry.ids) ? oldEntry.ids.map(String) : [String(oldEntry.id)];
                    if (oldIds.length <= 1) {
                        delete this.directory[existingName];
                    } else {
                        oldEntry.ids = oldIds.filter(i => i !== eid);
                        if (String(oldEntry.id) === eid) oldEntry.id = oldEntry.ids[0];
                    }
                }
                // 새 이름에 추가
                const newEntry = this.directory[name];
                if (!newEntry) {
                    this.directory[name] = { id: eid, count: 0, ids: [eid] };
                    added++;
                } else if (typeof newEntry === 'object') {
                    if (!newEntry.ids) newEntry.ids = [String(newEntry.id)];
                    if (!newEntry.ids.includes(eid)) { newEntry.ids.push(eid); updated++; }
                }
                idToName[eid] = name;
            } else {
                const entry = this.directory[name];
                if (entry === undefined) {
                    if (idToName[eid]) return; // 이미 다른 이름으로 등록된 사번 — 건너뜀
                    this.directory[name] = { id: eid, count: 0, ids: [eid] };
                    idToName[eid] = name;
                    added++;
                } else if (typeof entry === 'object') {
                    if (!entry.ids) entry.ids = [String(entry.id)];
                    if (!entry.ids.includes(eid)) {
                        entry.ids.push(eid);
                        idToName[eid] = name;
                        updated++;
                    }
                    if (entry.id !== eid && !/^\d{4}$/.test(String(entry.id))) {
                        entry.id = eid;
                    }
                }
            }
        });
        // 사후 정리: JSON에 없는 이름인데 모든 사번이 JSON에 등록돼 있으면 삭제
        // (예: "이진호(PS)"가 로컬/Firebase에 남아있어도 로그인 시 자동 제거)
        const jsonIdSet = new Set(list.map(([, id]) => String(id)));
        let cleaned = 0;
        Object.keys(this.directory).forEach(n => {
            if (jsonNameSet.has(n)) return;
            const e = this.directory[n];
            const ids = (typeof e === 'object' && Array.isArray(e.ids))
                ? e.ids.map(String)
                : [String(typeof e === 'object' ? e.id : e)];
            if (ids.every(id => jsonIdSet.has(id))) {
                delete this.directory[n];
                cleaned++;
            }
        });
        if (added || updated || cleaned) this.save();
        this.render();
        this.updateDatalist();
        return added;
    },

    // 검색어에 맞는 사원 목록 반환 (동명이인 포함 — 사번 선택 드롭다운용)
    getAllDirectoryMatches(query) {
        if (!query) return [];
        const q = query.trim();
        const results = [];
        Object.entries(this.directory).forEach(([name, val]) => {
            if (!name.includes(q)) return;
            const ids = (typeof val === 'object' && Array.isArray(val.ids) && val.ids.length > 0)
                ? val.ids
                : [typeof val === 'object' ? String(val.id) : String(val)];
            ids.forEach(id => results.push({ name, id }));
        });
        return results;
    },

    // 관리자 전용: globalHistory 전체 기준으로 명부 카운트 재계산 (모든 사용자 정산 반영)
    // ── 사번 기준 카운트 공통 헬퍼 ───────────────────────────────────────
    // 무조건 사번(employeeId) 기준 귀속 — 사번 없는 참석자는 스킵 (v1.6.198)
    // ⚠️ 이름 기반 폴백 재도입 금지: 동명이인 카운트 오귀속 버그 재발함 (CLAUDE.md §1-6 참조)
    _countAttendeesByEmpId(attendeeList, idToName) {
        attendeeList.forEach(att => {
            if (!att.name) return;
            const empId = att.employeeId ? String(att.employeeId) : '';
            // 사번 없으면 완전 스킵 — 이름 기반 폴백 없음 (무조건 사번 기준)
            if (!empId) return;
            const dirKey = idToName[empId];
            if (!dirKey) return; // 명부에 없는 사번
            const cur = this.directory[dirKey];
            if (!cur || typeof cur !== 'object') return;
            if (!cur.counts) cur.counts = {};
            cur.counts[empId] = (cur.counts[empId] || 0) + 1;
            // aggregate count 동기화 (정렬 기준)
            cur.count = Object.values(cur.counts).reduce((s, v) => s + v, 0);
        });
    },

    // ── 카운트 초기화 공통 헬퍼 ─────────────────────────────────────────
    _resetDirectoryCounts() {
        Object.keys(this.directory).forEach(name => {
            const entry = this.directory[name];
            const ids = (typeof entry === 'object' && entry.ids)
                ? entry.ids.map(String)
                : (typeof entry === 'object' && entry.id ? [String(entry.id)] : []);
            const freshCounts = {};
            ids.forEach(id => { if (id && id !== 'undefined' && id !== 'null') freshCounts[id] = 0; });
            if (typeof entry === 'object') { entry.count = 0; entry.counts = freshCounts; }
            else this.directory[name] = { id: entry, count: 0, counts: freshCounts };
        });
    },

    // ── 사번 → 명부 키 역방향 맵 생성 ────────────────────────────────────
    _buildIdToName() {
        const idToName = {};
        Object.entries(this.directory).forEach(([name, entry]) => {
            if (typeof entry !== 'object') return;
            const ids = entry.ids ? entry.ids.map(String) : (entry.id ? [String(entry.id)] : []);
            ids.forEach(id => { if (id) idToName[id] = name; });
        });
        return idToName;
    },

    async recalculateDirectoryCountsFromGlobal() {
        if (!this.firebaseDb) { this.recalculateDirectoryCounts(); return; }
        const currentYear = new Date().getFullYear();
        this._resetDirectoryCounts();
        const idToName = this._buildIdToName();

        try {
            const [histSnap, deletedSnap] = await Promise.all([
                this.firebaseDb.ref('globalHistory').once('value'),
                this.firebaseDb.ref('deletedHistoryIds').once('value')
            ]);
            const deletedIds = new Set(Object.keys(deletedSnap.val() || {}));
            const seenIds = new Set();
            let counted = 0;

            histSnap.forEach(child => {
                const entry = child.val();
                if (!entry || !entry.id) return;
                if (deletedIds.has(String(child.key))) return;
                if (seenIds.has(entry.id)) return;
                seenIds.add(entry.id);
                const entryYear = entry.settlementDate
                    ? parseInt(entry.settlementDate.slice(0, 4), 10)
                    : (entry.date ? new Date(entry.date).getFullYear() : new Date(entry.id).getFullYear());
                if (entryYear !== currentYear) return;
                counted++;
                this._countAttendeesByEmpId(entry.attendees || [], idToName);
            });
            console.log(`[명부 카운트] ${currentYear}년 정산 ${counted}건 처리, 명부 ${Object.keys(this.directory).length}명`);
        } catch (err) {
            console.error('globalHistory 카운트 재계산 실패:', err);
            this.recalculateDirectoryCounts();
        }
        // 카운트 갱신 후 UI 즉시 반영 (로그인 완료 전 호출되는 경우 스킵)
        if (this.isLoggedIn && typeof this.render === 'function') this.render();
    },

    // — 일반 사용자 전용 (자신의 정산 이력만 접근 가능)
    recalculateDirectoryCounts() {
        const currentYear = new Date().getFullYear();
        this._resetDirectoryCounts();
        const idToName = this._buildIdToName();
        const seenIds = new Set();
        (this.settlementHistory || []).forEach(entry => {
            if (!entry || !entry.id) return;
            if (seenIds.has(entry.id)) return;
            seenIds.add(entry.id);
            const entryYear = entry.settlementDate
                ? parseInt(entry.settlementDate.slice(0, 4), 10)
                : (entry.date ? new Date(entry.date).getFullYear() : new Date(entry.id).getFullYear());
            if (entryYear !== currentYear) return;
            this._countAttendeesByEmpId(entry.attendees || [], idToName);
        });
    },

    save() {
        // 1. 로컬 백업 저장 (오프라인 상태 대비)
        try {
            localStorage.setItem('club_expense_items', JSON.stringify(this.expenseItems));
            localStorage.setItem('club_expense_members', this.memberCount.toString());
            localStorage.setItem('club_expense_attendees', JSON.stringify(this.attendees));
            localStorage.setItem('club_expense_directory', JSON.stringify(this.directory));
            localStorage.setItem('club_report_email', this.reportEmail || '');
            // club_expense_rules → globalSettings/rules (관리자 전용, localStorage 저장 중단)
            // club_annual_budget → clubRegistry.budget (관리자 전용, localStorage 저장 중단)
            // club_used_budget → 동적 계산 (localStorage 저장 중단)
            // club_expense_prev_prize → clubRegistry.prizeUsed (관리자 전용, localStorage 저장 중단)
            localStorage.setItem('club_name', this.clubName);
            localStorage.setItem('club_id', this.clubId || '');
            try { localStorage.setItem('club_settlement_history', JSON.stringify(this.settlementHistory)); } catch(_) {}
            if (this.eventPhotos && this.eventPhotos.length > 0) {
                try { localStorage.setItem('club_event_photos', JSON.stringify(this.eventPhotos)); } catch(_) {}
            } else {
                localStorage.removeItem('club_event_photos');
            }
        } catch (e) {
            console.error("Local storage save failed:", e);
        }

        // 2. Firebase 온라인 실시간 클라우드 동기화
        if (this.isLoggedIn && this.firebaseDb && this.currentPin) {
            const dataToSync = {
                // 세션 데이터만 유저별 저장
                memberCount: this.memberCount,
                expenseItems: this.expenseItems,
                attendees: this.attendees,
                directory: this.directory,
                clubName: this.clubName,   // 마지막 선택 클럽명 (편의용)
                clubId: this.clubId || '', // 마지막 선택 클럽 ID (편의용)
                reportEmail: this.reportEmail || '',
                settlementHistory: this.settlementHistory,
                eventPhotos: (this.eventPhotos && this.eventPhotos.length > 0) ? this.eventPhotos : null,
                lastUpdated: Date.now()
                // rules → globalSettings/rules (관리자 전용)
                // annualBudget → clubRegistry.budget (관리자 전용)
                // usedBudget → 동적 계산, 저장 불필요
                // previousPrizeTotal → clubRegistry.prizeUsed (관리자 전용)
            };
            this.firebaseDb.ref(`settlements/${this.currentPin}`).set(dataToSync)
                .catch(err => console.error("Firebase sync failed:", err));
            // save() 시 globalHistory backfill 제거 — 관리자가 삭제한 항목을 되살리는 원인이 됨
            // 신규 정산 확정 시 finalizeSettlement()에서 직접 globalHistory에 쓰므로 여기선 불필요
        }
    },

    // Firebase로부터 데이터 가져오기
    loadFromFirebase(pin) {
        return new Promise((resolve, reject) => {
            if (!this.firebaseDb) {
                reject(new Error("Firebase가 초기화되지 않았습니다."));
                return;
            }

            if (pin === "000000") {
                this.isLoggedIn = true;
                this.currentPin = pin;
                this.userName = "관리자";
                // 관리자 최근 접속 시각 읽기 후 갱신
                this.firebaseDb.ref('users/000000/lastLoginAt').once('value').then(snap => {
                    this.prevLastLoginAt = snap.val() || null;
                    this.firebaseDb.ref('users/000000/lastLoginAt').set(Date.now()).catch(() => {});
                    const el = document.getElementById('last-login-info');
                    if (el && el.style.display === 'block') {
                        el.textContent = this.prevLastLoginAt
                            ? `최근 접속: ${new Date(this.prevLastLoginAt).toLocaleString('ko-KR')}`
                            : '최근 접속: 첫 번째 로그인';
                    }
                }).catch(() => {});
                fetch('./lib/employee_directory.json?_=' + Date.now(), { cache: 'no-store' })
                    .then(res => res.json())
                    .then(list => this.bulkImportDirectory(list))
                    .catch(err => console.error("전사원 명부 자동 등록 실패:", err))
                    .finally(() => {
                        // 관리자: globalHistory 전체 기준으로 카운트 계산 (모든 사용자 정산 반영)
                        this.recalculateDirectoryCountsFromGlobal()
                            .then(() => { this.save(); resolve(true); })
                            .catch(() => { this.recalculateDirectoryCounts(); this.save(); resolve(true); });
                    });
                return;
            }

            this.firebaseDb.ref(`users/${pin}`).once('value')
                .then(userSnapshot => {
                    const userData = userSnapshot.val();
                    if (!userData) {
                        reject(new Error("가입되지 않은 PIN 번호입니다. 신규 회원 등록을 진행해 주세요."));
                        return;
                    }
                    this.userName = userData.name;
                    this.prevLastLoginAt = userData.lastLoginAt || null;
                    // 현재 접속 시각 기록
                    this.firebaseDb.ref(`users/${pin}/lastLoginAt`).set(Date.now())
                        .catch(() => {});

                    this.firebaseDb.ref(`settlements/${pin}`).once('value')
                        .then(snapshot => {
                            const data = snapshot.val();
                            if (data) {
                                // Firebase 데이터가 있을 경우 덮어쓰기
                                if (data.expenseItems) this.expenseItems = data.expenseItems;
                                if (data.memberCount !== undefined) this.memberCount = data.memberCount;
                                if (data.attendees) this.attendees = data.attendees;
                                if (data.directory) this.directory = data.directory;
                                // rules → globalSettings/rules 실시간 리스너 기준 (관리자 설정값 우선)
                                // annualBudget → clubRegistry.budget 기준 (관리자 설정값 우선)
                                // usedBudget → getClubUsedBudget() 으로 동적 계산
                                // previousPrizeTotal → clubRegistry.prizeUsed 기준
                                if (data.clubName !== undefined) this.clubName = data.clubName;
                                if (data.clubId !== undefined) this.clubId = data.clubId;
                                if (data.reportEmail !== undefined) this.reportEmail = data.reportEmail;
                                this.settlementHistory = data.settlementHistory || [];
                                if (data.eventPhotos) {
                                    this.eventPhotos = Array.isArray(data.eventPhotos) ? data.eventPhotos : [data.eventPhotos];
                                } else if (data.eventPhoto) {
                                    this.eventPhotos = [data.eventPhoto];
                                }
                                console.log(`Firebase data loaded successfully for PIN: ${pin} (${this.userName})`);

                                // globalHistory backfill 제거 — 관리자가 삭제한 항목을 로그인할 때마다 되살리는 원인
                            } else {
                                // Firebase에 데이터가 없을 경우(신규 계정) - 이 기기에 남아있던
                                // 이전 계정의 로컬 데이터를 그대로 올리지 않도록 정산 관련 상태를 초기화
                                console.log(`No existing data on Firebase for PIN: ${pin}. Resetting local state for new account.`);
                                this.expenseItems = []; this.eventPhotos = [];
                                this.attendees = [];
                                this.memberCount = 0;
                                this.previousPrizeTotal = 0;
                                this.annualBudget = 0;
                                this.usedBudget = 0;
                                this.clubName = '';
                                this.settlementHistory = [];
                                this.eventPhotos = [];
                                this.isLoggedIn = true;
                                this.currentPin = pin;
                                this.save();
                            }
                            this.isLoggedIn = true;
                            this.currentPin = pin;

                            // 번들된 전사원 데이터 중 누락된 사람을 클라우드 명부에도 병합
                            fetch('./lib/employee_directory.json?_=' + Date.now(), { cache: 'no-store' })
                                .then(res => res.json())
                                .then(list => this.bulkImportDirectory(list))
                                .catch(err => console.error("전사원 명부 자동 등록 실패:", err))
                                .finally(() => {
                                    this.recalculateDirectoryCounts();
                                    this.save();
                                    resolve(true);
                                });
                        })
                        .catch(err => reject(err));
                })
                .catch(err => reject(err));
        });
    },

    // ── 클럽 레지스트리 (관리자가 등록한 전체 클럽 목록 + 예산 분배) ──────────────
    loadClubRegistry() {
        if (!this.firebaseDb) return Promise.resolve();
        // 실시간 리스너: 관리자가 클럽명/예산 수정 시 모든 접속자에게 즉시 반영
        return new Promise((resolve) => {
            let initialLoad = true; // 첫 번째 수신은 초기 로드 — 삭제 팝업 억제
            // 기존 리스너 제거 후 재등록 — 탭 전환마다 loadClubRegistry()가 호출돼 리스너가 누적되는 문제 방지
            this.firebaseDb.ref('clubRegistry').off('value');
            this.firebaseDb.ref('clubRegistry').on('value', snapshot => {
                this.clubRegistry = snapshot.val() || {};
                // 이름 중복 자동 정리: 관리자 세션에서만 Firebase에서 즉시 제거
                if (this.currentPin === '000000') this._autoDeduplicateClubs();
                // 클럽 레지스트리 로드/갱신 시 previousPrizeTotal을 항상 club.prizeUsed 기준으로 동기화
                if (this.clubId && this.clubRegistry[this.clubId]) {
                    this.previousPrizeTotal = this.clubRegistry[this.clubId].prizeUsed || 0;
                }
                // clubId로 현재 사용자가 선택한 클럽명을 추적
                if (this.clubId) {
                    if (this.clubRegistry[this.clubId]) {
                        const regEntry = this.clubRegistry[this.clubId];
                        let changed = false;

                        // 관리자가 이름 변경 시 자동 갱신
                        if (regEntry.name && regEntry.name !== this.clubName) {
                            const prevName = this.clubName;
                            this.clubName = regEntry.name;
                            // 메모리 내 정산 이력도 즉시 반영 (Firebase 갱신은 renameClubInHistory가 처리)
                            if (this.settlementHistory) {
                                this.settlementHistory.forEach(entry => {
                                    if (entry && ((entry.clubId && entry.clubId === this.clubId) || (!entry.clubId && entry.clubName === prevName))) {
                                        entry.clubName = regEntry.name;
                                    }
                                });
                            }
                            changed = true;
                        }

                        // 관리자가 예산 변경 시 자동 갱신
                        if (regEntry.budget !== undefined && regEntry.budget !== this.annualBudget) {
                            this.annualBudget = regEntry.budget;
                            changed = true;
                        }

                        if (changed) this.save();
                    } else if (!initialLoad) {
                        // 초기 로드 이후에만 삭제로 간주 — 초기 로드 중에는 오탐 방지
                        this.clubName = '';
                        this.clubId = '';
                        this.save();
                        if (typeof window.showClubNotFoundModal === 'function') window.showClubNotFoundModal();
                    }
                }
                // 클럽 드롭다운 갱신
                if (typeof window._onClubRegistryUpdate === 'function') window._onClubRegistryUpdate();
                const wasInitialLoad = initialLoad;
                initialLoad = false;
                if (wasInitialLoad) resolve();
            }, err => {
                console.error("클럽 레지스트리 로딩 실패:", err);
                resolve();
            });
            this.firebaseDb.ref('clubTotalBudget').once('value').then(snapshot => {
                this.clubTotalBudget = snapshot.val() || 0;
            });
        });
    },

    saveClubRegistry() {
        if (!this.firebaseDb) return;
        this.firebaseDb.ref('clubRegistry').set(this.clubRegistry).catch(err => console.error("클럽 레지스트리 저장 실패:", err));
    },

    // 관리자가 저장한 자부담 구간/비율 설정을 모든 유저에게 실시간 동기화
    loadGlobalSettings() {
        if (!this.firebaseDb) return;
        this.firebaseDb.ref('globalSettings/rules').on('value', snapshot => {
            const rules = snapshot.val();
            if (rules && typeof rules === 'object') {
                this.rules = { ...this.rules, ...rules };
                if (typeof window._onGlobalSettingsUpdate === 'function') window._onGlobalSettingsUpdate();
            }
        }, err => console.error('globalSettings 로딩 실패:', err));
    },

    saveGlobalRules() {
        if (!this.firebaseDb) return;
        this.firebaseDb.ref('globalSettings/rules').set({ ...this.rules })
            .catch(err => console.error('globalSettings 저장 실패:', err));
    },

    saveClubTotalBudget(value) {
        this.clubTotalBudget = Math.max(0, value || 0);
        if (this.firebaseDb) {
            return this.firebaseDb.ref('clubTotalBudget').set(this.clubTotalBudget)
                .catch(err => {
                    console.error("총 클럽비용 저장 실패:", err);
                    throw err;
                });
        }
        return Promise.resolve();
    },

    addOrUpdateClub(clubId, name, budget, priorUsed, prizeUsed) {
        const existing = this.clubRegistry[clubId] || {};
        this.clubRegistry[clubId] = {
            name: name.trim(),
            budget: Math.max(0, budget || 0),
            priorUsed: Math.max(0, priorUsed || 0),
            prizeUsed: prizeUsed !== undefined ? Math.max(0, prizeUsed) : (existing.prizeUsed || 0),
            usedBudget: existing.usedBudget || 0
        };
        if (this.firebaseDb) {
            this.firebaseDb.ref(`clubRegistry/${clubId}`).set(this.clubRegistry[clubId]).catch(err => console.error("클럽 저장 실패:", err));
        }
    },

    deleteClub(clubId) {
        delete this.clubRegistry[clubId];
        if (this.firebaseDb) {
            this.firebaseDb.ref(`clubRegistry/${clubId}`).remove().catch(err => console.error("클럽 삭제 실패:", err));
        }
    },

    _autoDeduplicateClubs() {
        const registry = this.clubRegistry;
        const groups = {};
        for (const [id, club] of Object.entries(registry)) {
            const key = (club.name || '').trim().toLowerCase();
            if (!key) continue;
            if (!groups[key]) groups[key] = [];
            groups[key].push({ id, club });
        }
        const toRemove = {};
        for (const group of Object.values(groups)) {
            if (group.length <= 1) continue;
            // 예산 큰 것 유지, 같으면 ID가 작은(오래된) 것 유지
            group.sort((a, b) => (b.club.budget || 0) - (a.club.budget || 0) || a.id.localeCompare(b.id));
            const [, ...remove] = group;
            for (const { id } of remove) {
                delete this.clubRegistry[id];
                toRemove[id] = null; // Firebase multi-path update용
            }
        }
        // 단 한 번의 update() 호출로 모든 중복 삭제 → 리스너 재호출 1회로 제한 (깜빡임 방지)
        if (Object.keys(toRemove).length > 0 && this.firebaseDb) {
            this.firebaseDb.ref('clubRegistry').update(toRemove).catch(() => {});
        }
    },

    // 클럽명 변경 시 globalHistory + 모든 유저 settlementHistory의 clubName 일괄 갱신
    async renameClubInHistory(clubId, oldName, newName) {
        if (!this.firebaseDb || !oldName || !newName || oldName === newName) return;
        try {
            const updates = {};

            // globalHistory 갱신 (관리자 이력 탭 기준)
            const histSnap = await this.firebaseDb.ref('globalHistory').once('value');
            histSnap.forEach(child => {
                const entry = child.val();
                if (!entry) return;
                const matchById = clubId && entry.clubId === clubId;
                const matchByName = !entry.clubId && entry.clubName === oldName;
                if (matchById || matchByName) {
                    updates[`globalHistory/${child.key}/clubName`] = newName;
                    if (clubId && !entry.clubId) updates[`globalHistory/${child.key}/clubId`] = clubId;
                }
            });

            // 각 유저의 개인 settlementHistory 갱신
            const settleSnap = await this.firebaseDb.ref('settlements').once('value');
            settleSnap.forEach(pinChild => {
                const pinData = pinChild.val();
                if (!pinData || !Array.isArray(pinData.settlementHistory)) return;
                pinData.settlementHistory.forEach((entry, idx) => {
                    if (!entry) return;
                    const matchById = clubId && entry.clubId === clubId;
                    const matchByName = !entry.clubId && entry.clubName === oldName;
                    if (matchById || matchByName) {
                        updates[`settlements/${pinChild.key}/settlementHistory/${idx}/clubName`] = newName;
                        if (clubId && !entry.clubId) updates[`settlements/${pinChild.key}/settlementHistory/${idx}/clubId`] = clubId;
                    }
                });
            });

            if (Object.keys(updates).length > 0) {
                await this.firebaseDb.ref().update(updates);
                console.log(`클럽명 이력 갱신: "${oldName}" → "${newName}" (${Object.keys(updates).length}건)`);
            }
        } catch (err) {
            console.error('클럽명 이력 갱신 실패:', err);
        }
    },

    // 선택된 클럽의 배정 예산을 현재 사용자의 "올해 클럽 지원 총예산"에 동기화
    // 클럽 레지스트리에서 현재 선택 클럽의 예산을 직접 조회 (항상 관리자 설정값 기준)
    getClubBudget() {
        // 1순위: clubId로 직접 조회
        if (this.clubId && this.clubRegistry[this.clubId]) {
            return this.clubRegistry[this.clubId].budget || 0;
        }
        // 2순위: 이름으로 검색
        if (this.clubName) {
            const club = Object.values(this.clubRegistry).find(c => c.name === this.clubName);
            if (club) return club.budget || 0;
        }
        // 3순위: 레지스트리 미로드 상태면 캐시값 사용 (로그인 직후 타이밍 보호)
        return this.annualBudget || 0;
    },

    // 현재 연도 내 이 클럽의 정산 이력 합산으로 실제 사용금액 계산
    getClubUsedBudget() {
        const currentYear = new Date().getFullYear();
        let regEntry = null;
        if (this.clubId && this.clubRegistry[this.clubId]) {
            regEntry = this.clubRegistry[this.clubId];
        } else if (this.clubName) {
            regEntry = Object.values(this.clubRegistry).find(c => c.name === this.clubName) || null;
        }
        const priorUsed = regEntry ? (regEntry.priorUsed || 0) : 0;

        // clubHistory(전체 사용자 이력)가 로드돼 있으면 우선 사용 — 없으면 개인 이력으로 fallback
        const useClubHistory = this.clubHistory.length > 0;
        const historySource = useClubHistory ? this.clubHistory : (this.settlementHistory || []);
        const fromHistory = historySource
            .filter(e => {
                if (!e || !e.date) return false;
                const entryYear = e.settlementDate
                    ? parseInt(e.settlementDate.slice(0, 4), 10)
                    : new Date(e.date).getFullYear();
                if (entryYear !== currentYear) return false;
                // clubHistory는 이미 현재 클럽 기준으로 필터됨
                if (useClubHistory) return true;
                if (this.clubId) return e.clubId === this.clubId || e.clubName === this.clubName;
                return e.clubName === this.clubName;
            })
            .reduce((sum, e) => sum + (e.finalSupportAmount || 0), 0);

        // Firebase 동기화값 (관리자 대시보드에서 갱신된 값 — 추가 보완용)
        const firebaseUsed = (regEntry && regEntry.usedBudget) ? regEntry.usedBudget : 0;

        return priorUsed + Math.max(fromHistory, firebaseUsed);
    },

    // globalHistory에서 현재 클럽의 전체 이력 로드 (모든 사용자 포함)
    async loadClubHistory() {
        const currentClubId = this.clubId;
        const currentClubName = this.clubName;
        if (!currentClubId && !currentClubName) {
            this.clubHistory = [...(this.settlementHistory || [])];
            return;
        }
        if (!this.firebaseDb || !this.isLoggedIn) {
            this.clubHistory = (this.settlementHistory || []).filter(e =>
                e && (currentClubId
                    ? (e.clubId === currentClubId || e.clubName === currentClubName)
                    : e.clubName === currentClubName)
            );
            return;
        }
        try {
            const [histSnap, deletedSnap] = await Promise.all([
                this.firebaseDb.ref('globalHistory').once('value'),
                this.firebaseDb.ref('deletedHistoryIds').once('value')
            ]);
            const deletedIds = new Set(Object.keys(deletedSnap.val() || {}));
            const allHistory = [];
            histSnap.forEach(child => {
                const entry = child.val();
                if (!entry || deletedIds.has(String(child.key))) return;
                const matchById = currentClubId && (entry.clubId === currentClubId || entry.clubName === currentClubName);
                const matchByName = !currentClubId && entry.clubName === currentClubName;
                if (!matchById && !matchByName) return;
                allHistory.push(entry);
            });
            allHistory.sort((a, b) => {
                const da = a.settlementDate || (a.date ? a.date.slice(0, 10) : '');
                const db = b.settlementDate || (b.date ? b.date.slice(0, 10) : '');
                if (da > db) return -1;
                if (da < db) return 1;
                return (b.id || 0) - (a.id || 0);
            });
            this.clubHistory = allHistory;
        } catch {
            this.clubHistory = (this.settlementHistory || []).filter(e =>
                e && (currentClubId
                    ? (e.clubId === currentClubId || e.clubName === currentClubName)
                    : e.clubName === currentClubName)
            );
        }
    },

    syncBudgetFromClub(clubName) {
        const club = Object.values(this.clubRegistry).find(c => c.name === clubName);
        if (club) {
            this.annualBudget = club.budget;
            if (this.usedBudget === 0) {
                this.usedBudget = club.priorUsed || 0;
            }
            this.save();
        }
    },

    addExpense(description, amount, category, corpChecked, personalChecked, corporateAmountInput) {
        let cardType, corpAmount, personalAmount, receiptImage, corporateReceiptImage, personalReceiptImage;

        if (corpChecked) {
            corpAmount = Math.min(Math.max(corporateAmountInput || 0, 0), amount);
            const personalAmt = amount - corpAmount;
            if (personalAmt > 0) {
                cardType = 'split';
                personalAmount = personalAmt;
                receiptImage = null;
                corporateReceiptImage = this.tempCorpReceiptImage;
                personalReceiptImage = personalChecked ? this.tempPersonalReceiptImage : null;
            } else {
                cardType = 'corporate';
                personalAmount = null;
                receiptImage = this.tempCorpReceiptImage;
                corporateReceiptImage = null;
                personalReceiptImage = null;
            }
        } else if (personalChecked) {
            cardType = 'personal';
            corpAmount = null;
            personalAmount = amount;
            receiptImage = this.tempPersonalReceiptImage;
            corporateReceiptImage = null;
            personalReceiptImage = null;
        } else {
            cardType = 'corporate';
            corpAmount = null;
            personalAmount = null;
            receiptImage = this.tempCorpReceiptImage;
            corporateReceiptImage = null;
            personalReceiptImage = null;
        }

        if (this.editingItemId !== null) {
            const index = this.expenseItems.findIndex(item => item.id === this.editingItemId);
            if (index !== -1) {
                const item = this.expenseItems[index];
                item.description = description;
                item.amount = amount;
                item.category = category;
                item.cardType = cardType;
                item.corporateAmount = corpAmount;
                item.personalAmount = personalAmount;
                item.receiptImage = receiptImage;
                item.corporateReceiptImage = corporateReceiptImage;
                item.personalReceiptImage = personalReceiptImage;
            }
        } else {
            const item = {
                id: Date.now(),
                description,
                amount,
                category,
                cardType,
                corporateAmount: corpAmount,
                personalAmount: personalAmount,
                receiptImage,
                corporateReceiptImage,
                personalReceiptImage
            };
            this.expenseItems.push(item);
        }
        this.cancelEdit();
        this.save();
        this.render();
    },

    deleteExpense(id) {
        this.expenseItems = this.expenseItems.filter(item => item.id !== id);
        if (this.editingItemId === id) {
            this.cancelEdit();
        }
        this.save();
        this.render();
    },

    clearAll() {
        this.expenseItems = [];
        this.attendees = [];
        this.memberCount = 0;
        this.cancelEdit();
        this.save();
        this.render();
    },

    startEditExpense(id) {
        const item = this.expenseItems.find(item => item.id === id);
        if (item) {
            this.editingItemId = id;
            document.getElementById('expense-desc-input').value = item.description;
            document.getElementById('expense-amount-input').value = formatAmount(item.amount);
            document.getElementById('expense-category-select').value = item.category;
            // 시설·장비 항목 수정 시 승인 완료 상태 복원 (기존 항목은 이미 승인된 것으로 간주)
            _facilityApproved = (item.category === ExpenseCategory.FACILITY);

            // Card type / split payment
            const cardType = item.cardType || 'corporate';
            document.getElementById('expense-corp-check').checked = (cardType === 'corporate' || cardType === 'split');
            document.getElementById('expense-personal-check').checked = (cardType === 'personal' || cardType === 'split');
            document.getElementById('expense-corporate-amount-input').value = (item.corporateAmount !== undefined && item.corporateAmount !== null) ? formatAmount(item.corporateAmount) : '';
            document.getElementById('expense-personal-amount-input').value = (item.personalAmount !== undefined && item.personalAmount !== null) ? formatAmount(item.personalAmount) : '';

            // Load receipt preview status
            this.tempCorpReceiptImage = (cardType === 'split') ? (item.corporateReceiptImage || null) : (cardType === 'corporate' ? (item.receiptImage || null) : null);
            this.tempPersonalReceiptImage = (cardType === 'split') ? (item.personalReceiptImage || null) : (cardType === 'personal' ? (item.receiptImage || null) : null);

            // 누적 계산식으로 법인/개인 금액 및 토글 재계산
            autoSetTogglesAndCorp();
            updateCardTypeUI();

            const corpStatusEl = document.getElementById('receipt-corp-status');
            const deleteCorpBtn = document.getElementById('delete-receipt-corp-btn');
            if (this.tempCorpReceiptImage) {
                corpStatusEl.textContent = "✓ 영수증 첨부됨 (변경하려면 새 파일 선택)";
                corpStatusEl.classList.remove('hidden');
                if (deleteCorpBtn) deleteCorpBtn.classList.remove('hidden');
            } else {
                corpStatusEl.classList.add('hidden');
                if (deleteCorpBtn) deleteCorpBtn.classList.add('hidden');
            }
            document.getElementById('expense-receipt-corp-input').value = '';

            const personalStatusEl = document.getElementById('receipt-personal-status');
            const deletePersonalBtn = document.getElementById('delete-receipt-personal-btn');
            if (this.tempPersonalReceiptImage) {
                personalStatusEl.textContent = "✓ 영수증 첨부됨 (변경하려면 새 파일 선택)";
                personalStatusEl.classList.remove('hidden');
                if (deletePersonalBtn) deletePersonalBtn.classList.remove('hidden');
            } else {
                personalStatusEl.classList.add('hidden');
                if (deletePersonalBtn) deletePersonalBtn.classList.add('hidden');
            }
            document.getElementById('expense-receipt-personal-input').value = '';

            const submitBtn = document.getElementById('add-expense-btn');
            submitBtn.innerHTML = `<span class="btn-icon">💾</span> 수정 완료`;
            document.getElementById('cancel-edit-btn').classList.remove('hidden');

            document.getElementById('add-expense-card').scrollIntoView({ behavior: 'smooth' });
            document.getElementById('expense-desc-input').focus();
        }
    },

    cancelEdit() {
        this.editingItemId = null;
        document.getElementById('expense-desc-input').value = '';
        document.getElementById('expense-amount-input').value = '';
        document.getElementById('expense-category-select').selectedIndex = 0;

        document.getElementById('expense-corp-check').checked = true;
        document.getElementById('expense-personal-check').checked = false;
        document.getElementById('expense-corporate-amount-input').value = '';
        document.getElementById('expense-personal-amount-input').value = '';

        document.getElementById('expense-receipt-corp-input').value = '';
        this.tempCorpReceiptImage = null;
        document.getElementById('receipt-corp-status').classList.add('hidden');
        const deleteCorpBtn = document.getElementById('delete-receipt-corp-btn');
        if (deleteCorpBtn) deleteCorpBtn.classList.add('hidden');

        document.getElementById('expense-receipt-personal-input').value = '';
        this.tempPersonalReceiptImage = null;
        document.getElementById('receipt-personal-status').classList.add('hidden');
        const deletePersonalBtn = document.getElementById('delete-receipt-personal-btn');
        if (deletePersonalBtn) deletePersonalBtn.classList.add('hidden');

        updateCardTypeUI();

        const submitBtn = document.getElementById('add-expense-btn');
        submitBtn.innerHTML = `<span class="btn-icon">✨</span> 항목 추가`;
        document.getElementById('cancel-edit-btn').classList.add('hidden');
    },

    addAttendee(name, employeeId) {
        if (this.editingAttendeeId !== null) {
            const index = this.attendees.findIndex(att => att.id === this.editingAttendeeId);
            if (index !== -1) {
                const oldName = this.attendees[index].name;
                // If name changed, remove old directory key (preserve count on new key)
                if (oldName !== name && this.directory[oldName] !== undefined) {
                    const oldData = this.directory[oldName];
                    const oldCount = typeof oldData === 'object' ? (oldData.count || 0) : 0;
                    delete this.directory[oldName];
                    if (!this.directory[name]) {
                        this.directory[name] = { id: employeeId, count: oldCount };
                    }
                } else if (this.directory[name]) {
                    const cur = this.directory[name];
                    this.directory[name] = { id: employeeId, count: typeof cur === 'object' ? (cur.count || 0) : 0 };
                }
                this.attendees[index].name = name;
                this.attendees[index].employeeId = employeeId;
            }
        } else {
            const attendee = { id: Date.now(), name, employeeId };
            this.attendees.push(attendee);
        }

        // Ensure person exists in directory (without touching count)
        if (!this.directory[name]) {
            this.directory[name] = { id: employeeId, count: 0 };
        } else if (typeof this.directory[name] !== 'object') {
            this.directory[name] = { id: this.directory[name], count: 0 };
        }
        
        this.memberCount = this.attendees.length;

        this.cancelEditAttendee();
        this.save();
        this.render();
        this.updateDatalist();
    },

    deleteAttendee(id) {
        this.attendees = this.attendees.filter(att => att.id !== id);
        if (this.editingAttendeeId === id) {
            this.cancelEditAttendee();
        }
        this.memberCount = this.attendees.length;
        this.save();
        this.render();
    },

    clearAttendees() {
        this.attendees = [];
        this.cancelEditAttendee();
        this.memberCount = 0;
        this.save();
        this.render();
    },

    startEditAttendee(id) {
        const attendee = this.attendees.find(att => att.id === id);
        if (attendee) {
            this.editingAttendeeId = id;
            document.getElementById('attendee-name-input').value = attendee.name;
            document.getElementById('attendee-id-input').value = attendee.employeeId;

            const submitBtn = document.getElementById('add-attendee-btn');
            submitBtn.innerHTML = `<span class="btn-icon">💾</span> 수정 완료`;
            document.getElementById('cancel-edit-attendee-btn').classList.remove('hidden');

            document.getElementById('add-attendee-card').scrollIntoView({ behavior: 'smooth' });
            document.getElementById('attendee-name-input').focus();
        }
    },

    cancelEditAttendee() {
        this.editingAttendeeId = null;
        document.getElementById('attendee-name-input').value = '';
        document.getElementById('attendee-id-input').value = '';

        const submitBtn = document.getElementById('add-attendee-btn');
        submitBtn.innerHTML = `<span class="btn-icon">👥</span> 참석 추가`;
        document.getElementById('cancel-edit-attendee-btn').classList.add('hidden');
    },

    updateDatalist() {
        // 커스텀 드롭다운 방식으로 전환 — datalist는 더 이상 사용 안 함
    },

    deleteFromDirectory(name, id) {
        if (this.userName !== '관리자' && this.currentPin !== '002531') {
            alert(t('alert.directory_delete_restricted'));
            return;
        }
        try {
            const entry = this.directory[name];
            if (id && typeof entry === 'object' && Array.isArray(entry.ids) && entry.ids.length > 1) {
                // 동명이인 중 특정 사번만 제거
                entry.ids = entry.ids.filter(i => String(i) !== String(id));
                if (String(entry.id) === String(id)) entry.id = entry.ids[0];
            } else {
                delete this.directory[name];
                if (this.editingDirName === name) this.cancelEditDirectory();
            }
            this.save();
            this.render();
            this.updateDatalist();
        } catch (error) {
            console.error("Error encountered in deleteFromDirectory:", error);
        }
    },

    addDirectoryEntry(name, employeeId) {
        const eid = String(employeeId);
        if (this.editingDirName !== null) {
            const currentData = this.directory[this.editingDirName];
            const currentCount = typeof currentData === 'object' ? (currentData.count || 0) : 1;
            const nameChanged = this.editingDirName !== name;

            if (nameChanged) {
                delete this.directory[this.editingDirName];

                const existing = this.directory[name];
                if (existing) {
                    // 대상 이름이 이미 존재 → 동명이인으로 ids[] 병합
                    if (typeof existing !== 'object') {
                        this.directory[name] = { id: String(existing), count: existing.count || 0, ids: [String(existing)] };
                    }
                    if (!this.directory[name].ids) this.directory[name].ids = [String(this.directory[name].id)];
                    if (!this.directory[name].ids.includes(eid)) this.directory[name].ids.push(eid);
                } else {
                    this.directory[name] = { id: eid, count: currentCount, ids: [eid] };
                }
            } else {
                // 이름 그대로, 특정 사번만 변경 (editingDirId → eid)
                let ids = (currentData && Array.isArray(currentData.ids)) ? currentData.ids.map(String) : [String(currentData && currentData.id ? currentData.id : eid)];
                const oldId = this.editingDirId ? String(this.editingDirId) : null;
                if (oldId && ids.includes(oldId)) {
                    ids = ids.map(i => i === oldId ? eid : i);
                } else if (!ids.includes(eid)) {
                    ids.push(eid);
                }
                const primaryId = (oldId && String(currentData.id) === oldId) ? eid : String(currentData.id || eid);
                this.directory[name] = { id: primaryId, count: currentCount, ids };
            }
        } else {
            const existing = this.directory[name];
            if (existing && typeof existing === 'object') {
                // 이미 존재하는 이름 → 사번 추가
                if (!existing.ids) existing.ids = [String(existing.id)];
                if (!existing.ids.includes(eid)) existing.ids.push(eid);
            } else {
                this.directory[name] = { id: eid, count: 0, ids: [eid] };
            }
        }
        this.cancelEditDirectory();
        this.save();
        this.render();
        this.updateDatalist();
    },

    startEditDirectory(name, id) {
        if (this.userName !== '관리자') {
            alert(t('alert.edit_restricted_admin_only'));
            return;
        }
        const data = this.directory[name];
        if (data !== undefined) {
            this.editingDirName = name;
            this.editingDirId = id ? String(id) : String(typeof data === 'object' ? data.id : data);
            const idVal = this.editingDirId;
            document.getElementById('dir-name-input').value = name;
            document.getElementById('dir-id-input').value = idVal;

            const submitBtn = document.getElementById('add-dir-btn');
            submitBtn.innerHTML = `<span class="btn-icon">💾</span> 수정 완료`;
            document.getElementById('cancel-edit-dir-btn').classList.remove('hidden');

            document.getElementById('add-dir-card').scrollIntoView({ behavior: 'smooth' });
            document.getElementById('dir-name-input').focus();
        }
    },

    cancelEditDirectory() {
        this.editingDirName = null;
        document.getElementById('dir-name-input').value = '';
        document.getElementById('dir-id-input').value = '';

        const submitBtn = document.getElementById('add-dir-btn');
        submitBtn.innerHTML = `<span class="btn-icon">🗂️</span> 사원 등록`;
        document.getElementById('cancel-edit-dir-btn').classList.add('hidden');
    },

    updateAttendance(_memberCount, previousPrizeTotal) {
        this.memberCount = this.attendees.length; // Override count from attendees
        this.previousPrizeTotal = Math.max(0, previousPrizeTotal);
        this.save();
        this.render();
    },

    updateRules(newRules) {
        this.rules = { ...newRules };
        this.save();
        this.saveGlobalRules();
        this.render();
    },

    resetRules() {
        this.rules = { ...DefaultRules };
        this.save();
        this.saveGlobalRules();
        this.render();
    },

    clearClubData() {
        this.expenseItems = [];
        this.attendees = [];
        this.memberCount = 0;
        this.previousPrizeTotal = 0;
        this.eventPhotos = [];
        this.tempCorpReceiptImage = null;
        this.tempPersonalReceiptImage = null;
        this.lastCalculatedSelfPay = 0;
        this.editingItemId = null;
        this.editingAttendeeId = null;
        this.save();
        this.render();

        const memberInput = document.getElementById('member-count-input');
        const prizeInput = document.getElementById('prev-prize-input');
        if (memberInput) memberInput.value = 0;
        if (prizeInput) prizeInput.value = 0;

        this.cancelEdit();
        this.cancelEditAttendee();
    },

    render() {
        const result = SettlementCalculator.calculate(
            this.memberCount,
            this.expenseItems,
            this.previousPrizeTotal,
            this.rules
        );

        // 검증 실패 시 UI 경고 표시
        const calcErrBanner = document.getElementById('calc-validation-error-banner');
        if (calcErrBanner) {
            if (result._validation && !result._validation.valid) {
                calcErrBanner.textContent = '⚠️ 계산 오류 감지: ' + result._validation.errors.join(' / ');
                calcErrBanner.classList.remove('hidden');
            } else {
                calcErrBanner.classList.add('hidden');
            }
        }

        // Update Results UI
        document.getElementById('result-final-support').textContent = SettlementCalculator.formatCurrency(result.finalSupportAmount);
        
        const selfPayInput = document.getElementById('result-total-self-pay-input');
        if (selfPayInput) {
            if (document.activeElement !== selfPayInput) {
                selfPayInput.value = formatAmount(Math.round(result.totalSelfPay));
                this.lastCalculatedSelfPay = Math.round(result.totalSelfPay);
            }
        }
        
        document.getElementById('result-per-person-self-pay').textContent = SettlementCalculator.formatCurrency(result.perPersonSelfPay);
        updatePerPersonSelfPayIcon(result.perPersonSelfPay);
        document.getElementById('result-self-pay-ratio').textContent = `${(result.selfPayRatio * 100).toFixed(1)}%`;
        document.getElementById('result-total-cost').textContent = SettlementCalculator.formatCurrency(result.totalCost);
        document.getElementById('result-event-cost').textContent = SettlementCalculator.formatCurrency(result.eventCost);
        document.getElementById('result-facility-cost').textContent = SettlementCalculator.formatCurrency(result.facilityCost);
        document.getElementById('result-prize-cost').textContent = SettlementCalculator.formatCurrency(result.prizeCost);
        document.getElementById('result-per-person-event-cost').textContent = SettlementCalculator.formatCurrency(result.perPersonEventCost);

        const clubBudget = this.getClubBudget();
        const clubUsed = this.getClubUsedBudget();

        const remainingBudgetRow = document.getElementById('result-club-remaining-budget');
        if (remainingBudgetRow) {
            if (clubBudget > 0) {
                remainingBudgetRow.closest('.detail-row').classList.remove('hidden');
                const remaining = clubBudget - clubUsed;
                remainingBudgetRow.textContent = SettlementCalculator.formatCurrency(remaining);
                remainingBudgetRow.style.color = remaining < 0 ? 'var(--warning-text)' : 'var(--color-secondary)';
            } else {
                remainingBudgetRow.closest('.detail-row').classList.add('hidden');
            }
        }

        // Budget remaining calculation
        const budgetSection = document.getElementById('budget-result-section');
        if (budgetSection) {
            if (clubBudget > 0) {
                const prevRemaining = clubBudget - clubUsed;
                const afterRemaining = prevRemaining - result.finalSupportAmount;
                budgetSection.classList.remove('hidden');
                document.getElementById('result-prev-remaining').textContent = SettlementCalculator.formatCurrency(prevRemaining);
                document.getElementById('result-this-support-sub').textContent = SettlementCalculator.formatCurrency(result.finalSupportAmount);
                document.getElementById('result-after-remaining').textContent = SettlementCalculator.formatCurrency(afterRemaining);
                document.getElementById('result-after-remaining').style.color = afterRemaining >= 0 ? 'var(--color-secondary)' : 'var(--warning-text)';
            } else {
                budgetSection.classList.add('hidden');
            }
        }

        // Event photo display
        const eventPhotoPreview = document.getElementById('event-photo-preview');
        if (eventPhotoPreview) {
            const photos = this.eventPhotos || [];
            if (photos.length > 0) {
                eventPhotoPreview.innerHTML = photos.map((src, idx) =>
                    `<div style="position:relative;display:inline-block;margin:0.2rem;"><img src="${src}" alt="행사 사진 ${idx+1}" style="height:90px;width:auto;border-radius:8px;object-fit:cover;display:block;"><button type="button" class="del-event-photo-btn" data-pidx="${idx}" style="position:absolute;top:3px;right:3px;background:rgba(239,68,68,0.9);border:none;color:#fff;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;font-weight:bold;line-height:1;">&times;</button></div>`
                ).join('');
                eventPhotoPreview.classList.remove('hidden');
            } else {
                eventPhotoPreview.innerHTML = '';
                eventPhotoPreview.classList.add('hidden');
            }
        }

        const memberCountInput = document.getElementById('member-count-input');
        if (memberCountInput) {
            memberCountInput.value = this.memberCount;
        }

        // Update Tab badge and list labels
        const badgeCount = document.getElementById('attendee-badge-count');
        if (badgeCount) badgeCount.textContent = this.attendees.length;
        
        const listCount = document.getElementById('attendee-list-count');
        if (listCount) listCount.textContent = this.attendees.length;

        const dirBadgeCount = document.getElementById('directory-badge-count');
        if (dirBadgeCount) {
            // 사번 기준 인원수 — 명부 탭 내부 카운트(dirRows.length)와 동일 기준 (동명이인은 사번마다 1명)
            let dirIdTotal = 0;
            Object.values(this.directory).forEach(v => {
                dirIdTotal += (typeof v === 'object' && Array.isArray(v.ids) && v.ids.length > 0) ? v.ids.length : 1;
            });
            dirBadgeCount.textContent = dirIdTotal;
        }

        // Update Warnings UI
        const warningsCard = document.getElementById('warnings-card');
        const warningsList = document.getElementById('warnings-list');
        if (!warningsList || !warningsCard) return;
        warningsList.innerHTML = '';

        if (result.warnings.length > 0) {
            result.warnings.forEach(warning => {
                const li = document.createElement('li');
                li.textContent = warning;
                warningsList.appendChild(li);
            });
            warningsCard.classList.remove('hidden');
        } else {
            warningsCard.classList.add('hidden');
        }

        // Update Expense List UI
        const listContainer = document.getElementById('expenses-list');
        listContainer.innerHTML = '';

        if (this.expenseItems.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">💨</span>
                    <p>${t('empty.expenses')}</p>
                </div>
            `;
        } else {
            this.expenseItems.forEach(item => {
                const row = document.createElement('div');
                row.className = 'expense-row';
                row.style.cursor = 'pointer';
                
                let receiptControlHtml = '';
                if (item.corporateReceiptImage || item.personalReceiptImage) {
                    receiptControlHtml = '';
                    if (item.corporateReceiptImage) {
                        receiptControlHtml += `
                            <div class="receipt-preview-wrapper" style="position: relative; display: inline-block; margin-right: 0.4rem;">
                                <img src="${item.corporateReceiptImage}" class="receipt-thumbnail" alt="법인카드 영수증 미리보기" data-desc="${this.escapeHtml(item.description)} (법인카드)">
                                <span style="position:absolute; bottom:-2px; left:-2px; background:rgba(15,23,42,0.85); color:#fff; font-size:9px; padding:0 3px; border-radius:4px; line-height:1.3;">법인</span>
                                <button class="btn-delete-receipt-only" data-id="${item.id}" data-type="corporate" title="법인카드 영수증 삭제" style="position: absolute; top: -5px; right: -5px; background: rgba(239, 68, 68, 0.95); border: none; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; line-height: 1; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3); transition: var(--transition-smooth);">&times;</button>
                            </div>
                        `;
                    }
                    if (item.personalReceiptImage) {
                        receiptControlHtml += `
                            <div class="receipt-preview-wrapper" style="position: relative; display: inline-block; margin-right: 0.5rem;">
                                <img src="${item.personalReceiptImage}" class="receipt-thumbnail" alt="개인카드 영수증 미리보기" data-desc="${this.escapeHtml(item.description)} (개인카드)">
                                <span style="position:absolute; bottom:-2px; left:-2px; background:rgba(15,23,42,0.85); color:#fff; font-size:9px; padding:0 3px; border-radius:4px; line-height:1.3;">개인</span>
                                <button class="btn-delete-receipt-only" data-id="${item.id}" data-type="personal" title="개인카드 영수증 삭제" style="position: absolute; top: -5px; right: -5px; background: rgba(239, 68, 68, 0.95); border: none; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; line-height: 1; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3); transition: var(--transition-smooth);">&times;</button>
                            </div>
                        `;
                    }
                } else if (item.receiptImage) {
                    receiptControlHtml = `
                        <div class="receipt-preview-wrapper" style="position: relative; display: inline-block; margin-right: 0.5rem;">
                            <img src="${item.receiptImage}" class="receipt-thumbnail" alt="영수증 미리보기" data-desc="${this.escapeHtml(item.description)}">
                            <button class="btn-delete-receipt-only" data-id="${item.id}" title="영수증만 삭제" style="position: absolute; top: -5px; right: -5px; background: rgba(239, 68, 68, 0.95); border: none; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; line-height: 1; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3); transition: var(--transition-smooth);">&times;</button>
                        </div>
                    `;
                } else {
                    receiptControlHtml = `<span style="font-size:0.7rem; color:var(--text-muted); opacity:0.6; margin-right:0.4rem;">영수증을 첨부하세요</span>`;
                }

                row.innerHTML = `
                    <div class="expense-row-left">
                        <span class="expense-row-title">${this.escapeHtml(item.description)}</span>
                        <div class="expense-row-meta">
                            <span class="expense-category-badge">${categoryNameMap[item.category]}</span>
                        </div>
                    </div>
                    <div class="expense-row-right">
                        ${receiptControlHtml}
                        <span class="expense-row-amount" style="margin-right: 0.5rem;">${SettlementCalculator.formatCurrency(item.amount)}</span>
                        <button class="btn-delete" data-id="${item.id}" aria-label="삭제">&times;</button>
                    </div>
                `;
                listContainer.appendChild(row);
            });

            // Bind click handlers to receipt thumbnails
            listContainer.querySelectorAll('.receipt-thumbnail').forEach(img => {
                img.addEventListener('click', (e) => {
                    const src = e.target.getAttribute('src');
                    const desc = e.target.getAttribute('data-desc');
                    
                    const modal = document.getElementById('receipt-modal');
                    const modalImg = document.getElementById('modal-img');
                    const captionText = document.getElementById('modal-caption');
                    
                    if (modal && modalImg && captionText) {
                        modal.classList.remove('hidden');
                        modalImg.src = src;
                        captionText.textContent = desc ? `${desc} 영수증` : '영수증 원본';
                    }
                });
            });


            // Bind click handlers to delete receipt only buttons
            listContainer.querySelectorAll('.btn-delete-receipt-only').forEach(button => {
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const itemId = parseInt(button.getAttribute('data-id'), 10);
                    if (itemId) {
                        const index = this.expenseItems.findIndex(item => item.id === itemId);
                        if (index !== -1) {
                            const type = button.getAttribute('data-type');
                            if (type === 'corporate') {
                                this.expenseItems[index].corporateReceiptImage = null;
                            } else if (type === 'personal') {
                                this.expenseItems[index].personalReceiptImage = null;
                            } else {
                                this.expenseItems[index].receiptImage = null;
                            }
                            this.save();
                            this.render();
                        }
                    }
                });
            });

            // Bind row click handler for edit mode
            listContainer.querySelectorAll('.expense-row').forEach((row, idx) => {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('label') || e.target.closest('.receipt-thumbnail')) {
                        return;
                    }
                    const item = this.expenseItems[idx];
                    if (item) {
                        this.startEditExpense(item.id);
                    }
                });
            });

            // Bind click handlers to delete buttons
            listContainer.querySelectorAll('.btn-delete').forEach(button => {
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = parseInt(button.getAttribute('data-id'), 10);
                    const item = this.expenseItems.find(i => i.id === id);
                    const label = item ? item.description : '이 항목';
                    showConfirmModal(`'${label}'을(를) 삭제하시겠습니까?`, () => {
                        this.deleteExpense(id);
                        if (typeof window._syncPrizeTotalFromItems === 'function') window._syncPrizeTotalFromItems();
                    });
                });
            });
        }

        // Update Attendee List UI
        const attendeesContainer = document.getElementById('attendees-container');
        if (attendeesContainer) {
            attendeesContainer.innerHTML = '';

            if (this.attendees.length === 0) {
                attendeesContainer.innerHTML = `
                    <div class="empty-state">
                        <span class="empty-icon">👥</span>
                        <p>${t('empty.attendees')}</p>
                    </div>
                `;
            } else {
                this.attendees.forEach(att => {
                    const row = document.createElement('div');
                    row.className = 'expense-row';
                    row.style.cursor = 'pointer';
                    row.innerHTML = `
                        <div class="expense-row-left">
                            <span class="expense-row-title">${this.escapeHtml(att.name)}</span>
                            <div class="expense-row-meta">
                                <span class="expense-category-badge">사번: ${this.escapeHtml(att.employeeId)}</span>
                            </div>
                        </div>
                        <div class="expense-row-right">
                            <button class="btn-delete-attendee btn-delete" data-id="${att.id}" aria-label="삭제">&times;</button>
                        </div>
                    `;
                    attendeesContainer.appendChild(row);
                });

                // Bind row click handler for edit attendee mode
                attendeesContainer.querySelectorAll('.expense-row').forEach((row, idx) => {
                    row.addEventListener('click', (e) => {
                        if (e.target.closest('button')) {
                            return;
                        }
                        const att = this.attendees[idx];
                        if (att) {
                            this.startEditAttendee(att.id);
                        }
                    });
                });

                // Bind click handlers to delete attendee buttons
                attendeesContainer.querySelectorAll('.btn-delete-attendee').forEach(button => {
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const id = parseInt(button.getAttribute('data-id'), 10);
                        const att = this.attendees.find(a => a.id === id);
                        const label = att ? att.name : '이 참석자';
                        showConfirmModal(`'${label}'을(를) 참석자 목록에서 삭제하시겠습니까?`, () => {
                            this.deleteAttendee(id);
                        });
                    });
                });
            }
        }

        // Update Cumulative Directory Database UI
        const directoryCount = document.getElementById('directory-count');
        const directoryContainer = document.getElementById('directory-container');
        
        if (directoryCount && directoryContainer) {
            const dirKeys = Object.keys(this.directory).sort((a, b) => {
                const countA = typeof this.directory[a] === 'object' ? (this.directory[a].count || 0) : 0;
                const countB = typeof this.directory[b] === 'object' ? (this.directory[b].count || 0) : 0;
                if (countB !== countA) return countB - countA;
                return a.localeCompare(b, 'ko');
            });
            directoryCount.textContent = dirKeys.length;
            
            directoryContainer.innerHTML = '';
            
            if (dirKeys.length === 0) {
                directoryContainer.innerHTML = `
                    <div class="empty-state" style="padding: 1rem 0;">
                        <p style="font-size: 0.8rem;">${t('empty.directory')}</p>
                    </div>
                `;
            } else {
                // ids[]가 여러 개면 사번마다 별도 행으로 렌더링
                const dirRows = [];
                dirKeys.forEach(name => {
                    const entry = this.directory[name];
                    const ids = (typeof entry === 'object' && Array.isArray(entry.ids) && entry.ids.length > 0)
                        ? entry.ids.map(String)
                        : [String(typeof entry === 'object' ? entry.id : entry)];
                    ids.forEach(id => dirRows.push({ name, id }));
                });
                directoryCount.textContent = dirRows.length;

                const canDeleteDir = (this.userName === '관리자' || this.currentPin === '002531');

                dirRows.forEach(({ name, id }) => {
                    const entry = this.directory[name];
                    // 사번 기준 카운트만 사용 — 이름 기준 합산(count)으로 폴백하지 않음
                    const countValue = (typeof entry === 'object' && entry.counts)
                        ? (entry.counts[id] || 0)
                        : 0;
                    const isAdded = this.attendees.some(att => att.name === name && String(att.employeeId) === id);

                    const row = document.createElement('div');
                    row.className = 'expense-row';
                    row.dataset.dirName = name;
                    row.dataset.dirId = id;
                    row.style.padding = '0.5rem 0.75rem';
                    row.style.cursor = 'pointer';

                    const addBtnHtml = isAdded
                        ? `<button class="btn-primary-sm" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background: var(--text-muted); cursor: not-allowed;" disabled>✓ 추가됨</button>`
                        : `<button class="btn-add-to-current btn-primary-sm" data-name="${this.escapeHtml(name)}" data-id="${this.escapeHtml(id)}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">추가</button>`;

                    const deleteDirBtnHtml = canDeleteDir
                        ? `<button class="btn-delete-from-directory btn-delete btn-text-danger" data-name="${this.escapeHtml(name)}" data-id="${this.escapeHtml(id)}" style="padding: 0.5rem; font-size: 1.1rem; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(239, 68, 68, 0.1); margin-left: 0.5rem;" title="명부에서 삭제">&times;</button>`
                        : '';

                    row.innerHTML = `
                        <div class="expense-row-left">
                            <span class="expense-row-title" style="font-size: 0.88rem;">
                                ${this.escapeHtml(name)}
                                <span style="font-size: 0.72rem; color: var(--color-secondary); font-weight: 600; margin-left: 0.3rem;">(올해 누적: ${this.userName === '관리자' ? `<input type="number" class="dir-count-input" data-name="${this.escapeHtml(name)}" data-id="${this.escapeHtml(id)}" value="${countValue}" min="0" style="width:34px; padding:0 2px; font-size:0.72rem; font-weight:700; color:var(--color-secondary); background:transparent; border:none; border-bottom:1px dashed var(--color-secondary); outline:none; text-align:center; -moz-appearance:textfield; appearance:textfield;">` : countValue}회)</span>
                            </span>
                            <span style="font-size: 0.75rem; color: var(--text-secondary);">EMP ID: ${this.escapeHtml(id)}</span>
                        </div>
                        <div class="expense-row-right" style="gap: 0.4rem;">
                            ${addBtnHtml}
                            ${deleteDirBtnHtml}
                        </div>
                    `;
                    directoryContainer.appendChild(row);
                });

                // Bind dir-count-input change handlers
                directoryContainer.querySelectorAll('.dir-count-input').forEach(input => {
                    input.addEventListener('click', (e) => e.stopPropagation());
                    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
                    input.addEventListener('change', () => {
                        const dirName = input.getAttribute('data-name');
                        const dirId = input.getAttribute('data-id');
                        const newCount = Math.max(0, parseInt(input.value, 10) || 0);
                        input.value = newCount;
                        if (this.directory[dirName] !== undefined) {
                            const cur = this.directory[dirName];
                            const curId = typeof cur === 'object' ? cur.id : cur;
                            const curIds = typeof cur === 'object' && Array.isArray(cur.ids) ? cur.ids : [curId];
                            const curCounts = (typeof cur === 'object' && cur.counts) ? Object.assign({}, cur.counts) : {};
                            if (dirId) curCounts[dirId] = newCount;
                            // 전체 count는 사번별 counts 합산으로 갱신
                            const totalCount = Object.values(curCounts).reduce((s, v) => s + v, 0);
                            this.directory[dirName] = { id: curId, count: totalCount, ids: curIds, counts: curCounts };
                            this.save();
                        }
                    });
                });

                // Bind row click handler for edit directory mode
                directoryContainer.querySelectorAll('.expense-row').forEach(row => {
                    row.addEventListener('click', (e) => {
                        if (e.target.closest('button') || e.target.closest('input')) return;
                        const dirName = row.dataset.dirName;
                        const dirId = row.dataset.dirId;
                        if (dirName) this.startEditDirectory(dirName, dirId);
                    });
                });

                // Bind click handlers to add to current buttons
                directoryContainer.querySelectorAll('.btn-add-to-current').forEach(button => {
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const name = button.getAttribute('data-name');
                        const id = button.getAttribute('data-id');
                        if (name && id) this.addAttendee(name, id);
                    });
                });

                // Bind click handlers to delete from directory buttons
                directoryContainer.querySelectorAll('.btn-delete-from-directory').forEach(button => {
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const name = button.getAttribute('data-name');
                        const id = button.getAttribute('data-id');
                        if (name) showConfirmModal(`'${name}'을(를) 전사원 명부에서 삭제하시겠습니까?`, () => {
                            this.deleteFromDirectory(name, id);
                        });
                    });
                });
            }
        }

        // Render Settlement History tab
        const historyContainer = document.getElementById('history-container');
        if (historyContainer) {
            historyContainer.innerHTML = '';
            // clubHistory(전체 클럽원 이력)가 로드돼 있으면 우선 사용, 없으면 개인 이력
            const historyList = this.clubHistory.length > 0 ? this.clubHistory : (this.settlementHistory || []);
            if (historyList.length === 0) {
                historyContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span><p>${t('empty.history')}</p></div>`;
            } else {
                historyList.forEach((entry) => {
                    // 정산 날짜(settlementDate) 우선, 없으면 등록 시각(date) 표시
                    let dateStr;
                    if (entry.settlementDate) {
                        const [sy, sm, sd] = entry.settlementDate.split('-');
                        dateStr = `${sy}.${sm}.${sd}`;
                    } else {
                        const d = new Date(entry.date);
                        dateStr = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                    }
                    const card = document.createElement('div');
                    card.className = 'history-entry';

                    const itemsHtml = (entry.expenseItems || []).map(it =>
                        `<li>${this.escapeHtml(it.description)} <span style="color:var(--color-secondary)">${SettlementCalculator.formatCurrency(it.amount)}</span></li>`
                    ).join('');
                    const attendeesHtml = (entry.attendees || []).map(a => {
                        const empIdStr = a.employeeId ? `<span style="font-size:0.68rem;color:var(--text-muted);margin-left:2px;">(${AppState.escapeHtml(String(a.employeeId))})</span>` : '';
                        return `<span class="expense-category-badge">${this.escapeHtml(a.name)}${empIdStr}</span>`;
                    }).join(' ');

                    const editedBadge = entry.isEdited
                        ? `<span class="badge-edited">${t('badge.edited')}</span>`
                        : '';
                    // 수정 시각은 날짜+시간 모두 표시
                    const editedAtStr = entry.isEdited && entry.editedAt
                        ? (() => {
                            const ea = new Date(entry.editedAt);
                            const eaStr = `${ea.getFullYear()}.${String(ea.getMonth()+1).padStart(2,'0')}.${String(ea.getDate()).padStart(2,'0')} ${String(ea.getHours()).padStart(2,'0')}:${String(ea.getMinutes()).padStart(2,'0')}`;
                            return ` <span style="font-size:0.75rem;color:var(--text-muted);">(수정: ${eaStr})</span>`;
                        })()
                        : '';

                    // 정산인 표시 (본인이면 '나', 타인이면 이름)
                    const isMyEntry = !entry.creatorPin || entry.creatorPin === this.currentPin;
                    const creatorLabel = entry.creatorName
                        ? `<span style="font-size:0.72rem;color:var(--text-muted);white-space:nowrap;">👤 ${this.escapeHtml(entry.creatorName)}</span>`
                        : '';

                    // 수정 버튼은 본인 항목에만 표시
                    const editBtnHtml = isMyEntry
                        ? `<button class="btn-edit-history" data-id="${entry.id}" style="font-size:0.75rem;padding:0.2rem 0.6rem;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;border-radius:0.3rem;cursor:pointer;white-space:nowrap;">✏️ ${t('btn.edit')}</button>`
                        : '';

                    card.innerHTML = `
                        <div class="history-header">
                            <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                                <span class="history-date">${dateStr}</span>
                                ${entry.clubName ? `<span class="history-club">${this.escapeHtml(entry.clubName)}</span>` : ''}
                                ${creatorLabel}
                                ${editedBadge}${editedAtStr}
                            </div>
                            <div style="display:flex;gap:0.3rem;flex-shrink:0;">
                                <button class="btn-download-history" data-id="${entry.id}" style="font-size:0.75rem;padding:0.2rem 0.6rem;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.4);color:#6ee7b7;border-radius:0.3rem;cursor:pointer;white-space:nowrap;">📥 엑셀</button>
                                ${editBtnHtml}
                            </div>
                        </div>
                        <div class="history-summary">
                            <div class="history-stat"><span>${t('hist.attendees')}</span><strong>${entry.memberCount}${t('unit.person')}</strong></div>
                            <div class="history-stat"><span>${t('hist.total_cost')}</span><strong>${SettlementCalculator.formatCurrency(entry.totalCost)}</strong></div>
                            <div class="history-stat"><span>${t('hist.final_support')}</span><strong style="color:var(--color-secondary)">${SettlementCalculator.formatCurrency(entry.finalSupportAmount)}</strong></div>
                            <div class="history-stat"><span>${t('hist.self_pay')}</span><strong style="color:var(--warning-text)">${SettlementCalculator.formatCurrency(entry.totalSelfPay)}</strong></div>
                        </div>
                        <details class="history-details">
                            <summary>${t('hist.view_details')}</summary>
                            <ul class="history-items">${itemsHtml || `<li>${t('hist.no_items')}</li>`}</ul>
                            <div style="margin-top:0.5rem; display:flex; flex-wrap:wrap; gap:0.3rem;">${attendeesHtml || t('hist.no_attendees')}</div>
                        </details>
                    `;
                    historyContainer.appendChild(card);
                });

                // 엑셀 다운로드 버튼 이벤트
                historyContainer.querySelectorAll('.btn-download-history').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = Number(btn.getAttribute('data-id'));
                        const entry = historyList.find(e => e.id === id);
                        if (!entry) return;
                        btn.disabled = true;
                        btn.textContent = '⏳';
                        try {
                            await AppState.downloadHistoryExcel(entry);
                        } finally {
                            btn.disabled = false;
                            btn.textContent = '📥 엑셀';
                        }
                    });
                });

                // 수정 버튼 이벤트 (본인 항목만 렌더링됨)
                historyContainer.querySelectorAll('.btn-edit-history').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = Number(btn.getAttribute('data-id'));
                        const entry = AppState.settlementHistory.find(e => e.id === id);
                        if (entry) AppState.loadHistoryEntryForEdit(entry);
                    });
                });
            }
        }

        // 정적 data-i18n 요소 동기화 (언어 변경 시 즉시 반영)
        if (typeof applyTranslations === 'function') applyTranslations();
    },

    generateEmailReport() {
        const result = SettlementCalculator.calculate(
            this.memberCount,
            this.expenseItems,
            this.previousPrizeTotal,
            this.rules
        );
        
        const emailReceiver = this.reportEmail || 'finance@club.com';
        
        // Build email subject
        const dateStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
        const subject = `[동아리 정산] ${dateStr} 클럽 비용 정산 보고서 (${this.memberCount}명)`;
        
        // Build email body text
        let body = `안녕하세요,\n\n${dateStr} 진행된 클럽 행사 비용 정산 내역을 보고합니다.\n\n`;
        body += `=========================================\n`;
        body += `■ 정산 요약\n`;
        body += `-----------------------------------------\n`;
        body += `- 총 소요 비용: ${SettlementCalculator.formatCurrency(result.totalCost)}\n`;
        body += `- 최종 지원금: ${SettlementCalculator.formatCurrency(result.finalSupportAmount)}\n`;
        body += `- 총 자부담 금액: ${SettlementCalculator.formatCurrency(result.totalSelfPay)}\n`;
        body += `- 인당 자부담 비용: ${SettlementCalculator.formatCurrency(result.perPersonSelfPay)}\n`;
        body += `- 참석 정회원 수: ${result.memberCount}명\n`;
        body += `- 자부담 비율: ${(result.selfPayRatio * 100).toFixed(1)}%\n`;
        body += `=========================================\n\n`;
        
        body += `■ 세부 비용 내역\n`;
        body += `-----------------------------------------\n`;
        if (this.expenseItems.length === 0) {
            body += `등록된 비용 항목이 없습니다.\n`;
        } else {
            this.expenseItems.forEach((item, idx) => {
                body += `${idx + 1}. [${categoryNameMap[item.category]}] ${item.description}: ${SettlementCalculator.formatCurrency(item.amount)}`;
                if (item.receiptImage) {
                    body += ` (영수증 첨부됨)`;
                }
                body += `\n`;
            });
        }
        body += `\n`;
        
        body += `■ 참석자 명단 (${this.attendees.length}명)\n`;
        body += `-----------------------------------------\n`;
        if (this.attendees.length === 0) {
            body += `등록된 참석자가 없습니다.\n`;
        } else {
            this.attendees.forEach((att, idx) => {
                body += `${idx + 1}. ${att.name} (사번: ${att.employeeId})\n`;
            });
        }
        body += `\n`;
        
        body += `* 본 정산서는 클럽 비용 정산기를 통해 자동 생성되었습니다.\n`;
        
        return {
            receiver: emailReceiver,
            subject: subject,
            body: body
        };
    },

    // 공식 정산 양식(template.xlsx)을 불러와 입력 데이터로 채운 엑셀 파일(File 객체) 생성
    async generateExcelFile() {
        const dateStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

        const res = await fetch('./lib/template.xlsx');
        const buf = await res.arrayBuffer();
        const zip = await JSZip.loadAsync(buf);

        // 셀 값을 직접 치환하면 캐시된 수식 결과(<v>)와 calcChain이 어긋나
        // Excel에서 "복구" 경고가 뜨고 0/#DIV0! 으로 보일 수 있음.
        // calcChain.xml을 제거하고 fullCalcOnLoad를 설정해 열 때 전체 재계산되도록 함.
        zip.remove('xl/calcChain.xml');
        let workbookXml = await zip.file('xl/workbook.xml').async('string');
        if (/<calcPr[^>]*\/>/.test(workbookXml)) {
            workbookXml = workbookXml.replace(/<calcPr[^>]*\/>/, '<calcPr calcId="191029" fullCalcOnLoad="1"/>');
        } else {
            workbookXml = workbookXml.replace('</workbook>', '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
        }
        zip.file('xl/workbook.xml', workbookXml);
        const ctXmlForCalc = await zip.file('[Content_Types].xml').async('string');
        zip.file('[Content_Types].xml', ctXmlForCalc.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''));

        // 비용내역 = sheet2.xml (수식 보존을 위해 셀 XML 직접 치환)
        let sheet2 = await zip.file('xl/worksheets/sheet2.xml').async('string');

        // 엑셀 뷰어에 따라 수식의 캐시된 값(<v>)이 재계산되지 않는 경우가 있어
        // 정산 결과에 관련된 K/L열 셀들을 앱에서 계산한 값으로 직접 기입
        const calcResult = SettlementCalculator.calculate(
            this.attendees.length,
            this.expenseItems,
            this.previousPrizeTotal,
            this.rules
        );
        sheet2 = setCellValue(sheet2, 'K4', calcResult.memberCount, false);   // 참석자 수
        sheet2 = setCellValue(sheet2, 'K6', calcResult.totalCost, false);     // 총 비용 (B)
        sheet2 = setCellValue(sheet2, 'K7', calcResult.eventCost, false);     // 행사비 (C)
        sheet2 = setCellValue(sheet2, 'K8', calcResult.facilityCost, false);  // 시설 및 장비 이용료 (D)
        sheet2 = setCellValue(sheet2, 'K9', calcResult.prizeCost, false);     // 상품 (E)

        // 인당 행사비 (F)=(C)/(A) 및 정산 구간별 인당 비용/자부담 비용 (서식의 30,000/60,000/120,000원,
        // 20%/40%, 85,000원 구간 기준에 맞춰 계산 — calculateSelfPayPerPerson과 동일한 합산 결과를 가짐)
        const F = calcResult.memberCount > 0 ? calcResult.eventCost / calcResult.memberCount : 0;
        const L1 = this.rules.limit1, L2 = this.rules.limit2, L3 = this.rules.limit3,
              R2 = this.rules.rate2, R3 = this.rules.rate3, D4 = this.rules.deduction4;
        const k15 = F <= L1 ? F : 0;
        const k16 = (F > L1 && F <= L2) ? F : (F > L2 ? L2 : 0);
        const k17 = (F > L2 && F <= L3) ? (F - L2) : (F > L3 ? (L3 - L2) : 0);
        const k18 = F > L3 ? F : 0;
        const l15 = 0;
        const l16 = k16 * R2;
        const l17 = k17 * R3;
        const l18 = k18 === 0 ? 0 : (k18 - D4);
        const k20 = l15 + l16 + l17 + l18; // 인당 최소 자부담 비용
        const k21 = k20 * calcResult.memberCount; // 총 최소 자부담 비용
        const k22 = calcResult.totalCost > 0 ? k21 / calcResult.totalCost : ''; // 총 최소 자부담 비율

        if (calcResult.memberCount > 0) {
            sheet2 = setCellValue(sheet2, 'K12', F, false);
            let label12;
            if (calcResult.eventCost === 0) {
                label12 = '';
            } else if (F <= L1) {
                label12 = '전액지원';
            } else if (F <= L2) {
                label12 = `${Math.round(R2 * 100)}% 자체 부담`;
            } else if (F <= L3) {
                label12 = `'나' 구간 자부담 비용 + ${formatAmount(L2)}원 초과 금액에 대해 ${Math.round(R3 * 100)}% 자체 부담`;
            } else {
                label12 = `${formatAmount(D4)}원 이외 금액 자체 부담(최대 인당 ${(D4 / 10000).toLocaleString('ko-KR')}만원 지원)`;
            }
            sheet2 = setCellValue(sheet2, 'L12', label12, true);

            // 정산 구간표(가/나/다/라) 라벨도 현재 설정값 기준으로 갱신
            sheet2 = setCellValue(sheet2, 'J15', `가. (F) ≤ ${formatAmount(L1)}원`, true);
            sheet2 = setCellValue(sheet2, 'J16', `나. ${formatAmount(L1)}원 < (F) ≤ ${formatAmount(L2)}원`, true);
            sheet2 = setCellValue(sheet2, 'J17', `다. ${formatAmount(L2)}원 < (F) ≤ ${formatAmount(L3)}원`, true);
            sheet2 = setCellValue(sheet2, 'J18', `라. ${formatAmount(L3)}원 < (F)`, true);
        } else {
            sheet2 = setCellValue(sheet2, 'K12', '', true);
            sheet2 = setCellValue(sheet2, 'L12', '', true);
        }

        sheet2 = setCellValue(sheet2, 'K15', k15, false);
        sheet2 = setCellValue(sheet2, 'K16', k16, false);
        sheet2 = setCellValue(sheet2, 'K17', k17, false);
        sheet2 = setCellValue(sheet2, 'K18', k18, false);
        sheet2 = setCellValue(sheet2, 'L15', l15, false);
        sheet2 = setCellValue(sheet2, 'L16', l16, false);
        sheet2 = setCellValue(sheet2, 'L17', l17, false);
        sheet2 = setCellValue(sheet2, 'L18', l18, false);
        sheet2 = setCellValue(sheet2, 'K20', k20, false);
        sheet2 = setCellValue(sheet2, 'K21', k21, false);
        if (k22 === '') {
            sheet2 = setCellValue(sheet2, 'K22', '', true);
        } else {
            sheet2 = setCellValue(sheet2, 'K22', k22, false);
        }

        // D5부터 정회원 참석자 이름 입력 (최대 120명, E열 수식이 D열을 Global ID 명단과 대조)
        for (let idx = 0; idx < 120; idx++) {
            const row = 5 + idx;
            const att = this.attendees[idx];
            sheet2 = setCellValue(sheet2, `C${row}`, att ? att.employeeId : '', true);
            sheet2 = setCellValue(sheet2, `D${row}`, att ? att.name : '', true);
        }

        // 5행부터 입력 (서식상 최대 20건)
        this.expenseItems.slice(0, 20).forEach((item, idx) => {
            const row = 5 + idx;
            sheet2 = setCellValue(sheet2, `F${row}`, item.description, true);
            sheet2 = setCellValue(sheet2, `G${row}`, item.amount, false);
            sheet2 = setCellValue(sheet2, `H${row}`, categoryNameMap[item.category] || item.category, true);
        });

        // K24(실제 자부담 비용): 앱에서 계산/수정된 총 자부담 금액을 그대로 입력
        // (수정 없으면 자동 계산된 값, 수정했으면 사용자가 직접 수정한 값)
        const finalSelfPay = this.lastCalculatedSelfPay > 0 ? this.lastCalculatedSelfPay : calcResult.totalSelfPay;
        sheet2 = setCellValue(sheet2, 'K24', finalSelfPay, false);

        // K25(실제 자부담 비율), L25(정산 결과 안내), K30(총 회사 지원금)
        if (calcResult.totalCost > 0) {
            const k25 = finalSelfPay / calcResult.totalCost;
            sheet2 = setCellValue(sheet2, 'K25', k25, false);
            const diff = finalSelfPay - k21;
            const label25 = diff >= 0
                ? `정산 문제 없음. 최소 자부담 비용보다 ${diff.toLocaleString('ko-KR')}원 추가 부담함`
                : `최소 자부담 비용 미달. ${(-diff).toLocaleString('ko-KR')}원 추가 자부담 필요.`;
            sheet2 = setCellValue(sheet2, 'L25', label25, true);
        } else {
            sheet2 = setCellValue(sheet2, 'K25', '', true);
            sheet2 = setCellValue(sheet2, 'L25', '', true);
        }
        sheet2 = setCellValue(sheet2, 'K30', calcResult.totalCost - finalSelfPay, false);

        zip.file('xl/worksheets/sheet2.xml', sheet2);

        // 사진 삽입 위치 구성
        // 행사사진(sheet3): B3부터 좌/우 번갈아 배치
        // 영수증(sheet4): B5부터 법인카드, D5부터 개인카드 영수증 순서대로 아래로 배치
        const placements = [];
        const PHOTO_W = 240, PHOTO_H = 180;     // 행사사진
        const RECEIPT_W = 220, RECEIPT_H = 300; // 영수증
        const RECEIPT_ROW_STEP = 16;

        const eventPhotos = this.eventPhotos || [];
        for (let pi = 0; pi < eventPhotos.length; pi++) {
            placements.push({
                sheetFile: 'sheet3.xml',
                col: 1 + pi * 5, row: 2,
                blob: await this.dataUrlToFile(eventPhotos[pi], `event${pi + 1}`),
                widthPx: PHOTO_W, heightPx: PHOTO_H
            });
        }

        let corpRow = 4, personalRow = 4;
        for (const item of this.expenseItems) {
            if (item.cardType === 'split') {
                if (item.corporateReceiptImage) {
                    placements.push({ sheetFile: 'sheet4.xml', col: 1, row: corpRow, blob: await this.dataUrlToFile(item.corporateReceiptImage, 'corp'), widthPx: RECEIPT_W, heightPx: RECEIPT_H });
                    corpRow += RECEIPT_ROW_STEP;
                }
                if (item.personalReceiptImage) {
                    placements.push({ sheetFile: 'sheet4.xml', col: 3, row: personalRow, blob: await this.dataUrlToFile(item.personalReceiptImage, 'personal'), widthPx: RECEIPT_W, heightPx: RECEIPT_H });
                    personalRow += RECEIPT_ROW_STEP;
                }
            } else if (item.receiptImage) {
                if (item.cardType === 'personal') {
                    placements.push({ sheetFile: 'sheet4.xml', col: 3, row: personalRow, blob: await this.dataUrlToFile(item.receiptImage, 'personal'), widthPx: RECEIPT_W, heightPx: RECEIPT_H });
                    personalRow += RECEIPT_ROW_STEP;
                } else {
                    // 법인카드(기본값)
                    placements.push({ sheetFile: 'sheet4.xml', col: 1, row: corpRow, blob: await this.dataUrlToFile(item.receiptImage, 'corp'), widthPx: RECEIPT_W, heightPx: RECEIPT_H });
                    corpRow += RECEIPT_ROW_STEP;
                }
            }
        }

        if (placements.length > 0) {
            await embedImagesIntoXlsx(zip, placements);
        }

        const wbout = await zip.generateAsync({ type: 'arraybuffer' });
        const settleDateInput = document.getElementById('settlement-date-input');
        const settleDateVal = settleDateInput ? settleDateInput.value : '';
        const fileDateStr = (settleDateVal || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
        const safeClubName = (this.clubName || '클럽').replace(/[\\/:*?"<>|]/g, '_');
        const fileName = `${safeClubName}(${fileDateStr}).xlsx`;
        return new File([wbout], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    },

    // base64 데이터 URL을 File 객체로 변환
    async dataUrlToFile(dataUrl, fileName) {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        return new File([blob], `${fileName}.${ext}`, { type: blob.type });
    },

    // File 객체를 base64 문자열로 변환 (data URL 접두어 제외)
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    // 이력 항목의 데이터를 기반으로 엑셀 생성 후 다운로드 (AppState를 임시 교체 후 복원)
    async downloadHistoryExcel(entry) {
        const sdi = document.getElementById('settlement-date-input');
        const prev = {
            memberCount: this.memberCount, expenseItems: this.expenseItems,
            attendees: this.attendees, clubName: this.clubName, clubId: this.clubId,
            lastCalculatedSelfPay: this.lastCalculatedSelfPay,
            previousPrizeTotal: this.previousPrizeTotal,
            editingHistoryId: this.editingHistoryId,
            sdiVal: sdi ? sdi.value : '',
        };
        try {
            this.memberCount = entry.memberCount || (entry.attendees ? entry.attendees.length : 0);
            this.expenseItems = JSON.parse(JSON.stringify(entry.expenseItems || []));
            this.attendees = JSON.parse(JSON.stringify(entry.attendees || []));
            this.clubName = entry.clubName || '';
            this.clubId = entry.clubId || '';
            this.lastCalculatedSelfPay = entry.totalSelfPay || 0;
            this.previousPrizeTotal = 0;
            this.editingHistoryId = null;
            if (sdi) sdi.value = entry.settlementDate || new Date().toISOString().slice(0, 10);
            const file = await this.generateExcelFile();
            const url = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = url; a.download = file.name;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('이력 엑셀 다운로드 실패:', err);
            alert('엑셀 파일 생성 중 오류가 발생했습니다: ' + (err.message || ''));
        } finally {
            this.memberCount = prev.memberCount; this.expenseItems = prev.expenseItems;
            this.attendees = prev.attendees; this.clubName = prev.clubName;
            this.clubId = prev.clubId; this.lastCalculatedSelfPay = prev.lastCalculatedSelfPay;
            this.previousPrizeTotal = prev.previousPrizeTotal;
            this.editingHistoryId = prev.editingHistoryId;
            if (sdi) sdi.value = prev.sdiVal;
        }
    },

    // 엑셀 파일만 로컬 다운로드 폴더에 저장 (수정 모드이면 이력도 갱신)
    async downloadExcelOnly() {
        try {
            const file = await this.generateExcelFile();
            const url = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // 수정 모드: 이력 항목 갱신
            if (this.editingHistoryId) {
                const result = SettlementCalculator.calculate(
                    this.memberCount, this.expenseItems, this.previousPrizeTotal, this.rules
                );
                const finalTotalSelfPay = this.lastCalculatedSelfPay > 0 ? this.lastCalculatedSelfPay : result.totalSelfPay;
                const updatedFields = {
                    memberCount: this.memberCount,
                    totalCost: result.totalCost,
                    finalSupportAmount: result.totalCost - finalTotalSelfPay,
                    totalSelfPay: finalTotalSelfPay,
                    perPersonSelfPay: this.memberCount > 0 ? Math.round(finalTotalSelfPay / this.memberCount) : result.perPersonSelfPay,
                    selfPayRatio: result.totalCost > 0 ? finalTotalSelfPay / result.totalCost : 0,
                    expenseItems: JSON.parse(JSON.stringify(this.expenseItems)),
                    attendees: JSON.parse(JSON.stringify(this.attendees)),
                    clubName: this.clubName,
                    clubId: this.clubId || '',
                };
                await this.updateHistoryEntry(this.editingHistoryId, updatedFields);
                this.cancelEditMode();
                this.render();
            }
        } catch (err) {
            console.error("엑셀 파일 다운로드 실패:", err);
            alert(t('alert.excel_download_failed') + err.message);
            throw err;
        }
    },

    // 엑셀(수정된 정산서) + 참석자/영수증 사진 파일 목록 생성
    async collectReportFiles() {
        const files = [];
        files.push(await this.generateExcelFile());

        for (let pi = 0; pi < (this.eventPhotos || []).length; pi++) {
            files.push(await this.dataUrlToFile(this.eventPhotos[pi], `행사_사진${pi + 1}`));
        }

        for (let i = 0; i < this.expenseItems.length; i++) {
            const item = this.expenseItems[i];
            if (item.cardType === 'split') {
                if (item.corporateReceiptImage) {
                    const label = `영수증_${i + 1}_법인_${categoryNameMap[item.category] || item.category}`;
                    files.push(await this.dataUrlToFile(item.corporateReceiptImage, label));
                }
                if (item.personalReceiptImage) {
                    const label = `영수증_${i + 1}_개인_${categoryNameMap[item.category] || item.category}`;
                    files.push(await this.dataUrlToFile(item.personalReceiptImage, label));
                }
            } else if (item.receiptImage) {
                const label = `영수증_${i + 1}_${categoryNameMap[item.category] || item.category}`;
                files.push(await this.dataUrlToFile(item.receiptImage, label));
            }
        }
        return files;
    },

    // 파일들을 브라우저 다운로드로 저장 (메일에 수동 첨부용)
    async downloadReportFiles() {
        const files = await this.collectReportFiles();
        files.forEach(file => {
            const url = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
        if (files.length > 0) {
            alert(t('alert.files_downloaded'));
        }
    },

    // 이력 항목을 현재 정산 폼으로 복원 (수정 모드 진입)
    loadHistoryEntryForEdit(entry) {
        if (!entry || typeof entry !== 'object' || !entry.id) {
            console.error('loadHistoryEntryForEdit: 유효하지 않은 이력 항목', entry);
            return;
        }
        this.editingHistoryId = entry.id;
        this.expenseItems = JSON.parse(JSON.stringify(entry.expenseItems || []));
        this.attendees = JSON.parse(JSON.stringify(entry.attendees || []));
        // memberCount가 없으면 attendees 수로 보완 (구버전 데이터 호환)
        this.memberCount = entry.memberCount || (entry.attendees ? entry.attendees.length : 0);
        if (entry.clubName) this.clubName = entry.clubName;
        // clubId 없는 구버전 데이터: 이름으로 역조회해서 복원
        if (entry.clubId) {
            this.clubId = entry.clubId;
        } else if (entry.clubName) {
            const match = Object.entries(this.clubRegistry || {}).find(([, c]) => c.name === entry.clubName);
            this.clubId = match ? match[0] : '';
        }
        this.lastCalculatedSelfPay = entry.totalSelfPay || 0;
        // 정산 날짜 입력란을 이력 원본 날짜로 복원 (_onSettleDateChange: 특정 날짜 지정)
        if (entry.settlementDate) {
            if (typeof window._onSettleDateChange === 'function') {
                window._onSettleDateChange(entry.settlementDate);
            } else {
                const _sdiEdit = document.getElementById('settlement-date-input');
                if (_sdiEdit) _sdiEdit.value = entry.settlementDate;
            }
        }
        // 수정 모드에서 "파일 저장 및 정산 완료" 버튼 숨기기
        const _sendEmailBtn = document.getElementById('send-email-btn');
        if (_sendEmailBtn) _sendEmailBtn.classList.add('hidden');
        // 수정 모드 배너 표시
        const banner = document.getElementById('edit-mode-banner');
        const dateEl = document.getElementById('edit-mode-date');
        if (banner) banner.classList.remove('hidden');
        if (dateEl) {
            const d = new Date(entry.date);
            dateEl.textContent = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
        }
        // 정산 탭으로 전환
        document.querySelectorAll('.tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        const settlementTab = document.querySelector('[data-tab="tab-settlement"]');
        const settlementPane = document.getElementById('tab-settlement');
        if (settlementTab) settlementTab.classList.add('active');
        if (settlementPane) settlementPane.classList.remove('hidden');
        this.render();
    },

    // 수정된 항목으로 이력 엔트리 업데이트 (Firebase globalHistory + 개인 settlementHistory)
    async updateHistoryEntry(id, updatedFields) {
        const idx = (this.settlementHistory || []).findIndex(e => String(e.id) === String(id));
        if (idx < 0) return;
        const updated = { ...this.settlementHistory[idx], ...updatedFields, isEdited: true, editedAt: new Date().toISOString() };
        this.settlementHistory[idx] = updated;
        this.save();
        if (this.firebaseDb) {
            try {
                // globalHistory: 개별 필드 업데이트
                const globalUpdate = { ...updatedFields, isEdited: true, editedAt: updated.editedAt };
                await this.firebaseDb.ref(`globalHistory/${id}`).update(globalUpdate);

                // 개인 settlementHistory: Firebase는 배열을 객체로 저장하므로
                // 인덱스 경로 대신 배열 전체를 덮어써야 올바른 위치에 저장됨
                await this.firebaseDb.ref(`settlements/${this.currentPin}/settlementHistory`).set(this.settlementHistory);
            } catch (err) {
                console.error('이력 수정 저장 실패:', err);
                alert(t('alert.save_error_network'));
            }
        }
    },

    // 수정 모드 해제
    cancelEditMode() {
        this.editingHistoryId = null;
        const banner = document.getElementById('edit-mode-banner');
        if (banner) banner.classList.add('hidden');
        // 숨겼던 버튼 복원
        const sendBtn = document.getElementById('send-email-btn');
        if (sendBtn) sendBtn.classList.remove('hidden');
        // 날짜를 오늘로 초기화
        if (typeof window._onSettleDateReset === 'function') window._onSettleDateReset();
    },

    // 엑셀 + 사진(참석자/영수증)을 묶어 공유 시트로 전달
    async shareSettlementReport(receiver, subject, body) {
        const statusEl = document.getElementById('share-report-status');
        const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

        try {
            setStatus('파일을 준비하는 중입니다...');

            const files = await this.collectReportFiles();

            const dateStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
            const shareData = {
                title: subject || `[동아리 정산] ${dateStr} 클럽 비용 정산 보고서`,
                text: body || `${dateStr} 클럽 비용 정산 보고서와 참석자/영수증 사진을 첨부합니다.`,
                files: files
            };

            if (window.AndroidShare && typeof window.AndroidShare.shareFiles === 'function') {
                const filesPayload = await Promise.all(files.map(async f => ({
                    name: f.name,
                    mimeType: f.type || 'application/octet-stream',
                    base64: await this.fileToBase64(f)
                })));
                window.AndroidShare.shareFiles(JSON.stringify(filesPayload), shareData.title, shareData.text, receiver || '');
                setStatus('공유 시트가 열렸습니다. 메일 앱을 선택해 전송해주세요.');
            } else if (navigator.canShare && navigator.canShare(shareData)) {
                await navigator.share(shareData);
                setStatus('공유 시트가 열렸습니다. 메일 앱을 선택해 전송해주세요.');
            } else if (navigator.canShare && navigator.canShare({ files: [files[0]] })) {
                await navigator.share({ title: shareData.title, text: shareData.text, files: [files[0]] });
                setStatus('이 기기는 다중 파일 공유를 지원하지 않아 엑셀 파일만 공유되었습니다.');
            } else {
                setStatus('이 브라우저/기기는 파일 공유를 지원하지 않습니다. "메일 앱으로 본문 전송" 기능을 이용해주세요.');
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                setStatus('공유가 취소되었습니다.');
            } else if (err.name === 'NotAllowedError') {
                console.error(err);
                setStatus('이 브라우저/환경에서는 파일 공유가 차단되었습니다. "메일 앱 열기" 또는 "본문 복사"를 이용해주세요.');
            } else {
                console.error(err);
                setStatus('공유 중 오류가 발생했습니다: ' + err.message);
            }
        }
    },

    finalizeSettlement(skipConfirm = false) {
        if (this.editingHistoryId) {
            alert('수정 모드에서는 엑셀 다운로드 시 이력이 업데이트됩니다. 수정을 취소하려면 "수정 취소" 버튼을 누르세요.');
            return;
        }
        if (!skipConfirm && !confirm(t('confirm.finalize_settlement'))) return;

        const result = SettlementCalculator.calculate(
            this.memberCount, this.expenseItems, this.previousPrizeTotal, this.rules
        );

        // Use manually adjusted self-pay if user changed it, otherwise use calculated
        const finalTotalSelfPay = this.lastCalculatedSelfPay > 0 ? this.lastCalculatedSelfPay : result.totalSelfPay;
        const finalPerPersonSelfPay = this.memberCount > 0 ? finalTotalSelfPay / this.memberCount : result.perPersonSelfPay;
        const finalSelfPayRatio = result.totalCost > 0 ? finalTotalSelfPay / result.totalCost : 0;

        // 사용자가 지정한 정산 날짜 (미입력 시 오늘)
        const settleDateInput = document.getElementById('settlement-date-input');
        const settleDateVal   = settleDateInput ? settleDateInput.value : '';
        const settlementDate  = settleDateVal || new Date().toISOString().slice(0, 10);

        const newHistoryItem = {
            id: Date.now(),
            date: new Date().toISOString(),
            settlementDate,
            creatorPin: this.currentPin || "offline",
            creatorName: this.userName || "오프라인 사용자",
            clubName: this.clubName || "기본 클럽",
            clubId: this.clubId || '',
            memberCount: this.memberCount,
            totalCost: result.totalCost,
            finalSupportAmount: result.totalCost - finalTotalSelfPay,
            totalSelfPay: finalTotalSelfPay,
            perPersonSelfPay: finalPerPersonSelfPay,
            selfPayRatio: finalSelfPayRatio,
            expenseItems: JSON.parse(JSON.stringify(this.expenseItems)),
            attendees: JSON.parse(JSON.stringify(this.attendees)),
        };

        // Save to local history
        this.settlementHistory.unshift(newHistoryItem);
        // clubHistory에도 즉시 반영 (로드돼 있는 경우)
        if (this.clubHistory.length > 0) this.clubHistory.unshift(newHistoryItem);

        // Save to Firebase global history
        if (this.isLoggedIn && this.firebaseDb) {
            this.firebaseDb.ref(`globalHistory/${newHistoryItem.id}`).set(newHistoryItem)
                .catch(err => console.error("Global history push failed:", err));
        }

        // 명부 누적 카운트는 정산 이력 기준으로 재계산 (잘못된 잔여 카운트가 누적되지 않도록)
        this.recalculateDirectoryCounts();

        // Update used budget (사용자가 수정한 자부담 기준 실제 지원금과 동일한 값 사용)
        this.usedBudget = Math.max(0, this.usedBudget + newHistoryItem.finalSupportAmount);

        // 클럽 레지스트리 업데이트: usedBudget + prizeUsed 동시 갱신 (경쟁 조건 방지를 위해 해당 클럽만 update)
        if (this.clubId && this.clubRegistry[this.clubId]) {
            const club = this.clubRegistry[this.clubId];
            club.usedBudget = (club.usedBudget || 0) + newHistoryItem.finalSupportAmount;
            const prizeThisSession = result.prizeCost || 0;
            if (prizeThisSession > 0) {
                club.prizeUsed = (club.prizeUsed || 0) + prizeThisSession;
            }
            if (this.firebaseDb) {
                this.firebaseDb.ref(`clubRegistry/${this.clubId}`).update({
                    usedBudget: club.usedBudget,
                    prizeUsed: club.prizeUsed || 0
                }).catch(() => {});
            }
        }

        // Reset current session
        this.expenseItems = [];
        this.attendees = [];
        this.memberCount = 0;
        this.previousPrizeTotal = this.clubId && this.clubRegistry[this.clubId]
            ? (this.clubRegistry[this.clubId].prizeUsed || 0)
            : 0;
        this.lastCalculatedSelfPay = 0;
        this.eventPhotos = [];
        this.editingItemId = null;
        this.editingAttendeeId = null;
        const _sdi = document.getElementById('settlement-date-input');
        if (_sdi) _sdi.value = new Date().toISOString().slice(0, 10);
        if (typeof window._onSettleDateReset === 'function') window._onSettleDateReset();

        this.save();
        this.render();
    },

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, "&amp;")
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;")
                  .replace(/"/g, "&quot;")
                  .replace(/'/g, "&#039;");
    }
};

// --- 4. Event Listeners & Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // 언어 설정 초기 적용
    if (typeof applyTranslations === 'function') applyTranslations();


    // 현재 정산 초기화 버튼
    const resetSessionBtn = document.getElementById('reset-session-btn');
    const resetSessionModal = document.getElementById('reset-session-modal');
    const resetSessionConfirmBtn = document.getElementById('reset-session-confirm-btn');
    const resetSessionCancelBtn = document.getElementById('reset-session-cancel-btn');
    if (resetSessionBtn && resetSessionModal) {
        resetSessionBtn.addEventListener('click', () => resetSessionModal.classList.remove('hidden'));
        resetSessionCancelBtn.addEventListener('click', () => resetSessionModal.classList.add('hidden'));
        resetSessionModal.addEventListener('click', (e) => {
            if (e.target === resetSessionModal) resetSessionModal.classList.add('hidden');
        });
        resetSessionConfirmBtn.addEventListener('click', () => {
            resetSessionModal.classList.add('hidden');
            AppState.expenseItems = [];
            AppState.attendees = [];
            AppState.memberCount = 0;
            AppState.previousPrizeTotal = 0;
            AppState.lastCalculatedSelfPay = 0;
            AppState.eventPhotos = [];
            document.getElementById('expense-desc-input').value = '';
            document.getElementById('expense-amount-input').value = '';
            document.getElementById('expense-category-select').selectedIndex = 0;
            document.getElementById('expense-corp-check').checked = true;
            document.getElementById('expense-personal-check').checked = false;
            document.getElementById('expense-corporate-amount-input').value = '';
            document.getElementById('expense-personal-amount-input').value = '';
            document.getElementById('prev-prize-input').value = 0;
            if (typeof updateCardTypeUI === 'function') updateCardTypeUI();
            const settleDateEl = document.getElementById('settlement-date-input');
            if (settleDateEl) settleDateEl.value = new Date().toISOString().slice(0, 10);
            if (typeof window._onSettleDateReset === 'function') window._onSettleDateReset();
            AppState.save();
            AppState.render();
        });
    }

    // 정산 날짜 입력 필드 오늘 날짜로 초기화
    const settleDateEl = document.getElementById('settlement-date-input');
    if (settleDateEl) settleDateEl.value = new Date().toISOString().slice(0, 10);
    if (typeof window._onSettleDateReset === 'function') window._onSettleDateReset();

    // PIN 키패드 클릭이 항상 동작하도록 가장 먼저 위임 방식으로 등록
    // (이후 초기화 코드에서 오류가 발생해도 키패드 입력은 막히지 않음)
    document.addEventListener('click', (e) => {
        const key = e.target.closest && e.target.closest('.pin-key');
        if (key) {
            try {
                handlePinKeyPress(key.getAttribute('data-value'));
            } catch (err) {
                console.error('PIN 키패드 처리 오류:', err);
            }
        }
    });

    // Load state from local storage
    AppState.load();

    // 번들된 전사원 데이터 중 아직 명부에 없는 사람을 자동 등록
    fetch('./lib/employee_directory.json?_=' + Date.now(), { cache: 'no-store' })
        .then(res => res.json())
        .then(list => AppState.bulkImportDirectory(list))
        .catch(err => console.error("전사원 명부 자동 등록 실패:", err));

    // Club name dropdown init
    const clubNameInput = document.getElementById('club-name-select');

    function renderClubOptions() {
        if (!clubNameInput) return;

        // clubId 기준으로 현재 클럽명 갱신 (관리자 이름 변경 반영)
        if (AppState.clubId && AppState.clubRegistry[AppState.clubId]) {
            AppState.clubName = AppState.clubRegistry[AppState.clubId].name;
        }

        const current = AppState.clubName || '';
        const clubs = Object.values(AppState.clubRegistry || {});

        // 현재 선택된 클럽이 레지스트리에 없으면 조용히 초기화만 (팝업 없음)
        // 실제 삭제 감지 및 팝업은 loadClubRegistry의 clubId 기반 로직이 처리
        // — clubId 없는 구버전 데이터 or 이름 변경 직후 타이밍 등에서 오탐 방지
        if (current && !clubs.some(c => c.name === current)) {
            AppState.clubName = '';
            AppState.clubId = '';
            AppState.save();
        }

        clubNameInput.innerHTML = `<option value="">${t('header.club_placeholder')}</option>`;
        clubs.forEach(club => {
            const opt = document.createElement('option');
            opt.value = club.name;
            opt.textContent = club.name;
            clubNameInput.appendChild(opt);
        });
        const newOpt = document.createElement('option');
        newOpt.value = '__new__';
        newOpt.textContent = t('header.club_new');
        clubNameInput.appendChild(newOpt);
        clubNameInput.value = AppState.clubName || '';
    }

    const newClubInputRow = document.getElementById('new-club-input-row');
    const newClubNameInput = document.getElementById('new-club-name-input');
    const registerNewClubBtn = document.getElementById('register-new-club-btn');

    // 클럽이 삭제/미존재 시 팝업 (window에 등록해 AppState 내부에서도 호출 가능)
    window.showClubNotFoundModal = function() {
        const modal = document.getElementById('club-not-found-modal');
        if (modal) modal.classList.remove('hidden');
    };
    const clubNotFoundOkBtn = document.getElementById('club-not-found-ok-btn');
    if (clubNotFoundOkBtn) {
        clubNotFoundOkBtn.addEventListener('click', () => {
            const modal = document.getElementById('club-not-found-modal');
            if (modal) modal.classList.add('hidden');
        });
    }

    // 클럽 레지스트리 실시간 업데이트 콜백 (loadClubRegistry의 on('value') 리스너에서 호출)
    window._onClubRegistryUpdate = () => {
        renderClubOptions();
        if (typeof renderClubManagement === 'function') renderClubManagement();
        if (typeof renderClubHistorySelect === 'function') renderClubHistorySelect();
    };

    if (clubNameInput) {
        renderClubOptions();
        clubNameInput.addEventListener('change', () => {
            if (clubNameInput.value === '__new__') {
                if (newClubInputRow) newClubInputRow.classList.remove('hidden');
                if (newClubNameInput) newClubNameInput.focus();
                return;
            }
            if (newClubInputRow) newClubInputRow.classList.add('hidden');
            if (AppState.clubName !== clubNameInput.value) {
                AppState.clubName = clubNameInput.value;
                const selectedEntry = Object.entries(AppState.clubRegistry || {}).find(([, c]) => c.name === clubNameInput.value);
                AppState.clubId = selectedEntry ? selectedEntry[0] : '';
                // 클럽 전환 시 상품비 누적을 해당 클럽의 확정 누적으로 동기화
                const selectedClub = selectedEntry ? selectedEntry[1] : null;
                AppState.previousPrizeTotal = selectedClub ? (selectedClub.prizeUsed || 0) : 0;
                if (prizeInput) prizeInput.value = formatAmount(AppState.previousPrizeTotal);
                AppState.usedBudget = 0;
                AppState.clubHistory = [];
                AppState.clearClubData();
            }
            AppState.syncBudgetFromClub(AppState.clubName);
            AppState.save();
            setSettingsFormValues(AppState.rules);
            // 클럽 전환 시 globalHistory에서 전체 이력 로드 → 잔여 예산 즉시 반영
            AppState.loadClubHistory().then(() => AppState.render());
            if (typeof setAdminRulesFormValues === 'function') setAdminRulesFormValues(AppState.rules);
        });

        if (AppState.firebaseDb) {
            AppState.loadClubRegistry().then(() => {
                renderClubOptions();
            });
        }
    }

    if (registerNewClubBtn) {
        registerNewClubBtn.addEventListener('click', () => {
            const name = (newClubNameInput.value || '').trim();
            if (!name) {
                alert(t('alert.enter_club_name'));
                return;
            }
            const _clubNameKey = name.trim().toLowerCase();
            let newClubId = Object.entries(AppState.clubRegistry || {}).find(([, c]) => (c.name || '').trim().toLowerCase() === _clubNameKey)?.[0];
            if (!newClubId) {
                newClubId = 'club_' + Date.now();
                AppState.addOrUpdateClub(newClubId, name, 0);
            }
            AppState.clubName = name;
            AppState.clubId = newClubId;
            AppState.clearClubData();
            AppState.syncBudgetFromClub(name);
            AppState.save();
            newClubNameInput.value = '';
            newClubInputRow.classList.add('hidden');

            const finish = () => {
                renderClubOptions();
                setSettingsFormValues(AppState.rules);
            if (typeof setAdminRulesFormValues === 'function') setAdminRulesFormValues(AppState.rules);
            };
            if (AppState.firebaseDb) {
                AppState.loadClubRegistry().then(finish);
            } else {
                finish();
            }
        });
    }

    // 관리자 자부담 구간/비율 변경 시 전체 유저 실시간 반영
    window._onGlobalSettingsUpdate = () => {
        if (typeof setSettingsFormValues === 'function') setSettingsFormValues(AppState.rules);
        if (typeof setAdminRulesFormValues === 'function') setAdminRulesFormValues(AppState.rules);
        AppState.render();
    };
    AppState.loadGlobalSettings();

    // 수정 모드 완료 버튼 — 파일 다운로드 없이 데이터만 저장 (모바일 다운로드 차단 우회)
    const editModeDoneBtn = document.getElementById('edit-mode-done-btn');
    if (editModeDoneBtn) {
        editModeDoneBtn.addEventListener('click', async () => {
            if (!AppState.editingHistoryId) return;
            editModeDoneBtn.disabled = true;
            editModeDoneBtn.textContent = '⏳ 저장 중...';
            try {
                const result = SettlementCalculator.calculate(
                    AppState.memberCount, AppState.expenseItems, AppState.previousPrizeTotal, AppState.rules
                );
                const finalTotalSelfPay = AppState.lastCalculatedSelfPay > 0
                    ? AppState.lastCalculatedSelfPay : result.totalSelfPay;
                const _sdi = document.getElementById('settlement-date-input');
                const settlementDate = (_sdi && _sdi.value)
                    ? _sdi.value : new Date().toISOString().slice(0, 10);
                const updatedFields = {
                    memberCount: AppState.memberCount,
                    totalCost: result.totalCost,
                    finalSupportAmount: result.totalCost - finalTotalSelfPay,
                    totalSelfPay: finalTotalSelfPay,
                    perPersonSelfPay: AppState.memberCount > 0
                        ? Math.round(finalTotalSelfPay / AppState.memberCount)
                        : result.perPersonSelfPay,
                    selfPayRatio: result.totalCost > 0 ? finalTotalSelfPay / result.totalCost : 0,
                    expenseItems: JSON.parse(JSON.stringify(AppState.expenseItems)),
                    attendees: JSON.parse(JSON.stringify(AppState.attendees)),
                    clubName: AppState.clubName,
                    clubId: AppState.clubId || '',
                    settlementDate,
                };
                await AppState.updateHistoryEntry(AppState.editingHistoryId, updatedFields);
                AppState.cancelEditMode();
                AppState.render();
                alert('수정 내용이 저장되었습니다.\n엑셀 파일이 필요하면 정산 이력에서 수정 후 다운로드하세요.');
            } catch (err) {
                console.error(err);
                alert('수정 저장 중 오류가 발생했습니다: ' + (err.message || ''));
            } finally {
                editModeDoneBtn.disabled = false;
                editModeDoneBtn.textContent = '✅ 수정 완료';
            }
        });
    }

    // 수정 모드 취소 버튼
    const editModeCancelBtn = document.getElementById('edit-mode-cancel-btn');
    if (editModeCancelBtn) {
        editModeCancelBtn.addEventListener('click', () => {
            AppState.cancelEditMode();
            AppState.render();
        });
    }

    // Set form input fields default values
    const memberInput = document.getElementById('member-count-input');
    const prizeInput = document.getElementById('prev-prize-input');

    memberInput.value = AppState.memberCount;
    prizeInput.value = formatAmount(AppState.previousPrizeTotal);

    // 금액 입력란 1000단위 콤마(,) 자동 적용
    ['expense-amount-input', 'expense-corporate-amount-input',
     'expense-personal-amount-input', 'setting-used-budget', 'result-total-self-pay-input',
     'admin-setting-limit1', 'admin-setting-limit2', 'admin-setting-limit3', 'admin-setting-deduction4', 'admin-setting-prize-limit',
     'club-total-budget-input', 'club-budget-form-input'].forEach(id => {
        setupCurrencyInput(document.getElementById(id));
    });

    // Settings panel: init budget fields from saved state
    const annualBudgetInput = document.getElementById('setting-annual-budget');
    const usedBudgetInput = document.getElementById('setting-used-budget');
    const remainingDisplay = document.getElementById('setting-remaining-display');

    // Set settings form input values
    const setSettingsFormValues = (rules) => {
        const annualInput = document.getElementById('setting-annual-budget');
        const usedInput = document.getElementById('setting-used-budget');
        if (annualInput) annualInput.value = formatAmount(AppState.getClubBudget());
        if (usedInput) usedInput.value = formatAmount(AppState.getClubUsedBudget());
        if (typeof updateRemainingDisplay === 'function') {
            updateRemainingDisplay();
        }
    };
    setSettingsFormValues(AppState.rules);

    // Initial Datalist rendering
    AppState.updateDatalist();

    // Tab navigation switching logic
    document.querySelectorAll('.tab-nav .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));

            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.remove('hidden');

            // 관리자 탭 전환 시: globalHistory 최신화 (대시보드·클럽이력·차트 공통)
            if ((tabId === 'tab-admin' || tabId === 'tab-club-history' || tabId === 'tab-charts') && typeof renderAdminDashboard === 'function') {
                renderAdminDashboard();
            }
            // 이력 탭 전환 시: 동일 클럽의 전체 사용자 이력 로드
            if (tabId === 'tab-history') {
                AppState.loadClubHistory().then(() => AppState.render());
            }
            // 차트 탭 전환 시: 숨겨진 상태에서 렌더링 불가 → 탭이 보인 후 재렌더
            if (tabId === 'tab-charts' && typeof renderAllCharts === 'function') {
                requestAnimationFrame(() => {
                    if (typeof renderClubFilters === 'function') renderClubFilters();
                    renderAllCharts(lastHistoryList || []);
                });
            }
        });
    });

    // Attendee autocomplete — 커스텀 드롭다운 (동명이인 사번 선택 지원)
    const attendeeNameInput = document.getElementById('attendee-name-input');
    const attendeeIdInput = document.getElementById('attendee-id-input');
    const attendeeDropdown = document.getElementById('attendee-name-dropdown');

    function hideAttendeeDropdown() {
        if (attendeeDropdown) attendeeDropdown.classList.add('hidden');
    }

    // 동명이인 사번 선택 팝업
    function showEmpIdPickerPopup(name, entries, onSelect) {
        const existing = document.getElementById('emp-id-picker-popup');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'emp-id-picker-popup';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;';

        const box = document.createElement('div');
        box.style.cssText = 'background:var(--bg-card,#1e1e2e);border:1px solid var(--border,#444);border-radius:14px;padding:1.4rem 1.6rem;min-width:240px;max-width:320px;box-shadow:0 12px 40px rgba(0,0,0,0.5);';

        const title = document.createElement('p');
        title.style.cssText = 'font-size:0.88rem;font-weight:700;margin:0 0 1rem;color:var(--color-secondary,#a855f7);';
        title.textContent = `"${name}" 동명이인 — 사번을 선택하세요`;
        box.appendChild(title);

        entries.forEach(entry => {
            const btn = document.createElement('button');
            btn.style.cssText = 'display:block;width:100%;margin-bottom:0.5rem;padding:0.65rem 0.9rem;background:var(--bg-input,#2a2a3e);border:1px solid var(--border,#444);border-radius:8px;color:var(--text-primary,#eee);font-size:0.88rem;text-align:left;cursor:pointer;transition:background 0.15s;';
            btn.innerHTML = `<span style="font-weight:600;">${AppState.escapeHtml(entry.name)}</span><span style="color:var(--text-secondary,#888);margin-left:0.5rem;">EMP ID: ${AppState.escapeHtml(entry.id)}</span>`;
            btn.addEventListener('mouseenter', () => btn.style.background = 'var(--color-secondary-light,rgba(168,85,247,0.18))');
            btn.addEventListener('mouseleave', () => btn.style.background = 'var(--bg-input,#2a2a3e)');
            btn.addEventListener('click', () => { onSelect(entry); overlay.remove(); });
            box.appendChild(btn);
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = 'display:block;width:100%;margin-top:0.4rem;padding:0.5rem;background:transparent;border:1px solid var(--border,#444);color:var(--text-secondary,#888);border-radius:8px;cursor:pointer;font-size:0.82rem;';
        cancelBtn.textContent = '취소';
        cancelBtn.addEventListener('click', () => overlay.remove());
        box.appendChild(cancelBtn);

        overlay.appendChild(box);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    function showAttendeeDropdown(entries) {
        if (!attendeeDropdown) return;
        attendeeDropdown.innerHTML = '';
        entries.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'attendee-dropdown-item';
            const hasDupe = entries.filter(e => e.name === entry.name).length > 1;
            item.textContent = hasDupe ? `${entry.name} (사번: ${entry.id})` : entry.name;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                attendeeNameInput.value = entry.name;
                attendeeIdInput.value = entry.id;
                hideAttendeeDropdown();
            });
            attendeeDropdown.appendChild(item);
        });
        attendeeDropdown.classList.remove('hidden');
    }

    attendeeNameInput.addEventListener('input', () => {
        const query = attendeeNameInput.value.trim();
        if (!query) { hideAttendeeDropdown(); return; }

        const matches = AppState.getAllDirectoryMatches(query);
        if (matches.length === 0) { hideAttendeeDropdown(); return; }

        const exactMatches = matches.filter(m => m.name === query);
        if (exactMatches.length === 1) {
            // 단일 → 사번 자동 입력
            attendeeIdInput.value = exactMatches[0].id;
            hideAttendeeDropdown();
            return;
        }
        if (exactMatches.length > 1) {
            // 동명이인 → 팝업 선택
            hideAttendeeDropdown();
            showEmpIdPickerPopup(query, exactMatches, (entry) => {
                attendeeNameInput.value = entry.name;
                attendeeIdInput.value = entry.id;
            });
            return;
        }
        // 부분 일치 → 인라인 드롭다운 제안
        showAttendeeDropdown(matches.slice(0, 8));
    });

    attendeeNameInput.addEventListener('blur', () => {
        setTimeout(hideAttendeeDropdown, 150);
    });

    function showAttendeeError(msg) {
        const el = document.getElementById('attendee-error-msg');
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('hidden');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.add('hidden'), 3500);
    }

    function trySubmitAttendee() {
        const name = attendeeNameInput.value.trim();
        const id = attendeeIdInput.value.trim();
        if (!name) { showAttendeeError('이름을 입력해 주세요.'); return; }
        if (!id) { showAttendeeError('사번(EMP ID)은 필수입니다.'); return; }

        if (AppState.editingAttendeeId === null) {
            const isDuplicate = AppState.attendees.some(att => att.name === name && att.employeeId === id);
            if (isDuplicate) {
                showAttendeeError(`이미 등록된 참석자입니다: ${name} (사번: ${id})`);
                return;
            }
        }
        AppState.addAttendee(name, id);
    }

    // Add Attendee Form submission
    const attendeeForm = document.getElementById('attendee-form');
    attendeeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        trySubmitAttendee();
    });

    // Enter key on each input submits attendee form
    [attendeeNameInput, attendeeIdInput].forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                trySubmitAttendee();
            }
        });
    });

    // Cancel edit attendee listener
    const cancelEditAttendeeBtn = document.getElementById('cancel-edit-attendee-btn');
    if (cancelEditAttendeeBtn) {
        cancelEditAttendeeBtn.addEventListener('click', () => {
            AppState.cancelEditAttendee();
        });
    }

    // Add Directory database form handlers
    const dirForm = document.getElementById('dir-form');
    const dirNameInput = document.getElementById('dir-name-input');
    const dirIdInput = document.getElementById('dir-id-input');

    function showDirError(msg) {
        const el = document.getElementById('dir-error-msg');
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('hidden');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.add('hidden'), 3500);
    }

    const dirExistingIdHint = document.getElementById('dir-existing-id-hint');
    const dirSamePersonWarning = document.getElementById('dir-same-person-warning');

    function getExistingIds(name) {
        const entry = AppState.directory[name];
        if (!entry) return [];
        if (typeof entry === 'object' && Array.isArray(entry.ids)) return entry.ids.map(String);
        return [String(typeof entry === 'object' ? entry.id : entry)];
    }

    function updateDirNameHint() {
        const name = dirNameInput.value.trim();
        const currentId = dirIdInput.value.trim();
        const existingIds = name ? getExistingIds(name) : [];

        if (existingIds.length === 1) {
            // 단일 → EMP ID 자동 입력
            if (!currentId) dirIdInput.value = existingIds[0];
            dirExistingIdHint.textContent = `등록된 EMP ID: ${existingIds[0]}`;
            dirExistingIdHint.classList.remove('hidden');
            const showWarning = AppState.editingDirName === null && dirIdInput.value !== '' && !existingIds.includes(dirIdInput.value);
            dirSamePersonWarning.classList.toggle('hidden', !showWarning);
        } else if (existingIds.length > 1) {
            // 동명이인 → 팝업으로 사번 선택 (EMP ID 빈 경우)
            dirExistingIdHint.textContent = `동명이인 ${existingIds.length}명 (EMP ID: ${existingIds.join(', ')})`;
            dirExistingIdHint.classList.remove('hidden');
            dirSamePersonWarning.classList.add('hidden');
            if (!currentId) {
                showEmpIdPickerPopup(name, existingIds.map(id => ({ name, id })), (entry) => {
                    dirIdInput.value = entry.id;
                    updateDirNameHint();
                });
            }
        } else {
            dirExistingIdHint.classList.add('hidden');
            dirSamePersonWarning.classList.add('hidden');
        }
    }

    function trySubmitDir() {
        const name = dirNameInput.value.trim();
        const id = dirIdInput.value.trim();
        if (!name || !id) return;

        if (AppState.editingDirName === null) {
            const existingIds = getExistingIds(name);
            if (existingIds.includes(id)) {
                showDirError(`이미 동일한 이름과 EMP ID로 등록되어 있습니다: ${name} (${id})`);
                return;
            }
        }
        AppState.addDirectoryEntry(name, id);
        dirSamePersonWarning.classList.add('hidden');
        dirExistingIdHint.classList.add('hidden');
    }


    if (dirForm) {
        dirForm.addEventListener('submit', (e) => {
            e.preventDefault();
            trySubmitDir();
        });

        [dirNameInput, dirIdInput].forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    trySubmitDir();
                }
            });
        });

        dirNameInput.addEventListener('input', updateDirNameHint);
        dirIdInput.addEventListener('input', updateDirNameHint);
    }

    const cancelEditDirBtn = document.getElementById('cancel-edit-dir-btn');
    if (cancelEditDirBtn) {
        cancelEditDirBtn.addEventListener('click', () => {
            AppState.cancelEditDirectory();
        });
    }

    // Clear attendees handler
    document.getElementById('clear-attendees-btn').addEventListener('click', () => {
        if (AppState.attendees.length > 0) {
            if (confirm(t('confirm.clear_all_attendees'))) {
                AppState.clearAttendees();
            }
        }
    });

    // Toggle settings panel handler
    document.getElementById('toggle-settings-btn').addEventListener('click', () => {
        const panel = document.getElementById('settings-panel');
        panel.classList.toggle('hidden');
    });

    // Save settings handler (usedBudget은 정산 이력에서 자동 계산되므로 저장 불필요)
    document.getElementById('save-settings-btn').addEventListener('click', () => {
        AppState.save();
        AppState.render();
        if (typeof updateRemainingDisplay === 'function') updateRemainingDisplay();

        // Hide panel after saving
        document.getElementById('settings-panel').classList.add('hidden');
    });

    // Admin: 정산 구간/비율 설정 폼 값 채우기
    const setAdminRulesFormValues = (rules) => {
        document.getElementById('admin-setting-limit1').value = formatAmount(rules.limit1);
        document.getElementById('admin-setting-limit2').value = formatAmount(rules.limit2);
        document.getElementById('admin-setting-rate2').value = Math.round(rules.rate2 * 100);
        document.getElementById('admin-setting-limit3').value = formatAmount(rules.limit3);
        document.getElementById('admin-setting-rate3').value = Math.round(rules.rate3 * 100);
        document.getElementById('admin-setting-deduction4').value = formatAmount(rules.deduction4);
        const prizeLimitEl = document.getElementById('admin-setting-prize-limit');
        if (prizeLimitEl) prizeLimitEl.value = formatAmount(rules.prizeLimit || 500000);
        const facilityLimitEl = document.getElementById('admin-setting-facility-limit');
        if (facilityLimitEl) facilityLimitEl.value = formatAmount(rules.facilityLimit || 85000);
    };
    setAdminRulesFormValues(AppState.rules);

    // Admin: 정산 비율 저장 (전체 클럽 공통 적용)
    const adminSaveRulesBtn = document.getElementById('admin-save-rules-btn');
    if (adminSaveRulesBtn) {
        adminSaveRulesBtn.addEventListener('click', () => {
            const limit1 = parseAmount(document.getElementById('admin-setting-limit1').value);
            const limit2 = parseAmount(document.getElementById('admin-setting-limit2').value);
            const rate2 = (parseInt(document.getElementById('admin-setting-rate2').value, 10) || 0) / 100;
            const limit3 = parseAmount(document.getElementById('admin-setting-limit3').value);
            const rate3 = (parseInt(document.getElementById('admin-setting-rate3').value, 10) || 0) / 100;
            const deduction4 = parseAmount(document.getElementById('admin-setting-deduction4').value);
            const prizeLimitEl = document.getElementById('admin-setting-prize-limit');
            const prizeLimit = prizeLimitEl ? (parseAmount(prizeLimitEl.value) || 500000) : 500000;
            const facilityLimitEl = document.getElementById('admin-setting-facility-limit');
            const facilityLimit = facilityLimitEl ? (parseAmount(facilityLimitEl.value) || 85000) : 85000;
            AppState.updateRules({ limit1, limit2, rate2, limit3, rate3, deduction4, prizeLimit, facilityLimit });
            alert(t('alert.rules_saved'));
        });
    }

    // Admin: 정산 비율 기본값 복원
    const adminResetRulesBtn = document.getElementById('admin-reset-rules-btn');
    if (adminResetRulesBtn) {
        adminResetRulesBtn.addEventListener('click', () => {
            if (confirm(t('confirm.reset_rules'))) {
                AppState.resetRules();
                setAdminRulesFormValues(AppState.rules);
            }
        });
    }

    // 상품비 누적액 표시 갱신 (현재 세션 PRIZE 항목 합계 → prizeInput 반영)
    // previousPrizeTotal은 클럽 레지스트리(prizeUsed)에서 관리하므로 여기서 건드리지 않음
    function syncPrizeTotalFromItems() {
        const sessionPrize = (AppState.expenseItems || [])
            .filter(item => item.category === ExpenseCategory.PRIZE)
            .reduce((sum, item) => sum + (item.amount || 0), 0);
        // prizeInput: 현재 세션 상품비 + 확정 누적 합계 표시
        const totalDisplay = (AppState.previousPrizeTotal || 0) + sessionPrize;
        if (prizeInput) prizeInput.value = totalDisplay > 0 ? formatAmount(totalDisplay) : '0';
        AppState.render();
    }
    window._syncPrizeTotalFromItems = syncPrizeTotalFromItems;
    syncPrizeTotalFromItems();

    // Form submission listener
    const form = document.getElementById('expense-form');
    const descInput = document.getElementById('expense-desc-input');
    const amountInput = document.getElementById('expense-amount-input');
    const catSelect = document.getElementById('expense-category-select');

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const description = descInput.value.trim();
        const amount = parseAmount(amountInput.value);
        const category = catSelect.value;
        const corpChecked = document.getElementById('expense-corp-check').checked;
        const personalChecked = document.getElementById('expense-personal-check').checked;
        const corporateAmount = parseAmount(document.getElementById('expense-corporate-amount-input').value);

        if (description && !isNaN(amount) && amount > 0) {
            // ── 예산 한도 확인: 클럽별 + 전체 총 예산 (EVENT / FACILITY / PRIZE 공통) ──
            const _editingId  = AppState.editingItemId || null;
            const _existItems = (AppState.expenseItems || []).filter(i => i.id !== _editingId);
            const _simItems   = [..._existItems, { category, amount }];
            const _simResult  = SettlementCalculator.calculate(
                AppState.memberCount || 0,
                _simItems,
                AppState.previousPrizeTotal || 0,
                AppState.rules
            );
            const _newSupport = _simResult.finalSupportAmount;

            // ① 클럽 배정 예산 초과 확인
            const _clubBudget = AppState.getClubBudget ? AppState.getClubBudget() : 0;
            if (_clubBudget > 0) {
                const _clubUsed   = AppState.getClubUsedBudget ? AppState.getClubUsedBudget() : 0;
                const _budgetLeft = Math.max(0, _clubBudget - _clubUsed);

                if (_budgetLeft <= 0) {
                    showPrizeModal(
                        `클럽 연간 예산이 모두 소진되었습니다.\n` +
                        `배정 예산: ${_clubBudget.toLocaleString()}원\n` +
                        `사용 금액: ${_clubUsed.toLocaleString()}원\n` +
                        `더 이상 비용을 추가할 수 없습니다.`,
                        null, 'block'
                    );
                    return;
                }
                if (_newSupport > _budgetLeft) {
                    showPrizeModal(
                        `입력 금액이 클럽 잔여 예산을 초과합니다.\n` +
                        `잔여 예산: ${_budgetLeft.toLocaleString()}원\n` +
                        `추가 시 지원 예정액: ${_newSupport.toLocaleString()}원\n` +
                        `금액을 줄이거나 항목을 조정해 주세요.`,
                        null, 'block'
                    );
                    return;
                }
            }

            // ② 전체 총 예산 초과 확인
            const _totalBudget = AppState.clubTotalBudget || 0;
            if (_totalBudget > 0) {
                const _allUsed = Object.values(AppState.clubRegistry || {})
                    .reduce((sum, c) => sum + (c.usedBudget || 0), 0);
                const _allPriorUsed = Object.values(AppState.clubRegistry || {})
                    .reduce((sum, c) => sum + (c.priorUsed || 0), 0);
                const _totalUsed = _allPriorUsed + _allUsed;
                const _totalLeft = Math.max(0, _totalBudget - _totalUsed);

                if (_totalLeft <= 0) {
                    showPrizeModal(
                        `전체 클럽 총 예산이 모두 소진되었습니다.\n` +
                        `총 예산: ${_totalBudget.toLocaleString()}원\n` +
                        `총 사용액: ${_totalUsed.toLocaleString()}원\n` +
                        `더 이상 비용을 추가할 수 없습니다.`,
                        null, 'block'
                    );
                    return;
                }
                if (_newSupport > _totalLeft) {
                    showPrizeModal(
                        `입력 금액이 전체 클럽 총 잔여 예산을 초과합니다.\n` +
                        `총 잔여 예산: ${_totalLeft.toLocaleString()}원\n` +
                        `추가 시 지원 예정액: ${_newSupport.toLocaleString()}원\n` +
                        `금액을 줄이거나 항목을 조정해 주세요.`,
                        null, 'block'
                    );
                    return;
                }
            }
            // ────────────────────────────────────────────────────────────────

            // 상품비 검증 (개인카드 사용 불가, 50만원 한도, 클럽 예산 내)
            if (category === ExpenseCategory.PRIZE) {
                const editingId = AppState.editingItemId || null;
                const existingPrize = (AppState.expenseItems || [])
                    .filter(i => i.category === ExpenseCategory.PRIZE && i.id !== editingId)
                    .reduce((s, i) => s + (i.amount || 0), 0);
                const prizeLimit = AppState.rules.prizeLimit || 500000;
                const prizeRemaining = prizeLimit - existingPrize - (AppState.previousPrizeTotal || 0);

                if (prizeRemaining <= 0) {
                    showPrizeModal('상품비 연 한도 50만원을 모두 사용했습니다.\n더 이상 추가할 수 없습니다.', null, 'block');
                    return;
                }
                if (amount > prizeRemaining) {
                    showPrizeModal(`상품비 연 한도 50만원을 초과할 수 없습니다.\n최대 ${prizeRemaining.toLocaleString()}원까지 입력 가능합니다.`, () => {
                        amountInput.value = formatAmount(prizeRemaining);
                        autoSetTogglesAndCorp(); updateCardTypeUI();
                    }, 'warn');
                    return;
                }
                // 클럽 예산 잔여 확인 (상품비도 클럽 예산에서 지출)
                const corpAvail = _calcCorpForItem(amount, category);
                if (corpAvail < amount) {
                    const clubBudget = AppState.getClubBudget ? AppState.getClubBudget() : 0;
                    const clubUsed = AppState.getClubUsedBudget ? AppState.getClubUsedBudget() : 0;
                    const budgetLeft = Math.max(0, clubBudget - clubUsed);
                    showPrizeModal(`클럽 잔여 예산이 부족합니다.\n잔여 예산: ${budgetLeft.toLocaleString()}원\n상품비는 클럽 예산 내에서만 지출 가능합니다.`, null, 'block');
                    return;
                }
            }
            AppState.addExpense(description, amount, category, corpChecked, personalChecked, corporateAmount);
            syncPrizeTotalFromItems();
            descInput.focus();
        }
    });

    // Card type checkbox listeners
    const corpCheck = document.getElementById('expense-corp-check');
    const personalCheck = document.getElementById('expense-personal-check');
    const corporateAmountInput = document.getElementById('expense-corporate-amount-input');
    const personalAmountInput = document.getElementById('expense-personal-amount-input');
    if (corpCheck) corpCheck.addEventListener('change', () => { resetCorpAmount(); updateCardTypeUI(); });
    if (personalCheck) personalCheck.addEventListener('change', updateCardTypeUI);
    if (corporateAmountInput) {
        corporateAmountInput.addEventListener('input', updateCardTypeUI);
    }
    // 총액·카테고리 변경 → 토글 자동 설정 + 구간별 법인카드 계산 후 UI 갱신
    amountInput.addEventListener('input', () => { autoSetTogglesAndCorp(); updateCardTypeUI(); });
    if (catSelect) catSelect.addEventListener('change', () => {
        // 시설·장비 선택 시 사전 승인 여부 확인
        if (catSelect.value === ExpenseCategory.FACILITY) {
            _facilityApproved = false;
            showFacilityApprovalModal(
                () => {
                    // 승인 완료 → FACILITY 유지, 법인카드 최대 85,000원
                    _facilityApproved = true;
                    autoSetTogglesAndCorp(); updateCardTypeUI();
                },
                () => {
                    // 승인 없음 → 행사비(EVENT)로 변경
                    _facilityApproved = false;
                    catSelect.value = ExpenseCategory.EVENT;
                    autoSetTogglesAndCorp(); updateCardTypeUI();
                }
            );
            return;
        }
        // 다른 카테고리로 변경 시 승인 플래그 초기화
        _facilityApproved = false;
        if (catSelect.value === ExpenseCategory.PRIZE) {
            const memberCount = AppState.memberCount || 0;
            const editingId = AppState.editingItemId || null;
            const existingPrize = (AppState.expenseItems || [])
                .filter(i => i.category === ExpenseCategory.PRIZE && i.id !== editingId)
                .reduce((s, i) => s + (i.amount || 0), 0);
            const prizeLimit = AppState.rules.prizeLimit || 500000;
            const remaining = prizeLimit - existingPrize - (AppState.previousPrizeTotal || 0);

            if (memberCount < 10) {
                showPrizeModal('10명 이상일 경우에만 사용 가능합니다.', () => {
                    catSelect.value = ExpenseCategory.EVENT;
                    autoSetTogglesAndCorp(); updateCardTypeUI();
                }, 'block');
                return;
            }
            if (remaining <= 0) {
                showPrizeModal('상품비 연 한도 50만원을 모두 사용했습니다.\n더 이상 상품비를 추가할 수 없습니다.', () => {
                    catSelect.value = ExpenseCategory.EVENT;
                    autoSetTogglesAndCorp(); updateCardTypeUI();
                }, 'block');
                return;
            }
            const priorSettled = AppState.previousPrizeTotal || 0;
            const infoMsg = (existingPrize === 0 && priorSettled === 0)
                ? `참석자가 10명 이상일 때만 상품비를 사용할 수 있습니다.\n상품비는 한 해에 최대 ${prizeLimit.toLocaleString()}원까지 사용 가능합니다.`
                : `참석자가 10명 이상일 때만 상품비를 사용할 수 있습니다.\n올해 남은 상품비 한도는 ${remaining.toLocaleString()}원입니다.`;
            showPrizeModal(infoMsg, () => { autoSetTogglesAndCorp(); updateCardTypeUI(); }, 'info');
            return;
        }
        autoSetTogglesAndCorp(); updateCardTypeUI();
    });
    updateCardTypeUI();

    // Cancel edit listener
    document.getElementById('cancel-edit-btn').addEventListener('click', () => {
        AppState.cancelEdit();
    });

    // clear-all-btn removed from UI (v1.6.83)

    // 법인카드/개인카드 영수증 업로드
    const setupSplitReceiptInput = (inputId, statusId, deleteBtnId, stateKey) => {
        const input = document.getElementById(inputId);
        const status = document.getElementById(statusId);
        const deleteBtn = document.getElementById(deleteBtnId);
        if (!input || !status) return;

        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                status.textContent = "⌛ 영수증 압축 중...";
                status.classList.remove('hidden');
                compressReceiptImage(file, (compressedBase64) => {
                    AppState[stateKey] = compressedBase64;
                    status.textContent = "✓ 영수증 대기 완료";
                    if (deleteBtn) deleteBtn.classList.remove('hidden');
                });
            } else {
                AppState[stateKey] = null;
                status.classList.add('hidden');
                if (deleteBtn) deleteBtn.classList.add('hidden');
            }
        });

        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                AppState[stateKey] = null;
                status.classList.add('hidden');
                input.value = '';
                deleteBtn.classList.add('hidden');
            });
        }
    };

    setupSplitReceiptInput('expense-receipt-corp-input', 'receipt-corp-status', 'delete-receipt-corp-btn', 'tempCorpReceiptImage');
    setupSplitReceiptInput('expense-receipt-personal-input', 'receipt-personal-status', 'delete-receipt-personal-btn', 'tempPersonalReceiptImage');

    // Lightbox modal close handler
    const receiptModal = document.getElementById('receipt-modal');
    if (receiptModal) {
        const closeBtn = receiptModal.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                receiptModal.classList.add('hidden');
            });
        }
        receiptModal.addEventListener('click', (e) => {
            if (e.target === receiptModal) {
                receiptModal.classList.add('hidden');
            }
        });
    }

    // Email modal actions
    const emailReportModal = document.getElementById('email-report-modal');
    const sendEmailBtn = document.getElementById('send-email-btn');
    const closeEmailModal = document.getElementById('close-email-modal');
    const downloadExcelBtn = document.getElementById('download-excel-btn');
    const triggerMailtoBtn = document.getElementById('trigger-mailto-btn');

    if (sendEmailBtn) {
        sendEmailBtn.addEventListener('click', () => {
            showConfirmModal(
                '엑셀 파일로 저장하고 정산을 완료하시겠습니까?\n확인 시 현재 데이터가 초기화됩니다.',
                async () => {
                    const originalText = sendEmailBtn.innerHTML;
                    sendEmailBtn.innerHTML = `<span class='btn-icon'>⏳</span> ${t('state.generating')}`;
                    sendEmailBtn.disabled = true;
                    try {
                        await AppState.downloadExcelOnly();
                        sendEmailBtn.innerHTML = `<span class='btn-icon'>✓</span> ${t('state.saved')}`;
                        const todayStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
                        runFinalizeSettlement(true);
                        alert(
                            `📂 ${todayStr} 정산 엑셀 파일이 생성되어 다운로드 폴더에 저장되었습니다.\n\n` +
                            `✅ 전체 항목이 초기화되었습니다.\n` +
                            `📧 저장된 파일을 이메일로 보내주세요.\n` +
                            `📋 이번 정산 내역은 [정산 이력] 탭에서 확인하실 수 있습니다.`
                        );
                    } catch (err) {
                        console.error(err);
                        sendEmailBtn.innerHTML = `<span class='btn-icon'>❌</span> ${t('state.save_failed')}`;
                    } finally {
                        setTimeout(() => {
                            sendEmailBtn.innerHTML = originalText;
                            sendEmailBtn.disabled = false;
                        }, 2000);
                    }
                },
                '확인'
            );
        });
    }

    if (closeEmailModal && emailReportModal) {
        closeEmailModal.addEventListener('click', () => {
            emailReportModal.classList.add('hidden');
        });
        emailReportModal.addEventListener('click', (e) => {
            if (e.target === emailReportModal) {
                emailReportModal.classList.add('hidden');
            }
        });
    }

    function runFinalizeSettlement(skipConfirm = false) {
        AppState.finalizeSettlement(skipConfirm);
        if (emailReportModal) emailReportModal.classList.add('hidden');
        // Reset form UI state
        document.getElementById('expense-desc-input').value = '';
        document.getElementById('expense-amount-input').value = '';
        document.getElementById('expense-category-select').selectedIndex = 0;
        document.getElementById('expense-corp-check').checked = true;
        document.getElementById('expense-personal-check').checked = false;
        document.getElementById('expense-corporate-amount-input').value = '';
        document.getElementById('expense-personal-amount-input').value = '';
        updateCardTypeUI();
        document.getElementById('prev-prize-input').value = 0;
        // Switch to history tab
        document.querySelectorAll('.tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        const histTab = document.querySelector('[data-tab="tab-history"]');
        if (histTab) { histTab.classList.add('active'); document.getElementById('tab-history').classList.remove('hidden'); }
    }

    const finalizeBtn = document.getElementById('finalize-settlement-btn');
    if (finalizeBtn) {
        finalizeBtn.addEventListener('click', runFinalizeSettlement);
    }


    if (downloadExcelBtn) {
        downloadExcelBtn.addEventListener('click', async () => {
            const originalText = downloadExcelBtn.innerHTML;
            downloadExcelBtn.innerHTML = `<span class='btn-icon'>⏳</span> ${t('state.generating')}`;
            downloadExcelBtn.disabled = true;
            try {
                await AppState.downloadExcelOnly();
                downloadExcelBtn.innerHTML = `<span class='btn-icon'>✓</span> ${t('state.downloading')}`;
                const excelSavedModal = document.getElementById('excel-saved-modal');
                if (excelSavedModal) excelSavedModal.classList.remove('hidden');
            } catch (err) {
                console.error(err);
                downloadExcelBtn.innerHTML = `<span class='btn-icon'>❌</span> ${t('state.download_failed')}`;
            } finally {
                setTimeout(() => {
                    downloadExcelBtn.innerHTML = originalText;
                    downloadExcelBtn.disabled = false;
                }, 2000);
            }
        });
    }

    // 엑셀 저장 완료 후 화면 초기화 여부 확인 모달
    const excelSavedModal = document.getElementById('excel-saved-modal');
    const excelSavedResetBtn = document.getElementById('excel-saved-reset-btn');
    const excelSavedKeepBtn = document.getElementById('excel-saved-keep-btn');
    if (excelSavedResetBtn) {
        excelSavedResetBtn.addEventListener('click', () => {
            excelSavedModal.classList.add('hidden');
            runFinalizeSettlement(true);
        });
    }
    if (excelSavedKeepBtn) {
        excelSavedKeepBtn.addEventListener('click', () => {
            excelSavedModal.classList.add('hidden');
        });
    }

    const shareReportBtn = document.getElementById('share-report-btn');
    if (shareReportBtn) {
        shareReportBtn.addEventListener('click', () => {
            AppState.shareSettlementReport();
        });
    }

    if (triggerMailtoBtn) {
        triggerMailtoBtn.addEventListener('click', async () => {
            const receiver = document.getElementById('email-to-field').value;
            const subject = document.getElementById('email-subject-field').value;
            const body = document.getElementById('email-body-field').value;
            const mailtoUrl = `mailto:${encodeURIComponent(receiver)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

            if (window.AndroidShare && typeof window.AndroidShare.shareFiles === 'function') {
                AppState.shareSettlementReport(receiver, subject, body);
                return;
            }

            // 웹: navigator.share로 파일 첨부를 시도하고, 안 되면 파일 다운로드 후 mailto로 본문만 전달
            if (navigator.canShare) {
                try {
                    const files = await AppState.collectReportFiles();
                    if (files.length > 0 && navigator.canShare({ title: subject, text: body, files })) {
                        await navigator.share({ title: subject, text: body, files });
                        return;
                    }
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error(err);
                }
            }

            await AppState.downloadReportFiles();
            window.location.href = mailtoUrl;
        });
    }

    function updateRemainingDisplay() {
        // 항상 관리자 설정 기준 예산 사용 (입력란 값이 아닌 registry 직접 조회)
        const annual = AppState.getClubBudget();
        const used = AppState.getClubUsedBudget();
        if (annualBudgetInput) annualBudgetInput.value = formatAmount(annual);
        if (usedBudgetInput) usedBudgetInput.value = formatAmount(used);
        if (annual > 0) {
            const rem = annual - used;
            if (remainingDisplay) {
                remainingDisplay.textContent = SettlementCalculator.formatCurrency(rem);
                remainingDisplay.style.color = rem >= 0 ? 'var(--color-secondary)' : 'var(--warning-text)';
            }
        } else {
            if (remainingDisplay) {
                remainingDisplay.textContent = '미설정';
                remainingDisplay.style.color = '';
            }
        }
    }

    if (annualBudgetInput) {
        annualBudgetInput.value = formatAmount(AppState.getClubBudget());
        annualBudgetInput.addEventListener('input', updateRemainingDisplay);
    }
    if (usedBudgetInput) {
        usedBudgetInput.value = AppState.usedBudget;
        usedBudgetInput.addEventListener('input', updateRemainingDisplay);
    }
    updateRemainingDisplay();

    // Event photo upload handler (여러 장 지원)
    const eventPhotoInput = document.getElementById('event-photo-input');

    if (eventPhotoInput) {
        eventPhotoInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            if (!files.length) return;
            const slots = new Array(files.length);
            let processed = 0;
            files.forEach((file, idx) => {
                compressReceiptImage(file, (compressed) => {
                    slots[idx] = compressed;
                    processed++;
                    if (processed === files.length) {
                        AppState.eventPhotos.push(...slots);
                        AppState.save();
                        AppState.render();
                    }
                });
            });
            eventPhotoInput.value = '';
        });
    }

    // 개별 사진 삭제 — preview 컨테이너에 위임 방식으로 등록
    const eventPhotoPreviewEl = document.getElementById('event-photo-preview');
    if (eventPhotoPreviewEl) {
        eventPhotoPreviewEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.del-event-photo-btn');
            if (!btn) return;
            const idx = parseInt(btn.dataset.pidx, 10);
            if (!isNaN(idx)) {
                AppState.eventPhotos.splice(idx, 1);
                AppState.save();
                AppState.render();
            }
        });
    }

    // 요청사항 알림 팝업 (관리자용)
    const seenFeedbackKeys = new Set();
    const feedbackPopupQueue = [];
    let feedbackPopupShowing = false;

    function showNextFeedbackPopup() {
        if (feedbackPopupShowing || feedbackPopupQueue.length === 0) return;
        const req = feedbackPopupQueue.shift();
        feedbackPopupShowing = true;

        const popupModal = document.getElementById('feedback-popup-modal');
        const popupBody = document.getElementById('feedback-popup-body');
        const dateStr = req.createdAt ? new Date(req.createdAt).toLocaleString('ko-KR') : '-';
        const photoHtml = req.photo
            ? `<img src="${req.photo}" alt="첨부 사진" style="max-width:100%; max-height:240px; border-radius:8px; margin-top:0.5rem; display:block; object-fit:contain;">`
            : '';
        popupBody.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
                <strong style="font-size:0.95rem;">${AppState.escapeHtml(req.userName || '알 수 없음')}${req.clubName ? ` (${AppState.escapeHtml(req.clubName)})` : ''}</strong>
                <span style="font-size:0.75rem; color:var(--text-muted); white-space:nowrap;">${dateStr}</span>
            </div>
            <p style="font-size:0.9rem; margin:0.6rem 0 0; white-space:pre-wrap;">${AppState.escapeHtml(req.message || '')}</p>
            ${photoHtml}
        `;
        popupModal.classList.remove('hidden');

        const confirmBtn = document.getElementById('feedback-popup-confirm-btn');
        confirmBtn.onclick = () => {
            popupModal.classList.add('hidden');
            feedbackPopupShowing = false;
            if (firebaseDb) {
                firebaseDb.ref(`requests/${req.key}/read`).set(true).then(() => renderFeedbackList());
            }
            const listOpenBtn = document.getElementById('feedback-list-open-btn');
            if (listOpenBtn) listOpenBtn.classList.remove('hidden');
            showNextFeedbackPopup();
        };
    }

    const feedbackListOpenBtn = document.getElementById('feedback-list-open-btn');
    const feedbackListModal = document.getElementById('feedback-list-modal');
    const closeFeedbackListModalBtn = document.getElementById('close-feedback-list-modal');

    if (feedbackListOpenBtn) {
        feedbackListOpenBtn.addEventListener('click', () => {
            renderFeedbackList();
            feedbackListModal.classList.remove('hidden');
        });
    }
    if (closeFeedbackListModalBtn) {
        closeFeedbackListModalBtn.addEventListener('click', () => {
            feedbackListModal.classList.add('hidden');
        });
    }

    const feedbackDeleteSelectedBtn = document.getElementById('feedback-delete-selected-btn');
    if (feedbackDeleteSelectedBtn) {
        feedbackDeleteSelectedBtn.addEventListener('click', () => {
            const checked = document.querySelectorAll('.feedback-select-checkbox:checked');
            if (checked.length === 0) {
                alert(t('alert.select_items_to_delete'));
                return;
            }
            if (!confirm(`선택한 ${checked.length}건의 요청사항을 삭제하시겠습니까?`)) return;
            const updates = {};
            checked.forEach(cb => { updates[cb.getAttribute('data-key')] = null; });
            firebaseDb.ref('requests').update(updates).then(() => renderFeedbackList());
        });
    }

    // 요청사항(피드백) 모달
    const feedbackOpenBtn = document.getElementById('feedback-open-btn');
    const feedbackModal = document.getElementById('feedback-modal');
    const closeFeedbackModalBtn = document.getElementById('close-feedback-modal');
    const feedbackMessageInput = document.getElementById('feedback-message-input');
    const feedbackPhotoInput = document.getElementById('feedback-photo-input');
    const feedbackPhotoPreview = document.getElementById('feedback-photo-preview');
    const feedbackPhotoImg = document.getElementById('feedback-photo-img');
    const feedbackPhotoRemoveBtn = document.getElementById('feedback-photo-remove-btn');
    const feedbackSubmitBtn = document.getElementById('feedback-submit-btn');
    const feedbackStatus = document.getElementById('feedback-status');
    let feedbackPhotoData = null;

    if (feedbackOpenBtn) {
        feedbackOpenBtn.addEventListener('click', () => {
            feedbackMessageInput.value = '';
            feedbackPhotoData = null;
            feedbackPhotoPreview.classList.add('hidden');
            feedbackPhotoImg.src = '';
            feedbackPhotoInput.value = '';
            feedbackStatus.textContent = '';
            feedbackModal.classList.remove('hidden');
        });
    }

    if (closeFeedbackModalBtn) {
        closeFeedbackModalBtn.addEventListener('click', () => {
            feedbackModal.classList.add('hidden');
        });
    }

    if (feedbackPhotoInput) {
        feedbackPhotoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                compressReceiptImage(file, (compressed) => {
                    feedbackPhotoData = compressed;
                    feedbackPhotoImg.src = compressed;
                    feedbackPhotoPreview.classList.remove('hidden');
                });
            }
        });
    }

    if (feedbackPhotoRemoveBtn) {
        feedbackPhotoRemoveBtn.addEventListener('click', () => {
            feedbackPhotoData = null;
            feedbackPhotoInput.value = '';
            feedbackPhotoPreview.classList.add('hidden');
            feedbackPhotoImg.src = '';
        });
    }

    if (feedbackSubmitBtn) {
        feedbackSubmitBtn.addEventListener('click', () => {
            const message = feedbackMessageInput.value.trim();
            if (!message && !feedbackPhotoData) {
                feedbackStatus.textContent = '메시지나 사진을 입력해주세요.';
                return;
            }
            if (!firebaseDb) {
                feedbackStatus.textContent = '온라인 상태에서만 요청을 보낼 수 있습니다.';
                return;
            }
            feedbackSubmitBtn.disabled = true;
            feedbackStatus.textContent = '전송 중...';

            const requestData = {
                userName: AppState.userName || '알 수 없음',
                pin: AppState.currentPin || '',
                clubName: AppState.clubName || '',
                message: message,
                photo: feedbackPhotoData || null,
                read: false,
                createdAt: Date.now()
            };

            firebaseDb.ref('requests').push(requestData)
                .then(() => {
                    feedbackStatus.textContent = '요청이 전송되었습니다. 감사합니다!';
                    setTimeout(() => {
                        feedbackModal.classList.add('hidden');
                        feedbackSubmitBtn.disabled = false;
                    }, 1000);
                })
                .catch((err) => {
                    console.error('요청 전송 실패:', err);
                    feedbackStatus.textContent = '전송에 실패했습니다. 다시 시도해주세요.';
                    feedbackSubmitBtn.disabled = false;
                });
        });
    }

    // Total self-pay manual adjustment handler
    const selfPayInput = document.getElementById('result-total-self-pay-input');

    function applySelfPayChange() {
        const newValue = parseAmount(selfPayInput.value);
        // 차액은 항상 "자동 계산된 최소 자부담(totalSelfPay)" 대비로 계산 (CALCULATION_SPEC.md L25 규칙과 동일)
        const minSelfPay = Math.round(SettlementCalculator.calculate(
            AppState.memberCount,
            AppState.expenseItems,
            AppState.previousPrizeTotal,
            AppState.rules
        ).totalSelfPay);
        const diff = newValue - minSelfPay;

        const absDiff = Math.abs(diff).toLocaleString();
        const minFmt = minSelfPay.toLocaleString();
        const popupMsg = diff > 0
            ? `원래 총 자부담: ${minFmt}원 + ${absDiff}원 초과\n정산에 문제 없음`
            : diff === 0
            ? `총 자부담: ${minFmt}원 (자동 계산값과 동일)\n정산에 문제 없음`
            : `⚠️ 정산에 문제 있음 ⚠️\n원래 총 자부담: ${minFmt}원보다 ${absDiff}원 적게 부담함`;
        showDiffPopup(popupMsg, diff);

        AppState.lastCalculatedSelfPay = newValue;

        // 인당 자부담 비용 표시는 항상 자동 계산값 기준 (CALCULATION_SPEC.md 4번 참조)
        const calcResult = SettlementCalculator.calculate(
            AppState.memberCount,
            AppState.expenseItems,
            AppState.previousPrizeTotal,
            AppState.rules
        );
        document.getElementById('result-per-person-self-pay').textContent = SettlementCalculator.formatCurrency(calcResult.perPersonSelfPay);
        updatePerPersonSelfPayIcon(calcResult.perPersonSelfPay);

        const totalCost = AppState.expenseItems.reduce((sum, item) => sum + item.amount, 0);
        const ratio = totalCost > 0 ? newValue / totalCost : 0;
        document.getElementById('result-self-pay-ratio').textContent = `${(ratio * 100).toFixed(1)}%`;

        // 최종 지원금 = 총 소요 비용 - 실제 자부담 (CALCULATION_SPEC.md 4번)
        const finalSupport = totalCost - newValue;
        document.getElementById('result-final-support').textContent = SettlementCalculator.formatCurrency(finalSupport);

        // 이번 최종 지원금 / 이후 잔여 예산 갱신 (이전 잔여 예산은 현재 정산과 무관하므로 그대로 유지)
        if (AppState.annualBudget > 0) {
            const prevRemaining = AppState.annualBudget - AppState.usedBudget;
            const afterRemaining = prevRemaining - finalSupport;
            const supportSubEl = document.getElementById('result-this-support-sub');
            const afterRemainingEl = document.getElementById('result-after-remaining');
            if (supportSubEl) supportSubEl.textContent = SettlementCalculator.formatCurrency(finalSupport);
            if (afterRemainingEl) {
                afterRemainingEl.textContent = SettlementCalculator.formatCurrency(afterRemaining);
                afterRemainingEl.style.color = afterRemaining >= 0 ? 'var(--color-secondary)' : 'var(--warning-text)';
            }
        }
    }

    if (selfPayInput) {
        selfPayInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                selfPayInput.blur();
            }
        });
        selfPayInput.addEventListener('blur', () => {
            applySelfPayChange();
        });
        selfPayInput.addEventListener('change', () => {
            applySelfPayChange();
        });
    }

    // Close diff popup on touch/click anywhere
    document.addEventListener('pointerdown', () => {
        const popup = document.getElementById('diff-popup');
        if (popup && !popup.classList.contains('hidden')) {
            popup.classList.add('hidden');
        }
    });

    // --- Firebase PIN Login UI Logic ---
    const pinModal = document.getElementById('pin-login-modal');
    const pinDots = document.querySelectorAll('.pin-dot');
    const pinErrorText = document.getElementById('pin-error-text');
    const statusBadge = document.getElementById('login-status-badge');
    const logoutBtn = document.getElementById('header-logout-btn');
    const loginBtn = document.getElementById('header-login-btn');
    
    let pinInputBuffer = "";

    function updatePinDots() {
        pinDots.forEach((dot, idx) => {
            if (idx < pinInputBuffer.length) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
    }

    function resetPinInput() {
        pinInputBuffer = "";
        updatePinDots();
    }

    function handlePinKeyPress(val) {
        if (val === 'clear') {
            resetPinInput();
            pinErrorText.classList.add('hidden');
        } else if (val === 'back') {
            if (pinInputBuffer.length > 0) {
                pinInputBuffer = pinInputBuffer.slice(0, -1);
                updatePinDots();
                pinErrorText.classList.add('hidden');
            }
        } else {
            if (pinInputBuffer.length < 6) {
                pinInputBuffer += val;
                updatePinDots();
                pinErrorText.classList.add('hidden');
                
                if (pinInputBuffer.length === 6) {
                    const pin = pinInputBuffer;
                    if (!firebaseDb) {
                        pinErrorText.textContent = "Firebase 설정 키가 누락되었습니다. app.js에서 설정을 기입해 주세요.";
                        pinErrorText.classList.remove('hidden');
                        setTimeout(() => {
                            switchToOfflineMode();
                        }, 2500);
                        return;
                    }
                    
                    AppState.loadFromFirebase(pin).then(() => {
                        pinModal.classList.add('hidden');
                        statusBadge.className = 'badge-online';
                        statusBadge.innerHTML = `${t('status.online')} (${AppState.userName || t('status.unknown') || '?'} / PIN: ${pin})`;
                        logoutBtn.style.display = 'inline-block';
                        loginBtn.style.display = 'none';
                        resetPinInput();
                        const lastLoginEl = document.getElementById('last-login-info');
                        if (lastLoginEl) {
                            lastLoginEl.textContent = AppState.prevLastLoginAt
                                ? `최근 접속: ${new Date(AppState.prevLastLoginAt).toLocaleString('ko-KR')}`
                                : '최근 접속: 첫 번째 로그인';
                            lastLoginEl.style.display = 'block';
                        }

                        // Admin tab check
                        setAdminMode(pin === "000000");

                        // Sync values to form fields
                        AppState.loadClubRegistry().then(renderClubOptions);
                        memberInput.value = AppState.memberCount || 0;
                        prizeInput.value = AppState.previousPrizeTotal || 0;
                        setSettingsFormValues(AppState.rules);
            if (typeof setAdminRulesFormValues === 'function') setAdminRulesFormValues(AppState.rules);
                        // 로그인 시 현재 클럽의 전체 이력을 globalHistory에서 로드 → 잔여 예산 정확화
                        if (AppState.clubName || AppState.clubId) {
                            AppState.loadClubHistory().then(() => AppState.render());
                        } else {
                            AppState.render();
                        }
                    }).catch(err => {
                        console.error(err);
                        pinErrorText.textContent = err.message || "서버 연결에 실패했습니다.";
                        pinErrorText.classList.remove('hidden');
                        resetPinInput();
                    });
                }
            }
        }
    }

    // Keyboard support for PIN entry
    document.addEventListener('keydown', (e) => {
        if (pinModal.classList.contains('hidden')) return;
        if (document.activeElement && (document.activeElement.id === 'register-name-input' || document.activeElement.id === 'register-pin-input')) return;
        if (e.key >= '0' && e.key <= '9') {
            handlePinKeyPress(e.key);
        } else if (e.key === 'Backspace') {
            handlePinKeyPress('back');
        } else if (e.key === 'Escape') {
            handlePinKeyPress('clear');
        }
    });

    // 관리자(PIN 000000) 모드 전용 탭 전환
    // 관리자 대시보드 카드 접기/펼치기 (설정은 localStorage에 저장되어 유지됨)
    document.querySelectorAll('.card-collapse-btn').forEach(btn => {
        const cardId = btn.getAttribute('data-card');
        const card = document.getElementById(cardId);
        if (!card) return;
        const storageKey = `card_collapsed_${cardId}`;
        if (localStorage.getItem(storageKey) === '1') {
            card.classList.add('collapsed');
        }
        btn.addEventListener('click', () => {
            const collapsed = card.classList.toggle('collapsed');
            localStorage.setItem(storageKey, collapsed ? '1' : '0');
        });
    });

    function setAdminMode(isAdmin) {
        // 관리자 모드: 헤더 문구 변경 및 클럽 선택 영역 숨김
        const headerTitleEl = document.querySelector('.logo-area h1');
        if (headerTitleEl) headerTitleEl.textContent = isAdmin ? '총 클럽 비용 관리' : '클럽 비용 정산';
        const clubNameWrapperEl = document.querySelector('.club-name-wrapper');
        if (clubNameWrapperEl) clubNameWrapperEl.classList.toggle('hidden', isAdmin);

        const adminOnlyIds = ['admin-tab-btn', 'club-history-tab-btn', 'charts-tab-btn'];
        const memberOnlyIds = ['settlement-tab-btn', 'attendees-tab-btn', 'history-tab-btn'];
        adminOnlyIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', !isAdmin);
        });
        memberOnlyIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', isAdmin);
        });

        // 일반 회원: 요청사항 보내기 버튼만 표시 / 관리자: 요청사항 리스트 버튼만 표시
        const feedbackOpenBtnEl = document.getElementById('feedback-open-btn');
        const feedbackListOpenBtnEl = document.getElementById('feedback-list-open-btn');
        if (feedbackOpenBtnEl) feedbackOpenBtnEl.classList.toggle('hidden', isAdmin);
        if (feedbackListOpenBtnEl && !isAdmin) feedbackListOpenBtnEl.classList.add('hidden');

        // 관리자 모드에서는 새 요청사항이 도착하면 알림 팝업을 띄우고, 리스트 버튼을 표시
        if (isAdmin && firebaseDb) {
            firebaseDb.ref('requests').on('value', snapshot => {
                const requestsData = snapshot.val() || {};
                const requestList = Object.keys(requestsData)
                    .map(key => ({ key, ...requestsData[key] }))
                    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                const unreadCount = requestList.filter(r => !r.read).length;

                const badge = document.getElementById('feedback-list-badge');
                if (badge) {
                    if (unreadCount > 0) {
                        badge.textContent = unreadCount;
                        badge.classList.remove('hidden');
                    } else {
                        badge.classList.add('hidden');
                    }
                }

                // 새로 도착한(아직 본 적 없는) 안읽은 요청은 팝업 큐에 추가
                requestList.forEach(req => {
                    if (!req.read && !seenFeedbackKeys.has(req.key)) {
                        seenFeedbackKeys.add(req.key);
                        feedbackPopupQueue.push(req);
                    }
                });
                showNextFeedbackPopup();

                // 안읽은 요청이 있으면(팝업 확인 전이라도) 리스트 버튼 노출
                if (feedbackListOpenBtnEl && unreadCount > 0) {
                    feedbackListOpenBtnEl.classList.remove('hidden');
                }
            });
        } else if (!isAdmin && firebaseDb) {
            firebaseDb.ref('requests').off('value');
        }

        // 활성 탭이 더 이상 보이지 않으면 기본 탭으로 전환
        const activeBtn = document.querySelector('.tab-nav .tab-btn.active');
        if (!activeBtn || activeBtn.classList.contains('hidden')) {
            const fallbackId = isAdmin ? 'tab-admin' : 'tab-settlement';
            document.querySelectorAll('.tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
            const fallbackBtn = document.querySelector(`[data-tab="${fallbackId}"]`);
            if (fallbackBtn) fallbackBtn.classList.add('active');
            const fallbackPane = document.getElementById(fallbackId);
            if (fallbackPane) fallbackPane.classList.remove('hidden');
            if (isAdmin && typeof renderAdminDashboard === 'function') renderAdminDashboard();
        }
    }

    function switchToOfflineMode() {
        pinModal.classList.add('hidden');
        statusBadge.className = 'badge-offline';
        statusBadge.textContent = t('header.offline');
        logoutBtn.style.display = 'none';
        loginBtn.style.display = 'inline-block';
        document.getElementById('admin-tab-btn').classList.add('hidden');
        setAdminMode(false);

        // If we were on admin tab, switch back to settlement
        if (document.getElementById('admin-tab-btn').classList.contains('active')) {
            document.querySelectorAll('.tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
            const sTab = document.querySelector('[data-tab="tab-settlement"]');
            if (sTab) sTab.classList.add('active');
            document.getElementById('tab-settlement').classList.remove('hidden');
        }

        AppState.cancelEditMode(); // 수정 모드 중 로그아웃 시 상태 초기화
        AppState.clubHistory = [];
        AppState.isLoggedIn = false;
        AppState.currentPin = null;
        AppState.userName = null;
        resetPinInput();
        AppState.load(); // Load local storage
        renderClubOptions();
        memberInput.value = AppState.memberCount || 0;
        prizeInput.value = AppState.previousPrizeTotal || 0;
        setSettingsFormValues(AppState.rules);
        AppState.render();
    }

    logoutBtn.addEventListener('click', () => {
        if (confirm(t('confirm.logout'))) {
            switchToOfflineMode();
        }
    });

    loginBtn.addEventListener('click', () => {
        pinErrorText.classList.add('hidden');
        resetPinInput();
        document.getElementById('login-mode-section').classList.remove('hidden');
        document.getElementById('register-mode-section').classList.add('hidden');
        pinModal.classList.remove('hidden');
    });

    // Toggle to Register mode
    document.getElementById('go-to-register').addEventListener('click', () => {
        document.getElementById('login-mode-section').classList.add('hidden');
        document.getElementById('register-mode-section').classList.remove('hidden');
        document.getElementById('register-name-input').value = '';
        document.getElementById('register-pin-input').value = '';
        document.getElementById('register-error-text').classList.add('hidden');
    });

    // 변경이력 모달
    const CHANGELOG = [
        { ver: '1.6.183', date: '2026.07.02', items: ['유저 접속 시 globalHistory 기준 잔여 예산 자동 반영 — 관리자 개입 없이 모든 사용자 정산이 잔여 예산에 즉시 표시', '클럽 선택 변경 시에도 자동 재계산'] },
        { ver: '1.6.182', date: '2026.07.02', items: ['관리자 로그인 시 globalHistory 전체 기준으로 명부 누적 카운트 자동 재계산 — 모든 사용자 정산 이력 반영'] },
        { ver: '1.6.181', date: '2026.07.02', items: ['명부 누적 카운트 사번 기준으로 변경 — 동명이인(같은 이름, 다른 사번) 정확히 구분'] },
        { ver: '1.6.180', date: '2026.07.02', items: ['정산 이력 클럽 단위 전체 공유 — 같은 클럽이면 다른 사용자 정산 이력도 표시', '이력 카드에 정산인 이름 표시 (👤), 타인 항목 수정 버튼 숨김'] },
        { ver: '1.6.179', date: '2026.07.02', items: ['잔여 예산 미반영 버그 수정 — Firebase 미동기화 시 개인 이력 합산으로 보완', '정산 완료 팝업 버튼이 "삭제"로 표시되던 버그 수정 → "확인"으로 변경'] },
        { ver: '1.6.178', date: '2026.07.01', items: ['정산 이력 삭제 안내 문구 수정: "문의" → "요청"'] },
        { ver: '1.6.177', date: '2026.07.01', items: ['정산 이력 헤더에 "이력 삭제가 필요한 경우 관리자에게 요청하세요" 안내 추가'] },
        { ver: '1.6.176', date: '2026.07.01', items: ['이력 카드 날짜 표시 개선 — settlementDate 우선 표시, 수정 시각은 날짜+시간 함께 표시'] },
        { ver: '1.6.175', date: '2026.07.01', items: ['수정 모드에서 정산 날짜 원본 날짜로 복원', '"파일 저장 및 정산 완료" 버튼 수정 모드 중 숨김 처리'] },
        { ver: '1.6.174', date: '2026.07.01', items: ['정산 이력 수정 시 settlementDate 반영', '이력 카드에 "📥 엑셀" 버튼 추가 — 수정된 버전으로 엑셀 다운로드'] },
        { ver: '1.6.173', date: '2026.07.01', items: ['수정 완료 버튼 동작 수정 — 모바일 async 다운로드 차단 문제 해결, 관리자 이력도 동시 수정'] },
        { ver: '1.6.172', date: '2026.07.01', items: ['수정 모드 배너에 "✅ 수정 완료" 버튼 추가'] },
        { ver: '1.6.171', date: '2026.07.01', items: ['엑셀 파일명 형식 변경 — 클럽명(날짜).xlsx'] },
        { ver: '1.6.170', date: '2026.07.01', items: ['"파일 저장 및 정산 완료" 버튼명 변경 + 클릭 시 확인 팝업 추가'] },
        { ver: '1.6.169', date: '2026.07.01', items: ['클럽 깜빡임 버그 수정 — Firebase 일괄 삭제로 변경', '엑셀 저장 후 데이터 초기화 누락 수정'] },
        { ver: '1.6.168', date: '2026.07.01', items: ['중복 클럽 3중 방지 — Firebase 자동 정리, 화면 필터, 대소문자 무시 선택'] },
        { ver: '1.6.167', date: '2026.07.01', items: ['중복 클럽 일괄 정리 버튼 추가 (클럽 관리 탭)'] },
        { ver: '1.6.166', date: '2026.07.01', items: ['클럽 이름 중복 추가 방지 — 동일 이름 등록 시 경고 팝업'] },
        { ver: '1.6.165', date: '2026.07.01', items: ['모바일 줄바꿈 개선: 탭 버튼 자연스러운 줄바꿈, 카드 헤더 오버플로 수정, 정산 날짜 힌트 줄 분리, 달력 네비게이션 정렬'] },
        { ver: '1.6.164', date: '2026.07.01', items: ['업데이트 내역 날짜별 그룹핑 표시, 버전 표시 app.js 내장값 기준으로 신뢰성 개선'] },
        { ver: '1.6.163', date: '2026.07.01', items: ['행사 사진 여러 장 첨부 지원 (엑셀 sheet3에 우측으로 순서대로 배치, 개별 삭제 가능)'] },
        { ver: '1.6.162', date: '2026.07.01', items: ['정산 날짜 달력 피커 추가 — 탭하면 달력 팝업으로 월/일 선택'] },
        { ver: '1.6.161', date: '2026.07.01', items: ['정산 날짜 입력란을 정산 결과 카드 상단으로 이동 (저번달 등 소급 등록 편의 개선)'] },
        { ver: '1.6.160', date: '2026.06.29', items: ['한영 전환 토글 삭제 — 한국어 전용으로 단순화'] },
        { ver: '1.6.159', date: '2026.06.29', items: ['영수증 미첨부 항목에 "영수증을 첨부하세요" 안내 문구 표시'] },
        { ver: '1.6.158', date: '2026.06.29', items: ['모든 삭제 버튼에 확인 팝업 추가 (비용·참석자·명부·클럽)'] },
        { ver: '1.6.157', date: '2026.06.29', items: ['코드 리뷰 버그 6건 수정 (잔여예산 연도 필터, 수정모드 가드, Firebase 경쟁 조건, 중복 탭 핸들러, 캐시 플래그 이중소비, 모달 리스너 누적)'] },
        { ver: '1.6.155', date: '2026.06.28', items: ['로그인 화면 버전·업데이트 날짜 표시 (PIN 안내 문구 제거)'] },
        { ver: '1.6.154', date: '2026.06.28', items: ['캐시 초기화 버튼 1회 클릭으로 업데이트 자동 완료'] },
        { ver: '1.6.153', date: '2026.06.28', items: ['클럽 배정 예산 + 전체 총 예산 이중 차단 강화', 'usedBudget Firebase 동기화로 다중 사용자 예산 정확화'] },
        { ver: '1.6.152', date: '2026.06.28', items: ['상품비 누적액 Firebase 자동 교정 (관리자 화면 열 때 불일치 수정)'] },
        { ver: '1.6.151', date: '2026.06.28', items: ['차트 탭 전환 시 재렌더 (빈 차트 버그 수정)', '차트 집계를 settlementDate 기준으로 통일'] },
        { ver: '1.6.150', date: '2026.06.28', items: ['관리자 로그인 시 첫 화면이 대시보드 탭으로 자동 전환'] },
        { ver: '1.6.149', date: '2026.06.27', items: ['상품비 누적액을 정산이력 기준으로 동적 재계산', '회원 수정 팝업을 커스텀 모달로 교체 (이름/PIN 수정 가능)'] },
        { ver: '1.6.148', date: '2026.06.27', items: ['가입 회원 관리 삭제 확인 팝업 추가', '회원 목록에 최근 접속일시 컬럼 추가'] },
        { ver: '1.6.147', date: '2026.06.26', items: ['클럽별 정산이력 삭제 확인 팝업 추가', '헤더에 최근 접속일시 표시', '정산 날짜 직접 입력 가능 (소급 등록 지원)'] },
        { ver: '1.6.146', date: '2026.06.26', items: ['클럽 예산 소진 시 비용 추가 완전 차단', '잔여 예산 초과 입력 시 팝업 경고'] },
        { ver: '1.6.143', date: '2026.06.20', items: ['시설·장비 이사진 승인 법인카드 한도 관리자 설정 추가'] },
        { ver: '1.6.142', date: '2026.06.20', items: ['시설·장비 사전 승인 팝업 추가', '승인 완료 시 법인카드 85,000원 한도 적용'] },
        { ver: '1.6.137', date: '2026.06.15', items: ['삭제한 이력 재출현 완전 차단 (Tombstone)', '캐시 초기화 버튼 추가'] },
        { ver: '1.6.135', date: '2026.06.14', items: ['클럽별 비용 지출 비교 차트 추가'] },
        { ver: '1.6.134', date: '2026.06.14', items: ['상품비 클럽별 누적 관리 + 연간 한도 관리자 설정'] },
        { ver: '1.6.125', date: '2026.06.10', items: ['상품비 누적액 자동 계산 + 인원/한도 검증 팝업'] },
        { ver: '1.6.120', date: '2026.06.08', items: ['비용 입력 시 법인/개인카드 금액 자동 계산'] },
        { ver: '1.6.110', date: '2026.06.05', items: ['동명이인 사번 선택 팝업 추가', '전사원 명부 동명이인 별도 행 표시'] },
        { ver: '1.6.90', date: '2026.05.28', items: ['관리자 설정 실시간 동기화', '정산 이력 수정 기능 추가'] },
        { ver: '1.6.75', date: '2026.05.22', items: ['클럽별 정산이력 정산인 선택 드롭다운 (2명 이상일 때만 표시)'] },
        { ver: '1.6.54', date: '2026.05.15', items: ['차트 탭 추가: 월별 추이, 예산 소진율, 카테고리 비중, 자부담 추이'] },
    ];

    (function initChangelog() {
        const overlay = document.getElementById('changelog-modal-overlay');
        const content = document.getElementById('changelog-content');
        const closeBtn = document.getElementById('changelog-close-btn');
        const verEl    = document.getElementById('app-version-info');
        if (!overlay || !content || !verEl) return;

        // 버전 표시를 app.js에 내장된 값으로 즉시 업데이트 (localStorage/SW 메시지 의존 제거)
        verEl.textContent = `v${APP_VERSION}  ·  ${APP_VERSION_DATE} 업데이트`;

        function openChangelog() {
            // 날짜별로 그룹핑 (같은 날 여러 버전 → 한 블록으로)
            const groups = [];
            const seen = {};
            for (const entry of CHANGELOG) {
                if (!seen[entry.date]) {
                    seen[entry.date] = { date: entry.date, versions: [], items: [] };
                    groups.push(seen[entry.date]);
                }
                seen[entry.date].versions.push(entry.ver);
                seen[entry.date].items.push(...entry.items);
            }

            content.innerHTML = groups.map(g => {
                const vRange = g.versions.length === 1
                    ? `v${g.versions[0]}`
                    : `v${g.versions[g.versions.length - 1]} ~ v${g.versions[0]}`;
                return `
                <div style="margin-bottom:1rem; padding-bottom:1rem; border-bottom:1px solid rgba(139,92,246,0.15);">
                    <div style="display:flex; align-items:baseline; gap:0.5rem; margin-bottom:0.35rem; flex-wrap:wrap;">
                        <span style="font-size:0.8rem; font-weight:700; color:var(--text-muted);">${g.date}</span>
                        <span style="font-size:0.75rem; color:#a78bfa;">${vRange}</span>
                    </div>
                    <ul style="margin:0; padding-left:1.1rem; display:flex; flex-direction:column; gap:0.2rem;">
                        ${g.items.map(i => `<li style="font-size:0.78rem; color:#cbd5e1; line-height:1.45;">${i}</li>`).join('')}
                    </ul>
                </div>`;
            }).join('');
            overlay.style.display = 'flex';
        }

        verEl.addEventListener('click', openChangelog);
        closeBtn.addEventListener('click', () => { overlay.style.display = 'none'; });
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    })();

    // 앱 캐시 초기화 — 구버전 캐시 강제 삭제 후 최신 버전 재로드 (1회 클릭으로 완료)
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', async () => {
            clearCacheBtn.textContent = '초기화 중...';
            clearCacheBtn.disabled = true;
            // 리로드 후 SW_UPDATED 배너를 자동 억제하기 위한 플래그
            sessionStorage.setItem('cache_just_cleared', '1');
            try {
                if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    // 대기 중인 워커가 있으면 skipWaiting 먼저 호출
                    regs.forEach(r => { if (r.waiting) r.waiting.postMessage({ action: 'skipWaiting' }); });
                    await Promise.all(regs.map(r => r.unregister()));
                }
                if ('caches' in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map(k => caches.delete(k)));
                }
            } catch (e) { /* ignore */ }
            // cache-busting 쿼리로 브라우저 HTTP 캐시까지 우회하여 최신 버전 강제 로드
            const url = new URL(window.location.href);
            url.searchParams.set('_cb', Date.now());
            window.location.replace(url.href);
        });
    }

    // Toggle to Login mode
    document.getElementById('go-to-login').addEventListener('click', () => {
        document.getElementById('login-mode-section').classList.remove('hidden');
        document.getElementById('register-mode-section').classList.add('hidden');
        resetPinInput();
        pinErrorText.classList.add('hidden');
    });

    // Submit Registration
    document.getElementById('submit-register-btn').addEventListener('click', () => {
        const name = document.getElementById('register-name-input').value.trim();
        const pin = document.getElementById('register-pin-input').value.trim();
        const regError = document.getElementById('register-error-text');

        if (!name) {
            regError.textContent = "이름을 입력해 주세요.";
            regError.classList.remove('hidden');
            return;
        }
        if (pin.length !== 6 || isNaN(pin)) {
            regError.textContent = "6자리 숫자의 PIN 번호를 입력해 주세요.";
            regError.classList.remove('hidden');
            return;
        }
        if (pin === "000000") {
            regError.textContent = "000000은 관리자용 PIN 번호이므로 등록할 수 없습니다.";
            regError.classList.remove('hidden');
            return;
        }

        regError.classList.add('hidden');

        // Check if PIN already exists in Firebase
        firebaseDb.ref(`users/${pin}`).once('value').then(snapshot => {
            if (snapshot.exists()) {
                regError.textContent = "이미 등록된 PIN 번호입니다. 다른 번호를 입력해 주세요.";
                regError.classList.remove('hidden');
            } else {
                // Register User
                firebaseDb.ref(`users/${pin}`).set({
                    name: name,
                    registeredAt: Date.now()
                }).then(() => {
                    alert(`${name}${t('alert.register_success')}`);
                    
                    // Automatically log in
                    AppState.isLoggedIn = true;
                    AppState.currentPin = pin;
                    AppState.userName = name;
                    
                    setAdminMode(false);
                    pinModal.classList.add('hidden');
                    statusBadge.className = 'badge-online';
                    statusBadge.innerHTML = `${t('status.online')} (${name} / PIN: ${pin})`;
                    logoutBtn.style.display = 'inline-block';
                    loginBtn.style.display = 'none';
                    
                    // Sync values to form fields
                    AppState.loadClubRegistry().then(renderClubOptions);
                    memberInput.value = AppState.memberCount || 0;
                    prizeInput.value = AppState.previousPrizeTotal || 0;
                    setSettingsFormValues(AppState.rules);
            if (typeof setAdminRulesFormValues === 'function') setAdminRulesFormValues(AppState.rules);
                    AppState.render();
                }).catch(err => {
                    regError.textContent = "가입 등록에 실패했습니다. 네트워크를 확인해 주세요.";
                    regError.classList.remove('hidden');
                });
            }
        });
    });

    // Admin Dashboard Statistics and Searching
    const adminUserSelect = document.getElementById('admin-user-select');
    if (adminUserSelect) {
        adminUserSelect.addEventListener('change', () => {
            renderAdminHistory(lastHistoryList);
        });
    }

    const clubHistorySelect = document.getElementById('club-history-select');
    if (clubHistorySelect) {
        clubHistorySelect.addEventListener('change', () => {
            renderAdminHistory(lastHistoryList);
        });
    }

    // ── 가입 회원 - 이름/PIN 수정 및 삭제 ────────────────────────────────
    function editAdminUser(oldPin, currentName) {
        const overlay   = document.getElementById('edit-user-modal-overlay');
        const nameInput = document.getElementById('edit-user-name-input');
        const pinInput  = document.getElementById('edit-user-pin-input');
        const errEl     = document.getElementById('edit-user-error');
        const okBtn     = document.getElementById('edit-user-modal-ok');
        const cancelBtn = document.getElementById('edit-user-modal-cancel');
        if (!overlay) return;

        nameInput.value = currentName;
        pinInput.value  = oldPin;
        errEl.style.display = 'none';
        overlay.style.display = 'flex';
        nameInput.focus();

        const close = () => { overlay.style.display = 'none'; cleanup(); };
        const handleOk = () => {
            const newName = nameInput.value.trim();
            const newPin  = pinInput.value.trim();
            if (!newName) { errEl.textContent = '이름을 입력해주세요.'; errEl.style.display = 'block'; return; }
            if (!/^\d{6}$/.test(newPin)) { errEl.textContent = t('alert.pin_digit_required'); errEl.style.display = 'block'; return; }
            close();
            firebaseDb.ref(`users/${oldPin}`).once('value').then(snap => {
                const userData = snap.val() || {};
                userData.name = newName;
                if (newPin === oldPin) {
                    return firebaseDb.ref(`users/${oldPin}`).update({ name: userData.name });
                }
                return firebaseDb.ref(`users/${newPin}`).once('value').then(existing => {
                    if (existing.exists()) { alert(t('alert.pin_already_used')); return Promise.reject(new Error('duplicate-pin')); }
                    return firebaseDb.ref(`settlements/${oldPin}`).once('value').then(settlementSnap => {
                        const tasks = [firebaseDb.ref(`users/${newPin}`).set(userData), firebaseDb.ref(`users/${oldPin}`).remove()];
                        if (settlementSnap.exists()) {
                            tasks.push(firebaseDb.ref(`settlements/${newPin}`).set(settlementSnap.val()));
                            tasks.push(firebaseDb.ref(`settlements/${oldPin}`).remove());
                        }
                        return Promise.all(tasks);
                    });
                });
            }).then(() => renderAdminDashboard())
              .catch(err => { if (err && err.message !== 'duplicate-pin') { console.error('회원 정보 수정 실패:', err); alert(t('alert.edit_user_failed')); } });
        };
        const handleCancel = () => close();
        const handleKey = (e) => { if (e.key === 'Enter') handleOk(); if (e.key === 'Escape') handleCancel(); };
        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            overlay.removeEventListener('keydown', handleKey);
        };
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        overlay.addEventListener('keydown', handleKey);
    }

    function deleteAdminUser(pin, name) {
        showConfirmModal(
            `'${name}' (${pin}) 회원을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
            () => {
                Promise.all([
                    firebaseDb.ref(`users/${pin}`).remove(),
                    firebaseDb.ref(`settlements/${pin}`).remove()
                ]).then(() => {
                    renderAdminDashboard();
                }).catch(err => {
                    console.error('회원 삭제 실패:', err);
                    alert(t('alert.delete_user_failed'));
                });
            }
        );
    }

    // 요청사항 목록을 모달에 렌더링하고, 리스트 버튼 배지를 갱신
    function renderFeedbackList() {
        if (!firebaseDb) return;
        firebaseDb.ref('requests').once('value').then(snapshot => {
            const requestsData = snapshot.val() || {};
            const requestList = Object.keys(requestsData)
                .map(key => ({ key, ...requestsData[key] }))
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

            const listContainer = document.getElementById('feedback-list-container');
            const unreadCount = requestList.filter(r => !r.read).length;
            document.getElementById('feedback-unread-count').textContent = unreadCount;

            const deleteSelectedBtn = document.getElementById('feedback-delete-selected-btn');

            if (requestList.length === 0) {
                listContainer.innerHTML = `<p style="font-size:0.85rem; color:var(--text-muted); text-align:center; padding:1rem 0;">${t('empty.no_requests')}</p>`;
                if (deleteSelectedBtn) deleteSelectedBtn.classList.add('hidden');
            } else {
                if (deleteSelectedBtn) deleteSelectedBtn.classList.remove('hidden');
                listContainer.innerHTML = requestList.map(req => {
                    const dateStr = req.createdAt ? new Date(req.createdAt).toLocaleString('ko-KR') : '-';
                    const photoHtml = req.photo
                        ? `<img src="${req.photo}" alt="첨부 사진" class="feedback-photo-img" data-key="${AppState.escapeHtml(req.key)}" style="max-width:100%; max-height:220px; border-radius:8px; margin-top:0.5rem; cursor:pointer; display:block;">`
                        : '';
                    return `
                        <div class="feedback-item" data-key="${AppState.escapeHtml(req.key)}" style="border:1px solid var(--card-border); border-radius:10px; padding:0.7rem 0.9rem; ${req.read ? 'opacity:0.6;' : 'background:rgba(245, 158, 11, 0.08); border-color:rgba(245,158,11,0.3);'}">
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
                                <label style="display:flex; align-items:center; gap:0.4rem; font-size:0.88rem; font-weight:600; cursor:pointer;">
                                    <input type="checkbox" class="feedback-select-checkbox" data-key="${AppState.escapeHtml(req.key)}">
                                    ${AppState.escapeHtml(req.userName || '알 수 없음')}${req.clubName ? ` (${AppState.escapeHtml(req.clubName)})` : ''}
                                </label>
                                <span style="font-size:0.72rem; color:var(--text-muted); white-space:nowrap;">${dateStr}</span>
                            </div>
                            <p style="font-size:0.85rem; margin:0.4rem 0 0; white-space:pre-wrap;">${AppState.escapeHtml(req.message || '')}</p>
                            ${photoHtml}
                            <div style="margin-top:0.5rem; display:flex; gap:0.5rem; align-items:center;">
                                ${!req.read ? '<button class="btn-mark-read btn-secondary" data-key="' + AppState.escapeHtml(req.key) + '" style="padding:0.25rem 0.6rem; font-size:0.75rem;">확인 완료</button>' : '<span style="font-size:0.72rem; color:var(--text-muted);">✔️ 확인됨</span>'}
                                <button class="btn-delete-feedback btn-text-danger" data-key="${AppState.escapeHtml(req.key)}" style="padding:0.25rem 0.6rem; font-size:0.75rem;">삭제</button>
                            </div>
                        </div>
                    `;
                }).join('');

                listContainer.querySelectorAll('.btn-mark-read').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const key = btn.getAttribute('data-key');
                        firebaseDb.ref(`requests/${key}/read`).set(true).then(() => renderFeedbackList());
                    });
                });
                listContainer.querySelectorAll('.btn-delete-feedback').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const key = btn.getAttribute('data-key');
                        if (!confirm('이 요청사항을 삭제하시겠습니까?')) return;
                        firebaseDb.ref(`requests/${key}`).remove().then(() => renderFeedbackList());
                    });
                });
                listContainer.querySelectorAll('.feedback-photo-img').forEach(img => {
                    img.addEventListener('click', () => {
                        document.getElementById('modal-img').src = img.src;
                        document.getElementById('modal-caption').textContent = '';
                        document.getElementById('receipt-modal').classList.remove('hidden');
                    });
                });
            }

            const badge = document.getElementById('feedback-list-badge');
            if (badge) {
                if (unreadCount > 0) {
                    badge.textContent = unreadCount;
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            }
        });
    }

    function renderAdminDashboard() {
        if (!firebaseDb) return;

        renderFeedbackList();

        // 1. Fetch Users
        firebaseDb.ref('users').once('value').then(snapshot => {
            const users = snapshot.val() || {};
            const tbody = document.getElementById('admin-users-list');
            tbody.innerHTML = '';
            
            let userCount = 0;
            Object.keys(users).forEach(pin => {
                userCount++;
                const user = users[pin];
                const dateStr = user.registeredAt ? new Date(user.registeredAt).toLocaleDateString() : '-';
                const lastLoginStr = user.lastLoginAt
                    ? new Date(user.lastLoginAt).toLocaleString('ko-KR', {year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
                    : '-';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${AppState.escapeHtml(user.name)}</strong></td>
                    <td><code>${AppState.escapeHtml(pin)}</code></td>
                    <td><span style="font-size:0.8rem; color:var(--text-muted);">${dateStr}</span></td>
                    <td><span style="font-size:0.78rem; color:var(--text-muted);">${lastLoginStr}</span></td>
                    <td style="white-space:nowrap;">
                        <button class="btn-edit-user btn-secondary" data-pin="${AppState.escapeHtml(pin)}" data-name="${AppState.escapeHtml(user.name)}" style="padding:0.3rem 0.6rem; font-size:0.78rem;">수정</button>
                        <button class="btn-delete-user btn-text-danger" data-pin="${AppState.escapeHtml(pin)}" data-name="${AppState.escapeHtml(user.name)}" style="padding:0.3rem 0.6rem; font-size:0.78rem;">삭제</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            document.getElementById('admin-total-users').textContent = `${userCount}명`;

            tbody.querySelectorAll('.btn-edit-user').forEach(btn => {
                btn.addEventListener('click', () => {
                    editAdminUser(btn.getAttribute('data-pin'), btn.getAttribute('data-name'));
                });
            });
            tbody.querySelectorAll('.btn-delete-user').forEach(btn => {
                btn.addEventListener('click', () => {
                    deleteAdminUser(btn.getAttribute('data-pin'), btn.getAttribute('data-name'));
                });
            });
        });
        
        // 2. Fetch Global History (삭제 tombstone 필터링 포함)
        Promise.all([
            firebaseDb.ref('globalHistory').once('value'),
            firebaseDb.ref('deletedHistoryIds').once('value')
        ]).then(([snapshot, deletedSnap]) => {
            const historyData = snapshot.val() || {};
            cachedDeletedIds = deletedSnap.val() || {};
            const historyList = Object.values(historyData)
                .filter(e => e && !cachedDeletedIds[String(e.id)])
                .sort((a, b) => b.id - a.id);

            let totalSpend = 0;
            let totalSupport = 0;
            let totalSelfPay = 0;

            historyList.forEach(entry => {
                totalSpend += entry.totalCost || 0;
                totalSupport += entry.finalSupportAmount || 0;
                totalSelfPay += entry.totalSelfPay || 0;
            });

            document.getElementById('admin-total-spend').textContent = SettlementCalculator.formatCurrency(totalSpend);
            document.getElementById('admin-total-support').textContent = SettlementCalculator.formatCurrency(totalSupport);
            document.getElementById('admin-total-self-pay').textContent = SettlementCalculator.formatCurrency(totalSelfPay);

            renderAdminHistory(historyList);
            lastHistoryList = historyList;
            historyLoaded = true; // 최초 로드 완료 — 이후 renderClubManagement의 Firebase 동기화 허용
            // globalHistory 로드 후 클럽 관리 재렌더 — clubRegistry보다 늦게 로드되면 잔여예산이 0으로 표시되는 경쟁조건 해결
            if (typeof renderClubManagement === 'function') renderClubManagement();
            // 차트 예산 통계 타일도 최신 이력 기준으로 갱신 (첫 로드 시 0원 표시 방지)
            if (typeof updateChartsBudgetStats === 'function') updateChartsBudgetStats(historyList);
            // 차트 탭이 활성 상태인 경우 필터 포함 즉시 갱신
            const chartTabActive = document.getElementById('tab-charts') &&
                !document.getElementById('tab-charts').classList.contains('hidden');
            if (chartTabActive && typeof renderClubFilters === 'function') renderClubFilters();
            renderAllCharts(historyList);
        });

        // 3. 클럽 관리 UI 갱신 — loadClubRegistry()는 로그인 시 1회만 호출(실시간 리스너 유지)
        //    탭 전환 때마다 재호출하면 리스너가 누적되어 중복 클럽 생성 등 부작용 발생
        //    (renderAllCharts는 여기서 호출하지 않음 — 차트 탭 rAF 핸들러와 globalHistory .then이 담당,
        //     세 곳에서 중복 호출하면 탭 전환마다 차트가 3회 재생성되어 깜빡임 발생)
        renderClubManagement();
        updateChartsBudgetStats(lastHistoryList);
        renderClubFilters();
        renderClubHistorySelect();
    }

    // ── 클럽별 정산이력 탭 - 클럽 선택 드롭다운 ───────────────────────────
    function renderClubHistorySelect() {
        const select = document.getElementById('club-history-select');
        if (!select) return;
        const current = select.value;
        const clubs = Object.values(AppState.clubRegistry || {}).sort((a, b) => a.name.localeCompare(b.name));
        select.innerHTML = `<option value="">전체 클럽 (월별)</option>` +
            clubs.map(c => `<option value="${AppState.escapeHtml(c.name)}">${AppState.escapeHtml(c.name)}</option>`).join('');
        select.value = current;
    }

    // ── 클럽 관리 (관리자 대시보드) ───────────────────────────────────────
    let editingClubId = null;
    let lastHistoryList = [];
    let historyLoaded = false; // globalHistory 최초 로드 완료 여부 — 로드 전 빈 리스트 기준으로 Firebase에 0을 써버리는 사고 방지
    let cachedDeletedIds = {}; // tombstone 캐시 — 어떤 경로로도 삭제된 항목이 보이지 않도록
    let selectedOverallClubs = null; // null = 전체 표시, Set이면 해당 클럽만 표시

    const clubTotalBudgetInput = document.getElementById('club-total-budget-input');
    const clubBudgetSummary = document.getElementById('club-budget-summary');
    const clubForm = document.getElementById('club-form');
    const clubNameFormInput = document.getElementById('club-name-form-input');
    const clubBudgetFormInput = document.getElementById('club-budget-form-input');
    const clubPriorUsedFormInput = document.getElementById('club-prior-used-form-input');
    const cancelEditClubBtn = document.getElementById('cancel-edit-club-btn');
    const clubListContainer = document.getElementById('club-list-container');

    function renderClubManagement() {
        // "올해 기존 사용" 칸 입력 중에는 재렌더 스킵 — Firebase 스냅샷 등 외부 재렌더가
        // 입력값을 지우는 것 방지 (blur 시 change 핸들러가 저장 후 직접 재렌더함)
        if (document.activeElement && document.activeElement.classList &&
            document.activeElement.classList.contains('club-prior-used-input')) return;
        if (clubTotalBudgetInput) {
            clubTotalBudgetInput.value = formatAmount(AppState.clubTotalBudget || 0);
        }

        const _seenClubNames = new Set();
        const clubs = Object.entries(AppState.clubRegistry || {}).filter(([, c]) => {
            const key = (c.name || '').trim().toLowerCase();
            if (!key || _seenClubNames.has(key)) return false;
            _seenClubNames.add(key);
            return true;
        });
        const allocated = clubs.reduce((sum, [, c]) => sum + (c.budget || 0), 0);
        const remaining = (AppState.clubTotalBudget || 0) - allocated;
        if (clubBudgetSummary) {
            clubBudgetSummary.textContent = `${SettlementCalculator.formatCurrency(allocated)} / ${SettlementCalculator.formatCurrency(remaining)}`;
            clubBudgetSummary.style.color = remaining < 0 ? 'var(--warning-text, #ff6b6b)' : 'var(--color-secondary)';
        }

        if (!clubListContainer) return;
        clubListContainer.innerHTML = '';
        if (clubs.length === 0) {
            clubListContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">🏷️</span><p>${t('empty.no_clubs')}</p></div>`;
            return;
        }
        clubs.sort((a, b) => a[1].name.localeCompare(b[1].name)).forEach(([clubId, club], idx) => {
            const _thisYear = new Date().getFullYear();
            // 상품비: globalHistory 기준으로 올해 실제 사용액 계산 후 Firebase에도 동기화
            const prizeUsed = lastHistoryList
                .filter(entry => {
                    if (!entry || entry.clubName !== club.name) return false;
                    const d = entry.settlementDate
                        ? new Date(entry.settlementDate + 'T00:00:00')
                        : (entry.date ? new Date(entry.date) : new Date(entry.id));
                    return d.getFullYear() === _thisYear;
                })
                .reduce((sum, entry) => sum + (entry.prizeCost || 0), 0);
            // usedBudget: 올해 globalHistory 기준 확정 지원금 합산 (유저 예산 리미트 동기화)
            const usedBudget = lastHistoryList
                .filter(entry => {
                    if (!entry || entry.clubName !== club.name) return false;
                    const d = entry.settlementDate
                        ? new Date(entry.settlementDate + 'T00:00:00')
                        : (entry.date ? new Date(entry.date) : new Date(entry.id));
                    return d.getFullYear() === _thisYear;
                })
                .reduce((sum, entry) => sum + (entry.finalSupportAmount || 0), 0);
            // Firebase 값과 다를 때만 업데이트 (prizeUsed + usedBudget 동시 처리)
            // historyLoaded 전에는 쓰기 금지 — 이력 로드 전 빈 리스트로 계산된 0원이
            // 공유 clubRegistry를 덮어써 다른 접속자에게 잔여예산이 잘못 표시되는 사고 방지
            const needsUpdate = (club.prizeUsed || 0) !== prizeUsed || (club.usedBudget || 0) !== usedBudget;
            if (needsUpdate && firebaseDb && historyLoaded) {
                club.prizeUsed  = prizeUsed;
                club.usedBudget = usedBudget;
                firebaseDb.ref(`clubRegistry/${clubId}`).update({ prizeUsed, usedBudget }).catch(() => {});
            }
            const budget = club.budget || 0;
            const priorUsed = club.priorUsed || 0;
            const prizeLimit = AppState.rules.prizeLimit || 500000;
            const remaining = budget - priorUsed - usedBudget;
            const row = document.createElement('div');
            row.className = 'expense-row';
            row.style.cssText = 'padding:0.6rem 0.75rem; height:auto; align-items:center; flex-wrap:wrap;';
            row.innerHTML = `
                <div class="expense-row-left" style="flex:1.4; min-width:90px;">
                    <span class="expense-row-title" style="font-size:0.9rem; white-space:normal; line-height:1.3;"><span style="color:var(--text-muted); margin-right:0.3em; font-weight:400;">${idx + 1}.</span>${AppState.escapeHtml(club.name)}</span>
                </div>
                <div style="flex:1.2; min-width:100px; text-align:center;">
                    <div style="font-size:0.7rem; color:var(--text-secondary);">${t('club.assigned_budget')}</div>
                    <div style="font-size:0.85rem; font-weight:600;">${SettlementCalculator.formatCurrency(budget)}</div>
                </div>
                <div style="flex:1.1; min-width:110px; text-align:center;">
                    <div style="font-size:0.7rem; color:var(--text-secondary);">✏️ 올해 기존 사용</div>
                    <input type="text" inputmode="numeric" class="club-prior-used-input" data-id="${AppState.escapeHtml(clubId)}"
                        value="${priorUsed ? formatAmount(priorUsed) : ''}" placeholder="0"
                        title="앱 사용 전 올해 이미 지출한 금액 — 입력하면 잔여 예산에서 자동 차감됩니다"
                        style="width:100px; padding:0.25rem 0.4rem; font-size:0.82rem; text-align:center; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.18); border-radius:6px; color:inherit;">
                </div>
                <div style="flex:1.1; min-width:90px; text-align:center;">
                    <div style="font-size:0.7rem; color:var(--text-secondary);">🎁 상품비 사용</div>
                    <div style="font-size:0.85rem; font-weight:600; color:${prizeUsed > 0 ? 'hsl(38,92%,60%)' : 'var(--text-muted)'};">${SettlementCalculator.formatCurrency(prizeUsed)}</div>
                    <div style="font-size:0.68rem; color:var(--text-muted);">한도 ${SettlementCalculator.formatCurrency(prizeLimit)}</div>
                </div>
                <div style="flex:1.2; min-width:100px; text-align:center;">
                    <div style="font-size:0.7rem; color:var(--text-secondary);">${t('club.remaining_budget')}</div>
                    <div style="font-size:0.85rem; font-weight:600; color:${remaining < 0 ? 'var(--warning-text, #ff6b6b)' : 'var(--color-secondary)'};">${SettlementCalculator.formatCurrency(remaining)}</div>
                </div>
                <div class="expense-row-right" style="gap:0.4rem; flex:0 0 auto;">
                    <button class="btn-add-club-budget btn-secondary" data-id="${AppState.escapeHtml(clubId)}" style="padding:0.3rem 0.6rem; font-size:0.78rem;">${t('btn.add_budget')}</button>
                    <button class="btn-edit-club btn-secondary" data-id="${AppState.escapeHtml(clubId)}" style="padding:0.3rem 0.6rem; font-size:0.78rem;">${t('btn.edit')}</button>
                    <button class="btn-delete-club btn-text-danger" data-id="${AppState.escapeHtml(clubId)}" style="padding:0.3rem 0.6rem; font-size:0.78rem;">${t('btn.delete')}</button>
                </div>
            `;
            clubListContainer.appendChild(row);
        });

        clubListContainer.querySelectorAll('.btn-edit-club').forEach(btn => {
            btn.addEventListener('click', () => {
                const clubId = btn.getAttribute('data-id');
                const club = AppState.clubRegistry[clubId];
                if (!club) return;
                editingClubId = clubId;
                clubNameFormInput.value = club.name;
                clubBudgetFormInput.value = formatAmount(club.budget || 0);
                if (clubPriorUsedFormInput) clubPriorUsedFormInput.value = club.priorUsed ? formatAmount(club.priorUsed) : '';
                document.getElementById('add-club-btn').innerHTML = t('btn.edit_done');
                cancelEditClubBtn.classList.remove('hidden');
                clubNameFormInput.focus();
            });
        });
        clubListContainer.querySelectorAll('.btn-add-club-budget').forEach(btn => {
            btn.addEventListener('click', () => {
                const clubId = btn.getAttribute('data-id');
                const club = AppState.clubRegistry[clubId];
                if (!club) return;
                openAddClubBudgetModal(club.name, (addAmount) => {
                    if (addAmount <= 0) return;
                    const newBudget = (club.budget || 0) + addAmount;
                    AppState.addOrUpdateClub(clubId, club.name, newBudget, club.priorUsed || 0);
                    renderClubManagement();
                });
            });
        });
        clubListContainer.querySelectorAll('.btn-delete-club').forEach(btn => {
            btn.addEventListener('click', () => {
                const clubId = btn.getAttribute('data-id');
                const club = AppState.clubRegistry[clubId];
                if (!club) return;
                showConfirmModal(`'${club.name}' 클럽을 삭제하시겠습니까?`, () => {
                    AppState.deleteClub(clubId);
                    renderClubManagement();
                });
            });
        });
        // "올해 기존 사용" 인라인 입력 — Enter 또는 포커스 아웃 시 저장, 잔여 예산 즉시 재계산
        clubListContainer.querySelectorAll('.club-prior-used-input').forEach(inp => {
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
            });
            inp.addEventListener('change', () => {
                const clubId = inp.getAttribute('data-id');
                const club = AppState.clubRegistry[clubId];
                if (!club) return;
                const val = Math.max(0, parseAmount(inp.value));
                if (val === (club.priorUsed || 0)) {
                    inp.value = val ? formatAmount(val) : '';
                    return;
                }
                AppState.addOrUpdateClub(clubId, club.name, club.budget || 0, val);
                renderClubManagement();
            });
        });
    }

    function resetClubForm() {
        editingClubId = null;
        clubNameFormInput.value = '';
        clubBudgetFormInput.value = '';
        if (clubPriorUsedFormInput) clubPriorUsedFormInput.value = '';
        document.getElementById('add-club-btn').innerHTML = t('btn.add_club_active');
        cancelEditClubBtn.classList.add('hidden');
    }

    // 중복 클럽 정리 버튼
    const dedupClubsBtn = document.getElementById('dedup-clubs-btn');
    if (dedupClubsBtn) {
        dedupClubsBtn.addEventListener('click', () => {
            const registry = AppState.clubRegistry || {};
            // 이름 기준으로 그룹핑 (대소문자 무관)
            const groups = {};
            for (const [id, club] of Object.entries(registry)) {
                const key = club.name.trim().toLowerCase();
                if (!groups[key]) groups[key] = [];
                groups[key].push({ id, club });
            }
            // 중복이 있는 그룹만 추출
            const dupGroups = Object.values(groups).filter(g => g.length > 1);
            if (dupGroups.length === 0) {
                showConfirmModal('중복된 클럽이 없습니다.');
                return;
            }
            const totalDups = dupGroups.reduce((s, g) => s + g.length - 1, 0);
            const names = dupGroups.map(g => `'${g[0].club.name}' (${g.length}개)`).join(', ');
            showConfirmModal(
                `중복 클럽 ${totalDups}개를 삭제합니다.\n${names}\n각 이름별로 예산이 가장 큰 항목 하나만 남깁니다.\n계속하시겠습니까?`,
                () => {
                    for (const group of dupGroups) {
                        // 예산이 가장 큰 항목을 keep (같으면 첫 번째)
                        group.sort((a, b) => (b.club.budget || 0) - (a.club.budget || 0));
                        const [keep, ...remove] = group;
                        // 남길 항목: priorUsed는 가장 큰 값 사용 (합산하면 과다)
                        const maxPriorUsed = Math.max(...group.map(g => g.club.priorUsed || 0));
                        if (maxPriorUsed !== (keep.club.priorUsed || 0)) {
                            AppState.addOrUpdateClub(keep.id, keep.club.name, keep.club.budget || 0, maxPriorUsed, keep.club.prizeUsed || 0);
                        }
                        // 나머지 삭제
                        for (const { id } of remove) {
                            AppState.deleteClub(id);
                        }
                    }
                    renderClubManagement();
                    alert(`중복 클럽 ${totalDups}개 삭제 완료`);
                }
            );
        });
    }

    if (clubTotalBudgetInput) {
        clubTotalBudgetInput.addEventListener('change', () => {
            AppState.saveClubTotalBudget(parseAmount(clubTotalBudgetInput.value));
            renderClubManagement();
        });
    }

    const saveClubTotalBudgetBtn = document.getElementById('save-club-total-budget-btn');
    if (saveClubTotalBudgetBtn) {
        saveClubTotalBudgetBtn.addEventListener('click', () => {
            const value = parseAmount(clubTotalBudgetInput.value);
            Promise.resolve(AppState.saveClubTotalBudget(value)).then(() => {
                renderClubManagement();
                const statusEl = document.getElementById('club-total-budget-status');
                if (statusEl) {
                    statusEl.style.display = 'block';
                    setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
                }
                renderAllCharts(lastHistoryList);
            }).catch(() => {
                alert(t('alert.total_budget_save_failed'));
            });
        });
    }

    if (clubForm) {
        clubForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = clubNameFormInput.value.trim();
            const budget = parseAmount(clubBudgetFormInput.value);
            // 올해 기존 사용 금액: 입력값이 있으면 그 값 사용(0 입력 시 초기화), 비워두면 기존 값 유지
            const priorUsedRaw = clubPriorUsedFormInput ? clubPriorUsedFormInput.value.trim() : '';
            const priorUsed = priorUsedRaw !== ''
                ? Math.max(0, parseAmount(priorUsedRaw))
                : ((editingClubId && AppState.clubRegistry[editingClubId]) ? (AppState.clubRegistry[editingClubId].priorUsed || 0) : 0);
            if (!name) return;

            // 이름 중복 체크 (신규: 전체 / 수정: 자신 제외)
            const nameLower = name.toLowerCase();
            const duplicate = Object.entries(AppState.clubRegistry || {}).find(
                ([id, c]) => id !== editingClubId && c.name.trim().toLowerCase() === nameLower
            );
            if (duplicate) {
                showConfirmModal(`'${name}' 이름의 클럽이 이미 존재합니다.\n동일한 이름의 클럽은 추가할 수 없습니다.`);
                return;
            }

            const clubId = editingClubId || ('club_' + Date.now());

            // 이름이 실제로 변경된 경우에만 이력 소급 갱신
            const oldName = (editingClubId && AppState.clubRegistry[editingClubId]) ? AppState.clubRegistry[editingClubId].name : null;
            AppState.addOrUpdateClub(clubId, name, budget, priorUsed);
            if (oldName && oldName !== name) {
                AppState.renameClubInHistory(clubId, oldName, name);
            }

            resetClubForm();
            renderClubManagement();
        });
    }

    if (cancelEditClubBtn) {
        cancelEditClubBtn.addEventListener('click', resetClubForm);
    }

    // ── 차트 탭 - 클럽 선택 필터 칩 ──────────────────────────────────
    function renderClubFilters() {
        const container = document.getElementById('club-filter-container');
        if (!container) return;

        const clubs = Object.values(AppState.clubRegistry || {}).sort((a, b) => a.name.localeCompare(b.name));
        const allClubNames = clubs.map(c => c.name);

        if (!selectedOverallClubs) {
            selectedOverallClubs = new Set(allClubNames);
        } else {
            allClubNames.forEach(name => {
                if (!selectedOverallClubs.has(name) && !container.dataset.initialized) {
                    selectedOverallClubs.add(name);
                }
            });
        }
        container.dataset.initialized = '1';

        const allSelected = allClubNames.length > 0 && allClubNames.every(name => selectedOverallClubs.has(name));

        let html = `
            <label class="club-filter-chip ${allSelected ? 'active' : ''}">
                <input type="checkbox" data-overall-select-all ${allSelected ? 'checked' : ''}>
                전체 선택
            </label>
        `;
        clubs.forEach(club => {
            html += `
                <label class="club-filter-chip ${selectedOverallClubs.has(club.name) ? 'active' : ''}">
                    <input type="checkbox" data-overall-filter value="${AppState.escapeHtml(club.name)}" ${selectedOverallClubs.has(club.name) ? 'checked' : ''}>
                    ${AppState.escapeHtml(club.name)}
                </label>
            `;
        });
        container.innerHTML = html;

        const selectAllInput = container.querySelector('input[data-overall-select-all]');
        if (selectAllInput) {
            selectAllInput.addEventListener('change', () => {
                if (selectAllInput.checked) {
                    allClubNames.forEach(name => selectedOverallClubs.add(name));
                } else {
                    selectedOverallClubs.clear();
                }
                renderClubFilters();
                renderAllCharts(lastHistoryList);
            });
        }

        container.querySelectorAll('input[data-overall-filter]').forEach(input => {
            input.addEventListener('change', () => {
                if (input.checked) {
                    selectedOverallClubs.add(input.value);
                } else {
                    selectedOverallClubs.delete(input.value);
                }
                renderClubFilters();
                renderAllCharts(lastHistoryList);
            });
        });
    }

    // ── 차트 탭 상단 KPI 카드 업데이트 ────────────────────────────────────
    function updateChartsBudgetStats(historyList) {
        const totalBudgetEl = document.getElementById('charts-total-budget');
        const usedBudgetEl = document.getElementById('charts-used-budget');
        const remainingBudgetEl = document.getElementById('charts-remaining-budget');
        const countEl = document.getElementById('charts-total-count');
        if (!totalBudgetEl || !usedBudgetEl || !remainingBudgetEl) return;

        const filtered = (historyList || []).filter(e =>
            !selectedOverallClubs || selectedOverallClubs.has(e.clubName || '기본 클럽')
        );

        const totalBudget = Object.values(AppState.clubRegistry || {})
            .filter(c => !selectedOverallClubs || selectedOverallClubs.has(c.name))
            .reduce((sum, c) => sum + (c.budget || 0), 0);
        const usedBudget = filtered.reduce((sum, e) => sum + (e.finalSupportAmount || 0), 0);
        const remaining = totalBudget - usedBudget;

        totalBudgetEl.textContent = SettlementCalculator.formatCurrency(totalBudget);
        usedBudgetEl.textContent = SettlementCalculator.formatCurrency(usedBudget);
        remainingBudgetEl.textContent = SettlementCalculator.formatCurrency(remaining);
        remainingBudgetEl.style.color = remaining < 0 ? '#f87171' : 'var(--color-secondary)';
        if (countEl) countEl.textContent = `${filtered.length}건`;
    }

    let overallMonthlyChartInstance = null;

    // ── 월별 클럽 지출 현황 (막대 그래프) ────────────────────────────────
    // 전체 클럽 선택 시: 월별 x축, 클럽별 막대로 그룹화하여 비교
    // 특정 클럽 선택 시: 해당 클럽의 월별 지출액만 표시
    function renderOverallMonthlyChart(historyList) {
        const canvas = document.getElementById('overall-monthly-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        const palette = [
            'rgba(139, 92, 246, 0.6)',
            'rgba(56, 189, 248, 0.6)',
            'rgba(248, 113, 113, 0.6)',
            'rgba(52, 211, 153, 0.6)',
            'rgba(251, 191, 36, 0.6)',
            'rgba(236, 72, 153, 0.6)',
            'rgba(129, 140, 248, 0.6)'
        ];

        // 월별 x축 + 선택된 클럽별 막대 (중복 선택 가능)
        const monthSet = new Set();
        const clubNames = new Set();
        const spendByMonthClub = {};

        historyList.forEach(entry => {
            const d = entry.settlementDate
                ? new Date(entry.settlementDate + 'T00:00:00')
                : (entry.date ? new Date(entry.date) : new Date(entry.id));
            const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const club = entry.clubName || '기본 클럽';
            monthSet.add(monthKey);
            clubNames.add(club);
            spendByMonthClub[monthKey] = spendByMonthClub[monthKey] || {};
            spendByMonthClub[monthKey][club] = (spendByMonthClub[monthKey][club] || 0) + (entry.totalCost || 0);
        });

        // 클럽 레지스트리에 등록된 클럽도 (지출 0이라도) 표시
        Object.values(AppState.clubRegistry || {}).forEach(club => clubNames.add(club.name));

        const labels = Array.from(monthSet).sort();
        const sortedClubs = Array.from(clubNames)
            .filter(name => !selectedOverallClubs || selectedOverallClubs.has(name))
            .sort((a, b) => a.localeCompare(b));

        const datasets = sortedClubs.map((club, idx) => ({
            label: club,
            data: labels.map(month => (spendByMonthClub[month] && spendByMonthClub[month][club]) || 0),
            backgroundColor: palette[idx % palette.length].replace('0.6', '0.82'),
            borderColor: palette[idx % palette.length].replace('0.6', '1'),
            borderWidth: 0,
            borderRadius: 6,
            borderSkipped: false
        }));

        const stacked = sortedClubs.length > 1;

        if (overallMonthlyChartInstance) overallMonthlyChartInstance.destroy();
        overallMonthlyChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#cbd5e1', boxWidth: 12, boxHeight: 12, borderRadius: 4, padding: 12 } },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: ${SettlementCalculator.formatCurrency(ctx.parsed.y)}`
                        }
                    }
                },
                scales: {
                    x: { stacked, ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                    y: { stacked, ticks: { color: '#94a3b8', callback: v => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
                }
            }
        });
    }

    let clubUsageChartInstance = null;

    // ── 클럽별 예산 소진율 (가로 막대, 공통 필터 사용) ────────────────────
    function renderClubUsageChart(historyList) {
        const canvas = document.getElementById('club-usage-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        const allClubs = Object.values(AppState.clubRegistry || {}).sort((a, b) => a.name.localeCompare(b.name));
        const clubs = allClubs.filter(c => !selectedOverallClubs || selectedOverallClubs.has(c.name));

        // 소진율 높은 순 정렬
        const clubData = clubs.map(club => {
            const spent = (historyList || [])
                .filter(entry => (entry.clubName || '기본 클럽') === club.name)
                .reduce((sum, entry) => sum + (entry.finalSupportAmount || 0), 0);
            const usedTotal = (club.priorUsed || 0) + spent;
            const budget = club.budget || 0;
            const ratio = budget > 0 ? (usedTotal / budget) * 100 : 0;
            return { name: club.name, ratio: Math.round(ratio * 10) / 10, usedTotal, budget };
        }).sort((a, b) => b.ratio - a.ratio);

        const labels = clubData.map(d => d.name);
        const usageRatio = clubData.map(d => d.ratio);
        const usageColors = clubData.map(d =>
            d.ratio >= 100 ? 'rgba(248, 113, 113, 0.85)' :
            d.ratio >= 80  ? 'rgba(251, 191, 36, 0.85)' :
                             'rgba(52, 211, 153, 0.85)'
        );

        if (clubUsageChartInstance) clubUsageChartInstance.destroy();
        if (labels.length === 0) return;

        clubUsageChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: '예산 소진율',
                    data: usageRatio,
                    backgroundColor: usageColors,
                    borderColor: usageColors.map(c => c.replace('0.85', '1')),
                    borderWidth: 0,
                    borderRadius: 8
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const d = clubData[ctx.dataIndex];
                                return [`소진율: ${ctx.parsed.x}%`, `사용: ${SettlementCalculator.formatCurrency(d.usedTotal)}`, `예산: ${SettlementCalculator.formatCurrency(d.budget)}`];
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8', callback: (v) => v + '%' }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, max: 120 },
                    y: { ticks: { color: '#cbd5e1', font: { size: 11 } }, grid: { display: false } }
                }
            }
        });
    }

    let categoryPieChartInstance = null;

    // ── 카테고리별(행사비/시설비/상품) 누적 비용 비중 (도넛, 클럽 필터 적용) ─
    function renderCategoryPieChart(historyList) {
        const canvas = document.getElementById('category-pie-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        const filtered = (historyList || []).filter(e =>
            !selectedOverallClubs || selectedOverallClubs.has(e.clubName || '기본 클럽')
        );

        let eventCost = 0, facilityCost = 0, prizeCost = 0;
        filtered.forEach(entry => {
            (entry.expenseItems || []).forEach(item => {
                const amt = item.amount || 0;
                if (item.category === 'FACILITY') facilityCost += amt;
                else if (item.category === 'PRIZE') prizeCost += amt;
                else eventCost += amt;
            });
        });

        if (categoryPieChartInstance) categoryPieChartInstance.destroy();
        if (eventCost + facilityCost + prizeCost === 0) return;

        const total = eventCost + facilityCost + prizeCost;
        categoryPieChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['행사비', '시설·장비', '상품비'],
                datasets: [{
                    data: [eventCost, facilityCost, prizeCost],
                    backgroundColor: ['rgba(139, 92, 246, 0.88)', 'rgba(56, 189, 248, 0.88)', 'rgba(251, 191, 36, 0.88)'],
                    borderColor: 'rgba(15, 23, 42, 0.6)',
                    borderWidth: 3,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '62%',
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#cbd5e1', padding: 16, font: { size: 12 } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const pct = total > 0 ? Math.round(ctx.parsed / total * 1000) / 10 : 0;
                                return `${ctx.label}: ${SettlementCalculator.formatCurrency(ctx.parsed)} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    let selfPayTrendChartInstance = null;

    // ── 자부담 vs 회사지원금 추이 (월별 영역 그래프, 클럽 필터 적용) ─────────
    function renderSelfPayTrendChart(historyList) {
        const canvas = document.getElementById('selfpay-trend-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        // selectedOverallClubs 필터 적용 (다른 차트와 동일)
        const filtered = (historyList || []).filter(entry =>
            !selectedOverallClubs || selectedOverallClubs.has(entry.clubName || '기본 클럽')
        );

        const byMonth = {};
        filtered.forEach(entry => {
            const d = entry.settlementDate
                ? new Date(entry.settlementDate + 'T00:00:00')
                : (entry.date ? new Date(entry.date) : new Date(entry.id));
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (!byMonth[key]) byMonth[key] = { selfPay: 0, support: 0 };
            byMonth[key].selfPay += entry.totalSelfPay || 0;
            byMonth[key].support += entry.finalSupportAmount || 0;
        });

        const labels = Object.keys(byMonth).sort();

        if (selfPayTrendChartInstance) {
            selfPayTrendChartInstance.destroy();
        }
        if (labels.length === 0) return;

        selfPayTrendChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: '회사 지원금',
                        data: labels.map(k => byMonth[k].support),
                        borderColor: 'rgba(52, 211, 153, 1)',
                        backgroundColor: 'rgba(52, 211, 153, 0.12)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 5,
                        pointHoverRadius: 8,
                        pointBackgroundColor: 'rgba(52, 211, 153, 1)',
                        pointBorderColor: '#0f172a',
                        pointBorderWidth: 2
                    },
                    {
                        label: '자부담 비용',
                        data: labels.map(k => byMonth[k].selfPay),
                        borderColor: 'rgba(248, 113, 113, 1)',
                        backgroundColor: 'rgba(248, 113, 113, 0.12)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 5,
                        pointHoverRadius: 8,
                        pointBackgroundColor: 'rgba(248, 113, 113, 1)',
                        pointBorderColor: '#0f172a',
                        pointBorderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#cbd5e1', boxWidth: 12, boxHeight: 12, borderRadius: 4, padding: 14 } },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: ${SettlementCalculator.formatCurrency(ctx.parsed.y)}`
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                    y: { ticks: { color: '#94a3b8', callback: v => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
                }
            }
        });
    }

    let clubActivityChartInstance = null;

    // ── 클럽별 정산 횟수 (올해 활동량, 가로 막대) ─────────────────────────
    function renderClubActivityChart(historyList) {
        const canvas = document.getElementById('club-activity-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        const currentYear = new Date().getFullYear();
        const countMap = {};
        Object.values(AppState.clubRegistry || {}).forEach(c => { countMap[c.name] = 0; });

        (historyList || [])
            .filter(e => {
                if (!selectedOverallClubs || selectedOverallClubs.has(e.clubName || '기본 클럽')) {
                    const y = e.settlementDate
                        ? parseInt(e.settlementDate.slice(0, 4), 10)
                        : (e.date ? new Date(e.date).getFullYear() : currentYear);
                    return y === currentYear;
                }
                return false;
            })
            .forEach(e => {
                const club = e.clubName || '기본 클럽';
                countMap[club] = (countMap[club] || 0) + 1;
            });

        const sorted = Object.entries(countMap)
            .filter(([name]) => !selectedOverallClubs || selectedOverallClubs.has(name))
            .sort((a, b) => b[1] - a[1]);

        const labels = sorted.map(([name]) => name);
        const counts = sorted.map(([, cnt]) => cnt);

        const palette = [
            'rgba(139,92,246,0.85)', 'rgba(56,189,248,0.85)', 'rgba(52,211,153,0.85)',
            'rgba(251,191,36,0.85)', 'rgba(248,113,113,0.85)', 'rgba(236,72,153,0.85)',
            'rgba(129,140,248,0.85)'
        ];

        if (clubActivityChartInstance) clubActivityChartInstance.destroy();
        if (labels.length === 0) return;

        clubActivityChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: '정산 횟수',
                    data: counts,
                    backgroundColor: labels.map((_, i) => palette[i % palette.length]),
                    borderWidth: 0,
                    borderRadius: 8
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => `정산 ${ctx.parsed.x}건` } }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true },
                    y: { ticks: { color: '#cbd5e1', font: { size: 11 } }, grid: { display: false } }
                }
            }
        });
    }

    // 차트 탭의 모든 그래프를 한 번에 갱신
    function renderAllCharts(historyList) {
        renderOverallMonthlyChart(historyList);
        renderClubUsageChart(historyList);
        renderCategoryPieChart(historyList);
        renderClubActivityChart(historyList);
        renderSelfPayTrendChart(historyList);
    }

    // 클럽별 정산이력 탭 - 정산인(사용자) 선택 드롭다운 (선택된 클럽 기준, 사용자가 2명 이상일 때만 표시)
    function renderAdminUserSelect(historyList, selectedClub) {
        const select = document.getElementById('admin-user-select');
        const group = document.getElementById('admin-user-select-group');
        if (!select || !group) return;
        const current = select.value;
        const scoped = selectedClub
            ? (historyList || []).filter(e => (e.clubName || '기본 클럽') === selectedClub)
            : (historyList || []);
        const names = [...new Set(scoped.map(e => e.creatorName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        if (names.length <= 1) {
            group.classList.add('hidden');
            select.innerHTML = `<option value="">전체 사용자</option>`;
            select.value = '';
            return;
        }
        group.classList.remove('hidden');
        select.innerHTML = `<option value="">전체 사용자</option>` +
            names.map(n => `<option value="${AppState.escapeHtml(n)}">${AppState.escapeHtml(n)}</option>`).join('');
        select.value = names.includes(current) ? current : '';
    }

    function renderAdminHistory(rawHistoryList) {
        // tombstone 캐시로 항상 한 번 더 필터링 — 어떤 경로로 복원돼도 화면에 표시 안 됨
        const historyList = (rawHistoryList || []).filter(e => e && !cachedDeletedIds[String(e.id)]);
        const container = document.getElementById('admin-history-container');
        const clubSelect = document.getElementById('club-history-select');
        const selectedClub = clubSelect ? clubSelect.value : '';
        renderAdminUserSelect(historyList, selectedClub);
        const userSelect = document.getElementById('admin-user-select');
        const selectedUser = userSelect ? userSelect.value : '';
        container.innerHTML = '';

        let filtered = historyList.filter(entry => {
            if (!selectedUser) return true;
            return entry.creatorName === selectedUser;
        });

        if (selectedClub) {
            filtered = filtered.filter(entry => (entry.clubName || '기본 클럽') === selectedClub);
        }
        
        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">💨</span>
                    <p>일치하는 정산 내역이 없습니다.</p>
                </div>
            `;
            return;
        }
        
        let lastMonthKey = null;
        filtered.forEach(entry => {
            if (!selectedClub) {
                const d = entry.settlementDate
                    ? new Date(entry.settlementDate + 'T00:00:00')
                    : (entry.date ? new Date(entry.date) : new Date(entry.id));
                const monthKey = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
                if (monthKey !== lastMonthKey) {
                    lastMonthKey = monthKey;
                    const header = document.createElement('h3');
                    header.style.cssText = 'margin: 0.5rem 0 0; color: var(--color-secondary); font-size: 1rem;';
                    header.textContent = `📅 ${monthKey}`;
                    container.appendChild(header);
                }
            }

            const div = document.createElement('div');
            div.className = 'history-entry';

            let receiptHtml = '';
            if (entry.expenseItems) {
                entry.expenseItems.forEach(item => {
                    if (item.receiptImage) {
                        receiptHtml += `
                            <div style="display:inline-block; margin-top:0.5rem; margin-right:0.5rem; position:relative; text-align:center;">
                                <img src="${item.receiptImage}" class="receipt-thumbnail" alt="영수증 미리보기" data-desc="${AppState.escapeHtml(item.description)}">
                                <span style="display:block; font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem;">${AppState.escapeHtml(item.description)}</span>
                            </div>
                        `;
                    }
                });
            }
            
            let attendeesHtml = '';
            if (entry.attendees) {
                attendeesHtml = entry.attendees.map(att => {
                    const idPart = att.employeeId ? ` (${AppState.escapeHtml(String(att.employeeId))})` : '';
                    return AppState.escapeHtml(att.name) + idPart;
                }).join(', ');
            }
            
            let itemsHtml = '';
            if (entry.expenseItems) {
                itemsHtml = entry.expenseItems.map(item => `
                    <li>
                        <span>${AppState.escapeHtml(item.description)} (${categoryNameMap[item.category]})</span> 
                        <strong>${SettlementCalculator.formatCurrency(item.amount)}</strong>
                    </li>
                `).join('');
            }
            
            const editedBadgeAdmin = entry.isEdited
                ? `<span class="badge-edited">${t('badge.edited')}</span>` : '';
            div.innerHTML = `
                <div class="history-header">
                    <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                        <strong>${AppState.escapeHtml(entry.clubName || t('label.default_club'))}</strong>
                        <span class="history-club admin-edit-creator" data-id="${entry.id}" style="color:var(--color-secondary);cursor:pointer;text-decoration:underline dotted;" title="탭하여 정산인 이름 수정">${t('label.settler')}: ${AppState.escapeHtml(entry.creatorName || t('status.offline'))}</span>
                        ${editedBadgeAdmin}
                    </div>
                    <div style="display:flex;align-items:center;gap:0.4rem;">
                        <span class="history-date">${entry.settlementDate
                            ? (() => {
                                const [y,m,d] = entry.settlementDate.split('-');
                                const savedTime = new Date(entry.id).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
                                return `${y}년 ${Number(m)}월 ${Number(d)}일 (저장 ${savedTime})`;
                              })()
                            : new Date(entry.id).toLocaleString()}</span>
                        <button class="btn-edit-history-admin" data-id="${entry.id}" style="font-size:0.75rem;padding:0.2rem 0.6rem;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;border-radius:0.3rem;cursor:pointer;white-space:nowrap;">✏️ ${t('btn.edit')}</button>
                        <button class="btn-delete-history btn-text-danger" data-id="${entry.id}" style="padding:0.25rem 0.5rem; font-size:0.75rem;">${t('btn.delete')}</button>
                    </div>
                </div>
                <div class="history-summary">
                    <div class="history-stat">
                        <span>${t('hist.total_cost')}</span>
                        <strong>${SettlementCalculator.formatCurrency(entry.totalCost)}</strong>
                    </div>
                    <div class="history-stat">
                        <span>${t('hist.final_support')}</span>
                        <strong>${SettlementCalculator.formatCurrency(entry.finalSupportAmount)}</strong>
                    </div>
                    <div class="history-stat">
                        <span>${t('hist.self_pay')}</span>
                        <strong>${SettlementCalculator.formatCurrency(entry.totalSelfPay)}</strong>
                    </div>
                    <div class="history-stat">
                        <span>${t('hist.per_person_self_pay')} (${t('hist.attendees')}: ${entry.memberCount}${t('unit.person')})</span>
                        <strong>${SettlementCalculator.formatCurrency(entry.perPersonSelfPay)}</strong>
                    </div>
                </div>
                <div class="history-details" style="margin-top:0.5rem;">
                    <details>
                        <summary style="font-size:0.82rem; color:var(--color-secondary); cursor:pointer;">${t('hist.view_details_admin')}</summary>
                        <div style="padding:0.5rem 0; font-size:0.83rem; line-height:1.4;">
                            <strong>${t('hist.attendees_label')}:</strong> <span style="color:var(--text-secondary);">${AppState.escapeHtml(attendeesHtml || t('hist.no_attendees'))}</span>
                            <ul class="history-items" style="margin-top:0.5rem; border-top:1px solid rgba(255,255,255,0.05); padding-top:0.5rem; display:flex; flex-direction:column; gap:0.25rem;">
                                ${itemsHtml}
                            </ul>
                            ${receiptHtml ? `<div style="margin-top:0.75rem; border-top:1px solid rgba(255,255,255,0.05); padding-top:0.5rem;"><strong>영수증:</strong><br>${receiptHtml}</div>` : ''}
                        </div>
                    </details>
                </div>
            `;
            
            container.appendChild(div);
        });
        
        // 정산인 이름 수정 (관리자 전용)
        container.querySelectorAll('.admin-edit-creator').forEach(span => {
            span.addEventListener('click', () => {
                const id = span.getAttribute('data-id');
                const entry = historyList.find(e => String(e.id) === String(id));
                if (!entry) return;
                const current = entry.creatorName || '';
                showEditModal('정산인 이름 수정', '수정할 이름을 입력하세요', current, newName => {
                    if (!newName || !newName.trim() || newName.trim() === current) return;
                    const trimmed = newName.trim();
                    if (!firebaseDb) { alert('Firebase 연결이 필요합니다.'); return; }
                    firebaseDb.ref(`globalHistory/${id}/creatorName`).set(trimmed)
                        .then(() => {
                            entry.creatorName = trimmed;
                            span.textContent = `정산인: ${trimmed}`;
                            // 해당 사용자의 개인 이력도 동기화
                            if (entry.creatorPin) {
                                firebaseDb.ref(`settlements/${entry.creatorPin}/settlementHistory`).once('value').then(snap => {
                                    const raw = snap.val();
                                    if (!raw) return;
                                    const arr = Array.isArray(raw) ? raw : Object.values(raw);
                                    const idx = arr.findIndex(h => h && String(h.id) === String(id));
                                    if (idx >= 0) {
                                        arr[idx].creatorName = trimmed;
                                        firebaseDb.ref(`settlements/${entry.creatorPin}/settlementHistory`).set(arr).catch(() => {});
                                    }
                                }).catch(() => {});
                            }
                        })
                        .catch(() => alert('저장 중 오류가 발생했습니다.'));
                });
            });
        });

        // 정산 기록 삭제 → globalHistory에서 제거 + 참석자 누적 참석 횟수 차감
        container.querySelectorAll('.btn-delete-history').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const entry = historyList.find(e => String(e.id) === String(id));
                if (!entry) return;
                showConfirmModal(
                    `이 정산 기록을 삭제하시겠습니까?\n참석자 ${entry.memberCount}명의 누적 참석 횟수도 함께 차감됩니다.`,
                    () => {

                if (entry.attendees) {
                    entry.attendees.forEach(att => {
                        const cur = AppState.directory[att.name];
                        if (cur && typeof cur === 'object') {
                            cur.count = Math.max(0, (cur.count || 0) - 1);
                        }
                    });
                    AppState.save();
                }

                if (firebaseDb) {
                    const tasks = [
                        // globalHistory에서 제거
                        firebaseDb.ref(`globalHistory/${entry.id}`).remove(),
                        // Tombstone 기록 — 구버전 앱의 backfill이나 어떤 경로로도 복원되지 않도록
                        firebaseDb.ref(`deletedHistoryIds/${entry.id}`).set(true)
                    ];

                    // 정산을 등록한 사용자의 개인 정산 이력에서도 동일 항목 제거 (관리자만 삭제 가능)
                    // Firebase는 배열을 객체({0:...,1:...})로 저장하므로 Array.isArray 대신 Object.values 정규화 필요
                    if (entry.creatorPin) {
                        tasks.push(
                            firebaseDb.ref(`settlements/${entry.creatorPin}/settlementHistory`).once('value').then(snap => {
                                const raw = snap.val();
                                if (!raw) return;
                                const historyArr = Array.isArray(raw) ? raw : Object.values(raw);
                                const filtered = historyArr.filter(h => h && String(h.id) !== String(id));
                                return firebaseDb.ref(`settlements/${entry.creatorPin}/settlementHistory`).set(filtered);
                            })
                        );
                    }

                    Promise.all(tasks).then(() => {
                        cachedDeletedIds[String(id)] = true; // 즉시 메모리 캐시에 반영
                        lastHistoryList = lastHistoryList.filter(e => String(e.id) !== String(id));

                        // 삭제된 항목의 클럽 상품비 누적액을 globalHistory 기준으로 재계산 후 Firebase 갱신
                        const _year = new Date().getFullYear();
                        const _clubName = entry.clubName;
                        const _clubId   = entry.clubId;
                        const _yearFiltered = lastHistoryList.filter(e => {
                            if (!e || e.clubName !== _clubName) return false;
                            const d = e.settlementDate
                                ? new Date(e.settlementDate + 'T00:00:00')
                                : (e.date ? new Date(e.date) : new Date(e.id));
                            return d.getFullYear() === _year;
                        });
                        const _newPrize = _yearFiltered.reduce((s, e) => s + (e.prizeCost || 0), 0);
                        const _newUsed  = _yearFiltered.reduce((s, e) => s + (e.finalSupportAmount || 0), 0);
                        const _regEntry = _clubId
                            ? AppState.clubRegistry[_clubId]
                            : Object.values(AppState.clubRegistry).find(c => c.name === _clubName);
                        const _regClubId = _clubId || Object.keys(AppState.clubRegistry).find(k => AppState.clubRegistry[k] === _regEntry);
                        if (_regEntry && _regClubId && firebaseDb) {
                            _regEntry.prizeUsed  = _newPrize;
                            _regEntry.usedBudget = _newUsed;
                            firebaseDb.ref(`clubRegistry/${_regClubId}`).update({
                                prizeUsed:  _newPrize,
                                usedBudget: _newUsed
                            }).catch(() => {});
                        }

                        renderAdminHistory(lastHistoryList);
                        renderAllCharts(lastHistoryList);
                        updateChartsBudgetStats(lastHistoryList);
                        renderClubManagement();
                    }).catch(() => alert(t('alert.delete_failed_network')));
                }
                    } // end showConfirmModal callback
                ); // end showConfirmModal
            });
        });

        // 관리자 이력 수정 버튼
        container.querySelectorAll('.btn-edit-history-admin').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = Number(btn.getAttribute('data-id'));
                const entry = lastHistoryList.find(e => Number(e.id) === id);
                if (entry) AppState.loadHistoryEntryForEdit(entry);
            });
        });

        // Bind click handlers to receipt thumbnails in admin dashboard
        container.querySelectorAll('.receipt-thumbnail').forEach(img => {
            img.addEventListener('click', (e) => {
                const src = e.target.getAttribute('src');
                const desc = e.target.getAttribute('data-desc');
                const modal = document.getElementById('receipt-modal');
                const modalImg = document.getElementById('modal-img');
                const captionText = document.getElementById('modal-caption');
                
                if (modal && modalImg && captionText) {
                    modal.classList.remove('hidden');
                    modalImg.src = src;
                    captionText.textContent = desc ? `${desc} 영수증` : '영수증 원본';
                }
            });
        });
    }

    // 만약 Firebase DB가 초기화되어 있지 않으면 로그인 버튼 숨기고 기본 오프라인 모드로 설정
    if (!firebaseDb) {
        switchToOfflineMode();
    } else {
        pinModal.classList.remove('hidden');
    }
});


// Diff popup notification helper
// 클럽별 "추가 배정" 금액 입력 팝업
function openAddClubBudgetModal(clubName, onConfirm) {
    const modal = document.getElementById('add-club-budget-modal');
    const titleEl = document.getElementById('add-club-budget-title');
    const input = document.getElementById('add-club-budget-input');
    const confirmBtn = document.getElementById('add-club-budget-confirm-btn');
    const cancelBtn = document.getElementById('add-club-budget-cancel-btn');
    if (!modal || !input || !confirmBtn || !cancelBtn) return;

    titleEl.textContent = `'${clubName}' 추가 배정 금액`;
    input.value = '';
    setupCurrencyInput(input);
    modal.classList.remove('hidden');
    input.focus();

    const close = () => modal.classList.add('hidden');
    const onConfirmClick = () => {
        const amount = parseAmount(input.value);
        close();
        onConfirm(amount);
    };
    confirmBtn.onclick = onConfirmClick;
    cancelBtn.onclick = close;
}

function showDiffPopup(formula, diff) {
    const popup = document.getElementById('diff-popup');
    const formulaEl = document.getElementById('diff-popup-formula');
    if (!popup || !formulaEl) return;

    formulaEl.textContent = formula;
    popup.classList.remove('hidden', 'diff-positive', 'diff-negative');
    popup.classList.add(diff >= 0 ? 'diff-positive' : 'diff-negative');

    clearTimeout(popup._hideTimer);
}

// Image compression helper using Canvas
// xlsx(zip) 안에 이미지를 직접 삽입 (xdr drawing). placements: [{sheetFile:'sheet3.xml', col, row, blob, widthPx, heightPx}]
// 셀 XML을 직접 치환 (기존 서식/스타일(s 속성) 보존, 수식(_xlfn 등) 손상 방지)
function setCellValue(xml, ref, value, isString) {
    const escaped = String(value).replace(/[<>&'"]/g, c => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
    }[c]));

    // 빈 문자열은 inlineStr("")로 채우면 COUNTA가 비어있지 않은 셀로 카운트하므로
    // 진짜 빈 셀(자체 닫힘 <c r="REF" s="N"/>)로 만들어 COUNTA에서 제외되도록 함
    const isEmptyString = isString && String(value) === '';

    // 자체 닫힘 빈 셀: <c r="REF" s="N"/>
    const reSelf = new RegExp(`<c r="${ref}"([^>]*?)/>`);
    const mSelf = xml.match(reSelf);
    if (mSelf) {
        const attrs = mSelf[1].replace(/\st="[^"]*"/, '');
        if (isEmptyString) {
            return xml.replace(reSelf, `<c r="${ref}"${attrs}/>`);
        }
        const replacement = isString
            ? `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`
            : `<c r="${ref}"${attrs}><v>${value}</v></c>`;
        return xml.replace(reSelf, replacement);
    }

    // 내용이 있는 셀(수식 등): <c r="REF" ...>...</c> — 수식을 제거하고 값으로 치환
    const reFull = new RegExp(`<c r="${ref}"([^>]*?)>[\\s\\S]*?</c>`);
    const mFull = xml.match(reFull);
    if (mFull) {
        const attrs = mFull[1].replace(/\st="[^"]*"/, '');
        if (isEmptyString) {
            return xml.replace(reFull, `<c r="${ref}"${attrs}/>`);
        }
        const replacement = isString
            ? `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`
            : `<c r="${ref}"${attrs}><v>${value}</v></c>`;
        return xml.replace(reFull, replacement);
    }

    return xml;
}

async function embedImagesIntoXlsx(zip, placements) {
    if (!placements || placements.length === 0) return;

    const EMU_PER_PX = 9525;
    let ctXml = await zip.file('[Content_Types].xml').async('string');

    const bySheet = {};
    placements.forEach(p => { (bySheet[p.sheetFile] = bySheet[p.sheetFile] || []).push(p); });

    let mediaIndex = 1;
    let drawingIndex = 1;
    const extTypes = new Set();

    for (const [sheetFile, items] of Object.entries(bySheet)) {
        const drawingName = `drawing${drawingIndex}.xml`;
        let anchorsXml = '';
        let relsXml = '';

        for (let i = 0; i < items.length; i++) {
            const p = items[i];
            const ext = (p.blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
            extTypes.add(ext);
            const mediaName = `image${mediaIndex}.${ext}`;
            zip.file(`xl/media/${mediaName}`, await p.blob.arrayBuffer());
            const rId = `rId${i + 1}`;
            relsXml += `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/>`;

            const cx = Math.round(p.widthPx * EMU_PER_PX);
            const cy = Math.round(p.heightPx * EMU_PER_PX);
            anchorsXml += `<xdr:oneCellAnchor><xdr:from><xdr:col>${p.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Picture ${i + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
            mediaIndex++;
        }

        const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchorsXml}</xdr:wsDr>`;
        zip.file(`xl/drawings/${drawingName}`, drawingXml);
        zip.file(`xl/drawings/_rels/${drawingName}.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsXml}</Relationships>`);

        const sheetPath = `xl/worksheets/${sheetFile}`;
        let sheetXml = await zip.file(sheetPath).async('string');
        const sheetRelsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
        let sheetRelsXml;
        let sheetRelId = 'rId1';

        if (zip.file(sheetRelsPath)) {
            sheetRelsXml = await zip.file(sheetRelsPath).async('string');
            const ids = [...sheetRelsXml.matchAll(/Id="rId(\d+)"/g)].map(m => parseInt(m[1], 10));
            const max = ids.length ? Math.max(...ids) : 0;
            sheetRelId = `rId${max + 1}`;
            sheetRelsXml = sheetRelsXml.replace('</Relationships>', `<Relationship Id="${sheetRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingName}"/></Relationships>`);
        } else {
            sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${sheetRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingName}"/></Relationships>`;
        }
        zip.file(sheetRelsPath, sheetRelsXml);

        if (!sheetXml.includes('<drawing ')) {
            sheetXml = sheetXml.replace('</worksheet>', `<drawing r:id="${sheetRelId}"/></worksheet>`);
        }
        zip.file(sheetPath, sheetXml);
        drawingIndex++;
    }

    extTypes.forEach(ext => {
        const ct = ext === 'png' ? 'image/png' : (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
        if (!ctXml.includes(`Extension="${ext}"`)) {
            ctXml = ctXml.replace('</Types>', `<Default Extension="${ext}" ContentType="${ct}"/></Types>`);
        }
    });
    for (let d = 1; d < drawingIndex; d++) {
        const part = `/xl/drawings/drawing${d}.xml`;
        if (!ctXml.includes(part)) {
            ctXml = ctXml.replace('</Types>', `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
        }
    }
    zip.file('[Content_Types].xml', ctXml);
}

// 결제 카드 종류에 따라 입력 폼의 영수증/분리결제 영역을 표시/숨김 처리하고
// 분리 결제 시 개인카드 부담액(총금액 - 법인카드금액)을 자동 계산해 표시
function updateCardTypeUI() {
    const corpCheck = document.getElementById('expense-corp-check');
    const personalCheck = document.getElementById('expense-personal-check');
    const corpAmountGroup = document.getElementById('corp-amount-group');
    const personalAmountGroup = document.getElementById('personal-amount-group');
    const corpReceiptGroup = document.getElementById('corp-receipt-group');
    const personalReceiptGroup = document.getElementById('personal-receipt-group');
    const splitAutoHint = document.getElementById('split-auto-hint');
    const personalAmountInput = document.getElementById('expense-personal-amount-input');
    const corpAmountInput = document.getElementById('expense-corporate-amount-input');
    if (!corpCheck || !personalCheck) return;

    const corpOn = corpCheck.checked;
    const personalOn = personalCheck.checked;

    // 상품비: 반드시 법인카드만, 개인카드 사용 불가
    const category = (document.getElementById('expense-category-select') || {}).value || '';
    const isPrize = category === ExpenseCategory.PRIZE;
    const personalToggleLabel = personalCheck.closest ? personalCheck.closest('label') : null;
    if (isPrize) {
        corpCheck.checked = true;
        personalCheck.checked = false;
        personalCheck.disabled = true;
        if (personalToggleLabel) { personalToggleLabel.style.opacity = '0.35'; personalToggleLabel.style.pointerEvents = 'none'; }
        // 상품비: 법인카드 그룹만 표시, 개인카드 완전 숨김
        corpAmountGroup.classList.remove('hidden');
        personalAmountGroup.classList.add('hidden');
        corpReceiptGroup.classList.remove('hidden');
        personalReceiptGroup.classList.add('hidden');
        if (splitAutoHint) splitAutoHint.style.display = 'none';
        const total = parseAmount((document.getElementById('expense-amount-input') || {}).value || '0') || 0;
        const corpAmountInput = document.getElementById('expense-corporate-amount-input');
        if (corpAmountInput) {
            corpAmountInput.readOnly = false;
            corpAmountInput.style.opacity = '';
        }
        if (personalAmountInput) { personalAmountInput.value = '0'; }
        const corpExtraHint = document.getElementById('corp-extra-hint');
        if (corpExtraHint) corpExtraHint.style.display = 'none';
        return;
    } else {
        personalCheck.disabled = false;
        if (personalToggleLabel) { personalToggleLabel.style.opacity = ''; personalToggleLabel.style.pointerEvents = ''; }
    }

    if (!corpOn && !personalOn) {
        corpCheck.checked = true;
        return updateCardTypeUI();
    }

    const total = parseAmount((document.getElementById('expense-amount-input') || {}).value || '0') || 0;
    const corpExtraHint = document.getElementById('corp-extra-hint');

    if (corpOn) {
        corpAmountGroup.classList.remove('hidden');
        personalAmountGroup.classList.remove('hidden');
        corpReceiptGroup.classList.remove('hidden');
        personalReceiptGroup.classList.toggle('hidden', !personalOn);
        if (splitAutoHint) splitAutoHint.style.display = (personalOn && total > 0) ? '' : 'none';

        if (corpAmountInput) { corpAmountInput.readOnly = false; corpAmountInput.style.opacity = ''; }

        const corp = parseAmount(corpAmountInput ? corpAmountInput.value : '0') || 0;
        if (personalAmountInput) {
            personalAmountInput.value = total > 0 ? formatAmount(Math.max(total - corp, 0)) : '';
            personalAmountInput.readOnly = true;
            personalAmountInput.style.opacity = '0.65';
        }

        // 법인카드 구간 한도보다 적게 입력했을 때 추가 사용 가능 금액 안내
        if (corpExtraHint && total > 0) {
            const category = (document.getElementById('expense-category-select') || {}).value || 'EVENT';
            const corpLimit = _calcCorpForItem(total, category);
            const remaining = corpLimit - corp;
            if (remaining > 0 && corp < total) {
                corpExtraHint.textContent = `💳 ${formatAmount(remaining)}원 더 법인카드로 결제할 수 있습니다`;
                corpExtraHint.style.display = '';
            } else {
                corpExtraHint.style.display = 'none';
            }
        } else if (corpExtraHint) {
            corpExtraHint.style.display = 'none';
        }
    } else {
        corpAmountGroup.classList.add('hidden');
        personalAmountGroup.classList.remove('hidden');
        corpReceiptGroup.classList.add('hidden');
        personalReceiptGroup.classList.remove('hidden');
        if (splitAutoHint) splitAutoHint.style.display = 'none';

        if (corpAmountInput) { corpAmountInput.readOnly = false; corpAmountInput.style.opacity = ''; }
        if (personalAmountInput) {
            personalAmountInput.value = total > 0 ? formatAmount(total) : '';
            personalAmountInput.readOnly = true;
            personalAmountInput.style.opacity = '0.65';
        }
    }
}

// 시설·장비 사전 승인 여부 (카테고리 변경 시 초기화)
let _facilityApproved = false;

// 시설·장비 승인 모달 표시 후 콜백 실행
function showFacilityApprovalModal(onApproved, onNoApproval) {
    const modal = document.getElementById('facility-approval-modal');
    if (!modal) { onApproved(); return; }
    // 관리자 설정 facilityLimit 값을 동적으로 반영
    const limit = (AppState.rules || DefaultRules).facilityLimit || 85000;
    const limitEl = modal.querySelector('#facility-modal-limit');
    if (limitEl) limitEl.textContent = limit.toLocaleString() + '원';
    modal.style.display = 'flex';
    const approvedBtn = document.getElementById('facility-approved-btn');
    const noBtn = document.getElementById('facility-no-approval-btn');
    const close = () => { modal.style.display = 'none'; };
    const onApprovedClick = () => { close(); approvedBtn.removeEventListener('click', onApprovedClick); noBtn.removeEventListener('click', onNoClick); onApproved(); };
    const onNoClick    = () => { close(); approvedBtn.removeEventListener('click', onApprovedClick); noBtn.removeEventListener('click', onNoClick); onNoApproval(); };
    approvedBtn.addEventListener('click', onApprovedClick);
    noBtn.addEventListener('click', onNoClick);
}

// 기존 항목 누적 + 클럽 잔여 예산 한도를 고려하여 신규/수정 항목의 법인카드 한도 계산
function _calcCorpForItem(amount, category) {
    const memberCount = AppState.memberCount || 0;
    const rules = AppState.rules || DefaultRules;
    if (amount <= 0) return 0;

    // 시설·장비: 사전 승인 완료 시 facilityLimit(기본 85,000원)까지만 법인카드
    if (category === ExpenseCategory.FACILITY && _facilityApproved) {
        return Math.min(amount, rules.facilityLimit || 85000);
    }

    if (memberCount <= 0) return amount; // 인원 미설정 시 전액 법인

    // 클럽 잔여 예산 (이번 세션 이전까지 남은 예산)
    const clubBudget = AppState.getClubBudget ? AppState.getClubBudget() : 0;
    const clubUsed = AppState.getClubUsedBudget ? AppState.getClubUsedBudget() : 0;
    const availableBudget = clubBudget > 0 ? Math.max(0, clubBudget - clubUsed) : Infinity;

    // 현재 편집 중인 항목은 기존 항목에서 제외
    const editingId = AppState.editingItemId || null;
    const existingItems = (AppState.expenseItems || []).filter(item => item.id !== editingId);

    const newItem = { amount, category };
    const allItems = [...existingItems, newItem];

    const resultAll = SettlementCalculator.calculate(memberCount, allItems, 0, rules);
    const resultExisting = existingItems.length > 0
        ? SettlementCalculator.calculate(memberCount, existingItems, 0, rules)
        : { finalSupportAmount: 0 };

    // 클럽 예산 한도 적용
    const corpAllCapped = Math.min(resultAll.finalSupportAmount, availableBudget);
    const corpExistingCapped = Math.min(resultExisting.finalSupportAmount, availableBudget);

    const corp = corpAllCapped - corpExistingCapped;
    return Math.max(0, Math.min(corp, amount));
}

// 금액·카테고리 변경 시 구간별 계산으로 법인/개인 토글 자동 설정 + 법인카드 금액 계산
function autoSetTogglesAndCorp() {
    const total = parseAmount((document.getElementById('expense-amount-input') || {}).value || '0') || 0;
    const category = (document.getElementById('expense-category-select') || {}).value || 'EVENT';
    const corpCheck = document.getElementById('expense-corp-check');
    const personalCheck = document.getElementById('expense-personal-check');
    const corpAmountInput = document.getElementById('expense-corporate-amount-input');
    if (!corpCheck || !personalCheck || !corpAmountInput) return;

    if (total <= 0) {
        corpCheck.checked = true;
        personalCheck.checked = false;
        corpAmountInput.value = '';
        return;
    }

    const corp = _calcCorpForItem(total, category);
    corpAmountInput.value = corp > 0 ? formatAmount(corp) : '';

    // 상품비: 반드시 법인카드만
    if (category === ExpenseCategory.PRIZE) {
        corpCheck.checked = true;
        personalCheck.checked = false;
    } else if (corp >= total) {
        corpCheck.checked = true;
        personalCheck.checked = false;
    } else if (corp > 0) {
        corpCheck.checked = true;
        personalCheck.checked = true;
    } else {
        corpCheck.checked = false;
        personalCheck.checked = true;
    }
}

// 법인카드 토글 수동 ON 시 금액만 재계산 (토글은 건드리지 않음)
function resetCorpAmount() {
    const corpCheck = document.getElementById('expense-corp-check');
    if (!corpCheck || !corpCheck.checked) return;
    const corpAmountInput = document.getElementById('expense-corporate-amount-input');
    if (!corpAmountInput) return;
    const total = parseAmount((document.getElementById('expense-amount-input') || {}).value || '0') || 0;
    const category = (document.getElementById('expense-category-select') || {}).value || 'EVENT';

    const corp = _calcCorpForItem(total, category);
    corpAmountInput.value = corp > 0 ? formatAmount(corp) : '';
}

// 텍스트 입력 모달 (관리자 인라인 수정용)
function showEditModal(title, hint, defaultValue, onConfirm) {
    const existing = document.getElementById('edit-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'edit-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;';
    overlay.innerHTML = `
        <div style="background:var(--card-bg,#1e1e2e);border:2px solid rgba(99,102,241,0.55);border-radius:1rem;padding:1.5rem;width:min(90vw,360px);box-shadow:0 12px 48px rgba(0,0,0,0.7);">
            <div style="font-size:1rem;font-weight:700;color:#c7d2fe;margin-bottom:0.75rem;">✏️ ${title}</div>
            <div style="font-size:0.8rem;color:var(--text-muted,#94a3b8);margin-bottom:0.5rem;">${hint}</div>
            <input id="edit-modal-input" type="text" value="${defaultValue.replace(/"/g,'&quot;')}" style="width:100%;box-sizing:border-box;padding:0.5rem 0.75rem;border-radius:0.5rem;border:1px solid rgba(99,102,241,0.5);background:rgba(255,255,255,0.05);color:#e2e8f0;font-size:0.95rem;outline:none;margin-bottom:1rem;">
            <div style="display:flex;gap:0.5rem;justify-content:flex-end;">
                <button id="edit-modal-cancel" style="padding:0.4rem 1rem;border-radius:0.5rem;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#94a3b8;cursor:pointer;">취소</button>
                <button id="edit-modal-ok" style="padding:0.4rem 1rem;border-radius:0.5rem;border:2px solid rgba(99,102,241,0.65);background:rgba(99,102,241,0.25);color:#c7d2fe;cursor:pointer;font-weight:600;">저장</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#edit-modal-input');
    const okBtn = overlay.querySelector('#edit-modal-ok');
    const cancelBtn = overlay.querySelector('#edit-modal-cancel');

    setTimeout(() => { input.focus(); input.select(); }, 50);

    const close = () => overlay.remove();
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    okBtn.addEventListener('click', () => { close(); onConfirm(input.value); });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { close(); onConfirm(input.value); }
        if (e.key === 'Escape') close();
    });
}

// 확인 커스텀 모달 (테마 적용)
// okLabel 미지정 → 삭제 스타일(빨강), 지정 시 확인 스타일(파랑)
function showConfirmModal(message, onConfirm, okLabel) {
    const overlay   = document.getElementById('confirm-modal-overlay');
    const msgEl     = document.getElementById('confirm-modal-msg');
    const okBtn     = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    if (!overlay || !msgEl) { if (confirm(message)) onConfirm && onConfirm(); return; }

    const isDelete = !okLabel;
    const box      = document.getElementById('confirm-modal-box');
    const iconEl   = document.getElementById('confirm-modal-icon');
    const titleEl  = document.getElementById('confirm-modal-title');

    msgEl.textContent = message;

    if (isDelete) {
        if (box)    box.style.borderColor   = 'rgba(239,68,68,0.55)';
        if (box)    box.style.boxShadow     = '0 0 40px rgba(239,68,68,0.22), 0 12px 48px rgba(0,0,0,0.7)';
        if (iconEl) iconEl.textContent      = '🗑️';
        if (titleEl){ titleEl.textContent   = '삭제 확인'; titleEl.style.color = 'rgba(239,68,68,0.7)'; }
        okBtn.textContent     = '삭제';
        okBtn.style.background = 'rgba(239,68,68,0.25)';
        okBtn.style.border     = '2px solid rgba(239,68,68,0.65)';
        okBtn.style.color      = '#fca5a5';
    } else {
        if (box)    box.style.borderColor   = 'rgba(99,102,241,0.55)';
        if (box)    box.style.boxShadow     = '0 0 40px rgba(99,102,241,0.18), 0 12px 48px rgba(0,0,0,0.7)';
        if (iconEl) iconEl.textContent      = '✅';
        if (titleEl){ titleEl.textContent   = '확인'; titleEl.style.color = 'rgba(99,102,241,0.8)'; }
        okBtn.textContent     = okLabel;
        okBtn.style.background = 'rgba(99,102,241,0.25)';
        okBtn.style.border     = '2px solid rgba(99,102,241,0.65)';
        okBtn.style.color      = '#c7d2fe';
    }

    overlay.style.display = 'flex';

    const close = () => {
        overlay.style.display = 'none';
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', handleCancel);
        overlay.removeEventListener('click', handleOverlay);
        document.removeEventListener('keydown', handleKey);
    };
    const handleOk      = () => { close(); onConfirm && onConfirm(); };
    const handleCancel  = () => close();
    const handleOverlay = (e) => { if (e.target === overlay) close(); };
    const handleKey     = (e) => { if (e.key === 'Escape') close(); };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', handleOverlay);
    document.addEventListener('keydown', handleKey);
}

function showPrizeModal(message, onOk, type) {
    const overlay = document.getElementById('prize-modal-overlay');
    const msgEl = document.getElementById('prize-modal-msg');
    const iconEl = document.getElementById('prize-modal-icon');
    if (!overlay || !msgEl) { alert(message); if (onOk) onOk(); return; }

    msgEl.textContent = message;
    if (iconEl) iconEl.textContent = type === 'block' ? '🚫' : type === 'warn' ? '⚠️' : '🎁';
    overlay.style.display = 'flex';

    const okBtn = document.getElementById('prize-modal-ok');
    const handler = () => {
        overlay.style.display = 'none';
        okBtn.removeEventListener('click', handler);
        if (onOk) onOk();
    };
    okBtn.addEventListener('click', handler);
}

function compressReceiptImage(file, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const maxWidth = 600;
            
            if (width > maxWidth) {
                height = (maxWidth / width) * height;
                width = maxWidth;
            }
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            // Compress to JPEG with 0.7 quality to stay within localStorage limits
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
            callback(compressedDataUrl);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
