const { ShardingManager } = require("discord.js");
const path = require("path");
require("dotenv").config();
const logger = require("./logger.js");

const shardId = parseInt(process.env.SHARD_ID, 10);
const totalShards = 1;

const manager = new ShardingManager(path.join(__dirname, "index.js"), {
    token: process.env.token,
    totalShards: totalShards,
    shardList: [shardId],
});

let isShuttingDown = false;
//
manager.on("shardCreate", shard => {
    logger.gradient(`Shard ${shard.id} launched`);

    shard.on("ready", () => {
        logger.bigSuccess(`Shard ${shard.id} is READY`);
    });

    shard.on("disconnect", () => {
        logger.warn(`Shard ${shard.id} DISCONNECTED`);
    });

    shard.on("error", error => {
        logger.fatal(`Shard ${shard.id} ERROR: ${error}`);
    });

    shard.on("exit", code => {
        if (!isShuttingDown) {
            logger.fatal(`Shard ${shard.id} EXITED with code ${code}`);
            logger.warn("Respawning shard...");
            manager.spawn({ amount: totalShards, delay: 5000 });
        }
    });
});

manager.spawn({ amount: totalShards, delay: 5000 })
    .then(() => {
        logger.bigSuccess(`Machine handling shard ${shardId} launched`);
    })
    .catch(err => logger.fatal("ShardManager spawn failed: " + err));