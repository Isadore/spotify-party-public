import express from "express";
import WebSocket from "ws";
import { Express } from "express-serve-static-core";
import log from "../utils/log";
import { Server, IncomingMessage } from "http";
import { db } from "../bot";
import { PlayerData, getTokens, getPlayer } from "../utils/api";
import https from "https";
import fs from "fs";
import { decrypt } from "../utils/crypt";
import path from "path";
import { Socket } from "net";
import qs from "querystring";

export = class ServerManager {

    running: boolean;
    PORT = +process.env.PORT || 3000;
    app: Express;
    server: Server;
    wss: WebSocket.Server;
    httpsOpts: https.ServerOptions;

    public start(): Promise<boolean> {

        return new Promise((resolve, reject) => {

            if (this.running) return resolve(false);

            this.httpsOpts = {
                key: fs.readFileSync('/etc/letsencrypt/live/isadore.co/privkey.pem', 'utf8'),
                cert: fs.readFileSync('/etc/letsencrypt/live/isadore.co/cert.pem', 'utf8'),
                ca: fs.readFileSync('/etc/letsencrypt/live/isadore.co/chain.pem', 'utf8')
            };

            this.app = express();

            let server = https.createServer(this.httpsOpts, this.app);

            this.server = server.listen(this.PORT, () => {

                log(`Started @ port: ${this.PORT}`, 'SERVER');

                this.wss = new WebSocket.Server({
                    noServer: true,
                    path: '/spotify-party/websocket'
                });

                this.running = true;

                this.listen();

                return resolve(true);

            });

        });

    };

    private listen() {

        if (!this.running) return false;

        this.app.all('*', (req, res, next) => {
            let ipHeader = req.headers['x-forwarded-for'];
            res.on('finish', () => {
                log(`[${req.method.toUpperCase()}] "${req.hostname}" -- "${req.originalUrl}" -- "${((ipHeader && ipHeader.toString()) ? ipHeader.toString() : false) || req.connection.remoteAddress}" -- "${res.statusCode}"${req.body ? ` -- "${req.body}"` : ""}`, 'SERVER');
            });
            next();
        });

        this.app.get('/spotify-party/login', async (req: any, res) => {

            if (!req.query.code || !req.query.state) return res.status(400).send('Invalid Parameters');

            let token: {
                id: string,
                timestamp: number,
                accountId?: string   
            };
            
            try {
                token = JSON.parse(decrypt(req.query.state));
            } catch (ex) {
                return res.status(400).send('Invalid Parameters');
            };

            switch (true) {
                case token.accountId && !(await db.users.getById(token.accountId)):
                case !token.accountId && !!(await db.users.get(token.id)):
                case Date.now() >= token.timestamp + 300000:
                case !!(await db.users.getByToken(req.query.state)):
                    return res.status(400).send('URL Expired');
            };

            try {

                let user = await getTokens(req.query.code, token.id, req.query.state);

                if (user) {
                    return res.status(200).send('Login Successful');
                } else {
                    return res.status(500).send(`Login Failed`);
                };

            } catch (ex) {

                return res.status(500).send(`Login Failed`);

            };

        });

        this.app.get('/spotify-party/logout', async (req: any, res) => {

            if (!req.query.token) return res.status(400).send('Invalid Parameters');

            let token: any
            try {
                token = JSON.parse(decrypt(req.query.token));
            } catch (ex) {
                return res.status(400).send('Invalid Parameters');
            };

            switch (true) {
                case !token.id:
                case !token.timestamp:
                case !token.accountId:
                    return res.status(400).send('Invalid Parameters');
                case !(await db.users.getById(token.accountId)):
                case Date.now() >= token.timestamp + 300000:
                    return res.status(400).send('URL Expired');
            };

            if (await db.users.delete(token.id)) return res.status(200).send('Account deleted');
            else return res.status(400).send('Account not found');

        });

        this.app.get('/spotify-party/spotify-logo.png', (req, res) => {
            return res.status(200).sendFile(path.join(__dirname, '../../assets/spotify-logo.png'))
        });

        this.app.get('/spotify-party/getuserplayer', async (req, res) => {

            if(req.headers['x-api-key'] != 'bb2ebd0f-6164-4525-808d-c6cac31f17a7') return res.sendStatus(404);

            let discordId = req.query.id as string;
            if(!discordId) return res.sendStatus(404);

            let user = await db.users.get(discordId);
            if(!user) return res.sendStatus(400);

            return res.status(200).send(await getPlayer(user));

        });

        this.app.get('/spotify-party', (req, res) => {
            return res.status(200).send('Spotify Party discord bot site, not affiliated with Spotify AB')
        });

        this.app.get('/redirect/*', (req, res) => {

            let keyMatch = req.path.match(/(?<=redirect\/)[^\/]+/);

            let redirKeys = {
                'c4477b93-71cf-4ff2-ace4-749943ec0e39' : 'newmusic://auth'
            };

            if (keyMatch && redirKeys[keyMatch[0]]) {
                let redir_url = redirKeys[keyMatch[0]];
                let querystring = qs.stringify(req.query as qs.ParsedUrlQueryInput);
                let finalURL = redir_url + (Object.keys(req.query).length ? ('?' + querystring) : '');
                return res.redirect(finalURL);
            };

            return res.sendStatus(404);

        });

        this.app.get('/', (req, res) => res.sendStatus(200));

        this.app.all('*', (req, res) => res.sendStatus(404));

        this.wss.on('connection', (ws) => {

            log(`[WS] Client connected \`${ws.protocol.substr(0, 8)}\``, 'SERVER');

            setInterval(() => {
                ws.send(JSON.stringify({
                    type: 'ping',
                    uri: null,
                    timestamp: Date.now()
                }));
            }, 25000);

            ws.on('close', (code, reason) => {
                log(`[WS] Client disconnected \`${ws.protocol.substr(0, 8)}\`${ws.protocol.endsWith('--inactive') ? " (Client Inactive)" : ''} - ${reason || code}`, 'SERVER');
            });

        });


        this.server.on('upgrade', async (request: IncomingMessage, socket: Socket, head: Buffer) => {

            let token = request.headers['sec-websocket-protocol'];

            log(`[WS] Client connecting... ${token}`, 'SERVER');

            if (!token || Array.isArray(token) || (token.length != 36 && token.length != 73)) {
                log(`[WS] Connection failed, invalid token format ${token}`, 'SERVER')
                return socket.destroy();
            };

            if(token.length == 36) {
                let user = await db.users.getBySpicetify(token);

                if (!user) {
                    log(`[WS] Connection failed, user not found ${token}`, 'SERVER');
                    return socket.destroy();
                };
    
                let ec = this.getClient(token);
    
                if (ec) {
                    log(`[WS] User already connected, deactivating old socket... \`${token.substr(0, 8)}\``, 'SERVER');
                    ec.send(JSON.stringify({
                        type: 'inactive',
                        uri: null,
                        timestamp: Date.now()
                    }));
                    ec.protocol = ec.protocol + '--inactive';
                };

                this.wss.handleUpgrade(request, socket, head, webSocket => {
                    this.wss.emit('connection', webSocket, request);
                });

            }
        });

    };

    public wsMessage(token: string, type: 'play' | 'pause' | 'next' | 'previous', track?: PlayerData) {

        if (!this.running) return false;
        let client = this.getClient(token);
        if (!client) return false;

        try {
            client.send(JSON.stringify({
                type: type,
                uri: track?.data?.item?.uri || null,
                timestamp: track?.data?.progress_ms || null
            }));
        } catch {
            return false;
        };

        return true;

    };

    public getClient(protocol: string) {
        if (!this.running) return false;
        let clientArr: WebSocket[] = [];
        this.wss.clients.forEach(client => clientArr.push(client));
        return clientArr.find(client => client.protocol == protocol && client.protocol.length == 36);
    };

    public stop(): boolean {
        if (!this.running) return false;
        this.app = null;
        this.server = null;
        this.wss = null;
        this.httpsOpts = null;
        this.running = false;
        return true;
    };

};