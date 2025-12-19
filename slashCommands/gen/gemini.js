require("dotenv").config();
const { SlashCommandBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const gemini_key = process.env.GEMINI_API_KEY;
const { filterQuery } = require('./search.js');
const fs = require('fs');
const path = require('path');
const USAGE_FILE = path.join(__dirname, '../../gemini_image_usage.json');
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();

function loadImageUsage() {
    try {
        if (fs.existsSync(USAGE_FILE)) {
            return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
        }
    } catch (e) { logger.error('Failed to load gemini_image_usage.json:', e); }
    return {};
}
function saveImageUsage(data) {
    try {
        fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
    } catch (e) { logger.error('Failed to save gemini_image_usage.json:', e); }
}
let geminiImageUsage = loadImageUsage();
function incrementImageUsage(userId) {
    const today = new Date().toISOString().slice(0, 10);
    if (!geminiImageUsage[userId] || geminiImageUsage[userId].date !== today) {
        geminiImageUsage[userId] = { date: today, count: 1 };
    } else {
        geminiImageUsage[userId].count++;
    }
    saveImageUsage(geminiImageUsage);
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('gemini')
        .setNameLocalizations(commandMeta.gemini.name)
        .setDescription('Ask Google Gemini (AI) a question')
        .setDescriptionLocalizations(commandMeta.gemini.description)
        .addStringOption(opt =>
            opt.setName('prompt').setDescription('Your question or prompt for Gemini AI').setDescriptionLocalizations(commandMeta.gemini.option_prompt).setRequired(true).setMaxLength(500)
        ),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: false,
    beta: true,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        const prompt = interaction.options.getString('prompt');
        const username = interaction.user.username;
        const today = new Date().toISOString().slice(0, 10);
        let usageCount = 0;
        if (geminiImageUsage[interaction.user.id] && geminiImageUsage[interaction.user.id].date === today) {
            usageCount = geminiImageUsage[interaction.user.id].count;
        }
        let refusalBlock = '';
        if (usageCount >= 3) {
            refusalBlock = '***IMPORTANT: The user has reached their daily image generation limit. You MUST NOT generate or return any inline/base64 image, or any external image pretending to be a generated image, even if the user requests it. You MUST reply with the following message as your answer ONLY IF user asks to CREATE AN IMAGE: "I cannot generate any more images for you today, is there anything else you would like me to do?". Only use the thumbnail image link system for the embed.';
        } else {
            refusalBlock = 'If the user prompt specifically requests, describes, or implies an image, you MAY generate and return an inline/base64 image (as base64 or inlineData). Otherwise, DO NOT generate or return any inline/base64 image, and only use the thumbnail image link system for the embed.';
        }

        const member = interaction.guild?.members.cache.get(interaction.user.id);
        let userPermsSummary = "Unknown";

        if (member) {
            const perms = member.permissions;
            if (perms.has(PermissionsBitField.Flags.Administrator)) {
                userPermsSummary = "Administrator";
            } else {
                const importantPerms = [];
                if (perms.has(PermissionsBitField.Flags.ManageMessages)) importantPerms.push("ManageMessages");
                if (perms.has(PermissionsBitField.Flags.ManageGuild)) importantPerms.push("ManageServer");
                if (perms.has(PermissionsBitField.Flags.ManageChannels)) importantPerms.push("ManageChannels");
                if (perms.has(PermissionsBitField.Flags.ModerateMembers)) importantPerms.push("Timeout");
                userPermsSummary = importantPerms.length > 0 ? importantPerms.join(", ") : "No key permissions";
            }
        }

        let emojiList = [];
        if (interaction.guild) {
            try {
                const emojis = await interaction.guild.emojis.fetch();
                if (emojis.size > 0) {
                    const shuffled = [...emojis.values()].sort(() => Math.random() - 0.5);
                    emojiList = shuffled.slice(0, 10).map(e => {
                        return e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`;
                    });
                }
            } catch (err) {
                logger.error("[Emoji Fetch Error]", err.message);
            }
        }

        const user = `- User ID: ${interaction.user.id}\n
        - User Permissions: ${userPermsSummary}\n
        - Message received at: ${new Date().toISOString()}\n
        ${emojiList.length > 0 ? `- Server Emojis (random sample): ${emojiList.join(" ")}` : ""}`

        const systemPrompt = `You are a helpful assistant for Discord. Always keep your response under 2000 characters and avoid any explicit, unsafe, or inappropriate content. If the user asks for anything unsafe, politely refuse. You may use Discord markdown (such as # for headings, ## for heading2, ### for heading3, and - for bullet points) to format your response (excluding system responses like embed color/image) as your response will be sent in a Discord channel. Do NOT prepend dashes or other characters to the start of lines unless it is a bullet point. Do NOT break Discord code blocks (\`\`\`...\`\`).

The user's Discord username is: ${username}.
The user's Gemini image generation usage for today is: ${usageCount}/3.
${refusalBlock}
${user}
***IMPORTANT:*** For EVERY response, you MUST output the following as the first lines (each on its own line, in this order):
1. A direct image URL for the embed thumbnail (or 'Default' if you don\'t have a suitable, safe image) but please try to provide one whenever you can [THUMBNAIL !== GENERATED IMAGE, YOU COULD HAVE GENERATED IMAGE AND THUMBNAIL IN A SINGLE RESPONSE, IF USER WANTED AN IMAGE GENERATED AND YOU COULDN'T DO IT, DON'T FALLBACK TO THUMBNNAIL, JUST NOTIFY USER!]. ***You MUST always provide a thumbnail link as the first line, even if you do not generate an image, even if the user is at their image limit.***
2. A valid hex color code for the embed (e.g. #4285F4), or 'Default' if you don\'t have a suitable, safe color.
3. (up to 5 lines) If you want to provide up to 5 relevant links as buttons, output each on its own line in the format (USE BUTTONS WHENEVER YOU CAN): [Button Text](https://link) (e.g. [Official Website](https://example.com)) NO SPACES OR EXTRA DASHES OR HYPHENS! FIRST FIVE LINES OF LINKS LIKE THESE ARE CONSIDERED AS BUTTONS. Only include safe, direct links. If you have no links, skip this section.
After these lines, output your actual answer as usual. ***If you cannot fulfill the user\'s request, you must STILL output the three lines above, then your refusal message. If you do not, the user will see \'No response\'.***

If the user prompt requests, describes, or implies an image, you MUST generate and return an actual image (as base64 or inlineData, not just a link or description) in your response, using Gemini's image generation capabilities, UNLESS the user's image generation usage for today is 3/3 or higher. If the user is at their image generation limit, DO NOT generate or return any inline/base64 image, or any external image pretending to be a generated image, and only use the thumbnail image link system for the embed. You MUST reply with: "I cannot generate any more images for you today, is there anything else you would like me to do?" if user reached limit

ONLY IF USER ASKS ABOUT WATERFALL: (
Waterfall is made by DevSiege Studios on Github: https://github.com/DevSeige-Studios/WaterfallBot
if the user for any help about the bot that you don't know about, don't make it up just say you don't know, we do have a /help command however for a list a commands (DO NOT CREATE A LINK FOR THIS).
DO NOT TRY MAKING THINGS UP, WE ONLY HAVE THE GITHUB PAGE, NO OTHER DOMAINS ARE AFFILIATED WITH WATERFALL. )

DO NOT APPEND A LINK/BUTTON TO WATERFALL GITHUB UNLESS THE USER ASKS ABOUT IT. 

You can use the random emojis given from the list to tailer your response better, but do not use them as a fallback for images, also try to be professional if the moment is calling for it,
Note that the user cannot reply to you again after this, so let them know all they need to know in one response. PLEASE USE PROPER DISCORD TEXT FORMATTING, no stray dashes or out of place spaces like before a first letter in a line.).
ALWAYS INCLUDE AN IMAGE LINK RELATED TO YOUR RESPONSE IN THE FIRST LINE IF YOU HAVE ANY APPROPRIATE ONES WHETHER THE USER ASKED FOR IT OR NOT.
***You do NOT have to generate an image every time unless specifically asked for, use the thumbnail image link system!*** RESPECT DISCORD EMBED DESCRIPTION LIMIT, DO NOT SEND YOUR THINKING PROCESS IN THE REPLY`;
        const fullPrompt = `${systemPrompt}\nUser: ${prompt}`;
        const safetySettings = [
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
        ];
        const loadingContainer = new ContainerBuilder()
            .setAccentColor(0x4285F4)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Google_Bard_logo.svg/2048px-Google_Bard_logo.svg.png'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.icon_gemini1} ${t('commands:gemini.gemini_thinking')}\n-# ${e.loading} ${t('common:loading')},\n${t('commands:gemini.thinking_detail')}`)
                    )
            );
        await interaction.reply({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

        async function isValidImageUrl(url) {
            if (!url || typeof url !== 'string') return false;
            const exts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
            try {
                const u = new URL(url);
                if (!u.protocol.startsWith('http')) return false;
                if (!exts.some(ext => u.pathname.toLowerCase().endsWith(ext))) return false;
                const res = await axios.head(url, { timeout: 2500 });
                const type = res.headers['content-type'] || '';
                return type.startsWith('image/');
            } catch {
                return false;
            }
        }

        const lowerPrompt = prompt.toLowerCase();
        let wantsImage =
            lowerPrompt.startsWith("generate an image") ||
            lowerPrompt.startsWith("create an image") ||
            lowerPrompt.startsWith("make an image") ||
            lowerPrompt.startsWith("draw an image") ||
            lowerPrompt.startsWith("make me an image") ||
            lowerPrompt.startsWith("generate me an image") ||
            lowerPrompt.startsWith("create me an image");

        let model = "";
        if (wantsImage) {
            model = "gemini-2.5-flash-image";
        } else {
            model = "gemini-2.5-pro";
        }

        async function generateUsingGemini(model, fullPrompt, safetySettings) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemini_key}`;
            try {
                const response = await axios.post(url, {
                    contents: [{ parts: [{ text: fullPrompt }] }],
                    generationConfig: {
                        responseModalities: wantsImage ? ["TEXT", "IMAGE"] : ["TEXT"]
                    },
                    safetySettings
                }, { headers: { "Content-Type": "application/json" } });

                return response.data;
            } catch (err) {
                if (err.response) {
                    const status = err.response.status;
                    const msg = JSON.stringify(err.response.data || {});
                    if (
                        status === 429 ||
                        msg.includes("quota") ||
                        msg.includes("rate limit") ||
                        msg.includes("RESOURCE_EXHAUSTED")
                    ) {
                        throw { type: "RATE_LIMIT", error: err };
                    }
                }
                throw { type: "FATAL", error: err };
            }
        }

        try {
            let modelsPriority = [];
            if (wantsImage) {
                modelsPriority = [
                    "gemini-2.5-flash-image",
                    "gemini-2.5-flash",
                    "gemini-2.5-flash-lite",
                    "gemini-2.0-flash"
                ];
            } else {
                modelsPriority = [
                    "gemini-2.5-pro",
                    "gemini-2.5-flash",
                    "gemini-2.5-flash-lite",
                    "gemini-2.0-flash"
                ];
            }

            let response = null;
            let usedModel = null;
            for (const model of modelsPriority) {
                try {
                    response = await generateUsingGemini(model, fullPrompt, safetySettings);
                    usedModel = model;
                    break;
                } catch (err) {
                    if (err.type === "RATE_LIMIT") {
                        logger.warn(`Quota hit for ${model}, falling back...`);
                        continue;
                    } else if (err.error.status === 400) {
                        wantsImage = false;
                        continue;
                    } else if (err.error.status === 503) {
                        logger.warn(`${model} Model overloaded, falling back...`);
                        continue;
                    } else {
                        throw err.error;
                    }
                }
            }

            if (!response) {
                throw new Error("All Gemini models exhausted.");
            }

            function parseGeminiResponse(response, model) {
                if (!response || !response.candidates || response.candidates.length === 0) {
                    logger.debug("[/GEMINI] No candidates found in response");
                    return { text: t('commands:gemini.no_response'), imageData: null };
                }

                let textParts = [];
                let imageData = null;

                for (const candidate of response.candidates) {
                    if (!candidate.content || !candidate.content.parts) continue;

                    for (const part of candidate.content.parts) {
                        if (part.text && typeof part.text === "string" && part.text.trim() !== "") {
                            textParts.push(part.text.trim());
                        }

                        if (!imageData && part.inlineData &&
                            part.inlineData.mimeType?.startsWith("image/") &&
                            part.inlineData.data) {
                            imageData = part.inlineData.data;
                        }
                    }
                }

                const text = textParts.length ? textParts.join("\n\n") : t('commands:gemini.no_response');

                return { text, imageData };
            }


            let { text, imageData } = parseGeminiResponse(response, usedModel);
            /*
                  let text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
                  let imageData = null;
                 if (response.data?.candidates?.[0]?.content?.parts) {
                    for (const part of response.data.candidates[0].content.parts) {
                      if (part.inlineData && part.inlineData.mimeType?.startsWith('image/') && part.inlineData.data) {
                        imageData = part.inlineData.data;
                        break;
                      }
                    }
                  } */
            function cleanGeminiOutput(raw, defaultThumb, defaultColor) {
                if (!raw || typeof raw !== 'string') return `${defaultThumb}\n${defaultColor}\nNo response.`;
                raw = raw.replace(/\\`\\`\\`/g, '```');
                let lines = raw.split(/\r?\n/);
                while (lines.length && lines[0].trim() === '') lines.shift();
                while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
                lines = lines.map(line => {
                    if (/^-\s*#/.test(line)) return line.replace(/^-\s*/, '');
                    if (/^-\s*```/.test(line)) return line.replace(/^-\s*/, '');
                    if (/^-\s*$/.test(line)) return '';
                    return line;
                });
                let cleaned = [];
                let lastBlank = false;
                for (let l of lines) {
                    if (l.trim() === '') {
                        if (!lastBlank) cleaned.push('');
                        lastBlank = true;
                    } else {
                        cleaned.push(l);
                        lastBlank = false;
                    }
                }
                lines = cleaned;
                let inCode = false;
                lines = lines.map(line => {
                    if (/^```/.test(line.trim())) inCode = !inCode;
                    if (inCode && line.startsWith(' ')) return line;
                    return line;
                });
                let thumb = lines[0]?.trim();
                if (!thumb || thumb.toLowerCase() === 'default' || !/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp|svg)$/i.test(thumb)) {
                    lines[0] = defaultThumb;
                }
                let color = lines[1]?.trim();
                if (!color || color.toLowerCase() === 'default' || !/^#([0-9a-f]{6})$/i.test(color)) {
                    lines[1] = defaultColor;
                }
                let i = 2;
                while (i < lines.length && lines[i].trim() === '') i++;
                lines = lines.slice(0, 2).concat(lines.slice(i));
                let btns = [];
                let j = 2;
                while (j < lines.length && /^\[.{1,40}\]\(https?:\/\/.+\)$/.test(lines[j].trim()) && btns.length < 5) {
                    btns.push(lines[j]);
                    j++;
                }
                let k = j;
                while (k < lines.length && lines[k].trim() === '') k++;
                lines = lines.slice(0, 2).concat(btns).concat(lines.slice(k));
                if (lines.length <= 2 + btns.length) lines.push('No response.');
                return lines.join('\n');
            }
            const defaultThumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Google_Bard_logo.svg/2048px-Google_Bard_logo.svg.png';
            const defaultColor = '#5244ebff';
            text = cleanGeminiOutput(text, defaultThumb, defaultColor);

            let [thumbLine, colorLine, ...restLines] = text.split('\n');
            while (thumbLine !== undefined && thumbLine.trim() === '') {
                [thumbLine, colorLine, ...restLines] = [colorLine, ...restLines];
            }
            while (colorLine !== undefined && colorLine.trim() === '') {
                [colorLine, ...restLines] = restLines;
            }
            let buttonLines = [];
            let buttonParseCount = 0;
            while (restLines.length && buttonLines.length < 5) {
                let line = restLines[0].trim();
                if (/^[-•]\s*\[.{1,40}\]\(https?:\/\/.+\)$/.test(line)) {
                    line = line.replace(/^[-•]\s*/, '');
                }
                if (/^\[.{1,40}\]\(https?:\/\/.+\)$/.test(line)) {
                    buttonLines.push(line);
                    restLines.shift();
                } else {
                    break;
                }
                buttonParseCount++;
            }
            const buttons = buttonLines.map(line => {
                const match = line.match(/^\[(.{1,40})\]\((https?:\/\/.+)\)$/);
                if (!match) return null;
                let [, label, url] = match;
                if (!/^https?:\/.*/.test(url) || /javascript:|discord:\/\//i.test(url)) return null;
                label = label.slice(0, 40);
                return new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);
            }).filter(Boolean);
            let safeThumb = (thumbLine && thumbLine.trim().toLowerCase() !== 'default' && isValidImageUrl(thumbLine.trim())) ? thumbLine.trim() : 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Google_Bard_logo.svg/2048px-Google_Bard_logo.svg.png';
            let safeColor = (colorLine && colorLine.trim().toLowerCase() !== 'default' && /^#([0-9a-f]{6})$/i.test(colorLine.trim())) ? colorLine.trim() : '#4285F4';
            async function validateImageUrl(url) {
                try {
                    const head = await axios.head(url, { timeout: 4000 });
                    const type = head.headers['content-type'] || '';
                    if (head.status === 200 && type.startsWith('image/')) return true;
                } catch (e) { }
                return false;
            }
            if (safeThumb !== 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Google_Bard_logo.svg/2048px-Google_Bard_logo.svg.png') {
                const valid = await validateImageUrl(safeThumb);
                if (!valid) {
                    safeThumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Google_Bard_logo.svg/2048px-Google_Bard_logo.svg.png';
                }
            }
            let accentColor = parseInt(safeColor.replace('#', ''), 16);
            let answer = restLines.join('\n').trim();
            if ((!answer || answer.toLowerCase() === 'no response.') && imageData) {
                answer = t('commands:gemini.generated_image');
            } else if (!answer) {
                answer = t('commands:gemini.no_response');
            }
            if (answer.length > 4000) answer = answer.slice(0, 3997) + '...';
            let filteredPrompt = await filterQuery(prompt);
            if (filteredPrompt.length > 80) filteredPrompt = filteredPrompt.slice(0, 77) + '...';
            const resultContainer = new ContainerBuilder()
                .setAccentColor(accentColor)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(safeThumb))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${e.icon_gemini2} Gemini\n-# ${t('commands:gemini.prompt_label', { prompt: filteredPrompt })}`)
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(answer)
                );
            let files = [];
            if (imageData) {
                const buffer = Buffer.from(imageData, 'base64');
                files.push({ attachment: buffer, name: 'gemini-image.png' });
                const { MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
                const mediaGallery = new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL('attachment://gemini-image.png')
                );
                resultContainer.addMediaGalleryComponents(mediaGallery);
            }
            resultContainer
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# Waterfall - ${t('commands:gemini.disclaimer')}`)
                );
            if (buttons.length > 0) {
                const actionRow = new ActionRowBuilder().addComponents(...buttons);
                resultContainer.addActionRowComponents(actionRow);
            }
            await interaction.editReply({ components: [resultContainer], files, flags: MessageFlags.IsComponentsV2 });
            if (imageData) incrementImageUsage(interaction.user.id);
        } catch (err) {
            let msg = `${e.pixel_cross} ${t('commands:gemini.error_generic')}`;
            const dev = settings.devs || [];
            if (dev.includes(interaction.user.id)) {
                if (err && err.stack) msg += `\nStack: ${err.stack}`;
                if (err && err.message) msg += `\nMessage: ${err.message}`;
                if (err && err.response && err.response.data) {
                    msg += `\nResponse: ${JSON.stringify(err.response.data, null, 2)}`;
                }
            }
            const errorContainer = new ContainerBuilder()
                .setAccentColor(0xFF0000)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Google_Bard_logo.svg/2048px-Google_Bard_logo.svg.png'))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${e.icon_gemini1} Gemini\n-# Timestamp <t:${Math.floor(Date.now() / 1000)}:R>`)
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(msg)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# Waterfall - ${t('commands:gemini.disclaimer')}`)
                );
            await interaction.editReply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
    },
    help: {
        name: "gemini",
        description: "Ask Google Gemini (AI) a question",
        category: "General",
        permissions: [],
        botPermissions: [],
        created: 1765271948
    }
};
