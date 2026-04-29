const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Multi-room state
const rooms = new Map(); // roomId -> gameState
const playerSocketMap = new Map(); // socket.id -> roomId

const MAX_PLAYERS = 5;
const ROLES = ['Explorer', 'Explorer', 'Explorer', 'Explorer', 'Cultist'];

const EVENT_CARDS = [
    { id: 'deep_exposure', name: '深淵の暴露', desc: '祭祀長が2名を指名。指名された者は、次ターンの終了まで手札が全員に公開される。' },
    { id: 'depleted_offerings', name: '枯渇する供物', desc: '全員の持ち手からランダムに1枚を強制破棄。次ターンの開始時のみ手札1枚で挑む。' },
    { id: 'bloody_price', name: '血塗られた代償', desc: '祭祀長が1名を「生贄」に指名。選ばれた者は即座にSAN値が2減少する。' },
    { id: 'invitation_to_madness', name: '狂気への誘い', desc: '最もSAN値が高い者全員が対象。「SAN値-1」か「成功カード1枚公開破棄」を選ぶ。（※システム側で強制SAN-1として処理）' },
    { id: 'blind_fanaticism', name: '盲目の狂信', desc: '次ターンの儀式参加者は、手札を見ずにランダム提出（自動処理）となる。' }
];

function createInitialGameState(roomId, roomName) {
    return {
        id: roomId,
        name: roomName,
        players: [],
        deck: [],
        round: 1,
        phase: 'lobby',
        leaderId: null,
        participants: [],
        submittedCards: [],
        successCount: 0,
        failCount: 0,
        winner: null,
        logs: [],
        activeEvents: {
            handRevealed: [],
            nextTurnRandom: false,
            blindSubmission: false,
            oneCardHand: false
        },
        pendingEventAction: null,
        shuffledResultCards: [],
        currentEvent: null,
        manipulatedPlayerNames: "",
        pendingChoicePlayers: []
    };
}

function resetGame(gameState) {
    gameState.deck = [];
    gameState.round = 1;
    gameState.phase = 'lobby';
    gameState.leaderId = null;
    gameState.participants = [];
    gameState.submittedCards = [];
    gameState.successCount = 0;
    gameState.failCount = 0;
    gameState.winner = null;
    gameState.activeEvents = {
        handRevealed: [],
        nextTurnRandom: false,
        blindSubmission: false,
        oneCardHand: false
    };
    gameState.pendingEventAction = null;
    gameState.shuffledResultCards = [];

    gameState.players.forEach(p => {
        p.role = null;
        p.san = 3;
        p.hand = [];
        if (!p.isBot) p.isReady = false;
    });
}

function addLog(gameState, msg) {
    const log = { id: Date.now(), msg, type: 'system' };
    gameState.logs.push(log);
    if(gameState.logs.length > 50) gameState.logs.shift();
    io.to(gameState.id).emit('new_log', log);
}

