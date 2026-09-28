// assets/js/app.js — Spicetify Furina iPhone Web Application Controller
import { 
  openDB, getAllTracks, getTrack, saveTrack, deleteTrack,
  saveOfflineAudio, getOfflineAudio, removeOfflineAudio,
  getAllPlaylists, getPlaylist, savePlaylist, deletePlaylist,
  getSetting, setSetting
} from './db.js';
import { AudioEngine } from './player.js';
import { LyricsRenderer, SAMPLE_LYRICS, fetchOnlineLyrics } from './lyrics.js';
import { SpotifyClient } from './spotify-api.js';
import { SpicetifyEngine, BUILTIN_THEMES } from './spicetify-engine.js';

// Global singletons
const player = new AudioEngine();
const spotify = new SpotifyClient();
const spicetify = new SpicetifyEngine();
let lyricsRenderer = null;
let currentPlaylist = null;
let visualizerAnimationFrame = null;

// Built-in starter tracks for Fontaine & Furina
const DEFAULT_TRACKS = [
  {
    id: 'furina_track_1',
    title: 'La vaguelette',
    artist: 'Furina & Salon Solitaire',
    album: 'Fontaine: Symphony of the Waters',
    duration: 32,
    audioUrl: './assets/audio/la_vaguelette.wav',
    coverUrl: './assets/images/furina_logo.jpg',
    lrcLyrics: SAMPLE_LYRICS.la_vaguelette,
    isDownloaded: true,
    isBuiltin: true
  },
  {
    id: 'furina_track_2',
    title: 'Fontaine Opera Epiclese Waltz',
    artist: 'Fontaine Philharmonic Orchestra',
    album: 'All the World’s a Stage',
    duration: 28,
    audioUrl: './assets/audio/fontaine_waltz.wav',
    coverUrl: './assets/images/furina_bg.jpg',
    lrcLyrics: SAMPLE_LYRICS.fontaine_waltz,
    isDownloaded: true,
    isBuiltin: true
  },
  {
    id: 'furina_track_3',
    title: 'Hydro Solitaire Lounge',
    artist: 'Mademoiselle Crabaletta & Gentilhomme Usher',
    album: 'Court of Fontaine Chill',
    duration: 30,
    audioUrl: './assets/audio/hydro_solitaire.wav',
    coverUrl: './assets/images/furina_portrait.jpg',
    lrcLyrics: SAMPLE_LYRICS.hydro_solitaire,
    isDownloaded: true,
    isBuiltin: true
  }
];

const DEFAULT_PLAYLISTS = [
  {
    id: 'pl_furina_favorites',
    name: 'Furina: Melodic Reverie',
    description: 'The finest operatic waltzes and hydro melodies of Fontaine, curated by the Hydro Archon.',
    coverUrl: './assets/images/furina_logo.jpg',
    trackIds: ['furina_track_1', 'furina_track_2', 'furina_track_3'],
    createdAt: Date.now()
  },
  {
    id: 'pl_opera_epiclese',
    name: 'Opera Epiclese Highlights',
    description: 'Dramatic court overtures and spotlight crescendos.',
    coverUrl: './assets/images/furina_star.jpg',
    trackIds: ['furina_track_1', 'furina_track_2'],
    createdAt: Date.now()
  }
];

// Initialize Application
async function initApp() {
  await openDB();

  // Register Service Worker for PWA & Offline support
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
      console.log('Spicetify Service Worker registered');
    } catch (e) {
      console.warn('Service Worker registration skipped:', e);
    }
  }

  // Pre-seed default tracks and playlists if empty
  const existingTracks = await getAllTracks();
  if (existingTracks.length === 0) {
    for (const t of DEFAULT_TRACKS) {
      await saveTrack(t);
      // Pre-cache audio file to IndexedDB for offline play
      try {
        const res = await fetch(t.audioUrl);
        const blob = await res.blob();
        await saveOfflineAudio(t.id, blob);
      } catch (err) {
        console.warn('Failed to pre-cache track blob:', err);
      }
    }
  }

  const existingPlaylists = await getAllPlaylists();
  if (existingPlaylists.length === 0) {
    for (const pl of DEFAULT_PLAYLISTS) {
      await savePlaylist(pl);
    }
  }

  // Init Spicetify and Spotify
  await spicetify.init();
  await spotify.init();

  // Setup DOM elements and event handlers
  setupNavigation();
  setupMiniPlayer();
  setupNowPlayingModal();
  setupLyricsModal();
  setupEqualizerModal();
  setupPlaylistModals();
  setupSpicetifyHub();
  setupSearch();
  setupOfflineView();
  setupSpotifyAuthUI();
  setupLocalMusicImport();

  // Render home view
  await renderHomeView();
  updateNetworkStatus();

  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
}

