const mongoose = require("mongoose");
require("dotenv").config();
const logger = require("./logger.js");

const MAX_RETRIES = 10;
const RETRY_DELAY = 3000;

let retries = 0;
let isConnectedBefore = false;
let isShuttingDown = false;

async function close() {
    isShuttingDown = true;
    try {
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

            try {
                console.log(`Attempting MongoDB connection... (attempt ${retries + 1}/${MAX_RETRIES})`);

                await mongoose.connect(process.env.MONGO_URI, {
                    autoIndex: false,
                    maxPoolSize: 10,
                    serverSelectionTimeoutMS: 5000,
                    socketTimeoutMS: 45000,
                });

                console.log("\x1b[32m%s\x1b[0m", "Mongoose connection established.");
                logger.alertSync("Mongoose connection established.", "SUCCESS");

                isConnectedBefore = true;
                retries = 0;

            } catch (err) {
                if (isShuttingDown) return;

                retries++;

                console.error("\x1b[31m%s\x1b[0m", `MongoDB connection error (${retries}/${MAX_RETRIES}): ${err.message}`);

                if (retries >= MAX_RETRIES) {
                    console.error("\x1b[31m%s\x1b[0m", "Max retry attempts reached. Exiting process.");
                    await logger.alertSync("[MONGOOSE] Max connection retry attempts reached. Exiting process.", "FATAL");
                    process.exit(1);
                }

                console.log(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
                setTimeout(connectWithRetry, RETRY_DELAY);
            }
        }

        await connectWithRetry();

        mongoose.connection.on("error", (err) => {
            console.error("\x1b[31m%s\x1b[0m", `Mongoose error: ${err.message}`);
        });

        mongoose.connection.on("disconnected", () => {
            if (isShuttingDown) {
                console.log("\x1b[36m%s\x1b[0m", "Mongoose disconnected (shutdown in progress)");
                return;
            }

            console.warn("\x1b[33m%s\x1b[0m", "Mongoose disconnected.");
            logger.alertSync("Mongoose disconnected.", "WARN");

            if (!isConnectedBefore) return;

            console.log("Attempting reconnection...");
            connectWithRetry();
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