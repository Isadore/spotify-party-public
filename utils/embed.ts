import moment from "moment-timezone";
import { MessageEmbed } from "discord.js";
import { Party } from "../classes/PartyManager";
import { truncate } from "./stringOpts";

export = function embed(party: Party.Interface) {
    let description: string,
        thumbUrl: string = `https://${process.env.REDIRECT_URI}/spotify-logo.png`,
        listeners = party.listeners.map(pl => pl.gm.displayName + ' ' + plIcons(pl)).join('\n');
    if (party.timestamps.end)
        description = `**Party Ended${party.timestamps.activity < Date.now() - (+process.env.PARTY_TIMEOUT_MS) ? " Due to Inactivity" : ""}**`;
    else if (!party.track || party.track.status == null)
        description = `**No Track Playing**\n\n`;
    else if (party?.track?.data?.item?.type != "track" || party?.track?.data?.item?.is_local)
        description = `**Waiting for ${party?.track?.data?.item?.type != "track" ? party.track.data.currently_playing_type : "local file"}...**\n\n`;
    else if (party?.track?.data?.item?.type == "track") {
        let time = moment(party.track.data.item.duration_ms).utc();
        description =
            `**[Current Track${!party.track.data.is_playing ? " (Paused)" : ""}](${party?.track?.data?.item.external_urls?.spotify || 'https://open.spotify.com'})**\n` +
            `\`Title:\` ${truncate(party.track.data.item.name, 43)}\n` +
            `\`Artist${party.track.data.item.artists.length > 1 ? "s" : ""}:\` ${truncate(party.track.data.item.artists.map(artist => artist.name).join(', '), 43)}\n` +
            `\`Album:\` ${truncate(party.track.data.item.album.name, 43)}\n` +
            `\`Length:\` ${3600000 <= party.track.data.item.duration_ms ? time.format('h:mm:ss') : time.format('m:ss')}\n\n`;
        thumbUrl = party.track.data.item.album.images[0].url;
    };
    return {
        embed: new MessageEmbed({
            title: `Listening Party Hosted By: ${party.host.displayName}`,
            color: 0x32CD32,
            thumbnail: {
                url: thumbUrl
            },
            description: `${description}${party.timestamps.end ? "" : `**Listeners:**\n` + `${party.listeners.length > 0 ? listeners : "Party Empty"}`}`,
            footer: {
                text: `Started: ${moment(party.timestamps.start).tz("America/New_York").format('M/D/YYYY, h:mm:ss a')}  ${party.timestamps.end ? `Ended: ${moment(party.timestamps.end).tz("America/New_York").format('M/D/YYYY, h:mm:ss a')}` : ""}`
            }
        }),
        content: `${process.env.NODE_ENV ? "" : "LOCAL"}`
    };
};

function plIcons(pl: Party.Listener) {
    let socket = pl.socketConnected == true ? ' <:socket_connected:743610035698925638>' : pl.socketConnected == false ? ' <:socket_disconnected:743605657625952286>' : '';
    if (!pl.player)
        return '<a:connecting:743542997987229816>' + socket;
    else if (pl.player.status == null)
        return '<:api_status_null:743564618181640316>' + socket;
    else if (!pl.player.data)
        return '<:api_error:743566106328956959>' + socket;
    let dev: string, stat: string;
    let devs = {
        Computer: '<:device_computer:743570272065683637>',
        Tablet: '<:device_tablet:743570820055564379>',
        Smartphone: '<:device_smartphone:743571172041687051>',
        Speaker: '<:device_speaker:743571383426220142>',
        TV: '<:device_tv:743571582701666335>',
        AudioDongle: '<:device_dongle:743572428986384394>',
        GameConsole: '<:device_console:743575410717229116>',
        CastVideo: '<:device_stream:743573583095267450>',
        CastAudio: '<:device_stream:743573583095267450>',
        Automobile: '<:device_car:743572110928248944>'
    };
    dev = pl.player.data.device?.type ? devs[pl.player.data.device.type] || '<:device_unknown:743568195704717413>' : '<:device_not_found:743577016288280656>';
    if (pl.player.data.device?.is_private_session)
        return dev + ' <:private_session:743577830100566017>' + socket;
    else if (pl.player.data.is_playing)
        stat = '<:playing:743580103270727800>';
    else
        stat = '<:paused:743580134879264839>';
    if (!pl.player.data.device?.is_active) {
        stat = '<:inactive:743583906896412802>';
    };
    return dev + ' ' + stat + socket;
};