// Network Status Indicator
function updateNetworkStatus() {
  const badge = document.getElementById('network-badge');
  if (!badge) return;
  if (navigator.onLine) {
    badge.className = 'badge-pill';
    badge.innerHTML = '<span>⚡</span> Online';
  } else {
    badge.className = 'badge-pill offline';
    badge.innerHTML = '<span>📶</span> Offline Mode';
  }
}

// Navigation Tab Management
function setupNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetView = tab.dataset.view;
      switchView(targetView);
    });
  });
}

export function switchView(viewName) {
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === viewName);
  });

  document.querySelectorAll('.view-section').forEach(v => {
    v.classList.remove('active');
  });

  const activeSection = document.getElementById(`view-${viewName}`);
  if (activeSection) {
    activeSection.classList.add('active');
  }

  // Refresh content on view switch
  if (viewName === 'home') renderHomeView();
  if (viewName === 'library') renderLibraryView();
  if (viewName === 'spicetify') renderSpicetifyView();
  if (viewName === 'offline') renderOfflineView();
}

// Home View Renderer
async function renderHomeView() {
  const tracks = await getAllTracks();
  const playlists = await getAllPlaylists();

  // Render featured playlists shelf
  const shelfContainer = document.getElementById('featured-playlists-shelf');
  if (shelfContainer) {
    shelfContainer.innerHTML = '';
    playlists.forEach(pl => {
      const card = document.createElement('div');
      card.className = 'shelf-card';
      card.innerHTML = `
        <img class="shelf-card-cover" src="${pl.coverUrl || './assets/images/furina_logo.jpg'}" alt="${pl.name}" loading="lazy" />
        <div class="shelf-card-title">${pl.name}</div>
        <div class="shelf-card-desc">${pl.trackIds.length} tracks</div>
      `;
      card.addEventListener('click', () => openPlaylistView(pl.id));
      shelfContainer.appendChild(card);
    });
  }

  // Render recent tracks list
  const trackListContainer = document.getElementById('home-recent-tracks');
  if (trackListContainer) {
    trackListContainer.innerHTML = '';
    tracks.slice(0, 10).forEach((t, idx) => {
      trackListContainer.appendChild(createTrackItemEl(t, tracks, idx));
    });
  }
}

// Helper to create track item DOM element
function createTrackItemEl(track, trackListContext = [], index = 0) {
  const el = document.createElement('div');
  el.className = 'track-item';
  el.id = `track-el-${track.id}`;
  if (player.currentTrack && player.currentTrack.id === track.id) {
    el.classList.add('playing');
  }

  const durationStr = formatDuration(track.duration);
  const downloadedIcon = track.isDownloaded ? `<span class="download-badge" title="Available Offline">★</span>` : '';

  el.innerHTML = `
    <div class="track-item-left">
      <img class="track-item-thumb" src="${track.coverUrl || './assets/images/furina_logo.jpg'}" alt="" loading="lazy" />
      <div class="track-item-info">
        <div class="track-item-title">${track.title}</div>
        <div class="track-item-artist">
          ${downloadedIcon}
          <span>${track.artist}</span>
        </div>
      </div>
    </div>
    <div class="track-item-right">
      <span class="track-item-duration">${durationStr}</span>
      <button class="btn-icon track-more-btn" data-track-id="${track.id}">⋮</button>
    </div>
  `;

  el.querySelector('.track-item-left').addEventListener('click', () => {
    player.playTrack(track, trackListContext);
  });

  el.querySelector('.track-more-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openTrackActionSheet(track);
  });

  return el;
}

