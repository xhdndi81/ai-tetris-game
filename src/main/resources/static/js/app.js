let userName = null;
let lastSpokenText = '';
let lastSpokenTime = 0;
let rafId = null;
let boardCanvas;
let holdCanvas;
let nextCanvas;
let boardCtx;
let holdCtx;
let nextCtx;

const HISTORY_KEY = 'kid-tetris-history';
const BEST_KEY = 'kid-tetris-best';
const MUSIC_KEY = 'kid-tetris-muted';
const BGM_VOLUME = 0.34;
const BGM_DUCK = 0.1;

let bgm = null;
let battle = {
    active: false,
    socket: null,
    opponent: '',
    reported: false,
    leaving: false,
    friendLeft: false,
    waiting: false,
    roomTimer: null
};

const ATTACK_LINES = [0, 1, 2, 3, 4];

function requestFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
        elem.requestFullscreen().catch(() => {});
    } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
    }
}

function isMusicMuted() {
    return localStorage.getItem(MUSIC_KEY) === '1';
}

function setIconButton(id, icon, label) {
    const button = $(id);
    button.find('.btn-ico').text(icon);
    button.find('.btn-txt').text(label);
}

function updateMusicButton() {
    const muted = isMusicMuted();
    $('#btn-music').toggleClass('is-muted', muted);
    setIconButton('#btn-music', muted ? '🔇' : '🔊', '음악');
}

function playBgm() {
    if (!bgm || isMusicMuted()) return;
    bgm.volume = BGM_VOLUME;
    const playPromise = bgm.play();
    if (playPromise && playPromise.catch) {
        playPromise.catch(() => {});
    }
}

function pauseBgm() {
    if (!bgm) return;
    bgm.pause();
}

function stopBgm() {
    if (!bgm) return;
    bgm.pause();
    bgm.currentTime = 0;
}

function duckBgm(active) {
    if (!bgm || isMusicMuted() || bgm.paused) return;
    bgm.volume = active ? BGM_DUCK : BGM_VOLUME;
}

function speak(text) {
    if (typeof speechSynthesis === 'undefined' || !text) return;
    const now = Date.now();
    if (text === lastSpokenText && now - lastSpokenTime < 1000) return;
    lastSpokenText = text;
    lastSpokenTime = now;
    speechSynthesis.cancel();
    duckBgm(true);
    setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        const voices = speechSynthesis.getVoices();
        const preferred = voices.find(v => v.lang === 'ko-KR' && (v.name.includes('Google') || v.name.includes('Natural'))) ||
            voices.find(v => v.lang === 'ko-KR');
        if (preferred) utterance.voice = preferred;
        utterance.lang = 'ko-KR';
        utterance.rate = 0.95;
        utterance.pitch = 1.1;
        utterance.onend = function () { duckBgm(false); };
        utterance.onerror = function () { duckBgm(false); };
        speechSynthesis.speak(utterance);
    }, 50);
}

function setMessage(text, voice) {
    $('#ai-message').text(text);
    if (voice) speak(text);
}

function loadHistory() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function saveHistory(entry) {
    const history = loadHistory();
    history.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)));
    const best = Number(localStorage.getItem(BEST_KEY) || 0);
    if (entry.score > best) {
        localStorage.setItem(BEST_KEY, String(entry.score));
    }
    renderBest();
}

function renderBest() {
    $('#best-score').text(Number(localStorage.getItem(BEST_KEY) || 0).toLocaleString());
}

function renderHistory() {
    const tbody = $('#history-table tbody');
    tbody.empty();
    const mine = loadHistory().filter(item => item.name === userName);
    if (!mine.length) {
        tbody.append('<tr><td colspan="4" class="empty-history">아직 기록이 없어요. 한 판 해볼까요?</td></tr>');
        return;
    }
    mine.forEach(item => {
        tbody.append(
            `<tr><td>${item.date}</td><td>${item.score.toLocaleString()}</td><td>${item.level}</td><td>${item.lines}</td></tr>`
        );
    });
}

function sizeCanvases() {
    const section = document.querySelector('.board-section');
    if (!section) return;
    const maxH = section.clientHeight - 8;
    const maxW = Math.min(section.clientWidth - 8, 360);
    const cell = Math.floor(Math.min(maxW / 10, maxH / 20));
    const width = cell * 10;
    const height = cell * 20;
    boardCanvas.width = width;
    boardCanvas.height = height;
    boardCanvas.style.width = width + 'px';
    boardCanvas.style.height = height + 'px';

    const mini = Math.max(18, Math.floor(cell * 0.72));
    holdCanvas.width = mini * 4;
    holdCanvas.height = mini * 4;
    nextCanvas.width = mini * 4;
    nextCanvas.height = mini * 12;
}

