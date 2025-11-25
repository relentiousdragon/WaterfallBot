const { Server } = require("../../schemas/servers.js"); 
const { PermissionsBitField } = require("discord.js"); 
const logger = require("../../logger.js");
//
module.exports.run = async (bot, message, args, funcs, prefix) => {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return message.channel.send("You don't have permission to use this command.");
    }

    const newPrefix = args[0];
    if (!newPrefix || newPrefix.length !== 1) {
        return message.channel.send(`Please provide a valid prefix (1 character). Example: **${prefix}prefix ;**`);
    }

    try {
        let serverData = await Server.findOne({ serverID: message.guild.id });

        if (!serverData) {
            serverData = new Server({
                serverID: message.guild.id,
                prefix: newPrefix
            });
        } else {
            serverData.prefix = newPrefix;
        }

        await serverData.save();
        message.channel.send(`Server Prefix successfully updated to \`${newPrefix}\``);
    } catch (err) {
        logger.error("Error saving server prefix:", err);
        message.channel.send("An error occurred while updating the prefix.");
    }
};

module.exports.help = {
    dev: 'false',
    name: "prefix",
    aliases: ["p"]
};
