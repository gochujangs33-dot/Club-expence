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
    'header.lang': 'ENG',

    /* ── 탭 ── */
    'tab.settlement': '📊 비용 정산',
    'tab.attendees': '👥 현재 참석자',
    'tab.directory': '🗂️ 전사원 명부',
    'tab.history': '📋 정산 이력',
    'tab.club_history': '📋 클럽별 정산이력',
    'tab.charts': '📈 차트',
    'tab.admin': '👑 대시보드 관리',

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
    'btn.cancel_edit': '수정 취소',
    'btn.receipt': '영수증',
    'btn.delete_receipt': '× 영수증 삭제',
    'hint.receipt_ready': '✓ 영수증 대기 완료',
    'btn.reset_session': '🔄 현재 정산 초기화',

    /* ── 정산 탭 — 오른쪽 패널 ── */
    'section.expense_list': '비용 목록',
    'btn.clear_all': '모두 삭제',
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
    'label.attendee_name': '이름',
    'ph.attendee_name': '예: 홍길동',
    'label.attendee_id': '사번',
    'ph.attendee_id': '예: 12345',
    'btn.add_attendee': '👤 참석자 추가',
    'section.current_attendees': '현재 참석자 목록',
    'empty.attendees': '등록된 참석자가 없습니다.',

    /* ── 전사원 명부 탭 ── */
    'section.dir_register': '전사원 등록',
    'label.dir_name': '이름',
    'label.dir_id': 'EMP ID',
    'btn.dir_register': '📋 사원 등록',
    'ph.dir_search': '이름으로 검색...',

    /* ── 정산 이력 탭 ── */
    'empty.history': '정산 이력이 없습니다.',

    /* ── 클럽별 정산이력 탭 ── */
    'label.club_select': '클럽 선택',
    'opt.all_clubs': '전체 클럽 (월별)',
    'label.user_select': '정산인 선택',
    'opt.all_users': '전체 사용자',
    'ph.member_search': '회원 이름 검색 (예: 홍길동)...',

    /* ── 업데이트 배너 ── */
    'update.msg': '🔄 새 버전이 있습니다!',
    'update.btn': '지금 업데이트',

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
    'header.lang': '한국어',

    /* ── Tabs ── */
    'tab.settlement': '📊 Settlement',
    'tab.attendees': '👥 Attendees',
    'tab.directory': '🗂️ Directory',
    'tab.history': '📋 History',
    'tab.club_history': '📋 Club History',
    'tab.charts': '📈 Charts',
    'tab.admin': '👑 Dashboard',

    /* ── Settlement — Left Panel ── */
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
    'btn.cancel_edit': 'Cancel Edit',
    'btn.receipt': 'Receipt',
    'btn.delete_receipt': '× Delete Receipt',
    'hint.receipt_ready': '✓ Receipt ready',
    'btn.reset_session': '🔄 Reset Current Session',

    /* ── Settlement — Right Panel ── */
    'section.expense_list': 'Expense List',
    'btn.clear_all': 'Clear All',
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
    'label.attendee_name': 'Name',
    'ph.attendee_name': 'e.g. John Kim',
    'label.attendee_id': 'Employee ID',
    'ph.attendee_id': 'e.g. 12345',
    'btn.add_attendee': '👤 Add Attendee',
    'section.current_attendees': 'Current Attendee List',
    'empty.attendees': 'No attendees registered.',

    /* ── Directory Tab ── */
    'section.dir_register': 'Register Employee',
    'label.dir_name': 'Name',
    'label.dir_id': 'EMP ID',
    'btn.dir_register': '📋 Register',
    'ph.dir_search': 'Search by name...',

    /* ── History Tab ── */
    'empty.history': 'No settlement history.',

    /* ── Club History Tab ── */
    'label.club_select': 'Select Club',
    'opt.all_clubs': 'All Clubs (by month)',
    'label.user_select': 'Select User',
    'opt.all_users': 'All Users',
    'ph.member_search': 'Search member name...',

    /* ── Update Banner ── */
    'update.msg': '🔄 A new version is available!',
    'update.btn': 'Update Now',

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
}
