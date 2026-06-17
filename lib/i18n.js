/**
 * i18n — 클럽 비용 정산기 한/영 번역
 * 사용: t('key') → 현재 언어 문자열 반환
 *       applyTranslations() → data-i18n 속성 요소 일괄 갱신
 */

const TRANSLATIONS = {
  ko: {
    /* ── 헤더 ── */
    'header.title': '클럽 비용 정산',
    'header.request': '📝 요청',
    'header.club_placeholder': '클럽을 선택하세요',
    'header.club_new': '+ 새 클럽 직접 등록',
    'header.club_register': '등록',
    'header.offline': '📴 오프라인 모드 (기기 저장)',
    'header.logout': '로그아웃',
    'header.login': '로그인',

    /* ── 업데이트 배너 ── */
    'update.msg': '🔄 새 버전이 있습니다!',
    'update.btn': '지금 업데이트',

    /* ── 탭 ── */
    'tab.settlement': '📊 비용 정산',
    'tab.attendees_plain': '현재 참석자',
    'tab.directory_plain': '전사원 명부',
    'tab.history': '📋 정산 이력',
    'tab.history_title': '정산 이력',
    'tab.club_history': '📋 클럽별 정산이력',
    'tab.club_history_title': '클럽별 정산 이력',
    'tab.charts': '📈 차트',
    'tab.admin': '👑 대시보드 관리',

    /* ── 공통 ── */
    'label.name': '이름',
    'ph.name': '예: 홍길동',
    'label.emp_id': '사번',
    'ph.emp_id': '예: 12345',
    'label.dir_id': 'EMP ID',
    'unit.person': '명',
    'btn.cancel_edit': '수정 취소',
    'btn.confirm': '확인',
    'btn.cancel': '취소',
    'btn.save': '저장',
    'btn.reset_session': '🔄 정산 초기화',

    /* ── 로그인 모달 ── */
    'login.title': '클럽 정산 로그인',
    'login.subtitle': '데이터 저장 및 실시간 동기화를 위해\n6자리 PIN 번호를 입력하세요.',
    'login.error': '비밀번호가 올바르지 않거나 네트워크 오류입니다.',
    'login.go_register': '처음 사용하시나요? 회원 등록하기',

    /* ── 회원 등록 모달 ── */
    'register.title': '신규 회원 등록',
    'register.subtitle': '이름과 로그인용 6자리 PIN 번호를 등록하세요.\n💡 사번이 CG001234 형식이라면 \'CG\'를 뺀 001234를 PIN으로 입력하세요.',
    'register.pin_label': '6자리 PIN 번호',
    'register.pin_ph': '숫자 6자리 입력',
    'register.submit': '회원 등록 완료',
    'register.go_login': '이미 가입하셨나요? 로그인하기',

    /* ── 정산 탭 — 왼쪽 패널 ── */
    'section.attendance': '참석자 및 기존 누적 정보',
    'label.event_photo': '📷 참석자 사진 첨부',
    'label.member_count': '정회원 참석자 수 (명)',
    'hint.member_count': "💡 '참석자 명부' 탭에서 인원을 관리하면 자동 반영됩니다.",
    'label.prev_prize': '기존 상품비 누적액 (원)',
    'section.add_expense': '비용 항목 추가',
    'label.corp_card': '법인카드',
    'label.personal_card': '개인카드',
    'label.expense_desc': '내역 (항목명)',
    'ph.expense_desc': '예: 저녁 식대, 대관료 등',
    'label.expense_amount': '금액 (원)',
    'label.expense_cat': '구분 (카테고리)',
    'cat.event': '행사비',
    'cat.facility': '시설 및 장비 이용료',
    'cat.prize': '상품',
    'btn.add_expense': '✨ 항목 추가',
    'btn.receipt': '영수증',
    'btn.delete_receipt': '× 영수증 삭제',
    'hint.receipt_ready': '✓ 영수증 대기 완료',

    /* ── 정산 탭 — 오른쪽 패널 ── */
    'section.expense_list': '비용 목록',
    'empty.expenses': '등록된 비용 항목이 없습니다. 항목을 추가해 주세요.',
    'section.result': '자동 정산 결과',
    'label.final_support': '최종 지원금 (지원 한도 내)',
    'label.total_self_pay': '총 자부담 금액 (수정 가능)',
    'label.per_person_self_pay': '인당 자부담 비용',
    'label.self_pay_ratio': '자부담 비율',
    'label.total_cost': '총 소요 비용',
    'label.event_cost': '└ 행사비 총합',
    'label.facility_cost': '└ 시설 및 장비 이용료',
    'label.prize_cost': '└ 상품비 총합',
    'label.per_person_event': '└ 인당 행사비 (행사비 / 참석자)',
    'label.club_remaining': '클럽 잔여 예산',
    'label.prev_remaining': '이전 잔여 예산',
    'label.this_support_sub': '└ 이번 최종 지원금 (-)',
    'label.after_remaining': '└ 이후 남은 잔여 금액',
    'btn.save_excel': '📥 엑셀 파일로 저장',
    'section.warnings': '주의사항 및 한도 경고',

    /* ── 설정 패널 ── */
    'section.budget': '💰 연간 예산 관리',
    'label.annual_budget': '올해 클럽 지원 총예산 (원)',
    'hint.annual_budget': '💡 관리자 대시보드의 클럽 관리에서 선택한 클럽에 배정한 예산이 자동으로 표시됩니다.',
    'label.used_budget': '기존에 사용한 누적 금액 (원)',
    'hint.used_budget': '💡 이전에 이미 사용한 비용을 한 번에 입력하면, 현재 시점부터 이어서 정산을 진행할 수 있습니다.',
    'label.remaining_display': '→ 현재 잔여 예산',
    'btn.save_settings': '설정 저장',

    /* ── 참석자 탭 ── */
    'section.add_attendee': '참석자 추가',
    'btn.add_attendee_full': '👥 참석 추가',
    'section.current_attendees': '현재 참석자 명단',
    'btn.clear_attendees': '전체 비우기',
    'empty.attendees': '현재 등록된 참석자가 없습니다. 왼쪽에서 사번과 이름을 기입하여 추가해 주세요.',

    /* ── 전사원 명부 탭 ── */
    'section.dir_register': '전사원 등록',
    'section.dir_list': '전사원 명부',
    'btn.dir_register': '🗂️ 사원 등록',
    'warn.dup_name': '동일한 이름이 존재합니다. 이름뒤에 (부서명)을 적어주세요.',
    'empty.directory': '등록된 사원 정보가 없습니다. 왼쪽에서 사원을 등록해 주세요.',

    /* ── 정산 이력 탭 ── */
    'empty.history': '저장된 정산 이력이 없습니다.',
    'hist.attendees': '참석 인원',
    'hist.total_cost': '총 소요',
    'hist.final_support': '최종 지원금',
    'hist.self_pay': '총 자부담',
    'hist.view_details': '상세 내역 보기',
    'hist.no_items': '항목 없음',
    'hist.no_attendees': '참석자 없음',

    /* ── 클럽별 정산이력 탭 ── */
    'label.club_select': '클럽 선택',
    'opt.all_clubs': '전체 클럽 (월별)',
    'label.user_select': '정산인 선택',
    'opt.all_users': '전체 사용자',

    /* ── 차트 탭 ── */
    'chart.monthly_title': '월별 클럽 지출 현황',
    'chart.usage_title': '클럽별 예산 소진율',
    'chart.cat_title': '카테고리별 누적 비용 비중',
    'chart.selfpay_title': '자부담 / 회사지원금 추이',
    'stat.total_budget': '💰 총 예산',
    'stat.used_budget': '💸 사용 예산',
    'stat.remaining_budget': '🟢 잔여 예산',

    /* ── 관리자 탭 ── */
    'admin.mode_title': '👑 전체 관리자 모드',
    'stat.total_users': '👥 총 등록 가입자',
    'stat.total_spend': '💰 전체 누적 지출액',
    'stat.total_support': '🏢 전체 누적 지원금',
    'stat.total_selfpay': '👤 전체 누적 자부담',
    'admin.rules_title': '정산 구간 및 비율 설정 (전체 클럽 공통 적용)',
    'admin.rule_limit1': '가. 지원 한도 (원 이하 자부담 0%)',
    'admin.rule_limit2': '나. 구간 한도 (원)',
    'admin.rule_rate2': '나. 자부담 비율 (%)',
    'admin.rule_limit3': '다. 구간 한도 (원)',
    'admin.rule_rate3': '다. 자부담 비율 (%)',
    'admin.rule_deduct4': '라. 초과 시 자부담 공제액 (원)',
    'admin.save_rules': '정산 비율 저장 (일괄 적용)',
    'admin.reset_rules': '기본값 복원',
    'admin.club_mgmt_title': '클럽 관리',
    'admin.total_club_budget_label': '올해 사용 가능한 총 클럽비용 (원)',
    'admin.club_name_label': '클럽명',
    'ph.club_name': '예: 동탄 All balls',
    'admin.club_budget_label': '배정 예산 (원)',
    'btn.add_club': '➕ 클럽 추가',
    'admin.user_mgmt_title': '가입 회원 관리 (이름 / PIN 수정)',
    'th.name': '이름',
    'th.pin': '6자리 PIN',
    'th.join_date': '가입일',
    'th.manage': '관리',

    /* ── 이메일 모달 ── */
    'modal.email_title': '이메일 정산서 초안',
    'modal.email_to': '수신자',
    'modal.email_subject': '제목',
    'modal.email_body': '본문 내용 (복사 가능)',
    'btn.excel_download': '💾 엑셀 다운로드',
    'btn.open_mail': '✉️ 메일 앱 열기',
    'btn.share_report': '📤 엑셀+사진 첨부하여 공유',
    'hint.share_report': '엑셀 정산표 + 참석자/영수증 사진을 묶어 공유 시트로 보냅니다 (메일 앱 선택 가능)',
    'btn.finalize': '✅ 정산 확정 — 이력 저장 & 초기화',
    'hint.finalize': '누적 카운트 반영 후 현재 데이터가 초기화됩니다',

    /* ── 피드백 모달 ── */
    'modal.feedback_title': '요청사항 보내기',
    'modal.feedback_label': '메시지',
    'modal.feedback_ph': '개발자/관리자에게 전달할 요청사항이나 버그를 적어주세요.',
    'btn.feedback_send': '📨 요청 보내기',
    'modal.new_request_title': '새 요청사항 도착',

    /* ── 팝업 ── */
    'popup.diff_label': '자부담 변경 내역',

    /* ── 엑셀 저장 완료 모달 ── */
    'excel_saved.title': '저장이 완료되었습니다.',
    'excel_saved.question': '화면을 초기화하시겠습니까?',
    'excel_saved.yes': '예, 초기화',
    'excel_saved.no': '아니요',

    /* ── 초기화 확인 모달 ── */
    'reset.title': '현재 정산을 초기화합니다.',
    'reset.question': '비용 항목·참석자가 모두 삭제됩니다.\n정산 이력에는 저장되지 않습니다. 계속하시겠습니까?',
    'reset.yes': '예, 초기화',
    'reset.no': '취소',
  },

  en: {
    /* ── Header ── */
    'header.title': 'Club Expense',
    'header.request': '📝 Request',
    'header.club_placeholder': 'Select a club',
    'header.club_new': '+ Register new club',
    'header.club_register': 'Register',
    'header.offline': '📴 Offline mode (local)',
    'header.logout': 'Logout',
    'header.login': 'Login',

    /* ── Update Banner ── */
    'update.msg': '🔄 A new version is available!',
    'update.btn': 'Update Now',

    /* ── Tabs ── */
    'tab.settlement': '📊 Settlement',
    'tab.attendees_plain': 'Attendees',
    'tab.directory_plain': 'Directory',
    'tab.history': '📋 History',
    'tab.history_title': 'Settlement History',
    'tab.club_history': '📋 Club History',
    'tab.club_history_title': 'Club Settlement History',
    'tab.charts': '📈 Charts',
    'tab.admin': '👑 Dashboard',

    /* ── Common ── */
    'label.name': 'Name',
    'ph.name': 'e.g. John Kim',
    'label.emp_id': 'Employee ID',
    'ph.emp_id': 'e.g. 12345',
    'label.dir_id': 'EMP ID',
    'unit.person': ' persons',
    'btn.cancel_edit': 'Cancel Edit',
    'btn.confirm': 'Confirm',
    'btn.cancel': 'Cancel',
    'btn.save': 'Save',
    'btn.reset_session': '🔄 Reset Session',

    /* ── Login Modal ── */
    'login.title': 'Club Settlement Login',
    'login.subtitle': 'Enter your 6-digit PIN to\nsync data in real time.',
    'login.error': 'Incorrect PIN or network error.',
    'login.go_register': 'New here? Register now',

    /* ── Register Modal ── */
    'register.title': 'New Member Registration',
    'register.subtitle': "Enter your name and a 6-digit PIN.\n💡 If your employee ID is CG001234, use 001234 (drop 'CG') as your PIN.",
    'register.pin_label': '6-Digit PIN',
    'register.pin_ph': 'Enter 6 digits',
    'register.submit': 'Complete Registration',
    'register.go_login': 'Already registered? Login',

    /* ── Settlement Tab — Left Panel ── */
    'section.attendance': 'Attendance & Prior Info',
    'label.event_photo': '📷 Attach Event Photo',
    'label.member_count': 'Number of Attendees',
    'hint.member_count': "💡 Managed via the 'Attendees' tab — updates automatically.",
    'label.prev_prize': 'Prior Accumulated Prize Cost (₩)',
    'section.add_expense': 'Add Expense',
    'label.corp_card': 'Corp Card',
    'label.personal_card': 'Personal Card',
    'label.expense_desc': 'Description',
    'ph.expense_desc': 'e.g. Dinner, Venue rental',
    'label.expense_amount': 'Amount (₩)',
    'label.expense_cat': 'Category',
    'cat.event': 'Event',
    'cat.facility': 'Facility / Equipment',
    'cat.prize': 'Prize',
    'btn.add_expense': '✨ Add Item',
    'btn.receipt': 'Receipt',
    'btn.delete_receipt': '× Delete Receipt',
    'hint.receipt_ready': '✓ Receipt ready',

    /* ── Settlement Tab — Right Panel ── */
    'section.expense_list': 'Expense List',
    'empty.expenses': 'No expense items yet. Add an item to get started.',
    'section.result': 'Auto Settlement Result',
    'label.final_support': 'Final Support Amount',
    'label.total_self_pay': 'Total Self-Pay (editable)',
    'label.per_person_self_pay': 'Self-Pay per Person',
    'label.self_pay_ratio': 'Self-Pay Ratio',
    'label.total_cost': 'Total Cost',
    'label.event_cost': '└ Event Cost',
    'label.facility_cost': '└ Facility / Equipment',
    'label.prize_cost': '└ Prize Cost',
    'label.per_person_event': '└ Per-Person Event Cost',
    'label.club_remaining': 'Club Remaining Budget',
    'label.prev_remaining': 'Prior Remaining Budget',
    'label.this_support_sub': '└ This Support (-)',
    'label.after_remaining': '└ Remaining After',
    'btn.save_excel': '📥 Save as Excel',
    'section.warnings': 'Warnings & Limit Alerts',

    /* ── Settings Panel ── */
    'section.budget': '💰 Annual Budget',
    'label.annual_budget': 'Annual Club Budget (₩)',
    'hint.annual_budget': '💡 Auto-filled from the club budget set in the admin dashboard.',
    'label.used_budget': 'Prior Used Amount (₩)',
    'hint.used_budget': '💡 Enter any amount already spent to continue tracking from now.',
    'label.remaining_display': '→ Current Remaining',
    'btn.save_settings': 'Save Settings',

    /* ── Attendees Tab ── */
    'section.add_attendee': 'Add Attendee',
    'btn.add_attendee_full': '👥 Add Attendee',
    'section.current_attendees': 'Current Attendee List',
    'btn.clear_attendees': 'Clear All',
    'empty.attendees': 'No attendees registered. Add employee ID and name on the left.',

    /* ── Directory Tab ── */
    'section.dir_register': 'Register Employee',
    'section.dir_list': 'All Employees',
    'btn.dir_register': '🗂️ Register',
    'warn.dup_name': 'Duplicate name found. Please add (Department) after the name.',
    'empty.directory': 'No employees registered. Add one on the left.',

    /* ── History Tab ── */
    'empty.history': 'No settlement history saved.',
    'hist.attendees': 'Attendees',
    'hist.total_cost': 'Total',
    'hist.final_support': 'Support',
    'hist.self_pay': 'Self-Pay',
    'hist.view_details': 'View Details',
    'hist.no_items': 'No items',
    'hist.no_attendees': 'No attendees',

    /* ── Club History Tab ── */
    'label.club_select': 'Select Club',
    'opt.all_clubs': 'All Clubs (by month)',
    'label.user_select': 'Select User',
    'opt.all_users': 'All Users',

    /* ── Charts Tab ── */
    'chart.monthly_title': 'Monthly Club Spending',
    'chart.usage_title': 'Club Budget Usage Rate',
    'chart.cat_title': 'Cumulative Cost by Category',
    'chart.selfpay_title': 'Self-Pay vs Company Support',
    'stat.total_budget': '💰 Total Budget',
    'stat.used_budget': '💸 Used Budget',
    'stat.remaining_budget': '🟢 Remaining Budget',

    /* ── Admin Tab ── */
    'admin.mode_title': '👑 Admin Dashboard',
    'stat.total_users': '👥 Total Members',
    'stat.total_spend': '💰 Cumulative Spending',
    'stat.total_support': '🏢 Cumulative Support',
    'stat.total_selfpay': '👤 Cumulative Self-Pay',
    'admin.rules_title': 'Settlement Rules (applied to all clubs)',
    'admin.rule_limit1': 'A. Support Limit (₩, self-pay 0% below)',
    'admin.rule_limit2': 'B. Bracket Limit (₩)',
    'admin.rule_rate2': 'B. Self-Pay Rate (%)',
    'admin.rule_limit3': 'C. Bracket Limit (₩)',
    'admin.rule_rate3': 'C. Self-Pay Rate (%)',
    'admin.rule_deduct4': 'D. Deduction for Overage (₩)',
    'admin.save_rules': 'Save Rules (apply to all)',
    'admin.reset_rules': 'Restore Defaults',
    'admin.club_mgmt_title': 'Club Management',
    'admin.total_club_budget_label': 'Total Available Club Budget This Year (₩)',
    'admin.club_name_label': 'Club Name',
    'ph.club_name': 'e.g. Dongtan All Balls',
    'admin.club_budget_label': 'Assigned Budget (₩)',
    'btn.add_club': '➕ Add Club',
    'admin.user_mgmt_title': 'Member Management (Name / PIN Edit)',
    'th.name': 'Name',
    'th.pin': '6-Digit PIN',
    'th.join_date': 'Join Date',
    'th.manage': 'Manage',

    /* ── Email Modal ── */
    'modal.email_title': 'Settlement Report Draft',
    'modal.email_to': 'To',
    'modal.email_subject': 'Subject',
    'modal.email_body': 'Body (copyable)',
    'btn.excel_download': '💾 Download Excel',
    'btn.open_mail': '✉️ Open Mail App',
    'btn.share_report': '📤 Share Excel + Photos',
    'hint.share_report': 'Bundles Excel + photos and opens share sheet (choose mail app)',
    'btn.finalize': '✅ Finalize — Save & Reset',
    'hint.finalize': 'Counts will be updated and current data will be cleared.',

    /* ── Feedback Modal ── */
    'modal.feedback_title': 'Send Request',
    'modal.feedback_label': 'Message',
    'modal.feedback_ph': 'Describe your request or bug for the developer/admin.',
    'btn.feedback_send': '📨 Send Request',
    'modal.new_request_title': 'New Request Arrived',

    /* ── Popup ── */
    'popup.diff_label': 'Self-Pay Change',

    /* ── Excel Saved Modal ── */
    'excel_saved.title': 'File saved successfully.',
    'excel_saved.question': 'Would you like to reset the screen?',
    'excel_saved.yes': 'Yes, Reset',
    'excel_saved.no': 'No',

    /* ── Reset Modal ── */
    'reset.title': 'Reset current session.',
    'reset.question': 'All expense items and attendees will be cleared.\nThis will NOT be saved to history. Continue?',
    'reset.yes': 'Yes, Reset',
    'reset.no': 'Cancel',
  }
};

