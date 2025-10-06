import { db } from './firebase-config.js';
import { ref, set, push, remove, onValue, update } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
    // --- 전역 상태 변수 ---
    let isAdmin = false;
    let currentTabId = null;
    let allData = {};

    // --- Firebase 서비스 가져오기 ---
    const auth = getAuth();

    // --- DOM 요소 ---
    const body = document.body;
    const authBtn = document.getElementById('auth-btn');
    const loginModal = document.getElementById('login-modal');
    const loginModalClose = document.getElementById('login-modal-close');
    const loginForm = document.getElementById('login-form');
    const loginErrorMsg = document.getElementById('login-error-msg');
    const contentStream = document.getElementById('content-stream');
    const tabList = document.getElementById('tab-list');
    const addTabBtn = document.getElementById('add-tab-btn');
    const addContentBtn = document.getElementById('add-content-btn');
    const modal = document.getElementById('add-content-modal');
    const modalClose = document.querySelector('.modal-close');

    // --- Firebase 참조 ---
    const tabsRef = ref(db, 'tabs');

    // === 인증 상태 리스너 (핵심!) ===
    onAuthStateChanged(auth, (user) => {
        if (user) {
            setAdminMode(true);
        } else {
            setAdminMode(false);
        }
    });
    
    // --- 관리자 모드 UI 설정 ---
    function setAdminMode(mode) {
        isAdmin = mode;
        body.classList.toggle('admin-mode', mode);
        authBtn.textContent = mode ? '로그아웃' : '로그인';
        renderAll();
    }
    
    // --- 로그인/로그아웃 버튼 로직 ---
    authBtn.addEventListener('click', () => {
        if (isAdmin) {
            if(confirm('로그아웃 하시겠습니까?')) {
                signOut(auth);
            }
        } else {
            loginErrorMsg.textContent = '';
            loginForm.reset();
            loginModal.style.display = 'flex';
        }
    });

    // --- 로그인 모달 로직 ---
    loginModalClose.addEventListener('click', () => loginModal.style.display = 'none');
    loginModal.addEventListener('click', (e) => (e.target === loginModal) && (loginModal.style.display = 'none'));
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        signInWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                loginModal.style.display = 'none';
            })
            .catch((error) => {
                console.error("로그인 에러:", error.code);
                loginErrorMsg.textContent = '이메일 또는 비밀번호가 잘못되었습니다.';
            });
    });

    // --- 탭 관련 기능 ---
    addTabBtn.addEventListener('click', () => {
        const tabName = prompt('추가할 과목의 이름을 입력하세요:');
        if (tabName) {
            const newTabRef = push(tabsRef);
            set(newTabRef, { name: tabName, content: {} })
                .then(() => {
                    currentTabId = newTabRef.key;
                    renderAll();
                });
        }
    });

    tabList.addEventListener('click', (e) => {
        const target = e.target;
        const tabLi = target.closest('li');
        if (!tabLi) return;

        if (target.closest('.delete-tab-btn')) {
            const tabName = tabLi.querySelector('span[data-editable]').textContent;
            if (confirm(`'${tabName}' 과목을 정말로 삭제하시겠습니까?`)) {
                remove(ref(db, `tabs/${tabLi.dataset.id}`));
            }
            return;
        }

        const newTabId = tabLi.dataset.id;
        if (currentTabId !== newTabId) {
            currentTabId = newTabId;
            renderAll();
        }
    });

    tabList.addEventListener('blur', (e) => {
        if (isAdmin && e.target.matches('span[data-editable]')) {
            const tabId = e.target.closest('li').dataset.id;
            const newName = e.target.textContent;
            if (newName) {
                update(ref(db, `tabs/${tabId}`), { name: newName });
            } else {
                renderAll();
            }
        }
    }, true);


    // --- 콘텐츠 추가 모달 ---
    addContentBtn.addEventListener('click', () => {
        if (!currentTabId) {
            alert('먼저 과목을 선택하거나 추가해주세요.');
            return;
        }
        modal.style.display = 'flex';
    });
    modalClose.addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => (e.target === modal) && (modal.style.display = 'none'));
    document.getElementById('add-concept-choice').addEventListener('click', () => addContentToDB('concept'));
    document.getElementById('add-mcq-choice').addEventListener('click', () => addContentToDB('mcq'));
    document.getElementById('add-saq-choice').addEventListener('click', () => addContentToDB('saq'));

    function addContentToDB(type) {
        const contentRef = ref(db, `tabs/${currentTabId}/content`);
        const questionCount = contentStream.querySelectorAll('.question-card').length + 1;
        let newContent;
         switch (type) {
            case 'concept':
                newContent = { type: 'concept', title: '새로운 개념 제목', description: '여기에 개념 설명을 작성하세요.' };
                break;
            case 'mcq':
                newContent = {
                    type: 'mcq', question: `문제 ${questionCount}.`,
                    options: [
                        { text: '선택지 1', correct: false }, { text: '선택지 2', correct: true },
                        { text: '선택지 3', correct: false }, { text: '선택지 4', correct: false },
                        { text: '선택지 5', correct: false }
                    ]
                };
                break;
            case 'saq':
                 newContent = { type: 'saq', question: `문제 ${questionCount}.`, answer: '모범 답안을 작성하세요.' };
                break;
        }
        if (newContent) push(contentRef, newContent);
        modal.style.display = 'none';
    }


    // --- 데이터 로드 및 전체 렌더링 ---
    onValue(tabsRef, (snapshot) => {
        allData = snapshot.val() || {};
        if (currentTabId && !allData[currentTabId]) {
            currentTabId = Object.keys(allData)[0] || null;
        }
        if (!currentTabId) {
            currentTabId = Object.keys(allData)[0] || null;
        }
        renderAll();
    });

    function renderAll() {
        renderTabs();
        renderContent();
    }

    function renderTabs() {
        tabList.innerHTML = '';
        Object.entries(allData).forEach(([tabId, tabData]) => {
            const li = document.createElement('li');
            li.dataset.id = tabId;
            li.innerHTML = `<span data-editable="tab-name">${tabData.name}</span> <button class="delete-tab-btn admin-only-inline">&times;</button>`;
            li.querySelector('span[data-editable]').setAttribute('contenteditable', isAdmin);

            if (tabId === currentTabId) {
                li.classList.add('active');
            }
            tabList.appendChild(li);
        });
    }

    function renderContent() {
        contentStream.innerHTML = '';
        if (!currentTabId || !allData[currentTabId]) {
            contentStream.innerHTML = `<p class="no-content-message">과목을 선택하거나 새 과목을 추가해주세요.</p>`;
            addContentBtn.style.display = 'none';
            return;
        }
        
        if (isAdmin) {
            addContentBtn.style.display = 'block';
        } else {
            addContentBtn.style.display = 'none';
        }

        const contentData = allData[currentTabId].content || {};
        if (Object.keys(contentData).length === 0) {
            contentStream.innerHTML = `<p class="no-content-message">아직 추가된 콘텐츠가 없습니다. '+' 버튼을 눌러 추가해보세요!</p>`;
        }
        
        Object.entries(contentData).forEach(([contentId, contentValue]) => {
            let card;
            switch(contentValue.type) {
                case 'concept': card = createConceptCard(contentId, contentValue); break;
                case 'mcq': card = createMcqCard(contentId, contentValue); break;
                case 'saq': card = createSaqCard(contentId, contentValue); break;
            }
            if (card) {
                contentStream.appendChild(card);
                card.querySelectorAll('[data-editable]').forEach(el => el.setAttribute('contenteditable', isAdmin));
            }
        });
    }


    // --- 콘텐츠 이벤트 위임 (삭제, 수정 등) ---
    contentStream.addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (!card) return;
        const cardId = card.dataset.id;
        const cardRef = ref(db, `tabs/${currentTabId}/content/${cardId}`);

        if (e.target.classList.contains('delete-btn')) {
            if (confirm('정말로 삭제하시겠습니까?')) remove(cardRef);
            return;
        }

        if (isAdmin && e.target.closest('li')) {
            const targetLi = e.target.closest('li');
            const optionsUl = targetLi.parentElement;
            if (optionsUl.classList.contains('options')) {
                const newOptions = Array.from(optionsUl.children).map((li, index) => ({
                     text: li.querySelector('span[data-editable]').textContent,
                     correct: li === targetLi
                }));
                 update(cardRef, { options: newOptions });
            }
            return;
        }

        if (e.target.classList.contains('toggle-answer-btn')) {
            const answerDiv = e.target.nextElementSibling;
            answerDiv.style.display = answerDiv.style.display === 'block' ? 'none' : 'block';
        } else if (e.target.classList.contains('check-single-mcq-btn')) {
            checkSingleMcq(e.target.closest('.mcq'));
        }
    });

    contentStream.addEventListener('blur', (e) => {
        if (isAdmin && e.target.hasAttribute('data-editable')) {
            const card = e.target.closest('.card');
            const cardId = card.dataset.id;
            const field = e.target.dataset.editable;
            const value = e.target.textContent;
            const cardRef = ref(db, `tabs/${currentTabId}/content/${cardId}`);
            const updates = {};

            if(field.startsWith('option-')) {
                const optionIndex = parseInt(field.split('-')[1]);
                updates[`options/${optionIndex}/text`] = value;
            } else {
                 updates[field] = value;
            }
            update(cardRef, updates);
        }
    }, true);


    // --- 카드 생성 함수들 ---
    function createConceptCard(id, data) {
        const div = document.createElement('div');
        div.className = 'card concept-card';
        div.dataset.id = id;
        div.innerHTML = `
            <h3 data-editable="title">${data.title}</h3>
            <p data-editable="description">${data.description}</p>
            <button class="delete-btn admin-only">삭제</button>`;
        return div;
    }
    function createMcqCard(id, data) {
        const div = document.createElement('div');
        const uniqueName = `q${id}`;
        div.className = 'card question-card mcq';
        div.dataset.id = id;
        const optionsHtml = (data.options || []).map((opt, index) => `
            <li data-correct="${opt.correct}" class="${isAdmin && opt.correct ? 'correct-answer-admin' : ''}">
                <label><input type="radio" name="${uniqueName}" value="${index}"> ${index + 1}) </label>
                <span data-editable="option-${index}">${opt.text}</span>
            </li>
        `).join('');
        div.innerHTML = `
            <p class="question-text" data-editable="question">${data.question}</p>
            <ul class="options">${optionsHtml}</ul>
            <div class="single-quiz-footer">
                <button class="check-single-mcq-btn">정답 확인</button>
                <p class="single-mcq-result"></p>
            </div>
            <div class="admin-only correct-answer-guide">정답으로 만들 선택지를 클릭하세요.</div>
            <button class="delete-btn admin-only">삭제</button>`;
        return div;
    }
    function createSaqCard(id, data) {
        const div = document.createElement('div');
        div.className = 'card question-card saq';
        div.dataset.id = id;
        div.innerHTML = `
            <p class="question-text" data-editable="question">${data.question}</p>
            <textarea placeholder="여기에 답안을 작성하세요..."></textarea>
            <button class="toggle-answer-btn">정답 확인</button>
            <div class="answer" style="display: none;">
                <p><strong>모범 답안:</strong><br><span data-editable="answer">${data.answer}</span></p>
            </div>
            <button class="delete-btn admin-only">삭제</button>`;
        return div;
    }
    function checkSingleMcq(questionCard) {
        const options = questionCard.querySelectorAll('.options li');
        const selectedOption = questionCard.querySelector('input[type="radio"]:checked');
        const resultP = questionCard.querySelector('.single-mcq-result');
        if (!selectedOption) {
            alert('답을 선택해주세요!');
            return;
        }
        options.forEach(opt => opt.classList.remove('user-correct', 'user-incorrect', 'reveal-correct'));
        resultP.classList.remove('correct', 'incorrect');
        const selectedLi = selectedOption.closest('li');
        const isCorrect = selectedLi.dataset.correct === 'true';
        if (isCorrect) {
            selectedLi.classList.add('user-correct');
            resultP.textContent = '정답입니다! 🎉';
            resultP.classList.add('correct');
        } else {
            selectedLi.classList.add('user-incorrect');
            resultP.textContent = '오답입니다. 다시 확인해보세요.';
            resultP.classList.add('incorrect');
        }
        questionCard.querySelector('li[data-correct="true"]').classList.add('reveal-correct');
    }
});