// Track Action Bottom Sheet (Add to playlist, Download offline, Lyrics)
function openTrackActionSheet(track) {
  const modal = document.getElementById('sheet-track-action');
  const titleEl = document.getElementById('sheet-track-title');
  const artistEl = document.getElementById('sheet-track-artist');
  const downloadBtn = document.getElementById('sheet-btn-download');

  titleEl.textContent = track.title;
  artistEl.textContent = track.artist;

  if (track.isDownloaded) {
    downloadBtn.innerHTML = '<span>🗑️</span> Remove from Offline Downloads';
    downloadBtn.onclick = async () => {
      await removeOfflineAudio(track.id);
      track.isDownloaded = false;
      modal.classList.remove('open');
      renderHomeView();
      renderOfflineView();
    };
  } else {
    downloadBtn.innerHTML = '<span>📥</span> Download for Offline Play';
    downloadBtn.onclick = async () => {
      downloadBtn.innerHTML = '<span>⏳</span> Downloading...';
      try {
        const res = await fetch(track.audioUrl);
        const blob = await res.blob();
        await saveOfflineAudio(track.id, blob);
        track.isDownloaded = true;
        modal.classList.remove('open');
        renderHomeView();
        renderOfflineView();
      } catch (err) {
        alert('Could not download audio. Check connection.');
        downloadBtn.innerHTML = '<span>📥</span> Download for Offline Play';
      }
    };
  }

  // Add to playlist button
  document.getElementById('sheet-btn-add-playlist').onclick = () => {
    modal.classList.remove('open');
    openAddToPlaylistModal(track.id);
  };

  modal.classList.add('open');
}

// Mini-Player Setup
function setupMiniPlayer() {
  const miniBar = document.getElementById('mini-player');
  const miniThumb = document.getElementById('mini-player-thumb');
  const miniTitle = document.getElementById('mini-player-title');
  const miniArtist = document.getElementById('mini-player-artist');
  const miniPlayBtn = document.getElementById('mini-player-play');
  const miniProgressBar = document.getElementById('mini-player-progress-fill');

  miniBar.addEventListener('click', (e) => {
    // Only open now playing if not clicking play button
    if (e.target.closest('#mini-player-play')) return;
    openNowPlayingModal();
  });

  miniPlayBtn.addEventListener('click', () => {
    player.togglePlay();
  });

  player.on('playState', (isPlaying) => {
    miniPlayBtn.innerHTML = isPlaying ? '❚❚' : '▶';
    const mainPlayBtn = document.getElementById('btn-main-play');
    if (mainPlayBtn) mainPlayBtn.innerHTML = isPlaying ? '❚❚' : '▶';

    const artwork = document.getElementById('now-playing-artwork');
    if (artwork) artwork.classList.toggle('playing', isPlaying);

    if (isPlaying) {
      startVisualizer();
    } else {
      stopVisualizer();
    }
  });

  player.on('trackChange', (track) => {
    miniThumb.src = track.coverUrl || './assets/images/furina_logo.jpg';
    miniTitle.textContent = track.title;
    miniArtist.textContent = track.artist;

    // Update active highlight in track lists
    document.querySelectorAll('.track-item').forEach(el => {
      el.classList.toggle('playing', el.id === `track-el-${track.id}`);
    });

    updateNowPlayingView(track);
  });

  player.on('timeUpdate', ({ currentTime, duration, progress }) => {
    miniProgressBar.style.width = `${progress * 100}%`;
    const scrubSlider = document.getElementById('scrub-slider');
    const curTimeEl = document.getElementById('time-current');
    const totTimeEl = document.getElementById('time-total');

    if (scrubSlider && !scrubSlider.matches(':active')) {
      scrubSlider.value = progress * 100;
    }
    if (curTimeEl) curTimeEl.textContent = formatDuration(currentTime);
    if (totTimeEl) totTimeEl.textContent = formatDuration(duration);

    if (lyricsRenderer) {
      lyricsRenderer.updateTime(currentTime);
    }
  });
}

