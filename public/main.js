const socket = io();

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const roomListScreen = document.getElementById('room-list-screen');
const roomScreen = document.getElementById('room-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name-input');
const createRoomBtn = document.getElementById('create-room-btn');
const showRoomsBtn = document.getElementById('show-rooms-btn');
const loginError = document.getElementById('login-error');

const refreshRoomsBtn = document.getElementById('refresh-rooms-btn');
const activeRoomsContainer = document.getElementById('active-rooms-container');
const backToLoginBtn = document.getElementById('back-to-login-btn');

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
const madnessSanBtn = document.getElementById('madness-san-btn');
const madnessDiscardBtn = document.getElementById('madness-discard-btn');

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
let logsRestored = false;
let isAnimatingResult = false;
let isAnimatingEvent = false;
let isAnimatingManipulation = false;
let previousHand = [];
let justRerolledIdx = null;

// --- Event Listeners ---
createRoomBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (!name) return;
    socket.emit('create_room', null, name);
});

showRoomsBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (!name) return;
    loginScreen.classList.remove('active');
    roomListScreen.classList.add('active');
    socket.emit('get_rooms');
});

refreshRoomsBtn.addEventListener('click', () => {
    socket.emit('get_rooms');
});

backToLoginBtn.addEventListener('click', () => {
    roomListScreen.classList.remove('active');
    loginScreen.classList.add('active');
});

playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') createRoomBtn.click();
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
        justRerolledIdx = selectedCardIndex;
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

madnessSanBtn.addEventListener('click', () => {
    socket.emit('madness_choice', 'san');
});

