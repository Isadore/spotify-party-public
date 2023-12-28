import { Message, MessageEmbed } from "discord.js";
import { encrypt } from "../utils/crypt";
import { db } from "../bot";

const scopes = 'user-modify-playback-state user-read-playback-state user-read-private user-top-read user-read-recently-played';

export = async function account(msg: Message): Promise<Message> {

    let user = await db.users.get(msg.author.id);

    let state = encrypt(JSON.stringify({
        id: msg.author.id,
        timestamp: Date.now(),
        accountId: user?._id
    }));

    let embed = new MessageEmbed({
        title: 'Account Manager',
        footer: {
            text: `DO NOT SHARE ${user ? 'THESE URLS' : 'THIS URL'}`
        },
        color: 0x32CD32
    });

    let loginUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${process.env.SPOTIFY_CLIENT_ID}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(`https://${process.env.REDIRECT_URI}/login`)}&state=${state}`;
    let logoutUrl = `https://${process.env.REDIRECT_URI}/logout?token=${state}`;

    if (!user) {
        embed.description = `\`No account found\`\n\n` +
            `**[Login](${loginUrl})**\n` +
            'Saves spotify and discord account to our database.\n';
    } else {
        embed.description = `**Account Info:**\n` +
            `Discord: <@${user.id}>\n` +
            `Spotify: [${user.spotify_name}](https://open.spotify.com/user/${user.spotify_name})\n` +
            `Premium: ${user.premium}\n\n` +
            `**[Login](${loginUrl})**\n` +
            'Refreshes saved account info.\n' +
            `**[Logout](${logoutUrl})**\n` +
            'Deletes recorded spotify account and discord account.';
    };

    return await msg.author.send(embed);
};