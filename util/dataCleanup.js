const logger = require('../logger.js');
const { Server } = require('../schemas/servers.js');
const { ServerStats } = require('../schemas/serverStats.js');

async function cleanupPendingDeletions() {
    try {
        const now = new Date();

        const expiredServers = await Server.find({
            pendingDeletion: { $ne: null, $lte: now }
        }).lean();

        if (expiredServers.length === 0) {
            logger.debug('[Cleanup] No pending deletions to process');
            return { deleted: 0 };
        }

        logger.warnAlert(`[Cleanup] Processing ${expiredServers.length} expired server deletions`);

        for (const server of expiredServers) {
            try {
                await ServerStats.deleteOne({ guildId: server.serverID });

                await Server.deleteOne({ serverID: server.serverID });

                logger.warn(`[Cleanup] Deleted data for guild ${server.serverID}`);
            } catch (err) {
                logger.error(`[Cleanup] Failed to delete data for guild ${server.serverID}: ${err.message}`);
            }
        }

        return { deleted: expiredServers.length };
    } catch (error) {
        logger.error(`[Cleanup] Error during cleanup: ${error.message}`);
        return { deleted: 0, error: error.message };
    }
}

async function cancelPendingDeletion(guildId) {
    try {
        await Server.updateOne(
            { serverID: guildId },
            { $unset: { pendingDeletion: '' } }
        );

        await ServerStats.updateOne(
            { guildId: guildId },
            { $unset: { pendingDeletion: '' } }
        );

        logger.warnAlert(`[Cleanup] Cancelled pending deletion for guild ${guildId}`);
    } catch (error) {
        logger.error(`[Cleanup] Error cancelling deletion for guild ${guildId}: ${error.message}`);
    }
}
//
module.exports = {
    cleanupPendingDeletions,
    cancelPendingDeletion
};


// contributors: @relentiousdragon