madnessDiscardBtn.addEventListener('click', () => {
    socket.emit('madness_choice', 'discard');
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

socket.on('room_list', (rooms) => {
    activeRoomsContainer.innerHTML = '';
    if (rooms.length === 0) {
        activeRoomsContainer.innerHTML = '<div style="color: #ccc; text-align: center;">現在利用可能な部屋はありません。</div>';
        return;
    }
    rooms.forEach(r => {
        const item = document.createElement('div');
        item.style.background = 'rgba(0,0,0,0.5)';
        item.style.padding = '10px';
        item.style.borderRadius = '5px';
        item.style.border = '1px solid var(--panel-border)';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.cursor = 'pointer';
        
        let status = r.phase === 'lobby' ? `<span style="color:var(--success-color)">待機中 (${r.playerCount}/${r.maxPlayers})</span>` : `<span style="color:var(--danger-color)">進行中 (${r.playerCount}/${r.maxPlayers})</span>`;
        
        item.innerHTML = `<div><strong>${r.name}</strong></div><div>${status}</div>`;
        item.addEventListener('click', () => {
            const name = playerNameInput.value.trim();
            socket.emit('join_room', r.id, name);
        });
        activeRoomsContainer.appendChild(item);
    });
});

socket.on('joined_room', (roomId) => {
    loginScreen.classList.remove('active');
    roomListScreen.classList.remove('active');
});

socket.on('game_state', (state) => {
    currentGameState = state;
    
    const me = state.players.find(p => p.id === socket.id || (p.isConnected && p.name === playerNameInput.value.trim()));
    if (me) myId = me.id; // Update myId in case we took over a session

    if (state.phase === 'lobby') {
        if (!me) {
            loginScreen.classList.add('active');
            roomScreen.classList.remove('active');
            gameScreen.classList.remove('active');
            roomListScreen.classList.remove('active');
        } else {
            loginScreen.classList.remove('active');
            roomListScreen.classList.remove('active');
            roomScreen.classList.add('active');
            gameScreen.classList.remove('active');
            updateRoom(state);
        }
        overlay.classList.add('hidden');
    } else {
        loginScreen.classList.remove('active');
        roomScreen.classList.remove('active');
        roomListScreen.classList.remove('active');
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

        if (state.phase === 'result') {
            if (!isAnimatingResult) {
                showRitualAnimation(state);
            }
        } else {
            hideRitualAnimation();
        }

        if (state.phase === 'event_animation') {
            if (!isAnimatingEvent) {
                showEventAnimation(state);
            }
        } else {
            hideEventAnimation();
        }

        if (state.phase === 'manipulation_animation') {
            if (!isAnimatingManipulation) {
                showManipulationAnimation(state);
            }
        } else {
            hideManipulationAnimation();
        }

        if (state.phase === 'game_over_animation') {
            const container = document.getElementById('game-over-anim-container');
            if (container) {
                container.classList.remove('hidden');
                const isVictory = state.winner === 'Explorer';
                const text = isVictory ? "VICTORY" : "DEFEAT";
                const colorClass = isVictory ? "victory-text" : "defeat-text";
                container.innerHTML = `<div class="game-over-anim-text ${colorClass}">${text}</div>`;
            }
        } else {
            const container = document.getElementById('game-over-anim-container');
            if (container) {
                container.classList.add('hidden');
                container.innerHTML = '';
            }
        }

        // Restore logs if reconnected
        if (!logsRestored && state.logs && state.logs.length > 0) {
            chatLog.innerHTML = '';
            state.logs.forEach(log => {
                const div = document.createElement('div');
                div.className = `chat-msg ${log.type}`;
                div.textContent = log.msg;
                chatLog.appendChild(div);
            });
            chatLog.scrollTop = chatLog.scrollHeight;
            logsRestored = true;
        }
    }
});

// --- Render Functions ---

function updateRoom(state) {
    roomPlayersList.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.background = 'rgba(0,0,0,0.4)';
        item.style.padding = '10px 20px';
        item.style.borderRadius = '8px';
        item.style.border = '1px solid rgba(120,50,150,0.3)';
        item.style.minHeight = '24px';

        const p = state.players[i];
        if (p) {
            const nameDiv = document.createElement('div');
            nameDiv.style.fontWeight = 'bold';
            nameDiv.textContent = p.name + (p.id === myId ? ' (あなた)' : '');

            const statusDiv = document.createElement('div');
            statusDiv.style.fontWeight = 'bold';
            if (p.isReady) {
                statusDiv.style.color = '#2080a0';
                statusDiv.textContent = '準備完了';
            } else {
                statusDiv.style.color = '#8a7a90';
                statusDiv.textContent = '準備中...';
            }

            item.appendChild(nameDiv);
            item.appendChild(statusDiv);
        } else {
            const nameDiv = document.createElement('div');
            nameDiv.style.color = 'var(--text-muted)';
            nameDiv.textContent = '---- 空き ----';
            
            const statusDiv = document.createElement('div');
            
            item.appendChild(nameDiv);
            item.appendChild(statusDiv);
        }
        
        roomPlayersList.appendChild(item);
    }

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
        'event_choice': '狂気への誘い',
        'event_action': '神話イベント処理',
        'result': '結果判定',
        'game_over_animation': '決着',
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

    // Check if hand actually changed
    let handChanged = false;
    if (me.hand.length !== previousHand.length) {
        handChanged = true;
    } else {
        for (let i = 0; i < me.hand.length; i++) {
            if (me.hand[i] !== previousHand[i]) handChanged = true;
        }
    }
    if (justRerolledIdx !== null) handChanged = true;

    if (handChanged || myHandContainer.children.length === 0) {
        myHandContainer.innerHTML = '';
        me.hand.forEach((cardVal, idx) => {
            const card = document.createElement('div');
            
            let isNew = false;
            if (me.hand.length > previousHand.length) isNew = true;
            else if (me.hand.length === previousHand.length && previousHand[idx] !== cardVal) isNew = true;
            else if (justRerolledIdx === idx) isNew = true;

            card.className = `card ${cardVal}` + (isNew ? ' draw-animation' : '');
            card.textContent = cardVal === 'success' ? '成功' : (cardVal === 'fail' ? '失敗' : '?');
            card.dataset.baseClass = card.className;
            
            myHandContainer.appendChild(card);
        });
        previousHand = me.hand.slice();
    }
    justRerolledIdx = null;

    // Interaction logic
    Array.from(myHandContainer.children).forEach((card, idx) => {
        card.className = card.dataset.baseClass; // Reset to base classes

        if (state.phase === 'card_submission' && state.participants.includes(myId) && !state.submittedCards.find(s=>s.playerId === myId) && me.san > 0 && !state.activeEvents.blindSubmission) {
            card.classList.add('playable');
            if (idx === selectedCardIndex) card.classList.add('selected');
            
            card.onclick = () => {
                selectedCardIndex = idx;
                updateMyStatus(state);
                updateActions(state);
            };
        } else {
            card.onclick = null;
        }
    });
}

function updateOtherPlayers(state) {
    otherPlayersContainer.innerHTML = '';
    
    const reqCount = getRequiredParticipants(state);
    const actionCount = state.pendingEventAction ? state.pendingEventAction.count : 0;
    
    state.players.forEach(p => {
        const isMe = p.id === myId;
        
        const card = document.createElement('div');
        card.className = 'player-card';
        if (state.leaderId === p.id) card.classList.add('is-leader');
        if (p.san <= 0) card.classList.add('is-dead');
        
        let html = `<div class="player-name">${p.name}${isMe ? ' (あなた)' : ''}</div>`;
        html += `<div class="player-role-unknown">${p.role === '???' ? '役職: ???' : `役職: ${p.role === 'Explorer' ? '探索者' : '狂信者'}`}</div>`;
        html += `<div class="player-san">SAN: ${p.san}</div>`;
        
        card.innerHTML = html;
        
        // 公開された手札の表示
        if (state.activeEvents.handRevealed.includes(p.id)) {
            const handDiv = document.createElement('div');
            handDiv.className = 'other-hand';
            p.hand.forEach(cardVal => {
                const mini = document.createElement('div');
                mini.className = `mini-card ${cardVal}`;
                handDiv.appendChild(mini);
            });
            card.appendChild(handDiv);
        }
        
        // Selection Logic
        let isSelectable = false;
        if (state.phase === 'leader_selection' && state.leaderId === myId) {
            isSelectable = true;
            if (isMe) {
                card.style.borderColor = 'var(--primary-color)';
                card.style.boxShadow = '0 0 15px rgba(200, 40, 60, 0.5)';
            } else if (selectedOtherPlayerIds.includes(p.id)) {
                card.style.borderColor = 'var(--primary-color)';
                card.style.boxShadow = '0 0 10px rgba(200, 40, 60, 0.3)';
            }
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
        
        if (state.phase !== 'leader_selection' && state.participants.includes(p.id)) {
            card.style.borderColor = '#2080a0';
            card.style.boxShadow = '0 0 10px rgba(32, 128, 160, 0.4)';
        }
        
        if (state.phase === 'card_submission' && state.submittedCards.find(s => s.playerId === p.id)) {
             card.style.opacity = '0.7';
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
    selectParticipantsBtn.classList.add('hidden');
    submitCardBtn.classList.add('hidden');
    rerollSanBtn.classList.add('hidden');
    eventActionBtn.classList.add('hidden');
    madnessSanBtn.classList.add('hidden');
    madnessDiscardBtn.classList.add('hidden');
    
    const me = state.players.find(p => p.id === myId);
    if (!me) return;

    let promptText = "他のプレイヤーを待っています...";

    if (state.phase === 'lobby') {
        promptText = `参加者を待っています... (${state.players.length}/5)`;
    } 
    else if (state.phase === 'leader_selection') {
        if (state.leaderId === myId) {
            if (me.san <= 0) {
                promptText = "SAN値が0のため、参加者は自動的に選出されます...";
            } else {
                if (!selectedOtherPlayerIds.includes(myId)) {
                    selectedOtherPlayerIds.push(myId);
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
    else if (state.phase === 'event_choice') {
        if (state.pendingChoicePlayers.includes(myId)) {
            promptText = "「狂気への誘い」の対象となりました。選択してください。";
            madnessSanBtn.classList.remove('hidden');
            madnessDiscardBtn.classList.remove('hidden');
        } else {
            promptText = "対象者が深淵の誘いに抗っています...";
        }
    }
    else if (state.phase === 'event_action') {
        if (state.leaderId === myId && state.pendingEventAction) {
            if (me.san <= 0) {
                promptText = "SAN値が0のため、イベント対象は自動的に選出されます...";
            } else {
                promptText = `神話イベント効果の対象を ${state.pendingEventAction.count} 名選んでください。`;
                eventActionBtn.classList.remove('hidden');
                eventActionBtn.disabled = selectedOtherPlayerIds.length !== state.pendingEventAction.count;
            }
        } else {
            promptText = "祭祀長が神話イベントの処理を行っています...";
        }
    }
    
    actionPrompt.textContent = promptText;
}

function showRitualAnimation(state) {
    isAnimatingResult = true;
    const container = document.getElementById('ritual-animation-container');
    const cardsContainer = document.getElementById('ritual-animation-cards');
    
    container.classList.remove('hidden');
    cardsContainer.innerHTML = '';
    
    state.shuffledResultCards.forEach((cardVal, index) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card hidden-card';
        cardsContainer.appendChild(cardEl);
        
        setTimeout(() => {
            cardEl.className = `card ${cardVal} flip-animation`;
            cardEl.textContent = cardVal === 'success' ? '成功' : '失敗';
        }, (index + 1) * 1500);
    });
}

function hideRitualAnimation() {
    isAnimatingResult = false;
    const container = document.getElementById('ritual-animation-container');
    if (container) {
        container.classList.add('hidden');
    }
}

function showEventAnimation(state) {
    if (!state.currentEvent) return;
    isAnimatingEvent = true;
    const container = document.getElementById('event-animation-container');
    container.classList.remove('hidden');
    
    container.innerHTML = `
        <div class="abyss-bg"></div>
        <div class="creepy-eye" style="top: 20%; left: 30%;"></div>
        <div class="creepy-eye" style="top: 60%; right: 25%; animation-delay: 1.5s;"></div>
        <div class="creepy-intro">深淵より何かが這い寄る……</div>
        <div class="glitch-text shake-effect">${state.currentEvent.name}</div>
        <div class="event-desc">${state.currentEvent.desc}</div>
    `;
}

function hideEventAnimation() {
    isAnimatingEvent = false;
    const container = document.getElementById('event-animation-container');
    if (container) {
        container.classList.add('hidden');
        container.innerHTML = '';
    }
}

function showManipulationAnimation(state) {
    isAnimatingManipulation = true;
    const container = document.getElementById('manipulation-animation-container');
    container.classList.remove('hidden');
    
    const isBlind = state.activeEvents.blindSubmission;
    let text = isBlind ? "盲目の狂信……供物は贄となる" : "狂気が手足を操る……";
    let subText = state.manipulatedPlayerNames ? `対象: ${state.manipulatedPlayerNames}` : "";
    
    if (isBlind) {
        container.style.background = 'radial-gradient(circle at center, transparent 0%, rgba(100, 0, 50, 0.6) 100%)';
    } else {
        container.style.background = ''; // Default CSS
    }
    
    container.innerHTML = `
        <div class="tentacle" style="left: 10%; animation-delay: 0.1s;"></div>
        <div class="tentacle" style="left: 30%; width: 25px; animation-delay: 0.4s;"></div>
        <div class="tentacle" style="left: 50%; width: 30px; animation-delay: 0s;"></div>
        <div class="tentacle" style="left: 70%; width: 25px; animation-delay: 0.3s;"></div>
        <div class="tentacle" style="left: 90%; animation-delay: 0.2s;"></div>
        <div class="manipulation-text">${text}<br><span style="font-size: 1.5rem; opacity: 0.8;">${subText}</span></div>
    `;
}

function hideManipulationAnimation() {
    isAnimatingManipulation = false;
    const container = document.getElementById('manipulation-animation-container');
    if (container) {
        container.classList.add('hidden');
        container.innerHTML = '';
    }
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
