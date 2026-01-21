const { Worker } = require('worker_threads');
const path = require('path');
const logger = require('../logger.js');

const LIMITS = {
    stats: 2,
    connect4: 4
};

const WORKER_PATHS = {
    stats: path.join(__dirname, '..', 'workers', 'statsGraphWorker.js'),
    connect4: path.join(__dirname, '..', 'workers', 'connect4Worker.js')
};

const queues = {
    stats: [],
    connect4: []
};

const active = {
    stats: 0,
    connect4: 0
};

function execute(type, data, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const task = { type, data, timeout, resolve, reject };
        queues[type].push(task);
        processQueue(type);
    });
}

function processQueue(type) {
    if (active[type] >= LIMITS[type]) return;
    if (queues[type].length === 0) return;

    const task = queues[type].shift();
    active[type]++;

    const workerPath = WORKER_PATHS[type];
    let worker;
    let timeoutId;
    let finished = false;

    try {
        worker = new Worker(workerPath, { workerData: task.data });
    } catch (err) {
        active[type]--;
        task.reject(new Error(`Failed to spawn worker: ${err.message}`));
        setImmediate(() => processQueue(type));
        return;
    }

    const cleanup = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        active[type]--;
        setImmediate(() => processQueue(type));
    };

    timeoutId = setTimeout(() => {
        if (!finished) {
            logger.warn(`[WorkerPool] ${type} worker timed out after ${task.timeout}ms`);
            worker.terminate();
            cleanup();
            task.reject(new Error('Worker timeout'));
        }
    }, task.timeout);

    worker.on('message', (result) => {
        cleanup();
        if (result.error) {
            task.reject(new Error(result.error));
        } else {
            task.resolve(result.data);
        }
    });

    worker.on('error', (err) => {
        logger.error(`[WorkerPool] ${type} worker error:`, err);
        cleanup();
        task.reject(err);
    });

    worker.on('exit', (code) => {
        if (!finished && code !== 0) {
            cleanup();
            task.reject(new Error(`Worker exited with code ${code}`));
        }
    });
}

function getStatus() {
    return {
        stats: {
            active: active.stats,
            queued: queues.stats.length,
            limit: LIMITS.stats
        },
        connect4: {
            active: active.connect4,
            queued: queues.connect4.length,
            limit: LIMITS.connect4
        }
    };
}

module.exports = {
    execute,
    getStatus,
    LIMITS
};


// contributors: @relentiousdragon
