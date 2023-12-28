import { GuildMember, Message, MessageEmbed, TextChannel, DMChannel, User, PartialUser } from "discord.js";
import { client, db, sm } from "../bot";
import { UserDoc } from "../classes/Database";
import { getPlayer, getPlaylist, isEpisode, isTrack, PlayerData, skipTrack, Spotify, startTrack, stopTrack } from "../utils/api";
import { truncate } from "../utils/stringOpts";
import moment from "moment-timezone";
import { editStatEmbed, Stats } from "./stats";
import sleep from "../utils/sleep";

export async function track(msg: Message) {

    let user: UserDoc,
    discordMember: GuildMember = msg.member

    if (msg.mentions.members.first()) {
        discordMember = msg.mentions.members.first();
        user = await db.users.get(discordMember.id);
        if (!user)
            return msg.reply("mentioned user not logged in.");
    } else {
        user = await db.users.get(discordMember.id);
        if (!user)
            return msg.reply("you need to be logged in to use this command.");
    }

    let s: Stats.Interface = {
        user: discordMember,
        message: null,
        creator: msg.member,
        type: "track",
        timestamp: Date.now()
    }

    let existingStats = await db.stats.getOne(null, msg.channel.id, s.user.id);

    if (existingStats) {

        try {
            let message = (client.channels.resolve(existingStats.channelId) as TextChannel | DMChannel).messages.resolve(existingStats.messageId);
            await message.reactions.removeAll();
        } catch { };

        await db.stats.delete(existingStats.messageId);

    };

    let embed = await createTrackEmbed(s);
    s.message = await msg.channel.send(embed);
    await db.stats.save(s);

    await s.message.react('748071021025951775');

    if(user.premium || user.spicetify_auth && sm.getClient(user.spicetify_auth)) {
        await s.message.react('808945631912525875');
        await s.message.react('808942884073242644');
        await s.message.react('808945673872998428');
    }

}

export async function createTrackEmbed(s: Stats.Interface, user?: UserDoc): Promise<MessageEmbed> {

    let description: string,
    thumbURL: string;
    
    user = user || await db.users.get(s.user.id);
    let playerData: PlayerData = await getPlayer(user, null, "episode");

    let time = moment(playerData?.data?.item?.duration_ms).utc();
    let progressTime = moment(playerData?.data?.progress_ms).utc();

    if (!playerData || playerData.status == null)
        description = `**No Track Playing**\n\n`;
    else if (playerData.data.currently_playing_type == "ad")
        description = `**Ad is playing...**\n\n`;
    else if (playerData.data.currently_playing_type == "track" && isTrack(playerData.data.item)) {
        thumbURL = playerData.data.item.album.images.find(x => x)?.url || `https://${process.env.REDIRECT_URI}/spotify-logo.png`;

        let usableArtistCount = playerData.data.item.artists.map(a => a.name).reverse().filter((c, i, a) => {
            if((a.reduce((p, c, i, a) => p + c).length - c.length) > 43) return false;
            return true;
        }).reverse().length;
        let usableArtists = playerData.data.item.artists.slice(0, usableArtistCount);

        description =
            `\`Title:\` [${truncate(playerData.data.item.name, 43)}](${playerData.data.item.external_urls.spotify})\n` +
            `\`Artist${playerData.data.item.artists.length > 1 ? "s" : ""}:\` ${usableArtists.map(artist => `[${artist.name}](${artist.external_urls.spotify})`).join(', ')}\n` +
            `\`Album:\` [${truncate(playerData.data.item.album.name, 43)}](${playerData.data.item.album.external_urls.spotify})\n` +
            `\`Progress:\` ${3600000 <= playerData.data.progress_ms ? progressTime.format('h:mm:ss') : progressTime.format('m:ss')}/${3600000 <= playerData.data.item.duration_ms ? time.format('h:mm:ss') : time.format('m:ss')}\n`;
    } else if (playerData.data.currently_playing_type == "episode" && isEpisode(playerData.data.item)) {
        thumbURL = playerData.data.item.images.find(x => x)?.url;
        description =
        `\`Title:\` ${truncate(playerData.data.item.name, 43)}\n` +
        `\`Show:\` ${truncate(playerData.data.item.show.name, 43)}\n` +
        `\`Progress:\` ${3600000 <= playerData.data.progress_ms ? progressTime.format('h:mm:ss') : progressTime.format('m:ss')}/${3600000 <= playerData.data.item.duration_ms ? time.format('h:mm:ss') : time.format('m:ss')}\n\n` +
        playerData.data.item.description + "\n";
    }

    if(playerData?.data?.context?.type == "playlist" && playerData?.data?.currently_playing_type != "ad") {
        let playlistId = playerData.data.context.uri.match(/(?<=playlist:).+/);
        if(playlistId) {
            let playlistData = await getPlaylist(user, playlistId[0]);
            if(playlistData)
                description = description + `\`Playlist:\` [${playlistData.name}](${playlistData.external_urls.spotify || playlistData.owner.external_urls.spotify || "https://open.spotify.com/"})`;
        }
    }

    return new MessageEmbed({
        title: `${s.user.displayName}'s Current ${playerData?.data?.currently_playing_type == "episode" ? "Episode" : "Track"} ${playerData?.data?.is_playing ? '<:playing:743580103270727800>' : '<:paused:743580134879264839>'}`,
        color: 0x32CD32,
        description,
        thumbnail: {
            url: thumbURL
        },
        footer: {
            text: `Requested by ${s.creator.displayName} | ${moment().tz("America/New_York").format('M/D/YYYY, h:mm:ss a')}`,
            iconURL: s.creator.user.avatarURL()
        }
    });

}

export async function controlPlayer(msg: Message, user: User | PartialUser, action: "play/pause" | "next" | "previous"): Promise<boolean> {

    // If no message with user id that matches reaction user id return
    let doc = await db.stats.getOne(msg.id, null, user.id);
    if(!doc) return false;

    let userDoc = await db.users.get(user.id);
    if(!userDoc) return false;

    if(action == "next")
        await skipTrack(userDoc, "next");
    if(action == "previous")
        await skipTrack(userDoc, "previous");

    if(action == "play/pause") {
        let playerData = await getPlayer(userDoc, null, "episode");

        if(!playerData?.data || !Object.getOwnPropertyDescriptor(playerData.data, "is_playing"))
            return false;

        if(playerData.data.is_playing)
            await stopTrack(userDoc);
        else 
            await startTrack(userDoc);
    };

    await sleep(150);
    return editStatEmbed(msg, 'reset');

}