import json
import os
import time
from typing import Dict, Optional

import requests

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
CONFIG_PATH = os.path.join(DATA_DIR, 'config.json')
TOKENS_PATH = os.path.join(DATA_DIR, 'tokens.json')


def load_json(path: str, default: Dict = None) -> Dict:
    try:
        with open(path, 'r', encoding='utf-8') as file:
            return json.load(file)
    except (OSError, ValueError):
        return default or {}


def save_json(path: str, data: Dict) -> None:
    with open(path, 'w', encoding='utf-8') as file:
        json.dump(data, file, indent=2)


def get_tokens() -> Dict:
    return load_json(TOKENS_PATH, {})


def get_config() -> Dict:
    return load_json(CONFIG_PATH, {})


def refresh_access_token(config: Dict, tokens: Dict) -> str:
    if not config.get('clientId') or not config.get('clientSecret') or not tokens.get('refreshToken'):
        raise ValueError('Missing Spotify credentials or refresh token in data/config.json or data/tokens.json')

    response = requests.post(
        'https://accounts.spotify.com/api/token',
        data={
            'grant_type': 'refresh_token',
            'refresh_token': tokens['refreshToken']
        },
        auth=(config['clientId'], config['clientSecret'])
    )
    response.raise_for_status()
    data = response.json()
    tokens['accessToken'] = data['access_token']
    tokens['expiresAt'] = int(time.time()) + data.get('expires_in', 3600)
    if data.get('refresh_token'):
        tokens['refreshToken'] = data['refresh_token']
    save_json(TOKENS_PATH, tokens)
    return tokens['accessToken']


def get_access_token(config: Dict, tokens: Dict) -> str:
    if tokens.get('accessToken') and tokens.get('expiresAt', 0) > int(time.time()) + 60:
        return tokens['accessToken']
    return refresh_access_token(config, tokens)


def spotify_request(method: str, path: str, config: Dict, tokens: Dict, params: Optional[Dict] = None, json_body: Optional[Dict] = None):
    access_token = get_access_token(config, tokens)
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
    }
    url = f'https://api.spotify.com/v1{path}'
    response = requests.request(method, url, headers=headers, params=params, json=json_body)
    response.raise_for_status()
    if response.status_code == 204:
        return {}
    return response.json()


def list_devices(config: Dict, tokens: Dict):
    return spotify_request('GET', '/me/player/devices', config, tokens)


def play(config: Dict, tokens: Dict, device_id: Optional[str] = None, context_uri: Optional[str] = None, track_uris: Optional[list] = None, volume_percent: Optional[int] = None, shuffle: Optional[bool] = None):
    if volume_percent is not None and device_id:
        spotify_request('PUT', '/me/player/volume', config, tokens, params={'device_id': device_id, 'volume_percent': volume_percent})

    if shuffle is not None and device_id is not None:
        spotify_request('PUT', '/me/player/shuffle', config, tokens, params={'device_id': device_id, 'state': str(shuffle).lower()})

    body = {}
    if context_uri:
        body['context_uri'] = context_uri
    if track_uris:
        body['uris'] = track_uris
    if not body:
        raise ValueError('Either context_uri or track_uris must be provided to play music.')

    params = {'device_id': device_id} if device_id else None
    return spotify_request('PUT', '/me/player/play', config, tokens, params=params, json_body=body)


def main():
    config = get_config()
    tokens = get_tokens()

    if not config:
        raise RuntimeError('No config found in data/config.json. Please save client credentials and preferences from the website first.')

    print('Loaded configuration. Checking Spotify devices...')
    devices = list_devices(config, tokens)
    print(json.dumps(devices, indent=2))

    alarm = config.get('alarm', {})
    if not alarm.get('deviceId') and devices.get('devices'):
        print('No device selected; using first available device.')
        alarm['deviceId'] = devices['devices'][0]['id']

    if not alarm.get('contextUri') and alarm.get('trackUris'):
        track_uris = [uri.strip() for uri in alarm['trackUris'].split(',') if uri.strip()]
    else:
        track_uris = None

    result = play(
        config,
        tokens,
        device_id=alarm.get('deviceId'),
        context_uri=alarm.get('contextUri'),
        track_uris=track_uris,
        volume_percent=alarm.get('volumePercent'),
        shuffle=alarm.get('shuffle')
    )
    print('Playback request sent:', result)


if __name__ == '__main__':
    main()
