const socket = io();

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const roomScreen = document.getElementById('room-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name-input');
const joinBtn = document.getElementById('join-btn');
const loginError = document.getElementById('login-error');

const roomPlayersList = document.getElementById('room-players-list');
const toggleReadyBtn = document.getElementById('toggle-ready-btn');
const roomAddBotBtn = document.getElementById('room-add-bot-btn');
const returnToRoomBtn = document.getElementById('return-to-room-btn');

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
joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (!name) return;
    socket.emit('join_game', name);
});

playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinBtn.click();
});

toggleReadyBtn.addEventListener('click', () => {
    socket.emit('toggle_ready');
});

roomAddBotBtn.addEventListener('click', () => {
    socket.emit('add_bot');
});

returnToRoomBtn.addEventListener('click', () => {
    socket.emit('return_to_room');
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
    if (selectedCardIndex !== null) {
        socket.emit('reroll_san', selectedCardIndex);
        selectedCardIndex = null;
    }
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
    
    const me = state.players.find(p => p.id === myId);

    if (state.phase === 'lobby') {
        if (!me) {
            loginScreen.classList.add('active');
            roomScreen.classList.remove('active');
            gameScreen.classList.remove('active');
        } else {
            loginScreen.classList.remove('active');
            roomScreen.classList.add('active');
            gameScreen.classList.remove('active');
            updateRoom(state);
        }
        overlay.classList.add('hidden');
    } else {
        loginScreen.classList.remove('active');
        roomScreen.classList.remove('active');
        gameScreen.classList.add('active');
        
        updateHeader(state);
        updateMyStatus(state);
        updateOtherPlayers(state);
        updateActions(state);
        
        if (state.phase === 'game_over') {
            showGameOver(state);
        } else {
            overlay.classList.add('hidden');
        }
    }
});

// --- Render Functions ---

function updateRoom(state) {
    roomPlayersList.innerHTML = '';
    state.players.forEach(p => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.background = 'rgba(0,0,0,0.4)';
        item.style.padding = '10px 20px';
        item.style.borderRadius = '8px';
        item.style.border = '1px solid rgba(120,50,150,0.3)';

        const nameDiv = document.createElement('div');
        nameDiv.style.fontWeight = 'bold';
        nameDiv.textContent = p.name + (p.id === myId ? ' (あなた)' : '');

        const statusDiv = document.createElement('div');
        statusDiv.style.fontWeight = 'bold';
        if (p.isReady) {
            statusDiv.style.color = '#2080a0'; // success color
            statusDiv.textContent = '準備完了';
        } else {
            statusDiv.style.color = '#8a7a90'; // muted color
            statusDiv.textContent = '準備中...';
        }

        item.appendChild(nameDiv);
        item.appendChild(statusDiv);
        roomPlayersList.appendChild(item);
    });

    const me = state.players.find(p => p.id === myId);
    if (me && me.isReady) {
        toggleReadyBtn.textContent = '準備完了を取り消す';
        toggleReadyBtn.classList.remove('primary-btn');
    } else {
        toggleReadyBtn.textContent = '準備完了にする';
        toggleReadyBtn.classList.add('primary-btn');
    }

    if (state.players.length >= 5) {
        roomAddBotBtn.style.display = 'none';
    } else {
        roomAddBotBtn.style.display = 'inline-block';
    }
}

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
        html += `<div class="player-role-unknown">${p.role === '???' ? '役職: ???' : `役職: ${p.role === 'Explorer' ? '探索者' : '狂信者'}`}</div>`;
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
                if (state.phase === 'leader_selection' && state.leaderId === myId && p.id === myId) {
                    // Leader is forced to participate, cannot deselect self
                    return;
                }

                const idx = selectedOtherPlayerIds.indexOf(p.id);
                if (idx > -1) {
                    selectedOtherPlayerIds.splice(idx, 1);
                } else {
                    const max = state.phase === 'leader_selection' ? reqCount : actionCount;
                    if (selectedOtherPlayerIds.length < max) {
                        selectedOtherPlayerIds.push(p.id);
                    } else {
                        // replace oldest (but do not replace leader self)
                        const shiftIdx = selectedOtherPlayerIds[0] === myId && state.phase === 'leader_selection' ? 1 : 0;
                        if (shiftIdx < selectedOtherPlayerIds.length) {
                            selectedOtherPlayerIds.splice(shiftIdx, 1);
                            selectedOtherPlayerIds.push(p.id);
                        }
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
            // Auto-select self
            if (!selectedOtherPlayerIds.includes(myId)) {
                selectedOtherPlayerIds.push(myId);
                // Trigger re-render to show selection visually
                setTimeout(() => updateOtherPlayers(state), 0);
            }

            const req = getRequiredParticipants(state);
            promptText = `あなたは祭祀長です。強制参加のあなたを含め、儀式に参加する ${req} 名を選んでください。`;
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
                promptText = "提出または引き直すカードを選択してください。";
                
                if (selectedCardIndex !== null) {
                    submitCardBtn.classList.remove('hidden');
                    submitCardBtn.disabled = false;
                    if (me.san > 0) {
                        rerollSanBtn.classList.remove('hidden');
                        rerollSanBtn.disabled = false;
                    }
                } else {
                    submitCardBtn.classList.remove('hidden');
                    submitCardBtn.disabled = true;
                    if (me.san > 0) {
                        rerollSanBtn.classList.remove('hidden');
                        rerollSanBtn.disabled = true;
                    }
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

    const resultList = document.getElementById('result-players-list');
    resultList.innerHTML = '';
    state.players.forEach(p => {
        const item = document.createElement('div');
        item.className = 'player-card';
        if (p.san <= 0) item.classList.add('is-dead');
        
        let html = `<div class="player-name">${p.name}</div>`;
        html += `<div class="player-role-unknown">役職: ${p.role === 'Explorer' ? '探索者' : '狂信者'}</div>`;
        html += `<div class="player-san">SAN: ${p.san}</div>`;
        
        item.innerHTML = html;
        resultList.appendChild(item);
    });
}

function getRequiredParticipants(state) {
    if (state.round === 1 || state.round === 5) return 4;
    return 3;
}