function drawBlock(ctx, x, y, size, color, ghost) {
    const pad = Math.max(1, Math.floor(size * 0.08));
    ctx.globalAlpha = ghost ? 0.28 : 1;
    ctx.fillStyle = color;
    ctx.fillRect(x + pad, y + pad, size - pad * 2, size - pad * 2);
    if (!ghost) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x + pad, y + pad, size - pad * 2, Math.max(2, size * 0.22));
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x + pad, y + size - pad - Math.max(2, size * 0.16), size - pad * 2, Math.max(2, size * 0.16));
    }
    ctx.globalAlpha = 1;
}

function drawBoard(state) {
    const ctx = boardCtx;
    const w = boardCanvas.width;
    const h = boardCanvas.height;
    const cell = w / state.cols;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1a2744';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let x = 0; x <= state.cols; x++) {
        ctx.beginPath();
        ctx.moveTo(x * cell, 0);
        ctx.lineTo(x * cell, h);
        ctx.stroke();
    }
    for (let y = 0; y <= state.rows; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * cell);
        ctx.lineTo(w, y * cell);
        ctx.stroke();
    }

    if (!state.board || state.board.length !== state.rows) return;

    for (let y = 0; y < state.rows; y++) {
        for (let x = 0; x < state.cols; x++) {
            const type = state.board[y][x];
            if (type) drawBlock(ctx, x * cell, y * cell, cell, state.colors[type], false);
        }
    }

    if (state.current) {
        const piece = state.current;
        const matrix = state.shapes[piece.type][piece.rot];
        for (let r = 0; r < matrix.length; r++) {
            for (let c = 0; c < matrix[r].length; c++) {
                if (!matrix[r][c]) continue;
                const gx = (piece.x + c) * cell;
                const gy = (state.ghostY + r) * cell;
                const px = (piece.x + c) * cell;
                const py = (piece.y + r) * cell;
                if (state.ghostY + r >= 0) drawBlock(ctx, gx, gy, cell, state.colors[piece.type], true);
                if (piece.y + r >= 0) drawBlock(ctx, px, py, cell, state.colors[piece.type], false);
            }
        }
    }
}

function drawMini(ctx, canvas, types, colors, shapes) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f7fbff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const list = Array.isArray(types) ? types : (types ? [types] : []);
    const slotH = canvas.height / Math.max(list.length, 1);
    list.forEach((type, index) => {
        if (!type) return;
        const matrix = shapes[type][0];
        const rows = matrix.length;
        const cols = matrix[0].length;
        const size = Math.floor(Math.min(canvas.width / (cols + 1), slotH / (rows + 1)));
        const offsetX = (canvas.width - cols * size) / 2;
        const offsetY = index * slotH + (slotH - rows * size) / 2;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (matrix[r][c]) {
                    drawBlock(ctx, offsetX + c * size, offsetY + r * size, size, colors[type], false);
                }
            }
        }
    });
}

function updateHud(state) {
    $('#game-status').text('점수 ' + state.score.toLocaleString());
    $('#piece-count').text('레벨 ' + state.level + ' · 줄 ' + state.lines);
}

function showOverlay(title, text, actionLabel, visible) {
    $('#overlay-title').text(title);
    $('#overlay-text').text(text);
    $('#btn-overlay-action').text(actionLabel || '').toggle(Boolean(actionLabel));
    $('#game-overlay').toggleClass('hidden', !visible);
}

function render(state) {
    if (!state) return;
    drawBoard(state);
    drawMini(holdCtx, holdCanvas, state.holdType, state.colors, state.shapes);
    drawMini(nextCtx, nextCanvas, state.queue, state.colors, state.shapes);
    updateHud(state);
}

function loop(ts) {
    const state = Tetris.tick(ts);
    render(state);
    rafId = requestAnimationFrame(loop);
}

function startGame(options) {
    const difficulty = (options && options.difficulty) || $('#difficulty').val();
    sizeCanvases();
    Tetris.start({ difficulty: difficulty, seed: options && options.seed });
    showOverlay('', '', '', false);
    setIconButton('#btn-pause', '⏸️', '정지');
    playBgm();
    if (!rafId) rafId = requestAnimationFrame(loop);
}

function readName() {
    const name = ($('#username').val() || '').trim();
    if (!name) {
        alert('이름을 알려주세요!');
        return '';
    }
    userName = name;
    return name;
}

function stopRoomRefresh() {
    if (battle.roomTimer) {
        clearInterval(battle.roomTimer);
        battle.roomTimer = null;
    }
}

