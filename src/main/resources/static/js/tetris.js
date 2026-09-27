const Tetris = (function () {
    const COLS = 10;
    const ROWS = 20;
    const COLORS = {
        I: '#4fd1c5',
        O: '#f6e05e',
        T: '#b794f4',
        S: '#68d391',
        Z: '#fc8181',
        J: '#63b3ed',
        L: '#f6ad55',
        G: '#94a3b8'
    };
    const SHAPES = {
        I: [
            [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
            [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]],
            [[0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0]],
            [[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]]
        ],
        O: [
            [[1, 1], [1, 1]],
            [[1, 1], [1, 1]],
            [[1, 1], [1, 1]],
            [[1, 1], [1, 1]]
        ],
        T: [
            [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 0], [0, 1, 1], [0, 1, 0]],
            [[0, 0, 0], [1, 1, 1], [0, 1, 0]],
            [[0, 1, 0], [1, 1, 0], [0, 1, 0]]
        ],
        S: [
            [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
            [[0, 1, 0], [0, 1, 1], [0, 0, 1]],
            [[0, 0, 0], [0, 1, 1], [1, 1, 0]],
            [[1, 0, 0], [1, 1, 0], [0, 1, 0]]
        ],
        Z: [
            [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
            [[0, 0, 1], [0, 1, 1], [0, 1, 0]],
            [[0, 0, 0], [1, 1, 0], [0, 1, 1]],
            [[0, 1, 0], [1, 1, 0], [1, 0, 0]]
        ],
        J: [
            [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 1], [0, 1, 0], [0, 1, 0]],
            [[0, 0, 0], [1, 1, 1], [0, 0, 1]],
            [[0, 1, 0], [0, 1, 0], [1, 1, 0]]
        ],
        L: [
            [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
            [[0, 1, 0], [0, 1, 0], [0, 1, 1]],
            [[0, 0, 0], [1, 1, 1], [1, 0, 0]],
            [[1, 1, 0], [0, 1, 0], [0, 1, 0]]
        ]
    };
    const TYPES = Object.keys(SHAPES);
    const LINE_SCORES = [0, 100, 300, 500, 800];
    const DIFFICULTY = {
        easy: { gravity: 1000, lock: 700, startLevel: 1 },
        normal: { gravity: 800, lock: 520, startLevel: 1 },
        hard: { gravity: 420, lock: 420, startLevel: 3 },
        master: { gravity: 180, lock: 320, startLevel: 6 }
    };

    const listeners = {};
    let board = [];
    let current = null;
    let holdType = null;
    let canHold = true;
    let bag = [];
    let queue = [];
    let score = 0;
    let lines = 0;
    let level = 1;
    let difficulty = 'normal';
    let running = false;
    let paused = false;
    let gameOver = false;
    let dropAcc = 0;
    let lastTs = 0;
    let lockAcc = 0;
    let clearing = false;
    let lastMove = 0;
    let rng = Math.random;
    let pendingGarbage = 0;

    function emit(event, payload) {
        (listeners[event] || []).forEach(fn => fn(payload));
    }

    function on(event, fn) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
    }

    function emptyBoard() {
        return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    }

    function refillBag() {
        const next = TYPES.slice();
        for (let i = next.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [next[i], next[j]] = [next[j], next[i]];
        }
        bag = bag.concat(next);
    }

    function nextType() {
        if (bag.length < 7) refillBag();
        return bag.shift();
    }

    function fillQueue() {
        while (queue.length < 3) {
            queue.push(nextType());
        }
    }

    function spawnOffset(type) {
        return type === 'I' ? { x: 3, y: -1 } : { x: 3, y: -1 };
    }

    function createPiece(type) {
        const pos = spawnOffset(type);
        return { type, rot: 0, x: pos.x, y: pos.y };
    }

    function cellsOf(piece, ox, oy, rot) {
        const matrix = SHAPES[piece.type][rot === undefined ? piece.rot : rot];
        const cells = [];
        for (let r = 0; r < matrix.length; r++) {
            for (let c = 0; c < matrix[r].length; c++) {
                if (matrix[r][c]) {
                    cells.push({ x: (ox === undefined ? piece.x : ox) + c, y: (oy === undefined ? piece.y : oy) + r });
                }
            }
        }
        return cells;
    }

    function collides(piece, ox, oy, rot) {
        return cellsOf(piece, ox, oy, rot).some(cell => {
            if (cell.x < 0 || cell.x >= COLS || cell.y >= ROWS) return true;
            if (cell.y < 0) return false;
            return Boolean(board[cell.y][cell.x]);
        });
    }

    function spawn() {
        fillQueue();
        current = createPiece(queue.shift());
        fillQueue();
        canHold = true;
        lockAcc = 0;
        if (collides(current)) {
            running = false;
            gameOver = true;
            emit('gameover', snapshot());
            return false;
        }
        emit('change', snapshot());
        return true;
    }

    function gravityMs() {
        const base = DIFFICULTY[difficulty].gravity;
        return Math.max(80, base - (level - 1) * 55);
    }

    function lockMs() {
        return DIFFICULTY[difficulty].lock;
    }

    function merge() {
        cellsOf(current).forEach(cell => {
            if (cell.y >= 0 && cell.y < ROWS) {
                board[cell.y][cell.x] = current.type;
            }
        });
    }

    function fullRows() {
        const rows = [];
        for (let y = 0; y < ROWS; y++) {
            if (board[y].every(Boolean)) rows.push(y);
        }
        return rows;
    }

    function clearRows(rows) {
        rows.sort((a, b) => a - b).forEach(y => {
            board.splice(y, 1);
            board.unshift(Array(COLS).fill(null));
        });
    }

    function addScore(cleared, dropped) {
        score += LINE_SCORES[cleared] * level;
        score += dropped;
        lines += cleared;
        const nextLevel = DIFFICULTY[difficulty].startLevel + Math.floor(lines / 10);
        if (nextLevel > level) {
            level = nextLevel;
            emit('levelup', snapshot());
        }
    }

    function lockPiece() {
        merge();
        const rows = fullRows();
        if (rows.length) {
            clearing = true;
            emit('clear', { ...snapshot(), clearedRows: rows });
            setTimeout(() => {
                clearRows(rows);
                addScore(rows.length, 0);
                clearing = false;
                if (flushGarbage()) return;
                spawn();
            }, 180);
        } else {
            spawn();
        }
    }

    function tryMove(dx, dy) {
        if (!current || !running || paused || clearing || gameOver) return false;
        const nx = current.x + dx;
        const ny = current.y + dy;
        if (collides(current, nx, ny)) return false;
        current.x = nx;
        current.y = ny;
        lastMove = Date.now();
        if (dy > 0) lockAcc = 0;
        emit('change', snapshot());
        return true;
    }

    function rotate(dir) {
        if (!current || !running || paused || clearing || gameOver) return false;
        const nextRot = (current.rot + dir + 4) % 4;
        const kicks = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [-1, -1], [1, -1]];
        for (const [kx, ky] of kicks) {
            if (!collides(current, current.x + kx, current.y + ky, nextRot)) {
                current.x += kx;
                current.y += ky;
                current.rot = nextRot;
                lockAcc = 0;
                lastMove = Date.now();
                emit('change', snapshot());
                return true;
            }
        }
        return false;
    }

    function softDrop() {
        if (tryMove(0, 1)) {
            score += 1;
            emit('change', snapshot());
            return true;
        }
        return false;
    }

    function hardDrop() {
        if (!current || !running || paused || clearing || gameOver) return 0;
        let dropped = 0;
        while (!collides(current, current.x, current.y + 1)) {
            current.y += 1;
            dropped += 1;
        }
        score += dropped * 2;
        lockPiece();
        emit('change', snapshot());
        return dropped;
    }

    function hold() {
        if (!current || !running || paused || clearing || gameOver || !canHold) return false;
        const swapping = holdType;
        holdType = current.type;
        canHold = false;
        current = swapping ? createPiece(swapping) : createPiece(queue.shift());
        fillQueue();
        if (collides(current)) {
            running = false;
            gameOver = true;
            emit('gameover', snapshot());
            return false;
        }
        emit('change', snapshot());
        return true;
    }

    function ghostY() {
        if (!current) return 0;
        let y = current.y;
        while (!collides(current, current.x, y + 1)) y += 1;
        return y;
    }

    function snapshot() {
        return {
            board,
            current,
            ghostY: current ? ghostY() : 0,
            holdType,
            queue: queue.slice(),
            score,
            lines,
            level,
            running,
            paused,
            gameOver,
            canHold,
            colors: COLORS,
            shapes: SHAPES,
            cols: COLS,
            rows: ROWS
        };
    }

    function setRng(seed) {
        if (seed === undefined || seed === null || seed === '') {
            rng = Math.random;
            return;
        }
        let state = Number(seed) >>> 0;
        rng = function () {
            state = (state + 0x6D2B79F5) >>> 0;
            let t = Math.imul(state ^ (state >>> 15), 1 | state);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function flushGarbage() {
        if (!pendingGarbage || !running || gameOver) return false;
        const count = pendingGarbage;
        pendingGarbage = 0;
        for (let i = 0; i < count; i++) {
            if (board[0].some(Boolean)) {
                running = false;
                gameOver = true;
                emit('gameover', snapshot());
                return true;
            }
            board.shift();
            const hole = Math.floor(Math.random() * COLS);
            const row = Array.from({ length: COLS }, (_, x) => (x === hole ? null : 'G'));
            board.push(row);
        }
        if (current) {
            let steps = 0;
            while (collides(current) && steps < ROWS) {
                current.y -= 1;
                steps += 1;
            }
            if (collides(current)) {
                running = false;
                gameOver = true;
                emit('gameover', snapshot());
                return true;
            }
        }
        emit('garbage', { ...snapshot(), attackLines: count });
        emit('change', snapshot());
        return false;
    }

    function addGarbage(count) {
        const lines = Math.max(0, Math.min(8, count | 0));
        if (!lines || !running || gameOver) return;
        pendingGarbage += lines;
        if (!clearing) flushGarbage();
    }

    function finish() {
        running = false;
        gameOver = true;
        paused = false;
        pendingGarbage = 0;
        emit('change', snapshot());
    }

    function start(options) {
        difficulty = (options && options.difficulty) || 'normal';
        setRng(options && options.seed);
        pendingGarbage = 0;
        board = emptyBoard();
        holdType = null;
        canHold = true;
        bag = [];
        queue = [];
        score = 0;
        lines = 0;
        level = DIFFICULTY[difficulty].startLevel;
        running = true;
        paused = false;
        gameOver = false;
        dropAcc = 0;
        lockAcc = 0;
        lastTs = 0;
        clearing = false;
        fillQueue();
        spawn();
        emit('start', snapshot());
    }

    function pause() {
        if (!running || gameOver) return;
        paused = true;
        emit('pause', snapshot());
    }

    function resume() {
        if (!running || gameOver) return;
        paused = false;
        lastTs = 0;
        emit('resume', snapshot());
    }

    function togglePause() {
        if (paused) resume();
        else pause();
    }

    function tick(ts) {
        if (!running || paused || gameOver || clearing || !current) {
            lastTs = ts;
            return snapshot();
        }
        if (!lastTs) lastTs = ts;
        const delta = ts - lastTs;
        lastTs = ts;
        dropAcc += delta;
        if (collides(current, current.x, current.y + 1)) {
            lockAcc += delta;
            if (lockAcc >= lockMs()) {
                lockPiece();
                dropAcc = 0;
            }
        } else if (dropAcc >= gravityMs()) {
            tryMove(0, 1);
            dropAcc = 0;
        }
        return snapshot();
    }

    return {
        on,
        start,
        pause,
        resume,
        togglePause,
        move: tryMove,
        rotate,
        softDrop,
        hardDrop,
        hold,
        addGarbage,
        finish,
        tick,
        snapshot,
        colors: COLORS,
        shapes: SHAPES
    };
})();
