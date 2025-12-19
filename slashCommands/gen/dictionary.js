const { SlashCommandBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const child_process = require('child_process');
const { Readable } = require('stream');
try {
    const ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath;
} catch (e) {
    console.warn("ffmpeg-static is missing! Audio playback will likely fail.");
}

const { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, VoiceConnectionStatus, AudioPlayerStatus, getVoiceConnection, StreamType } = require('@discordjs/voice');
const googleTTS = require('google-tts-api');
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const cooldowns = new Map();
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('dictionary')
        .setNameLocalizations(commandMeta.dictionary.name)
        .setDescription('Look up the definition of an English word')
        .setDescriptionLocalizations(commandMeta.dictionary.description)
        .addStringOption(opt =>
            opt.setName('word')
                .setDescription('The word to define')
                .setDescriptionLocalizations(commandMeta.dictionary.option_word)
                .setRequired(true)
                .setMaxLength(100)
        ),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        const word = interaction.options.getString('word');
        const apiUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;

        const loadingContainer = new ContainerBuilder()
            .setAccentColor(0x0074D9)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://cdn-icons-png.flaticon.com/512/2991/2991148.png'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.bookmark} ${t('commands:dictionary.dictionary_looking_up')}\n-# ${e.loading} ${t('common:loading')}`)
                    )
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent("-# Waterfall")
            );
        await interaction.reply({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

        try {
            const response = await axios.get(apiUrl);
            const data = response.data[0];
            const phonetic = data.phonetic || (data.phonetics && data.phonetics[0]?.text) || '';
            const audio = (data.phonetics && data.phonetics.find(p => p.audio))?.audio;
            const meanings = data.meanings || [];

            let defText = meanings.map(meaning => {
                let defs = meaning.definitions.slice(0, 5).map((def, i) => {
                    let line = `**${i + 1}.** ${def.definition}`;
                    if (def.example) line += `\n> _${def.example}_`;
                    return line;
                }).join('\n\n');
                let syns = meaning.synonyms && meaning.synonyms.length ? `\n> **${t('common:synonyms')}:** ${meaning.synonyms.slice(0, 5).join(', ')}` : '';
                let ants = meaning.antonyms && meaning.antonyms.length ? `\n> **${t('common:antonyms')}:** ${meaning.antonyms.slice(0, 5).join(', ')}` : '';
                return `*${meaning.partOfSpeech}*${syns}${ants}\n${defs}`;
            }).join('\n\n');

            if (!defText) defText = t('commands:dictionary.no_definitions');
            let truncated = false;
            if (defText.length > 3000) {
                defText = defText.slice(0, 2990) + '\n...';
                truncated = true;
            }

            let section;
            const filterQuery = require('./search.js').filterQuery;
            const safeWord = await filterQuery(word);
            const profanityDetected = safeWord !== word;

            if (audio) {
                const pronounceBtn = new ButtonBuilder()
                    .setStyle(ButtonStyle.Primary)
                    .setLabel(t('common:pronunciation'))
                    .setEmoji(funcs.parseEmoji(e.voice_channnel))
                    .setCustomId(`dictionary_pronounce_${encodeURIComponent(word)}_${interaction.user.id}`)
                    .setDisabled(profanityDetected || !interaction.guild);

                section = new SectionBuilder()
                    .setButtonAccessory(pronounceBtn)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`${data.word.length > 30 ? "###" : data.word.length > 23 ? "##" : "#"} ${e.bookmark} ${data.word}${phonetic ? ` (${phonetic})` : ''}`)
                    );
            } else {
                section = new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://cdn-icons-png.flaticon.com/512/2991/2991148.png'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`${data.word.length > 30 ? "###" : data.word.length > 23 ? "##" : "#"} ${e.bookmark} ${data.word}${phonetic ? ` (${phonetic})` : ''}`)
                    );
            }

            const resultContainer = new ContainerBuilder()
                .setAccentColor(0x0074D9)
                .addSectionComponents(section)
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(defText)
                );

            if (truncated) {
                resultContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# ${t('common:truncated_output')}`)
                );
            }

            if (Array.isArray(data.sourceUrls) && data.sourceUrls.length > 0) {
                const sourceButtons = data.sourceUrls.slice(0, 5).map((url, i) =>
                    new ButtonBuilder()
                        .setStyle(ButtonStyle.Link)
                        .setLabel(data.sourceUrls.length === 1 ? t('common:source') : `${t('common:source')} ${i + 1}`)
                        .setURL(url)
                );
                const sourceRow = new ActionRowBuilder().addComponents(...sourceButtons);
                resultContainer.addActionRowComponents(sourceRow);
            }

            let footer = '';
            if (profanityDetected) {
                footer += `-# **${t('common:offensive_warning')}**\n`;
            }
            footer += '-# Waterfall - Dictionary';

            resultContainer.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(footer)
            );

            await interaction.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });

        } catch (err) {
            if (settings.debug == "true") { logger.error(err); }
            let msg = `${t('commands:dictionary.error_not_found')}`;
            const errorContainer = new ContainerBuilder()
                .setAccentColor(0xFF0000)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://cdn-icons-png.flaticon.com/512/2991/2991148.png'))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## ${e.pixel_cross} ${t('common:error_occurred')}`),
                            new TextDisplayBuilder().setContent(msg)
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                ).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent("-# Waterfall - Dictionary")
                );
            await interaction.editReply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
    },
    help: {
        name: "dictionary",
        description: "Look up the definition of an English word",
        category: "General",
        permissions: [],
        botPermissions: [],
        created: 1765448619
    }
};