// Full-Screen Now Playing Modal Setup
function setupNowPlayingModal() {
  const modal = document.getElementById('modal-now-playing');
  const btnClose = document.getElementById('btn-close-now-playing');
  const btnPlay = document.getElementById('btn-main-play');
  const btnPrev = document.getElementById('btn-main-prev');
  const btnNext = document.getElementById('btn-main-next');
  const btnShuffle = document.getElementById('btn-main-shuffle');
  const btnRepeat = document.getElementById('btn-main-repeat');
  const scrubSlider = document.getElementById('scrub-slider');

  btnClose.addEventListener('click', () => modal.classList.remove('open'));
  btnPlay.addEventListener('click', () => player.togglePlay());
  btnPrev.addEventListener('click', () => player.prev());
  btnNext.addEventListener('click', () => player.next());

  btnShuffle.addEventListener('click', () => {
    const isShuffle = player.toggleShuffle();
    btnShuffle.classList.toggle('active', isShuffle);
  });

  btnRepeat.addEventListener('click', () => {
    const mode = player.toggleRepeat();
    btnRepeat.classList.toggle('active', mode !== 'none');
    btnRepeat.title = `Repeat: ${mode}`;
  });

  scrubSlider.addEventListener('input', (e) => {
    const pct = parseFloat(e.target.value) / 100;
    player.seekPercent(pct);
  });

  // Action buttons
  document.getElementById('tool-btn-lyrics').addEventListener('click', () => {
    openLyricsModal();
  });

  document.getElementById('tool-btn-eq').addEventListener('click', () => {
    openEqualizerModal();
  });

  document.getElementById('tool-btn-download').addEventListener('click', async () => {
    if (!player.currentTrack) return;
    const track = player.currentTrack;
    const dlBtn = document.getElementById('tool-btn-download');

    if (track.isDownloaded) {
      await removeOfflineAudio(track.id);
      track.isDownloaded = false;
      dlBtn.classList.remove('active');
    } else {
      dlBtn.innerHTML = `<span>⏳</span><span>Saving</span>`;
      try {
        const res = await fetch(track.audioUrl);
        const blob = await res.blob();
        await saveOfflineAudio(track.id, blob);
        track.isDownloaded = true;
        dlBtn.classList.add('active');
        dlBtn.innerHTML = `<span>★</span><span>Downloaded</span>`;
      } catch (e) {
        alert('Could not download audio stream offline.');
      }
    }
  });
}

function openNowPlayingModal() {
  const modal = document.getElementById('modal-now-playing');
  if (player.currentTrack) {
    updateNowPlayingView(player.currentTrack);
  }
  modal.classList.add('open');
}

function updateNowPlayingView(track) {
  document.getElementById('now-playing-title').textContent = track.title;
  document.getElementById('now-playing-artist').textContent = track.artist;
  document.getElementById('now-playing-album').textContent = track.album || 'Fontaine Symphony';
  document.getElementById('now-playing-artwork').src = track.coverUrl || './assets/images/furina_logo.jpg';

  const dlBtn = document.getElementById('tool-btn-download');
  if (dlBtn) {
    dlBtn.classList.toggle('active', Boolean(track.isDownloaded));
    dlBtn.innerHTML = track.isDownloaded ? `<span>★</span><span>Downloaded</span>` : `<span>📥</span><span>Download</span>`;
  }

  // Load lyrics for track
  if (track.lrcLyrics) {
    if (lyricsRenderer) lyricsRenderer.setLyrics(track.lrcLyrics);
  } else {
    // Attempt online lookup
    fetchOnlineLyrics(track.title, track.artist, track.duration).then(lrc => {
      if (lrc) {
        track.lrcLyrics = lrc;
        saveTrack(track);
        if (lyricsRenderer) lyricsRenderer.setLyrics(lrc);
      } else {
        if (lyricsRenderer) lyricsRenderer.setLyrics('');
      }
    });
  }
}

// Synchronized Lyrics Modal Setup
function setupLyricsModal() {
  const modal = document.getElementById('modal-lyrics');
  const btnClose = document.getElementById('btn-close-lyrics');
  const container = document.getElementById('lyrics-container');

  lyricsRenderer = new LyricsRenderer(container, (seekTime) => {
    player.seek(seekTime);
  });

  btnClose.addEventListener('click', () => modal.classList.remove('open'));
}