function renderWaitingRooms(rooms) {
    const list = $('#rooms-list').empty();
    if (!rooms.length) {
        list.append($('<p class="empty-rooms">').text('대기 중인 방이 없어요.'));
        return;
    }
    rooms.forEach(function (room) {
        const when = room.createdAt ? new Date(room.createdAt).toLocaleString('ko-KR', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }) : '';
        const card = $('<button type="button" class="room-card">');
        card.append($('<strong>').text((room.hostName || '친구') + ' 대기 중'));
        card.append($('<span>').text('만든 시간: ' + when));
        card.on('click', function () { joinWaitingRoom(room.code); });
        list.append(card);
    });
}

function loadWaitingRooms() {
    $.getJSON('/api/rooms/waiting')
        .done(renderWaitingRooms)
        .fail(function () {
            $('#battle-status').text('대기방 목록을 불러오지 못했어요.');
        });
}

function openWaitingRooms() {
    stopRoomRefresh();
    $('#login-container').hide();
    $('#waiting-rooms-container').removeClass('panel-hidden');
    $('#battle-status').text('');
    loadWaitingRooms();
    battle.roomTimer = setInterval(loadWaitingRooms, 5000);
}

function joinWaitingRoom(code) {
    $('#battle-status').text('들어가는 중...');
    connectBattle().then(function () {
        sendBattle({ type: 'join', name: userName, code: code });
    }).catch(function () {
        $('#battle-status').text('배틀 연결에 실패했어요.');
    });
}

function showHostLobby() {
    battle.waiting = true;
    stopRoomRefresh();
    $('#login-container').hide();
    $('#waiting-rooms-container').addClass('panel-hidden');
    $('#game-container').removeClass('is-hidden');
    requestFullscreen();
    sizeCanvases();
    showOverlay('대기 중', '친구가 들어올 때까지 기다려 주세요.', '', true);
    setMessage('방을 만들었어요! 친구가 들어올 때까지 기다려 주세요.', true);
}

function setBattleBanner() {
    const banner = $('#battle-banner');
    if (battle.active && battle.opponent) {
        banner.text('VS ' + battle.opponent).removeClass('panel-hidden');
    } else {
        banner.text('').addClass('panel-hidden');
    }
}

function sendBattle(message) {
    if (battle.socket && battle.socket.readyState === WebSocket.OPEN) {
        battle.socket.send(JSON.stringify(message));
    }
}

function closeBattle() {
    battle.leaving = true;
    battle.active = false;
    battle.opponent = '';
    battle.reported = false;
    battle.friendLeft = false;
    battle.waiting = false;
    stopRoomRefresh();
    if (battle.socket) {
        battle.socket.close();
        battle.socket = null;
    }
    setBattleBanner();
}

function enterBattleGame(message) {
    battle.active = true;
    battle.opponent = message.opponent || '친구';
    battle.reported = false;
    battle.friendLeft = false;
    battle.waiting = false;
    stopRoomRefresh();
    $('#waiting-rooms-container').addClass('panel-hidden');
    $('#login-container').hide();
    $('#game-container').removeClass('is-hidden');
    setBattleBanner();
    requestFullscreen();
    startGame({ difficulty: message.difficulty, seed: message.seed });
    setMessage(battle.opponent + '와 배틀 시작! 줄을 없애서 방해해 보자!', true);
}

function onBattleMessage(event) {
    let message;
    try {
        message = JSON.parse(event.data);
    } catch (e) {
        return;
    }
    if (message.type === 'waiting') {
        showHostLobby();
        return;
    }
    if (message.type === 'error') {
        $('#battle-status').text(message.message || '다시 시도해 주세요.');
        if ($('#waiting-rooms-container').is(':visible')) loadWaitingRooms();
        return;
    }
    if (message.type === 'start') {
        enterBattleGame(message);
        return;
    }
    if (message.type === 'attack') {
        Tetris.addGarbage(message.lines);
        return;
    }
    if (message.type === 'win') {
        if (battle.reported) return;
        battle.reported = true;
        Tetris.finish();
        const left = message.reason === 'leave';
        battle.friendLeft = left;
        showOverlay(
            '이겼다!',
            left ? '친구가 나갔어요.' : battle.opponent + '의 칸이 꽉 찼어!',
            left ? '나가기' : '한 판 더',
            true
        );
        pauseBgm();
        setMessage(left ? '친구가 나갔어. 네가 이겼어!' : '이겼어! 정말 대단해!', true);
        return;
    }
    if (message.type === 'rematchAsk') {
        setMessage(battle.opponent + '가 한 판 더 하자고 해요!', true);
        return;
    }
    if (message.type === 'rematchWait') {
        setMessage('친구가 준비되면 다시 시작해요.', false);
    }
}

