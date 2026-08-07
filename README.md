# Spotify-Autoplay-for-Alarm-iOS

This repo hosts a local website and helper apps for connecting to Spotify, saving alarm preferences, and triggering playback on an iOS device.

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

## Python helper

The `spotify_playback_helper.py` script reads saved preferences from `data/config.json` and triggers playback using Spotify Web API.

Run it with:

```bash
python3 spotify_playback_helper.py
```

Use this helper if you want to add a cron job or iOS integration outside the website.

## Data storage

- `data/config.json` stores Spotify app credentials and alarm preferences.
- `data/tokens.json` stores the Spotify refresh token and access token details.

## Notes

- Spotify playback control requires the target iOS device to be active in the user's Spotify session.
- The website uses the Spotify authorization code flow to obtain a refresh token.
- If you want to reuse token data, copy `config.example.json` into `data/config.json` and fill in your values.
