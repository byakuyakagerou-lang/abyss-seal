const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game State
let gameState = {
    players: [], // { id, name, role, san, hand: [], isBot: boolean }
    deck: [],
    round: 1,
    phase: 'lobby', // lobby, leader_selection, card_submission, event_action, result, game_over
    leaderId: null,
    participants: [], // player ids selected for the ritual
    submittedCards: [], // { playerId, card }
    successCount: 0,
    failCount: 0,
    winner: null, // 'Explorer' or 'Cultist'
    logs: [],
    activeEvents: {
        chatRestricted: false,
        handRevealed: [], // player IDs whose hands are revealed
        nextTurnRandom: false,
        blindSubmission: false,
        oneCardHand: false
    },
    pendingEventAction: null // For events that require leader action
};

const MAX_PLAYERS = 5;
const EVENT_CARDS = [
    { id: 'deep_exposure', name: '深淵の暴露', desc: '祭祀長が2名を指名。指名された者は、次ターンの終了まで手札が全員に公開される。' },
    { id: 'depleted_offerings', name: '枯渇する供物', desc: '全員の持ち手からランダムに1枚を強制破棄。次ターンの開始時のみ手札1枚で挑む。' },
    { id: 'bloody_price', name: '血塗られた代償', desc: '祭祀長が1名を「生贄」に指名。選ばれた者は即座にSAN値が2減少する。' },
    { id: 'invitation_to_madness', name: '狂気への誘い', desc: '最もSAN値が高い者全員が対象。「SAN値-1」か「成功カード1枚公開破棄」を選ぶ。（※今回はシステム側で強制SAN-1として自動処理）' },
    { id: 'blasphemous_curse', name: '冒涜的な呪詛', desc: '次ターン終了まで「成功」「失敗」の発言・チャットを禁止。違反者はSAN値-1。' },
    { id: 'blind_fanaticism', name: '盲目の狂信', desc: '次ターンの儀式参加者は、手札を見ずにランダム提出（システム自動処理）となる。' }
];

const ROLES = ['Explorer', 'Explorer', 'Explorer', 'Explorer', 'Cultist'];

function addLog(msg) {
    const log = { id: Date.now(), msg, type: 'system' };
    gameState.logs.push(log);
    if(gameState.logs.length > 50) gameState.logs.shift();
    io.emit('new_log', log);
}

function broadcastState() {
    io.sockets.sockets.forEach((socket) => {
        const playerState = JSON.parse(JSON.stringify(gameState));
        if (playerState.phase !== 'game_over') {
            playerState.players.forEach(p => {
                if (p.id !== socket.id) {
                    if (p.phase !== 'game_over') p.role = '???';
                    if (!playerState.activeEvents.handRevealed.includes(p.id)) {
                        p.hand = p.hand.map(() => 'hidden');
                    }
                }
            });
            playerState.deck = playerState.deck.length;
        }
        socket.emit('game_state', playerState);
    });
}

function createDeck() {
    let deck = [];
    for(let i=0; i<15; i++) deck.push('success');
    for(let i=0; i<15; i++) deck.push('fail');
    return deck.sort(() => Math.random() - 0.5);
}

function drawCards(count) {
    if (gameState.deck.length < count) return [];
    return gameState.deck.splice(0, count);
}

function getRequiredParticipants() {
    if (gameState.round === 1 || gameState.round === 5) return 4;
    return 3;
}

function checkGameOver() {
    if (gameState.successCount >= 3) {
        gameState.winner = 'Explorer';
        gameState.phase = 'game_over';
        addLog("【ゲーム終了】儀式が3回成功しました。探索者陣営の勝利です！");
        return true;
    }
    if (gameState.failCount >= 3) {
        gameState.winner = 'Cultist';
        gameState.phase = 'game_over';
        addLog("【ゲーム終了】儀式が3回失敗しました。狂信者陣営の勝利です！");
        return true;
    }
    
    const explorers = gameState.players.filter(p => p.role === 'Explorer');
    const allExplorersMad = explorers.every(p => p.san <= 0);
    if (allExplorersMad) {
        gameState.winner = 'Cultist';
        gameState.phase = 'game_over';
        addLog("【ゲーム終了】探索者が全員発狂しました。狂信者陣営の勝利です！");
        return true;
    }
    
    if (gameState.round > 5) {
        gameState.winner = 'Cultist';
        gameState.phase = 'game_over';
        addLog("【ゲーム終了】5回の儀式が終了しました。狂信者陣営の勝利です！");
        return true;
    }
    return false;
}

