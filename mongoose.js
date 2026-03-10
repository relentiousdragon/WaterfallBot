const mongoose = require("mongoose");
require("dotenv").config();
const logger = require("./logger.js");

const MAX_RETRIES = 10;
const INITIAL_RETRY_DELAY = 3000;
const MAX_RETRY_DELAY = 60000;

let retries = 0;
let isConnectedBefore = false;
let isShuttingDown = false;
let isReconnecting = false;
let reconnectTimeout = null;

async function close() {
    isShuttingDown = true;
    try {
        try {
            const client = mongoose.connection.getClient();
            if (client?.topology?.pools) {
                client.topology.pools.forEach(pool => {
                    if (pool.close) {
                        pool.close({ force: true });
                    }
                });
            }
        } catch (e) {
            //
        }

        await mongoose.connection.close();
        console.log("\x1b[36m%s\x1b[0m", "Mongoose connection closed.");
        await logger.alertSync("Mongoose connection closed.", "INFO");
    } catch (err) {
        console.error("\x1b[31m%s\x1b[0m", `Error closing Mongoose connection: ${err.message}`);
        await logger.alertSync(`Error closing Mongoose connection: ${err.message}`, "WARN");
        throw err;
    }
}
//
module.exports = {
    init: async () => {
        if (!process.env.MONGO_URI) {
            logger.fatal("Missing MONGO_URI in environment variables.");
            process.exit(1);
        }

        async function connectWithRetry() {
            if (isShuttingDown) return;
            
            if (isReconnecting) return;
            
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }
            
            isReconnecting = true;

            try {
                console.log(`Attempting MongoDB connection... (attempt ${retries + 1}/${MAX_RETRIES})`);

                await mongoose.connect(process.env.MONGO_URI, {
                    autoIndex: false,
                    maxPoolSize: 15,
                    minPoolSize: 1,
                    serverSelectionTimeoutMS: 5000,
                    socketTimeoutMS: 15000,
                    maxIdleTimeMS: 60000,
                    serverAPI: { version: '1', strict: true, deprecationErrors: true },
                    tls: true,
                    retryWrites: true,
                    directConnection: false,
                    waitQueueTimeoutMS: 10000,
                });

                console.log("\x1b[32m%s\x1b[0m", "Mongoose connection established.");
                logger.alertSync("Mongoose connection established.", "SUCCESS");

                isConnectedBefore = true;
                retries = 0;
                isReconnecting = false;

            } catch (err) {
                if (isShuttingDown) {
                    isReconnecting = false;
                    return;
                }

                retries++;

                console.error("\x1b[31m%s\x1b[0m", `MongoDB connection error (${retries}/${MAX_RETRIES}): ${err.message}`);

                if (retries >= MAX_RETRIES) {
                    console.error("\x1b[31m%s\x1b[0m", "Max retry attempts reached. Exiting process.");
                    await logger.alertSync("[MONGOOSE] Max connection retry attempts reached. Exiting process.", "FATAL");
                    isReconnecting = false;
                    process.exit(1);
                }

                const delayMs = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, retries - 1), MAX_RETRY_DELAY);
                console.log(`Retrying in ${delayMs / 1000} seconds...`);
                
                isReconnecting = false;
                reconnectTimeout = setTimeout(() => {
                    connectWithRetry();
                }, delayMs);
            }
        }

        await connectWithRetry();

        mongoose.connection.on("error", (err) => {
            console.error("\x1b[31m%s\x1b[0m", `Mongoose error: ${err.message}`);
        });

        setInterval(() => {
            if (mongoose.connection.readyState === 1) {
                try {
                    const client = mongoose.connection.getClient();
                    let poolSize = "unknown";
                    
                    if (client?.topology?.s?.pool?.totalConnectionCount) {
                        poolSize = client.topology.s.pool.totalConnectionCount;
                    } else if (client?.topology?.pools?.has("mongodb")) {
                        poolSize = client.topology.pools.get("mongodb")?.totalConnectionCount || "unknown";
                    } else if (client?.pools) {
                        poolSize = Object.values(client.pools)[0]?.totalConnectionCount || "unknown";
                    } else if (client?.topology?.connectionCount) {
                        poolSize = client.topology.connectionCount;
                    }
                    
                    console.log(`[Mongoose] Pool: ${poolSize} | ready | heap: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
                } catch (e) {
                    console.log(`[Mongoose] Pool: unknown (${e.message}) | ready | heap: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
                }
            }
        }, 300000);

        mongoose.connection.on("disconnected", () => {
            if (isShuttingDown) {
                console.log("\x1b[36m%s\x1b[0m", "Mongoose disconnected (shutdown in progress)");
                return;
            }

            console.warn("\x1b[33m%s\x1b[0m", "Mongoose disconnected.");
            logger.alertSync("Mongoose disconnected.", "WARN");

            try {
                const client = mongoose.connection.getClient();
                if (client?.topology?.pools) {
                    client.topology.pools.forEach(pool => {
                        if (pool.close) {
                            pool.close({ force: true });
                        }
                    });
                }
            } catch (e) {
                //
            }

            if (!isConnectedBefore) return;

            if (!isReconnecting) {
                console.log("Attempting reconnection...");
                connectWithRetry();
            }
        });

        mongoose.connection.on("connected", () => {
            if (isShuttingDown) return;
            console.log("\x1b[32m%s\x1b[0m", "Mongoose reconnected.");
            logger.alertSync("Mongoose reconnected.", "SUCCESS");
        });

        mongoose.connection.on("reconnectFailed", () => {
            if (isShuttingDown) return;
            console.error("\x1b[31m%s\x1b[0m", "Mongoose failed to reconnect permanently.");
            logger.alertSync("Mongoose failed to reconnect permanently.", "FATAL");
        });
    },
    close
};


// contributors: @relentiousdragon
