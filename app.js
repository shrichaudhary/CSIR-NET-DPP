/* ================= USER CONFIGURATION ================= */
// 1. Firebase Configuration (REPLACE WITH YOUR KEYS)
const firebaseConfig = {
    apiKey: "AIzaSyC0VzSG7BctaTLLk93EUxJOaerw-5i4vJo", // Replace this
    authDomain: "commerce-study-hub.firebaseapp.com",
    projectId: "commerce-study-hub",
    storageBucket: "commerce-study-hub.firebasestorage.app",
    messagingSenderId: "833331391620",
    appId: "1:833331391620:web:bd9eeb766323bfefbf66d1"
};

const APP_ID_PREFIX = "csir_net_physics"; // Unique ID for Firestore paths

/* ================= IMPORTS ================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, deleteDoc, onSnapshot, setDoc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* ================= INITIALIZATION ================= */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Collection Helpers
const getPublicColl = (name) => collection(db, 'artifacts', APP_ID_PREFIX, 'public', 'data', name);
const getUserDoc = (uid) => doc(db, 'artifacts', APP_ID_PREFIX, 'users', uid, 'profile', 'main');
const getSessionDoc = (uid, quizId) => doc(db, 'artifacts', APP_ID_PREFIX, 'users', uid, 'sessions', quizId);

/* ================= STATE ================= */
let state = {
    user: null,
    quizzes: [],
    currentQuiz: null,
    currentQIndex: 0,
    responses: {}, // { 0: "A", 1: "C" }
    timer: null,
    timeRemaining: 0,
    resumeId: null, // If resuming a quiz
    autoSaveInterval: null
};

/* ================= CORE FUNCTIONS ================= */

// 1. AUTH & STARTUP
onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById('app-loader');
    if (user) {
        state.user = user;
        updateUIOnLogin();
        startLiveSync();
    } else {
        state.user = null;
        updateUIOnLogout();
    }
    if(loader) loader.classList.add('hidden');
});

function updateUIOnLogin() {
    document.getElementById('nav-auth-buttons').classList.add('hidden');
    document.getElementById('nav-user-profile').classList.remove('hidden');
    document.getElementById('nav-username').innerText = state.user.email || "Aspirant";
    document.getElementById('section-home').classList.remove('hidden');
    document.getElementById('section-user-auth').classList.add('hidden');
}

function updateUIOnLogout() {
    document.getElementById('nav-auth-buttons').classList.remove('hidden');
    document.getElementById('nav-user-profile').classList.add('hidden');
    document.getElementById('section-home').classList.remove('hidden');
    hideAllSectionsExcept('section-home');
}

window.showUserAuth = () => { hideAllSectionsExcept('section-user-auth'); };
window.goToHome = () => { hideAllSectionsExcept('section-home'); checkForResume(); };

// 2. DATA SYNC (QUIZZES)
function startLiveSync() {
    onSnapshot(getPublicColl('quizzes'), (snap) => {
        state.quizzes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderQuizList();
        checkForResume(); // Check if user has paused tests
    });
}

function renderQuizList() {
    const container = document.getElementById('quiz-list-container');
    container.innerHTML = state.quizzes.length ? '' : '<p class="muted">No DPPs available yet.</p>';
    state.quizzes.forEach(q => {
        container.innerHTML += `
            <div class="card">
                <h3>${q.title}</h3>
                <p>⏳ ${q.time || 60} mins | 📝 ${q.questions?.length || 0} Questions</p>
                <button class="btn btn-success" onclick="window.prepareQuiz('${q.id}')">Start Attempt</button>
            </div>`;
    });
}

// 3. RESUME LOGIC (CRITICAL FEATURE)
async function checkForResume() {
    if(!state.user || !state.quizzes.length) return;
    
    // Check local storage or simple firestore lookup for last active session
    // For simplicity, we check sessions for the first available quiz or a stored 'lastQuizId'
    // Here we iterate active quizzes to find a saved session
    
    const alertBox = document.getElementById('resume-alert');
    alertBox.classList.add('hidden');

    for(const q of state.quizzes) {
        const docRef = getSessionDoc(state.user.uid, q.id);
        const docSnap = await getDoc(docRef);
        if(docSnap.exists()) {
            const session = docSnap.data();
            if(session.status === 'paused') {
                state.resumeId = q.id;
                document.getElementById('resume-quiz-title').innerText = q.title;
                alertBox.classList.remove('hidden');
                break; // Only show one resume at a time
            }
        }
    }
}