function connectBattle() {
    return new Promise((resolve, reject) => {
        if (battle.socket && battle.socket.readyState === WebSocket.OPEN) {
            resolve(battle.socket);
            return;
        }
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(proto + '//' + location.host + '/ws/battle');
        battle.socket = socket;
        socket.onopen = function () { resolve(socket); };
        socket.onerror = function () { reject(); };
        socket.onmessage = onBattleMessage;
        socket.onclose = function () {
            battle.socket = null;
            const leaving = battle.leaving;
            battle.leaving = false;
            if (leaving) return;
            if ($('#waiting-rooms-container').is(':visible') || battle.waiting) {
                $('#battle-status').text('연결이 끊어졌어요. 다시 시도해 주세요.');
                if (battle.waiting) setMessage('연결이 끊어졌어요.', true);
            } else if (battle.active) {
                setMessage('연결이 끊어졌어요.', true);
            }
        };
    });
}

function today() {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + m + '-' + d;
}

function bindRepeat(button, action) {
    let timer = null;
    const start = function (event) {
        event.preventDefault();
        action();
        timer = setInterval(action, 90);
    };
    const stop = function () {
        clearInterval(timer);
        timer = null;
    };
    button.on('mousedown touchstart', start);
    button.on('mouseup mouseleave touchend touchcancel', stop);
}

