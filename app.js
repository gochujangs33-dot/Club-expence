/**
 * Club Expense Settlement App - Main JavaScript Logic
 */

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
        } catch (e) {
            console.error("Local storage load failed:", e);
        }
    },

    save() {
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
    },

    addExpense(description, amount, category) {
        if (this.editingItemId !== null) {
            const index = this.expenseItems.findIndex(item => item.id === this.editingItemId);
            if (index !== -1) {
                this.expenseItems[index].description = description;
                this.expenseItems[index].amount = amount;
                this.expenseItems[index].category = category;
                this.expenseItems[index].receiptImage = this.tempReceiptImage;
            }
        } else {
            const item = {
                id: Date.now(),
                description,
                amount,
                category,
                receiptImage: this.tempReceiptImage
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

            // Load receipt preview status
            this.tempReceiptImage = item.receiptImage || null;
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
            const dirKeys = Object.keys(this.directory).sort((a, b) => a.localeCompare(b, 'ko'));
            directoryCount.textContent = dirKeys.length;
            
            directoryContainer.innerHTML = '';
            
            if (dirKeys.length === 0) {
                directoryContainer.innerHTML = `
                    <div class="empty-state" style="padding: 1rem 0;">
                        <p style="font-size: 0.8rem;">누적된 사원 정보가 없습니다.</p>
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

    finalizeSettlement() {
        if (!confirm("정산을 확정하시겠습니까?\n확정하면 현재 비용 및 참석자 데이터가 초기화됩니다.")) return;

        const result = SettlementCalculator.calculate(
            this.memberCount, this.expenseItems, this.previousPrizeTotal, this.rules
        );

        // Use manually adjusted self-pay if user changed it, otherwise use calculated
        const finalTotalSelfPay = this.lastCalculatedSelfPay > 0 ? this.lastCalculatedSelfPay : result.totalSelfPay;
        const finalPerPersonSelfPay = this.memberCount > 0 ? finalTotalSelfPay / this.memberCount : result.perPersonSelfPay;
        const finalSelfPayRatio = result.totalCost > 0 ? finalTotalSelfPay / result.totalCost : 0;

        // Save to history
        this.settlementHistory.unshift({
            id: Date.now(),
            date: new Date().toISOString(),
            clubName: this.clubName,
            memberCount: this.memberCount,
            totalCost: result.totalCost,
            finalSupportAmount: result.totalCost - finalTotalSelfPay,
            totalSelfPay: finalTotalSelfPay,
            perPersonSelfPay: finalPerPersonSelfPay,
            selfPayRatio: finalSelfPayRatio,
            expenseItems: JSON.parse(JSON.stringify(this.expenseItems)),
            attendees: JSON.parse(JSON.stringify(this.attendees)),
        });

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

        if (description && !isNaN(amount) && amount > 0) {
            AppState.addExpense(description, amount, category);
            descInput.focus();
        }
    });

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

    // Initial render
    AppState.render();
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