function openLyricsModal() {
  const modal = document.getElementById('modal-lyrics');
  document.getElementById('lyrics-modal-title').textContent = player.currentTrack?.title || 'Lyrics';
  modal.classList.add('open');
}

// Equalizer & Fontaine 3D Audio Reverb Setup
function setupEqualizerModal() {
  const modal = document.getElementById('modal-equalizer');
  const btnClose = document.getElementById('btn-close-eq');
  btnClose.addEventListener('click', () => modal.classList.remove('open'));

  // Preset buttons
  const presetButtons = document.querySelectorAll('.eq-preset-pill');
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      presetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const preset = btn.dataset.preset;
      player.setEqualizerPreset(preset);
    });
  });

  // Reverb wetness slider
  const reverbSlider = document.getElementById('eq-slider-reverb');
  if (reverbSlider) {
    reverbSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (player.reverbGain && player.audioContext) {
        player.reverbGain.gain.setTargetAtTime(val, player.audioContext.currentTime, 0.05);
      }
      document.getElementById('eq-val-reverb').textContent = `${Math.round(val * 100)}%`;
    });
  }
}

function openEqualizerModal() {
  document.getElementById('modal-equalizer').classList.add('open');
}

// Real-time Canvas Wave Visualizer
function startVisualizer() {
  const canvas = document.getElementById('visualizer-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function draw() {
    visualizerAnimationFrame = requestAnimationFrame(draw);
    const data = player.getFrequencyData();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / (data.length * 0.5)) * 1.5;
    let x = 0;

    for (let i = 0; i < data.length * 0.5; i++) {
      const barHeight = (data[i] / 255) * canvas.height * 0.9;
      const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
      gradient.addColorStop(0, '#48cae4');
      gradient.addColorStop(1, 'rgba(0, 180, 216, 0.1)');

      ctx.fillStyle = gradient;
      ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
      x += barWidth;
    }
  }

  stopVisualizer();
  draw();
}

function stopVisualizer() {
  if (visualizerAnimationFrame) {
    cancelAnimationFrame(visualizerAnimationFrame);
    visualizerAnimationFrame = null;
  }
}

// Spicetify Hub (Themes & Extensions) Setup
function setupSpicetifyHub() {
  // Theme selection
  const themeContainer = document.getElementById('spicetify-themes-grid');
  if (themeContainer) {
    themeContainer.innerHTML = '';
    BUILTIN_THEMES.forEach(t => {
      const card = document.createElement('div');
      card.className = `theme-card ${spicetify.currentTheme === t.id ? 'active' : ''}`;
      card.innerHTML = `
        <div class="theme-swatch" style="background: ${t.previewBg}; color: ${t.previewColor};">
          ${t.name.split(' ')[0]}
        </div>
        <div style="font-weight: 700; font-size: 0.85rem;">${t.name}</div>
        <div style="font-size: 0.7rem; color: var(--text-sub);">${t.desc}</div>
      `;
      card.addEventListener('click', () => {
        spicetify.applyTheme(t.id);
        document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
      });
      themeContainer.appendChild(card);
    });
  }

  // Extensions list
  const extContainer = document.getElementById('spicetify-extensions-list');
  if (extContainer) {
    extContainer.innerHTML = '';
    spicetify.extensions.forEach(ext => {
      const item = document.createElement('div');
      item.className = 'extension-item';
      item.innerHTML = `
        <div class="ext-info">
          <div class="ext-name">${ext.name} <span style="font-size: 0.7rem; color: var(--text-dim);">v${ext.version}</span></div>
          <div class="ext-desc">${ext.desc}</div>
        </div>
        <label class="switch">
          <input type="checkbox" ${ext.enabled ? 'checked' : ''} data-ext-id="${ext.id}" />
          <span class="switch-slider"></span>
        </label>
      `;
      const checkbox = item.querySelector('input');
      checkbox.addEventListener('change', async () => {
        await spicetify.toggleExtension(ext.id);
      });
      extContainer.appendChild(item);
    });
  }

  // Custom CSS Injector
  const cssInput = document.getElementById('custom-css-input');
  const btnApplyCss = document.getElementById('btn-apply-css');
  if (btnApplyCss && cssInput) {
    getSetting('custom_css', '').then(val => { cssInput.value = val; });
    btnApplyCss.addEventListener('click', () => {
      spicetify.injectCustomCSS(cssInput.value);
      alert('Custom Spicetify CSS applied successfully!');
    });
  }
}

