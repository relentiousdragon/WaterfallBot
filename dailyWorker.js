const moment = require("moment");
//
module.exports = {
    send: async (bot) => {
        const Warns = require("./schemas/warns.js");
        const logger = require("./logger.js");

        try {
            const oneWeekAgo = moment().subtract(7, 'days').toDate();

            const result = await Warns.updateMany(
                { "warns.timestamp": { $lt: oneWeekAgo } },
                { $pull: { warns: { timestamp: { $lt: oneWeekAgo } } } }
            );

            if (result.modifiedCount > 0) {
                logger.info(`[DailyWorker] Cleaned up expired warns from ${result.modifiedCount} users.`);
            }
        } catch (error) {
            logger.error("[DailyWorker] Failed to cleanup warns:", error);
        }
    }
};
