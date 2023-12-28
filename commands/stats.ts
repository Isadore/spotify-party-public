import { GuildMember, Message, MessageEmbed, TextChannel, DMChannel } from "discord.js";
import moment from "moment-timezone";
import { client, db } from "../bot";
import { UserDoc } from "../classes/Database";
import { top, recent, Spotify } from "../utils/api";
import log from "../utils/log";
import { truncate } from "../utils/stringOpts";
import { createTrackEmbed } from "../commands/track";

export async function stats(msg: Message) {

    let user: UserDoc, data: 403 | Spotify.PagingObject, member: GuildMember;

    if (msg.channel instanceof DMChannel) return msg.reply('this command will only work in a discord server.');

    if (msg.mentions.users.first()) {

        member = await msg.guild.members.fetch(msg.mentions.users.first());
        if (!member) return msg.reply(`mentioned user not found in current server`);

        user = await db.users.get(member.id);
        if (!user) return msg.reply(`the mentioned user is not logged in.`);

        data = await top(user, 'artists', 'medium_term', 10, 0);
        if (data == 403) return msg.reply(`the mentioned user needs to re-login to the bot with \`${process.env.BOT_PREFIX} account\` to use this command`);

    } else {

        member = msg.member;
        user = await db.users.get(msg.author.id);

        if (!user) return msg.reply(`you need to log in to the bot before you can see your spotify stats, try \`${process.env.BOT_PREFIX} account\``);

        data = await top(user, 'artists', 'medium_term', 10, 0);
        if (data == 403) return msg.reply(`to use this command please re-login to the bot with \`${process.env.BOT_PREFIX} account\``);

    };

    if (typeof data != 'object' && data != 403) return;

    let s: Stats.Interface = {
        creator: msg.member,
        user: member,
        message: null,
        limit: 10,
        offset: 0,
        time: 'medium_term',
        type: 'artists',
        timestamp: Date.now()
    };

    let existingStats = await db.stats.getOne(null, msg.channel.id, s.user.id);

    if (existingStats) {

        try {
            let message = (client.channels.resolve(existingStats.channelId) as TextChannel | DMChannel).messages.resolve(existingStats.messageId);
            message.embeds[0].footer.text = message.embeds[0].footer.text + ' | Inactive'
            await message.edit('', message.embeds[0]);
            await message.reactions.removeAll();
        } catch { };

        await db.stats.delete(existingStats.messageId);

    };

    let embed = await createStatEmbed(s, data, user);

    s.message = await msg.channel.send(embed);

    let emotes = ['748010469104812114', '748010433083998250', '749400710419841165', '748260740791795713', '748071021025951775'];
    let elen = emotes.length;

    for (let i = 0; i < elen; i++) {
        await s.message.react(emotes[i]);
    };

    return await db.stats.save(s);

};

async function createStatEmbed(s: Stats.Interface, data?: Spotify.PagingObject | 403, user?: UserDoc): Promise<MessageEmbed> {

    if (s.type == "track") return;

    user = user || await db.users.get(s.user.id);
    data = data ? data : s.type == 'recent' ? await recent(user, s.offset + 10) : await top(user, s.type, s.time, s.limit, s.offset);

    let timeReadable = {
        long_term: 'overall',
        medium_term: 'over the past six months',
        short_term: 'over the past four weeks'
    }[s.time];

    let embed = new MessageEmbed({
        title: `${s.user.displayName}'s `,
        color: 0x32CD32,
        url: `https://open.spotify.com/user/${user.spotify_name}`,
        footer: {
            text: `Requested by ${s.creator.displayName} | ${moment(s.timestamp).tz("America/New_York").format('M/D/YYYY, h:mm:ss a')}`,
            iconURL: s.creator.user.displayAvatarURL()
        }
    });

    if (s.type == 'recent')
        embed.title = embed.title + `last 50 tracks`;
    else
        embed.title = embed.title + `top 50 ${s.type} ${timeReadable}`;

    if (typeof data == 'object') {

        try {

            if (data.items.length > 10) data.items.splice(0, s.offset);

            data.items.forEach((v: Spotify.Items.Track | Spotify.Items.Artist, i, a) => {
                a[i] = `**#${i + 1 + s.offset}; [${truncate(v.name, 50)}](${v.external_urls.spotify})**\n`;
                if (v.type == 'track') a[i] = a[i] + `by ${truncate(v.artists.map(a => a.name).join(', '), 50)}`;
            });

            embed.description = data.items.join('\n');

        } catch (ex) {

            log(`Exception parsing ${s.type} data for user \`${s.user.user.tag}\`|\`${s.user.id}\` : ${ex}`);

            embed.description = 'Error retrieving user data, please try again.';

        };

    } else if (data == 403) {

        embed.description = `${s.creator.id != s.user.id ? 'The mentioned user needs' : 'You need'} to re-login to the bot using \`${process.env.BOT_PREFIX} account\` to see this data`;

    } else {

        log(`Error retrieving ${s.type} data for user <@${s.user.id}>: ${data}`);

        embed.description = 'Error retrieving user data, please try again.';

    };

    return embed;

};

export async function editStatEmbed(msg: Message, type?: boolean | 'reset', time?: 1 | -1, offset?: number | 'reset', limit?: number) {

    let doc = await db.stats.getOne(msg.id);
    if (!doc) return;

    let s: Stats.Interface = {
        user: null,
        message: null,
        creator: null,
        type: doc.type,
        limit: doc.limit,
        time: doc.time,
        offset: doc.offset,
        timestamp: doc.timestamp
    };

    let embed: MessageEmbed;

    let timeArr: Array<Stats.Ranges> = ['short_term', 'medium_term', 'long_term'];
    let typeArr: Array<Stats.Types> = ['artists', 'tracks', 'recent'];

    try {

        let channel = client.channels.resolve(doc.channelId) as TextChannel;

        s.user = await channel.guild.members.fetch(doc.userId);
        s.message = await channel.messages.fetch(doc.messageId);
        s.creator = await channel.guild.members.fetch(doc.creatorId);

    } catch (ex) {
        log(`Failed editing stats message ${ex}`, 'MAIN');
        return false
    };

    if (s.type == "track") {

        embed = await createTrackEmbed(s);

    } else {

        if (type == 'reset') {
            s.offset = 0;
        } else {

            s.type = type ? typeArr[typeArr.findIndex(t => t == s.type) + 1] || typeArr[0] : s.type;
            s.limit = limit ? s.limit + limit : s.limit;
            s.offset = offset == 'reset' ? 0 : offset && ((s.limit + s.offset) < 50 || offset < 0) && (s.offset + offset) >= 0 ? s.offset + offset : s.offset;
            let nextTime = timeArr[timeArr.findIndex(t => t == s.time) + time] || timeArr[0];
            s.time = s.type == 'recent' ? s.time : time && nextTime ? nextTime : s.time;

            if (s.type == doc.type && s.time == doc.time && s.limit == doc.limit && s.offset == doc.offset) return false;

        };

        embed = await createStatEmbed(s);

    }

    if (embed.description.trim() != s.message.embeds[0].description.trim() || embed.title.trim() != s.message.embeds[0].title.trim())
        await s.message.edit('', embed);

    await db.stats.save(s);

    return true;

};

export namespace Stats {
    export interface Interface {
        message: Message,
        creator: GuildMember,
        user: GuildMember,
        limit?: number,
        type: Types,
        offset?: number,
        time?: Ranges,
        timestamp: number
    };
    export type Ranges = 'long_term' | 'medium_term' | 'short_term';
    export type Types = 'artists' | 'tracks' | 'recent' | 'track';
};