function renderSpicetifyView() {
  setupSpicetifyHub();
}

// Playlist Views & Modals Setup
function setupPlaylistModals() {
  const btnNewPlaylist = document.getElementById('btn-create-playlist');
  const modalCreate = document.getElementById('modal-create-playlist');
  const btnSavePlaylist = document.getElementById('btn-save-new-playlist');
  const btnCancelPlaylist = document.getElementById('btn-cancel-new-playlist');

  if (btnNewPlaylist) {
    btnNewPlaylist.addEventListener('click', () => modalCreate.classList.add('open'));
  }
  if (btnCancelPlaylist) {
    btnCancelPlaylist.addEventListener('click', () => modalCreate.classList.remove('open'));
  }

  if (btnSavePlaylist) {
    btnSavePlaylist.addEventListener('click', async () => {
      const name = document.getElementById('input-playlist-name').value.trim();
      const desc = document.getElementById('input-playlist-desc').value.trim();
      if (!name) return alert('Please enter a playlist name');

      const newPl = {
        id: `pl_${Date.now()}`,
        name: name,
        description: desc || 'Custom Furina Playlist',
        coverUrl: './assets/images/furina_logo.jpg',
        trackIds: [],
        createdAt: Date.now()
      };

      await savePlaylist(newPl);
      modalCreate.classList.remove('open');
      document.getElementById('input-playlist-name').value = '';
      document.getElementById('input-playlist-desc').value = '';
      renderLibraryView();
      openPlaylistView(newPl.id);
    });
  }

  // Close playlist detail view button
  const btnBackPlaylist = document.getElementById('btn-back-playlist');
  if (btnBackPlaylist) {
    btnBackPlaylist.addEventListener('click', () => {
      document.getElementById('view-playlist-detail').classList.remove('active');
      document.getElementById('view-home').classList.add('active');
    });
  }
}

export async function openPlaylistView(playlistId) {
  const playlist = await getPlaylist(playlistId);
  if (!playlist) return;
  currentPlaylist = playlist;

  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
  const detailSection = document.getElementById('view-playlist-detail');
  detailSection.classList.add('active');

  document.getElementById('pl-detail-title').textContent = playlist.name;
  document.getElementById('pl-detail-desc').textContent = playlist.description || '';
  document.getElementById('pl-detail-cover').src = playlist.coverUrl || './assets/images/furina_logo.jpg';
  document.getElementById('pl-detail-count').textContent = `${playlist.trackIds.length} tracks`;

  const allTracks = await getAllTracks();
  const trackMap = new Map(allTracks.map(t => [t.id, t]));
  const plTracks = playlist.trackIds.map(id => trackMap.get(id)).filter(Boolean);

  const container = document.getElementById('pl-detail-tracks');
  container.innerHTML = '';
  plTracks.forEach((track, idx) => {
    container.appendChild(createTrackItemEl(track, plTracks, idx));
  });

  // Play All button
  document.getElementById('btn-play-all-playlist').onclick = () => {
    if (plTracks.length > 0) {
      player.playTrack(plTracks[0], plTracks);
    }
  };

  // Download All button
  const btnDownloadAll = document.getElementById('btn-download-all-playlist');
  btnDownloadAll.onclick = async () => {
    btnDownloadAll.innerHTML = `<span>⏳</span> Downloading All (${plTracks.length})...`;
    for (const track of plTracks) {
      if (!track.isDownloaded) {
        try {
          const res = await fetch(track.audioUrl);
          const blob = await res.blob();
          await saveOfflineAudio(track.id, blob);
          track.isDownloaded = true;
        } catch (e) {
          console.warn('Failed to download track in playlist:', track.title);
        }
      }
    }
    btnDownloadAll.innerHTML = `<span>★</span> All Tracks Downloaded`;
    openPlaylistView(playlistId);
  };
}