$(function () {
    boardCanvas = document.getElementById('tetris-board');
    holdCanvas = document.getElementById('hold-canvas');
    nextCanvas = document.getElementById('next-canvas');
    boardCtx = boardCanvas.getContext('2d');
    holdCtx = holdCanvas.getContext('2d');
    nextCtx = nextCanvas.getContext('2d');
    bgm = document.getElementById('bgm-play');
    if (bgm) {
        bgm.loop = true;
        bgm.volume = BGM_VOLUME;
    }
    updateMusicButton();
    renderBest();

    Tetris.on('start', state => {
        if (!battle.active) {
            setMessage(userName + '야, 준비됐지? 블록을 예쁘게 맞춰보자!', true);
        }
        render(state);
    });

    Tetris.on('clear', payload => {
        const cleared = (payload.clearedRows || []).length;
        const messages = {
            1: userName + ', 한 줄 완성! 잘했어!',
            2: '두 줄이야! 정말 멋져!',
            3: '세 줄이나 없앴어! 대단해!',
            4: '테트리스!!! ' + userName + ', 최고야!'
        };
        const attack = battle.active ? (ATTACK_LINES[cleared] || 0) : 0;
        if (attack) {
            sendBattle({ type: 'attack', lines: attack });
            setMessage((messages[cleared] || '줄을 없앴어!') + ' 상대에게 ' + attack + '줄을 보냈어!', true);
        } else {
            setMessage(messages[cleared] || '줄을 없앴어!', true);
        }
    });

    Tetris.on('garbage', payload => {
        setMessage(battle.opponent + '가 ' + payload.attackLines + '줄을 보냈어! 구멍을 노려봐!', true);
    });

    Tetris.on('levelup', state => {
        setMessage('레벨 ' + state.level + '! 조금 더 빨라질 거야. 할 수 있어!', true);
    });

    Tetris.on('pause', () => {
        showOverlay('일시정지', '잠깐 쉬었다가 다시 해보자!', '계속하기', true);
        setIconButton('#btn-pause', '▶️', '계속');
        pauseBgm();
    });

    Tetris.on('resume', () => {
        showOverlay('', '', '', false);
        setIconButton('#btn-pause', '⏸️', '정지');
        playBgm();
        setMessage('다시 시작! 집중해보자!', false);
    });

    Tetris.on('gameover', state => {
        saveHistory({
            name: userName,
            date: today(),
            score: state.score,
            level: state.level,
            lines: state.lines
        });
        setIconButton('#btn-pause', '⏸️', '정지');
        pauseBgm();
        if (battle.active) {
            if (!battle.reported) {
                battle.reported = true;
                sendBattle({ type: 'lose' });
            }
            showOverlay('아쉽다!', battle.opponent + '가 이겼어. 한 판 더 해볼까?', '한 판 더', true);
            setMessage('아쉽지만 정말 잘했어. 한 판 더 해볼까?', true);
            return;
        }
        showOverlay('게임 종료', userName + '의 점수는 ' + state.score.toLocaleString() + '점이야!', '다시 하기', true);
        setMessage('아쉽지만 정말 잘했어. 한 판 더 해볼까?', true);
    });

    $('#btn-start').on('click', function () {
        if (!readName()) return;
        closeBattle();
        $('#login-container').hide();
        $('#game-container').removeClass('is-hidden');
        requestFullscreen();
        startGame();
    });

    $('#btn-battle').on('click', function () {
        if (!readName()) return;
        openWaitingRooms();
    });

    $('#btn-back-to-login').on('click', function () {
        stopRoomRefresh();
        closeBattle();
        $('#waiting-rooms-container').addClass('panel-hidden');
        $('#login-container').show();
    });

    $('#btn-refresh-rooms').on('click', function () {
        loadWaitingRooms();
    });

    $('#btn-create-room').on('click', function () {
        $('#battle-status').text('방을 만드는 중...');
        connectBattle().then(function () {
            sendBattle({ type: 'create', name: userName, difficulty: $('#difficulty').val() });
        }).catch(function () {
            $('#battle-status').text('배틀 연결에 실패했어요.');
        });
    });

    $('#username').on('keydown', function (event) {
        if (event.key === 'Enter') $('#btn-start').click();
    });

    $('#btn-pause').on('click', function () {
        if (battle.waiting) {
            setMessage('친구가 들어올 때까지 기다려 주세요.', false);
            return;
        }
        if (battle.active) {
            setMessage('배틀 중에는 잠깐 멈출 수 없어요.', false);
            return;
        }
        const state = Tetris.snapshot();
        if (state.gameOver) return;
        Tetris.togglePause();
    });

    $('#btn-new-game, #btn-overlay-action').on('click', function () {
        const state = Tetris.snapshot();
        if (battle.waiting) {
            setMessage('친구가 들어올 때까지 기다려 주세요.', false);
            return;
        }
        if (battle.active) {
            if (battle.friendLeft) {
                $('#btn-logout').click();
                return;
            }
            sendBattle({ type: 'rematch' });
            setMessage('친구가 준비되면 다시 시작해요.', false);
            return;
        }
        if (state.paused && !state.gameOver && this.id === 'btn-overlay-action') {
            Tetris.resume();
            return;
        }
        startGame();
    });

    $('#btn-logout').on('click', function () {
        Tetris.pause();
        stopBgm();
        closeBattle();
        $('#waiting-rooms-container').addClass('panel-hidden');
        $('#game-container').addClass('is-hidden');
        $('#login-container').show();
        showOverlay('', '', '', false);
    });

    $('#btn-music').on('click', function () {
        const nextMuted = !isMusicMuted();
        localStorage.setItem(MUSIC_KEY, nextMuted ? '1' : '0');
        updateMusicButton();
        if (nextMuted) {
            pauseBgm();
        } else if ($('#game-container').is(':visible') && !Tetris.snapshot().paused) {
            playBgm();
        }
    });

    $('#btn-history, .close').on('click', function () {
        if (this.id === 'btn-history') {
            renderHistory();
            $('#history-modal').show();
        } else {
            $('#history-modal').hide();
        }
    });

    $(window).on('click', function (event) {
        if (event.target.id === 'history-modal') $('#history-modal').hide();
    });

    $(window).on('keydown', function (event) {
        if ($('#login-container').is(':visible')) return;
        const keys = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'z', 'Z', 'x', 'X', 'c', 'C', 'p', 'P', 'Escape'];
        if (keys.includes(event.key)) event.preventDefault();
        if (event.key === 'ArrowLeft') Tetris.move(-1, 0);
        if (event.key === 'ArrowRight') Tetris.move(1, 0);
        if (event.key === 'ArrowDown') Tetris.softDrop();
        if (event.key === 'ArrowUp' || event.key === 'x' || event.key === 'X') Tetris.rotate(1);
        if (event.key === 'z' || event.key === 'Z') Tetris.rotate(-1);
        if (event.key === ' ') Tetris.hardDrop();
        if (event.key === 'c' || event.key === 'C') Tetris.hold();
        if (event.key === 'p' || event.key === 'P' || event.key === 'Escape') {
            if (battle.active || battle.waiting) return;
            const state = Tetris.snapshot();
            if (!state.gameOver) Tetris.togglePause();
        }
    });

    bindRepeat($('#btn-left'), () => Tetris.move(-1, 0));
    bindRepeat($('#btn-right'), () => Tetris.move(1, 0));
    bindRepeat($('#btn-soft'), () => Tetris.softDrop());
    $('#btn-rotate').on('click', () => Tetris.rotate(1));
    $('#btn-hard').on('click', () => Tetris.hardDrop());
    $('#btn-hold').on('click', () => Tetris.hold());

    $(window).on('resize', function () {
        sizeCanvases();
        render(Tetris.snapshot());
    });
});
