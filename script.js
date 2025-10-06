import { db } from './firebase-config.js';
import { ref, set, push, remove, onValue, update, runTransaction, onDisconnect, query, orderByChild, off, onChildAdded, onChildChanged, onChildRemoved, get } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
    // --- 전역 상태 변수 ---
    let isAdmin = false;
    let currentTabId = null;
    let allTabsData = {}; // [수정] 탭 데이터만 저장하는 객체로 변경
    let currentContentListeners = {};

    // --- 실시간 편집 잠금 관련 ---
    const sessionId = Math.random().toString(36).substring(2);
    const locksRef = ref(db, 'editingLocks');
    let currentLocks = {};

    // --- Firebase 서비스 가져오기 ---
    const auth = getAuth();

    // --- DOM 요소 ---
    const body = document.body;
    const authBtn = document.getElementById('auth-btn');
    const contentStream = document.getElementById('content-stream');
    const loginModal = document.getElementById('login-modal');
    const loginModalClose = document.getElementById('login-modal-close');
    const loginForm = document.getElementById('login-form');
    const loginErrorMsg = document.getElementById('login-error-msg');
    const tabList = document.getElementById('tab-list');
    const addTabBtn = document.getElementById('add-tab-btn');
    const addContentBtn = document.getElementById('add-content-btn');
    const modal = document.getElementById('add-content-modal');
    const modalClose = document.querySelector('.modal-close');

    // === 인증 상태 리스너 ===
    onAuthStateChanged(auth, (user) => {
        setAdminMode(!!user);
    });
    
    // --- 관리자 모드 UI 설정 ---
    function setAdminMode(mode) {
        isAdmin = mode;
        body.classList.toggle('admin-mode', mode);
        authBtn.textContent = mode ? '로그아웃' : '로그인';
        
        if (sortableInstance) {
            sortableInstance.option("disabled", !mode);
        }
        
        // [수정] 현재 탭과 콘텐츠가 있을 때만 UI 상태를 업데이트하도록 변경
        if(currentTabId) {
            renderTabs();
            // 콘텐츠 영역의 editable 상태도 다시 적용
            contentStream.querySelectorAll('[data-editable], .saq textarea').forEach(el => {
                if (el.tagName === 'TEXTAREA') {
                    el.disabled = !mode;
                } else {
                    el.setAttribute('contenteditable', mode);
                }
            });
            applyLocksToUI();
        }
    }
    
    // --- 로그인/로그아웃 버튼 로직 ---
    authBtn.addEventListener('click', () => {
        if (isAdmin) {
            if(confirm('로그아웃 하시겠습니까?')) signOut(auth);
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
            .then(() => loginModal.style.display = 'none')
            .catch((error) => loginErrorMsg.textContent = '이메일 또는 비밀번호가 잘못되었습니다.');
    });

    // --- 탭 관련 기능 ---
    addTabBtn.addEventListener('click', () => {
        const tabName = prompt('추가할 과목의 이름을 입력하세요:');
        if (tabName) {
            const newTabRef = push(ref(db, 'tabs'));
            // [수정] 콘텐츠 없이 탭 정보만 저장
            set(newTabRef, { name: tabName, order: Object.keys(allTabsData).length });
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
            renderTabs();
            setupContentListeners();
        }
    });

    tabList.addEventListener('blur', (e) => {
        if (isAdmin && e.target.matches('span[data-editable]')) {
            const tabId = e.target.closest('li').dataset.id;
            const newName = e.target.innerHTML.trim(); // [수정] trim 추가
            if (newName && newName !== allTabsData[tabId].name) { // [수정] 변경되었을 때만 업데이트
                update(ref(db, `tabs/${tabId}`), { name: newName });
            } else {
                // 이름이 비었거나 변경되지 않았으면 원래 이름으로 복원
                e.target.innerHTML = allTabsData[tabId].name;
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
    document.getElementById('add-image-choice').addEventListener('click', () => addContentToDB('image'));

    async function addContentToDB(type) {
        const contentRef = ref(db, `tabs/${currentTabId}/content`);
        // [수정] DB에서 현재 콘텐츠 개수를 직접 가져와서 순서 결정
        const snapshot = await get(query(contentRef, orderByChild('order')));
        const newOrder = snapshot.exists() ? snapshot.size : 0;
        
        let newContent;
        switch (type) {
            case 'concept':
                newContent = { type: 'concept', title: '새로운 개념 제목', description: '내용을 입력하세요.', order: newOrder };
                break;
            case 'mcq':
                newContent = { type: 'mcq', question: '새로운 문제', options: [
                    { text: '선택지 1', correct: false }, { text: '선택지 2', correct: true },
                    { text: '선택지 3', correct: false }, { text: '선택지 4', correct: false },
                    { text: '선택지 5', correct: false }], order: newOrder };
                break;
            case 'saq':
                newContent = { type: 'saq', question: '새로운 서술형 문제', answer: '모범 답안', userAnswer: '', order: newOrder };
                break;
            case 'image':
                const imageUrl = prompt('이미지 주소(URL)를 입력하세요:');
                if (imageUrl) {
                    newContent = { type: 'image', title: '새로운 이미지 제목', imageUrl: imageUrl, order: newOrder };
                }
                break;
        }
        if (newContent) push(contentRef, newContent);
        modal.style.display = 'none';
    }

    // ======================== 버그 수정 시작 (핵심 변경) ========================
    // [수정] 데이터 로딩 방식을 정밀 리스너 방식으로 전면 교체
    const tabsRef = ref(db, 'tabs');
    
    // 1. 탭 추가 감지
    onChildAdded(tabsRef, (snapshot) => {
        allTabsData[snapshot.key] = snapshot.val();
        
        // 처음 로딩 시 첫 번째 탭을 활성화
        if (!currentTabId) {
            currentTabId = snapshot.key;
            setupContentListeners();
        }
        renderTabs();
    });

    // 2. 탭 변경 (이름 등) 감지
    onChildChanged(tabsRef, (snapshot) => {
        allTabsData[snapshot.key] = snapshot.val();
        renderTabs(); // 탭 이름이 바뀌었으니 탭 목록만 다시 그림
    });

    // 3. 탭 삭제 감지
    onChildRemoved(tabsRef, (snapshot) => {
        const deletedTabId = snapshot.key;
        delete allTabsData[deletedTabId];

        // 현재 보고 있던 탭이 삭제된 경우
        if (currentTabId === deletedTabId) {
            currentTabId = Object.keys(allTabsData)[0] || null; // 다른 탭을 선택하거나 null로 설정
            setupContentListeners();
        }
        renderTabs();
    });

    // [추가] 초기 데이터가 없을 경우를 대비한 처리
    onValue(tabsRef, (snapshot) => {
        if (!snapshot.exists()) {
            allTabsData = {};
            currentTabId = null;
            renderTabs();
            setupContentListeners();
        }
    }, { onlyOnce: true }); // 최초 한 번만 실행하여 초기 상태 확인
    
    // ======================== 버그 수정 종료 ========================

    function renderTabs() {
        tabList.innerHTML = '';
        // [수정] allTabsData 사용
        Object.entries(allTabsData).forEach(([tabId, tabData]) => {
            const li = document.createElement('li');
            li.dataset.id = tabId;
            li.innerHTML = `<span data-editable="tab-name">${tabData.name}</span> <button class="delete-tab-btn admin-only-inline">&times;</button>`;
            
            // [수정] li의 contenteditable 상태는 여기서 직접 관리
            const span = li.querySelector('[data-editable]');
            if(span) span.setAttribute('contenteditable', isAdmin);

            if (tabId === currentTabId) li.classList.add('active');
            tabList.appendChild(li);
        });
    }

    function setupContentListeners() {
        if (currentContentListeners.ref) {
            off(currentContentListeners.ref, 'child_added', currentContentListeners.added);
            off(currentContentListeners.ref, 'child_changed', currentContentListeners.changed);
            off(currentContentListeners.ref, 'child_removed', currentContentListeners.removed);
        }
        contentStream.innerHTML = '';

        if (!currentTabId) {
            contentStream.innerHTML = `<p class="no-content-message">과목을 선택하거나 새 과목을 추가해주세요.</p>`;
            addContentBtn.style.display = 'none';
            return;
        }
        
        addContentBtn.style.display = isAdmin ? 'block' : 'none';

        const contentRef = ref(db, `tabs/${currentTabId}/content`);
        const contentQuery = query(contentRef, orderByChild('order'));

        currentContentListeners.ref = contentRef;

        currentContentListeners.added = onChildAdded(contentQuery, (snapshot) => {
            const cardId = snapshot.key;
            const cardData = snapshot.val();
            if (contentStream.querySelector(`[data-id="${cardId}"]`)) return;

            const cardElement = createCardElement(cardId, cardData);
            if(cardElement) {
                // [수정] 순서에 맞게 삽입하는 로직을 더 단순하고 안정적으로 개선
                const cards = [...contentStream.querySelectorAll('.card')];
                const targetIndex = cardData.order;
                const elementAtTargetIndex = cards[targetIndex];
                
                if (elementAtTargetIndex) {
                    contentStream.insertBefore(cardElement, elementAtTargetIndex);
                } else {
                    contentStream.appendChild(cardElement);
                }
            }
        });

        currentContentListeners.changed = onChildChanged(contentRef, (snapshot) => {
            const cardId = snapshot.key;
            const cardData = snapshot.val();
            const existingCard = contentStream.querySelector(`[data-id="${cardId}"]`);
            if (!existingCard) return;

            // [수정] 포커스 중인 경우에도 데이터는 업데이트하되, 잠금 UI는 갱신
            if (existingCard.contains(document.activeElement)) {
                applyLocksToUI();
                return;
            }

            updateCardContent(existingCard, cardData);
            
            const cards = [...contentStream.children];
            const currentOrder = cards.indexOf(existingCard);
            if (currentOrder !== cardData.order) {
                 const referenceNode = cards[cardData.order];
                 contentStream.insertBefore(existingCard, referenceNode);
            }
        });

        currentContentListeners.removed = onChildRemoved(contentRef, (snapshot) => {
            const cardId = snapshot.key;
            const cardToRemove = contentStream.querySelector(`[data-id="${cardId}"]`);
            if (cardToRemove) cardToRemove.remove();
        });
    }

    function updateCardContent(cardElement, cardData) {
        // 이 함수는 사용자가 편집 중이 아닐 때만 호출되어야 함
        switch (cardData.type) {
            case 'concept':
                const titleEl = cardElement.querySelector('[data-editable="title"]');
                const descEl = cardElement.querySelector('[data-editable="description"]');
                if (titleEl && titleEl.innerHTML !== cardData.title) titleEl.innerHTML = cardData.title;
                if (descEl && descEl.innerHTML !== cardData.description) descEl.innerHTML = cardData.description;
                break;
    
            case 'mcq':
                const questionEl = cardElement.querySelector('[data-editable="question"]');
                if (questionEl && questionEl.innerHTML !== cardData.question) questionEl.innerHTML = cardData.question;
    
                cardElement.querySelectorAll('.options li').forEach((li, index) => {
                    const optionData = cardData.options?.[index];
                    if (!optionData) return;
    
                    const textSpan = li.querySelector(`[data-editable="option-${index}"]`);
                    if (textSpan && textSpan.innerHTML !== optionData.text) {
                        textSpan.innerHTML = optionData.text;
                    }
                    if (li.dataset.correct !== String(optionData.correct)) {
                        li.dataset.correct = optionData.correct;
                    }
                });
                break;
    
            case 'saq':
                const saqQuestionEl = cardElement.querySelector('[data-editable="question"]');
                const saqAnswerEl = cardElement.querySelector('[data-editable="answer"]');
                const saqTextarea = cardElement.querySelector('textarea');
    
                if (saqQuestionEl && saqQuestionEl.innerHTML !== cardData.question) saqQuestionEl.innerHTML = cardData.question;
                if (saqAnswerEl && saqAnswerEl.innerHTML !== cardData.answer) saqAnswerEl.innerHTML = cardData.answer;
                if (saqTextarea && saqTextarea.value !== cardData.userAnswer) saqTextarea.value = cardData.userAnswer;
                break;
    
            case 'image':
                 const imgTitleEl = cardElement.querySelector('[data-editable="title"]');
                 const imgEl = cardElement.querySelector('img');
                 if (imgTitleEl && imgTitleEl.innerHTML !== cardData.title) imgTitleEl.innerHTML = cardData.title;
                 if (imgEl && imgEl.src !== cardData.imageUrl) {
                      imgEl.src = cardData.imageUrl;
                      imgEl.alt = cardData.title;
                 }
                break;
        }
        // 부분 업데이트 후에도 잠금 UI와 관리자 모드 상태는 항상 확인하여 적용
        applyAdminStateToCard(cardElement);
        applyLocksToUI();
    }
    
    // [추가] 단일 카드에 관리자 모드 UI를 적용하는 함수
    function applyAdminStateToCard(card) {
        card.querySelectorAll('[data-editable]').forEach(el => el.setAttribute('contenteditable', isAdmin));
        card.querySelectorAll('textarea').forEach(el => el.disabled = !isAdmin);
    }


    function createCardElement(id, data) {
        let card;
        switch(data.type) {
            case 'concept': card = createConceptCard(id, data); break;
            case 'mcq': card = createMcqCard(id, data); break;
            case 'saq': card = createSaqCard(id, data); break;
            case 'image': card = createImageCard(id, data); break;
        }
        if (card) {
            // [추가] 카드를 만들 때 현재 관리자 모드 상태를 바로 적용
            applyAdminStateToCard(card);
        }
        return card;
    }

    // --- 콘텐츠 이벤트 위임 ---
    contentStream.addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (!card) return;

        if (e.target.classList.contains('delete-btn')) {
            if (confirm('정말로 삭제하시겠습니까?')) remove(ref(db, `tabs/${currentTabId}/content/${card.dataset.id}`));
            return;
        }

        if (isAdmin && e.target.closest('li')) {
            const targetLi = e.target.closest('li');
            if (targetLi.parentElement.classList.contains('options')) {
                const newOptions = Array.from(targetLi.parentElement.children).map(li => ({
                    text: li.querySelector('span[data-editable]').innerHTML,
                    correct: li === targetLi
                }));
                update(ref(db, `tabs/${currentTabId}/content/${card.dataset.id}`), { options: newOptions });
            }
            return;
        }

        if (e.target.classList.contains('toggle-answer-btn')) {
            const answerDiv = card.querySelector('.answer');
            answerDiv.style.display = answerDiv.style.display === 'block' ? 'none' : 'block';
        } else if (e.target.classList.contains('check-single-mcq-btn')) {
            checkSingleMcq(e.target.closest('.mcq'));
        }
    });
    
    // [수정] 데이터 저장/잠금 해제 로직을 blur 대신 focusout으로 유지 (더 안정적임)
    contentStream.addEventListener('focusout', (e) => {
        if (!isAdmin) return;
        
        const target = e.target;
        if (!(target.hasAttribute('data-editable') || target.tagName === 'TEXTAREA')) {
            return;
        }
    
        const card = target.closest('.card');
        if (!card) return;
    
        const cardId = card.dataset.id;
        const path = `tabs/${currentTabId}/content/${cardId}/`;
        const updates = {};
        
        // 데이터 저장 로직 (기존 코드와 유사하나, 비동기 처리를 위해 get()을 사용)
        get(ref(db, path)).then(snapshot => {
            const originalData = snapshot.val();
            if(!originalData) return;

            let hasChanges = false;
        
            if (target.hasAttribute('data-editable')) {
                const field = target.dataset.editable;
                const value = target.innerHTML;
                let originalValue = '';
                
                if(field.startsWith('option-')) {
                    const index = parseInt(field.split('-')[1]);
                    originalValue = originalData.options?.[index]?.text;
                } else {
                    originalValue = originalData[field];
                }
                
                if (value !== originalValue) {
                    hasChanges = true;
                    if(field.startsWith('option-')) {
                        const index = parseInt(field.split('-')[1]);
                        updates[`${path}options/${index}/text`] = value;
                    } else {
                        updates[path + field] = value;
                    }
                }
            }
            
            if (target.tagName === 'TEXTAREA' && target.closest('.saq')) {
                const originalValue = originalData?.userAnswer || '';
                if (target.value !== originalValue) {
                    hasChanges = true;
                    updates[path + 'userAnswer'] = target.value;
                }
            }
        
            // 변경이 있을 때만 업데이트 실행
            if (hasChanges) {
                update(ref(db), updates);
            }

        }).finally(() => {
            // 포커스가 카드 밖으로 나갔을 때 잠금 해제
             if (!card.contains(e.relatedTarget)) {
                if (currentLocks[cardId] === sessionId) {
                    remove(ref(db, `editingLocks/${cardId}`));
                }
            }
        });
    }, true);

    contentStream.addEventListener('keydown', (e) => {
        if (isAdmin && e.target.closest('[contenteditable="true"]') && e.key === 'Enter') {
            e.preventDefault();
            document.execCommand('insertLineBreak', false, null);
        }
    });

    // --- 실시간 편집 잠금 로직 ---
    onValue(locksRef, (snapshot) => {
        currentLocks = snapshot.val() || {};
        applyLocksToUI();
    });
    
    function applyLocksToUI() {
        contentStream.querySelectorAll('.card').forEach(card => {
            const cardId = card.dataset.id;
            const lockOwner = currentLocks[cardId];

            if (lockOwner && lockOwner !== sessionId) {
                card.classList.add('is-card-locked');
                // 잠겼을 때는 contenteditable과 disabled를 강제로 false/true로 설정
                card.querySelectorAll('[data-editable]').forEach(el => el.setAttribute('contenteditable', 'false'));
                card.querySelectorAll('textarea').forEach(el => el.disabled = true);
            } else {
                card.classList.remove('is-card-locked');
                // 잠기지 않았을 때는 현재 관리자 모드에 따라 상태 복원
                applyAdminStateToCard(card);
            }
        });
    }

    contentStream.addEventListener('focusin', (e) => {
        if (isAdmin && (e.target.hasAttribute('data-editable') || e.target.tagName === 'TEXTAREA')) {
            const card = e.target.closest('.card');
            if (!card) return;
            const cardId = card.dataset.id;
            const lockRef = ref(db, `editingLocks/${cardId}`);

            runTransaction(lockRef, (currentData) => {
                if (currentData === null) return sessionId;
            }).then(({ committed }) => {
                if (committed) onDisconnect(lockRef).remove();
            });
        }
    });

    // --- 카드 생성 함수들 (이하 동일) ---
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
        div.className = 'card question-card mcq';
        div.dataset.id = id;
        div.innerHTML = `
            <p class="question-text" data-editable="question">${data.question}</p>
            <ul class="options">${(data.options || []).map((opt, index) => `
                <li data-correct="${opt.correct}">
                    <label><input type="radio" name="q${id}" value="${index}"> ${index + 1}) </label>
                    <span data-editable="option-${index}">${opt.text}</span>
                </li>`).join('')}
            </ul>
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
            <div class="user-answer-area">
                <textarea placeholder="여기에 답안을 작성하세요...">${data.userAnswer || ''}</textarea>
            </div>
            <button class="toggle-answer-btn">정답 확인</button>
            <div class="answer" style="display: none;">
                <p><strong>모범 답안:</strong><br><span data-editable="answer">${data.answer}</span></p>
            </div>
            <button class="delete-btn admin-only">삭제</button>`;
        return div;
    }
    function createImageCard(id, data) {
        const div = document.createElement('div');
        div.className = 'card image-card';
        div.dataset.id = id;
        div.innerHTML = `
            <h3 data-editable="title">${data.title}</h3>
            <div class="image-container">
                <img src="${data.imageUrl}" alt="${data.title}" onerror="this.onerror=null;this.src='https://via.placeholder.com/600x400.png?text=Image+not+found';">
            </div>
            <button class="delete-btn admin-only">삭제</button>`;
        return div;
    }
    
    function checkSingleMcq(questionCard) {
        const selectedOption = questionCard.querySelector('input[type="radio"]:checked');
        const resultText = questionCard.querySelector('.single-mcq-result');
        questionCard.querySelectorAll('li').forEach(li => {
            li.classList.remove('user-correct', 'user-incorrect', 'reveal-correct');
        });

        if (!selectedOption) {
            resultText.textContent = '답을 선택해주세요.';
            resultText.className = 'single-mcq-result';
            return;
        }

        const selectedLi = selectedOption.closest('li');
        const isCorrect = selectedLi.dataset.correct === 'true';

        if (isCorrect) {
            resultText.textContent = '정답입니다! 🎉';
            resultText.className = 'single-mcq-result correct';
            selectedLi.classList.add('user-correct');
        } else {
            resultText.textContent = '오답입니다. 🙁';
            resultText.className = 'single-mcq-result incorrect';
            selectedLi.classList.add('user-incorrect');
            const correctLi = questionCard.querySelector('li[data-correct="true"]');
            if (correctLi) {
                correctLi.classList.add('reveal-correct');
            }
        }
    }

    // --- 드래그앤드롭 기능 초기화 ---
    const sortableInstance = new Sortable(contentStream, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        disabled: !isAdmin,
        onEnd: (evt) => {
            const updates = {};
            contentStream.querySelectorAll('.card').forEach((card, index) => {
                updates[`/tabs/${currentTabId}/content/${card.dataset.id}/order`] = index;
            });
            update(ref(db), updates);
        },
    });
});