function broadcastState(roomId) {
    const gameState = rooms.get(roomId);
    if (!gameState) return;

    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    if (!roomSockets) return;

    roomSockets.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (!socket) return;
        
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

function drawCards(gameState, count) {
    if (gameState.deck.length < count) return [];
    return gameState.deck.splice(0, count);
}

function getRequiredParticipants(round) {
    if (round === 1 || round === 5) return 4;
    return 3;
}

function checkGameOver(gameState) {
    if (gameState.successCount >= 3) {
        gameState.winner = 'Explorer';
        gameState.phase = 'game_over_animation';
        addLog(gameState, "【ゲーム終了】儀式が3回成功しました。探索者陣営の勝利です！");
        return true;
    }
    if (gameState.failCount >= 3) {
        gameState.winner = 'Cultist';
        gameState.phase = 'game_over_animation';
        addLog(gameState, "【ゲーム終了】儀式が3回失敗しました。狂信者陣営の勝利です！");
        return true;
    }
    
    const explorers = gameState.players.filter(p => p.role === 'Explorer');
    const allExplorersMad = explorers.every(p => p.san <= 0);
    if (allExplorersMad) {
        gameState.winner = 'Cultist';
        gameState.phase = 'game_over_animation';
        addLog(gameState, "【ゲーム終了】探索者が全員発狂しました。狂信者陣営の勝利です！");
        return true;
    }
    
    if (gameState.round > 5) {
        gameState.winner = 'Cultist';
        gameState.phase = 'game_over_animation';
        addLog(gameState, "【ゲーム終了】5回の儀式が終了しました。狂信者陣営の勝利です！");
        return true;
    }
    return false;
}

function nextTurn(gameState) {
    if (checkGameOver(gameState)) {
        broadcastState(gameState.id);
        setTimeout(() => {
            if (rooms.has(gameState.id)) {
                gameState.phase = 'game_over';
                broadcastState(gameState.id);
            }
        }, 3000);
        return;
    }

    gameState.activeEvents.handRevealed = [];
    
    const currentIndex = gameState.players.findIndex(p => p.id === gameState.leaderId);
    let nextIndex = (currentIndex + 1) % gameState.players.length;
    gameState.leaderId = gameState.players[nextIndex].id;
    
    gameState.phase = 'leader_selection';
    gameState.participants = [];
    gameState.submittedCards = [];
    gameState.pendingEventAction = null;
    
    addLog(gameState, `ラウンド ${gameState.round} が開始されました。現在の祭祀長は ${gameState.players[nextIndex].name} です。`);
    
    gameState.players.forEach(p => {
        const targetHandSize = gameState.activeEvents.oneCardHand ? 1 : 2;
        while (p.hand.length < targetHandSize && gameState.deck.length > 0) {
            p.hand.push(...drawCards(gameState, 1));
        }
    });
    gameState.activeEvents.oneCardHand = false;

    if (gameState.activeEvents.nextTurnRandom) {
        gameState.activeEvents.blindSubmission = true;
        gameState.activeEvents.nextTurnRandom = false;
    } else {
        gameState.activeEvents.blindSubmission = false;
    }

    broadcastState(gameState.id);
    triggerBotActions(gameState);
}

function applyEvent(gameState, event) {
    addLog(gameState, `【神話イベント発動】: ${event.name} - ${event.desc}`);
    
    switch(event.id) {
        case 'deep_exposure':
            gameState.phase = 'event_action';
            gameState.pendingEventAction = { type: 'select_players', count: 2, eventId: event.id };
            addLog(gameState, "祭祀長は手札を公開する2名を選んでください。");
            triggerBotActions(gameState);
            break;
        case 'depleted_offerings':
            gameState.players.forEach(p => {
                if(p.hand.length > 0) {
                    const idx = Math.floor(Math.random() * p.hand.length);
                    p.hand.splice(idx, 1);
                }
            });
            gameState.activeEvents.oneCardHand = true;
            addLog(gameState, "全員の手札がランダムに1枚破棄されました。次ターンは手札1枚で挑みます。");
            endRound(gameState);
            break;
        case 'bloody_price':
            gameState.phase = 'event_action';
            gameState.pendingEventAction = { type: 'select_players', count: 1, eventId: event.id };
            addLog(gameState, "祭祀長は生贄となる1名を選んでください。");
            triggerBotActions(gameState);
            break;
        case 'invitation_to_madness':
            let maxSan = -1;
            gameState.players.forEach(p => { if(p.san > maxSan) maxSan = p.san; });
            const targets = gameState.players.filter(p => p.san === maxSan);
            
            gameState.pendingChoicePlayers = targets.map(p => p.id);
            gameState.phase = 'event_choice';
            gameState.pendingEventAction = { type: 'madness_choice', eventId: event.id };
            
            addLog(gameState, `「狂気への誘い」の対象: ${targets.map(p => p.name).join(', ')}`);
            addLog(gameState, `対象者は「SAN値-1」か「成功カードの破棄」を選択してください。`);
            
            // NPCの自動処理
            targets.forEach(p => {
                if (p.isBot) {
                    handleMadnessChoice(gameState, p.id, 'san');
                }
            });
            break;
        case 'blind_fanaticism':
            gameState.activeEvents.nextTurnRandom = true;
            addLog(gameState, "次ターンの儀式参加者は、手札が自動的にランダム提出されます。");
            endRound(gameState);
            break;
    }
    broadcastState(gameState.id);
}

function processResults(gameState) {
    const hasFail = gameState.shuffledResultCards.some(c => c === 'fail');
    
    let resultMsg = "提出されたカード: ";
    resultMsg += gameState.shuffledResultCards.map(c => c === 'success' ? '成功' : '失敗').join(', ');
    addLog(gameState, resultMsg);

    if (!hasFail) {
        gameState.successCount++;
        addLog(gameState, `【儀式成功】祭壇の封印に成功しました！（成功: ${gameState.successCount}回）`);
        
        if (gameState.successCount >= 3) {
            endRound(gameState);
        } else {
            // 神話イベントのアニメーションフェーズへ移行
            const event = EVENT_CARDS[Math.floor(Math.random() * EVENT_CARDS.length)];
            gameState.phase = 'event_animation';
            gameState.currentEvent = event;
            broadcastState(gameState.id);
            
            setTimeout(() => {
                if (rooms.has(gameState.id) && gameState.phase === 'event_animation') {
                    applyEvent(gameState, event);
                }
            }, 10000); // 10秒間に延長しテキストを読めるようにする
        }
    } else {
        gameState.failCount++;
        addLog(gameState, `【儀式失敗】失敗カードが含まれていました。（失敗: ${gameState.failCount}回）`);
        endRound(gameState);
    }
}

function endRound(gameState) {
    gameState.round++;
    nextTurn(gameState);
}

function updatePlayerIdReferences(gameState, oldId, newId) {
    if (gameState.leaderId === oldId) gameState.leaderId = newId;
    
    const partIdx = gameState.participants.indexOf(oldId);
    if (partIdx > -1) gameState.participants[partIdx] = newId;
    
    gameState.submittedCards.forEach(s => {
        if (s.playerId === oldId) s.playerId = newId;
    });
    
    const revIdx = gameState.activeEvents.handRevealed.indexOf(oldId);
    if (revIdx > -1) gameState.activeEvents.handRevealed[revIdx] = newId;
}

function handleMadnessChoice(gameState, playerId, choice) {
    if (gameState.phase !== 'event_choice') return;
    if (!gameState.pendingChoicePlayers.includes(playerId)) return;
    
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return;

    if (choice === 'san') {
        player.san = Math.max(0, player.san - 1);
        addLog(gameState, `${player.name} はSAN値を削ることを選びました。`);
    } else {
        const successIdx = player.hand.indexOf('success');
        if (successIdx > -1) {
            player.hand.splice(successIdx, 1);
            addLog(gameState, `${player.name} は手札の成功カード1枚を破棄しました。`);
        } else {
            player.san = Math.max(0, player.san - 1);
            addLog(gameState, `${player.name} は手札に成功カードがなかったため、代わりにSAN値を削りました。`);
        }
    }
    
    gameState.pendingChoicePlayers = gameState.pendingChoicePlayers.filter(id => id !== playerId);
    
    if (gameState.pendingChoicePlayers.length === 0) {
        endRound(gameState);
    }
}


function triggerBotActions(gameState) {
    setTimeout(() => {
        if (!rooms.has(gameState.id)) return;

        if (gameState.phase === 'leader_selection') {
            const leader = gameState.players.find(p => p.id === gameState.leaderId);
            if (leader && (leader.isBot || leader.san <= 0)) {
                const reqCount = getRequiredParticipants(gameState.round);
                let pool = gameState.players.map(p => p.id).filter(id => id !== leader.id).sort(() => Math.random() - 0.5);
                let selected = [leader.id, ...pool.slice(0, reqCount - 1)];
                handleSelectParticipants(gameState, leader.id, selected);
            }
        }
        else if (gameState.phase === 'card_submission') {
            gameState.players.forEach(p => {
                if (p.isBot && gameState.participants.includes(p.id)) {
                    const hasSubmitted = gameState.submittedCards.find(s => s.playerId === p.id);
                    if (!hasSubmitted && p.san > 0 && !gameState.activeEvents.blindSubmission) {
                        let cardIdx = Math.floor(Math.random() * p.hand.length);
                        
                        if (p.role === 'Explorer') {
                            const successIdx = p.hand.indexOf('success');
                            if (successIdx > -1) {
                                handleSubmitCard(gameState, p.id, successIdx);
                            } else if (p.san > 0) {
                                handleRerollSan(gameState, p.id, 0); // Re-roll random (first) card
                            } else {
                                handleSubmitCard(gameState, p.id, 0);
                            }
                        } else if (p.role === 'Cultist') {
                            const failIdx = p.hand.indexOf('fail');
                            if (failIdx > -1) {
                                handleSubmitCard(gameState, p.id, failIdx);
                            } else {
                                handleSubmitCard(gameState, p.id, 0);
                            }
                        }
                    }
                }
            });
        }
        else if (gameState.phase === 'event_action') {
            const leader = gameState.players.find(p => p.id === gameState.leaderId);
            if (leader && (leader.isBot || leader.san <= 0) && gameState.pendingEventAction) {
                const count = gameState.pendingEventAction.count;
                let pool = gameState.players.map(p => p.id).sort(() => Math.random() - 0.5);
                handleEventAction(gameState, leader.id, pool.slice(0, count));
            }
        }
    }, 2000);
}

function checkGameStart(gameState) {
    if (gameState.phase !== 'lobby') return;
    if (gameState.players.length === MAX_PLAYERS && gameState.players.every(p => p.isReady)) {
        const roles = [...ROLES].sort(() => Math.random() - 0.5);
        gameState.deck = createDeck();
        
        gameState.players.forEach((p, i) => {
            p.role = roles[i];
            p.hand = drawCards(gameState, 2);
        });

        gameState.leaderId = gameState.players[Math.floor(Math.random() * MAX_PLAYERS)].id;
        gameState.phase = 'leader_selection';
        
        addLog(gameState, "5人集まり全員の準備が完了しました。ゲームを開始します！");
        addLog(gameState, `最初の祭祀長は ${gameState.players.find(p=>p.id===gameState.leaderId).name} です。`);
        
        broadcastState(gameState.id);
        triggerBotActions(gameState);
    }
}

function handleSelectParticipants(gameState, playerId, selectedIds) {
    if (gameState.phase !== 'leader_selection' || playerId !== gameState.leaderId) return;
    const reqCount = getRequiredParticipants(gameState.round);
    if (selectedIds.length !== reqCount) return;

    if (!selectedIds.includes(playerId)) return;

    gameState.participants = selectedIds;
    
    const participantNames = gameState.players.filter(p => selectedIds.includes(p.id)).map(p => p.name).join(', ');
    addLog(gameState, `祭祀長が儀式参加者を選出しました: ${participantNames}`);
    
    // 自動提出が必要なプレイヤーを特定
    const manipulatedPlayers = gameState.players.filter(p => 
        selectedIds.includes(p.id) && (p.san <= 0 || gameState.activeEvents.blindSubmission)
    );

    if (manipulatedPlayers.length > 0) {
        gameState.phase = 'manipulation_animation';
        gameState.manipulatedPlayerNames = manipulatedPlayers.map(p => p.name).join(', ');
        broadcastState(gameState.id);
        
        setTimeout(() => {
            if (!rooms.has(gameState.id)) return;
            gameState.phase = 'card_submission';
            
            manipulatedPlayers.forEach(p => {
                const cardIdx = Math.floor(Math.random() * p.hand.length);
                const card = p.hand.splice(cardIdx, 1)[0];
                gameState.submittedCards.push({ playerId: p.id, card });
                addLog(gameState, `${p.name} のカードが深淵の意思によって自動提出されました。`);
            });
            
            checkCardSubmissionComplete(gameState);
            broadcastState(gameState.id);
            triggerBotActions(gameState);
        }, 4000);
    } else {
        gameState.phase = 'card_submission';
        broadcastState(gameState.id);
        triggerBotActions(gameState);
    }
}

function handleRerollSan(gameState, playerId, cardIndex) {
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return;

    if (gameState.phase !== 'card_submission') return;
    if (!gameState.participants.includes(playerId)) return;
    if (gameState.submittedCards.find(s => s.playerId === playerId)) return;
    if (player.san <= 0) return;
    if (typeof cardIndex !== 'number' || cardIndex < 0 || cardIndex >= player.hand.length) return;

    player.san -= 1;
    const oldCard = player.hand.splice(cardIndex, 1)[0];
    player.hand.push(...drawCards(gameState, 1));
    gameState.deck.push(oldCard);
    gameState.deck.sort(() => Math.random() - 0.5);

    addLog(gameState, `${player.name} がSAN値を消費して手札を1枚引き直しました。`);

    if (player.san <= 0) {
        // 發狂して強制提出（アニメーション用フェーズ）
        gameState.phase = 'manipulation_animation';
        gameState.manipulatedPlayerNames = player.name;
        broadcastState(gameState.id);
        
        setTimeout(() => {
            if (!rooms.has(gameState.id)) return;
            gameState.phase = 'card_submission';
            const finalCardIdx = Math.floor(Math.random() * player.hand.length);
            const card = player.hand.splice(finalCardIdx, 1)[0];
            gameState.submittedCards.push({ playerId: player.id, card });
            addLog(gameState, `${player.name} は発狂し、深淵の意思によってカードが自動提出されました。`);
            
            checkCardSubmissionComplete(gameState);
            broadcastState(gameState.id);
            triggerBotActions(gameState);
        }, 4000);
    } else {
        checkCardSubmissionComplete(gameState);
        broadcastState(gameState.id);
        triggerBotActions(gameState);
    }
}

function checkCardSubmissionComplete(gameState) {
    if (gameState.phase !== 'card_submission') return;
    if (gameState.submittedCards.length === gameState.participants.length) {
        gameState.phase = 'result';
        let resultCards = gameState.submittedCards.map(s => s.card);
        // 成功を優先的に並べる (successが先、failが後)
        resultCards.sort((a, b) => {
            if (a === 'success' && b === 'fail') return -1;
            if (a === 'fail' && b === 'success') return 1;
            return 0;
        });
        gameState.shuffledResultCards = resultCards;
        addLog(gameState, "全員の提出が完了しました。儀式の結果を確認します...");
        
        // Wait for animation (1.5s per card + 3s pause)
        const delay = gameState.shuffledResultCards.length * 1500 + 3000;
        setTimeout(() => {
            if (rooms.has(gameState.id) && gameState.phase === 'result') {
                processResults(gameState);
            }
        }, delay);
    }
}

function handleSubmitCard(gameState, playerId, cardIndex) {
    const player = gameState.players.find(p => p.id === playerId);
    if (gameState.phase !== 'card_submission') return;
    if (!gameState.participants.includes(playerId)) return;
    if (gameState.submittedCards.find(s => s.playerId === playerId)) return;
    if (player.san <= 0 || gameState.activeEvents.blindSubmission) return;

    if (cardIndex < 0 || cardIndex >= player.hand.length) return;

    const card = player.hand.splice(cardIndex, 1)[0];
    gameState.submittedCards.push({ playerId, card });

    addLog(gameState, `${player.name} がカードを提出しました。`);
    
    checkCardSubmissionComplete(gameState);

    broadcastState(gameState.id);
    triggerBotActions(gameState);
}

function handleEventAction(gameState, playerId, selectedIds) {
    if (gameState.phase !== 'event_action' || playerId !== gameState.leaderId) return;
    if (!gameState.pendingEventAction) return;
    
    const action = gameState.pendingEventAction;
    if (selectedIds.length !== action.count) return;

    if (action.eventId === 'deep_exposure') {
        gameState.activeEvents.handRevealed = selectedIds;
        const names = gameState.players.filter(p => selectedIds.includes(p.id)).map(p => p.name).join(', ');
        addLog(gameState, `${names} の手札が公開されました。`);
    } else if (action.eventId === 'bloody_price') {
        const target = gameState.players.find(p => p.id === selectedIds[0]);
        target.san = Math.max(0, target.san - 2);
        addLog(gameState, `${target.name} が生贄に選ばれ、SAN値が2減少しました。`);
    }

    endRound(gameState);
}


io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Provide room list
    socket.on('get_rooms', () => {
        const roomList = Array.from(rooms.values()).map(r => ({
            id: r.id,
            name: r.name,
            playerCount: r.players.length,
            maxPlayers: MAX_PLAYERS,
            phase: r.phase
        }));
        socket.emit('room_list', roomList);
    });

    socket.on('create_room', (roomName, playerName) => {
        const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const finalRoomName = roomName || `${playerName}の部屋`;
        const gameState = createInitialGameState(roomId, finalRoomName);
        rooms.set(roomId, gameState);

        joinRoomAction(socket, gameState, playerName);
    });

    socket.on('join_room', (roomId, playerName) => {
        const gameState = rooms.get(roomId);
        if (!gameState) {
            socket.emit('error_msg', '部屋が見つかりません。');
            return;
        }
        joinRoomAction(socket, gameState, playerName);
    });

    function joinRoomAction(socket, gameState, playerName) {
        if (gameState.phase !== 'lobby') {
            // Check for reconnect
            const existing = gameState.players.find(p => p.name === playerName);
            if (existing && !existing.isConnected && !existing.isBot) {
                socket.join(gameState.id);
                playerSocketMap.set(socket.id, gameState.id);
                const oldId = existing.id;
                existing.id = socket.id;
                existing.isConnected = true;
                updatePlayerIdReferences(gameState, oldId, socket.id);
                addLog(gameState, `${playerName} が復帰しました。`);
                socket.emit('joined_room', gameState.id);
                broadcastState(gameState.id);
                return;
            }
            socket.emit('error_msg', 'ゲームは既に開始されています。');
            return;
        }

        const existingPlayer = gameState.players.find(p => p.name === playerName);
        if (existingPlayer) {
            if (!existingPlayer.isConnected && !existingPlayer.isBot) {
                socket.join(gameState.id);
                playerSocketMap.set(socket.id, gameState.id);
                const oldId = existingPlayer.id;
                existingPlayer.id = socket.id;
                existingPlayer.isConnected = true;
                updatePlayerIdReferences(gameState, oldId, socket.id);
                addLog(gameState, `${playerName} が復帰しました。`);
                socket.emit('joined_room', gameState.id);
                checkGameStart(gameState);
                broadcastState(gameState.id);
                return;
            } else {
                 socket.emit('error_msg', 'その名前は既に使用されています。');
                 return;
            }
        }

        if (gameState.players.length >= MAX_PLAYERS) {
            socket.emit('error_msg', '満員です。');
            return;
        }

        socket.join(gameState.id);
        playerSocketMap.set(socket.id, gameState.id);

        gameState.players.push({
            id: socket.id,
            name: playerName || `Player ${gameState.players.length + 1}`,
            role: null,
            san: 3,
            hand: [],
            isBot: false,
            isReady: false,
            isConnected: true
        });

        addLog(gameState, `${playerName || `Player ${gameState.players.length}`} がルームに入室しました。(${gameState.players.length}/${MAX_PLAYERS})`);

        socket.emit('joined_room', gameState.id);
        checkGameStart(gameState);
        broadcastState(gameState.id);
    }

    socket.on('toggle_ready', () => {
        const roomId = playerSocketMap.get(socket.id);
        if (!roomId) return;
        const gameState = rooms.get(roomId);
        if (!gameState) return;

        const player = gameState.players.find(p => p.id === socket.id);
        if (player && gameState.phase === 'lobby') {
            player.isReady = !player.isReady;
            broadcastState(gameState.id);
            checkGameStart(gameState);
        }
    });

    socket.on('add_bot', () => {
        const roomId = playerSocketMap.get(socket.id);
        if (!roomId) return;
        const gameState = rooms.get(roomId);
        if (!gameState) return;

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
            isBot: true,
            isReady: true,
            isConnected: true
        });

        addLog(gameState, `${botName} がルームに参加しました。(${gameState.players.length}/${MAX_PLAYERS})`);

        checkGameStart(gameState);
        broadcastState(gameState.id);
    });

    socket.on('send_chat', (msg) => {
        const roomId = playerSocketMap.get(socket.id);
        if (!roomId) return;
        const gameState = rooms.get(roomId);
        if (!gameState) return;

        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;

        let finalMsg = msg;
        
        if (player.san <= 0) {
            finalMsg = "あ…あ…あ…";
        }

        const chatLog = { id: Date.now(), msg: `${player.name}: ${finalMsg}`, type: 'chat' };
        gameState.logs.push(chatLog);
        if(gameState.logs.length > 50) gameState.logs.shift();
        io.to(gameState.id).emit('new_log', chatLog);
        
        if (player.san <= 0) {
            broadcastState(gameState.id);
        }
    });

    socket.on('select_participants', (selectedIds) => {
        const roomId = playerSocketMap.get(socket.id);
        if (!roomId) return;
        const gameState = rooms.get(roomId);
        if (!gameState) return;

        const reqCount = getRequiredParticipants(gameState.round);
        if (selectedIds.length !== reqCount) {
             socket.emit('error_msg', `${reqCount}名選んでください。`);
             return;
        }
        handleSelectParticipants(gameState, socket.id, selectedIds);
    });

    socket.on('reroll_san', (cardIndex) => {
        const roomId = playerSocketMap.get(socket.id);
        if (!roomId) return;
        const gameState = rooms.get(roomId);
        if (!gameState) return;

        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;

        handleRerollSan(gameState, player.id, cardIndex);
    });

    socket.on('submit_card', (cardIndex) => {
        const gameState = rooms.get(playerSocketMap.get(socket.id));
        if (!gameState) return;
        handleSubmitCard(gameState, socket.id, cardIndex);
    });

    socket.on('madness_choice', (choice) => {
        const gameState = rooms.get(playerSocketMap.get(socket.id));
        if (!gameState) return;
        handleMadnessChoice(gameState, socket.id, choice);
    });

    socket.on('event_action', (selectedIds) => {
        const roomId = playerSocketMap.get(socket.id);
        if (!roomId) return;
        const gameState = rooms.get(roomId);
        if (!gameState) return;
        handleEventAction(gameState, socket.id, selectedIds);
    });

    socket.on('return_to_room', () => {
        const roomId = playerSocketMap.get(socket.id);
        if (!roomId) return;
        const gameState = rooms.get(roomId);
        if (!gameState) return;

        if (gameState.phase === 'game_over') {
            resetGame(gameState);
            gameState.players = gameState.players.filter(p => p.isBot || p.isConnected);
            broadcastState(gameState.id);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const roomId = playerSocketMap.get(socket.id);
        if (!roomId) return;
        playerSocketMap.delete(socket.id);

        const gameState = rooms.get(roomId);
        if (!gameState) return;

        const playerIdx = gameState.players.findIndex(p => p.id === socket.id);
        if (playerIdx > -1) {
            const player = gameState.players[playerIdx];
            player.isConnected = false;

            if (gameState.phase === 'lobby') {
                gameState.players.splice(playerIdx, 1);
                addLog(gameState, `${player.name} が退出しました。`);
            } else {
                addLog(gameState, `${player.name} が切断しました。`);
            }
            broadcastState(gameState.id);
        }

        // Cleanup empty rooms
        setTimeout(() => {
            if (rooms.has(roomId)) {
                const rs = rooms.get(roomId);
                const hasHumans = rs.players.some(p => !p.isBot && p.isConnected);
                if (!hasHumans) {
                    rooms.delete(roomId);
                    console.log(`Room ${roomId} deleted due to inactivity.`);
                }
            }
        }, 10000); // 10s delay to allow quick reconnects
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