function nextTurn() {
    if (checkGameOver()) {
        broadcastState();
        return;
    }

    gameState.activeEvents.handRevealed = [];
    gameState.activeEvents.chatRestricted = false;
    
    const currentIndex = gameState.players.findIndex(p => p.id === gameState.leaderId);
    let nextIndex = (currentIndex + 1) % gameState.players.length;
    gameState.leaderId = gameState.players[nextIndex].id;
    
    gameState.phase = 'leader_selection';
    gameState.participants = [];
    gameState.submittedCards = [];
    gameState.pendingEventAction = null;
    
    addLog(`ラウンド ${gameState.round} が開始されました。現在の祭祀長は ${gameState.players[nextIndex].name} です。`);
    
    gameState.players.forEach(p => {
        const targetHandSize = gameState.activeEvents.oneCardHand ? 1 : 2;
        while (p.hand.length < targetHandSize && gameState.deck.length > 0) {
            p.hand.push(...drawCards(1));
        }
    });
    gameState.activeEvents.oneCardHand = false;

    if (gameState.activeEvents.nextTurnRandom) {
        gameState.activeEvents.blindSubmission = true;
        gameState.activeEvents.nextTurnRandom = false;
    } else {
        gameState.activeEvents.blindSubmission = false;
    }

    broadcastState();
    triggerBotActions();
}

function triggerEvent() {
    const event = EVENT_CARDS[Math.floor(Math.random() * EVENT_CARDS.length)];
    addLog(`【神話イベント発生】: ${event.name} - ${event.desc}`);
    
    switch(event.id) {
        case 'deep_exposure':
            gameState.phase = 'event_action';
            gameState.pendingEventAction = { type: 'select_players', count: 2, eventId: event.id };
            addLog("祭祀長は手札を公開する2名を選んでください。");
            triggerBotActions();
            break;
        case 'depleted_offerings':
            gameState.players.forEach(p => {
                if(p.hand.length > 0) {
                    const idx = Math.floor(Math.random() * p.hand.length);
                    p.hand.splice(idx, 1);
                }
            });
            gameState.activeEvents.oneCardHand = true;
            addLog("全員の手札がランダムに1枚破棄されました。次ターンは手札1枚で挑みます。");
            endRound();
            break;
        case 'bloody_price':
            gameState.phase = 'event_action';
            gameState.pendingEventAction = { type: 'select_players', count: 1, eventId: event.id };
            addLog("祭祀長は生贄となる1名を選んでください。");
            triggerBotActions();
            break;
        case 'invitation_to_madness':
            let maxSan = -1;
            gameState.players.forEach(p => { if(p.san > maxSan) maxSan = p.san; });
            const targets = gameState.players.filter(p => p.san === maxSan);
            targets.forEach(p => { p.san = Math.max(0, p.san - 1); });
            addLog(`最もSAN値が高いプレイヤーのSAN値が1減少しました。`);
            endRound();
            break;
        case 'blasphemous_curse':
            gameState.activeEvents.chatRestricted = true;
            addLog("次ターン終了まで「成功」「失敗」のチャットが禁止されます。");
            endRound();
            break;
        case 'blind_fanaticism':
            gameState.activeEvents.nextTurnRandom = true;
            addLog("次ターンの儀式参加者は、手札が自動的にランダム提出されます。");
            endRound();
            break;
    }
    broadcastState();
}

function processResults() {
    const hasFail = gameState.submittedCards.some(s => s.card === 'fail');
    
    let resultMsg = "提出されたカード: ";
    const shuffledCards = gameState.submittedCards.map(s => s.card).sort(() => Math.random() - 0.5);
    resultMsg += shuffledCards.map(c => c === 'success' ? '成功' : '失敗').join(', ');
    addLog(resultMsg);

    if (!hasFail) {
        gameState.successCount++;
        addLog(`【儀式成功】祭壇の封印に成功しました！（成功: ${gameState.successCount}回）`);
        triggerEvent();
    } else {
        gameState.failCount++;
        addLog(`【儀式失敗】失敗カードが含まれていました。（失敗: ${gameState.failCount}回）`);
        endRound();
    }
}

function endRound() {
    gameState.round++;
    nextTurn();
}

