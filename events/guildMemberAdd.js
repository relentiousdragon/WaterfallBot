const { Events } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
//
module.exports = {
    name: Events.GuildMemberAdd,
    async execute(bot, member) {
        try {
            await modLog.logEvent(bot, member.guild.id, 'memberJoin', {
                member: member
            });
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging member join event: ${error.message}`, error);
            }
        }
    }
};
