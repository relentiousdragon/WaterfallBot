const { Events } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
//
module.exports = {
    name: Events.InviteCreate,
    async execute(bot, invite) {
        try {
            await modLog.logEvent(bot, invite.guild.id, 'inviteCreate', {
                invite: invite
            });
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging invite create event: ${error.message}`, error);
            }
        }
    }
};