// Bot Logic
function triggerBotActions() {
    setTimeout(() => {
        if (gameState.phase === 'leader_selection') {
            const leader = gameState.players.find(p => p.id === gameState.leaderId);
            if (leader && leader.isBot) {
                const reqCount = getRequiredParticipants();
                let pool = gameState.players.map(p => p.id).sort(() => Math.random() - 0.5);
                handleSelectParticipants(leader.id, pool.slice(0, reqCount));
            }
        }
        else if (gameState.phase === 'card_submission') {
            gameState.players.forEach(p => {
                if (p.isBot && gameState.participants.includes(p.id)) {
                    const hasSubmitted = gameState.submittedCards.find(s => s.playerId === p.id);
                    if (!hasSubmitted && p.san > 0 && !gameState.activeEvents.blindSubmission) {
                        const cardIdx = Math.floor(Math.random() * p.hand.length);
                        handleSubmitCard(p.id, cardIdx);
                    }
                }
            });
        }
        else if (gameState.phase === 'event_action') {
            const leader = gameState.players.find(p => p.id === gameState.leaderId);
            if (leader && leader.isBot && gameState.pendingEventAction) {
                const count = gameState.pendingEventAction.count;
                let pool = gameState.players.map(p => p.id).sort(() => Math.random() - 0.5);
                handleEventAction(leader.id, pool.slice(0, count));
            }
        }
    }, 2000);
}

function checkGameStart() {
    if (gameState.players.length === MAX_PLAYERS) {
        const roles = [...ROLES].sort(() => Math.random() - 0.5);
        gameState.deck = createDeck();
        
        gameState.players.forEach((p, i) => {
            p.role = roles[i];
            p.hand = drawCards(2);
        });

        gameState.leaderId = gameState.players[Math.floor(Math.random() * MAX_PLAYERS)].id;
        gameState.phase = 'leader_selection';
        
        addLog("5人集まりました。ゲームを開始します！");
        addLog(`最初の祭祀長は ${gameState.players.find(p=>p.id===gameState.leaderId).name} です。`);
        
        broadcastState();
        triggerBotActions();
    }
}

// Extracted Action Handlers
function handleSelectParticipants(playerId, selectedIds) {
    if (gameState.phase !== 'leader_selection' || playerId !== gameState.leaderId) return;
    const reqCount = getRequiredParticipants();
    if (selectedIds.length !== reqCount) return;

    gameState.participants = selectedIds;
    gameState.phase = 'card_submission';
    
    const participantNames = gameState.players.filter(p => selectedIds.includes(p.id)).map(p => p.name).join(', ');
    addLog(`祭祀長が儀式参加者を選出しました: ${participantNames}`);
    
    gameState.players.forEach(p => {
        if (gameState.participants.includes(p.id)) {
            if (p.san <= 0 || gameState.activeEvents.blindSubmission) {
                const cardIdx = Math.floor(Math.random() * p.hand.length);
                const card = p.hand.splice(cardIdx, 1)[0];
                gameState.submittedCards.push({ playerId: p.id, card });
                addLog(`${p.name} のカードが自動提出されました。`);
            }
        }
    });
    
    if (gameState.submittedCards.length === reqCount) {
        gameState.phase = 'result';
        processResults();
    }

    broadcastState();
    triggerBotActions();
}

function handleSubmitCard(playerId, cardIndex) {
    const player = gameState.players.find(p => p.id === playerId);
    if (gameState.phase !== 'card_submission') return;
    if (!gameState.participants.includes(playerId)) return;
    if (gameState.submittedCards.find(s => s.playerId === playerId)) return;
    if (player.san <= 0 || gameState.activeEvents.blindSubmission) return;

    if (cardIndex < 0 || cardIndex >= player.hand.length) return;

    const card = player.hand.splice(cardIndex, 1)[0];
    gameState.submittedCards.push({ playerId, card });

    if (gameState.submittedCards.length === gameState.participants.length) {
        gameState.phase = 'result';
        processResults();
    } else {
        addLog(`${player.name} がカードを提出しました。`);
    }

    broadcastState();
    triggerBotActions();
}

