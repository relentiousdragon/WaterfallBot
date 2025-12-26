const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const axios = require("axios");
const logger = require("./logger.js");
//
async function deployCommands() {
    const commands = [];
    const globalCommands = [];
    const guildCommands = [];
    const publicCommands = [];

    async function readCommandFiles(dir) {
        const files = await fs.promises.readdir(dir);

        for (const file of files) {
            const filepath = path.join(dir, file);
            const stats = await fs.promises.stat(filepath);

            if (stats.isDirectory()) {
                await readCommandFiles(filepath);
            } else if (stats.isFile() && file.endsWith(".js")) {
                try {
                    const command = require(path.resolve(filepath));

                    const commandJSON = command.data.toJSON();

                    if (command.integration_types) {
                        commandJSON.integration_types = command.integration_types;
                    } else {
                        commandJSON.integration_types = [0];
                    }

                    if (command.contexts) {
                        commandJSON.contexts = command.contexts;
                    } else {
                        commandJSON.contexts = [0, 1, 2];
                    }

                    if (command.explicit === true) {
                        guildCommands.push(commandJSON);
                    } else {
                        globalCommands.push(commandJSON);
                    }

                    if (!command.dev && commandJSON.type === 1) {
                        publicCommands.push({
                            name: commandJSON.name,
                            description: commandJSON.description,
                            type: 1
                        });
                    }

                } catch (err) {
                    logger.error(`Error loading command ${filepath}:`, err);
                }
            }
        }
    }

    await readCommandFiles("./slashCommands");
    await readCommandFiles("./contextCommands");

    const rest = new REST({ version: "10" }).setToken(process.env.token);

    try {
        logger.info("Started refreshing application commands.");

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: globalCommands },
        );

        logger.neon("Successfully reloaded global application commands.");

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, "1440117235401363508"),
            { body: guildCommands },
        );

        logger.neon("Successfully registered explicit commands in guild 1440117235401363508.");

        if (process.env.CANARY !== "true") {
            const dblResponse = await axios.post(
                `https://discordbotlist.com/api/v1/bots/${process.env.CLIENT_ID}/commands`,
                publicCommands,
                {
                    headers: {
                        Authorization: `Bot ${process.env.DBL_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            logger.neon("\x1b[36m%s\x1b[0m", 'Successfully posted commands to discordbotlist.com:', dblResponse.data);
        }
    } catch (error) {
        if (error.response) {
            logger.error(`Error in deployCommands: ${error.message}`);
            logger.error('Response data:', JSON.stringify(error.response.data, null, 2));
            logger.error('Response status:', error.response.status);
        } else {
            logger.error('Error in deployCommands:', error);
        }
    }
}

if (require.main === module) {
    deployCommands();
}

module.exports = { deployCommands };
