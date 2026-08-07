const express = require('express');
const axios = require('axios');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs').promises;
const bodyParser = require('body-parser');
const crypto = require('crypto');
const selfsigned = require('selfsigned');

const app = express();
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const CERTS_DIR = path.join(__dirname, 'certs');
const CERT_KEY_FILE = path.join(CERTS_DIR, 'server.key');
const CERT_PEM_FILE = path.join(CERTS_DIR, 'server.crt');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');

const DEFAULT_CONFIG = {
  clientId: '',
  clientSecret: '',
  redirectUri: `http://127.0.0.1:${HTTP_PORT}/callback`,
  refreshToken: '',
  alarm: {
    deviceId: '',
    deviceName: '',
    contextUri: '',
    trackUris: '',
    startTime: '',
    volumePercent: 80,
    shuffle: false
  }
};

let config = { ...DEFAULT_CONFIG };
let tokens = {
  accessToken: '',
  refreshToken: '',
  expiresAt: 0
};
const outstandingStates = new Set();

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadJson(filePath, defaultValue) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return defaultValue;
  }
}

async function saveJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function loadState() {
  await ensureStorage();
  config = await loadJson(CONFIG_FILE, DEFAULT_CONFIG);
  tokens = await loadJson(TOKENS_FILE, tokens);
}

async function generateCertFiles() {
  const attrs = [{ name: 'commonName', value: '127.0.0.1' }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'rsa',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: '127.0.0.1' },
          { type: 7, ip: '127.0.0.1' }
        ]
      }
    ]
  });
  await fs.writeFile(CERT_KEY_FILE, pems.private, 'utf8');
  await fs.writeFile(CERT_PEM_FILE, pems.cert, 'utf8');
}

async function loadCertFiles() {
  const [key, cert] = await Promise.all([
    fs.readFile(CERT_KEY_FILE, 'utf8'),
    fs.readFile(CERT_PEM_FILE, 'utf8')
  ]);
  return { key, cert };
}

async function ensureCerts() {
  await fs.mkdir(CERTS_DIR, { recursive: true });
  let needsGeneration = false;
  try {
    await fs.access(CERT_KEY_FILE);
    await fs.access(CERT_PEM_FILE);
    const { key } = await loadCertFiles();
    try {
      const keyObject = crypto.createPrivateKey(key);
      const modulusLength = keyObject.asymmetricKeyDetails?.modulusLength || 0;
      if (modulusLength < 2048) {
        needsGeneration = true;
      }
    } catch (error) {
      needsGeneration = true;
    }
  } catch (error) {
    needsGeneration = true;
  }

  if (needsGeneration) {
    await generateCertFiles();
  }

  return loadCertFiles();
}

function buildAuthUrl() {
  const state = crypto.randomBytes(12).toString('hex');
  outstandingStates.add(state);
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: 'user-read-playback-state user-modify-playback-state user-read-currently-playing',
    state,
    show_dialog: 'true'
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function refreshAccessToken() {
  if (!config.clientId || !config.clientSecret || !tokens.refreshToken) {
    throw new Error('Missing Spotify client credentials or refresh token. Configure them first.');
  }

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken
  });

  const authHeader = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  const response = await axios.post('https://accounts.spotify.com/api/token', form.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${authHeader}`
    }
  });

  const body = response.data;
  tokens.accessToken = body.access_token;
  tokens.expiresAt = Date.now() + (body.expires_in || 3600) * 1000;
  if (body.refresh_token) {
    tokens.refreshToken = body.refresh_token;
  }

  await saveJson(TOKENS_FILE, tokens);
  return tokens.accessToken;
}

async function getAccessToken() {
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60000) {
    return tokens.accessToken;
  }
  return refreshAccessToken();
}

async function spotifyRequest(method, url, options = {}) {
  const accessToken = await getAccessToken();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...options.headers
  };
  return axios({ method, url, headers, ...options });
}

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', async (req, res) => {
  await loadState();
  res.json({ config, hasTokens: Boolean(tokens.refreshToken), tokens: { expiresAt: tokens.expiresAt } });
});

app.post('/api/config', async (req, res) => {
  const partial = req.body || {};
  config = {
    ...config,
    clientId: partial.clientId ?? config.clientId,
    clientSecret: partial.clientSecret ?? config.clientSecret,
    redirectUri: partial.redirectUri || config.redirectUri,
    refreshToken: partial.refreshToken ?? config.refreshToken,
    alarm: {
      ...config.alarm,
      ...partial.alarm
    }
  };
  await saveJson(CONFIG_FILE, config);
  if (partial.refreshToken) {
    tokens.refreshToken = partial.refreshToken;
    await saveJson(TOKENS_FILE, tokens);
  }
  res.json({ success: true, config });
});

app.get('/api/authorize', async (req, res) => {
  await loadState();
  if (!config.clientId || !config.clientSecret) {
    return res.status(400).json({ error: 'Spotify client ID and secret are required before authorizing.' });
  }
  res.json({ url: buildAuthUrl() });
});

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.send(`<h1>Spotify authorization failed</h1><p>${error}</p><p><a href="/">Return</a></p>`);
  }
  if (!state || !outstandingStates.has(state)) {
    return res.status(400).send('<h1>Invalid state token</h1><p>Try reloading the page.</p>');
  }
  outstandingStates.delete(state);

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri
  });
  const authHeader = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  try {
    const response = await axios.post('https://accounts.spotify.com/api/token', form.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${authHeader}`
      }
    });
    const body = response.data;
    tokens.accessToken = body.access_token;
    tokens.refreshToken = body.refresh_token || tokens.refreshToken;
    tokens.expiresAt = Date.now() + (body.expires_in || 3600) * 1000;
    await saveJson(TOKENS_FILE, tokens);
    if (body.refresh_token) {
      config.refreshToken = body.refresh_token;
      await saveJson(CONFIG_FILE, config);
    }

    res.send('<h1>Spotify connected</h1><p>You can close this tab and return to the website.</p><p><a href="/">Back to dashboard</a></p>');
  } catch (tokenError) {
    console.error(tokenError.response?.data || tokenError.message);
    res.status(500).send('<h1>Could not complete authorization</h1><p>See the server logs for details.</p>');
  }
});

