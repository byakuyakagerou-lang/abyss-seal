const socket = io();

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name-input');
const joinBtn = document.getElementById('join-btn');
const loginError = document.getElementById('login-error');

const otherPlayersContainer = document.getElementById('other-players-container');
const myNameEl = document.getElementById('my-name');
const myRoleEl = document.getElementById('my-role');
const mySanEl = document.getElementById('my-san');
const myHandContainer = document.getElementById('my-hand-container');

const roundNumberEl = document.getElementById('round-number');
const phaseNameEl = document.getElementById('phase-name');
const successCountEl = document.getElementById('success-count');
const failCountEl = document.getElementById('fail-count');
const deckCountEl = document.getElementById('deck-count');

const actionPrompt = document.getElementById('action-prompt');
const selectParticipantsBtn = document.getElementById('select-participants-btn');
const submitCardBtn = document.getElementById('submit-card-btn');
const rerollSanBtn = document.getElementById('reroll-san-btn');
const eventActionBtn = document.getElementById('event-action-btn');

const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');

const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayDesc = document.getElementById('overlay-desc');

// State
let myId = null;
let currentGameState = null;
let selectedOtherPlayerIds = [];
let selectedCardIndex = null;

// --- Event Listeners ---
const addBotBtn = document.getElementById('add-bot-btn');

joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (!name) return;
    socket.emit('join_game', name);
});

addBotBtn.addEventListener('click', () => {
    socket.emit('add_bot');
});

playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinBtn.click();
});

sendChatBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
});

function sendChat() {
    const msg = chatInput.value.trim();
    if (!msg) return;
    socket.emit('send_chat', msg);
    chatInput.value = '';
}

// Action Buttons
selectParticipantsBtn.addEventListener('click', () => {
    if (selectedOtherPlayerIds.length > 0) {
        socket.emit('select_participants', selectedOtherPlayerIds);
        selectedOtherPlayerIds = [];
    }
});

submitCardBtn.addEventListener('click', () => {
    if (selectedCardIndex !== null) {
        socket.emit('submit_card', selectedCardIndex);
        selectedCardIndex = null;
    }
});

rerollSanBtn.addEventListener('click', () => {
    socket.emit('reroll_san');
});

eventActionBtn.addEventListener('click', () => {
    if (selectedOtherPlayerIds.length > 0) {
        socket.emit('event_action', selectedOtherPlayerIds);
        selectedOtherPlayerIds = [];
    }
});


// --- Socket Events ---
socket.on('connect', () => {
    myId = socket.id;
});

socket.on('error_msg', (msg) => {
    if (currentGameState && currentGameState.phase !== 'lobby') {
        alert(msg);
    } else {
        loginError.textContent = msg;
    }
});

socket.on('new_log', (log) => {
    const div = document.createElement('div');
    div.className = `chat-msg ${log.type}`;
    div.textContent = log.msg;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
});

socket.on('game_state', (state) => {
    currentGameState = state;
    
    // Check if we transitioned from lobby to game
    if (state.phase !== 'lobby' && loginScreen.classList.contains('active')) {
        loginScreen.classList.remove('active');
        gameScreen.classList.add('active');
    }

    updateHeader(state);
    updateMyStatus(state);
    updateOtherPlayers(state);
    updateActions(state);
    
    if (state.phase === 'game_over') {
        showGameOver(state);
    }
});

// --- Render Functions ---

function updateHeader(state) {
    roundNumberEl.textContent = state.round;
    
    const phaseNames = {
        'lobby': '待機中',
        'leader_selection': '儀式参加者選出',
        'card_submission': '供物提出',
        'event_action': '神話イベント処理',
        'result': '結果判定',
        'game_over': 'ゲーム終了'
    };
    phaseNameEl.textContent = phaseNames[state.phase] || state.phase;
    
    successCountEl.textContent = state.successCount;
    failCountEl.textContent = state.failCount;
    deckCountEl.textContent = typeof state.deck === 'number' ? state.deck : state.deck.length;
}

function updateMyStatus(state) {
    const me = state.players.find(p => p.id === myId);
    if (!me) return;

    myNameEl.textContent = me.name;
    myRoleEl.textContent = `Role: ${me.role === 'Explorer' ? '探索者' : (me.role === 'Cultist' ? '狂信者' : '???')}`;
    
    myRoleEl.className = 'role-box ' + (me.role ? me.role.toLowerCase() : '');
    mySanEl.textContent = me.san;

    // Render Hand
    myHandContainer.innerHTML = '';
    me.hand.forEach((cardVal, idx) => {
        const card = document.createElement('div');
        card.className = `card ${cardVal}`;
        card.textContent = cardVal === 'success' ? '成功' : (cardVal === 'fail' ? '失敗' : '?');
        
        // Interaction logic
        if (state.phase === 'card_submission' && state.participants.includes(myId) && !state.submittedCards.find(s=>s.playerId === myId) && me.san > 0 && !state.activeEvents.blindSubmission) {
            card.classList.add('playable');
            if (idx === selectedCardIndex) card.classList.add('selected');
            
            card.addEventListener('click', () => {
                selectedCardIndex = idx;
                updateMyStatus(state); // Re-render to show selection
                updateActions(state); // Re-render buttons
            });
        }
        
        myHandContainer.appendChild(card);
    });
}

