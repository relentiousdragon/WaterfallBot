const { Events } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
//
module.exports = {
    name: Events.InviteDelete,
    async execute(bot, invite) {
        try {
            await modLog.logEvent(bot, invite.guild.id, 'inviteDelete', {
                invite: invite
            });
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging invite delete event: ${error.message}`, error);
            }
        }
    }
};