app.get('/api/devices', async (req, res) => {
  try {
    const response = await spotifyRequest('GET', 'https://api.spotify.com/v1/me/player/devices');
    res.json(response.data);
  } catch (error) {
    const message = error.response?.data || error.message;
    res.status(500).json({ error: message });
  }
});

app.post('/api/play', async (req, res) => {
  const body = req.body || {};
  const deviceId = body.deviceId || config.alarm.deviceId;
  const contextUri = body.contextUri || config.alarm.contextUri;
  const trackUris = body.trackUris ? body.trackUris.split(',').map((uri) => uri.trim()).filter(Boolean) : (config.alarm.trackUris ? config.alarm.trackUris.split(',').map((uri) => uri.trim()).filter(Boolean) : []);
  const volume = Number(body.volumePercent ?? config.alarm.volumePercent ?? 80);
  const shuffle = body.shuffle ?? config.alarm.shuffle ?? false;

  try {
    if (deviceId) {
      await spotifyRequest('PUT', `https://api.spotify.com/v1/me/player/volume?device_id=${encodeURIComponent(deviceId)}`, { data: null });
    }
    if (typeof shuffle === 'boolean') {
      await spotifyRequest('PUT', `https://api.spotify.com/v1/me/player/shuffle?state=${shuffle}`, { data: null });
    }

    const playBody = {};
    if (contextUri) {
      playBody.context_uri = contextUri;
      if (trackUris.length > 0) {
        playBody.offset = { uri: trackUris[0] };
      }
    } else if (trackUris.length > 0) {
      playBody.uris = trackUris;
    }

    await spotifyRequest('PUT', `https://api.spotify.com/v1/me/player/play?${deviceId ? `device_id=${encodeURIComponent(deviceId)}` : ''}`, {
      data: Object.keys(playBody).length ? playBody : null
    });

    res.json({ success: true, deviceId, contextUri, trackUris, volume, shuffle });
  } catch (error) {
    const message = error.response?.data || error.message;
    res.status(500).json({ error: message });
  }
});

app.post('/api/schedule', async (req, res) => {
  const alarm = req.body || {};
  config.alarm = {
    ...config.alarm,
    ...alarm
  };
  await saveJson(CONFIG_FILE, config);
  res.json({ success: true, alarm: config.alarm });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

loadState().then(async () => {
  const { key, cert } = await ensureCerts();

  http.createServer(app).listen(HTTP_PORT, HOST, () => {
    console.log(`Server running at http://127.0.0.1:${HTTP_PORT} (bound to ${HOST})`);
  });

  https.createServer({ key, cert }, app).listen(HTTPS_PORT, HOST, () => {
    console.log(`Secure server running at https://127.0.0.1:${HTTPS_PORT} (bound to ${HOST})`);
  });
}).catch((error) => {
  console.error('Failed to initialize server:', error);
  process.exit(1);
});