function updateOtherPlayers(state) {
    otherPlayersContainer.innerHTML = '';
    
    const reqCount = getRequiredParticipants(state);
    const actionCount = state.pendingEventAction ? state.pendingEventAction.count : 0;
    
    state.players.forEach(p => {
        // Can render self in the other players area for selection purposes during leader phase
        // but maybe mark as "You"
        const isMe = p.id === myId;
        
        const card = document.createElement('div');
        card.className = 'player-card';
        if (state.leaderId === p.id) card.classList.add('is-leader');
        if (p.san <= 0) card.classList.add('is-dead');
        
        let html = `<div class="player-name">${p.name}${isMe ? ' (あなた)' : ''}</div>`;
        html += `<div class="player-role-unknown">${p.role === '???' ? 'Role: ???' : `Role: ${p.role}`}</div>`;
        html += `<div class="player-san">SAN: ${p.san}</div>`;
        
        // Show hand if revealed
        if (state.activeEvents.handRevealed.includes(p.id) && !isMe) {
            html += `<div class="other-hand">`;
            p.hand.forEach(c => {
                html += `<div class="mini-card ${c}"></div>`;
            });
            html += `</div>`;
        }
        
        card.innerHTML = html;
        
        // Selection Logic
        let isSelectable = false;
        if (state.phase === 'leader_selection' && state.leaderId === myId) {
            isSelectable = true;
        } else if (state.phase === 'event_action' && state.leaderId === myId && state.pendingEventAction) {
            isSelectable = true;
        }

        if (isSelectable) {
            card.classList.add('selectable');
            const overlay = document.createElement('div');
            overlay.className = 'player-select-overlay';
            overlay.innerHTML = `<span>✔</span>`;
            card.appendChild(overlay);

            if (selectedOtherPlayerIds.includes(p.id)) {
                card.classList.add('selected');
            }

            card.addEventListener('click', () => {
                const idx = selectedOtherPlayerIds.indexOf(p.id);
                if (idx > -1) {
                    selectedOtherPlayerIds.splice(idx, 1);
                } else {
                    const max = state.phase === 'leader_selection' ? reqCount : actionCount;
                    if (selectedOtherPlayerIds.length < max) {
                        selectedOtherPlayerIds.push(p.id);
                    } else {
                        // replace oldest
                        selectedOtherPlayerIds.shift();
                        selectedOtherPlayerIds.push(p.id);
                    }
                }
                updateOtherPlayers(state);
                updateActions(state);
            });
        }
        
        // Highlight participants
        if (state.phase !== 'leader_selection' && state.participants.includes(p.id)) {
            card.style.borderColor = '#2080a0';
            card.style.boxShadow = '0 0 10px rgba(32, 128, 160, 0.4)';
        }
        
        // Indicate who has submitted
        if (state.phase === 'card_submission' && state.submittedCards.find(s => s.playerId === p.id)) {
             card.style.opacity = '0.7';
             // Add a small checkmark text
             const check = document.createElement('div');
             check.textContent = '提出完了';
             check.style.color = '#2080a0';
             check.style.fontSize = '0.8rem';
             card.appendChild(check);
        }

        otherPlayersContainer.appendChild(card);
    });
}

function updateActions(state) {
    // Hide all first
    selectParticipantsBtn.classList.add('hidden');
    submitCardBtn.classList.add('hidden');
    rerollSanBtn.classList.add('hidden');
    eventActionBtn.classList.add('hidden');
    
    const me = state.players.find(p => p.id === myId);
    if (!me) return;

    let promptText = "他のプレイヤーを待っています...";

    if (state.phase === 'lobby') {
        promptText = `参加者を待っています... (${state.players.length}/5)`;
    } 
    else if (state.phase === 'leader_selection') {
        if (state.leaderId === myId) {
            const req = getRequiredParticipants(state);
            promptText = `あなたは祭祀長です。儀式に参加する ${req} 名を選んでください。`;
            selectParticipantsBtn.classList.remove('hidden');
            if (selectedOtherPlayerIds.length === req) {
                selectParticipantsBtn.disabled = false;
            } else {
                selectParticipantsBtn.disabled = true;
            }
        } else {
            const leader = state.players.find(p => p.id === state.leaderId);
            promptText = `祭祀長（${leader?leader.name:''}）が参加者を選出しています...`;
        }
    }
    else if (state.phase === 'card_submission') {
        if (state.participants.includes(myId)) {
            const hasSubmitted = state.submittedCards.find(s => s.playerId === myId);
            if (hasSubmitted) {
                promptText = "他の参加者の提出を待っています...";
            } else if (me.san <= 0 || state.activeEvents.blindSubmission) {
                promptText = "自動的にカードが抽出されます...";
            } else {
                promptText = "提出する供物カードを選択してください。";
                submitCardBtn.classList.remove('hidden');
                submitCardBtn.disabled = selectedCardIndex === null;
                
                if (me.san > 0) {
                    rerollSanBtn.classList.remove('hidden');
                }
            }
        } else {
            promptText = "儀式が進行中です...";
        }
    }
    else if (state.phase === 'event_action') {
        if (state.leaderId === myId && state.pendingEventAction) {
            promptText = `神話イベント効果の対象を ${state.pendingEventAction.count} 名選んでください。`;
            eventActionBtn.classList.remove('hidden');
            eventActionBtn.disabled = selectedOtherPlayerIds.length !== state.pendingEventAction.count;
        } else {
            promptText = "祭祀長が神話イベントの処理を行っています...";
        }
    }
    
    actionPrompt.textContent = promptText;
}

function showGameOver(state) {
    overlay.classList.remove('hidden');
    overlayTitle.textContent = state.winner === 'Explorer' ? '探索者の勝利' : '狂信者の勝利';
    
    let desc = "";
    if (state.successCount >= 3) desc = "儀式が3回成功し、世界は救われました。";
    else if (state.failCount >= 3) desc = "儀式が3回失敗し、深淵の封印は解かれました。";
    else desc = "探索者は全員狂気に飲まれました。";
    
    overlayDesc.textContent = desc;
}

function getRequiredParticipants(state) {
    if (state.round === 1 || state.round === 5) return 4;
    return 3;
}
