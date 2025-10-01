const https = require('https');

const CLIENTS = {
  ANDROID: {
    clientName: 'ANDROID',
    clientVersion: '19.09.37',
    androidSdkVersion: 30,
    hl: 'en',
    gl: 'US',
    userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
    priority: 1
  },
  ANDROID_VR: {
    clientName: 'ANDROID_VR',
    clientVersion: '1.60.19',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    osName: 'Android',
    osVersion: '12L',
    androidSdkVersion: 32,
    hl: 'en',
    gl: 'US',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; GB) gzip',
    priority: 2
  },
  IOS: {
    clientName: 'IOS',
    clientVersion: '19.09.3',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
    osName: 'iOS',
    osVersion: '17.5.1.21F90',
    hl: 'en',
    gl: 'US',
    userAgent: 'com.google.ios.youtube/19.09.3 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
    priority: 3
  },
  WEB: {
    clientName: 'WEB',
    clientVersion: '2.20241001.00.00',
    hl: 'en',
    gl: 'US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    priority: 4
  },
  MWEB: {
    clientName: 'MWEB',
    clientVersion: '2.20241001.01.00',
    hl: 'en',
    gl: 'US',
    userAgent: 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
    priority: 5
  }
};

async function requestInnerTube(videoId, clientName, options = {}) {
  const client = CLIENTS[clientName];
  if (!client) {
    throw new Error(`Unknown client: ${clientName}`);
  }

  const apiUrl = 'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

  const requestBody = JSON.stringify({
    context: {
      client: {
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        ...(client.androidSdkVersion && { androidSdkVersion: client.androidSdkVersion }),
        ...(client.deviceMake && { deviceMake: client.deviceMake }),
        ...(client.deviceModel && { deviceModel: client.deviceModel }),
        ...(client.osName && { osName: client.osName }),
        ...(client.osVersion && { osVersion: client.osVersion }),
        hl: client.hl,
        gl: client.gl,
        utcOffsetMinutes: 0
      }
    },
    videoId: videoId,
    ...(options.playbackContext && { playbackContext: options.playbackContext })
  });

  return new Promise((resolve, reject) => {
    const urlObj = new URL(apiUrl);

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': client.userAgent,
      'Content-Length': Buffer.byteLength(requestBody),
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://www.youtube.com',
      'Referer': `https://www.youtube.com/watch?v=${videoId}`,
      ...(options.headers || {})
    };

    if (options.cookies) {
      const cookieString = typeof options.cookies === 'string'
        ? options.cookies
        : options.cookies.getCookieString?.() || '';

      if (cookieString) {
        headers['Cookie'] = cookieString;
      }
    }

    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers
    };

    const req = https.request(reqOptions, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data);
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

async function getVideoInfoMultiClient(videoId, options = {}) {
  const preferredClients = options.clients || ['ANDROID', 'ANDROID_VR', 'IOS', 'WEB'];

  let lastError = null;
  let results = [];

  for (const clientName of preferredClients) {
    try {
      const data = await requestInnerTube(videoId, clientName, options);

      if (data.playabilityStatus?.status !== 'OK') {
        lastError = new Error(`${clientName}: ${data.playabilityStatus?.status} - ${data.playabilityStatus?.reason || 'Unknown'}`);
        results.push({
          client: clientName,
          success: false,
          error: lastError.message
        });
        continue;
      }

      if (!data.streamingData) {
        lastError = new Error(`${clientName}: No streaming data`);
        results.push({
          client: clientName,
          success: false,
          error: lastError.message
        });
        continue;
      }

      const formats = [
        ...(data.streamingData.formats || []),
        ...(data.streamingData.adaptiveFormats || [])
      ];

      const directFormats = formats.filter(f => f.url);

      if (directFormats.length > 0) {
        return {
          success: true,
          client: clientName,
          videoDetails: data.videoDetails,
          streamingData: data.streamingData,
          formats: formats,
          directUrls: directFormats.length,
          needsCipher: formats.length - directFormats.length,
          attempts: results.length + 1
        };
      }

      lastError = new Error(`${clientName}: All formats need signature decipher`);
      results.push({
        client: clientName,
        success: false,
        error: lastError.message,
        totalFormats: formats.length
      });

    } catch (error) {
      lastError = error;
      results.push({
        client: clientName,
        success: false,
        error: error.message
      });
    }
  }

  const error = new Error(`All clients failed to get playable formats`);
  error.attempts = results;
  error.lastError = lastError;
  throw error;
}

module.exports = {
  CLIENTS,
  requestInnerTube,
  getVideoInfoMultiClient
};
