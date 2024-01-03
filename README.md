## Spotify Party Discord App

This was created to allow spotify premium and free users to listen to their music in sync before spotify implemented their own group listening feature.

### Features:

- Group Listening
- View Spotify Statistics
  - Top Tracks
  - Top Artists
  - Top Albums
  - Current Playing Track
- Controls via discord message interactions before discord implemented their own embedded buttons

### Technologies Used
- MongoDB
  - Stores User Login Data and all discord message data of active listening groups and statistic messages
  - Storing message IDs is necessary to listen for interaction events in the case of a restart or update to the server
- Express Server
  - Spotify OAuth Login + Logout
  - Websockets for communication with spotify client if user does not have a premium/paid spotify account
- Other/Basic
  - Web Requests
  - HTML
  - Discord and Spotify API
  - "Spicetify" integration for free users
  - Encryption for user's spotify api keys/logins
  - HTTPS Server
  - Typescript
  - Environment variables for private variables outside of github
 
### Sample Images
![Main](https://github.com/Isadore/spotify-party-public/blob/main/readme/party.png)

![Stats](https://github.com/Isadore/spotify-party-public/blob/main/readme/stats.png)

![Track](https://github.com/Isadore/spotify-party-public/blob/main/readme/track.png)
