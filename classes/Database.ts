import mongoose, { Document, Model } from "mongoose";
import log from "../utils/log";
import { Party } from "./PartyManager";
import { Stats } from "../commands/stats";

const userSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true
    },
    login_token: {
        type: String,
        required: true
    },
    refresh_token: {
        type: String,
        required: true
    },
    access_token: {
        type: String,
        required: true
    },
    premium: {
        type: Boolean,
        required: true
    },
    spotify_name: {
        type: String,
        required: true
    },
    spicetify_auth: {
        type: String,
        required: false
    }
});

const partySchema = new mongoose.Schema({
    channelId: {
        type: String,
        required: true
    },
    serverId: {
        type: String,
        required: true
    },
    messageId: {
        type: String,
        required: true
    },
    hostId: {
        type: String,
        required: true
    },
    creatorId: {
        type: String,
        required: true
    },
    partyListeners: {
        type: Array,
        required: true
    },
    timestamps: {
        activity: {
            type: Number,
            required: true
        },
        start: {
            type: Number,
            required: true
        }
    },
    local: {
        type: Boolean,
        required: true
    }
});

const statsSchema = new mongoose.Schema({
    channelId: {
        type: String,
        required: true
    },
    messageId: {
        type: String,
        required: true
    },
    userId: {
        type: String,
        required: true
    },
    creatorId: {
        type: String,
        required: true
    },
    limit: {
        type: Number,
        required: false
    },
    type: {
        type: String,
        required: true
    },
    offset: {
        type: Number,
        required: false
    },
    time: {
        type: String,
        required: false
    },
    timestamp: {
        type: Number,
        required: true
    }
});

export class DataBase {

    userColl: Model<UserDoc>
    partyColl: Model<SavedParty>;
    statColl: Model<StatsDoc>;
    running: boolean;

    public async start() {

        if (this.running) return false;

        let db = await mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

        if (db.connection.readyState == 1) log(`Connected to MongoDB`);

        this.userColl = db.model<UserDoc>('users', userSchema);

        this.partyColl = db.model<SavedParty>('parties', partySchema);

        this.statColl = db.model<StatsDoc>('stats', statsSchema);

        db.connection.on('error', e => log(`MongoDB Error: ${e}`));

        this.running = true;

    };

    /**
     * Database user collection methods
     */
    public users = {
        /**
        * Gets user from database
        @param id Discord user id
        */
        get: async (id: String): Promise<UserDoc> => {
            return await this.userColl.findOne({ id: id });
        },
        /**
        * Gets user from database
        * @param id Mongo document id
        * @returns Mongo user document
        */
        getById: async (id: string): Promise<UserDoc> => {
            return await this.userColl.findById(id);
        },
        /**
         * Gets user from database
         * @param token Encrypted state from spotify login
         * @returns Mongo user document
         */
        getByToken: async (t: string): Promise<UserDoc> => {
            return await this.userColl.findOne({ login_token: t });
        },
        /**
         * Gets user from database
         * @param token Spicetify auth token
         * @returns Mongo user document
         */
        getBySpicetify: async (t: string): Promise<UserDoc> => {
            return await this.userColl.findOne({ spicetify_auth: t });
        },
        /**
        * Gets user from database
        * @param id Discord user id
        * @param refresh Spotify api refresh token
        * @param access Spotify api access token
        * @param premium Spotify user premium status
        * @param login Encrypted state from spotify login
        * @param name Spotify username/id
        * @returns Mongo user document
        */
        save: async (id: String, refresh: String, access: String, premium: Boolean, login: string, name: string): Promise<UserDoc> => {
            let user = await this.users.get(id);
            if (!user) {
                user = new this.userColl({ id: id, refresh_token: refresh, access_token: access, premium: premium, login_token: login, spotify_name: name });
                log(`User added - Spotify: ${user.spotify_name} - Discord: \`${user.id}\``);
            } else {
                user.refresh_token = refresh, user.access_token = access, user.login_token = login;
                log(`User info refreshed - Spotify: ${user.spotify_name} - Discord: \`${user.id}\``);
            };
            return await user.save();
        },
        /**
        * Deletes user from database
        * @param id Discord user id
        */
        delete: async (id: String) => {
            let user = await this.users.get(id);
            if (!user) return false;
            try { await user.remove(); } catch { return false; }
            log(`User logged out - Spotify: ${user.spotify_name} - Discord: \`${user.id}\``);
            return true;
        }
    };

