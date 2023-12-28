const variables = 
['MONGODB_URI',
'DISCORD_BOT_TOKEN',
'SPOTIFY_CLIENT_ID',
'SPOTIFY_CLIENT_SECRET',
'ENCRYPTION_KEY',
'SERVER_ID',
'SERVER_CHANNEL_ID',
'MAIN_CHANNEL_ID',
'PARTY_TIMEOUT_MS',
'BOT_PREFIX',
'REDIRECT_URI',
'API_POLLING_MS'];

export = function validateEnv() {
    let missing = 0;
    variables.forEach(variable => {
        if (!process.env[variable]) {
            console.log(`Environment Variable Missing: ${variable}`);
            missing++;
        };
    });
    missing && process.exit();
};