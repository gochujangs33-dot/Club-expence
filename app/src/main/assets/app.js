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
    tempReceiptImage: null,
    tempCorpReceiptImage: null,
    tempPersonalReceiptImage: null,
    lastCalculatedSelfPay: 0,
    annualBudget: 0,
    usedBudget: 0,
    eventPhoto: null,
    clubName: '',
    settlementHistory: [],

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
        list.forEach(([name, employeeId]) => {
            if (!name || !employeeId) return;
            if (this.directory[name] === undefined) {
                this.directory[name] = { id: employeeId, count: 0 };
                added++;
            }
        });
        this.save();
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
                            resolve(true);
                        })
                        .catch(err => reject(err));
                })
                .catch(err => reject(err));
        });
    },


    addExpense(description, amount, category, cardType, corporateAmount) {
        const isSplit = cardType === 'split';
        const corpAmount = isSplit ? Math.min(Math.max(corporateAmount || 0, 0), amount) : null;
        const personalAmount = isSplit ? amount - corpAmount : null;

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
                item.receiptImage = isSplit ? null : this.tempReceiptImage;
                item.corporateReceiptImage = isSplit ? this.tempCorpReceiptImage : null;
                item.personalReceiptImage = isSplit ? this.tempPersonalReceiptImage : null;
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
                receiptImage: isSplit ? null : this.tempReceiptImage,
                corporateReceiptImage: isSplit ? this.tempCorpReceiptImage : null,
                personalReceiptImage: isSplit ? this.tempPersonalReceiptImage : null
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
            document.getElementById('expense-card-type-select').value = cardType;
            document.getElementById('expense-corporate-amount-input').value = item.corporateAmount ?? '';
            updateCardTypeUI();

            // Load receipt preview status
            this.tempReceiptImage = item.receiptImage || null;
            this.tempCorpReceiptImage = item.corporateReceiptImage || null;
            this.tempPersonalReceiptImage = item.personalReceiptImage || null;

            const statusEl = document.getElementById('receipt-preview-status');
            const deleteReceiptBtn = document.getElementById('delete-receipt-btn');
            if (this.tempReceiptImage) {
                statusEl.textContent = "✓ 영수증 첨부됨 (변경하려면 새 파일 선택)";
                statusEl.classList.remove('hidden');
                if (deleteReceiptBtn) deleteReceiptBtn.classList.remove('hidden');
            } else {
                statusEl.classList.add('hidden');
                if (deleteReceiptBtn) deleteReceiptBtn.classList.add('hidden');
            }
            document.getElementById('expense-receipt-input').value = '';

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
        document.getElementById('expense-receipt-input').value = '';
        this.tempReceiptImage = null;
        document.getElementById('receipt-preview-status').classList.add('hidden');
        const deleteReceiptBtn = document.getElementById('delete-receipt-btn');
        if (deleteReceiptBtn) deleteReceiptBtn.classList.add('hidden');

        document.getElementById('expense-card-type-select').selectedIndex = 0;
        document.getElementById('expense-corporate-amount-input').value = '';
        document.getElementById('split-personal-amount-display').textContent = '0';

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
                if (item.receiptImage) {
                    receiptControlHtml = `
                        <div class="receipt-preview-wrapper" style="position: relative; display: inline-block; margin-right: 0.5rem;">
                            <img src="${item.receiptImage}" class="receipt-thumbnail" alt="영수증 미리보기" data-desc="${this.escapeHtml(item.description)}">
                            <button class="btn-delete-receipt-only" data-id="${item.id}" title="영수증만 삭제" style="position: absolute; top: -5px; right: -5px; background: rgba(239, 68, 68, 0.95); border: none; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; line-height: 1; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3); transition: var(--transition-smooth);">&times;</button>
                        </div>
                    `;
                } else {
                    receiptControlHtml = `
                        <label class="btn-attach-receipt-row" style="cursor: pointer; padding: 0.35rem 0.6rem; border-radius: 8px; border: 1px dashed var(--color-secondary); color: var(--color-secondary); font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.3rem; transition: var(--transition-smooth); background: rgba(6, 182, 212, 0.05); margin-right: 0.5rem;">
                            <span>📎 영수증 첨부</span>
                            <input type="file" class="row-receipt-file-input" data-id="${item.id}" accept="image/*" style="display: none;">
                        </label>
                    `;
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

            // Bind change handlers to row receipt inputs
            listContainer.querySelectorAll('.row-receipt-file-input').forEach(input => {
                input.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    const itemId = parseInt(e.target.getAttribute('data-id'), 10);
                    const labelSpan = e.target.previousElementSibling;
                    
                    if (file && itemId) {
                        if (labelSpan) {
                            labelSpan.textContent = "⌛ 압축 중...";
                        }
                        
                        compressReceiptImage(file, (compressedBase64) => {
                            const index = this.expenseItems.findIndex(item => item.id === itemId);
                            if (index !== -1) {
                                this.expenseItems[index].receiptImage = compressedBase64;
                                this.save();
                                this.render();
                            }
                        });
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
                            this.expenseItems[index].receiptImage = null;
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
                    
                    row.innerHTML = `
                        <div class="expense-row-left">
                            <span class="expense-row-title" style="font-size: 0.88rem;">
                                ${this.escapeHtml(name)}
                                <span style="font-size: 0.72rem; color: var(--color-secondary); font-weight: 600; margin-left: 0.3rem;">(올해 누적: <input type="number" class="dir-count-input" data-name="${this.escapeHtml(name)}" value="${countValue}" min="0" style="width:34px; padding:0 2px; font-size:0.72rem; font-weight:700; color:var(--color-secondary); background:transparent; border:none; border-bottom:1px dashed var(--color-secondary); outline:none; text-align:center; -moz-appearance:textfield; appearance:textfield;">회)</span>
                            </span>
                            <span style="font-size: 0.75rem; color: var(--text-secondary);">사번: ${this.escapeHtml(idValue)}</span>
                        </div>
                        <div class="expense-row-right" style="gap: 0.4rem;">
                            ${addBtnHtml}
                            <button class="btn-delete-from-directory btn-delete btn-text-danger" data-name="${this.escapeHtml(name)}" style="padding: 0.5rem; font-size: 1.1rem; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(239, 68, 68, 0.1); margin-left: 0.5rem;" title="명부에서 삭제">&times;</button>
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
        
        const emailReceiver = document.getElementById('setting-email')?.value || 'finance@club.com';
        
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

        // D5부터 정회원 참석자 이름 입력 (최대 120명, K4=COUNTA(D5:D124), E열 수식이 D열을 Global ID 명단과 대조)
        this.attendees.slice(0, 120).forEach((att, idx) => {
            const row = 5 + idx;
            sheet2 = setCellValue(sheet2, `D${row}`, att.name, true);
        });

        // 5행부터 입력 (서식상 최대 20건)
        this.expenseItems.slice(0, 20).forEach((item, idx) => {
            const row = 5 + idx;
            sheet2 = setCellValue(sheet2, `F${row}`, item.description, true);
            sheet2 = setCellValue(sheet2, `G${row}`, item.amount, false);
            sheet2 = setCellValue(sheet2, `H${row}`, categoryNameMap[item.category] || item.category, true);
        });

        // K24(실제 자부담 비용): 앱에서 계산/수정된 총 자부담 금액을 그대로 입력
        // (수정 없으면 자동 계산된 값, 수정했으면 수정된 값) — 나머지(L24 비율 등)는 서식 수식대로 자동 계산됨
        const result = SettlementCalculator.calculate(
            this.memberCount,
            this.expenseItems,
            this.previousPrizeTotal,
            this.rules
        );
        sheet2 = setCellValue(sheet2, 'K24', result.totalSelfPay, false);

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

    // 엑셀 + 사진(참석자/영수증)을 묶어 공유 시트로 전달
    async shareSettlementReport() {
        const statusEl = document.getElementById('share-report-status');
        const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

        try {
            setStatus('파일을 준비하는 중입니다...');

            const files = [];
            files.push(await this.generateExcelFile());

            if (this.eventPhoto) {
                files.push(await this.dataUrlToFile(this.eventPhoto, '참석자_사진'));
            }

            for (let i = 0; i < this.expenseItems.length; i++) {
                const item = this.expenseItems[i];
                if (item.receiptImage) {
                    const label = `영수증_${i + 1}_${categoryNameMap[item.category] || item.category}`;
                    files.push(await this.dataUrlToFile(item.receiptImage, label));
                }
            }

            const dateStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
            const shareData = {
                title: `[동아리 정산] ${dateStr} 클럽 비용 정산 보고서`,
                text: `${dateStr} 클럽 비용 정산 보고서와 참석자/영수증 사진을 첨부합니다.`,
                files: files
            };

            if (navigator.canShare && navigator.canShare(shareData)) {
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
        this.tempReceiptImage = null;

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
    // Load state from local storage
    AppState.load();

    // 전사원 명부가 비어있으면 번들된 전사원 데이터로 자동 등록
    if (Object.keys(AppState.directory).length === 0) {
        fetch('./lib/employee_directory.json')
            .then(res => res.json())
            .then(list => AppState.bulkImportDirectory(list))
            .catch(err => console.error("전사원 명부 자동 등록 실패:", err));
    }

    // Club name input init
    const clubNameInput = document.getElementById('club-name-input');
    if (clubNameInput) {
        clubNameInput.value = AppState.clubName;
        clubNameInput.addEventListener('input', () => {
            AppState.clubName = clubNameInput.value.trim();
            AppState.save();
        });
    }

    // Set form input fields default values
    const memberInput = document.getElementById('member-count-input');
    const prizeInput = document.getElementById('prev-prize-input');

    memberInput.value = AppState.memberCount;
    prizeInput.value = AppState.previousPrizeTotal;

    // Set settings form input values
    const setSettingsFormValues = (rules) => {
        document.getElementById('setting-limit1').value = rules.limit1;
        document.getElementById('setting-limit2').value = rules.limit2;
        document.getElementById('setting-rate2').value = Math.round(rules.rate2 * 100);
        document.getElementById('setting-limit3').value = rules.limit3;
        document.getElementById('setting-rate3').value = Math.round(rules.rate3 * 100);
        document.getElementById('setting-deduction4').value = rules.deduction4;
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

    function trySubmitDir() {
        const name = dirNameInput.value.trim();
        const id = dirIdInput.value.trim();
        if (!name || !id) return;

        if (AppState.editingDirName === null && AppState.directory[name] !== undefined) {
            showDirError(`이미 명부에 존재하는 이름입니다: ${name}`);
            return;
        }
        AppState.addDirectoryEntry(name, id);
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
        const limit1 = parseInt(document.getElementById('setting-limit1').value, 10) || 0;
        const limit2 = parseInt(document.getElementById('setting-limit2').value, 10) || 0;
        const rate2 = (parseInt(document.getElementById('setting-rate2').value, 10) || 0) / 100;
        const limit3 = parseInt(document.getElementById('setting-limit3').value, 10) || 0;
        const rate3 = (parseInt(document.getElementById('setting-rate3').value, 10) || 0) / 100;
        const deduction4 = parseInt(document.getElementById('setting-deduction4').value, 10) || 0;

        const annualBudget = parseInt(document.getElementById('setting-annual-budget').value, 10) || 0;
        const usedBudget = parseInt(document.getElementById('setting-used-budget').value, 10) || 0;
        AppState.annualBudget = annualBudget;
        AppState.usedBudget = usedBudget;
        AppState.updateRules({ limit1, limit2, rate2, limit3, rate3, deduction4 });

        // Hide panel after saving
        document.getElementById('settings-panel').classList.add('hidden');
    });

    // Reset settings handler
    document.getElementById('reset-settings-btn').addEventListener('click', () => {
        if (confirm("정산 기준 및 비율을 초기 기본값으로 복원하시겠습니까?")) {
            AppState.resetRules();
            setSettingsFormValues(AppState.rules);
            document.getElementById('settings-panel').classList.add('hidden');
        }
    });

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
        const cardType = document.getElementById('expense-card-type-select').value;
        const corporateAmount = parseInt(document.getElementById('expense-corporate-amount-input').value, 10) || 0;

        if (description && !isNaN(amount) && amount > 0) {
            AppState.addExpense(description, amount, category, cardType, corporateAmount);
            descInput.focus();
        }
    });

    // Card type / split payment listeners
    const cardTypeSelect = document.getElementById('expense-card-type-select');
    const corporateAmountInput = document.getElementById('expense-corporate-amount-input');
    if (cardTypeSelect) {
        cardTypeSelect.addEventListener('change', updateCardTypeUI);
    }
    if (corporateAmountInput) {
        corporateAmountInput.addEventListener('input', updateCardTypeUI);
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

    // Receipt File Upload Change Listener & Compression
    const receiptInput = document.getElementById('expense-receipt-input');
    const receiptStatus = document.getElementById('receipt-preview-status');
    const deleteReceiptBtn = document.getElementById('delete-receipt-btn');

    if (receiptInput && receiptStatus) {
        receiptInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                receiptStatus.textContent = "⌛ 영수증 압축 중...";
                receiptStatus.classList.remove('hidden');

                compressReceiptImage(file, (compressedBase64) => {
                    AppState.tempReceiptImage = compressedBase64;
                    receiptStatus.textContent = "✓ 영수증 대기 완료";
                    if (deleteReceiptBtn) deleteReceiptBtn.classList.remove('hidden');
                });
            } else {
                AppState.tempReceiptImage = null;
                receiptStatus.classList.add('hidden');
                if (deleteReceiptBtn) deleteReceiptBtn.classList.add('hidden');
            }
        });
    }

    if (deleteReceiptBtn) {
        deleteReceiptBtn.addEventListener('click', () => {
            AppState.tempReceiptImage = null;
            receiptStatus.classList.add('hidden');
            receiptInput.value = '';
            deleteReceiptBtn.classList.add('hidden');
        });
    }

    // Split-payment receipt uploads (법인카드/개인카드)
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
    const copyEmailBtn = document.getElementById('copy-email-btn');
    const triggerMailtoBtn = document.getElementById('trigger-mailto-btn');

    if (sendEmailBtn && emailReportModal) {
        sendEmailBtn.addEventListener('click', () => {
            const report = AppState.generateEmailReport();
            
            document.getElementById('email-to-field').value = report.receiver;
            document.getElementById('email-subject-field').value = report.subject;
            document.getElementById('email-body-field').value = report.body;
            
            emailReportModal.classList.remove('hidden');
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

    const finalizeBtn = document.getElementById('finalize-settlement-btn');
    if (finalizeBtn) {
        finalizeBtn.addEventListener('click', () => {
            AppState.finalizeSettlement();
            emailReportModal.classList.add('hidden');
            // Reset form UI state
            document.getElementById('expense-desc-input').value = '';
            document.getElementById('expense-amount-input').value = '';
            document.getElementById('expense-category-select').selectedIndex = 0;
            document.getElementById('expense-receipt-input').value = '';
            document.getElementById('receipt-preview-status').classList.add('hidden');
            const drb = document.getElementById('delete-receipt-btn');
            if (drb) drb.classList.add('hidden');
            document.getElementById('prev-prize-input').value = 0;
            // Switch to history tab
            document.querySelectorAll('.tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
            const histTab = document.querySelector('[data-tab="tab-history"]');
            if (histTab) { histTab.classList.add('active'); document.getElementById('tab-history').classList.remove('hidden'); }
        });
    }

    if (copyEmailBtn) {
        copyEmailBtn.addEventListener('click', () => {
            const bodyText = document.getElementById('email-body-field').value;
            navigator.clipboard.writeText(bodyText).then(() => {
                const originalText = copyEmailBtn.innerHTML;
                copyEmailBtn.innerHTML = "✓ 복사 완료!";
                setTimeout(() => {
                    copyEmailBtn.innerHTML = originalText;
                }, 2000);
            }).catch(err => {
                alert("클립보드 복사에 실패했습니다. 직접 복사해주세요.");
                console.error(err);
            });
        });
    }

    const shareReportBtn = document.getElementById('share-report-btn');
    if (shareReportBtn) {
        shareReportBtn.addEventListener('click', () => {
            AppState.shareSettlementReport();
        });
    }

    if (triggerMailtoBtn) {
        triggerMailtoBtn.addEventListener('click', () => {
            const receiver = document.getElementById('email-to-field').value;
            const subject = document.getElementById('email-subject-field').value;
            const body = document.getElementById('email-body-field').value;
            
            const mailtoUrl = `mailto:${encodeURIComponent(receiver)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            window.location.href = mailtoUrl;
        });
    }

    // Settings panel: init budget fields from saved state
    const annualBudgetInput = document.getElementById('setting-annual-budget');
    const usedBudgetInput = document.getElementById('setting-used-budget');
    const remainingDisplay = document.getElementById('setting-remaining-display');

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
    const pinOfflineBtn = document.getElementById('pin-offline-btn');
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
                    
                    pinOfflineBtn.disabled = true;
                    pinOfflineBtn.textContent = "연결 중...";
                    
                    AppState.loadFromFirebase(pin).then(() => {
                        pinModal.classList.add('hidden');
                        statusBadge.className = 'badge-online';
                        statusBadge.innerHTML = `🌐 온라인 (${AppState.userName || '알 수 없음'} / PIN: ${pin})`;
                        logoutBtn.style.display = 'inline-block';
                        loginBtn.style.display = 'none';
                        pinOfflineBtn.disabled = false;
                        pinOfflineBtn.textContent = "오프라인(기기저장) 모드로 시작";
                        resetPinInput();

                        // Admin tab check
                        const adminTabBtn = document.getElementById('admin-tab-btn');
                        if (pin === "000000") {
                            adminTabBtn.classList.remove('hidden');
                        } else {
                            adminTabBtn.classList.add('hidden');
                        }
                        
                        // Sync values to form fields
                        clubNameInput.value = AppState.clubName || '';
                        memberInput.value = AppState.memberCount || 0;
                        prizeInput.value = AppState.previousPrizeTotal || 0;
                        setSettingsFormValues(AppState.rules);
                        AppState.render();
                    }).catch(err => {
                        console.error(err);
                        pinErrorText.textContent = err.message || "서버 연결에 실패했습니다.";
                        pinErrorText.classList.remove('hidden');
                        pinOfflineBtn.disabled = false;
                        pinOfflineBtn.textContent = "오프라인(기기저장) 모드로 시작";
                        resetPinInput();
                    });
                }
            }
        }
    }

    // Keypad event listeners
    document.querySelectorAll('.pin-key').forEach(key => {
        key.addEventListener('click', () => {
            const val = key.getAttribute('data-value');
            handlePinKeyPress(val);
        });
    });

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

    function switchToOfflineMode() {
        pinModal.classList.add('hidden');
        statusBadge.className = 'badge-offline';
        statusBadge.innerHTML = `📴 오프라인 모드 (기기 저장)`;
        logoutBtn.style.display = 'none';
        loginBtn.style.display = 'inline-block';
        document.getElementById('admin-tab-btn').classList.add('hidden');
        
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
        clubNameInput.value = AppState.clubName || '';
        memberInput.value = AppState.memberCount || 0;
        prizeInput.value = AppState.previousPrizeTotal || 0;
        setSettingsFormValues(AppState.rules);
        AppState.render();
    }

    pinOfflineBtn.addEventListener('click', () => {
        switchToOfflineMode();
    });

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
                    
                    pinModal.classList.add('hidden');
                    statusBadge.className = 'badge-online';
                    statusBadge.innerHTML = `🌐 온라인 (${name} / PIN: ${pin})`;
                    logoutBtn.style.display = 'inline-block';
                    loginBtn.style.display = 'none';
                    
                    // Sync values to form fields
                    clubNameInput.value = AppState.clubName || '';
                    memberInput.value = AppState.memberCount || 0;
                    prizeInput.value = AppState.previousPrizeTotal || 0;
                    setSettingsFormValues(AppState.rules);
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
            renderAdminDashboard();
        });
    }

    function renderAdminDashboard() {
        if (!firebaseDb) return;
        
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
                `;
                tbody.appendChild(tr);
            });
            document.getElementById('admin-total-users').textContent = `${userCount}명`;
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
        });
    }

    function renderAdminHistory(historyList) {
        const container = document.getElementById('admin-history-container');
        const searchVal = (document.getElementById('admin-search-input').value || '').trim().toLowerCase();
        container.innerHTML = '';
        
        const filtered = historyList.filter(entry => {
            if (!searchVal) return true;
            
            // Search creator name
            if (entry.creatorName && entry.creatorName.toLowerCase().includes(searchVal)) return true;
            
            // Search attendees list
            if (entry.attendees && entry.attendees.some(att => att.name && att.name.toLowerCase().includes(searchVal))) return true;
            
            return false;
        });
        
        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">💨</span>
                    <p>일치하는 정산 내역이 없습니다.</p>
                </div>
            `;
            return;
        }
        
        filtered.forEach(entry => {
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

            if (tabId === 'tab-admin') {
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

    // 자체 닫힘 빈 셀: <c r="REF" s="N"/>
    const reSelf = new RegExp(`<c r="${ref}"([^>]*?)/>`);
    const mSelf = xml.match(reSelf);
    if (mSelf) {
        const attrs = mSelf[1].replace(/\st="[^"]*"/, '');
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
    const cardTypeSelect = document.getElementById('expense-card-type-select');
    const splitAmountGroup = document.getElementById('split-amount-group');
    const singleReceiptGroup = document.getElementById('single-receipt-group');
    const splitReceiptGroup = document.getElementById('split-receipt-group');
    if (!cardTypeSelect) return;

    const isSplit = cardTypeSelect.value === 'split';
    splitAmountGroup.classList.toggle('hidden', !isSplit);
    singleReceiptGroup.classList.toggle('hidden', isSplit);
    splitReceiptGroup.classList.toggle('hidden', !isSplit);

    if (isSplit) {
        const total = parseInt(document.getElementById('expense-amount-input').value, 10) || 0;
        const corp = parseInt(document.getElementById('expense-corporate-amount-input').value, 10) || 0;
        const personal = Math.max(total - corp, 0);
        document.getElementById('split-personal-amount-display').textContent = personal.toLocaleString('ko-KR');
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