    /**
     * Database party collection methods
     */
    public parties = {
        /**
         * Gets party from database
         * @param p Resolved party object
         * @returns Party document
         */
        get: async (p: Party.Interface) => {
            return await this.partyColl.findOne({ hostId: p.host.id });
        },
        /**
         * Gets all parties from database
         * @returns Array of party documents
         */
        getAll: async () => {
            return await this.partyColl.find();
        },
        /**
         * Saves party interface to db, all discord objects are saved as ids
         * @param p Resolved party object
         * @returns Party document
         */
        save: async (p: Party.Interface) => {
            let existingParty = await this.parties.get(p);
            if (!existingParty) {
                existingParty = new this.partyColl({
                    channelId: p.message.channel.id,
                    serverId: p.message.guild.id,
                    messageId: p.message.id,
                    hostId: p.host.id,
                    creatorId: p.creator.id,
                    partyListeners: p.listeners.map(listener => listener.gm.id),
                    timestamps: {
                        activity: p.timestamps.activity,
                        start: p.timestamps.start
                    },
                    local: !!process.env.NODE_ENV
                });
            } else {
                existingParty.timestamps.activity = p.timestamps.activity;
                existingParty.partyListeners = p.listeners.map(listener => listener.gm.id);
            };
            return await existingParty.save();
        },
        /**
         * Deletes party document from db
         * @param p Resolved party object
         * @returns boolean
         */
        delete: async (p: Party.Interface) => {
            let existingParty = await this.parties.get(p);
            if (!existingParty) return false;
            try { await existingParty.remove(); } catch { return false; }
            return true;
        }
    };

    /**
     * Database stats collection methods
     */
    public stats = {
        /**
         * Gets stats message info from database
         * @returns Stats document
         */
        getOne: async (messageid?: string, channelid?: string, userid?: string, creatorid?: string) => {
            let options: any = {};
            if (messageid) options.messageId = messageid;
            if (channelid) options.channelId = channelid;
            if (userid) options.userId = userid;
            if (creatorid) options.creatorId = creatorid;
            return await this.statColl.findOne(options);
        },
        /**
         * Gets all stat docs from database
         * @returns Array of stat documents
         */
        getAll: async () => {
            return await this.statColl.find();
        },
        /**
         * Saves stats object to db, all discord objects are saved as ids
         * @param s Resolved stats object
         * @returns Stats document
         */
        save: async (s: Stats.Interface) => {
            let existingStat = await this.stats.getOne(s.message.id);
            if (!existingStat) {
                existingStat = new this.statColl({
                    channelId: s.message.channel.id,
                    messageId: s.message.id,
                    creatorId: s.creator.id,
                    userId: s.user.id,
                    type: s.type,
                    limit: s.limit,
                    offset: s.offset,
                    time: s.time,
                    timestamp: s.timestamp
                });
            } else {
                existingStat.type = s.type;
                existingStat.limit = s.limit;
                existingStat.offset = s.offset;
                existingStat.time = s.time;
            };
            await existingStat.save();
            return existingStat;
        },
        /**
         * Deletes stats doc from db
         * @param s stats message id
         * @returns boolean
         */
        delete: async (s: string) => {
            let existingStat = await this.stats.getOne(s);
            if (!existingStat) return false;
            try { await existingStat.remove(); } catch { return false; }
            return true;
        }
    };

};

/**
* Mongo user object
*/
interface User {
    /**
     * Spotify username/id
     */
    spotify_name: string
    /**
     * Encrypted state from spotify login
     */
    login_token: string
    /**
     * Discord user id
     */
    id: String
    /**
     * Spotify api refresh token
     */
    refresh_token: String
    /**
     * Spotify api access token
     */
    access_token: String
    /**
     * Spotify user premium status
     */
    premium: Boolean
    /**
     * Spicetify websocket auth token (uuid)
     */
    spicetify_auth?: string
};

/**
* Mongo user document
*/
export type UserDoc = User & Document;

interface SavedParty extends Document {
    channelId: string;
    serverId: string;
    messageId: string;
    hostId: string;
    creatorId: string;
    partyListeners: string[];
    timestamps: {
        activity: number;
        start: number;
    };
    local: boolean;
};

export interface StatsDoc extends Document {
    channelId: string,
    messageId: string,
    userId: string,
    creatorId: string,
    limit: number,
    type: Stats.Types,
    offset: number,
    time: Stats.Ranges,
    timestamp: number
};