function handleEventAction(playerId, selectedIds) {
    if (gameState.phase !== 'event_action' || playerId !== gameState.leaderId) return;
    if (!gameState.pendingEventAction) return;
    
    const action = gameState.pendingEventAction;
    if (selectedIds.length !== action.count) return;

    if (action.eventId === 'deep_exposure') {
        gameState.activeEvents.handRevealed = selectedIds;
        const names = gameState.players.filter(p => selectedIds.includes(p.id)).map(p => p.name).join(', ');
        addLog(`${names} の手札が公開されました。`);
    } else if (action.eventId === 'bloody_price') {
        const target = gameState.players.find(p => p.id === selectedIds[0]);
        target.san = Math.max(0, target.san - 2);
        addLog(`${target.name} が生贄に選ばれ、SAN値が2減少しました。`);
    }

    endRound();
}


io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_game', (playerName) => {
        if (gameState.phase !== 'lobby') {
            socket.emit('error_msg', 'ゲームは既に開始されています。');
            return;
        }
        if (gameState.players.length >= MAX_PLAYERS) {
            socket.emit('error_msg', '満員です。');
            return;
        }

        const existingPlayer = gameState.players.find(p => p.name === playerName);
        if (existingPlayer) {
             socket.emit('error_msg', 'その名前は既に使用されています。');
             return;
        }

        gameState.players.push({
            id: socket.id,
            name: playerName || `Player ${gameState.players.length + 1}`,
            role: null,
            san: 3,
            hand: [],
            isBot: false
        });

        addLog(`${playerName || `Player ${gameState.players.length}`} が参加しました。(${gameState.players.length}/${MAX_PLAYERS})`);

        checkGameStart();
        broadcastState();
    });

    socket.on('add_bot', () => {
        if (gameState.phase !== 'lobby') return;
        if (gameState.players.length >= MAX_PLAYERS) return;

        let botIndex = 1;
        let botName = `CPU ${botIndex}`;
        while (gameState.players.find(p => p.name === botName)) {
            botIndex++;
            botName = `CPU ${botIndex}`;
        }

        gameState.players.push({
            id: `bot_${Date.now()}_${Math.random()}`,
            name: botName,
            role: null,
            san: 3,
            hand: [],
            isBot: true
        });

        addLog(`${botName} が参加しました。(${gameState.players.length}/${MAX_PLAYERS})`);

        checkGameStart();
        broadcastState();
    });

    // Chat
    socket.on('send_chat', (msg) => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;

        let finalMsg = msg;
        
        if (player.san <= 0) {
            finalMsg = "あ…あ…あ…";
        } else if (gameState.activeEvents.chatRestricted) {
            if (msg.includes('成功') || msg.includes('失敗')) {
                player.san = Math.max(0, player.san - 1);
                addLog(`【警告】${player.name} が禁忌に触れました。SAN値が減少します。`);
                finalMsg = "【検閲済】";
            }
        }

        const chatLog = { id: Date.now(), msg: `${player.name}: ${finalMsg}`, type: 'chat' };
        gameState.logs.push(chatLog);
        if(gameState.logs.length > 50) gameState.logs.shift();
        io.emit('new_log', chatLog);
        
        if (player.san <= 0 || gameState.activeEvents.chatRestricted) {
            broadcastState();
        }
    });

    socket.on('select_participants', (selectedIds) => {
        const reqCount = getRequiredParticipants();
        if (selectedIds.length !== reqCount) {
             socket.emit('error_msg', `${reqCount}名選んでください。`);
             return;
        }
        handleSelectParticipants(socket.id, selectedIds);
    });

    socket.on('reroll_san', () => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (gameState.phase !== 'card_submission') return;
        if (!gameState.participants.includes(socket.id)) return;
        if (gameState.submittedCards.find(s => s.playerId === socket.id)) return;
        if (player.san <= 0) {
             socket.emit('error_msg', 'SAN値が足りません。');
             return;
        }

        player.san -= 1;
        gameState.deck.push(...player.hand);
        player.hand = [];
        gameState.deck.sort(() => Math.random() - 0.5);
        player.hand = drawCards(2);

        addLog(`${player.name} がSAN値を消費して手札を引き直しました。`);
        broadcastState();
    });

    socket.on('submit_card', (cardIndex) => {
        handleSubmitCard(socket.id, cardIndex);
    });

    socket.on('event_action', (selectedIds) => {
        handleEventAction(socket.id, selectedIds);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const playerIdx = gameState.players.findIndex(p => p.id === socket.id);
        if (playerIdx > -1) {
            const player = gameState.players[playerIdx];
            if (gameState.phase === 'lobby') {
                gameState.players.splice(playerIdx, 1);
                addLog(`${player.name} が退出しました。`);
                broadcastState();
            } else {
                addLog(`${player.name} が切断しました。`);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