window.resumeLastSession = async () => {
    if(state.resumeId) window.prepareQuiz(state.resumeId, true);
};

window.discardSession = async () => {
    if(state.resumeId && confirm("Are you sure? All progress will be lost.")) {
        await deleteDoc(getSessionDoc(state.user.uid, state.resumeId));
        state.resumeId = null;
        document.getElementById('resume-alert').classList.add('hidden');
    }
};

// 4. QUIZ ENGINE
window.prepareQuiz = async (quizId, isResume = false) => {
    if(!state.user) return window.showUserAuth();
    
    state.currentQuiz = state.quizzes.find(q => q.id === quizId);
    if(!state.currentQuiz) return alert("Quiz not found");

    if(isResume) {
        const docSnap = await getDoc(getSessionDoc(state.user.uid, quizId));
        if(docSnap.exists()) {
            const session = docSnap.data();
            state.responses = session.responses || {};
            state.currentQIndex = session.currentQIndex || 0;
            state.timeRemaining = session.timeRemaining;
            startTestUI();
            return;
        }
    }

    // New Test Setup
    state.responses = {};
    state.currentQIndex = 0;
    state.timeRemaining = (state.currentQuiz.time || 60) * 60; // Seconds
    
    // Show Instructions
    document.getElementById('ins-title').innerText = state.currentQuiz.title;
    hideAllSectionsExcept('section-instructions');
};

window.startTest = () => {
    startTestUI();
};

function startTestUI() {
    hideAllSectionsExcept('section-active-quiz');
    
    // Timer
    if(state.timer) clearInterval(state.timer);
    state.timer = setInterval(() => {
        state.timeRemaining--;
        const m = Math.floor(state.timeRemaining / 60);
        const s = state.timeRemaining % 60;
        document.getElementById('timer-display').innerText = `${m}:${s.toString().padStart(2,'0')}`;
        if(state.timeRemaining <= 0) window.submitTest();
    }, 1000);

    // Auto Save every 30 seconds
    if(state.autoSaveInterval) clearInterval(state.autoSaveInterval);
    state.autoSaveInterval = setInterval(saveSessionToCloud, 30000);

    loadQuestion();
    renderGrid();
}

window.loadQuestion = () => {
    const q = state.currentQuiz.questions[state.currentQIndex];
    document.getElementById('active-q-num').innerText = state.currentQIndex + 1;
    document.getElementById('active-question-text').innerHTML = q.text; // InnerHTML for MathJax
    
    const area = document.getElementById('active-options-area');
    area.innerHTML = '';
    
    q.options.forEach((opt, idx) => {
        const isChecked = state.responses[state.currentQIndex] == (idx + 1); // Store as 1-based index (1,2,3,4)
        area.innerHTML += `
            <label class="option-block">
                <input type="radio" name="opt" value="${idx+1}" ${isChecked ? 'checked' : ''} onchange="window.saveResponse(${idx+1})">
                <span>${opt}</span>
            </label>
        `;
    });

    // Update Grid Highlight
    document.querySelectorAll('.grid-btn').forEach(b => b.classList.remove('current'));
    const curBtn = document.getElementById(`grid-btn-${state.currentQIndex}`);
    if(curBtn) curBtn.classList.add('current');

    // Button Logic
    document.getElementById('btn-next').style.display = (state.currentQIndex === state.currentQuiz.questions.length - 1) ? 'none' : 'block';
    document.getElementById('btn-submit').style.display = (state.currentQIndex === state.currentQuiz.questions.length - 1) ? 'block' : 'none';
    
    // Trigger MathJax Render
    if(window.MathJax) MathJax.typesetPromise();
};

window.saveResponse = (val) => {
    state.responses[state.currentQIndex] = val;
    renderGrid();
};

window.changeQuestion = (delta) => {
    state.currentQIndex += delta;
    loadQuestion();
};

window.jumpToQuestion = (idx) => {
    state.currentQIndex = idx;
    loadQuestion();
};

function renderGrid() {
    const grid = document.getElementById('question-grid-target');
    grid.innerHTML = '';
    state.currentQuiz.questions.forEach((_, idx) => {
        const hasAns = state.responses[idx] !== undefined;
        grid.innerHTML += `<div id="grid-btn-${idx}" class="grid-btn ${hasAns ? 'answered' : ''}" onclick="window.jumpToQuestion(${idx})">${idx+1}</div>`;
    });
}

