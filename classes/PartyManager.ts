import { GuildMember, Message, PartialMessage, PartialUser, User } from "discord.js";
import { getPlayer, startTrack, stopTrack, PlayerData, isTrack } from "../utils/api";
import { UserDoc } from "./Database";
import embed from "../utils/embed";
import log from "../utils/log";
import { db, sm } from "../bot";

export class PartyManager {

    running: boolean = false;
    parties: Party.Interface[] = [];
    interval: NodeJS.Timeout;

    private updateParties() {

        this.parties.forEach(async party => {

            if (party.timestamps.activity < (Date.now() - (+process.env.PARTY_TIMEOUT_MS))) return this.removeParty(party.host.user);

            let host = await db.users.get(party.host.id);
            if (!host) return this.removeParty(party.host.user);
            let currentTrack = await getPlayer(host);

            let listenerUpdate = false;

            let plcount = party.listeners.length;
            for (let pli = 0; pli < plcount; pli++) {

                let listener = party.listeners[pli];

                let user: UserDoc = await db.users.get(listener.gm.id);

                if (!user?.premium && !user?.spicetify_auth) return this.removePartyListener(listener.gm.user);

                let socketStatus: boolean;

                if (!user?.premium && user?.spicetify_auth) socketStatus = !!sm.getClient(user?.spicetify_auth);

                let track = await getPlayer(user);

                //User Status Update?
                switch (true) {
                    case listener.socketConnected != socketStatus:
                    case !listener.player != !track:
                    case listener.player?.status != track?.status:
                    case !listener.player?.data != !track?.data:
                    case listener.player?.data?.device?.type != track?.data?.device?.type:
                    case listener.player?.data?.device?.is_active != track?.data?.device?.is_active:
                    case listener.player?.data?.device?.is_private_session != track?.data?.device?.is_private_session:
                    case listener.player?.data?.is_playing != track?.data?.is_playing:
                        listenerUpdate = true;
                };

                listener.socketConnected = socketStatus;
                listener.player = track;

                //Web API/Device Restrictions?
                if (user.premium && (track?.data?.device?.is_restricted || !track?.data?.device?.is_active || track?.data?.device?.is_private_session)) return;
                //Activity?
                if (currentTrack?.data?.is_playing && track?.data?.is_playing) party.timestamps.activity = Date.now();
                //Ad?
                if (track?.data?.currently_playing_type == 'ad') return;
                //Pause?
                switch (true) {
                    case track?.data?.actions?.disallows?.pausing:
                        break;
                    case !currentTrack && track?.data?.is_playing == true:
                    case currentTrack?.data?.currently_playing_type != "track":
                    case currentTrack?.data?.is_playing == false:
                    case isTrack(currentTrack?.data?.item) && currentTrack?.data?.item?.is_local == true:
                        await stopTrack(user); continue;
                };
                //Play?
                switch (true) {
                    case !(currentTrack?.data?.is_playing):
                    case track?.data?.actions?.disallows?.seeking:
                    case isTrack(currentTrack?.data?.item) && currentTrack?.data?.item?.is_local == true:
                        break;
                    case track?.status == null:
                    case track?.data?.is_playing == false && currentTrack?.data?.is_playing == true:
                    case track?.data?.progress_ms <= (currentTrack?.data?.progress_ms - 5000):
                    case track?.data?.progress_ms >= (currentTrack?.data?.progress_ms + 5000):
                    case track?.data?.item?.id != currentTrack?.data?.item?.id:
                        await startTrack(user, currentTrack);
                };

            };

            //Embed Update?
            switch (true) {
                case listenerUpdate:
                case !currentTrack != !party?.track:
                case !currentTrack?.data != !party?.track?.data:
                case currentTrack?.data?.is_playing != party?.track?.data?.is_playing:
                case currentTrack?.data?.currently_playing_type != party?.track?.data?.currently_playing_type:
                case currentTrack?.data?.item?.id != party?.track?.data?.item?.id:
                    party.track = currentTrack; await party.message.edit('', embed(party));
            };

            party.track = currentTrack;

        });

    };

