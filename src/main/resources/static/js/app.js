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
    $('#btn-overlay-action').text(actionLabel);
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

function startGame() {
    const difficulty = $('#difficulty').val();
    sizeCanvases();
    Tetris.start({ difficulty });
    showOverlay('', '', '', false);
    setIconButton('#btn-pause', '⏸️', '정지');
    playBgm();
    if (!rafId) rafId = requestAnimationFrame(loop);
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
        setMessage(userName + '야, 준비됐지? 블록을 예쁘게 맞춰보자!', true);
        render(state);
    });

    Tetris.on('clear', payload => {
        const messages = {
            1: userName + ', 한 줄 완성! 잘했어!',
            2: '두 줄이야! 정말 멋져!',
            3: '세 줄이나 없앴어! 대단해!',
            4: '테트리스!!! ' + userName + ', 최고야!'
        };
        setMessage(messages[payload.rows.length] || '줄을 없앴어!', true);
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
        showOverlay('게임 종료', userName + '의 점수는 ' + state.score.toLocaleString() + '점이야!', '다시 하기', true);
        setIconButton('#btn-pause', '⏸️', '정지');
        pauseBgm();
        setMessage('아쉽지만 정말 잘했어. 한 판 더 해볼까?', true);
    });

    $('#btn-start').on('click', function () {
        const name = ($('#username').val() || '').trim();
        if (!name) {
            alert('이름을 알려주세요!');
            return;
        }
        userName = name;
        $('#login-container').hide();
        $('#game-container').css('display', 'flex');
        requestFullscreen();
        startGame();
    });

    $('#username').on('keydown', function (event) {
        if (event.key === 'Enter') $('#btn-start').click();
    });

    $('#btn-pause').on('click', function () {
        const state = Tetris.snapshot();
        if (state.gameOver) return;
        Tetris.togglePause();
    });

    $('#btn-new-game, #btn-overlay-action').on('click', function () {
        const state = Tetris.snapshot();
        if (state.paused && !state.gameOver && this.id === 'btn-overlay-action') {
            Tetris.resume();
            return;
        }
        startGame();
    });

    $('#btn-logout').on('click', function () {
        Tetris.pause();
        stopBgm();
        $('#game-container').hide();
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
