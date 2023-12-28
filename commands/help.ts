import { Message } from "discord.js";

export = function help(msg: Message) {
    return msg.reply(`${process.env.BOT_PREFIX} <\`account\`|\`stats\`|\`track\`|\`join\`|\`end\`|\`leave\`|\`help\`>`);
};