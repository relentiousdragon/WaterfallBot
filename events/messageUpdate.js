const { Events, MessageFlags } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
//
module.exports = {
    name: Events.MessageUpdate,
    async execute(bot, oldMessage, newMessage) {
        try {
            if (newMessage.author?.id === bot.user.id) return;

            const isComponentsV2 = newMessage.flags?.has(MessageFlags.IsComponentsV2) ||
                newMessage.flags?.has(1 << 15) ||
                (newMessage.flags?.bitfield & 32768) !== 0;

            const contentChanged = oldMessage.content !== newMessage.content;
            const embedsChanged = oldMessage.embeds?.length !== newMessage.embeds?.length;
            const componentsChanged = oldMessage.components?.length !== newMessage.components?.length;

            if (!contentChanged && !embedsChanged && !componentsChanged && !isComponentsV2) return;

            if (!oldMessage.content && (!oldMessage.embeds || oldMessage.embeds.length === 0) &&
                (!oldMessage.components || oldMessage.components.length === 0) && !isComponentsV2) return;

            const dedupKey = `msgedit:${newMessage.guild?.id}:${newMessage.id}`;
            await modLog.logEvent(bot, newMessage.guild.id, 'messageEdit', {
                oldMessage: oldMessage,
                newMessage: newMessage,
                isComponentsV2: isComponentsV2
            }, dedupKey);
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging message edit event: ${error.message}`, error);
            }
        }
    }
};
