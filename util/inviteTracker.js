const { Collection } = require('discord.js');
const logger = require('../logger.js');
const { Server } = require('../schemas/servers.js');

const guildInvites = new Map();
const recentDeletes = new Map();

async function isStatsEnabled(guildId) {
    const data = await Server.findOne({ serverID: guildId }, { 'serverStats.enabled': 1 }).lean();
    return !!data?.serverStats?.enabled;
}

async function cacheInvites(guild) {
    try {
        if (!await isStatsEnabled(guild.id)) {
            if (guildInvites.has(guild.id)) {
                guildInvites.delete(guild.id);
            }
            if (recentDeletes.has(guild.id)) {
                recentDeletes.delete(guild.id);
            }
            return;
        }

        const invites = await guild.invites.fetch();
        const codeUses = new Collection(invites.map(i => [i.code, { uses: i.uses, inviterId: i.inviter?.id }]));

        const vanity = await guild.fetchVanityData().catch(() => null);
        if (vanity) {
            codeUses.set(guild.vanityURLCode, { uses: vanity.uses, inviterId: null });
        }

        guildInvites.set(guild.id, codeUses);
    } catch (error) {
        logger.debug(`[InviteTracker] Failed to cache invites for guild ${guild.name}: ${error.message}`);
    }
}

async function trackDelete(guild, code) {
    try {
        if (!await isStatsEnabled(guild.id)) return;

        const currentCache = guildInvites.get(guild.id);
        if (currentCache && currentCache.has(code)) {
            const data = currentCache.get(code); //{ uses, inviterId }

            if (!recentDeletes.has(guild.id)) {
                recentDeletes.set(guild.id, new Collection());
            }

            recentDeletes.get(guild.id).set(code, {
                ...data,
                timestamp: Date.now()
            });

            const deletes = recentDeletes.get(guild.id);
            deletes.forEach((val, key) => {
                if (Date.now() - val.timestamp > 5000) {
                    deletes.delete(key);
                }
            });

            currentCache.delete(code);
        }
    } catch (error) {
        logger.error(`[InviteTracker] Error tracking delete: ${error.message}`);
    }
}

async function findUsedInvite(guild) {
    try {
        if (!await isStatsEnabled(guild.id)) {
            return null;
        }

        const cachedInvites = guildInvites.get(guild.id);
        const newInvites = await guild.invites.fetch();

        const newCodeUses = new Collection(newInvites.map(i => [i.code, { uses: i.uses, inviterId: i.inviter?.id }]));
        const vanity = await guild.fetchVanityData().catch(() => null);
        if (vanity) {
            newCodeUses.set(guild.vanityURLCode, { uses: vanity.uses, inviterId: null });
        }
        guildInvites.set(guild.id, newCodeUses);

        if (!cachedInvites) return null;

        for (const [code, newInvite] of newInvites) {
            const cachedData = cachedInvites.get(code);
            const cachedUses = cachedData ? cachedData.uses : 0;

            if (newInvite.uses > cachedUses) {
                return {
                    code: code,
                    inviterId: newInvite.inviter?.id,
                    inviterTag: newInvite.inviter?.tag,
                    uses: newInvite.uses
                };
            }
        }

        if (vanity && guild.vanityURLCode) {
            const cachedVanityData = cachedInvites.get(guild.vanityURLCode);
            const cachedVanityUses = cachedVanityData ? cachedVanityData.uses : 0;

            if (vanity.uses > cachedVanityUses) {
                return {
                    code: guild.vanityURLCode,
                    inviterId: null,
                    inviterTag: 'Vanity URL',
                    uses: vanity.uses
                };
            }
        }

        const deletes = recentDeletes.get(guild.id);
        if (deletes) {
            const sorted = deletes.sort((a, b) => b.timestamp - a.timestamp);
            const mostRecent = sorted.firstKey();
            const match = sorted.first();

            if (match && Date.now() - match.timestamp < 2000) {
                return {
                    code: mostRecent,
                    inviterId: match.inviterId,
                    inviterTag: 'Unknown (Deleted)',
                    uses: match.uses + 1
                };
            }
        }

    } catch (error) {
        logger.error(`[InviteTracker] Error finding used invite: ${error.message}`);
    }
    return null;
}
//
module.exports = {
    cacheInvites,
    findUsedInvite,
    trackDelete
};


// contributors: @relentiousdragon