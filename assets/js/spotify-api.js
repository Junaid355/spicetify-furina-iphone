// assets/js/spotify-api.js — Spotify Web API client with PKCE Auth Flow for Web & Mobile
import { setSetting, getSetting } from './db.js';

const SPOTIFY_AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

// PKCE Helper Functions using Web Crypto API
function generateRandomString(length) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], '');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
}

function base64UrlEncode(a) {
  let str = '';
  const bytes = new Uint8Array(a);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export class SpotifyClient {
  constructor() {
    this.clientId = null;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = 0;
    this.user = null;
  }

  async init() {
    this.clientId = await getSetting('spotify_client_id', '');
    this.accessToken = await getSetting('spotify_access_token', null);
    this.refreshToken = await getSetting('spotify_refresh_token', null);
    this.tokenExpiry = await getSetting('spotify_token_expiry', 0);

    // Check for callback query params (?code=...)
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');

    if (code) {
      await this.handleAuthCallback(code);
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (error) {
      console.error('Spotify Auth error:', error);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (this.accessToken && Date.now() < this.tokenExpiry) {
      try {
        this.user = await this.getCurrentUser();
      } catch (e) {
        console.warn('Failed to load user profile with current token:', e);
      }
    }
  }

  isAuthenticated() {
    return Boolean(this.accessToken && Date.now() < this.tokenExpiry);
  }

  async startAuth(clientId) {
    if (clientId) {
      this.clientId = clientId;
      await setSetting('spotify_client_id', clientId);
    }

    if (!this.clientId) {
      throw new Error('Spotify Client ID is required to start authentication.');
    }

    const codeVerifier = generateRandomString(64);
    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64UrlEncode(hashed);

    window.localStorage.setItem('spotify_code_verifier', codeVerifier);

    const redirectUri = window.location.origin + window.location.pathname;
    const scope = [
      'user-read-private',
      'user-read-email',
      'playlist-read-private',
      'playlist-read-collaborative',
      'playlist-modify-public',
      'playlist-modify-private',
      'user-library-read',
      'user-top-read'
    ].join(' ');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: scope,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      redirect_uri: redirectUri
    });

    window.location.href = `${SPOTIFY_AUTH_ENDPOINT}?${params.toString()}`;
  }

  async handleAuthCallback(code) {
    const codeVerifier = window.localStorage.getItem('spotify_code_verifier');
    const redirectUri = window.location.origin + window.location.pathname;

    if (!this.clientId) {
      this.clientId = await getSetting('spotify_client_id', '');
    }

    const payload = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    };

    try {
      const res = await fetch(SPOTIFY_TOKEN_ENDPOINT, payload);
      const data = await res.json();

      if (data.access_token) {
        this.accessToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in * 1000);
        await setSetting('spotify_access_token', this.accessToken);
        await setSetting('spotify_token_expiry', this.tokenExpiry);

        if (data.refresh_token) {
          this.refreshToken = data.refresh_token;
          await setSetting('spotify_refresh_token', this.refreshToken);
        }

        this.user = await this.getCurrentUser();
        window.localStorage.removeItem('spotify_code_verifier');
        return true;
      }
    } catch (e) {
      console.error('Failed to exchange Spotify token:', e);
      throw e;
    }
  }

  async request(endpoint, options = {}) {
    if (!this.accessToken) throw new Error('Not authenticated with Spotify');
    const res = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    if (res.status === 401) {
      // Token expired
      this.accessToken = null;
      await setSetting('spotify_access_token', null);
      throw new Error('Spotify session expired. Please log in again.');
    }

    return res.json();
  }

  async getCurrentUser() {
    return this.request('/me');
  }

  async getUserPlaylists(limit = 20) {
    const data = await this.request(`/me/playlists?limit=${limit}`);
    return data.items || [];
  }

  async getPlaylistTracks(playlistId) {
    const data = await this.request(`/playlists/${playlistId}/tracks?limit=50`);
    return (data.items || []).map(item => this.formatSpotifyTrack(item.track)).filter(Boolean);
  }

  async searchTracks(query, limit = 20) {
    const data = await this.request(`/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`);
    return (data.tracks?.items || []).map(track => this.formatSpotifyTrack(track)).filter(Boolean);
  }

  async getSavedTracks(limit = 30) {
    const data = await this.request(`/me/tracks?limit=${limit}`);
    return (data.items || []).map(item => this.formatSpotifyTrack(item.track)).filter(Boolean);
  }

  formatSpotifyTrack(item) {
    if (!item) return null;
    return {
      id: `spotify_${item.id}`,
      spotifyId: item.id,
      title: item.name,
      artist: (item.artists || []).map(a => a.name).join(', '),
      album: item.album?.name || 'Spotify Single',
      duration: Math.round(item.duration_ms / 1000),
      coverUrl: item.album?.images?.[0]?.url || './assets/images/furina_logo.jpg',
      audioUrl: item.preview_url || '', // 30s preview or custom stream
      externalUrl: item.external_urls?.spotify,
      isSpotify: true,
      isDownloaded: false
    };
  }

  async logout() {
    this.accessToken = null;
    this.refreshToken = null;
    this.user = null;
    await setSetting('spotify_access_token', null);
    await setSetting('spotify_refresh_token', null);
    await setSetting('spotify_token_expiry', 0);
  }
}
