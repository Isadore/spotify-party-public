import { UserDoc } from "../classes/Database";
import urllib, { HttpClientResponse, RequestOptions } from "urllib";
import log from "./log";
import { db, sm } from "../bot";

export async function getTokens(code: String, id: String, loginToken: string): Promise<UserDoc> {

    let r: HttpClientResponse<any>;
    try {
        r = await urllib.request('https://accounts.spotify.com/api/token', {
            method: 'POST',
            data: {
                'client_id': process.env.SPOTIFY_CLIENT_ID,
                'client_secret': process.env.SPOTIFY_CLIENT_SECRET,
                'grant_type': 'authorization_code',
                'code': code,
                'redirect_uri': `https://${process.env.REDIRECT_URI}/login`
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            dataType: "json",
            contentType: "json"
        });
    } catch (e) {
        log(`GET https://accounts.spotify.com/api/token FAILED: ${e.message}`);
        return undefined;
    };

    if (r.status == 200) {
        let spotifyAcc: Spotify.User = await getSpotifyUser(r.data.access_token);
        let premium = (spotifyAcc?.product == "premium");
        return await db.users.save(id, r.data.refresh_token, r.data.access_token, premium, loginToken, spotifyAcc.id);
    } else {
        console.log(r);
        return undefined;
    };
};

export async function refreshToken(user: UserDoc) {
    let r: HttpClientResponse<any>;
    try {
        r = await urllib.request('https://accounts.spotify.com/api/token', {
            method: 'POST',
            data: {
                'grant_type': 'refresh_token',
                'refresh_token': user.refresh_token,
                'client_id': process.env.SPOTIFY_CLIENT_ID,
                'client_secret': process.env.SPOTIFY_CLIENT_SECRET
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            dataType: "json",
            contentType: "json"
        });
    } catch (e) {
        return log(`REFRESH https://accounts.spotify.com/api/token FAILED: ${e.message}`);
    }

    if (r.status == 200) {
        let spotifyAcc: Spotify.User = await getSpotifyUser(r.data.access_token);
        let premium = (spotifyAcc?.product == "premium")
        return await db.users.save(user.id, user.refresh_token, r.data.access_token, premium, user.login_token, spotifyAcc.id);
    } else {
        console.log(r);
        return false;
    };
};

/**
 * Get Information About The User's Current Playback
 * @param user Mongodb user doc
 * @param market Optional. An ISO 3166-1 alpha-2 country code or the string from_token. Provide this parameter if you want to apply Track Relinking.
 * @param additional_types Optional. A comma-separated list of item types that your client supports besides the default track type. Valid types are: track and episode. An unsupported type in the response is expected to be represented as null value in the item field. Note: This parameter was introduced to allow existing clients to maintain their current behaviour and might be deprecated in the future. In addition to providing this parameter, make sure that your client properly handles cases of new types in the future by checking against the currently_playing_type field.
 * @returns A successful request will return a 200 OK response code with a json payload that contains information about the current playback. The information returned is for the last known state, which means an inactive device could be returned if it was the last one to execute playback. When no available devices are found, the request will return a 200 OK response but with no data populated.
 */
export async function getPlayer(user: UserDoc, market?: IsoStrings, additional_types?: string): Promise<PlayerData> {
    let req: Request = {
        codes: [200, 204],
        path: '/player',
        options: { method: 'GET', data: {}, dataAsQueryString: true }
    };
    market && (req.options.data.market = market);
    additional_types && (req.options.data.additional_types = additional_types);
    return await api(req, (req: Request) => {
        let track: PlayerData = {};
        if (req.r.status == 200) {
            track.status = !!req.r.data;
            track.data = req.r.data;
        };
        if (req.r.status == 204)
            track.status = null;
        return track;
    }, user);
};

export async function startTrack(user: UserDoc, track?: PlayerData): Promise<boolean> {
    if (user.spicetify_auth && sm.getClient(user.spicetify_auth)) {
        return sm.wsMessage(user.spicetify_auth, 'play', track);
    } else if (user.premium) {
        let req: Request = {
            codes: [200, 204, 404],
            path: '/player/play',
            options: {
                method: 'PUT',
                contentType: "json"
            }
        }
        if(track) {
            req.options.data = {
                uris: [track.data.item.uri],
                position_ms: `${track.data.progress_ms ?? 0}`
            }
        }
        return await api(req, (req: Request) => {
            if (req.r.status != 404) return true;
            return null;
        }, user);
    }
};

export async function stopTrack(user: UserDoc): Promise<boolean> {
    if (user.spicetify_auth && sm.getClient(user.spicetify_auth)) {
        return sm.wsMessage(user.spicetify_auth, 'pause');
    } else if (user.premium) {
        return await api({
            codes: [200, 204],
            path: '/player/pause',
            options: { method: 'PUT' }
        }, () => {
            return true;
        }, user);
    }
};

export async function skipTrack(user: UserDoc, direction: "next" | "previous"): Promise<boolean> {
    if (user.spicetify_auth && sm.getClient(user.spicetify_auth)) {
        return sm.wsMessage(user.spicetify_auth, direction);
    } else if (user.premium) {
        return await api({
            codes: [200, 204],
            path: '/player/' + direction,
            options: { method: 'POST' }
        }, () => {
            return true;
        }, user);
    }
}

export async function getSpotifyUser(access_token?: String, user?: UserDoc): Promise<Spotify.User> {
    let req: Request = {
        codes: [200],
        path: '',
        options: { method: 'GET' }
    };
    !user && (req.options.headers = { authorization: `Bearer ${access_token}` });
    return await api(req, async (req: Request) => {
        if (access_token) return req.r.data;
        return (req.r.data.product == "premium");
    }, user);
};

/**
 * Gets list of top tracks or artists from spotify api
 * @param user Mongo user doc
 * @param type The type of entity to return. Valid values: artists or tracks.
 * @param time_range Optional. Over what time frame the affinities are computed. Valid values: long_term (calculated from several years of data and including all new data as it becomes available), medium_term (approximately last 6 months), short_term (approximately last 4 weeks). Default: medium_term.
 * @param limit Optional. The number of entities to return. Default: 20. Minimum: 1. Maximum: 50. For example: limit=2
 * @param offset Optional. The index of the first entity to return. Default: 0 (i.e., the first track). Use with limit to get the next set of entities.
 * @returns On success, the HTTP status code in the response header is 200 OK and the response body contains a paging object of Artists or Tracks. On error, the header status code is an error code and the response body contains an error object.
 */
export async function top(user: UserDoc, type: 'artists' | 'tracks', time_range: 'long_term' | 'medium_term' | 'short_term', limit: number, offset: number | string): Promise<Spotify.PagingObject | 403> {
    return await api({
        codes: [200, 403],
        path: `/top/` + type,
        options: {
            method: 'GET',
            data: {
                limit,
                time_range,
                offset
            },
            dataAsQueryString: true
        }
    }, (req: Request) => {
        if (req.r.status == 403) return 403;
        else return req.r.data;
    }, user);
};

/**
 * Get Current User's Recently Played Tracks
 * @param user Mongodb user doc
 * @param limit Optional. The maximum number of items to return. Default: 20. Minimum: 1. Maximum: 50.
 * @param after Optional. A Unix timestamp in milliseconds. Returns all items after (but not including) this cursor position. If after is specified, before must not be specified.
 * @param before Optional. A Unix timestamp in milliseconds. Returns all items before (but not including) this cursor position. If before is specified, after must not be specified.
 * @returns On success, the HTTP status code in the response header is 200 OK and the response body contains an array of play history objects (wrapped in a cursor-based paging object) in JSON format. The play history items each contain the context the track was played from (e.g. playlist, album), the date and time the track was played, and a track object (simplified). On error, the header status code is an error code and the response body contains an error object. If private session is enabled the response will be a 204 NO CONTENT with an empty payload.
 */
export async function recent(user: UserDoc, limit: number, after?: number, before?: number): Promise<Spotify.PagingObject | 403> {
    let req: Request = {
        codes: [200, 403],
        path: `/player/recently-played`,
        options: { method: 'GET', data: {}, dataAsQueryString: true }
    };
    limit && (req.options.data.limit = limit);
    after && (req.options.data.after = after);
    before && (req.options.data.before = before);
    return await api(req, (req: Request) => {
        if (req.r.status == 403) return 403;
        else {
            // turn array of playhistory objects into array of simplified track objects;
            req.r.data.items = req.r.data.items.map((o: Spotify.Misc.PlayHistory) => o.track);
            return req.r.data;
        };
    }, user);
};

/**
 * Get a playlist owned by a Spotify user.
 * @param user Mongodb user doc
 * @param playlist_id The Spotify ID for the playlist.
 * @param market An ISO 3166-1 alpha-2 country code or the string from_token. Provide this parameter if you want to apply Track Relinking. For episodes, if a valid user access token is specified in the request header, the country associated with the user account will take priority over this parameter. Note: If neither market or user country are provided, the episode is considered unavailable for the client.
 * @param fields Filters for the query: a comma-separated list of the fields to return. If omitted, all fields are returned. For example, to get just the playlist’’s description and URI: fields=description,uri. A dot separator can be used to specify non-reoccurring fields, while parentheses can be used to specify reoccurring fields within objects. For example, to get just the added date and user ID of the adder: fields=tracks.items(added_at,added_by.id). Use multiple parentheses to drill down into nested objects, for example: fields=tracks.items(track(name,href,album(name,href))). Fields can be excluded by prefixing them with an exclamation mark, for example: fields=tracks.items(track(name,href,album(!name,href)))
 * @param additional_types A comma-separated list of item types that your client supports besides the default track type. Valid types are: track and episode. Note: This parameter was introduced to allow existing clients to maintain their current behaviour and might be deprecated in the future. In addition to providing this parameter, make sure that your client properly handles cases of new types in the future by checking against the type field of each object.
 * @returns On success, the response body contains a playlist object in JSON format and the HTTP status code in the response header is 200 OK. If an episode is unavailable in the given market, its information will not be included in the response. On error, the header status code is an error code and the response body contains an error object. Requesting playlists that you do not have the user’s authorization to access returns error 403 Forbidden.
 */
export async function getPlaylist(user: UserDoc, playlist_id: string, market?: IsoStrings, fields?: string[], additional_types?: 'track' | 'episode'): Promise<Spotify.Playlist> {
    let req: Request = {
        codes: [200, 403],
        path: `/playlists/${playlist_id}`,
        URLOverride: `https://api.spotify.com/v1`,
        options: { method: "GET", data: {} }
    };
    market && (req.options.data.market = market);
    fields && (req.options.data.fields = fields.join("|"));
    additional_types && (req.options.data.additional_types = additional_types);
    return await api(req, (req: Request) => {
        if(req.r.status == 200) return req.r.data;
        return undefined;
    }, user);
};

async function api(req: Request, callback: (req: Request) => any, user?: UserDoc) {
    if (user) {
        user = await db.users.get(user.id);
        if (req.options.headers) req.options.headers.authorization = `Bearer ${user.access_token}`;
        else req.options.headers = { authorization: `Bearer ${user.access_token}` };
    };
    req.options.dataType = "json";
    let url = (req.URLOverride || 'https://api.spotify.com/v1/me') + (req.path || '');
    try {
        req.r = await urllib.request(url, req.options);
    } catch (e) {
        req.e = e;
        log(`${req.options.method} ${url} FAILED: ${e.name}`);
        return undefined;
    };
    if (req.codes.includes(req.r.status) || !req.codes.length) return await callback(req);
    if (req.r.status == 401 && user) {
        await refreshToken(user);
        return await api(req, callback, user);
    } else {
        let message = `${req.r?.data?.error?.message ? " - " + req.r.data.error.message : ""}`;
        log(`${req.options.method} ${url} Unexpected response: ${req.r.res.statusCode} - ${req.r.res.statusMessage}${message}`);
    };
    return false;
};

export function isEpisode(obj: any): obj is Spotify.Items.Episode {
    return obj?.type == "episode"
}

export function isTrack(obj: any): obj is Spotify.Items.Track {
    return obj?.type == "track";
}

interface Request<T = any> {
    codes: number[];
    e?: Error;
    r?: HttpClientResponse<T>;
    path: string;
    URLOverride?: string;
    options: RequestOptions;
};

export interface PlayerData {
    status?: Boolean;
    data?: Spotify.Context.CurrentlyPlaying;
};

export namespace Spotify {
    export interface User {
        country?: string;
        display_name: string | null;
        email?: string;
        external_urls: External.URL;
        folllowers: {
            href: null;
            total: number;
        };
        href: string;
        id: string;
        images: Misc.Image[];
        product?: "premium" | "free" | "open";
        type: "user";
        uri: string;
    };
    export interface Playlist {
        collaborative: boolean;
        description: string;
        external_urls: External.URL;
        followers: Misc.Followers;
        href: string;
        id: string;
        images: Misc.Image[];
        name: string;
        owner: PublicUserObject;
        public: boolean | null;
        snapshot_id: string;
        tracks: (PlaylistTrackObject | null)[];
        type: "playlist";
        uri: string;
    };
    export interface PlaylistTrackObject {
        added_at: number | null; // timestamp?
        added_by: PublicUserObject;
        is_local: boolean;
        track: Items.Track | Items.Episode;
    };
    export interface PublicUserObject {
        display_name: string;
        external_urls: External.URL;
        followers: Misc.Followers;
        href: string;
        id: string;
        images: Misc.Image[];
        type: "user";
        uri: string;
    }
    export interface Device {
        id: string | null;
        is_active: Boolean;
        is_restricted: Boolean;
        is_private_session: Boolean;
        name: string;
        type: "Computer" | "Tablet" | "Smartphone" | "Speaker" | "TV" | "AVR" | "STB" | "AudioDongle" | "GameConsole" | "CastVideo" | "CastAudio" | "Automobile" | "Unknown";
        volume_percent: Number | null;
    };
    export interface PagingObject {
        href: string;
        limit: number;
        next: string;
        offset: number;
        previous: string;
        total: number;
        items: Items.Track[] | Items.Artist[];
    };
    export namespace Context {
        export interface CurrentlyPlaying {
            timestamp: number | null;
            device: Device
            progress_ms: number;
            status: Boolean;
            is_playing: Boolean;
            currently_playing_type: "track" | "episode" | "unknown" | "ad" | "unknown";
            actions: Misc.Disallows;
            item: Items.Track | Items.Episode;
            shuffle_state: Boolean;
            repeat_state: "off" | any;
            context: Default | null;
        };
        export interface Default {
            external_urls: External.URL;
            href: string;
            type: "album" | "artist" | "playlist";
            uri: string;
        };
    };
    export namespace Items {
        export interface Track {
            album: Simplified.Album;
            artists: Simplified.Artist[];
            available_markets: Array<IsoStrings>;
            disc_number: number;
            duration_ms: number;
            explicit: Boolean;
            external_ids: External.ID;
            external_urls: External.URL;
            href: string;
            id: string;
            is_playable: Boolean;
            linked_from: Misc.TrackLink;
            restrictions: Misc.Restrictions;
            name: string;
            popularity: number;
            preview_url: string | null;
            track_number: number;
            type: "track";
            uri: string;
            is_local: Boolean;
        };
        export interface Artist extends Simplified.Artist {
            followers: Misc.Followers;
            genres: string[];
            images: Misc.Image[];
            popularity: number;
        };
        export interface Episode {
            audio_preview_url: string;
            description: string;
            duration_ms: number;
            explicit: boolean;
            external_urls: External.URL;
            href: string;
            id: string;
            images: Misc.Image[];
            is_externally_hosted: boolean;
            is_playable: boolean;
            language?: string;
            languages: string[];
            name: string;
            release_date: string;
            release_date_precision: string;
            resume_point: string;
            show: Simplified.Show;
            type: "episode";
            uri: string;
        };
        export namespace Simplified {
            export interface Artist {
                external_urls: External.URL;
                href: string;
                id: string;
                name: string;
                type: "artist";
                uri: string;
            };
            export interface Show {
                available_markets: Array<IsoStrings>;
                copyrights: Misc.Copyright[];
                description: string;
                excplicit: boolean;
                external_urls: External.URL;
                href: string;
                id: string;
                images: Misc.Image[];
                is_externally_hosted: boolean;
                languages: string[];
                media_type: string;
                name: string;
                publisher: string;
                type: "show";
                uri: string;
            };
            export interface Album {
                album_group?: string;
                album_type: string;
                artists: Artist[];
                available_markets: Array<IsoStrings>;
                external_urls: External.URL;
                href: string;
                id: string;
                images: Misc.Image[];
                name: string;
                release_date: string;
                release_date_precision: "year" | "month" | "day";
                type: "album";
                restrictions: Misc.Restrictions;
                uri: string;
            };
            export interface Track {
                artists: Artist[];
                available_markets: Array<IsoStrings>;
                disc_number: number;
                duration_ms: number
                explicit: boolean;
                external_urls: External.URL;
                href: string;
                is_playable: boolean;
                linked_from: Misc.TrackLink;
                restrictions: Misc.Restrictions;
                name: string;
                preview_url: string;
                track_number: number;
                type: "track";
                uri: string;
                is_local: boolean;
            };
        };
    };
    export namespace Misc {
        export interface Disallows {
            disallows: {
                interrupting_playback?: Boolean;
                pausing?: Boolean;
                resuming?: Boolean;
                seeking?: Boolean;
                skipping_next?: Boolean;
                skipping_prev?: Boolean;
                toggling_repeat_context?: Boolean;
                toggling_shuffle?: Boolean;
                toggling_repeat_track?: Boolean;
                transferring_playback?: Boolean;
            };
        };
        export interface PlayHistory {
            track: Items.Simplified.Track
            /**
             * ISO 8601 format as Coordinated Universal Time (UTC) with a zero offset: YYYY-MM-DDTHH:MM:SSZ
             */
            played_at: string;
            context: Context.Default
        };
        export interface Copyright {
            text: string;
            type: string;
        };
        export interface Image {
            height: number | null
            url: string
            width: number | null
        };
        export interface Followers {
            href: string | null;
            total: number;
        };
        export interface TrackLink {
            external_urls: External.URL;
            href: string;
            id: string;
            type: "track";
            uri: string;
        };
        export interface Restrictions {
            reason: string;
        };
    };
    export namespace External {
        export type ID = {
            [key in "isrc" | "ean" | "upc"]: string;
        };
        export interface URL {
            [key: string]: string
        };
    };
};

type IsoStrings = "AD" | "AE" | "AF" | "AG" | "AI" | "AL" | "AM" | "AO" | "AQ" | "AR" | "AS" | "AT" | "AU" | "AW" | "AX" | "AZ" | "BA" | "BB" | "BD" | "BE" | "BF" | "BG" | "BH" | "BI" | "BJ" | "BL" | "BM" | "BN" | "BO" | "BQ" | "BQ" | "BR" | "BS" | "BT" | "BV" | "BW" | "BY" | "BZ" | "CA" | "CC" | "CD" | "CF" | "CG" | "CH" | "CI" | "CK" | "CL" | "CM" | "CN" | "CO" | "CR" | "CU" | "CV" | "CW" | "CX" | "CY" | "CZ" | "DE" | "DJ" | "DK" | "DM" | "DO" | "DZ" | "EC" | "EE" | "EG" | "EH" | "ER" | "ES" | "ET" | "FI" | "FJ" | "FK" | "FM" | "FO" | "FR" | "GA" | "GB" | "GD" | "GE" | "GF" | "GG" | "GH" | "GI" | "GL" | "GM" | "GN" | "GP" | "GQ" | "GR" | "GS" | "GT" | "GU" | "GW" | "GY" | "HK" | "HM" | "HN" | "HR" | "HT" | "HU" | "ID" | "IE" | "IL" | "IM" | "IN" | "IO" | "IQ" | "IR" | "IS" | "IT" | "JE" | "JM" | "JO" | "JP" | "KE" | "KG" | "KH" | "KI" | "KM" | "KN" | "KP" | "KR" | "KW" | "KY" | "KZ" | "LA" | "LB" | "LC" | "LI" | "LK" | "LR" | "LS" | "LT" | "LU" | "LV" | "LY" | "MA" | "MC" | "MD" | "ME" | "MF" | "MG" | "MH" | "MK" | "ML" | "MM" | "MN" | "MO" | "MP" | "MQ" | "MR" | "MS" | "MT" | "MU" | "MV" | "MW" | "MX" | "MY" | "MZ" | "NA" | "NC" | "NE" | "NF" | "NG" | "NI" | "NL" | "NO" | "NP" | "NR" | "NU" | "NZ" | "OM" | "PA" | "PE" | "PF" | "PG" | "PH" | "PK" | "PL" | "PM" | "PN" | "PR" | "PS" | "PT" | "PW" | "PY" | "QA" | "RE" | "RO" | "RS" | "RU" | "RW" | "SA" | "SB" | "SC" | "SD" | "SE" | "SG" | "SH" | "SI" | "SJ" | "SK" | "SL" | "SM" | "SN" | "SO" | "SR" | "SS" | "ST" | "SV" | "SX" | "SY" | "SZ" | "TC" | "TD" | "TF" | "TG" | "TH" | "TJ" | "TK" | "TL" | "TM" | "TN" | "TO" | "TR" | "TT" | "TV" | "TW" | "IS" | "TZ" | "UA" | "UG" | "UM" | "US" | "UY" | "UZ" | "VA" | "VC" | "VE" | "VG" | "VI" | "VN" | "VU" | "WF" | "WS" | "YE" | "YT" | "ZA" | "ZM" | "ZW";