(() => {
    'use strict';

    const STORAGE_KEY = 'flashcards-data';

    // --- State ---
    let classes = {};      // { className: [{ front, back, status }] }
    let activeClass = null;
    let currentFilter = 'all';
    let filteredIndices = [];
    let currentPos = 0;
    let isFlipped = false;

    // --- DOM ---
    const classTabs = document.getElementById('classTabs');
    const fileInput = document.getElementById('fileInput');
    const shuffleBtn = document.getElementById('shuffleBtn');
    const filterAll = document.getElementById('filterAll');
    const filterReview = document.getElementById('filterReview');
    const filterKnown = document.getElementById('filterKnown');
    const badgeAll = document.getElementById('badgeAll');
    const badgeReview = document.getElementById('badgeReview');
    const badgeKnown = document.getElementById('badgeKnown');
    const progressContainer = document.getElementById('progressContainer');
    const progressFill = document.getElementById('progressFill');
    const progressLabel = document.getElementById('progressLabel');
    const emptyState = document.getElementById('emptyState');
    const flashcardWrapper = document.getElementById('flashcardWrapper');
    const flashcard = document.getElementById('flashcard');
    const flashcardInner = document.getElementById('flashcardInner');
    const frontContent = document.getElementById('frontContent');
    const backContent = document.getElementById('backContent');
    const cardIndex = document.getElementById('cardIndex');
    const cardTotal = document.getElementById('cardTotal');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const markKnownBtn = document.getElementById('markKnownBtn');
    const markReviewBtn = document.getElementById('markReviewBtn');

    // --- Persistence ---
    function save() {
        try {
            const data = { classes, activeClass };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('Could not save to localStorage:', e);
        }
    }

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data.classes) classes = data.classes;
            if (data.activeClass && classes[data.activeClass]) {
                activeClass = data.activeClass;
            }
        } catch (e) {
            console.warn('Could not load from localStorage:', e);
        }
    }

    // --- Import ---
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const json = JSON.parse(ev.target.result);
                importJSON(json);
            } catch (err) {
                alert('Invalid JSON file: ' + err.message);
            }
        };
        reader.readAsText(file);
        fileInput.value = '';
    });

    function importJSON(json) {
        // Support single deck or array of decks
        const decks = Array.isArray(json) ? json : [json];

        for (const deck of decks) {
            const className = deck.class || deck.name || 'Untitled';
            const cards = (deck.cards || []).map(c => ({
                front: c.front || c.question || '',
                back: c.back || c.answer || '',
                status: 'none'
            }));

            if (cards.length === 0) continue;

            // Merge: if class exists, check for duplicates by front text
            if (classes[className]) {
                const existing = new Set(classes[className].map(c => c.front));
                for (const card of cards) {
                    if (!existing.has(card.front)) {
                        classes[className].push(card);
                    }
                }
            } else {
                classes[className] = cards;
            }
        }

        // Activate the first imported class if none active
        if (!activeClass || !classes[activeClass]) {
            activeClass = Object.keys(classes)[0] || null;
        }

        save();
        renderAll();
    }

    // --- Tabs ---
    function renderTabs() {
        classTabs.innerHTML = '';
        const names = Object.keys(classes);

        for (const name of names) {
            const tab = document.createElement('button');
            tab.className = 'class-tab' + (name === activeClass ? ' active' : '');
            tab.innerHTML = `${name}<span class="tab-count">(${classes[name].length})</span><span class="tab-remove" title="Remove class">×</span>`;

            tab.addEventListener('click', (e) => {
                if (e.target.classList.contains('tab-remove')) {
                    if (confirm(`Remove "${name}" and all its cards?`)) {
                        delete classes[name];
                        if (activeClass === name) {
                            activeClass = Object.keys(classes)[0] || null;
                        }
                        save();
                        renderAll();
                    }
                    return;
                }
                activeClass = name;
                currentPos = 0;
                isFlipped = false;
                save();
                renderAll();
            });

            classTabs.appendChild(tab);
        }
    }

    // --- Filters ---
    function getFilteredIndices() {
        if (!activeClass || !classes[activeClass]) return [];
        const cards = classes[activeClass];
        const indices = [];
        for (let i = 0; i < cards.length; i++) {
            if (currentFilter === 'all') indices.push(i);
            else if (currentFilter === 'known' && cards[i].status === 'known') indices.push(i);
            else if (currentFilter === 'review' && cards[i].status === 'review') indices.push(i);
        }
        return indices;
    }

    function updateBadges() {
        if (!activeClass || !classes[activeClass]) {
            badgeAll.textContent = '0';
            badgeReview.textContent = '0';
            badgeKnown.textContent = '0';
            return;
        }
        const cards = classes[activeClass];
        let known = 0, review = 0;
        for (const c of cards) {
            if (c.status === 'known') known++;
            else if (c.status === 'review') review++;
        }
        badgeAll.textContent = cards.length;
        badgeReview.textContent = review;
        badgeKnown.textContent = known;
    }

    function updateProgress() {
        if (!activeClass || !classes[activeClass]) {
            progressContainer.style.display = 'none';
            return;
        }
        const cards = classes[activeClass];
        const known = cards.filter(c => c.status === 'known').length;
        const pct = cards.length > 0 ? (known / cards.length) * 100 : 0;
        progressContainer.style.display = 'flex';
        progressFill.style.width = pct + '%';
        progressLabel.textContent = `${known} / ${cards.length} known`;
    }

    function setFilter(filter) {
        currentFilter = filter;
        [filterAll, filterReview, filterKnown].forEach(b => b.classList.remove('active'));
        if (filter === 'all') filterAll.classList.add('active');
        else if (filter === 'review') filterReview.classList.add('active');
        else if (filter === 'known') filterKnown.classList.add('active');

        currentPos = 0;
        isFlipped = false;
        renderCard();
    }

    filterAll.addEventListener('click', () => setFilter('all'));
    filterReview.addEventListener('click', () => setFilter('review'));
    filterKnown.addEventListener('click', () => setFilter('known'));

    // --- Shuffle ---
    shuffleBtn.addEventListener('click', () => {
        if (!activeClass || !classes[activeClass]) return;
        const cards = classes[activeClass];
        // Fisher-Yates
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }
        currentPos = 0;
        isFlipped = false;
        save();
        renderCard();
    });

    // --- Card Display ---
    function typesetElement(el) {
        if (window.MathJax && window.MathJax.typesetPromise) {
            MathJax.typesetPromise([el]).catch(err => console.warn('MathJax error:', err));
        }
    }

    function renderCard() {
        filteredIndices = getFilteredIndices();
        updateBadges();
        updateProgress();

        const hasCards = filteredIndices.length > 0;
        shuffleBtn.disabled = !activeClass || !classes[activeClass] || classes[activeClass].length === 0;

        if (!hasCards) {
            flashcardWrapper.style.display = 'none';
            if (activeClass && classes[activeClass] && classes[activeClass].length > 0) {
                emptyState.querySelector('p').textContent = 'No cards match this filter';
                emptyState.querySelector('.hint').textContent = 'Try switching to "All"';
            } else if (activeClass) {
                emptyState.querySelector('p').textContent = 'This class has no cards';
                emptyState.querySelector('.hint').innerHTML = 'Import a JSON file to add cards';
            } else {
                emptyState.querySelector('p').textContent = 'Import a JSON file to get started';
                emptyState.querySelector('.hint').innerHTML = 'Format: <code>{ "class": "Name", "cards": [{ "front": "...", "back": "..." }] }</code>';
            }
            emptyState.style.display = '';
            return;
        }

        emptyState.style.display = 'none';
        flashcardWrapper.style.display = 'flex';

        if (currentPos >= filteredIndices.length) currentPos = filteredIndices.length - 1;
        if (currentPos < 0) currentPos = 0;

        const realIndex = filteredIndices[currentPos];
        const card = classes[activeClass][realIndex];

        // Update counter
        cardIndex.textContent = currentPos + 1;
        cardTotal.textContent = filteredIndices.length;

        // Set content
        frontContent.innerHTML = card.front;
        backContent.innerHTML = card.back;
        typesetElement(frontContent);
        typesetElement(backContent);

        // Flip state
        if (isFlipped) {
            flashcard.classList.add('flipped');
        } else {
            flashcard.classList.remove('flipped');
        }

        // Status indicator
        flashcard.setAttribute('data-status', card.status);

        // Update mark buttons
        markKnownBtn.style.opacity = card.status === 'known' ? '1' : '';
        markReviewBtn.style.opacity = card.status === 'review' ? '1' : '';

        // Nav button states
        prevBtn.disabled = currentPos === 0;
        nextBtn.disabled = currentPos >= filteredIndices.length - 1;
    }

    // --- Card Interaction ---
    function flipCard() {
        isFlipped = !isFlipped;
        flashcard.classList.toggle('flipped');
    }

    flashcard.addEventListener('click', flipCard);

    function markCard(status) {
        if (filteredIndices.length === 0) return;
        const realIndex = filteredIndices[currentPos];
        const card = classes[activeClass][realIndex];
        card.status = card.status === status ? 'none' : status;
        save();
        renderCard();
    }

    markKnownBtn.addEventListener('click', () => markCard('known'));
    markReviewBtn.addEventListener('click', () => markCard('review'));

    function goNext() {
        if (currentPos < filteredIndices.length - 1) {
            currentPos++;
            isFlipped = false;
            renderCard();
        }
    }

    function goPrev() {
        if (currentPos > 0) {
            currentPos--;
            isFlipped = false;
            renderCard();
        }
    }

    prevBtn.addEventListener('click', goPrev);
    nextBtn.addEventListener('click', goNext);

    // --- Keyboard ---
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.key) {
            case ' ':
                e.preventDefault();
                flipCard();
                break;
            case 'ArrowRight':
                goNext();
                break;
            case 'ArrowLeft':
                goPrev();
                break;
            case 'k':
            case 'K':
                markCard('known');
                break;
            case 'r':
            case 'R':
                markCard('review');
                break;
        }
    });

    // --- Render All ---
    function renderAll() {
        renderTabs();
        currentFilter = 'all';
        [filterAll, filterReview, filterKnown].forEach(b => b.classList.remove('active'));
        filterAll.classList.add('active');
        renderCard();
    }

    // --- Init ---
    load();
    renderAll();
})();