    public start(existingParties: Party.Interface[]): boolean {
        if (this.running) return false;
        this.parties = existingParties;
        this.running = true;
        this.interval = setInterval(() => this.updateParties(), +process.env.API_POLLING_MS);
        return true;
    };

    public stop(): boolean {
        if (this.interval) {
            clearInterval(this.interval);
            this.running = false;
            return true;
        };
        return false;
    };

    public async addPartyListener(message: Message, user: GuildMember): Promise<boolean> {
        let dbUser = await db.users.get(user.id);
        if (!dbUser?.premium && !dbUser?.spicetify_auth) return false;
        let existingParty = this.getParty(user);
        if (existingParty.roles.includes("host") || existingParty.roles.includes("listener")) return false;
        let search = this.getParty(message);
        if (search.party) {
            search.party.listeners.push({ gm: user });
            await db.parties.save(search.party);
            await search.party.message.edit('', embed(search.party));
        };
        return !!search.party || undefined;
    };

    public async removePartyListener(user: User | PartialUser): Promise<boolean> {
        let search = this.getParty(user);
        if (search.roles.includes('listener')) {
            search.party.listeners.splice(search.party.listeners.findIndex(pl => pl.gm.id == user.id), 1);
            await search.party.message.edit('', embed(search.party));
            await db.parties.save(search.party);
        };
        return search.roles.includes('listener') || undefined;
    };

    public async addParty(party: Party.Interface) {
        this.parties.push(party);
        await db.parties.save(party);
        log(`Party started by: \`${party.creator.user.tag}\`|\`${party.creator.id}\` - Total parties: ${this.parties.length}`);
    };

    public removeParty(input: User | PartialUser | Message | PartialMessage): boolean {
        let search = this.getParty(input);
        if (!search.party) return false;
        if (input instanceof User) {
            if (search.roles.includes("host") || search.roles.includes("creator")) {
                let partyIndex = this.parties.findIndex(p => p.message.id == search.party.message.id);
                this.parties.splice(partyIndex, 1);
                search.party.timestamps.end = Date.now();
                search.party.message.edit('', embed(search.party));
                try { search.party.message.reactions.removeAll(); } catch (ex) { log(`Failed removing reactions: ${ex}`) };
                db.parties.delete(search.party);
                log(`Party ended by: \`${input.tag}\`|\`${input.id}\` - Total parties: ${this.parties.length}`);
            };
            return (search.roles.includes("host") || search.roles.includes("creator")) || undefined;
        };
        if (input instanceof Message) {
            let partyIndex = this.parties.findIndex(p => p.message.id == search.party.message.id);
            this.parties.splice(partyIndex, 1);
            db.parties.delete(search.party);
            log(`Party ended by message deletion - Total parties: ${this.parties.length}`);
            input.channel.send(`<@${search.party.creator.id}>, Your party ${search.party.creator.id != search.party.host.id ? `hosted by \`${search.party.host.displayName}\` ` : ""}was ended due to its embed being deleted.`);
            return true;
        };
    };

    public getParty(input: User | PartialUser | GuildMember | Message | PartialMessage): Party.Search {
        let result: Party.Search = { roles: [], party: undefined };
        if (input instanceof User || input instanceof GuildMember) {
            (['host', 'creator'] as ['host', 'creator']).forEach(t => {
                let party = this.parties.find(party => party[t].id == input.id);
                if (party) {
                    result.roles.push(t);
                    result.party = party;
                };
            });
            let l = this.parties.find(party => party.listeners.find(pl => pl.gm.id == input.id));
            if (l) {
                result.roles.push('listener');
                result.party = l;
            };
        };
        if (input instanceof Message) {
            let m = this.parties.find(party => party.message.id == input.id);
            result.party = m;
        };
        return result;
    };

};

export namespace Party {
    export interface Interface {
        creator: GuildMember;
        message: Message;
        listeners: Listener[];
        host: GuildMember;
        track: PlayerData;
        timestamps: {
            activity: number;
            start: number;
            end?: number;
        };
    };
    export interface Listener {
        gm: GuildMember,
        player?: PlayerData,
        socketConnected?: boolean
    };
    export interface Search {
        roles: Array<"host" | "creator" | "listener">;
        party: Interface;
    };
};