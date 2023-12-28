import moment from "moment-timezone"
import { logChannels } from "../bot";

export = function log(input: any, type?: 'MAIN' | 'SERVER') {
    let time = moment().tz("America/New_York").format('DD/MM/YYYY hh:mm:ss A');
    let local = !process.env.NODE_ENV ? "LOCAL " : "";
    console.log(`${local}[${time}]${type && type != 'MAIN' ? ` [${type}]` : ''} ${input}`);
    if (logChannels[type || 'MAIN']) logChannels[type || 'MAIN'].send(`${local}${type && type != 'MAIN' ? `[${type}] ` : ''}${input}`);
};