let _lang = localStorage.getItem('app_lang') || 'ko';

function t(key) {
  return (TRANSLATIONS[_lang] && TRANSLATIONS[_lang][key]) ||
         (TRANSLATIONS['ko'][key]) || key;
}

function setLang(lang) {
  _lang = lang;
  localStorage.setItem('app_lang', lang);
  document.documentElement.lang = lang === 'ko' ? 'ko' : 'en';
  applyTranslations();
}

function getLang() { return _lang; }

// 페이지 로드 즉시 번역 적용 (로그인 전 포함)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyTranslations);
} else {
  applyTranslations();
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (val) el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph');
    const val = t(key);
    if (val) el.placeholder = val;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    const val = t(key);
    if (val) el.title = val;
  });
  // 카테고리 옵션 갱신
  const catSelect = document.getElementById('expense-category-select');
  if (catSelect) {
    catSelect.options[0].text = t('cat.event');
    catSelect.options[1].text = t('cat.facility');
    catSelect.options[2].text = t('cat.prize');
  }
  // 클럽별 이력 전체클럽 옵션
  const clubHistSel = document.getElementById('club-history-select');
  if (clubHistSel && clubHistSel.options[0]) {
    clubHistSel.options[0].text = t('opt.all_clubs');
  }
  // 정산인 선택 전체 옵션
  const userSel = document.getElementById('admin-user-select');
  if (userSel && userSel.options[0]) {
    userSel.options[0].text = t('opt.all_users');
  }
  // 로그인 모달 언어 선택 드롭다운 현재값 동기화
  const loginSel = document.getElementById('login-lang-select');
  if (loginSel) loginSel.value = _lang;
  // 카운트 포함 탭 버튼 (span 자식 보존하며 텍스트만 교체)
  const atBtn = document.getElementById('attendees-tab-btn');
  if (atBtn) {
    const cnt = document.getElementById('attendee-badge-count');
    const n = cnt ? cnt.textContent : '0';
    const unit = t('unit.person');
    atBtn.innerHTML = `👥 ${t('tab.attendees_plain')} (<span id="attendee-badge-count">${n}</span>${unit})`;
  }
  const dirBtn = document.getElementById('directory-tab-btn');
  if (dirBtn) {
    const cnt = document.getElementById('directory-badge-count');
    const n = cnt ? cnt.textContent : '0';
    const unit = t('unit.person');
    dirBtn.innerHTML = `🗂️ ${t('tab.directory_plain')} (<span id="directory-badge-count">${n}</span>${unit})`;
  }
}