// Library View Renderer
async function renderLibraryView() {
  const playlists = await getAllPlaylists();
  const container = document.getElementById('library-playlists-list');
  if (!container) return;
  container.innerHTML = '';

  playlists.forEach(pl => {
    const item = document.createElement('div');
    item.className = 'track-item';
    item.innerHTML = `
      <div class="track-item-left">
        <img class="track-item-thumb" src="${pl.coverUrl || './assets/images/furina_logo.jpg'}" alt="" />
        <div class="track-item-info">
          <div class="track-item-title">${pl.name}</div>
          <div class="track-item-artist">Playlist • ${pl.trackIds.length} tracks</div>
        </div>
      </div>
      <div class="track-item-right">
        <span class="track-item-duration">›</span>
      </div>
    `;
    item.addEventListener('click', () => openPlaylistView(pl.id));
    container.appendChild(item);
  });
}

// Offline Downloads View Setup & Renderer
function setupOfflineView() {
  const btnClearOffline = document.getElementById('btn-clear-offline');
  if (btnClearOffline) {
    btnClearOffline.addEventListener('click', async () => {
      if (confirm('Remove all downloaded offline tracks to free storage?')) {
        const tracks = await getAllTracks();
        for (const t of tracks) {
          if (t.isDownloaded) {
            await removeOfflineAudio(t.id);
          }
        }
        renderOfflineView();
      }
    });
  }
}

async function renderOfflineView() {
  const tracks = await getAllTracks();
  const offlineTracks = tracks.filter(t => t.isDownloaded);

  const statsEl = document.getElementById('offline-stats-text');
  if (statsEl) {
    statsEl.textContent = `${offlineTracks.length} tracks stored in phone storage (100% offline)`;
  }

  const container = document.getElementById('offline-tracks-list');
  if (!container) return;
  container.innerHTML = '';

  if (offlineTracks.length === 0) {
    container.innerHTML = `
      <div class="lyrics-empty" style="padding: 40px 0;">
        <div class="furina-star-badge" style="font-size: 2rem;">📥</div>
        <p>No offline songs downloaded yet.</p>
        <span style="font-size: 0.78rem; color: var(--text-dim);">Tap the download star on any song to save it for offline listening.</span>
      </div>
    `;
    return;
  }

  offlineTracks.forEach((track, idx) => {
    container.appendChild(createTrackItemEl(track, offlineTracks, idx));
  });
}

// Search View Setup
function setupSearch() {
  const input = document.getElementById('search-input');
  const resultsContainer = document.getElementById('search-results');
  if (!input || !resultsContainer) return;

  input.addEventListener('input', async (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) {
      resultsContainer.innerHTML = '';
      return;
    }

    const localTracks = await getAllTracks();
    const matched = localTracks.filter(t => 
      t.title.toLowerCase().includes(q) || 
      t.artist.toLowerCase().includes(q) ||
      (t.album && t.album.toLowerCase().includes(q))
    );

    resultsContainer.innerHTML = '';
    matched.forEach((t, idx) => {
      resultsContainer.appendChild(createTrackItemEl(t, matched, idx));
    });

    // Also search Spotify catalog if authenticated
    if (spotify.isAuthenticated()) {
      try {
        const spotifyTracks = await spotify.searchTracks(q, 10);
        spotifyTracks.forEach((st, idx) => {
          resultsContainer.appendChild(createTrackItemEl(st, spotifyTracks, idx));
        });
      } catch (err) {
        console.warn('Spotify search failed:', err);
      }
    }
  });
}

// Local Music / Audio File Import (Upload from iPhone Files)
function setupLocalMusicImport() {
  const fileInput = document.getElementById('local-audio-file-input');
  const btnImport = document.getElementById('btn-import-local');
  if (!fileInput || !btnImport) return;

  btnImport.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    for (const file of files) {
      const trackId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const cleanTitle = file.name.replace(/\.[^/.]+$/, "");

      const newTrack = {
        id: trackId,
        title: cleanTitle,
        artist: 'Local Import',
        album: 'My iPhone Music',
        duration: 0,
        audioUrl: '', // retrieved via blob
        coverUrl: './assets/images/furina_portrait.jpg',
        lrcLyrics: '',
        isDownloaded: true,
        isLocal: true,
        downloadedAt: Date.now()
      };

      await saveTrack(newTrack);
      await saveOfflineAudio(trackId, file);

      // Add to default playlist
      const playlists = await getAllPlaylists();
      if (playlists.length > 0) {
        playlists[0].trackIds.push(trackId);
        await savePlaylist(playlists[0]);
      }
    }

    alert(`Imported ${files.length} track(s) directly to your offline library!`);
    renderHomeView();
    renderOfflineView();
  });
}

