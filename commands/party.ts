import { UserDoc } from "../classes/Database";
import { getPlayer } from "../utils/api";
import { Message, GuildMember, DMChannel } from "discord.js";
import { Party } from "../classes/PartyManager";
import embed from "../utils/embed";
import { db, manager } from "../bot";

export = async function party(msg: Message) {

    let msgStr = msg.content.toLowerCase();

    if (msgStr.includes('leave') && (await manager.removePartyListener(msg.author))) return msg.reply('left listening party');
    if (msgStr.includes('end') && manager.removeParty(msg.author)) return msg.reply('listening party ended.');
    if (msgStr.includes('end') || msgStr.includes('leave')) return msg.reply('no active party found.');
    if (manager.getParty(msg.author).party) return msg.reply(`please end or leave your current party with ${process.env.BOT_PREFIX} \`end|leave\` before starting or joining a new one.`);

    let host: GuildMember;
    let hostAccount: UserDoc;

    if (msg.channel instanceof DMChannel) return msg.reply('this command will only work in a discord server.');

    let firstMention = msg.mentions.members.first();

    if (msgStr.includes('join') || firstMention) {

        if (firstMention) {

            let userAcc = await db.users.get(msg.author.id);
            if (userAcc.premium == false && !userAcc.spicetify_auth) return msg.reply(`spotify premium required to join a users party.`);

            host = firstMention;
            if (!host) return msg.reply('mentioned user not found in current server.');

            hostAccount = await db.users.get(host.id);
            if (!hostAccount) return msg.reply('the mentioned user is not logged in.');

            let existingParty = manager.getParty(host.user);
            if (existingParty.party) {
                let addUser = await manager.addPartyListener(existingParty.party.message, msg.member);
                if (!addUser) return msg.reply(`failed to join ${host.displayName}'s party.`);
                else return;
            };

        } else {
            return msg.reply('no user mentioned.');
        };

    } else {
        host = msg.member;
        hostAccount = await db.users.get(host.id);
        if (!hostAccount) return msg.reply(`you need to log in to the bot before you can host a listening party, try \`${process.env.BOT_PREFIX} account\``);
    };

    let currentTrack = await getPlayer(hostAccount);

    let np: Party.Interface = {
        creator: msg.member,
        message: undefined,
        host: host,
        listeners: msg.member.id != host.id ? [{ gm: msg.member }] : [],
        track: currentTrack,
        timestamps: {
            activity: Date.now(),
            start: Date.now()
        }
    };

    np.message = await msg.channel.send(embed(np));

    await manager.addParty(np);

    await np.message.react('744352828864331879');
    await np.message.react('744353107852525599');
    await np.message.react('744359817715515464');

    return np;

};