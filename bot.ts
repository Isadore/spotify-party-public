import { Client, DMChannel, TextChannel, Guild } from "discord.js";
import { commands } from "./commands/index";
import { DataBase } from "./classes/Database";
import log from "./utils/log";
import { Party, PartyManager } from "./classes/PartyManager";
import validateEnv from "./utils/validateEnv";
import ServerManager from "./classes/ServerManager";
import { editStatEmbed } from "./commands/stats";
import { controlPlayer } from "./commands/track";

require('dotenv').config();

validateEnv();

export const client = new Client({ partials: ['REACTION', 'USER', 'CHANNEL', 'MESSAGE', 'GUILD_MEMBER'] });

export const manager = new PartyManager();

export const db = new DataBase();

export const sm = new ServerManager();

export let logChannels = {
    MAIN: null as TextChannel,
    SERVER: null as TextChannel
};

client.on('ready', async () => {
    await client.user.setActivity(`for ${process.env.BOT_PREFIX} help`, { type: 'WATCHING' });
    Object.keys(logChannels).forEach(channel => logChannels[channel] = client.guilds.resolve(process.env.SERVER_ID).channels.resolve(process.env[channel + '_CHANNEL_ID']) as TextChannel)
    log(`Bot Logged in as: ${client.user.tag}`);
    process.env.NODE_ENV && await sm.start();
    await db.start();
    let existingParties: Party.Interface[] = [];
    if (!manager.running) {
        let parties = await db.parties.getAll();
        let partyCount = parties.length;
        partyLoop:
        for (let i = 0; i < partyCount; i++) {
            let party = parties[i];
            if (party.local == (!!process.env.NODE_ENV)) {
                try {
                    let channel = await client.channels.fetch(party.channelId, true) as TextChannel;
                    await channel.messages.fetch(party.messageId);
                } catch (ex) {
                    return log(`Failed caching party message ${ex}`);
                };
                let server: Guild;
                try { server = client.guilds.resolve(party.serverId); }
                catch (ex) {
                    log(`Failed restoring party, unable to resolve server - ${ex.toString()}`);
                    await party.remove(); continue;
                };
                let existingParty: Party.Interface = {
                    creator: null,
                    message: null,
                    listeners: null,
                    host: null,
                    track: { status: null },
                    timestamps: {
                        activity: Date.now(),
                        start: party.timestamps.activity
                    }
                };
                try { existingParty.message = await (server.channels.cache.get(party.channelId) as TextChannel).messages.fetch(party.messageId, true); }
                catch (ex) {
                    log(`Failed restoring party, unable to resolve message - ${ex.toString()}`);
                };
                try { existingParty.listeners = party.partyListeners.map(listener => ({ gm: server.members.resolve(listener) })); }
                catch (ex) {
                    log(`Failed restoring party, unable to resolve listeners - ${ex.toString()}`);
                };
                try { existingParty.host = server.members.resolve(party.hostId); }
                catch (ex) {
                    log(`Failed restoring party, unable to resolve host - ${ex.toString()}`);
                };
                try { existingParty.creator = server.members.resolve(party.creatorId); }
                catch (ex) {
                    log(`Failed restoring party, unable to resolve creator - ${ex.toString()}`);
                };
                let keys = Object.keys(existingParty);
                let kl = keys.length
                for (let e = 0; e < kl; e++) {
                    if (existingParty[keys[e]] == null) {
                        party.remove();
                        break partyLoop;
                    };
                };
                existingParties.push(existingParty);
            };
        };
        let stats = await db.stats.getAll();
        let statCount = stats.length;
        for (let i = 0; i < statCount; i++) {
            let statDoc = stats[i];
            try {
                let channel = await client.channels.fetch(statDoc.channelId, true) as TextChannel;
                await channel.messages.fetch(statDoc.messageId);
            } catch (ex) {
                await db.stats.delete(statDoc.messageId);
                log(`Failed caching stats message ${ex}`);
            };
        };
    };
    if (existingParties.length > 0) log(`${existingParties.length} part${existingParties.length > 1 ? "ies" : "y"} restored from database`);
    manager.start(existingParties);
});

client.on('message', async msg => {
    if(msg.partial) await msg.fetch();
    if ((msg.channel instanceof DMChannel || msg.guild.id != process.env.SERVER_ID) && !process.env.NODE_ENV) return;
    let msgStr = msg.content.toLowerCase();
    if (msg.author.bot || !/^(!p)($|\s)/gm.test(msgStr) || (msgStr.includes('local') && process.env.NODE_ENV)) return;
    let command = msg.content.replace(process.env.BOT_PREFIX, '').trim().toLowerCase().split(' ')[0];
    (commands[command] && commands[command](msg, manager)) || commands['party'](msg);
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.partial) await reaction.fetch();
    if (user.partial) await user.fetch();
    if (user.bot || (user.id == client.user.id)) return;
    let msg = reaction.message;
    let action: boolean = await {
        get '744352828864331879'() {
            return manager.addPartyListener(msg, reaction.message.guild.members.resolve(user.id));
        },
        get '744353107852525599'() {
            return manager.removePartyListener(user);
        },
        get '744359817715515464'() {
            return manager.removeParty(user);
        },
        get '748010469104812114'() {
            return editStatEmbed(msg, null, null, 10);
        },
        get '748010433083998250'() {
            return editStatEmbed(msg, null, null, -10);
        },
        get '748260740791795713'() {
            return editStatEmbed(msg, true, null, 'reset');
        },
        get '748071021025951775'() {
            return editStatEmbed(msg, 'reset');
        },
        get '749400710419841165'() {
            return editStatEmbed(msg, null, 1);
        },
        get '808945631912525875'() {
            return controlPlayer(msg, user, "previous");
        },
        get '808942884073242644'() {
            return controlPlayer(msg, user, "play/pause");
        },
        get '808945673872998428'() {
            return controlPlayer(msg, user, "next");
        }
    }[reaction.emoji.id];
    if (action != null) await reaction.users.remove(user.id);
});

client.on('messageDelete', async msg => {
    if(msg.partial) await msg.fetch();
    manager.removeParty(msg) || db.stats.delete(msg.id);
});

client.on('guildCreate', guild => log(`Server added: ${guild.name}|\`${guild.id}\` - Total: ${client.guilds.cache.array().length}`));

client.on('guildDelete', guild => log(`Server removed: ${guild.name}|\`${guild.id}\` - Total Servers: ${client.guilds.cache.array().length}`));

client.login(process.env.DISCORD_BOT_TOKEN);