// Spotify Auth UI & Settings Modal
function setupSpotifyAuthUI() {
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const modalSettings = document.getElementById('modal-settings');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnLoginSpotify = document.getElementById('btn-spotify-login');
  const clientIdInput = document.getElementById('input-spotify-client-id');
  const spotifyUserStatus = document.getElementById('spotify-user-status');

  if (btnOpenSettings) {
    btnOpenSettings.addEventListener('click', async () => {
      clientIdInput.value = spotify.clientId || '';
      if (spotify.isAuthenticated() && spotify.user) {
        spotifyUserStatus.innerHTML = `
          <div style="display:flex; align-items:center; gap:10px; margin-bottom: 12px;">
            <img src="${spotify.user.images?.[0]?.url || './assets/images/furina_logo.jpg'}" style="width:36px; height:36px; border-radius:50%;" />
            <div>
              <div style="font-weight:700;">Connected as ${spotify.user.display_name}</div>
              <div style="font-size:0.75rem; color:var(--text-sub);">Spotify Premium / Free</div>
            </div>
          </div>
          <button class="btn-subtle" id="btn-spotify-logout" style="width:100%;">Disconnect Account</button>
        `;
        document.getElementById('btn-spotify-logout').onclick = async () => {
          await spotify.logout();
          modalSettings.classList.remove('open');
          alert('Disconnected Spotify');
        };
      }
      modalSettings.classList.add('open');
    });
  }

  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', () => modalSettings.classList.remove('open'));
  }

  if (btnLoginSpotify) {
    btnLoginSpotify.addEventListener('click', async () => {
      const enteredId = clientIdInput.value.trim();
      if (!enteredId) {
        alert('Please enter your Spotify Developer Client ID (or click "Use Public Demo ID").');
        return;
      }
      try {
        await spotify.startAuth(enteredId);
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // Preset Public Demo ID helper
  const btnDemoId = document.getElementById('btn-use-demo-client-id');
  if (btnDemoId) {
    btnDemoId.addEventListener('click', () => {
      // Common public client id or sample
      clientIdInput.value = '7c29377be83d47ad9ef3cb7663476836';
    });
  }
}

// Add Track to Playlist Modal
async function openAddToPlaylistModal(trackId) {
  const modal = document.getElementById('modal-add-to-playlist');
  const container = document.getElementById('add-playlist-items');
  const playlists = await getAllPlaylists();

  container.innerHTML = '';
  playlists.forEach(pl => {
    const item = document.createElement('div');
    item.className = 'track-item';
    const isAlreadyIn = pl.trackIds.includes(trackId);
    item.innerHTML = `
      <div class="track-item-left">
        <img class="track-item-thumb" src="${pl.coverUrl || './assets/images/furina_logo.jpg'}" alt="" />
        <div class="track-item-info">
          <div class="track-item-title">${pl.name}</div>
          <div class="track-item-artist">${pl.trackIds.length} songs ${isAlreadyIn ? '• (Already Added)' : ''}</div>
        </div>
      </div>
      <div class="track-item-right">
        <button class="btn-subtle">${isAlreadyIn ? 'Remove' : 'Add'}</button>
      </div>
    `;
    item.querySelector('.btn-subtle').addEventListener('click', async () => {
      if (isAlreadyIn) {
        pl.trackIds = pl.trackIds.filter(id => id !== trackId);
      } else {
        pl.trackIds.push(trackId);
      }
      await savePlaylist(pl);
      modal.classList.remove('open');
      alert(`Playlist "${pl.name}" updated!`);
    });
    container.appendChild(item);
  });

  document.getElementById('btn-close-add-playlist').onclick = () => modal.classList.remove('open');
  modal.classList.add('open');
}

// Helpers
function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Launch application on DOM ready
document.addEventListener('DOMContentLoaded', initApp);
