/**
 * Club Expense Settlement App - Main JavaScript Logic
 */

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
    // 플레이스홀더 상태가 아닌 경우에만 Firebase 초기화 실행
    if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY") {
        firebase.initializeApp(firebaseConfig);
        firebaseDb = firebase.database();
        console.log("Firebase Realtime Database initialized successfully.");
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
    deduction4: 85000    // 라. 초과 시 자부담 공제액 (8만 5천 원)
};

// --- 2. Settlement Calculator Logic ---
const SettlementCalculator = {
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

        if (prizeCost > 0 && memberCount < 20) {
            warnings.push("정회원 20명 이상 참석 시에만 상품비 사용이 가능합니다.");
        }

        if (prizeCost + previousPrizeTotal > 500000) {
            const exceeded = (prizeCost + previousPrizeTotal) - 500000;
            warnings.push(`상품비 연간 한도 500,000원을 초과했습니다. 초과 금액: ${this.formatCurrency(exceeded)}`);
        }

        if (facilityCost > 1000000) {
            warnings.push("시설 및 장비 이용료가 1,000,000원을 초과하여 별도 협의가 필요합니다.");
        }

        return {
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
};

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
    eventPhoto: null,
    clubName: '',
    settlementHistory: [],
    clubRegistry: {},
    clubTotalBudget: 0,

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
            const savedPrevPrize = localStorage.getItem('club_expense_prev_prize');
            if (savedPrevPrize) {
                this.previousPrizeTotal = parseInt(savedPrevPrize, 10) || 0;
            }
            const savedRules = localStorage.getItem('club_expense_rules');
            if (savedRules) {
                const parsedRules = JSON.parse(savedRules);
                if (parsedRules && typeof parsedRules === 'object') this.rules = parsedRules;
            }
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
            const savedAnnualBudget = localStorage.getItem('club_annual_budget');
            if (savedAnnualBudget) this.annualBudget = parseInt(savedAnnualBudget, 10) || 0;
            const savedUsedBudget = localStorage.getItem('club_used_budget');
            if (savedUsedBudget) this.usedBudget = parseInt(savedUsedBudget, 10) || 0;
            const savedReportEmail = localStorage.getItem('club_report_email');
            if (savedReportEmail) this.reportEmail = savedReportEmail;
            const savedEventPhoto = localStorage.getItem('club_event_photo');
            if (savedEventPhoto) this.eventPhoto = savedEventPhoto;
            const savedClubName = localStorage.getItem('club_name');
            if (savedClubName) this.clubName = savedClubName;
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
            Object.keys(this.directory).forEach(name => {
                const entry = this.directory[name];
                if (typeof entry === 'object') {
                    entry.count = 0;
                } else {
                    this.directory[name] = { id: entry, count: 0 };
                }
            });
            this.directoryCountYear = currentYear;
            localStorage.setItem('club_directory_count_year', currentYear.toString());
            this.save();
        }
    },

    // 전사원 명부 일괄 등록: 기존에 등록된 이름은 건드리지 않고, 새 이름만 추가
    bulkImportDirectory(list) {
        let added = 0;
        let updated = 0;
        list.forEach(([name, employeeId]) => {
            if (!name || !employeeId) return;
            const entry = this.directory[name];
            if (entry === undefined) {
                this.directory[name] = { id: employeeId, count: 0 };
                added++;
            } else if (typeof entry === 'object' && entry.id !== employeeId && !/^\d{4}$/.test(String(entry.id))) {
                entry.id = employeeId;
                updated++;
            }
        });
        if (added || updated) this.save();
        this.render();
        this.updateDatalist();
        return added;
    },

    save() {
        // 1. 로컬 백업 저장 (오프라인 상태 대비)
        try {
            localStorage.setItem('club_expense_items', JSON.stringify(this.expenseItems));
            localStorage.setItem('club_expense_members', this.memberCount.toString());
            localStorage.setItem('club_expense_prev_prize', this.previousPrizeTotal.toString());
            localStorage.setItem('club_expense_rules', JSON.stringify(this.rules));
            localStorage.setItem('club_expense_attendees', JSON.stringify(this.attendees));
            localStorage.setItem('club_expense_directory', JSON.stringify(this.directory));
            localStorage.setItem('club_annual_budget', this.annualBudget.toString());
            localStorage.setItem('club_used_budget', this.usedBudget.toString());
            localStorage.setItem('club_report_email', this.reportEmail || '');
            localStorage.setItem('club_name', this.clubName);
            try { localStorage.setItem('club_settlement_history', JSON.stringify(this.settlementHistory)); } catch(_) {}
            if (this.eventPhoto) {
                try { localStorage.setItem('club_event_photo', this.eventPhoto); } catch(_) {}
            } else {
                localStorage.removeItem('club_event_photo');
            }
        } catch (e) {
            console.error("Local storage save failed:", e);
        }

        // 2. Firebase 온라인 실시간 클라우드 동기화
        if (this.isLoggedIn && this.firebaseDb && this.currentPin) {
            const dataToSync = {
                memberCount: this.memberCount,
                previousPrizeTotal: this.previousPrizeTotal,
                expenseItems: this.expenseItems,
                attendees: this.attendees,
                directory: this.directory,
                rules: this.rules,
                annualBudget: this.annualBudget,
                usedBudget: this.usedBudget,
                clubName: this.clubName,
                reportEmail: this.reportEmail || '',
                settlementHistory: this.settlementHistory,
                eventPhoto: this.eventPhoto || null,
                lastUpdated: Date.now()
            };
            this.firebaseDb.ref(`settlements/${this.currentPin}`).set(dataToSync)
                .catch(err => console.error("Firebase sync failed:", err));
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
                resolve(true);
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

                    this.firebaseDb.ref(`settlements/${pin}`).once('value')
                        .then(snapshot => {
                            const data = snapshot.val();
                            if (data) {
                                // Firebase 데이터가 있을 경우 덮어쓰기
                                if (data.expenseItems) this.expenseItems = data.expenseItems;
                                if (data.memberCount !== undefined) this.memberCount = data.memberCount;
                                if (data.previousPrizeTotal !== undefined) this.previousPrizeTotal = data.previousPrizeTotal;
                                if (data.rules) this.rules = data.rules;
                                if (data.attendees) this.attendees = data.attendees;
                                if (data.directory) this.directory = data.directory;
                                if (data.annualBudget !== undefined) this.annualBudget = data.annualBudget;
                                if (data.usedBudget !== undefined) this.usedBudget = data.usedBudget;
                                if (data.clubName !== undefined) this.clubName = data.clubName;
                                if (data.reportEmail !== undefined) this.reportEmail = data.reportEmail;
                                if (data.settlementHistory) this.settlementHistory = data.settlementHistory;
                                if (data.eventPhoto) this.eventPhoto = data.eventPhoto;
                                console.log(`Firebase data loaded successfully for PIN: ${pin} (${this.userName})`);
                            } else {
                                // Firebase에 데이터가 없을 경우 현재의 로컬 상태를 클라우드에 생성
                                console.log(`No existing data on Firebase for PIN: ${pin}. Uploading current local state.`);
                                this.isLoggedIn = true;
                                this.currentPin = pin;
                                this.save();
                            }
                            this.isLoggedIn = true;
                            this.currentPin = pin;

                            // 번들된 전사원 데이터 중 누락된 사람을 클라우드 명부에도 병합
                            fetch('./lib/employee_directory.json')
                                .then(res => res.json())
                                .then(list => this.bulkImportDirectory(list))
                                .catch(err => console.error("전사원 명부 자동 등록 실패:", err))
                                .finally(() => resolve(true));
                        })
                        .catch(err => reject(err));
                })
                .catch(err => reject(err));
        });
    },

    // ── 클럽 레지스트리 (관리자가 등록한 전체 클럽 목록 + 예산 분배) ──────────────
    loadClubRegistry() {
        if (!this.firebaseDb) return Promise.resolve();
        return this.firebaseDb.ref('clubRegistry').once('value').then(snapshot => {
            this.clubRegistry = snapshot.val() || {};
        }).then(() => this.firebaseDb.ref('clubTotalBudget').once('value')).then(snapshot => {
            this.clubTotalBudget = snapshot.val() || 0;
        }).catch(err => console.error("클럽 레지스트리 로딩 실패:", err));
    },

    saveClubRegistry() {
        if (!this.firebaseDb) return;
        this.firebaseDb.ref('clubRegistry').set(this.clubRegistry).catch(err => console.error("클럽 레지스트리 저장 실패:", err));
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

    addOrUpdateClub(clubId, name, budget, priorUsed) {
        this.clubRegistry[clubId] = { name: name.trim(), budget: Math.max(0, budget || 0), priorUsed: Math.max(0, priorUsed || 0) };
        this.saveClubRegistry();
    },

    deleteClub(clubId) {
        delete this.clubRegistry[clubId];
        this.saveClubRegistry();
    },

    // 선택된 클럽의 배정 예산을 현재 사용자의 "올해 클럽 지원 총예산"에 동기화
    syncBudgetFromClub(clubName) {
        const club = Object.values(this.clubRegistry).find(c => c.name === clubName);
        if (club) {
            this.annualBudget = club.budget;
            // 아직 정산을 진행하지 않은 상태(누적 사용금액 0)라면, 관리자가 입력한
            // "이전 사용 금액"을 초기값으로 동기화
            if (this.usedBudget === 0 && club.priorUsed) {
                this.usedBudget = club.priorUsed;
            }
            this.save();
        }
    },

    addExpense(description, amount, category, corpChecked, personalChecked, corporateAmountInput) {
        let cardType, corpAmount, personalAmount, receiptImage, corporateReceiptImage, personalReceiptImage;

        if (corpChecked && personalChecked) {
            cardType = 'split';
            corpAmount = Math.min(Math.max(corporateAmountInput || 0, 0), amount);
            personalAmount = amount - corpAmount;
            receiptImage = null;
            corporateReceiptImage = this.tempCorpReceiptImage;
            personalReceiptImage = this.tempPersonalReceiptImage;
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
        this.cancelEdit();
        this.save();
        this.render();
    },

    startEditExpense(id) {
        const item = this.expenseItems.find(item => item.id === id);
        if (item) {
            this.editingItemId = id;
            document.getElementById('expense-desc-input').value = item.description;
            document.getElementById('expense-amount-input').value = item.amount;
            document.getElementById('expense-category-select').value = item.category;

            // Card type / split payment
            const cardType = item.cardType || 'corporate';
            document.getElementById('expense-corp-check').checked = (cardType === 'corporate' || cardType === 'split');
            document.getElementById('expense-personal-check').checked = (cardType === 'personal' || cardType === 'split');
            document.getElementById('expense-corporate-amount-input').value = item.corporateAmount ?? '';
            document.getElementById('expense-personal-amount-input').value = item.personalAmount ?? '';

            // Load receipt preview status
            this.tempCorpReceiptImage = (cardType === 'split') ? (item.corporateReceiptImage || null) : (cardType === 'corporate' ? (item.receiptImage || null) : null);
            this.tempPersonalReceiptImage = (cardType === 'split') ? (item.personalReceiptImage || null) : (cardType === 'personal' ? (item.receiptImage || null) : null);

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
        const datalist = document.getElementById('member-suggestions');
        if (datalist) {
            datalist.innerHTML = '';
            Object.keys(this.directory).forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                datalist.appendChild(option);
            });
        }
    },

    deleteFromDirectory(name) {
        if (this.userName !== '관리자' && this.currentPin !== '002531') {
            alert("명부 삭제는 관리자 또는 개발자만 가능합니다.");
            return;
        }
        try {
            delete this.directory[name];
            if (this.editingDirName === name) {
                this.cancelEditDirectory();
            }
            this.save();
            this.render();
            this.updateDatalist();
        } catch (error) {
            console.error("Error encountered in deleteFromDirectory:", error);
        }
    },

    addDirectoryEntry(name, employeeId) {
        if (this.editingDirName !== null) {
            const currentData = this.directory[this.editingDirName];
            const currentCount = typeof currentData === 'object' ? (currentData.count || 0) : 1;
            
            if (this.editingDirName !== name) {
                delete this.directory[this.editingDirName];
            }
            this.directory[name] = { id: employeeId, count: currentCount };
        } else {
            this.directory[name] = { id: employeeId, count: 0 };
        }
        this.cancelEditDirectory();
        this.save();
        this.render();
        this.updateDatalist();
    },

    startEditDirectory(name) {
        if (this.userName !== '관리자') {
            alert("이름/사번 수정은 관리자만 가능합니다.");
            return;
        }
        const data = this.directory[name];
        if (data !== undefined) {
            this.editingDirName = name;
            const idVal = typeof data === 'object' ? data.id : data;
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
        this.render();
    },

    resetRules() {
        this.rules = { ...DefaultRules };
        this.save();
        this.render();
    },

    clearClubData() {
        this.expenseItems = [];
        this.attendees = [];
        this.memberCount = 0;
        this.previousPrizeTotal = 0;
        this.eventPhoto = null;
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

        // Update Results UI
        document.getElementById('result-final-support').textContent = SettlementCalculator.formatCurrency(result.finalSupportAmount);
        
        const selfPayInput = document.getElementById('result-total-self-pay-input');
        if (selfPayInput) {
            if (document.activeElement !== selfPayInput) {
                selfPayInput.value = Math.round(result.totalSelfPay);
                this.lastCalculatedSelfPay = Math.round(result.totalSelfPay);
            }
        }
        
        document.getElementById('result-per-person-self-pay').textContent = SettlementCalculator.formatCurrency(result.perPersonSelfPay);
        document.getElementById('result-self-pay-ratio').textContent = `${(result.selfPayRatio * 100).toFixed(1)}%`;
        document.getElementById('result-total-cost').textContent = SettlementCalculator.formatCurrency(result.totalCost);
        document.getElementById('result-event-cost').textContent = SettlementCalculator.formatCurrency(result.eventCost);
        document.getElementById('result-facility-cost').textContent = SettlementCalculator.formatCurrency(result.facilityCost);
        document.getElementById('result-prize-cost').textContent = SettlementCalculator.formatCurrency(result.prizeCost);
        document.getElementById('result-per-person-event-cost').textContent = SettlementCalculator.formatCurrency(result.perPersonEventCost);

        // Budget remaining calculation
        const budgetSection = document.getElementById('budget-result-section');
        if (budgetSection) {
            if (this.annualBudget > 0) {
                const prevRemaining = this.annualBudget - this.usedBudget;
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
        const eventPhotoImg = document.getElementById('event-photo-img');
        if (eventPhotoPreview && eventPhotoImg) {
            if (this.eventPhoto) {
                eventPhotoImg.src = this.eventPhoto;
                eventPhotoPreview.classList.remove('hidden');
            } else {
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
        if (dirBadgeCount) dirBadgeCount.textContent = Object.keys(this.directory).length;

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
                    <p>등록된 비용 항목이 없습니다. 항목을 추가해 주세요.</p>
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
                    receiptControlHtml = '';
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
                    this.deleteExpense(id);
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
                        <p>현재 등록된 참석자가 없습니다. 왼쪽에서 사번과 이름을 기입하여 추가해 주세요.</p>
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
                        this.deleteAttendee(id);
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
                        <p style="font-size: 0.8rem;">등록된 사원 정보가 없습니다.</p>
                    </div>
                `;
            } else {
                dirKeys.forEach(name => {
                    const entry = this.directory[name];
                    const idValue = typeof entry === 'object' ? entry.id : entry;
                    const countValue = typeof entry === 'object' ? (entry.count || 0) : 0;
                    const isAdded = this.attendees.some(att => att.name === name);
                    
                    const row = document.createElement('div');
                    row.className = 'expense-row';
                    row.style.padding = '0.5rem 0.75rem';
                    row.style.cursor = 'pointer';
                    
                    const addBtnHtml = isAdded
                        ? `<button class="btn-primary-sm" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background: var(--text-muted); cursor: not-allowed;" disabled>✓ 추가됨</button>`
                        : `<button class="btn-add-to-current btn-primary-sm" data-name="${this.escapeHtml(name)}" data-id="${this.escapeHtml(idValue)}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">추가</button>`;

                    const canDeleteDir = (this.userName === '관리자' || this.currentPin === '002531');
                    const deleteDirBtnHtml = canDeleteDir
                        ? `<button class="btn-delete-from-directory btn-delete btn-text-danger" data-name="${this.escapeHtml(name)}" style="padding: 0.5rem; font-size: 1.1rem; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(239, 68, 68, 0.1); margin-left: 0.5rem;" title="명부에서 삭제">&times;</button>`
                        : '';

                    row.innerHTML = `
                        <div class="expense-row-left">
                            <span class="expense-row-title" style="font-size: 0.88rem;">
                                ${this.escapeHtml(name)}
                                <span style="font-size: 0.72rem; color: var(--color-secondary); font-weight: 600; margin-left: 0.3rem;">(올해 누적: <input type="number" class="dir-count-input" data-name="${this.escapeHtml(name)}" value="${countValue}" min="0" style="width:34px; padding:0 2px; font-size:0.72rem; font-weight:700; color:var(--color-secondary); background:transparent; border:none; border-bottom:1px dashed var(--color-secondary); outline:none; text-align:center; -moz-appearance:textfield; appearance:textfield;">회)</span>
                            </span>
                            <span style="font-size: 0.75rem; color: var(--text-secondary);">EMP ID: ${this.escapeHtml(idValue)}</span>
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
                        const newCount = Math.max(0, parseInt(input.value, 10) || 0);
                        input.value = newCount;
                        if (this.directory[dirName] !== undefined) {
                            const cur = this.directory[dirName];
                            const curId = typeof cur === 'object' ? cur.id : cur;
                            this.directory[dirName] = { id: curId, count: newCount };
                            this.save();
                        }
                    });
                });

                // Bind row click handler for edit directory mode
                directoryContainer.querySelectorAll('.expense-row').forEach((row, idx) => {
                    row.addEventListener('click', (e) => {
                        if (e.target.closest('button') || e.target.closest('input')) {
                            return;
                        }
                        const name = dirKeys[idx];
                        if (name) {
                            this.startEditDirectory(name);
                        }
                    });
                });
                
                // Bind click handlers to add to current buttons
                directoryContainer.querySelectorAll('.btn-add-to-current').forEach(button => {
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const name = button.getAttribute('data-name');
                        const id = button.getAttribute('data-id');
                        if (name && id) {
                            this.addAttendee(name, id);
                        }
                    });
                });
                
                // Bind click handlers to delete from directory buttons
                directoryContainer.querySelectorAll('.btn-delete-from-directory').forEach(button => {
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const name = button.getAttribute('data-name');
                        if (name) {
                            this.deleteFromDirectory(name);
                        }
                    });
                });
            }
        }

        // Render Settlement History tab
        const historyContainer = document.getElementById('history-container');
        if (historyContainer) {
            historyContainer.innerHTML = '';
            if (this.settlementHistory.length === 0) {
                historyContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span><p>저장된 정산 이력이 없습니다.</p></div>`;
            } else {
                this.settlementHistory.forEach((entry, idx) => {
                    const d = new Date(entry.date);
                    const dateStr = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                    const card = document.createElement('div');
                    card.className = 'history-entry';

                    const itemsHtml = entry.expenseItems.map(it =>
                        `<li>${this.escapeHtml(it.description)} <span style="color:var(--color-secondary)">${SettlementCalculator.formatCurrency(it.amount)}</span></li>`
                    ).join('');
                    const attendeesHtml = entry.attendees.map(a =>
                        `<span class="expense-category-badge">${this.escapeHtml(a.name)}</span>`
                    ).join(' ');

                    card.innerHTML = `
                        <div class="history-header">
                            <div>
                                <span class="history-date">${dateStr}</span>
                                ${entry.clubName ? `<span class="history-club">${this.escapeHtml(entry.clubName)}</span>` : ''}
                            </div>
                            <button class="btn-delete history-delete-btn" data-idx="${idx}" title="이력 삭제">&times;</button>
                        </div>
                        <div class="history-summary">
                            <div class="history-stat"><span>참석 인원</span><strong>${entry.memberCount}명</strong></div>
                            <div class="history-stat"><span>총 소요</span><strong>${SettlementCalculator.formatCurrency(entry.totalCost)}</strong></div>
                            <div class="history-stat"><span>최종 지원금</span><strong style="color:var(--color-secondary)">${SettlementCalculator.formatCurrency(entry.finalSupportAmount)}</strong></div>
                            <div class="history-stat"><span>총 자부담</span><strong style="color:var(--warning-text)">${SettlementCalculator.formatCurrency(entry.totalSelfPay)}</strong></div>
                        </div>
                        <details class="history-details">
                            <summary>상세 내역 보기</summary>
                            <ul class="history-items">${itemsHtml || '<li>항목 없음</li>'}</ul>
                            <div style="margin-top:0.5rem; display:flex; flex-wrap:wrap; gap:0.3rem;">${attendeesHtml || '참석자 없음'}</div>
                        </details>
                    `;
                    historyContainer.appendChild(card);
                });

                historyContainer.querySelectorAll('.history-delete-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const i = parseInt(btn.getAttribute('data-idx'), 10);
                        if (!isNaN(i) && i >= 0 && i < this.settlementHistory.length) {
                            this.settlementHistory.splice(i, 1);
                            this.save();
                            this.render();
                        }
                    });
                });
            }
        }
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
        const L1 = 30000, L2 = 60000, L3 = 120000, R2 = 0.2, R3 = 0.4, D4 = 85000;
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
                label12 = '20% 자체 부담';
            } else if (F <= L3) {
                label12 = "'나' 구간 자부담 비용 + 60,000원 초과 금액에 대해 40% 자체 부담";
            } else {
                label12 = '85,000원 이외 금액 자체 부담(최대 인당 8.5만원 지원)';
            }
            sheet2 = setCellValue(sheet2, 'L12', label12, true);
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

        if (this.eventPhoto) {
            placements.push({
                sheetFile: 'sheet3.xml',
                col: 1, row: 2,
                blob: await this.dataUrlToFile(this.eventPhoto, 'event'),
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
        const fileName = `클럽비용정산_${dateStr.replace(/[^0-9]/g, '')}.xlsx`;
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

    // 엑셀 파일만 로컬 다운로드 폴더에 저장
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
        } catch (err) {
            console.error("엑셀 파일 다운로드 실패:", err);
            alert("엑셀 파일 다운로드에 실패했습니다: " + err.message);
            throw err;
        }
    },

    // 엑셀(수정된 정산서) + 참석자/영수증 사진 파일 목록 생성
    async collectReportFiles() {
        const files = [];
        files.push(await this.generateExcelFile());

        if (this.eventPhoto) {
            files.push(await this.dataUrlToFile(this.eventPhoto, '참석자_사진'));
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
            alert('정산서/사진 파일이 다운로드되었습니다. 메일 앱에서 직접 첨부해주세요.');
        }
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

    finalizeSettlement() {
        if (!confirm("정산을 확정하시겠습니까?\n확정하면 현재 비용 및 참석자 데이터가 초기화됩니다.")) return;

        const result = SettlementCalculator.calculate(
            this.memberCount, this.expenseItems, this.previousPrizeTotal, this.rules
        );

        // Use manually adjusted self-pay if user changed it, otherwise use calculated
        const finalTotalSelfPay = this.lastCalculatedSelfPay > 0 ? this.lastCalculatedSelfPay : result.totalSelfPay;
        const finalPerPersonSelfPay = this.memberCount > 0 ? finalTotalSelfPay / this.memberCount : result.perPersonSelfPay;
        const finalSelfPayRatio = result.totalCost > 0 ? finalTotalSelfPay / result.totalCost : 0;

        const newHistoryItem = {
            id: Date.now(),
            date: new Date().toISOString(),
            creatorPin: this.currentPin || "offline",
            creatorName: this.userName || "오프라인 사용자",
            clubName: this.clubName || "기본 클럽",
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

        // Save to Firebase global history
        if (this.isLoggedIn && this.firebaseDb) {
            this.firebaseDb.ref(`globalHistory/${newHistoryItem.id}`).set(newHistoryItem)
                .catch(err => console.error("Global history push failed:", err));
        }

        // Increment directory count for all current attendees
        this.attendees.forEach(att => {
            if (this.directory[att.name]) {
                const cur = this.directory[att.name];
                const curId = typeof cur === 'object' ? cur.id : cur;
                const curCount = typeof cur === 'object' ? (cur.count || 0) : 0;
                this.directory[att.name] = { id: curId, count: curCount + 1 };
            } else {
                this.directory[att.name] = { id: att.employeeId, count: 1 };
            }
        });

        // Update used budget
        this.usedBudget = Math.max(0, this.usedBudget + result.finalSupportAmount);

        // Reset current session
        this.expenseItems = [];
        this.attendees = [];
        this.memberCount = 0;
        this.previousPrizeTotal = 0;
        this.lastCalculatedSelfPay = 0;
        this.eventPhoto = null;
        this.editingItemId = null;
        this.editingAttendeeId = null;

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
    fetch('./lib/employee_directory.json')
        .then(res => res.json())
        .then(list => AppState.bulkImportDirectory(list))
        .catch(err => console.error("전사원 명부 자동 등록 실패:", err));

    // Club name dropdown init
    const clubNameInput = document.getElementById('club-name-select');

    function renderClubOptions() {
        if (!clubNameInput) return;
        const current = AppState.clubName || '';
        clubNameInput.innerHTML = '<option value="">클럽을 선택하세요</option>';
        const clubs = Object.values(AppState.clubRegistry || {});
        clubs.forEach(club => {
            const opt = document.createElement('option');
            opt.value = club.name;
            opt.textContent = club.name;
            clubNameInput.appendChild(opt);
        });
        // 현재 클럽명이 레지스트리에 없으면 (예: 오프라인/마이그레이션 전) 임시로 추가
        if (current && !clubs.some(c => c.name === current)) {
            const opt = document.createElement('option');
            opt.value = current;
            opt.textContent = current;
            clubNameInput.appendChild(opt);
        }
        const newOpt = document.createElement('option');
        newOpt.value = '__new__';
        newOpt.textContent = '+ 새 클럽 직접 등록';
        clubNameInput.appendChild(newOpt);
        clubNameInput.value = current;
    }

    const newClubInputRow = document.getElementById('new-club-input-row');
    const newClubNameInput = document.getElementById('new-club-name-input');
    const registerNewClubBtn = document.getElementById('register-new-club-btn');

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
                AppState.clearClubData();
            }
            AppState.syncBudgetFromClub(AppState.clubName);
            AppState.save();
            setSettingsFormValues(AppState.rules);
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
                alert('클럽명을 입력해주세요.');
                return;
            }
            const exists = Object.values(AppState.clubRegistry || {}).some(c => c.name === name);
            if (!exists) {
                const clubId = 'club_' + Date.now();
                AppState.addOrUpdateClub(clubId, name, 0);
            }
            AppState.clubName = name;
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

    // Set form input fields default values
    const memberInput = document.getElementById('member-count-input');
    const prizeInput = document.getElementById('prev-prize-input');

    memberInput.value = AppState.memberCount;
    prizeInput.value = AppState.previousPrizeTotal;

    // Settings panel: init budget fields from saved state
    const annualBudgetInput = document.getElementById('setting-annual-budget');
    const usedBudgetInput = document.getElementById('setting-used-budget');
    const remainingDisplay = document.getElementById('setting-remaining-display');

    // Set settings form input values
    const setSettingsFormValues = (rules) => {
        const annualInput = document.getElementById('setting-annual-budget');
        const usedInput = document.getElementById('setting-used-budget');
        if (annualInput) annualInput.value = AppState.annualBudget;
        if (usedInput) usedInput.value = AppState.usedBudget;
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
        });
    });

    // Attendee autocomplete search
    const attendeeNameInput = document.getElementById('attendee-name-input');
    const attendeeIdInput = document.getElementById('attendee-id-input');

    attendeeNameInput.addEventListener('input', () => {
        const name = attendeeNameInput.value.trim();
        if (AppState.directory[name]) {
            const val = AppState.directory[name];
            attendeeIdInput.value = typeof val === 'object' ? val.id : val;
        }
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
        if (!name || !id) return;

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

    function getExistingId(name) {
        const entry = AppState.directory[name];
        if (entry === undefined) return null;
        return typeof entry === 'object' ? entry.id : entry;
    }

    function updateDirNameHint() {
        const name = dirNameInput.value.trim();
        const id = dirIdInput.value.trim();
        const existingId = name ? getExistingId(name) : null;
        if (existingId !== null) {
            dirExistingIdHint.textContent = `등록된 EMP ID: ${existingId}`;
            dirExistingIdHint.classList.remove('hidden');
            const showWarning = AppState.editingDirName === null && id !== '' && id !== existingId;
            dirSamePersonWarning.classList.toggle('hidden', !showWarning);
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
            const existingId = getExistingId(name);
            if (existingId !== null && existingId === id) {
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
            if (confirm("등록된 모든 참석자 명단을 비우시겠습니까?")) {
                AppState.clearAttendees();
            }
        }
    });

    // Toggle settings panel handler
    document.getElementById('toggle-settings-btn').addEventListener('click', () => {
        const panel = document.getElementById('settings-panel');
        panel.classList.toggle('hidden');
    });

    // Save settings handler
    document.getElementById('save-settings-btn').addEventListener('click', () => {
        const usedBudget = parseInt(document.getElementById('setting-used-budget').value, 10) || 0;
        AppState.usedBudget = usedBudget;
        AppState.save();
        AppState.render();
        if (typeof updateRemainingDisplay === 'function') updateRemainingDisplay();

        // Hide panel after saving
        document.getElementById('settings-panel').classList.add('hidden');
    });

    // Admin: 정산 구간/비율 설정 폼 값 채우기
    const setAdminRulesFormValues = (rules) => {
        document.getElementById('admin-setting-limit1').value = rules.limit1;
        document.getElementById('admin-setting-limit2').value = rules.limit2;
        document.getElementById('admin-setting-rate2').value = Math.round(rules.rate2 * 100);
        document.getElementById('admin-setting-limit3').value = rules.limit3;
        document.getElementById('admin-setting-rate3').value = Math.round(rules.rate3 * 100);
        document.getElementById('admin-setting-deduction4').value = rules.deduction4;
    };
    setAdminRulesFormValues(AppState.rules);

    // Admin: 정산 비율 저장 (전체 클럽 공통 적용)
    const adminSaveRulesBtn = document.getElementById('admin-save-rules-btn');
    if (adminSaveRulesBtn) {
        adminSaveRulesBtn.addEventListener('click', () => {
            const limit1 = parseInt(document.getElementById('admin-setting-limit1').value, 10) || 0;
            const limit2 = parseInt(document.getElementById('admin-setting-limit2').value, 10) || 0;
            const rate2 = (parseInt(document.getElementById('admin-setting-rate2').value, 10) || 0) / 100;
            const limit3 = parseInt(document.getElementById('admin-setting-limit3').value, 10) || 0;
            const rate3 = (parseInt(document.getElementById('admin-setting-rate3').value, 10) || 0) / 100;
            const deduction4 = parseInt(document.getElementById('admin-setting-deduction4').value, 10) || 0;
            AppState.updateRules({ limit1, limit2, rate2, limit3, rate3, deduction4 });
            alert("정산 구간 및 비율 설정이 저장되어 모든 클럽에 일괄 적용됩니다.");
        });
    }

    // Admin: 정산 비율 기본값 복원
    const adminResetRulesBtn = document.getElementById('admin-reset-rules-btn');
    if (adminResetRulesBtn) {
        adminResetRulesBtn.addEventListener('click', () => {
            if (confirm("정산 기준 및 비율을 초기 기본값으로 복원하시겠습니까? (모든 클럽에 적용됩니다)")) {
                AppState.resetRules();
                setAdminRulesFormValues(AppState.rules);
            }
        });
    }

    // Attendance input change listeners
    prizeInput.addEventListener('input', () => {
        const prevPrize = parseInt(prizeInput.value, 10) || 0;
        AppState.updateAttendance(AppState.memberCount, prevPrize);
    });

    // Form submission listener
    const form = document.getElementById('expense-form');
    const descInput = document.getElementById('expense-desc-input');
    const amountInput = document.getElementById('expense-amount-input');
    const catSelect = document.getElementById('expense-category-select');

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const description = descInput.value.trim();
        const amount = parseInt(amountInput.value, 10);
        const category = catSelect.value;
        const corpChecked = document.getElementById('expense-corp-check').checked;
        const personalChecked = document.getElementById('expense-personal-check').checked;
        const corporateAmount = parseInt(document.getElementById('expense-corporate-amount-input').value, 10) || 0;

        if (description && !isNaN(amount) && amount > 0) {
            AppState.addExpense(description, amount, category, corpChecked, personalChecked, corporateAmount);
            descInput.focus();
        }
    });

    // Card type checkbox listeners
    const corpCheck = document.getElementById('expense-corp-check');
    const personalCheck = document.getElementById('expense-personal-check');
    const corporateAmountInput = document.getElementById('expense-corporate-amount-input');
    const personalAmountInput = document.getElementById('expense-personal-amount-input');
    [corpCheck, personalCheck].forEach(el => {
        if (el) el.addEventListener('change', updateCardTypeUI);
    });
    if (corporateAmountInput) {
        corporateAmountInput.addEventListener('input', updateCardTypeUI);
    }
    if (personalAmountInput) {
        personalAmountInput.addEventListener('input', updateCardTypeUI);
    }
    amountInput.addEventListener('input', updateCardTypeUI);
    updateCardTypeUI();

    // Cancel edit listener
    document.getElementById('cancel-edit-btn').addEventListener('click', () => {
        AppState.cancelEdit();
    });

    // Clear all listener
    document.getElementById('clear-all-btn').addEventListener('click', () => {
        if (AppState.expenseItems.length > 0) {
            if (confirm("등록된 모든 비용 항목을 삭제하시겠습니까?")) {
                AppState.clearAll();
            }
        }
    });

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
        sendEmailBtn.addEventListener('click', async () => {
            const originalText = sendEmailBtn.innerHTML;
            sendEmailBtn.innerHTML = "<span class='btn-icon'>⏳</span> 생성 중...";
            sendEmailBtn.disabled = true;
            try {
                await AppState.downloadExcelOnly();
                sendEmailBtn.innerHTML = "<span class='btn-icon'>✓</span> 저장 완료!";

                const todayStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
                runFinalizeSettlement();
                alert(
                    `📂 ${todayStr} 정산 엑셀 파일이 생성되어 다운로드 폴더에 저장되었습니다.\n\n` +
                    `✅ 전체 항목이 초기화되었습니다.\n` +
                    `📧 저장된 파일을 이메일로 보내주세요.\n` +
                    `📋 이번 정산 내역은 [정산 이력] 탭에서 확인하실 수 있습니다.`
                );
            } catch (err) {
                console.error(err);
                sendEmailBtn.innerHTML = "<span class='btn-icon'>❌</span> 저장 실패";
            } finally {
                setTimeout(() => {
                    sendEmailBtn.innerHTML = originalText;
                    sendEmailBtn.disabled = false;
                }, 2000);
            }
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

    function runFinalizeSettlement() {
        AppState.finalizeSettlement();
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
            downloadExcelBtn.innerHTML = "<span class='btn-icon'>⏳</span> 생성 중...";
            downloadExcelBtn.disabled = true;
            try {
                await AppState.downloadExcelOnly();
                downloadExcelBtn.innerHTML = "<span class='btn-icon'>✓</span> 다운로드 완료!";
            } catch (err) {
                console.error(err);
                downloadExcelBtn.innerHTML = "<span class='btn-icon'>❌</span> 다운로드 실패";
            } finally {
                setTimeout(() => {
                    downloadExcelBtn.innerHTML = originalText;
                    downloadExcelBtn.disabled = false;
                }, 2000);
            }
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
        const annual = parseInt(annualBudgetInput.value, 10) || 0;
        const used = parseInt(usedBudgetInput.value, 10) || 0;
        if (annual > 0) {
            const rem = annual - used;
            remainingDisplay.textContent = SettlementCalculator.formatCurrency(rem);
            remainingDisplay.style.color = rem >= 0 ? 'var(--color-secondary)' : 'var(--warning-text)';
        } else {
            remainingDisplay.textContent = '미설정';
            remainingDisplay.style.color = '';
        }
    }

    if (annualBudgetInput) {
        annualBudgetInput.value = AppState.annualBudget;
        annualBudgetInput.addEventListener('input', updateRemainingDisplay);
    }
    if (usedBudgetInput) {
        usedBudgetInput.value = AppState.usedBudget;
        usedBudgetInput.addEventListener('input', updateRemainingDisplay);
    }
    updateRemainingDisplay();

    // Event photo upload handler
    const eventPhotoInput = document.getElementById('event-photo-input');
    const deleteEventPhotoBtn = document.getElementById('delete-event-photo-btn');

    if (eventPhotoInput) {
        eventPhotoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                compressReceiptImage(file, (compressed) => {
                    AppState.eventPhoto = compressed;
                    AppState.save();
                    AppState.render();
                });
            }
        });
    }

    if (deleteEventPhotoBtn) {
        deleteEventPhotoBtn.addEventListener('click', () => {
            AppState.eventPhoto = null;
            if (eventPhotoInput) eventPhotoInput.value = '';
            AppState.save();
            AppState.render();
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
        const newValue = parseInt(selfPayInput.value, 10) || 0;
        const oldValue = Math.round(AppState.lastCalculatedSelfPay);
        const diff = newValue - oldValue;

        const absDiff = Math.abs(diff).toLocaleString();
        const popupMsg = diff >= 0
            ? `정산에 문제없음\n자부담금액보다 ${absDiff}원 추가 부담함`
            : `⚠️ 정산에 문제 있음 ⚠️\n자부담금액보다 ${absDiff}원 적게 부담함`;
        showDiffPopup(popupMsg, diff);

        AppState.lastCalculatedSelfPay = newValue;

        const memberCount = AppState.memberCount;
        const perPerson = memberCount > 0 ? newValue / memberCount : 0;
        document.getElementById('result-per-person-self-pay').textContent = SettlementCalculator.formatCurrency(perPerson);

        const totalCost = AppState.expenseItems.reduce((sum, item) => sum + item.amount, 0);
        const ratio = totalCost > 0 ? newValue / totalCost : 0;
        document.getElementById('result-self-pay-ratio').textContent = `${(ratio * 100).toFixed(1)}%`;
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
                        statusBadge.innerHTML = `🌐 온라인 (${AppState.userName || '알 수 없음'} / PIN: ${pin})`;
                        logoutBtn.style.display = 'inline-block';
                        loginBtn.style.display = 'none';
                        resetPinInput();

                        // Admin tab check
                        setAdminMode(pin === "000000");

                        // Sync values to form fields
                        AppState.loadClubRegistry().then(renderClubOptions);
                        memberInput.value = AppState.memberCount || 0;
                        prizeInput.value = AppState.previousPrizeTotal || 0;
                        setSettingsFormValues(AppState.rules);
            if (typeof setAdminRulesFormValues === 'function') setAdminRulesFormValues(AppState.rules);
                        AppState.render();
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
    function setAdminMode(isAdmin) {
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
            const fallbackId = isAdmin ? 'tab-club-history' : 'tab-settlement';
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
        statusBadge.innerHTML = `📴 오프라인 모드 (기기 저장)`;
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
        if (confirm("로그아웃 하시겠습니까? (로컬 기기 모드로 전환됩니다)")) {
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
                    alert(`${name}님, 회원 등록이 완료되었습니다!`);
                    
                    // Automatically log in
                    AppState.isLoggedIn = true;
                    AppState.currentPin = pin;
                    AppState.userName = name;
                    
                    setAdminMode(false);
                    pinModal.classList.add('hidden');
                    statusBadge.className = 'badge-online';
                    statusBadge.innerHTML = `🌐 온라인 (${name} / PIN: ${pin})`;
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
    const adminSearchInput = document.getElementById('admin-search-input');
    if (adminSearchInput) {
        adminSearchInput.addEventListener('input', () => {
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
        const newName = prompt('이름 수정', currentName);
        if (newName === null || !newName.trim()) return;

        const newPin = prompt('6자리 PIN 번호 수정', oldPin);
        if (newPin === null) return;
        if (!/^\d{6}$/.test(newPin)) {
            alert('PIN 번호는 6자리 숫자여야 합니다.');
            return;
        }

        firebaseDb.ref(`users/${oldPin}`).once('value').then(snap => {
            const userData = snap.val() || {};
            userData.name = newName.trim();

            if (newPin === oldPin) {
                return firebaseDb.ref(`users/${oldPin}`).update({ name: userData.name });
            }

            return firebaseDb.ref(`users/${newPin}`).once('value').then(existing => {
                if (existing.exists()) {
                    alert('이미 사용 중인 PIN 번호입니다.');
                    return Promise.reject(new Error('duplicate-pin'));
                }
                return firebaseDb.ref(`settlements/${oldPin}`).once('value').then(settlementSnap => {
                    const tasks = [
                        firebaseDb.ref(`users/${newPin}`).set(userData),
                        firebaseDb.ref(`users/${oldPin}`).remove()
                    ];
                    if (settlementSnap.exists()) {
                        tasks.push(firebaseDb.ref(`settlements/${newPin}`).set(settlementSnap.val()));
                        tasks.push(firebaseDb.ref(`settlements/${oldPin}`).remove());
                    }
                    return Promise.all(tasks);
                });
            });
        }).then(() => {
            renderAdminDashboard();
        }).catch(err => {
            if (err && err.message !== 'duplicate-pin') {
                console.error('회원 정보 수정 실패:', err);
                alert('회원 정보 수정에 실패했습니다.');
            }
        });
    }

    function deleteAdminUser(pin, name) {
        if (!confirm(`'${name}' (${pin}) 회원을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
        Promise.all([
            firebaseDb.ref(`users/${pin}`).remove(),
            firebaseDb.ref(`settlements/${pin}`).remove()
        ]).then(() => {
            renderAdminDashboard();
        }).catch(err => {
            console.error('회원 삭제 실패:', err);
            alert('회원 삭제에 실패했습니다.');
        });
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

            if (requestList.length === 0) {
                listContainer.innerHTML = '<p style="font-size:0.85rem; color:var(--text-muted); text-align:center; padding:1rem 0;">요청사항이 없습니다.</p>';
            } else {
                listContainer.innerHTML = requestList.map(req => {
                    const dateStr = req.createdAt ? new Date(req.createdAt).toLocaleString('ko-KR') : '-';
                    const photoHtml = req.photo
                        ? `<img src="${req.photo}" alt="첨부 사진" class="feedback-photo-img" data-key="${AppState.escapeHtml(req.key)}" style="max-width:100%; max-height:220px; border-radius:8px; margin-top:0.5rem; cursor:pointer; display:block;">`
                        : '';
                    return `
                        <div class="feedback-item" data-key="${AppState.escapeHtml(req.key)}" style="border:1px solid var(--card-border); border-radius:10px; padding:0.7rem 0.9rem; ${req.read ? 'opacity:0.6;' : 'background:rgba(245, 158, 11, 0.08); border-color:rgba(245,158,11,0.3);'}">
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
                                <strong style="font-size:0.88rem;">${AppState.escapeHtml(req.userName || '알 수 없음')}${req.clubName ? ` (${AppState.escapeHtml(req.clubName)})` : ''}</strong>
                                <span style="font-size:0.72rem; color:var(--text-muted); white-space:nowrap;">${dateStr}</span>
                            </div>
                            <p style="font-size:0.85rem; margin:0.4rem 0 0; white-space:pre-wrap;">${AppState.escapeHtml(req.message || '')}</p>
                            ${photoHtml}
                            ${!req.read ? '<button class="btn-mark-read btn-secondary" data-key="' + AppState.escapeHtml(req.key) + '" style="margin-top:0.5rem; padding:0.25rem 0.6rem; font-size:0.75rem;">확인 완료</button>' : '<span style="font-size:0.72rem; color:var(--text-muted);">✔️ 확인됨</span>'}
                        </div>
                    `;
                }).join('');

                listContainer.querySelectorAll('.btn-mark-read').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const key = btn.getAttribute('data-key');
                        firebaseDb.ref(`requests/${key}/read`).set(true).then(() => renderFeedbackList());
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
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${AppState.escapeHtml(user.name)}</strong></td>
                    <td><code>${AppState.escapeHtml(pin)}</code></td>
                    <td><span style="font-size:0.8rem; color:var(--text-muted);">${dateStr}</span></td>
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
        
        // 2. Fetch Global History
        firebaseDb.ref('globalHistory').once('value').then(snapshot => {
            const historyData = snapshot.val() || {};
            const historyList = Object.values(historyData).sort((a, b) => b.id - a.id);
            
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
            renderOverallMonthlyChart(historyList);
        });

        // 3. Fetch Club Registry & Total Budget
        AppState.loadClubRegistry().then(() => {
            renderClubManagement();
            // 총 클럽비용은 비동기로 로드되므로, 차트의 예산 통계를 다시 갱신
            updateChartsBudgetStats(lastHistoryList);
            renderClubFilters();
            renderClubHistorySelect();
            renderOverallMonthlyChart(lastHistoryList);
        });
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
    let selectedClubFilter = '';

    const clubTotalBudgetInput = document.getElementById('club-total-budget-input');
    const clubBudgetSummary = document.getElementById('club-budget-summary');
    const clubForm = document.getElementById('club-form');
    const clubNameFormInput = document.getElementById('club-name-form-input');
    const clubBudgetFormInput = document.getElementById('club-budget-form-input');
    const clubPriorUsedFormInput = document.getElementById('club-prior-used-form-input');
    const cancelEditClubBtn = document.getElementById('cancel-edit-club-btn');
    const clubListContainer = document.getElementById('club-list-container');

    function renderClubManagement() {
        if (clubTotalBudgetInput) {
            clubTotalBudgetInput.value = AppState.clubTotalBudget || 0;
        }

        const clubs = Object.entries(AppState.clubRegistry || {});
        const allocated = clubs.reduce((sum, [, c]) => sum + (c.budget || 0), 0);
        const remaining = (AppState.clubTotalBudget || 0) - allocated;
        if (clubBudgetSummary) {
            clubBudgetSummary.textContent = `${SettlementCalculator.formatCurrency(allocated)} / ${SettlementCalculator.formatCurrency(remaining)}`;
            clubBudgetSummary.style.color = remaining < 0 ? 'var(--warning-text, #ff6b6b)' : 'var(--color-secondary)';
        }

        if (!clubListContainer) return;
        clubListContainer.innerHTML = '';
        if (clubs.length === 0) {
            clubListContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">🏷️</span><p>등록된 클럽이 없습니다.</p></div>`;
            return;
        }
        clubs.sort((a, b) => a[1].name.localeCompare(b[1].name)).forEach(([clubId, club]) => {
            const spent = lastHistoryList
                .filter(entry => entry.clubName === club.name)
                .reduce((sum, entry) => sum + (entry.finalSupportAmount || 0), 0);
            const budget = club.budget || 0;
            const priorUsed = club.priorUsed || 0;
            const remaining = budget - priorUsed - spent;
            const row = document.createElement('div');
            row.className = 'expense-row';
            row.style.cssText = 'padding:0.6rem 0.75rem; height:auto; align-items:center; flex-wrap:wrap;';
            row.innerHTML = `
                <div class="expense-row-left" style="flex:1.4; min-width:90px;">
                    <span class="expense-row-title" style="font-size:0.9rem; white-space:normal; line-height:1.3;">${AppState.escapeHtml(club.name)}</span>
                </div>
                <div style="flex:1.2; min-width:100px; text-align:center;">
                    <div style="font-size:0.7rem; color:var(--text-secondary);">배정 예산</div>
                    <div style="font-size:0.85rem; font-weight:600;">${SettlementCalculator.formatCurrency(budget)}</div>
                    ${priorUsed > 0 ? `<div style="font-size:0.7rem; color:var(--text-muted);">(이전사용 ${SettlementCalculator.formatCurrency(priorUsed)})</div>` : ''}
                </div>
                <div style="flex:1.2; min-width:100px; text-align:center;">
                    <div style="font-size:0.7rem; color:var(--text-secondary);">잔여 예산</div>
                    <div style="font-size:0.85rem; font-weight:600; color:${remaining < 0 ? 'var(--warning-text, #ff6b6b)' : 'var(--color-secondary)'};">${SettlementCalculator.formatCurrency(remaining)}</div>
                </div>
                <div class="expense-row-right" style="gap:0.4rem; flex:0 0 auto;">
                    <button class="btn-edit-club btn-secondary" data-id="${AppState.escapeHtml(clubId)}" style="padding:0.3rem 0.6rem; font-size:0.78rem;">수정</button>
                    <button class="btn-delete-club btn-text-danger" data-id="${AppState.escapeHtml(clubId)}" style="padding:0.3rem 0.6rem; font-size:0.78rem;">삭제</button>
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
                clubBudgetFormInput.value = club.budget || 0;
                clubPriorUsedFormInput.value = club.priorUsed || 0;
                document.getElementById('add-club-btn').innerHTML = `<span class="btn-icon">💾</span> 수정 완료`;
                cancelEditClubBtn.classList.remove('hidden');
                clubNameFormInput.focus();
            });
        });
        clubListContainer.querySelectorAll('.btn-delete-club').forEach(btn => {
            btn.addEventListener('click', () => {
                const clubId = btn.getAttribute('data-id');
                const club = AppState.clubRegistry[clubId];
                if (!club) return;
                if (confirm(`'${club.name}' 클럽을 삭제하시겠습니까?`)) {
                    AppState.deleteClub(clubId);
                    renderClubManagement();
                }
            });
        });
    }

    function resetClubForm() {
        editingClubId = null;
        clubNameFormInput.value = '';
        clubBudgetFormInput.value = '';
        clubPriorUsedFormInput.value = '';
        document.getElementById('add-club-btn').innerHTML = `<span class="btn-icon">➕</span> 클럽 추가`;
        cancelEditClubBtn.classList.add('hidden');
    }

    if (clubTotalBudgetInput) {
        clubTotalBudgetInput.addEventListener('change', () => {
            AppState.saveClubTotalBudget(parseInt(clubTotalBudgetInput.value, 10) || 0);
            renderClubManagement();
        });
    }

    const saveClubTotalBudgetBtn = document.getElementById('save-club-total-budget-btn');
    if (saveClubTotalBudgetBtn) {
        saveClubTotalBudgetBtn.addEventListener('click', () => {
            const value = parseInt(clubTotalBudgetInput.value, 10) || 0;
            Promise.resolve(AppState.saveClubTotalBudget(value)).then(() => {
                renderClubManagement();
                const statusEl = document.getElementById('club-total-budget-status');
                if (statusEl) {
                    statusEl.style.display = 'block';
                    setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
                }
                renderOverallMonthlyChart(lastHistoryList);
            }).catch(() => {
                alert('총 클럽비용 저장에 실패했습니다. 온라인 상태를 확인해주세요.');
            });
        });
    }

    if (clubForm) {
        clubForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = clubNameFormInput.value.trim();
            const budget = parseInt(clubBudgetFormInput.value, 10) || 0;
            const priorUsed = parseInt(clubPriorUsedFormInput.value, 10) || 0;
            if (!name) return;
            const clubId = editingClubId || ('club_' + Date.now());
            AppState.addOrUpdateClub(clubId, name, budget, priorUsed);
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

        const clubs = Object.values(AppState.clubRegistry || {});
        let html = `
            <label class="club-filter-chip ${selectedClubFilter === '' ? 'active' : ''}">
                <input type="radio" name="club-filter" value="" ${selectedClubFilter === '' ? 'checked' : ''}>
                전체 클럽
            </label>
        `;
        clubs.sort((a, b) => a.name.localeCompare(b.name)).forEach(club => {
            html += `
                <label class="club-filter-chip ${selectedClubFilter === club.name ? 'active' : ''}">
                    <input type="radio" name="club-filter" value="${AppState.escapeHtml(club.name)}" ${selectedClubFilter === club.name ? 'checked' : ''}>
                    ${AppState.escapeHtml(club.name)}
                </label>
            `;
        });
        container.innerHTML = html;

        container.querySelectorAll('input[name="club-filter"]').forEach(input => {
            input.addEventListener('change', () => {
                selectedClubFilter = input.value;
                renderClubFilters();
                renderOverallMonthlyChart(lastHistoryList);
            });
        });
    }

    // ── 차트 탭 상단 - 총 예산 / 사용 예산 / 잔여 예산 ────────────────────
    function updateChartsBudgetStats(historyList) {
        const totalBudgetEl = document.getElementById('charts-total-budget');
        const usedBudgetEl = document.getElementById('charts-used-budget');
        const remainingBudgetEl = document.getElementById('charts-remaining-budget');
        if (!totalBudgetEl || !usedBudgetEl || !remainingBudgetEl) return;

        const totalBudget = AppState.clubTotalBudget || 0;
        const usedBudget = (historyList || []).reduce((sum, entry) => sum + (entry.totalCost || 0), 0);
        const remaining = totalBudget - usedBudget;

        totalBudgetEl.textContent = SettlementCalculator.formatCurrency(totalBudget);
        usedBudgetEl.textContent = SettlementCalculator.formatCurrency(usedBudget);
        remainingBudgetEl.textContent = SettlementCalculator.formatCurrency(remaining);
        remainingBudgetEl.style.color = remaining < 0 ? 'var(--warning-text, #ff6b6b)' : 'var(--color-secondary)';
    }

    let overallMonthlyChartInstance = null;

    // ── 월별 클럽 지출 현황 (막대 그래프) ────────────────────────────────
    // 전체 클럽 선택 시: 월별 x축, 클럽별 막대로 그룹화하여 비교
    // 특정 클럽 선택 시: 해당 클럽의 월별 지출액만 표시
    function renderOverallMonthlyChart(historyList) {
        const canvas = document.getElementById('overall-monthly-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        updateChartsBudgetStats(historyList);

        const palette = [
            'rgba(139, 92, 246, 0.6)',
            'rgba(56, 189, 248, 0.6)',
            'rgba(248, 113, 113, 0.6)',
            'rgba(52, 211, 153, 0.6)',
            'rgba(251, 191, 36, 0.6)',
            'rgba(236, 72, 153, 0.6)',
            'rgba(129, 140, 248, 0.6)'
        ];

        let labels, datasets;

        if (selectedClubFilter === '') {
            // 전체 클럽: 월별 x축 + 클럽별 막대
            const monthSet = new Set();
            const clubNames = new Set();
            const spendByMonthClub = {};

            historyList.forEach(entry => {
                const d = entry.date ? new Date(entry.date) : null;
                const monthKey = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '알 수 없음';
                const club = entry.clubName || '기본 클럽';
                monthSet.add(monthKey);
                clubNames.add(club);
                spendByMonthClub[monthKey] = spendByMonthClub[monthKey] || {};
                spendByMonthClub[monthKey][club] = (spendByMonthClub[monthKey][club] || 0) + (entry.totalCost || 0);
            });

            // 클럽 레지스트리에 등록된 클럽도 (지출 0이라도) 표시
            Object.values(AppState.clubRegistry || {}).forEach(club => clubNames.add(club.name));

            labels = Array.from(monthSet).sort();
            const sortedClubs = Array.from(clubNames).sort((a, b) => a.localeCompare(b));

            datasets = sortedClubs.map((club, idx) => ({
                label: club,
                data: labels.map(month => (spendByMonthClub[month] && spendByMonthClub[month][club]) || 0),
                backgroundColor: palette[idx % palette.length],
                borderColor: palette[idx % palette.length].replace('0.6', '0.9'),
                borderWidth: 1
            }));
        } else {
            // 특정 클럽: 월별 지출액
            const spendByMonth = {};
            historyList
                .filter(entry => (entry.clubName || '기본 클럽') === selectedClubFilter)
                .forEach(entry => {
                    const d = entry.date ? new Date(entry.date) : null;
                    const key = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '알 수 없음';
                    spendByMonth[key] = (spendByMonth[key] || 0) + (entry.totalCost || 0);
                });

            labels = Object.keys(spendByMonth).sort();
            datasets = [
                {
                    label: `${selectedClubFilter} - 월별 지출액`,
                    data: labels.map(key => spendByMonth[key]),
                    backgroundColor: 'rgba(56, 189, 248, 0.6)',
                    borderColor: 'rgba(56, 189, 248, 0.9)',
                    borderWidth: 1
                }
            ];
        }

        const stacked = selectedClubFilter === '';

        if (overallMonthlyChartInstance) {
            overallMonthlyChartInstance.destroy();
        }
        overallMonthlyChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                plugins: {
                    legend: { labels: { color: '#cbd5e1' } }
                },
                scales: {
                    x: { stacked, ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { stacked, ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
                }
            }
        });
    }

    function renderAdminHistory(historyList) {
        const container = document.getElementById('admin-history-container');
        const searchVal = (document.getElementById('admin-search-input').value || '').trim().toLowerCase();
        const clubSelect = document.getElementById('club-history-select');
        const selectedClub = clubSelect ? clubSelect.value : '';
        container.innerHTML = '';

        let filtered = historyList.filter(entry => {
            if (!searchVal) return true;

            // Search creator name
            if (entry.creatorName && entry.creatorName.toLowerCase().includes(searchVal)) return true;

            // Search attendees list
            if (entry.attendees && entry.attendees.some(att => att.name && att.name.toLowerCase().includes(searchVal))) return true;

            return false;
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
                const d = entry.date ? new Date(entry.date) : new Date(entry.id);
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
                attendeesHtml = entry.attendees.map(att => att.name).join(', ');
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
            
            div.innerHTML = `
                <div class="history-header">
                    <div>
                        <strong>${AppState.escapeHtml(entry.clubName || '기본 클럽')}</strong>
                        <span class="history-club" style="color:var(--color-secondary);">정산인: ${AppState.escapeHtml(entry.creatorName || '오프라인')}</span>
                    </div>
                    <span class="history-date">${new Date(entry.id).toLocaleString()}</span>
                    <button class="btn-delete-history btn-text-danger" data-id="${entry.id}" style="padding:0.25rem 0.5rem; font-size:0.75rem;">삭제</button>
                </div>
                <div class="history-summary">
                    <div class="history-stat">
                        <span>총 소요 비용</span>
                        <strong>${SettlementCalculator.formatCurrency(entry.totalCost)}</strong>
                    </div>
                    <div class="history-stat">
                        <span>회사 지원금</span>
                        <strong>${SettlementCalculator.formatCurrency(entry.finalSupportAmount)}</strong>
                    </div>
                    <div class="history-stat">
                        <span>총 자부담</span>
                        <strong>${SettlementCalculator.formatCurrency(entry.totalSelfPay)}</strong>
                    </div>
                    <div class="history-stat">
                        <span>인당 자부담 (인원: ${entry.memberCount}명)</span>
                        <strong>${SettlementCalculator.formatCurrency(entry.perPersonSelfPay)}</strong>
                    </div>
                </div>
                <div class="history-details" style="margin-top:0.5rem;">
                    <details>
                        <summary style="font-size:0.82rem; color:var(--color-secondary); cursor:pointer;">상세 지출 및 참석자 명단 보기</summary>
                        <div style="padding:0.5rem 0; font-size:0.83rem; line-height:1.4;">
                            <strong>참석자:</strong> <span style="color:var(--text-secondary);">${AppState.escapeHtml(attendeesHtml || '없음')}</span>
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
        
        // 정산 기록 삭제 → globalHistory에서 제거 + 참석자 누적 참석 횟수 차감
        container.querySelectorAll('.btn-delete-history').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const entry = historyList.find(e => String(e.id) === String(id));
                if (!entry) return;
                if (!confirm(`이 정산 기록을 삭제하시겠습니까?\n참석자 ${entry.memberCount}명의 누적 참석 횟수도 함께 차감됩니다.`)) return;

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
                    firebaseDb.ref(`globalHistory/${entry.id}`).remove().then(() => {
                        lastHistoryList = lastHistoryList.filter(e => String(e.id) !== String(id));
                        renderAdminHistory(lastHistoryList);
                        renderOverallMonthlyChart(lastHistoryList);
                        updateChartsBudgetStats(lastHistoryList);
                        renderClubManagement();
                    }).catch(() => alert('삭제에 실패했습니다. 온라인 상태를 확인해주세요.'));
                }
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

    // Tab navigation switching logic
    document.querySelectorAll('.tab-nav .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));

            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.remove('hidden');

            if (tabId === 'tab-admin' || tabId === 'tab-club-history' || tabId === 'tab-charts') {
                renderAdminDashboard();
            }
        });
    });

    // 만약 Firebase DB가 초기화되어 있지 않으면 로그인 버튼 숨기고 기본 오프라인 모드로 설정
    if (!firebaseDb) {
        switchToOfflineMode();
    } else {
        pinModal.classList.remove('hidden');
    }
});


// Diff popup notification helper
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
    if (!corpCheck || !personalCheck) return;

    const corpOn = corpCheck.checked;
    const personalOn = personalCheck.checked;

    // Require at least one card type selected
    if (!corpOn && !personalOn) {
        corpCheck.checked = true;
        return updateCardTypeUI();
    }

    corpAmountGroup.classList.toggle('hidden', !corpOn);
    personalAmountGroup.classList.toggle('hidden', !personalOn);
    corpReceiptGroup.classList.toggle('hidden', !corpOn);
    personalReceiptGroup.classList.toggle('hidden', !personalOn);

    const isSplit = corpOn && personalOn;
    splitAutoHint.style.display = isSplit ? '' : 'none';
    personalAmountInput.readOnly = isSplit;

    if (isSplit) {
        const totalRaw = document.getElementById('expense-amount-input').value;
        const corpRaw = document.getElementById('expense-corporate-amount-input').value;
        if (totalRaw === '' && corpRaw === '') {
            personalAmountInput.value = '';
        } else {
            const total = parseInt(totalRaw, 10) || 0;
            const corp = parseInt(corpRaw, 10) || 0;
            personalAmountInput.value = Math.max(total - corp, 0);
        }
    }
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
