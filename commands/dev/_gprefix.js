const fs = require("fs");
const path = require("path");
const settings = require("../../util/settings.json");
const logger = require("../../logger.js");
//
module.exports.run = async (bot, message, args, funcs, prefix) => {
    if (!settings.devs.includes(message.author.id)) {
        return message.channel.send("You don't have permission to use this command.");
    }

    const newPrefix = args[0];
    if (!newPrefix || newPrefix.length !== 1) {
         return message.channel.send(`Please provide a valid prefix (1 character). Example: **${prefix}_gprefix ;**`);
    }

    settings.prefix = newPrefix;

    fs.writeFile(path.join(__dirname, "../../util/settings.json"), JSON.stringify(settings, null, 4), err => {
        if (err) {
            logger.error(err);
            return message.channel.send("An error occurred while updating the prefix.");
        }
        message.channel.send(`Prefix successfully updated to \`${newPrefix}\``);
    });
};

module.exports.help = {
    name: "_gprefix",
    dev: true,
    aliases: ["_gp"]
};
