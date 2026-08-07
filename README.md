
Heads up, Spotify's background playback restrictions are pretty strict.


# Spotify-Autoplay-for-Alarm-iOS

This repo houses server infrastructure and web/helper app for pushing playback to an iOS device based on some user-set alarm preferences.


## Features

- Node.js website backend using Express
- Save Spotify client credentials and alarm preferences locally
- Get Spotify device list and trigger playback via the Web API
- Python helper to run scheduled or manual playback commands from the local config

## Setup

1. Install Node dependencies:

```bash
npm install
```

2. Start the local website:

```bash
npm start
```

3. Open your browser at:

```text
https://127.0.0.1:3000
```

4. Enter your Spotify `Client ID` and `Client Secret`, then click `Authorize with Spotify`.

5. Make sure your Spotify app redirect URI is set to `https://127.0.0.1:3000/callback`.

5. Complete Spotify authorization in the new tab.

6. Configure your alarm playback preferences:

- `Device ID` / `Device Name`
- `Context URI` (playlist, album, podcast)
- `Track URIs` (comma-separated individual tracks)
- `Start time`
- `Volume`
- `Shuffle`

## Codespaces usage

When running inside GitHub Codespaces, the app is not reachable at `127.0.0.1` from your browser. Use the Codespace public URL for the website and the Spotify callback instead.

1. Forward port `3000` publicly:

```bash
gh codespace ports visibility 3000:public --codespace <your-codespace-name>
```

2. Find the public browse URL:

```bash
gh codespace ports --codespace <your-codespace-name> --json browseUrl,sourcePort
```

Look for the entry with `sourcePort: 3000`. It should look like:

```text
https://<your-codespace-name>-3000.app.github.dev
```

3. Update `data/config.json` so the redirect URI matches the public URL:

```json
{
  "redirectUri": "https://<your-codespace-name>-3000.app.github.dev/callback"
}
```

4. In the Spotify Developer Dashboard, add the same redirect URI:

```text
https://<your-codespace-name>-3000.app.github.dev/callback
```

5. Start the app:

```bash
npm start
```

6. Open the public Codespace URL in your browser and use the website from there.

7. Click `Authorize with Spotify` and complete authorization.

> Tip: the public Codespace URL may change if the Codespace is recreated, so repeat steps 1–3 when that happens.

## Python helper

The `spotify_playback_helper.py` script reads saved preferences from `data/config.json` and triggers playback using Spotify Web API. Obviously, it's not worth it keeping the server up if you're just using this for yourself. I only made the server thinking this could be a popular app, but the stale background playback issues threw a wrench in that idea.

Honestly, just make a JSON file called data/config and run the playback helper without ever having to start the server.

Run it with:

```bash
python3 spotify_playback_helper.py
```

Use this helper if you want to add a cron job or iOS integration outside the website.

## Data storage

- `data/config.json` stores Spotify app credentials and alarm preferences.
- `data/tokens.json` stores the Spotify refresh token and access token details.

## Notes

--> --> Spotify playback control requires the target iOS device to be active in the user's Spotify session.<-- <--
- The website uses the Spotify authorization code flow to obtain a refresh token.
- If you want to reuse token data, copy `config.example.json` into `data/config.json` and fill in your values.