// 5. PAUSE & SAVE
window.pauseTest = async () => {
    await saveSessionToCloud();
    clearInterval(state.timer);
    clearInterval(state.autoSaveInterval);
    alert("Test Paused. Your progress is saved safely in the cloud.");
    window.goToHome();
};

async function saveSessionToCloud() {
    if(!state.user || !state.currentQuiz) return;
    const sessionData = {
        quizId: state.currentQuiz.id,
        currentQIndex: state.currentQIndex,
        responses: state.responses,
        timeRemaining: state.timeRemaining,
        status: 'paused',
        lastUpdated: Date.now()
    };
    await setDoc(getSessionDoc(state.user.uid, state.currentQuiz.id), sessionData);
}

// 6. SUBMIT & SOLUTIONS
window.submitTest = async () => {
    clearInterval(state.timer);
    clearInterval(state.autoSaveInterval);
    
    // Delete the paused session since it's now submitted
    await deleteDoc(getSessionDoc(state.user.uid, state.currentQuiz.id));

    let score = 0;
    let html = "";
    
    state.currentQuiz.questions.forEach((q, idx) => {
        const userAns = state.responses[idx];
        const correctAns = q.correct; // Expecting "1", "2" etc. or 1, 2
        
        // Loose comparison for strings/numbers (1 == "1")
        const isCorrect = userAns == correctAns;
        if(isCorrect) score += (q.marks || 4); // Default 4 marks for Part C style

        const userLabel = userAns ? q.options[userAns-1] : "Not Attempted";
        const correctLabel = q.options[correctAns-1];
        const solutionText = q.solution || "No detailed solution provided.";

        html += `
            <div class="report-row">
                <div><strong>Q${idx+1}:</strong> ${q.text}</div>
                <div style="margin-top:10px; font-size:0.9em;">
                    <span class="${isCorrect ? 'correct-ans' : 'wrong-ans'}">Your Answer: ${userLabel}</span>
                    ${!isCorrect ? `<br><span class="correct-ans">Correct Answer: ${correctLabel}</span>` : ''}
                </div>
                <!-- HIDDEN SOLUTION REVEAL -->
                <button class="btn btn-outline btn-small" style="color:#009688; border-color:#009688; margin-top:5px;" onclick="this.nextElementSibling.classList.toggle('hidden')">Show Solution 💡</button>
                <div class="solution-box hidden">
                    <span class="solution-title">Solution:</span>
                    <div>${solutionText}</div>
                </div>
            </div>
        `;
    });

    // Render Result
    document.getElementById('res-score').innerText = score;
    document.getElementById('res-total').innerText = state.currentQuiz.questions.length * 4;
    document.getElementById('detailed-report').innerHTML = html;
    
    hideAllSectionsExcept('section-result');
    if(window.MathJax) MathJax.typesetPromise();
};

/* ================= UTILS ================= */
function hideAllSectionsExcept(id) {
    const sections = ['section-home', 'section-user-auth', 'section-admin-dashboard', 'section-quiz-creator', 'section-instructions', 'section-active-quiz', 'section-result'];
    sections.forEach(s => {
        const el = document.getElementById(s);
        if(el) {
            if(s === id) el.classList.remove('hidden');
            else el.classList.add('hidden');
        }
    });
}

// Admin Upload
window.uploadQuizJSON = (input) => {
    if(!input.files.length) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const json = JSON.parse(e.target.result);
            if(!json.title || !json.questions) throw new Error("Invalid Format");
            await addDoc(getPublicColl('quizzes'), json);
            alert("DPP Uploaded Successfully!");
            window.goToHome();
        } catch(err) { alert("Error: " + err.message); }
    };
    reader.readAsText(input.files[0]);
};

// Admin Auth (Simple hardcoded for demo, replace with real auth claims)
window.toggleAdminAuth = () => {
    const p = prompt("Admin Password:");
    if(p === "admin123") {
        hideAllSectionsExcept('section-admin-dashboard');
        // Load quiz list for admin
        onSnapshot(getPublicColl('quizzes'), (snap) => {
            const list = document.getElementById('admin-quiz-list');
            list.innerHTML = snap.docs.map(d => `<div>${d.data().title} <button onclick="window.deleteQuiz('${d.id}')">Del</button></div>`).join('');
        });
    } else { alert("Access Denied"); }
};
window.logoutAdmin = () => window.goToHome();
window.deleteQuiz = async (id) => { if(confirm("Delete?")) await deleteDoc(doc(db, 'artifacts', APP_ID_PREFIX, 'public', 'data', 'quizzes', id)); };

/* ================= INIT ================= */
// Auth listeners handle initial UI state