async function handlePronunciationButton(interaction, settings, logger, t) {
    const customId = interaction.customId;
    const match = customId.match(/^dictionary_pronounce_(.+)_(\d+)$/);
    if (!match) return;

    const word = decodeURIComponent(match[1]);
    const userId = match[2];

    if (interaction.user.id !== userId) {
        await interaction.reply({ content: `${e.pixel_cross} ${t('commands:dictionary.only_command_user')}`, flags: MessageFlags.Ephemeral });
        return;
    }

    const now = Date.now();
    if (cooldowns.has(userId) && now - cooldowns.get(userId) < 13500) {
        await interaction.reply({ content: `${e.pause} ${t('commands:dictionary.wait_cooldown')}`, flags: MessageFlags.Ephemeral });
        return;
    }
    cooldowns.set(userId, now);

    let member;
    try {
        member = await interaction.guild.members.fetch(userId);
    } catch {
        await interaction.reply({ content: `${e.pixel_cross} ${t('commands:dictionary.fetch_member_error')}`, flags: MessageFlags.Ephemeral });
        return;
    }

    const vc = member.voice.channel;
    if (!vc) {
        await interaction.reply({ content: `${e.voice_channnel} ${t('commands:dictionary.voice_channel_required')}`, flags: MessageFlags.Ephemeral });
        return;
    }

    const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
    const botPermissions = vc.permissionsFor(botMember);
    if (!botPermissions.has(PermissionsBitField.Flags.Connect) || !botPermissions.has(PermissionsBitField.Flags.Speak)) {
        await interaction.reply({ content: `${e.pixel_cross} ${t('commands:dictionary.no_permission')}`, flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let connection;
    let player;
    let createdConnection = false;

    try {
        const ttsUrl = googleTTS.getAudioUrl(word, { lang: 'en', slow: false, host: 'https://translate.google.com' });
        if (settings.debug == "true") logger.debug(`TTS URL generated: ${ttsUrl}`);

        if (settings.debug == "true") logger.debug(`Downloading TTS audio...`);
        const response = await axios({
            method: 'get',
            url: ttsUrl,
            responseType: 'arraybuffer',
            timeout: 10000
        });

        if (settings.debug == "true") logger.debug(`TTS audio downloaded (${response.data.length} bytes)`);

        const existing = getVoiceConnection(vc.guild.id);
        if (existing) {
            const existingChannelId = existing.joinConfig && existing.joinConfig.channelId;
            if (existingChannelId && existingChannelId !== vc.id) {
                await interaction.editReply({ content: `${e.pixel_cross} ${t('commands:dictionary.already_in_channel')}` });
                return;
            }
            connection = existing;
        } else {
            if (settings.debug == "true") logger.debug(`Creating new voice connection to channel ${vc.id}`);
            connection = joinVoiceChannel({
                channelId: vc.id,
                guildId: vc.guild.id,
                adapterCreator: vc.guild.voiceAdapterCreator,
                selfDeaf: false
            });
            createdConnection = true;

            connection.on('stateChange', (oldState, newState) => {
                if (settings.debug == "true") logger.debug(`Voice connection state: ${oldState.status} -> ${newState.status}`);
            });

            connection.on('error', error => {
                if (settings.debug == "true") logger.debug(`Voice connection error: ${error.message}`);
                console.error('Voice connection error:', error);
            });
        }

        if (settings.debug == "true") logger.debug(`Checking voice connection state...`);
        const currentState = connection.state.status;
        if (settings.debug == "true") logger.debug(`Current voice state: ${currentState}`);

        if (currentState === VoiceConnectionStatus.Ready) {
            if (settings.debug == "true") logger.debug(`Voice connection already ready`);
        } else {
            if (settings.debug == "true") logger.debug(`Waiting for voice connection to be ready...`);
            try {
                await entersState(connection, VoiceConnectionStatus.Ready, 15000);
                if (settings.debug == "true") logger.debug(`Voice connection ready`);
            } catch (err) {
                if (settings.debug == "true") logger.debug(`Failed to reach Ready state: ${err.message}`);
                await interaction.editReply({ content: `${e.pixel_cross} ${t('commands:dictionary.connection_failed')}`, flags: MessageFlags.Ephemeral });
                return;
            }
        }

        player = createAudioPlayer();

        player.on('error', error => {
            console.error(`Audio Player Error for word "${word}":`, error);
            if (settings.debug == "true") logger.debug(`Audio Player Error: ${error.message}`);
        });

        if (settings.debug == "true") logger.debug(`Creating audio resource...`);

        if (player.state.status !== AudioPlayerStatus.Idle) {
            player.stop();
        }

        const audioBuffer = Buffer.from(response.data);
        const resource = createTTSResource(audioBuffer);

        /*const resource = createAudioResource(Buffer.from(response.data), {
            inputType: StreamType.Arbitrary,
            inlineVolume: true
        }); */

        if (settings.debug == "true") logger.debug(`Subscribing player to connection...`);
        connection.subscribe(player);

        if (settings.debug == "true") logger.debug(`Starting playback...`);
        player.play(resource);

        await interaction.editReply({ content: `${e.voice_channnel} ${t('commands:dictionary.pronunciation_played', { word, channelId: vc.id })}` });

        try {
            if (settings.debug == "true") logger.debug(`Waiting for player to enter Playing state...`);
            await entersState(player, AudioPlayerStatus.Playing, 5000);
            if (settings.debug == "true") logger.debug(`Playback started successfully`);

            if (settings.debug == "true") logger.debug(`Waiting for player to finish...`);
            await entersState(player, AudioPlayerStatus.Idle, 10000);
            if (settings.debug == "true") logger.debug(`Playback completed`);
        } catch (err) {
            console.error("Playback Error:", err);
            if (settings.debug == "true") logger.debug(`Playback state error: ${err.message}`);
            await interaction.followUp({ content: `${e.pixel_warning} ${t('commands:dictionary.playback_interrupted')}`, flags: MessageFlags.Ephemeral });
        }

    } catch (err) {
        console.error("Voice Handler Error:", err);
        if (settings.debug == "true") logger.debug(`Voice Handler Error: ${err.message}`);
        await interaction.editReply({ content: `${e.pixel_cross} ${t('commands:dictionary.audio_error')}`, flags: MessageFlags.Ephemeral });
    } finally {
        if (player) {
            player.stop();
            if (settings.debug == "true") logger.debug(`Player stopped`);
        }
        if (createdConnection && connection) {
            if (settings.debug == "true") logger.debug(`Destroying voice connection after delay`);
            setTimeout(() => {
                try {
                    if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                        if (settings.debug == "true") logger.debug(`Destroying voice connection`);
                        connection.destroy();
                    }
                } catch (err) {
                    if (settings.debug == "true") logger.debug(`Error destroying connection: ${err.message}`);
                }
            }, 1000);
        }
    }
}

function createTTSResource(audioBuffer) {
    const stream = Readable.from(audioBuffer);

    const ffmpeg = child_process.spawn(process.env.FFMPEG_PATH, [
        '-i', 'pipe:0',
        '-af', 'adelay=300|300',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
    ]);

    stream.pipe(ffmpeg.stdin);

    ffmpeg.on('error', (err) => {
        console.error('FFmpeg process error:', err);
    });

    ffmpeg.on('close', (code) => {
        if (code !== 0) console.log(`FFmpeg exited with code ${code}`);
    });

    return createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.Raw
    });
}


module.exports.handlePronunciationButton = handlePronunciationButton;