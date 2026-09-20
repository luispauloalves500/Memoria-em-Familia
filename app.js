const DB_NAME = 'memorias-em-familia';
const DB_VERSION = 2;
const PHOTO_STORE = 'photos';
const ALBUM_STORE = 'albums';

const BUNDLED_MANIFEST_URL = './assets/vault/manifest.json';
const BUNDLED_IMPORT_KEY = 'memorias-bundled-casamento-v3-secure';
const assetBlobCache = new Map();
const runtimeMediaUrls = new Map();

const IMAGE_EXTENSIONS = new Set(['jpg','jpeg','jfif','png','webp','avif','gif','bmp','heic','heif']);
const state = {
  view: 'home',
  photos: [],
  albums: [],
  search: '',
  sort: 'newest',
  uploadFiles: [],
  lightboxIds: [],
  lightboxIndex: 0,
  selectionMode: false,
  selectedIds: new Set(),
  galleryMode: localStorage.getItem('memorias-gallery-mode') || 'grid',
  momentFilter: 'all',
};

const editorState = {
  photo: null,
  source: null,
  width: 0,
  height: 0,
  rotation: 0,
  flipX: false,
  flipY: false,
};

const galleryUiState = {
  homeCarouselTimer: null,
  albumCardTimer: null,
  albumHeroTimer: null,
  slideshowTimer: null,
  slideshowPlaying: false,
  homeCarouselIndex: 0,
  albumHeroIndex: 0,
};

const coverEditorState = {
  albumId: null,
  selectedPhotoId: null,
};

const radioState = {
  stations: [],
  current: null,
  currentIndex: -1,
  loading: false,
};

const RADIO_API = 'https://de1.api.radio-browser.info/json/stations/search';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const root = $('#viewRoot');
const toastEl = $('#toast');
const objectUrls = new WeakMap();

function uid(prefix='id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        const store = db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('albumId', 'albumId');
        store.createIndex('favorite', 'favorite');
        store.createIndex('deletedAt', 'deletedAt');
      }
      if (!db.objectStoreNames.contains(ALBUM_STORE)) {
        db.createObjectStore(ALBUM_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Operação cancelada'));
  });
}

async function idbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function formatDate(value) {
  if (!value) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'short', year:'numeric' }).format(new Date(value));
}

function getAlbum(id) { return state.albums.find(a => a.id === id); }
function activePhotos() { return state.photos.filter(p => !p.deletedAt); }
function deletedPhotos() { return state.photos.filter(p => !!p.deletedAt); }

function photoMatches(photo) {
  if (!state.search.trim()) return true;
  const album = getAlbum(photo.albumId);
  const hay = [photo.name, photo.filename, ...(photo.tags || []), album?.name || ''].join(' ').toLowerCase();
  return hay.includes(state.search.toLowerCase().trim());
}

function sorted(list) {
  return [...list].sort((a,b) => {
    if (state.sort === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
    if (state.sort === 'name') return (a.name || '').localeCompare(b.name || '', 'pt-BR');
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function bytesLabel(bytes=0) {
  const units = ['B','KB','MB','GB','TB'];
  let n = Number(bytes) || 0, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function toast(message, ms=2600) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function urlForBlob(blob) {
  if (!blob) return '';
  if (!objectUrls.has(blob)) objectUrls.set(blob, URL.createObjectURL(blob));
  return objectUrls.get(blob);
}

function displayBlob(photo) { return photo?.blob || null; }
function thumbnailBlob(photo) { return photo?.thumbBlob || photo?.blob || null; }
function photoSourceUrl(photo, thumbnail=false) {
  if (!photo) return '';
  const runtimeKey = `${thumbnail ? 't' : 'o'}:${photo.id}`;
  if (runtimeMediaUrls.has(runtimeKey)) return runtimeMediaUrls.get(runtimeKey);
  const blob = thumbnail ? thumbnailBlob(photo) : displayBlob(photo);
  return blob ? urlForBlob(blob) : '';
}
async function blobForPhoto(photo, thumbnail=false) {
  if (!photo) return null;
  if (window.MemVault?.isUnlocked()) {
    const protectedBlob = await window.MemVault.getBlob(photo, thumbnail);
    if (protectedBlob) return protectedBlob;
  }
  const direct = thumbnail ? thumbnailBlob(photo) : displayBlob(photo);
  return direct || null;
}

async function ensurePhotoObjectUrl(photo, thumbnail=false) {
  if (!photo) return '';
  const runtimeKey = `${thumbnail ? 't' : 'o'}:${photo.id}`;
  if (runtimeMediaUrls.has(runtimeKey)) return runtimeMediaUrls.get(runtimeKey);
  const blob = await blobForPhoto(photo, thumbnail);
  if (!blob) return '';
  const url = urlForBlob(blob);
  runtimeMediaUrls.set(runtimeKey, url);
  return url;
}

async function hydratePhotoThumbnails() {
  const photos = state.photos.filter(p => !p.previewUnsupported);
  const queue = [...photos];
  const workers = Array.from({length: Math.min(6, queue.length || 1)}, async () => {
    while (queue.length) {
      const photo = queue.shift();
      try { await ensurePhotoObjectUrl(photo, true); } catch (err) { console.warn('Miniatura protegida indisponível', photo?.id, err); }
    }
  });
  await Promise.all(workers);
}

async function migrateLegacyPlainPhotos() {
  if (!window.MemVault?.isUnlocked()) return;
  let changed = 0;
  for (let i=0; i<state.photos.length; i++) {
    const photo = state.photos[i];
    if (photo.bundled || photo.encryptedBlob || !photo.blob) continue;
    try {
      const migrated = await window.MemVault.migratePlainPhoto(photo);
      await idbPut(PHOTO_STORE, migrated);
      state.photos[i] = migrated;
      changed++;
    } catch (err) { console.warn('Falha ao criptografar foto local antiga', photo?.id, err); }
  }
  if (changed) toast(`${changed} foto(s) local(is) foram protegidas com criptografia.`, 4200);
}

function photoVisual(photo, {thumbnail=true, alt=''}={}) {
  if (photo?.previewUnsupported) {
    const ext = (photo.filename?.split('.').pop() || 'IMG').toUpperCase();
    return `<div class="image-placeholder"><span>▧</span><strong>${escapeHtml(ext)}</strong><small>Prévia indisponível</small></div>`;
  }
  const src = photoSourceUrl(photo, thumbnail);
  return src
    ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt || photo?.name || 'Foto')}" ${thumbnail ? 'loading="lazy"' : ''} />`
    : `<div class="image-placeholder"><span>▧</span><small>Sem prévia</small></div>`;
}

function renderPhotoCard(photo) {
  const album = getAlbum(photo.albumId);
  const selected = state.selectedIds.has(photo.id);
  return `
    <article class="photo-card ${state.selectionMode ? 'selection-mode' : ''} ${selected ? 'selected' : ''}" data-photo-id="${photo.id}">
      ${photoVisual(photo, {thumbnail:true})}
      <div class="photo-overlay"></div>
      <div class="photo-badges">
        ${album ? `<span class="photo-badge">${escapeHtml(album.name)}</span>` : ''}
        ${photo.moment ? `<span class="photo-badge moment">${escapeHtml(photo.moment)}</span>` : ''}
        ${photo.editedFrom ? `<span class="photo-badge edited">Editada</span>` : ''}
      </div>
      ${state.selectionMode ? `<button class="photo-select-btn ${selected ? 'on' : ''}" data-select-photo="${photo.id}" aria-label="Selecionar foto">${selected ? '✓' : ''}</button>` : `<button class="favorite-btn ${photo.favorite ? 'on' : ''}" data-favorite-id="${photo.id}" aria-label="Favoritar">${photo.favorite ? '♥' : '♡'}</button>`}
      <div class="photo-info"><strong>${escapeHtml(photo.name || 'Foto')}</strong><span>${photo.order ? `#${photo.order} · ` : ''}${formatDate(photo.createdAt)}</span></div>
    </article>`;
}

function renderEmpty(title, text, actionLabel='Enviar fotos', action='upload') {
  return `<div class="empty-state">
    <div class="empty-icon">▦</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(text)}</p>
    <button class="btn primary" data-action="${action}">${escapeHtml(actionLabel)}</button>
  </div>`;
}

function renderHeroBanner(photos, favoritesCount=0) {
  const picks = photos.slice(0, 6);
  const main = picks[0];
  const secondary = picks.slice(1, 5);
  const album = main ? getAlbum(main.albumId) : null;

  if (!main) {
    return `
      <div class="hero-banner-card empty">
        <div class="hero-banner-empty">
          <span>✦</span>
          <strong>Seu banner vai aparecer aqui</strong>
          <p>Envie fotos para destacar seus melhores momentos logo na entrada do site.</p>
        </div>
      </div>`;
  }

  const chips = [
    `${activePhotos().length} ${activePhotos().length === 1 ? 'foto' : 'fotos'}`,
    `${state.albums.length} ${state.albums.length === 1 ? 'álbum' : 'álbuns'}`,
    `${favoritesCount} ${favoritesCount === 1 ? 'favorita' : 'favoritas'}`,
  ];

  return `
    <div class="hero-banner-card" data-home-carousel>
      <article class="hero-banner-main" data-home-carousel-main data-photo-id="${main.id}">
        <img class="home-carousel-image" src="${escapeHtml(photoSourceUrl(main,true))}" alt="${escapeHtml(main.name || 'Foto em destaque')}" />
        <div class="hero-banner-overlay"></div>
        <div class="hero-banner-content">
          <div class="hero-banner-pill">Destaque da galeria</div>
          <strong data-home-carousel-title>${escapeHtml(main.name || 'Foto em destaque')}</strong>
          <span data-home-carousel-meta>${album ? escapeHtml(album.name) + ' · ' : ''}${formatDate(main.createdAt)}</span>
          <div class="hero-banner-chipbar">
            ${chips.map(chip => `<span>${escapeHtml(chip)}</span>`).join('')}
          </div>
        </div>
        <div class="hero-carousel-dots" aria-label="Navegação do banner">
          ${picks.map((photo,i)=>`<button type="button" class="hero-carousel-dot ${i===0?'active':''}" data-home-slide="${i}" data-photo-id="${photo.id}" aria-label="Mostrar foto ${i+1}"></button>`).join('')}
        </div>
      </article>
      <div class="hero-banner-thumbs">
        ${secondary.map((photo,i) => {
          const subAlbum = getAlbum(photo.albumId);
          return `
            <article class="hero-thumb ${i===0?'active':''}" data-home-thumb-id="${photo.id}" data-photo-id="${photo.id}">
              ${photoVisual(photo, {thumbnail:true, alt: photo.name || 'Miniatura'})}
              <div class="hero-thumb-overlay"></div>
              <div class="hero-thumb-info">
                <strong>${escapeHtml(photo.name || 'Foto')}</strong>
                <span>${subAlbum ? escapeHtml(subAlbum.name) : formatDate(photo.createdAt)}</span>
              </div>
            </article>`;
        }).join('')}
      </div>
    </div>`;
}

function renderHome() {
  const photos = activePhotos();
  const filteredPhotos = sorted(photos.filter(photoMatches));
  const recent = filteredPhotos.slice(0,10);
  const bannerPhotos = filteredPhotos.slice(0,5);
  const favorites = photos.filter(p=>p.favorite).length;
  const totalBytes = photos.reduce((sum,p)=>sum+(p.size||0),0);
  const albumCards = state.albums.slice(0,4).map(renderAlbumCard).join('');

  root.innerHTML = `
    <section class="hero hero-split">
      <div class="hero-content">
        <div class="eyebrow">Seu acervo particular</div>
        <h1>Momentos que merecem ficar.</h1>
        <p>Organize, edite e preserve as fotos da família com álbuns, favoritos e uma experiência feita para celular e computador.</p>
        <div class="hero-actions">
          <button class="btn" data-action="upload">↑ Adicionar novas fotos</button>
          <button class="btn ghost hero-secondary" data-view-link="albums">Ver álbuns</button>
        </div>
        <div class="hero-benefits">
          <span>◉ Upload rápido</span>
          <span>✎ Editor integrado</span>
          <span>♫ Rádio no site</span>
          <span>🔐 Cofre criptografado</span>
        </div>
      </div>
      ${renderHeroBanner(bannerPhotos, favorites)}
    </section>

    <div class="stats-grid">
      <div class="stat-card"><div class="value">${photos.length}</div><div class="label">Fotos salvas</div></div>
      <div class="stat-card"><div class="value">${state.albums.length}</div><div class="label">Álbuns</div></div>
      <div class="stat-card"><div class="value">${favorites}</div><div class="label">Favoritas</div></div>
      <div class="stat-card"><div class="value">${bytesLabel(totalBytes)}</div><div class="label">Tamanho do acervo</div></div>
    </div>

    <div class="section-head"><div><h2>Álbuns</h2><p>Organize cada fase da família do seu jeito.</p></div><button class="text-btn" data-view-link="albums">Ver todos</button></div>
    ${state.albums.length ? `<div class="album-grid">${albumCards}</div>` : renderEmpty('Nenhum álbum criado', 'Crie seu primeiro álbum para começar a organizar sua coleção.', 'Criar álbum', 'album')}

    <div class="section-head"><div><h2>Fotos recentes</h2><p>As lembranças adicionadas mais recentemente.</p></div><button class="text-btn" data-view-link="photos">Ver todas</button></div>
    ${recent.length ? `<div class="photo-grid">${recent.map(renderPhotoCard).join('')}</div>` : renderEmpty('Sua galeria está vazia', 'Envie algumas fotos para ver sua coleção aparecer aqui.')}
  `;
}

function albumPhotoList(albumId) { return activePhotos().filter(p => p.albumId === albumId); }

function albumVisualMeta(album, photos=[]) {
  const key = `${album?.name || ''} ${album?.description || ''}`.toLowerCase();
  if (key.includes('viag')) return { icon:'✈', accent:'travel', label:'Álbum de viagem' };
  if (key.includes('fam')) return { icon:'♥', accent:'family', label:'Álbum da família' };
  if (key.includes('anivers')) return { icon:'✦', accent:'celebrate', label:'Momentos especiais' };
  if (key.includes('casa') || key.includes('lar')) return { icon:'⌂', accent:'home', label:'Memórias do lar' };
  return { icon: photos.length ? '◫' : '▣', accent:'default', label: photos.length ? 'Coleção de memórias' : 'Pronto para receber fotos' };
}

function orderedAlbumPhotos(album, photos) {
  const list = [...photos];
  const preferredId = album?.coverPhotoId;
  if (preferredId) {
    const idx = list.findIndex(p=>p.id===preferredId);
    if (idx > 0) list.unshift(...list.splice(idx,1));
  } else {
    const fav = list.findIndex(p=>p.favorite);
    if (fav > 0) list.unshift(...list.splice(fav,1));
  }
  return list;
}

function albumCoverImageStyle(album) {
  const x = Number(album?.coverPositionX ?? 50);
  const y = Number(album?.coverPositionY ?? 50);
  const zoom = Math.max(100, Math.min(180, Number(album?.coverZoom ?? 100))) / 100;
  return `--cover-x:${x}%;--cover-y:${y}%;--cover-zoom:${zoom};`;
}

function albumCoverMarkup(album, photos) {
  const meta = albumVisualMeta(album, photos);
  if (!photos.length) {
    const initials = (album.name || 'Álbum').split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase();
    return `
      <div class="album-cover-empty ${meta.accent}">
        <div class="album-cover-empty-art"></div>
        <div class="album-cover-empty-badge">${meta.label}</div>
        <div class="album-cover-empty-center">
          <div class="album-cover-empty-icon">${meta.icon}</div>
          <strong>${escapeHtml(initials || 'AL')}</strong>
          <span>${escapeHtml(album.description || 'Adicione fotos para formar a capa deste álbum.')}</span>
        </div>
      </div>`;
  }
  const ordered = orderedAlbumPhotos(album, photos);
  const cover = ordered[0];
  const thumbs = ordered.slice(1,4);
  const slideshowOn = album.coverSlideshow !== false && photos.length > 1;
  return `
    <div class="album-cover-photo-layout" data-album-cover-layout="${album.id}">
      <div class="album-cover-main" style="${albumCoverImageStyle(album)}">
        <img class="album-cover-main-image" data-album-cover-image data-photo-id="${cover.id}" src="${escapeHtml(photoSourceUrl(cover,true))}" alt="${escapeHtml(cover.name || album.name || 'Capa do álbum')}" />
        <div class="album-cover-main-overlay"></div>
        <div class="album-cover-main-meta">
          <span>${slideshowOn ? '▶ Capa dinâmica' : meta.label}</span>
          <strong data-album-cover-title>${escapeHtml(cover.name || 'Foto em destaque')}</strong>
        </div>
      </div>
      <div class="album-cover-side ${thumbs.length ? '' : 'empty'}">
        ${thumbs.map(p => `<div class="album-cover-thumb">${photoVisual(p,{thumbnail:true,alt:p.name || 'Miniatura do álbum'})}</div>`).join('')}
        ${thumbs.length < 3 ? `<div class="album-cover-thumb album-cover-thumb-fill ${meta.accent}"><span>${meta.icon}</span></div>`.repeat(3-thumbs.length) : ''}
      </div>
      <div class="album-cover-counter">${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}</div>
      <button class="album-cover-edit-btn" type="button" data-edit-album-cover="${album.id}" aria-label="Editar capa do álbum">✎ Capa</button>
    </div>`;
}

function renderAlbumCard(album) {
  const photos = albumPhotoList(album.id);
  return `
    <article class="album-card album-card-enhanced" data-album-id="${album.id}">
      <div class="album-cover">
        ${albumCoverMarkup(album, photos)}
      </div>
      <div class="album-body">
        <strong>${escapeHtml(album.name)}</strong>
        <span>${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}${album.description ? ' · '+escapeHtml(album.description) : ''}</span>
      </div>
    </article>`;
}

function renderAlbumHero(album, photos) {
  if (!album) return '';
  const ordered = orderedAlbumPhotos(album, photos);
  const cover = ordered[0];
  const meta = albumVisualMeta(album, photos);
  if (!cover) {
    return `
      <section class="album-hero album-hero-empty ${meta.accent}">
        <div class="album-hero-copy">
          <span class="album-hero-eyebrow">${meta.label}</span>
          <h1>${escapeHtml(album.name)}</h1>
          <p>${escapeHtml(album.description || 'Um espaço especial para guardar suas melhores lembranças.')}</p>
          <div class="album-hero-actions">
            <button class="btn primary" data-action="upload">↑ Adicionar fotos</button>
            <button class="btn ghost" data-edit-album-cover="${album.id}">✎ Editar capa</button>
          </div>
        </div>
      </section>`;
  }
  return `
    <section class="album-hero" data-album-hero="${album.id}" style="${albumCoverImageStyle(album)}">
      <img class="album-hero-image" data-album-hero-image src="${escapeHtml(photoSourceUrl(cover,true))}" alt="${escapeHtml(cover.name || album.name)}" />
      <div class="album-hero-shade"></div>
      <div class="album-hero-copy">
        <span class="album-hero-eyebrow">${meta.label} · ${photos.length} ${photos.length===1?'foto':'fotos'}</span>
        <h1>${escapeHtml(album.name)}</h1>
        <p>${escapeHtml(album.description || 'Um espaço especial para guardar suas melhores lembranças.')}</p>
        <div class="album-hero-actions">
          <button class="btn light" data-start-album-slideshow="${album.id}">▶ Slideshow</button>
          <button class="btn light" data-edit-album-cover="${album.id}">✎ Editar capa</button>
          <button class="btn primary" data-action="upload">↑ Adicionar fotos</button>
        </div>
      </div>
      <div class="album-hero-progress" aria-hidden="true"><span></span></div>
    </section>`;
}

function renderAlbums() {
  root.innerHTML = `
    <div class="section-head" style="margin-top:0"><div><h2>Álbuns</h2><p>Momentos, viagens, pessoas e datas especiais.</p></div><button class="btn primary" data-action="album">+ Novo álbum</button></div>
    ${state.albums.length ? `<div class="album-grid">${state.albums.map(renderAlbumCard).join('')}</div>` : renderEmpty('Nenhum álbum ainda', 'Crie um álbum para começar a separar suas fotos por momentos.', 'Criar álbum', 'album')}
  `;
}

const WEDDING_MOMENTS = ['Preparativos','Cerimônia','Noivos','Família','Convidados','Festa','Detalhes'];

function timelineSorted(list) {
  return [...list].sort((a,b) => {
    const ao = Number(a.order || 0), bo = Number(b.order || 0);
    if (ao && bo) return ao - bo;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}

function renderTimeline(list) {
  const ordered = timelineSorted(list);
  return `<div class="timeline-list">${ordered.map((photo,index)=>`
    <article class="timeline-item ${state.selectedIds.has(photo.id) ? 'selected' : ''}" data-photo-id="${photo.id}">
      <div class="timeline-marker"><span>${state.selectionMode && state.selectedIds.has(photo.id) ? '✓' : (photo.order || index+1)}</span></div>
      <div class="timeline-photo">${photoVisual(photo,{thumbnail:true})}</div>
      <div class="timeline-copy">
        <strong>${escapeHtml(photo.name || 'Foto')}</strong>
        <span>${escapeHtml(photo.moment || getAlbum(photo.albumId)?.name || 'Memória')} · ${bytesLabel(photo.size)}</span>
        <small>${photo.width && photo.height ? `${photo.width}×${photo.height} · ` : ''}${formatDate(photo.createdAt)}</small>
      </div>
    </article>`).join('')}</div>`;
}

function selectionToolbar() {
  if (!state.selectionMode) return '';
  return `<div class="selection-toolbar">
    <strong>${state.selectedIds.size} selecionada(s)</strong>
    <div>
      <button class="btn ghost" data-bulk-action="favorite">♥ Favoritar</button>
      <button class="btn ghost" data-bulk-action="move">↪ Mover</button>
      <button class="btn danger" data-bulk-action="delete">Excluir</button>
      <button class="btn ghost" data-bulk-action="cancel">Cancelar</button>
    </div>
  </div>`;
}

function renderPhotoView(title, subtitle, list, opts={}) {
  let filtered = sorted(list.filter(photoMatches));
  const isWedding = opts.album?.name?.toLowerCase().includes('casamento');
  if (isWedding && state.momentFilter !== 'all') filtered = filtered.filter(p => p.moment === state.momentFilter);
  const albumHero = opts.album ? renderAlbumHero(opts.album, filtered) : '';
  const viewMarkup = state.galleryMode === 'timeline' ? renderTimeline(filtered) : `<div class="photo-grid">${filtered.map(renderPhotoCard).join('')}</div>`;
  root.innerHTML = `
    ${albumHero}
    <div class="section-head ${opts.album ? 'album-section-head' : ''}" style="${opts.album ? '' : 'margin-top:0'}"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><div class="section-actions">${filtered.length ? `<button class="btn ghost" data-start-view-slideshow>▶ Slideshow</button>` : ''}${opts.album ? `<button class="btn ghost" data-manage-album="${opts.album.id}">⚙ Gerenciar</button>` : ''}<button class="btn primary" data-action="upload">↑ Enviar fotos</button></div></div>
    ${selectionToolbar()}
    <div class="toolbar">
      <div class="filter-row">
        ${opts.backAlbum ? `<button class="chip" data-view-link="albums">← Álbuns</button>` : ''}
        <span class="chip active">${filtered.length} ${filtered.length===1?'foto':'fotos'}</span>
        ${isWedding ? `<button class="chip ${state.momentFilter==='all'?'active':''}" data-moment-filter="all">Todos</button>${WEDDING_MOMENTS.map(m=>`<button class="chip ${state.momentFilter===m?'active':''}" data-moment-filter="${m}">${m}</button>`).join('')}` : ''}
      </div>
      <div class="toolbar-actions">
        <button class="chip ${state.galleryMode==='grid'?'active':''}" data-gallery-mode="grid">▦ Grade</button>
        <button class="chip ${state.galleryMode==='timeline'?'active':''}" data-gallery-mode="timeline">↕ Timeline</button>
        <button class="chip ${state.selectionMode?'active':''}" data-toggle-selection>${state.selectionMode?'✓ Selecionando':'☑ Selecionar'}</button>
        <select class="select" id="sortSelect">
          <option value="newest" ${state.sort==='newest'?'selected':''}>Mais recentes</option>
          <option value="oldest" ${state.sort==='oldest'?'selected':''}>Mais antigas</option>
          <option value="name" ${state.sort==='name'?'selected':''}>Nome</option>
        </select>
      </div>
    </div>
    ${filtered.length ? viewMarkup : renderEmpty('Nada por aqui', state.search ? 'Nenhuma foto corresponde à sua busca.' : 'Adicione fotos para preencher esta coleção.')}
  `;
}

function renderTrash() {
  const list = sorted(deletedPhotos().filter(photoMatches));
  root.innerHTML = `
    <div class="section-head" style="margin-top:0"><div><h2>Lixeira</h2><p>Fotos excluídas podem ser restauradas ou apagadas definitivamente.</p></div></div>
    ${list.length ? `<div class="photo-grid">${list.map(p => `
      <article class="photo-card" data-trash-id="${p.id}">
        ${photoVisual(p,{thumbnail:true})}
        <div class="photo-overlay" style="opacity:1"></div>
        <div class="photo-info" style="opacity:1;transform:none;right:10px"><strong>${escapeHtml(p.name)}</strong><span>Excluída em ${formatDate(p.deletedAt)}</span></div>
      </article>`).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">⌫</div><h3>Lixeira vazia</h3><p>Quando você excluir uma foto, ela aparecerá aqui antes da exclusão definitiva.</p></div>`}
  `;
}

function clearDynamicUiTimers() {
  for (const key of ['homeCarouselTimer','albumCardTimer','albumHeroTimer']) {
    clearInterval(galleryUiState[key]);
    galleryUiState[key] = null;
  }
}

function renderCurrent() {
  clearDynamicUiTimers();
  $$('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === state.view || (state.view.startsWith('album:') && b.dataset.view === 'albums')));
  if (state.view === 'home') renderHome();
  else if (state.view === 'albums') renderAlbums();
  else if (state.view === 'favorites') renderPhotoView('Favoritos', 'As fotos que você marcou para encontrar mais rápido.', activePhotos().filter(p=>p.favorite));
  else if (state.view === 'trash') renderTrash();
  else if (state.view.startsWith('album:')) {
    const albumId = state.view.split(':')[1];
    const album = getAlbum(albumId);
    renderPhotoView(album?.name || 'Álbum', album?.description || 'Fotos deste álbum.', albumPhotoList(albumId), { backAlbum:true, album });
  } else renderPhotoView('Todas as fotos', 'Sua coleção completa de memórias.', activePhotos());
  requestAnimationFrame(startDynamicUi);
}

function setHomeCarouselSlide(index) {
  const holder = $('[data-home-carousel]');
  if (!holder) return;
  const photos = sorted(activePhotos().filter(photoMatches)).slice(0,6);
  if (!photos.length) return;
  galleryUiState.homeCarouselIndex = (index + photos.length) % photos.length;
  const photo = photos[galleryUiState.homeCarouselIndex];
  const main = holder.querySelector('[data-home-carousel-main]');
  const img = holder.querySelector('.home-carousel-image');
  const title = holder.querySelector('[data-home-carousel-title]');
  const meta = holder.querySelector('[data-home-carousel-meta]');
  const album = getAlbum(photo.albumId);
  if (!main || !img) return;
  main.classList.add('is-changing');
  setTimeout(() => {
    img.src = photoSourceUrl(photo,true);
    img.alt = photo.name || 'Foto em destaque';
    main.dataset.photoId = photo.id;
    title.textContent = photo.name || 'Foto em destaque';
    meta.textContent = `${album?.name ? album.name + ' · ' : ''}${formatDate(photo.createdAt)}`;
    holder.querySelectorAll('.hero-carousel-dot').forEach((dot,i)=>dot.classList.toggle('active', i===galleryUiState.homeCarouselIndex));
    holder.querySelectorAll('[data-home-thumb-id]').forEach(thumb=>thumb.classList.toggle('active', thumb.dataset.homeThumbId===photo.id));
    requestAnimationFrame(()=>main.classList.remove('is-changing'));
  }, 180);
}

function startHomeCarousel() {
  if (!$('[data-home-carousel]')) return;
  clearInterval(galleryUiState.homeCarouselTimer);
  galleryUiState.homeCarouselTimer = setInterval(()=>setHomeCarouselSlide(galleryUiState.homeCarouselIndex+1), 5200);
}

function startAlbumCardSlideshows() {
  const cards = $$('[data-album-cover-layout]');
  if (!cards.length) return;
  const indices = new Map();
  galleryUiState.albumCardTimer = setInterval(()=>{
    cards.forEach(layout=>{
      const album = getAlbum(layout.dataset.albumCoverLayout);
      if (!album || album.coverSlideshow === false) return;
      const photos = orderedAlbumPhotos(album, albumPhotoList(album.id));
      if (photos.length < 2) return;
      const img = layout.querySelector('[data-album-cover-image]');
      const title = layout.querySelector('[data-album-cover-title]');
      if (!img) return;
      const current = (indices.get(album.id) || 0) + 1;
      const idx = current % photos.length;
      indices.set(album.id, idx);
      const photo = photos[idx];
      img.classList.add('is-changing');
      setTimeout(()=>{
        img.src = photoSourceUrl(photo,true);
        img.dataset.photoId = photo.id;
        if (title) title.textContent = photo.name || 'Foto';
        requestAnimationFrame(()=>img.classList.remove('is-changing'));
      }, 160);
    });
  }, 4300);
}

function startAlbumHeroCarousel() {
  const hero = $('[data-album-hero]');
  if (!hero) return;
  const album = getAlbum(hero.dataset.albumHero);
  const photos = album ? orderedAlbumPhotos(album, albumPhotoList(album.id)) : [];
  if (!album || photos.length < 2 || album.coverSlideshow === false) return;
  galleryUiState.albumHeroIndex = 0;
  galleryUiState.albumHeroTimer = setInterval(()=>{
    galleryUiState.albumHeroIndex = (galleryUiState.albumHeroIndex + 1) % Math.min(photos.length, 12);
    const photo = photos[galleryUiState.albumHeroIndex];
    const img = hero.querySelector('[data-album-hero-image]');
    if (!img) return;
    hero.classList.add('is-changing');
    setTimeout(()=>{
      img.src = photoSourceUrl(photo,true);
      setTimeout(()=>hero.classList.remove('is-changing'),80);
    },220);
  }, 5600);
}

function startDynamicUi() {
  startHomeCarousel();
  startAlbumCardSlideshows();
  startAlbumHeroCarousel();
}

async function importBundledFamilyPhotos() {
  try {
    const response = await fetch(BUNDLED_MANIFEST_URL, { cache:'no-cache' });
    if (!response.ok) throw new Error(`Manifesto indisponível (${response.status})`);
    const manifest = await response.json();
    const albumInfo = manifest?.album;
    const photos = Array.isArray(manifest?.photos) ? manifest.photos : [];
    if (!albumInfo?.id || !photos.length) return false;
    const importedVersion = localStorage.getItem(BUNDLED_IMPORT_KEY);
    const hasCurrentEncryptedRefs = state.photos.some(p => p.bundled && p.encryptedAsset && p.bundleVersion === manifest.version);
    if (importedVersion === manifest.version && hasCurrentEncryptedRefs) return false;

    let album = state.albums.find(a => a.id === albumInfo.id);
    if (!album) {
      album = {
        id: albumInfo.id,
        name: albumInfo.name || 'Casamento',
        description: albumInfo.description || 'Memórias e momentos especiais do casamento',
        createdAt: new Date().toISOString(),
      };
      state.albums.push(album);
    } else {
      // Mantém capa/zoom/slideshow já configurados e atualiza somente a identidade do álbum.
      album = {
        ...album,
        name: albumInfo.name || 'Casamento',
        description: albumInfo.description || 'Memórias e momentos especiais do casamento',
        updatedAt: new Date().toISOString(),
      };
      const albumIndex = state.albums.findIndex(a => a.id === album.id);
      if (albumIndex >= 0) state.albums[albumIndex] = album;
    }
    await idbPut(ALBUM_STORE, album);

    const byId = new Map(state.photos.map(p => [p.id, p]));
    const baseTime = Date.now();
    let added = 0;
    let migrated = 0;

    for (let i=0; i<photos.length; i++) {
      const item = photos[i];
      if (!item?.id) continue;
      const existing = byId.get(item.id);

      if (existing) {
        const updated = {
          ...existing,
          filename: item.filename || existing.filename,
          originalFilename: item.originalFilename || existing.originalFilename || existing.filename,
          type: 'image/webp',
          size: Number(item.size) || existing.size || 0,
          width: Number(item.width) || existing.width || null,
          height: Number(item.height) || existing.height || null,
          assetUrl: item.path,
          thumbAssetUrl: item.thumb || item.path,
          encryptedAsset: true,
          iv: item.iv,
          thumbIv: item.thumbIv,
          aad: item.aad,
          thumbAad: item.thumbAad,
          previewUnsupported: false,
          albumId: album.id,
          tags: [...new Set([...(existing.tags || []).filter(t => !/^lote-/i.test(t)), 'casamento', 'família'])],
          bundled: true,
          bundleVersion: manifest.version || '2.0.0-secure',
          sourceLot: null,
          event: 'Casamento',
          order: Number(item.order) || existing.order || null,
          updatedAt: new Date().toISOString(),
        };
        await idbPut(PHOTO_STORE, updated);
        const idx = state.photos.findIndex(p => p.id === updated.id);
        if (idx >= 0) state.photos[idx] = updated;
        byId.set(updated.id, updated);
        migrated++;
        continue;
      }

      const createdAt = new Date(baseTime - (photos.length - i) * 1000).toISOString();
      const photo = {
        id: item.id,
        name: item.name || item.originalFilename || item.filename || 'Foto do casamento',
        filename: item.filename || `${item.id}.webp`,
        originalFilename: item.originalFilename || null,
        type: 'image/webp',
        size: Number(item.size) || 0,
        width: Number(item.width) || null,
        height: Number(item.height) || null,
        assetUrl: item.path,
        thumbAssetUrl: item.thumb || item.path,
        encryptedAsset: true,
        iv: item.iv,
        thumbIv: item.thumbIv,
        aad: item.aad,
        thumbAad: item.thumbAad,
        previewUnsupported: false,
        albumId: album.id,
        tags: ['casamento', 'família'],
        favorite: false,
        bundled: true,
        bundleVersion: manifest.version || '2.0.0-secure',
        sourceLot: null,
        event: 'Casamento',
        order: Number(item.order) || i + 1,
        createdAt,
        importedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      };
      await idbPut(PHOTO_STORE, photo);
      state.photos.push(photo);
      byId.set(photo.id, photo);
      added++;
    }

    localStorage.setItem(BUNDLED_IMPORT_KEY, manifest.version || '2.0.0-secure');
    if (added || migrated) toast(`${photos.length} fotos organizadas no álbum Casamento.`, 4200);
    return added > 0 || migrated > 0;
  } catch (err) {
    console.warn('Não foi possível carregar as fotos do casamento incluídas no projeto.', err);
    return false;
  }
}

async function loadState() {
  state.photos = await idbAll(PHOTO_STORE);
  state.albums = await idbAll(ALBUM_STORE);

  // Atualiza/inclui o álbum Casamento com referências criptografadas antes de renderizar.
  await importBundledFamilyPhotos();
  await migrateLegacyPlainPhotos();

  if (!state.albums.length) {
    const starter = { id:uid('alb'), name:'Meu álbum', description:'Suas memórias especiais', createdAt:new Date().toISOString() };
    await idbPut(ALBUM_STORE, starter);
    state.albums = [starter];
  }

  await hydratePhotoThumbnails();
  refreshAlbumSelect();
  renderCurrent();
}

function refreshAlbumSelect() {
  const select = $('#uploadAlbum');
  if (!select) return;
  select.innerHTML = `<option value="">Sem álbum</option>` + state.albums.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
}

function openUploadDialog() {
  state.uploadFiles = [];
  $('#fileInput').value = '';
  $('#cameraInput').value = '';
  $('#uploadTags').value = '';
  $('#uploadProgress').hidden = true;
  $('#confirmUploadBtn').disabled = false;
  refreshAlbumSelect();
  if (state.view.startsWith('album:')) {
    const currentAlbumId = state.view.split(':')[1];
    if ($('#uploadAlbum').querySelector(`option[value="${CSS.escape(currentAlbumId)}"]`)) $('#uploadAlbum').value = currentAlbumId;
  }
  renderUploadPreview();
  $('#uploadDialog').showModal();
}

function extensionOf(name='') { return name.includes('.') ? name.split('.').pop().toLowerCase() : ''; }
function isLikelyImage(file) { return !!file && (file.type?.startsWith('image/') || IMAGE_EXTENSIONS.has(extensionOf(file.name))); }

function mimeFromFile(file) {
  if (file.type) return file.type;
  const ext = extensionOf(file.name);
  return ({jpg:'image/jpeg',jpeg:'image/jpeg',jfif:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif',gif:'image/gif',bmp:'image/bmp',heic:'image/heic',heif:'image/heif'})[ext] || 'application/octet-stream';
}

function addUploadFiles(fileList) {
  const incoming = [...(fileList || [])].filter(isLikelyImage);
  const seen = new Set(state.uploadFiles.map(f => `${f.name}|${f.size}|${f.lastModified}`));
  for (const file of incoming) {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (!seen.has(key)) { state.uploadFiles.push(file); seen.add(key); }
  }
  if (!incoming.length && fileList?.length) toast('Nenhuma imagem compatível foi encontrada.');
  renderUploadPreview();
}

function renderUploadPreview() {
  const preview = $('#uploadPreview');
  const summary = $('#uploadSummary');
  const files = state.uploadFiles;
  const totalSize = files.reduce((n,f)=>n+f.size,0);
  summary.textContent = files.length ? `${files.length} ${files.length===1?'foto selecionada':'fotos selecionadas'} · ${bytesLabel(totalSize)}` : 'Nenhuma foto selecionada.';
  if (!files.length) {
    preview.className = 'upload-preview empty';
    preview.textContent = 'As fotos escolhidas aparecerão aqui antes de serem salvas.';
    return;
  }
  preview.className = 'upload-preview';
  preview.innerHTML = files.map((file,index) => {
    const ext = extensionOf(file.name).toUpperCase() || 'IMG';
    const extLower = extensionOf(file.name);
    const src = file.type?.startsWith('image/') && !['heic','heif'].includes(extLower) ? urlForBlob(file) : '';
    return `<div class="preview-thumb" title="${escapeHtml(file.name)}">
      ${src ? `<img src="${src}" alt="${escapeHtml(file.name)}">` : `<div class="preview-filetype">${escapeHtml(ext)}</div>`}
      <button type="button" class="preview-remove" data-remove-upload="${index}" aria-label="Remover ${escapeHtml(file.name)}">×</button>
      <span>${escapeHtml(file.name)}</span>
    </div>`;
  }).join('');
}

async function loadDrawable(blob) {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close?.() };
    } catch (_) {}
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = urlForBlob(blob);
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => {} });
    img.onerror = () => reject(new Error('Formato não pode ser visualizado neste navegador.'));
    img.src = url;
  });
}

function canvasToBlob(canvas, type='image/webp', quality=.82) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível gerar a imagem.')), type, quality);
  });
}

async function createThumbnail(blob, max=640) {
  const drawable = await loadDrawable(blob);
  try {
    const scale = Math.min(1, max / Math.max(drawable.width, drawable.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(drawable.width * scale));
    canvas.height = Math.max(1, Math.round(drawable.height * scale));
    const ctx = canvas.getContext('2d', { alpha:false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(drawable.source, 0, 0, canvas.width, canvas.height);
    try { return await canvasToBlob(canvas, 'image/webp', .80); }
    catch (_) { return await canvasToBlob(canvas, 'image/jpeg', .82); }
  } finally { drawable.cleanup(); }
}

function setUploadProgress(done, total, label='Processando fotos') {
  const wrap = $('#uploadProgress');
  wrap.hidden = false;
  const percent = total ? Math.round((done / total) * 100) : 0;
  $('#uploadProgressBar').value = percent;
  $('#uploadProgressPercent').textContent = `${percent}%`;
  $('#uploadProgressText').textContent = `${label} · ${done}/${total}`;
}

async function saveUploads() {
  if (!state.uploadFiles.length) { toast('Selecione pelo menos uma foto.'); return false; }
  const albumId = $('#uploadAlbum').value || null;
  const tags = $('#uploadTags').value.split(',').map(v=>v.trim()).filter(Boolean);
  const files = [...state.uploadFiles];
  $('#confirmUploadBtn').disabled = true;
  setUploadProgress(0, files.length, 'Preparando');
  let saved = 0, unsupported = 0;

  try {
    for (let i=0; i<files.length; i++) {
      const file = files[i];
      setUploadProgress(i, files.length, `Otimizando ${file.name}`);
      let thumbBlob = null;
      let previewUnsupported = false;
      try { thumbBlob = await createThumbnail(file); }
      catch (_) { previewUnsupported = true; unsupported++; }

      const now = new Date().toISOString();
      const id = uid('photo');
      const encryptedOriginal = await window.MemVault.encryptBlob(file, id, 'original');
      const encryptedThumb = thumbBlob ? await window.MemVault.encryptBlob(thumbBlob, id, 'thumb') : null;
      const photo = {
        id,
        name: file.name.replace(/\.[^.]+$/, '') || 'Foto',
        filename: file.name || `foto-${Date.now()}.jpg`,
        type: mimeFromFile(file),
        size: file.size,
        encryptedBlob: encryptedOriginal.blob,
        localIv: encryptedOriginal.iv,
        localAad: encryptedOriginal.aad,
        thumbEncryptedBlob: encryptedThumb?.blob || null,
        thumbType: thumbBlob?.type || null,
        thumbLocalIv: encryptedThumb?.iv || null,
        thumbLocalAad: encryptedThumb?.aad || null,
        encryptedLocal: true,
        previewUnsupported,
        albumId,
        tags,
        favorite:false,
        createdAt: file.lastModified ? new Date(file.lastModified).toISOString() : now,
        importedAt: now,
        updatedAt: now,
        deletedAt:null,
      };
      await idbPut(PHOTO_STORE, photo);
      state.photos.push(photo);
      if (thumbBlob) runtimeMediaUrls.set(`t:${photo.id}`, urlForBlob(thumbBlob));
      saved++;
      setUploadProgress(i+1, files.length, `Salvando ${file.name}`);
    }
  } catch (err) {
    console.error(err);
    const quota = err?.name === 'QuotaExceededError';
    toast(quota ? 'O armazenamento do navegador ficou sem espaço. Remova fotos ou conecte a nuvem.' : 'Não foi possível salvar todas as fotos.', 4200);
    $('#confirmUploadBtn').disabled = false;
    renderCurrent();
    return false;
  }

  state.uploadFiles = [];
  renderCurrent();
  $('#confirmUploadBtn').disabled = false;
  if (unsupported) toast(`${saved} foto(s) salva(s). ${unsupported} arquivo(s) ficaram sem prévia neste navegador.`, 4200);
  else toast(`${saved} ${saved===1?'foto salva':'fotos salvas'} com sucesso.`);
  return true;
}

async function createAlbum() {
  const name = $('#albumName').value.trim();
  if (!name) { toast('Digite um nome para o álbum.'); return false; }
  const album = { id:uid('alb'), name, description:$('#albumDescription').value.trim(), createdAt:new Date().toISOString() };
  await idbPut(ALBUM_STORE, album);
  state.albums.unshift(album);
  $('#albumName').value='';
  $('#albumDescription').value='';
  refreshAlbumSelect();
  renderCurrent();
  toast('Álbum criado.');
  return true;
}


let pendingMoveIds = [];
let infoPhotoId = null;

function openAlbumManager(albumId) {
  const album = getAlbum(albumId);
  if (!album) return;
  $('#albumManageId').value = album.id;
  $('#albumManageName').value = album.name || '';
  $('#albumManageDescription').value = album.description || '';
  const protectedAlbum = album.id === 'album_fotos_familia';
  $('#deleteAlbumBtn').disabled = protectedAlbum;
  $('#deleteAlbumBtn').title = protectedAlbum ? 'O álbum Casamento faz parte do acervo protegido.' : 'Excluir álbum';
  $('#albumManageDialog').showModal();
}

async function saveAlbumManage() {
  const album = getAlbum($('#albumManageId').value);
  if (!album) return;
  const name = $('#albumManageName').value.trim();
  if (!name) { toast('Digite um nome para o álbum.'); return; }
  album.name = name;
  album.description = $('#albumManageDescription').value.trim();
  album.updatedAt = new Date().toISOString();
  await idbPut(ALBUM_STORE, album);
  $('#albumManageDialog').close();
  refreshAlbumSelect();
  renderCurrent();
  toast('Álbum atualizado.');
}

async function deleteManagedAlbum() {
  const album = getAlbum($('#albumManageId').value);
  if (!album || album.id === 'album_fotos_familia') return;
  const photos = state.photos.filter(p=>p.albumId===album.id);
  if (!confirm(`Excluir o álbum “${album.name}”? ${photos.length ? 'As fotos serão mantidas em “Sem álbum”.' : ''}`)) return;
  for (const photo of photos) {
    photo.albumId = null;
    photo.updatedAt = new Date().toISOString();
    await idbPut(PHOTO_STORE, photo);
  }
  await idbDelete(ALBUM_STORE, album.id);
  state.albums = state.albums.filter(a=>a.id!==album.id);
  $('#albumManageDialog').close();
  state.view = 'albums';
  refreshAlbumSelect();
  renderCurrent();
  toast('Álbum excluído; as fotos foram preservadas.');
}

function openMovePhotos(ids) {
  pendingMoveIds = [...new Set((ids || []).filter(Boolean))];
  if (!pendingMoveIds.length) return;
  $('#movePhotosCount').textContent = `${pendingMoveIds.length} ${pendingMoveIds.length===1?'foto será movida':'fotos serão movidas'}.`;
  $('#moveAlbumSelect').innerHTML = `<option value="">Sem álbum</option>` + state.albums.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  $('#movePhotosDialog').showModal();
}

async function confirmMovePhotos() {
  const albumId = $('#moveAlbumSelect').value || null;
  for (const id of pendingMoveIds) {
    const photo = state.photos.find(p=>p.id===id);
    if (!photo) continue;
    photo.albumId = albumId;
    photo.updatedAt = new Date().toISOString();
    await idbPut(PHOTO_STORE, photo);
  }
  $('#movePhotosDialog').close();
  pendingMoveIds = [];
  state.selectedIds.clear();
  state.selectionMode = false;
  renderCurrent();
  toast('Fotos movidas.');
}

function openPhotoInfo(photo) {
  if (!photo) return;
  infoPhotoId = photo.id;
  const album = getAlbum(photo.albumId);
  $('#photoInfoBody').innerHTML = `
    <div><span>Nome</span><strong>${escapeHtml(photo.name || 'Foto')}</strong></div>
    <div><span>Arquivo</span><strong>${escapeHtml(photo.filename || '-')}</strong></div>
    <div><span>Álbum</span><strong>${escapeHtml(album?.name || 'Sem álbum')}</strong></div>
    <div><span>Resolução</span><strong>${photo.width && photo.height ? `${photo.width} × ${photo.height}` : 'Não informada'}</strong></div>
    <div><span>Tamanho</span><strong>${bytesLabel(photo.size)}</strong></div>
    <div><span>Formato</span><strong>${escapeHtml(photo.type || 'imagem')}</strong></div>
    <div><span>Data</span><strong>${formatDate(photo.createdAt)}</strong></div>
    <div><span>Proteção</span><strong>${photo.bundled || photo.encryptedLocal ? 'Criptografada' : 'Local'}</strong></div>`;
  $('#photoMomentSelect').value = photo.moment || '';
  $('#photoInfoDialog').showModal();
}

async function savePhotoMoment() {
  const photo = state.photos.find(p=>p.id===infoPhotoId);
  if (!photo) return;
  photo.moment = $('#photoMomentSelect').value || null;
  photo.updatedAt = new Date().toISOString();
  await idbPut(PHOTO_STORE, photo);
  $('#photoInfoDialog').close();
  renderCurrent();
  if ($('#lightbox').open) updateLightbox();
  toast('Categoria da foto atualizada.');
}

async function sharePhoto(photo) {
  if (!photo) return;
  try {
    const blob = await blobForPhoto(photo, false);
    if (!blob) throw new Error('Foto indisponível');
    const file = new File([blob], photo.filename || 'foto.jpg', {type: photo.type || blob.type || 'image/jpeg'});
    if (navigator.canShare?.({files:[file]}) && navigator.share) {
      await navigator.share({title: photo.name || 'Memória', text:'Uma lembrança do nosso álbum.', files:[file]});
    } else {
      toast('Compartilhamento de arquivos não é suportado neste navegador. Use “Baixar”.', 4200);
    }
  } catch (err) {
    if (err?.name !== 'AbortError') { console.error(err); toast('Não foi possível compartilhar esta foto.', 3600); }
  }
}

function togglePhotoSelection(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id); else state.selectedIds.add(id);
  renderCurrent();
}

async function handleBulkAction(action) {
  const ids = [...state.selectedIds];
  if (action === 'cancel') {
    state.selectedIds.clear(); state.selectionMode = false; renderCurrent(); return;
  }
  if (!ids.length) { toast('Selecione pelo menos uma foto.'); return; }
  if (action === 'move') { openMovePhotos(ids); return; }
  if (action === 'favorite') {
    for (const id of ids) {
      const photo = state.photos.find(p=>p.id===id); if (!photo) continue;
      photo.favorite = true; photo.updatedAt = new Date().toISOString(); await idbPut(PHOTO_STORE, photo);
    }
    toast(`${ids.length} foto(s) adicionada(s) aos favoritos.`);
  }
  if (action === 'delete') {
    if (!confirm(`Mover ${ids.length} foto(s) para a lixeira?`)) return;
    for (const id of ids) {
      const photo = state.photos.find(p=>p.id===id); if (!photo) continue;
      photo.deletedAt = new Date().toISOString(); await idbPut(PHOTO_STORE, photo);
    }
    toast(`${ids.length} foto(s) movida(s) para a lixeira.`);
  }
  state.selectedIds.clear(); state.selectionMode = false; renderCurrent();
}

async function toggleFavorite(id) {
  const photo = state.photos.find(p=>p.id===id); if(!photo) return;
  photo.favorite = !photo.favorite;
  photo.updatedAt = new Date().toISOString();
  await idbPut(PHOTO_STORE, photo);
  renderCurrent();
  if ($('#lightbox').open) updateLightbox();
}

async function softDelete(id) {
  const photo = state.photos.find(p=>p.id===id); if(!photo) return;
  photo.deletedAt = new Date().toISOString();
  await idbPut(PHOTO_STORE, photo);
  renderCurrent();
  toast('Foto movida para a lixeira.');
}

async function restorePhoto(id) {
  const photo = state.photos.find(p=>p.id===id); if(!photo) return;
  photo.deletedAt = null;
  await idbPut(PHOTO_STORE, photo);
  renderCurrent();
  toast('Foto restaurada.');
}

async function permanentDelete(id) {
  if (!confirm('Apagar esta foto definitivamente? Essa ação não pode ser desfeita.')) return;
  await idbDelete(PHOTO_STORE, id);
  state.photos = state.photos.filter(p=>p.id!==id);
  renderCurrent();
  toast('Foto apagada definitivamente.');
}

function openAlbumCoverEditor(albumId) {
  const album = getAlbum(albumId);
  const photos = albumPhotoList(albumId);
  if (!album) return;
  if (!photos.length) { toast('Adicione pelo menos uma foto ao álbum antes de escolher a capa.'); return; }
  coverEditorState.albumId = albumId;
  const ordered = orderedAlbumPhotos(album, photos);
  coverEditorState.selectedPhotoId = album.coverPhotoId && photos.some(p=>p.id===album.coverPhotoId) ? album.coverPhotoId : ordered[0].id;
  $('#coverPositionX').value = Number(album.coverPositionX ?? 50);
  $('#coverPositionY').value = Number(album.coverPositionY ?? 50);
  $('#coverZoom').value = Number(album.coverZoom ?? 100);
  $('#coverSlideshowToggle').checked = album.coverSlideshow !== false;
  renderAlbumCoverEditor();
  $('#albumCoverDialog').showModal();
}

function renderAlbumCoverEditor() {
  const album = getAlbum(coverEditorState.albumId);
  if (!album) return;
  const photos = albumPhotoList(album.id);
  const selected = photos.find(p=>p.id===coverEditorState.selectedPhotoId) || photos[0];
  $('#albumCoverDialogTitle').textContent = `Capa de ${album.name}`;
  const preview = $('#albumCoverPreviewImage');
  preview.src = photoSourceUrl(selected,true);
  preview.alt = selected.name || 'Prévia da capa';
  updateAlbumCoverPreviewStyle();
  $('#albumCoverChoices').innerHTML = photos.map(photo=>`
    <button type="button" class="album-cover-choice ${photo.id===selected.id?'active':''}" data-cover-choice="${photo.id}" title="${escapeHtml(photo.name || 'Foto')}">
      ${photoVisual(photo,{thumbnail:true,alt:photo.name || 'Foto'})}
      <span>${photo.id===selected.id?'✓':''}</span>
    </button>`).join('');
}

function updateAlbumCoverPreviewStyle() {
  const img = $('#albumCoverPreviewImage');
  if (!img) return;
  const x = Number($('#coverPositionX').value);
  const y = Number($('#coverPositionY').value);
  const zoom = Number($('#coverZoom').value) / 100;
  img.style.objectPosition = `${x}% ${y}%`;
  img.style.transform = `scale(${zoom})`;
  $('#coverPositionXOut').textContent = `${x}%`;
  $('#coverPositionYOut').textContent = `${y}%`;
  $('#coverZoomOut').textContent = `${Math.round(zoom*100)}%`;
}

async function saveAlbumCoverSettings() {
  const album = getAlbum(coverEditorState.albumId);
  if (!album) return;
  album.coverPhotoId = coverEditorState.selectedPhotoId;
  album.coverPositionX = Number($('#coverPositionX').value);
  album.coverPositionY = Number($('#coverPositionY').value);
  album.coverZoom = Number($('#coverZoom').value);
  album.coverSlideshow = $('#coverSlideshowToggle').checked;
  album.updatedAt = new Date().toISOString();
  await idbPut(ALBUM_STORE, album);
  $('#albumCoverDialog').close();
  renderCurrent();
  toast('Capa do álbum atualizada.');
}

function setSlideshowPlaying(playing) {
  galleryUiState.slideshowPlaying = playing;
  clearInterval(galleryUiState.slideshowTimer);
  galleryUiState.slideshowTimer = null;
  const btn = $('#lightboxSlideshow');
  if (btn) btn.textContent = playing ? 'Ⅱ Pausar slideshow' : '▶ Slideshow';
  const lightbox = $('#lightbox');
  lightbox?.classList.toggle('slideshow-active', playing);
  lightbox?.classList.toggle('effect-kenburns', (localStorage.getItem('memorias-slideshow-effect') || 'kenburns') === 'kenburns');
  if (playing) {
    const interval = Number(localStorage.getItem('memorias-slideshow-speed') || 4200);
    lightbox?.style.setProperty('--slideshow-duration', `${Math.max(2200, interval - 250)}ms`);
    galleryUiState.slideshowTimer = setInterval(()=>transitionLightbox(1), Math.max(2500, interval));
  }
}

function transitionLightbox(delta=1) {
  const img = $('#lightboxImage');
  if (!img) return;
  img.classList.add('slideshow-changing');
  setTimeout(()=>{
    moveLightbox(delta);
    if (galleryUiState.slideshowPlaying) {
      img.style.animation = 'none';
      void img.offsetWidth;
      img.style.animation = '';
    }
    requestAnimationFrame(()=>setTimeout(()=>img.classList.remove('slideshow-changing'),40));
  },220);
}

function startViewSlideshow(photoId=null) {
  const list = visiblePhotosForLightbox();
  if (!list.length) return;
  state.lightboxIds = list.map(p=>p.id);
  state.lightboxIndex = photoId ? Math.max(0,state.lightboxIds.indexOf(photoId)) : 0;
  updateLightbox();
  if (!$('#lightbox').open) $('#lightbox').showModal();
  setSlideshowPlaying(true);
}

function startAlbumSlideshow(albumId) {
  const photos = sorted(albumPhotoList(albumId).filter(photoMatches));
  if (!photos.length) return;
  state.lightboxIds = photos.map(p=>p.id);
  state.lightboxIndex = 0;
  updateLightbox();
  if (!$('#lightbox').open) $('#lightbox').showModal();
  setSlideshowPlaying(true);
}

function visiblePhotosForLightbox() {
  if (state.view === 'favorites') return sorted(activePhotos().filter(p=>p.favorite).filter(photoMatches));
  if (state.view.startsWith('album:')) return sorted(albumPhotoList(state.view.split(':')[1]).filter(photoMatches));
  return sorted(activePhotos().filter(photoMatches));
}

function openLightbox(id) {
  const list = visiblePhotosForLightbox();
  state.lightboxIds = list.map(p=>p.id);
  state.lightboxIndex = Math.max(0, state.lightboxIds.indexOf(id));
  updateLightbox();
  if (!$('#lightbox').open) $('#lightbox').showModal();
}

function currentLightboxPhoto() { return state.photos.find(p=>p.id===state.lightboxIds[state.lightboxIndex]); }

async function updateLightbox() {
  const photo = currentLightboxPhoto(); if(!photo) return;
  const token = photo.id;
  const album = getAlbum(photo.albumId);
  const img = $('#lightboxImage');
  if (photo.previewUnsupported) {
    img.removeAttribute('src');
    img.alt = 'Prévia não disponível neste navegador';
    img.style.display = 'none';
  } else {
    img.style.display = '';
    img.alt = photo.name || 'Foto';
    const thumb = photoSourceUrl(photo, true);
    if (thumb) img.src = thumb;
    try {
      const full = await ensurePhotoObjectUrl(photo, false);
      if (full && currentLightboxPhoto()?.id === token) img.src = full;
    } catch (err) { console.warn('Falha ao abrir original protegido', err); }
  }
  $('#lightboxTitle').textContent = photo.name || 'Foto';
  const resolution = photo.width && photo.height ? ` · ${photo.width}×${photo.height}` : '';
  $('#lightboxMeta').textContent = `${album?.name || 'Sem álbum'} · ${formatDate(photo.createdAt)} · ${bytesLabel(photo.size)}${resolution}${photo.editedFrom ? ' · versão editada' : ''}`;
  $('#lightboxFavorite').textContent = photo.favorite ? '♥ Favorita' : '♡ Favoritar';
  $('#lightboxEdit').disabled = !!photo.previewUnsupported;
  $('#lightboxEdit').title = photo.previewUnsupported ? 'Este formato não pode ser editado neste navegador.' : 'Editar foto';
}

function moveLightbox(delta) {
  if (!state.lightboxIds.length) return;
  state.lightboxIndex = (state.lightboxIndex + delta + state.lightboxIds.length) % state.lightboxIds.length;
  updateLightbox();
}

async function downloadPhoto(photo) {
  if (!photo) return;
  try {
    const blob = await blobForPhoto(photo, false);
    if (!blob) throw new Error('Arquivo não encontrado');
    const href = urlForBlob(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = photo.filename || `${photo.name || 'foto'}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    console.error(err);
    toast('Não foi possível baixar esta foto protegida.', 3600);
  }
}

async function blobToBase64(blob) {
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const step = 0x8000;
  for (let i=0; i<bytes.length; i+=step) binary += String.fromCharCode(...bytes.subarray(i, i+step));
  return btoa(binary);
}

function base64ToBlob(value) {
  if (!value) return null;
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], {type:'application/octet-stream'});
}

async function exportBackup() {
  const button = $('#exportBtn');
  const previous = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Preparando…'; }
  try {
    const photos = [];
    for (const photo of state.photos) {
      const meta = {...photo};
      delete meta.blob;
      delete meta.thumbBlob;
      if (photo.encryptedBlob) meta.encryptedBlobBase64 = await blobToBase64(photo.encryptedBlob);
      if (photo.thumbEncryptedBlob) meta.thumbEncryptedBlobBase64 = await blobToBase64(photo.thumbEncryptedBlob);
      if (photo.bundled && photo.encryptedAsset && !meta.encryptedBlobBase64) {
        const originalResponse = await fetch(photo.assetUrl, {cache:'force-cache'});
        const thumbResponse = await fetch(photo.thumbAssetUrl, {cache:'force-cache'});
        if (originalResponse.ok) meta.encryptedBlobBase64 = await blobToBase64(await originalResponse.blob());
        if (thumbResponse.ok) meta.thumbEncryptedBlobBase64 = await blobToBase64(await thumbResponse.blob());
        meta.localIv = photo.iv;
        meta.localAad = photo.aad;
        meta.thumbLocalIv = photo.thumbIv;
        meta.thumbLocalAad = photo.thumbAad;
        meta.thumbType = 'image/webp';
        meta.backupContainsBundledCipher = true;
      }
      delete meta.encryptedBlob;
      delete meta.thumbEncryptedBlob;
      photos.push(meta);
    }
    const data = {
      format:'memorias-em-familia-backup',
      version:3,
      encrypted:true,
      exportedAt:new Date().toISOString(),
      albums:state.albums,
      photos,
      note:'Fotos adicionadas localmente permanecem criptografadas. Fotos incluídas no app são restauradas pelo cofre do projeto.'
    };
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const a=document.createElement('a');
    a.href=urlForBlob(blob);
    a.download=`memorias-backup-criptografado-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    toast('Backup criptografado exportado.');
  } catch (err) {
    console.error(err);
    toast('Não foi possível criar o backup completo.', 3800);
  } finally {
    if (button) { button.disabled = false; button.textContent = previous || 'Exportar backup'; }
  }
}

async function importBackupFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data?.format !== 'memorias-em-familia-backup' || !Array.isArray(data.albums) || !Array.isArray(data.photos)) {
      throw new Error('Arquivo de backup incompatível.');
    }
    if (!confirm(`Restaurar ${data.photos.length} registros de foto e ${data.albums.length} álbuns? Os dados existentes com o mesmo ID serão atualizados.`)) return;
    for (const album of data.albums) await idbPut(ALBUM_STORE, album);
    for (const raw of data.photos) {
      const photo = {...raw};
      if (photo.encryptedBlobBase64) photo.encryptedBlob = base64ToBlob(photo.encryptedBlobBase64);
      if (photo.thumbEncryptedBlobBase64) photo.thumbEncryptedBlob = base64ToBlob(photo.thumbEncryptedBlobBase64);
      if (photo.encryptedBlob || photo.thumbEncryptedBlob) photo.encryptedLocal = true;
      delete photo.encryptedBlobBase64;
      delete photo.thumbEncryptedBlobBase64;
      await idbPut(PHOTO_STORE, photo);
    }
    state.albums = await idbAll(ALBUM_STORE);
    state.photos = await idbAll(PHOTO_STORE);
    await importBundledFamilyPhotos();
    await hydratePhotoThumbnails();
    refreshAlbumSelect();
    renderCurrent();
    toast('Backup restaurado com sucesso.', 4200);
  } catch (err) {
    console.error(err);
    toast(err?.message || 'Não foi possível restaurar o backup.', 4200);
  } finally {
    $('#backupFileInput').value = '';
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('memorias-theme', theme);
  const isDark = theme === 'dark';
  $('#themeSwitch').classList.toggle('on', isDark);
  $('#themeSwitch').setAttribute('aria-pressed', isDark);
}

function resetEditorControls() {
  editorState.rotation = 0;
  editorState.flipX = false;
  editorState.flipY = false;
  $('#cropAspect').value = 'original';
  $('#frameMode').value = 'blur';
  $('#fillBlur').value = 28;
  for (const [id,val] of [['cropX',50],['cropY',50],['brightness',100],['contrast',100],['saturation',100],['noiseReduction',0],['sharpness',0],['warmth',0],['grayscale',0]]) $('#'+id).value = val;
  $('#upscaleMode').value = '1';
  updateEditorOutputs();
  updateFrameControls();
}

function updateEditorOutputs() {
  for (const id of ['cropX','cropY','brightness','contrast','saturation','noiseReduction','sharpness','grayscale']) {
    const out = $('#'+id+'Out');
    if (out) out.textContent = `${$('#'+id).value}%`;
  }
  if ($('#warmthOut')) $('#warmthOut').textContent = `${Number($('#warmth').value) > 0 ? '+' : ''}${$('#warmth').value}`;
  if ($('#fillBlurOut')) $('#fillBlurOut').textContent = `${$('#fillBlur').value}px`;
}

function updateFrameControls() {
  const mode = $('#frameMode')?.value || 'crop';
  const original = $('#cropAspect')?.value === 'original';
  const blurControl = $('#fillBlurControl');
  if (blurControl) blurControl.classList.toggle('is-disabled', !['blur','extend'].includes(mode) || original);
}

function normalizedRotation() {
  return ((editorState.rotation % 360) + 360) % 360;
}

function currentCropRect() {
  const sw = editorState.width, sh = editorState.height;
  if (!sw || !sh) return {x:0,y:0,w:1,h:1};
  const raw = $('#cropAspect').value;
  if (raw === 'original') return {x:0,y:0,w:sw,h:sh};
  const targetAspect = Number(raw);
  const rotated = normalizedRotation() === 90 || normalizedRotation() === 270;
  // O corte acontece antes da rotação. Invertemos a proporção para que
  // a proporção escolhida seja sempre a proporção FINAL da imagem.
  const sourceCropAspect = rotated ? 1 / targetAspect : targetAspect;
  let w=sw, h=sh, maxX=0, maxY=0;
  if (sw / sh > sourceCropAspect) { w = sh * sourceCropAspect; maxX = sw - w; }
  else { h = sw / sourceCropAspect; maxY = sh - h; }
  const x = maxX * (Number($('#cropX').value) / 100);
  const y = maxY * (Number($('#cropY').value) / 100);
  return {x,y,w,h};
}

function editorFilter(extra='') {
  const base = `brightness(${$('#brightness').value}%) contrast(${$('#contrast').value}%) saturate(${$('#saturation').value}%) grayscale(${$('#grayscale').value}%)`;
  return extra ? `${base} ${extra}` : base;
}

function drawTransformedSource(ctx, {centerX, centerY, scale, filter='none'}) {
  const sw = editorState.width;
  const sh = editorState.height;
  const rot = normalizedRotation();
  ctx.save();
  ctx.filter = filter;
  ctx.translate(centerX, centerY);
  ctx.rotate(rot * Math.PI / 180);
  ctx.scale(editorState.flipX ? -1 : 1, editorState.flipY ? -1 : 1);
  ctx.drawImage(editorState.source, 0, 0, sw, sh, -(sw * scale)/2, -(sh * scale)/2, sw * scale, sh * scale);
  ctx.restore();
}

function createOrientedCanvas(filter='none') {
  const rot = normalizedRotation();
  const rotated = rot === 90 || rot === 270;
  const outW = rotated ? editorState.height : editorState.width;
  const outH = rotated ? editorState.width : editorState.height;
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(outW));
  off.height = Math.max(1, Math.round(outH));
  const ctx = off.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.filter = filter;
  ctx.translate(off.width / 2, off.height / 2);
  ctx.rotate(rot * Math.PI / 180);
  ctx.scale(editorState.flipX ? -1 : 1, editorState.flipY ? -1 : 1);
  ctx.drawImage(editorState.source, 0, 0, editorState.width, editorState.height, -editorState.width / 2, -editorState.height / 2, editorState.width, editorState.height);
  ctx.restore();
  return off;
}

function drawMirroredPanel(ctx, sourceCanvas, side, barSize, offsetX, offsetY, targetW, targetH) {
  if (barSize <= 0 || targetW <= 0 || targetH <= 0) return;
  const sliceRatio = 0.18;
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  const sliceW = Math.max(1, Math.round(srcW * sliceRatio));
  const sliceH = Math.max(1, Math.round(srcH * sliceRatio));

  ctx.save();
  if (side === 'left') {
    ctx.translate(offsetX + barSize, offsetY);
    ctx.scale(-1, 1);
    ctx.drawImage(sourceCanvas, 0, 0, sliceW, srcH, 0, 0, barSize, targetH);
  } else if (side === 'right') {
    ctx.translate(offsetX + targetW + barSize, offsetY);
    ctx.scale(-1, 1);
    ctx.drawImage(sourceCanvas, srcW - sliceW, 0, sliceW, srcH, 0, 0, barSize, targetH);
  } else if (side === 'top') {
    ctx.translate(offsetX, offsetY + barSize);
    ctx.scale(1, -1);
    ctx.drawImage(sourceCanvas, 0, 0, srcW, sliceH, 0, 0, targetW, barSize);
  } else if (side === 'bottom') {
    ctx.translate(offsetX, offsetY + targetH + barSize);
    ctx.scale(1, -1);
    ctx.drawImage(sourceCanvas, 0, srcH - sliceH, srcW, sliceH, 0, 0, targetW, barSize);
  }
  ctx.restore();
}

function applyEditorPostProcessing(canvas) {
  const ctx = canvas.getContext('2d');
  const noise = Number($('#noiseReduction')?.value || 0) / 100;
  const sharp = Number($('#sharpness')?.value || 0) / 100;
  const warmth = Number($('#warmth')?.value || 0) / 50;

  if (noise > 0) {
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    copy.getContext('2d').drawImage(canvas,0,0);
    ctx.save();
    ctx.globalAlpha = Math.min(.48, noise * .44);
    ctx.filter = `blur(${(.35 + noise * 1.6).toFixed(2)}px)`;
    ctx.drawImage(copy,0,0);
    ctx.restore();
  }

  if (warmth !== 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.min(.20, Math.abs(warmth) * .16);
    ctx.fillStyle = warmth > 0 ? '#ff8a4c' : '#5aa9ff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.restore();
  }

  if (sharp > 0 && canvas.width * canvas.height <= 4200000) {
    try {
      const image = ctx.getImageData(0,0,canvas.width,canvas.height);
      const src = new Uint8ClampedArray(image.data);
      const dst = image.data;
      const w = canvas.width, h = canvas.height;
      const a = Math.min(.32, sharp * .28);
      for (let y=1; y<h-1; y++) {
        for (let x=1; x<w-1; x++) {
          const i=(y*w+x)*4;
          const u=((y-1)*w+x)*4, d=((y+1)*w+x)*4, l=(y*w+x-1)*4, r=(y*w+x+1)*4;
          for (let c=0;c<3;c++) {
            const v=src[i+c]*(1+4*a)-a*(src[u+c]+src[d+c]+src[l+c]+src[r+c]);
            dst[i+c]=Math.max(0,Math.min(255,v));
          }
        }
      }
      ctx.putImageData(image,0,0);
    } catch (_) {}
  }
}

function autoEnhanceEditor() {
  $('#brightness').value = 104;
  $('#contrast').value = 108;
  $('#saturation').value = 108;
  $('#noiseReduction').value = 22;
  $('#sharpness').value = 20;
  $('#warmth').value = 4;
  updateEditorOutputs();
  renderEditorPreview();
  toast('Auto melhoria aplicada na prévia.');
}

function drawEditedCanvas(canvas, maxDimension=1100, exportMode=false) {
  if (!editorState.source) return;
  const rawAspect = $('#cropAspect').value;
  const frameMode = $('#frameMode')?.value || 'crop';
  const rot = normalizedRotation();
  const rotated = rot === 90 || rot === 270;
  const orientedW = rotated ? editorState.height : editorState.width;
  const orientedH = rotated ? editorState.width : editorState.height;
  const wantsFrame = rawAspect !== 'original' && frameMode !== 'crop';

  // Modo clássico de corte: mantém exatamente a proporção escolhida recortando a foto.
  if (!wantsFrame) {
    const crop = currentCropRect();
    const naturalOutW = rotated ? crop.h : crop.w;
    const naturalOutH = rotated ? crop.w : crop.h;
    const multiplier = exportMode ? Number($('#upscaleMode')?.value || 1) : 1;
    const scale = Math.min(multiplier, maxDimension / Math.max(naturalOutW, naturalOutH));
    const outW = Math.max(1, Math.round(naturalOutW * scale));
    const outH = Math.max(1, Math.round(naturalOutH * scale));
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,outW,outH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    ctx.filter = editorFilter();
    ctx.translate(outW/2, outH/2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.scale(editorState.flipX ? -1 : 1, editorState.flipY ? -1 : 1);
    const drawW = crop.w * scale;
    const drawH = crop.h * scale;
    ctx.drawImage(editorState.source, crop.x, crop.y, crop.w, crop.h, -drawW/2, -drawH/2, drawW, drawH);
    ctx.restore();
    applyEditorPostProcessing(canvas);
    return;
  }

  // Preenchimento: expande a tela para a nova orientação e preserva a foto inteira.
  const targetAspect = Number(rawAspect);
  const sourceAspect = orientedW / orientedH;
  let naturalOutW, naturalOutH;
  if (sourceAspect > targetAspect) {
    naturalOutW = orientedW;
    naturalOutH = orientedW / targetAspect;
  } else {
    naturalOutH = orientedH;
    naturalOutW = orientedH * targetAspect;
  }
  const multiplier = exportMode ? Number($('#upscaleMode')?.value || 1) : 1;
  const outputScale = Math.min(multiplier, maxDimension / Math.max(naturalOutW, naturalOutH));
  const outW = Math.max(1, Math.round(naturalOutW * outputScale));
  const outH = Math.max(1, Math.round(naturalOutH * outputScale));
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,outW,outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Fundo base para evitar transparência indesejada em JPEG.
  ctx.fillStyle = '#121622';
  ctx.fillRect(0,0,outW,outH);

  const containScale = Math.min(outW / orientedW, outH / orientedH);
  const drawnW = orientedW * containScale;
  const drawnH = orientedH * containScale;
  const roomX = Math.max(0, outW - drawnW);
  const roomY = Math.max(0, outH - drawnH);
  const posX = Number($('#cropX').value) / 100;
  const posY = Number($('#cropY').value) / 100;
  const centerX = drawnW >= outW - .5 ? outW/2 : drawnW/2 + roomX * posX;
  const centerY = drawnH >= outH - .5 ? outH/2 : drawnH/2 + roomY * posY;

  if (frameMode === 'blur' || frameMode === 'extend') {
    const coverScale = Math.max(outW / orientedW, outH / orientedH) * (frameMode === 'extend' ? 1.02 : 1.08);
    const blur = Math.max(1, Number($('#fillBlur').value));
    drawTransformedSource(ctx, {
      centerX: outW/2,
      centerY: outH/2,
      scale: coverScale,
      filter: editorFilter(`blur(${blur}px) brightness(72%) saturate(112%)`),
    });
    ctx.fillStyle = frameMode === 'extend' ? 'rgba(8, 10, 16, .10)' : 'rgba(8, 10, 16, .12)';
    ctx.fillRect(0,0,outW,outH);
  }

  if (frameMode === 'extend') {
    const orientedCanvas = createOrientedCanvas(editorFilter());
    const left = centerX - drawnW / 2;
    const top = centerY - drawnH / 2;
    const rightGap = outW - (left + drawnW);
    const bottomGap = outH - (top + drawnH);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.18)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = 'rgba(255,255,255,.02)';
    ctx.fillRect(left, top, drawnW, drawnH);
    ctx.restore();

    drawMirroredPanel(ctx, orientedCanvas, 'left', Math.max(0, left), left, top, drawnW, drawnH);
    drawMirroredPanel(ctx, orientedCanvas, 'right', Math.max(0, rightGap), left, top, drawnW, drawnH);
    drawMirroredPanel(ctx, orientedCanvas, 'top', Math.max(0, top), left, top, drawnW, drawnH);
    drawMirroredPanel(ctx, orientedCanvas, 'bottom', Math.max(0, bottomGap), left, top, drawnW, drawnH);

    const fade = ctx.createLinearGradient(0, top, 0, top + drawnH);
    fade.addColorStop(0, 'rgba(255,255,255,.04)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(Math.max(0, left), Math.max(0, top), Math.min(outW, drawnW), Math.min(outH, drawnH));
  }

  drawTransformedSource(ctx, {
    centerX,
    centerY,
    scale: containScale,
    filter: editorFilter(),
  });
  applyEditorPostProcessing(canvas);
}

function renderEditorPreview() {
  if (!editorState.source) return;
  updateEditorOutputs();
  drawEditedCanvas($('#editorCanvas'), 1100);
}

async function openEditor(photo) {
  if (!photo || photo.previewUnsupported) { toast('Este formato não pode ser editado neste navegador.'); return; }
  if ($('#lightbox').open) $('#lightbox').close();
  editorState.source?.close?.();
  editorState.photo = photo;
  editorState.source = null;
  editorState.width = editorState.height = 0;
  resetEditorControls();
  $('#editorCanvas').width = 1;
  $('#editorCanvas').height = 1;
  $('#editorLoading').hidden = false;
  $('#saveEditBtn').disabled = true;
  $('#editorDialog').showModal();
  try {
    const sourceBlob = await blobForPhoto(photo);
    if (!sourceBlob) throw new Error('Arquivo da foto não encontrado.');
    const drawable = await loadDrawable(sourceBlob);
    editorState.source = drawable.source;
    editorState.width = drawable.width;
    editorState.height = drawable.height;
    editorState.cleanup = drawable.cleanup;
    $('#editorLoading').hidden = true;
    $('#saveEditBtn').disabled = false;
    renderEditorPreview();
  } catch (err) {
    console.error(err);
    $('#editorLoading').textContent = 'Este formato não pode ser editado neste navegador.';
    toast('Não foi possível abrir esta imagem no editor.', 3600);
  }
}

function editorOutputType(photo) {
  const type = photo?.type || '';
  if (type === 'image/png') return {type:'image/png', ext:'png', quality:1};
  if (type === 'image/webp') return {type:'image/webp', ext:'webp', quality:.94};
  return {type:'image/jpeg', ext:'jpg', quality:.94};
}

async function saveEditedCopy() {
  const sourcePhoto = editorState.photo;
  if (!sourcePhoto || !editorState.source) return;
  $('#saveEditBtn').disabled = true;
  $('#saveEditBtn').textContent = 'Salvando…';
  try {
    const canvas = document.createElement('canvas');
    drawEditedCanvas(canvas, 8192, true);
    const out = editorOutputType(sourcePhoto);
    const blob = await canvasToBlob(canvas, out.type, out.quality);
    let thumbBlob = null;
    try { thumbBlob = await createThumbnail(blob); } catch (_) {}
    const now = new Date().toISOString();
    const base = (sourcePhoto.name || 'Foto').replace(/\s+-\s+editada(?:\s+\d+)?$/i,'');
    const existingEdits = state.photos.filter(p=>p.editedFrom === (sourcePhoto.editedFrom || sourcePhoto.id)).length;
    const suffix = existingEdits ? ` - editada ${existingEdits+1}` : ' - editada';
    const newId = uid('photo');
    const encryptedOriginal = await window.MemVault.encryptBlob(blob, newId, 'original');
    const encryptedThumb = thumbBlob ? await window.MemVault.encryptBlob(thumbBlob, newId, 'thumb') : null;
    const copy = {
      ...sourcePhoto,
      id: newId,
      name: `${base}${suffix}`,
      filename: `${base}${suffix}.${out.ext}`.replace(/[\/:*?"<>|]/g,'-'),
      type: out.type,
      size: blob.size,
      encryptedBlob: encryptedOriginal.blob,
      localIv: encryptedOriginal.iv,
      localAad: encryptedOriginal.aad,
      thumbEncryptedBlob: encryptedThumb?.blob || null,
      thumbType: thumbBlob?.type || null,
      thumbLocalIv: encryptedThumb?.iv || null,
      thumbLocalAad: encryptedThumb?.aad || null,
      encryptedLocal:true,
      assetUrl:null,
      thumbAssetUrl:null,
      encryptedAsset:false,
      bundled:false,
      bundleVersion:null,
      previewUnsupported:false,
      favorite:false,
      createdAt: now,
      importedAt: now,
      updatedAt: now,
      deletedAt:null,
      editedFrom: sourcePhoto.editedFrom || sourcePhoto.id,
      editSettings: {
        rotation: editorState.rotation,
        flipX: editorState.flipX,
        flipY: editorState.flipY,
        cropAspect: $('#cropAspect').value,
        frameMode: $('#frameMode').value,
        fillBlur: Number($('#fillBlur').value),
        cropX: Number($('#cropX').value),
        cropY: Number($('#cropY').value),
        brightness: Number($('#brightness').value),
        contrast: Number($('#contrast').value),
        saturation: Number($('#saturation').value),
        noiseReduction: Number($('#noiseReduction').value),
        sharpness: Number($('#sharpness').value),
        warmth: Number($('#warmth').value),
        upscale: Number($('#upscaleMode').value),
        grayscale: Number($('#grayscale').value),
      }
    };
    await idbPut(PHOTO_STORE, copy);
    state.photos.push(copy);
    if (thumbBlob) runtimeMediaUrls.set(`t:${copy.id}`, urlForBlob(thumbBlob));
    $('#editorDialog').close();
    cleanupEditor();
    renderCurrent();
    toast('Cópia editada salva. A original foi preservada.');
    setTimeout(() => {
      const visible = visiblePhotosForLightbox();
      if (visible.some(p => p.id === copy.id)) openLightbox(copy.id);
      else {
        state.lightboxIds = [copy.id];
        state.lightboxIndex = 0;
        updateLightbox();
        if (!$('#lightbox').open) $('#lightbox').showModal();
      }
    }, 0);
  } catch (err) {
    console.error(err);
    toast('Não foi possível salvar a edição. Tente uma imagem menor.', 3600);
  } finally {
    $('#saveEditBtn').disabled = false;
    $('#saveEditBtn').textContent = 'Salvar cópia editada';
  }
}

function cleanupEditor() {
  try { editorState.cleanup?.(); } catch (_) {}
  editorState.photo = null;
  editorState.source = null;
  editorState.cleanup = null;
  editorState.width = editorState.height = 0;
  $('#editorLoading').textContent = 'Carregando foto…';
}

function safeJsonParse(value, fallback=null) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function stationStreamUrl(station) {
  return station?.url_resolved || station?.url || '';
}

function stationIsUsable(station) {
  const url = stationStreamUrl(station);
  if (!/^https:\/\//i.test(url)) return false;
  if (Number(station?.lastcheckok ?? 1) !== 1) return false;
  if (Number(station?.hls || 0) === 1) return false;
  const codec = String(station?.codec || '').toUpperCase();
  return !codec || ['MP3','AAC','AAC+','OGG','OPUS'].some(c => codec.includes(c));
}

function normalizedStation(station) {
  return {
    stationuuid: station.stationuuid || uid('radio'),
    name: station.name || 'Rádio sem nome',
    url: station.url || station.url_resolved || '',
    url_resolved: station.url_resolved || station.url || '',
    favicon: station.favicon || '',
    tags: station.tags || '',
    state: station.state || '',
    codec: station.codec || '',
    bitrate: Number(station.bitrate || 0),
    lastcheckok: Number(station.lastcheckok ?? 1),
    hls: Number(station.hls || 0),
    custom: !!station.custom,
  };
}

function cacheRadioStations() {
  try {
    localStorage.setItem('memorias-radio-stations', JSON.stringify(radioState.stations.slice(0,80)));
  } catch (_) {}
}

function restoreRadioCache() {
  const cached = safeJsonParse(localStorage.getItem('memorias-radio-stations'), []);
  if (Array.isArray(cached)) radioState.stations = cached.map(normalizedStation).filter(stationIsUsable);
  const current = safeJsonParse(localStorage.getItem('memorias-radio-current'), null);
  if (current && stationIsUsable(current)) radioState.current = normalizedStation(current);
}

function radioStationMeta(station) {
  const parts = [];
  if (station?.state) parts.push(station.state);
  if (station?.codec) parts.push(station.codec.toUpperCase());
  if (station?.bitrate) parts.push(`${station.bitrate} kbps`);
  return parts.join(' · ') || 'Rádio online';
}

function setRadioLogo(station) {
  const img = $('#radioLogo');
  const fallback = $('#radioLogoFallback');
  if (!img || !fallback) return;
  img.hidden = true;
  fallback.hidden = false;
  img.removeAttribute('src');
  const favicon = station?.favicon;
  if (!favicon || !/^https:\/\//i.test(favicon)) return;
  img.onload = () => { img.hidden = false; fallback.hidden = true; };
  img.onerror = () => { img.hidden = true; fallback.hidden = false; };
  img.src = favicon;
}

function syncRadioPlayerUi() {
  const audio = $('#radioAudio');
  const station = radioState.current;
  if (!audio) return;
  $('#radioTitle').textContent = station?.name || 'Escolha uma rádio';
  if (!station) $('#radioStatus').textContent = 'Toque aqui para selecionar uma estação';
  else if (radioState.loading) $('#radioStatus').textContent = 'Conectando...';
  else if (!audio.paused) $('#radioStatus').textContent = `Ao vivo · ${radioStationMeta(station)}`;
  else $('#radioStatus').textContent = `Pausado · ${radioStationMeta(station)}`;
  $('#radioPlayBtn').textContent = audio.paused ? '▶' : '❚❚';
  $('#radioPlayBtn').setAttribute('aria-label', audio.paused ? 'Tocar rádio' : 'Pausar rádio');
  $('#radioDock').classList.toggle('is-playing', !audio.paused && !!station);
  setRadioLogo(station);
}

function renderRadioStations() {
  const list = $('#radioStationList');
  const status = $('#radioListStatus');
  if (!list || !status) return;
  status.textContent = radioState.loading ? 'Buscando...' : `${radioState.stations.length} estações disponíveis`;
  if (radioState.loading && !radioState.stations.length) {
    list.innerHTML = '<div class="radio-empty">Buscando rádios online...</div>';
    return;
  }
  if (!radioState.stations.length) {
    list.innerHTML = '<div class="radio-empty">Nenhuma rádio compatível encontrada. Você também pode adicionar uma URL HTTPS manualmente.</div>';
    return;
  }
  list.innerHTML = radioState.stations.map((station,index) => {
    const active = radioState.current?.stationuuid === station.stationuuid;
    const favicon = station.favicon && /^https:\/\//i.test(station.favicon)
      ? `<img src="${escapeHtml(station.favicon)}" alt="" loading="lazy" onerror="this.remove()">`
      : '<span>♪</span>';
    return `<button type="button" class="radio-station-item${active?' active':''}" data-radio-index="${index}">
      <span class="radio-station-avatar">${favicon}</span>
      <span class="radio-station-copy"><strong>${escapeHtml(station.name)}</strong><span>${escapeHtml(radioStationMeta(station))}</span></span>
      <span class="radio-live-pill">AO VIVO</span>
    </button>`;
  }).join('');
}

async function fetchRadioStations(query='') {
  radioState.loading = true;
  renderRadioStations();
  try {
    const params = new URLSearchParams({
      countrycode: 'BR',
      hidebroken: 'true',
      order: query ? 'clickcount' : 'clickcount',
      reverse: 'true',
      limit: query ? '80' : '100',
    });
    if (query.trim()) params.set('name', query.trim());
    const response = await fetch(`${RADIO_API}?${params.toString()}`, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const seen = new Set();
    const usable = data.map(normalizedStation).filter(stationIsUsable).filter(station => {
      const key = stationStreamUrl(station);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0,50);
    if (usable.length) {
      radioState.stations = usable;
      cacheRadioStations();
      localStorage.setItem('memorias-radio-last-fetch', String(Date.now()));
    }
  } catch (err) {
    console.warn('Não foi possível atualizar a lista de rádios.', err);
    if (!radioState.stations.length) toast('Não foi possível buscar rádios agora. Use uma URL manual ou tente novamente.', 4200);
  } finally {
    radioState.loading = false;
    renderRadioStations();
  }
}

function openRadioDialog() {
  $('#radioDialog').showModal();
  renderRadioStations();
  const lastFetch = Number(localStorage.getItem('memorias-radio-last-fetch') || 0);
  const stale = !lastFetch || (Date.now() - lastFetch) > 24 * 60 * 60 * 1000;
  if (!radioState.stations.length || stale) fetchRadioStations();
}

async function playRadioStation(station, {closeDialog=true}={}) {
  if (!station) return;
  const audio = $('#radioAudio');
  const stream = stationStreamUrl(station);
  if (!stream) return;
  radioState.current = normalizedStation(station);
  radioState.currentIndex = radioState.stations.findIndex(s => s.stationuuid === radioState.current.stationuuid);
  radioState.loading = true;
  localStorage.setItem('memorias-radio-current', JSON.stringify(radioState.current));
  audio.src = stream;
  audio.load();
  syncRadioPlayerUi();
  try {
    await audio.play();
    if (closeDialog && $('#radioDialog').open) $('#radioDialog').close();
    // Contagem de uso recomendada pelo diretório. Falha silenciosa se o serviço estiver indisponível.
    if (!radioState.current.custom && radioState.current.stationuuid) {
      fetch(`https://de1.api.radio-browser.info/json/url/${encodeURIComponent(radioState.current.stationuuid)}`, {mode:'no-cors'}).catch(()=>{});
    }
  } catch (err) {
    console.warn('Falha ao reproduzir rádio.', err);
    radioState.loading = false;
    syncRadioPlayerUi();
    toast('Esta rádio não conseguiu tocar. Tente outra estação.', 3600);
  }
}

async function toggleRadioPlayback() {
  const audio = $('#radioAudio');
  if (!radioState.current) {
    openRadioDialog();
    return;
  }
  try {
    if (audio.paused) await audio.play(); else audio.pause();
  } catch (_) {
    toast('Não foi possível iniciar esta estação. Escolha outra rádio.', 3600);
  }
}

function stepRadio(direction) {
  if (!radioState.stations.length) { openRadioDialog(); return; }
  let index = radioState.stations.findIndex(s => s.stationuuid === radioState.current?.stationuuid);
  if (index < 0) index = 0;
  index = (index + direction + radioState.stations.length) % radioState.stations.length;
  playRadioStation(radioState.stations[index], {closeDialog:false});
}

function addManualRadio() {
  const name = $('#radioManualName').value.trim() || 'Minha rádio';
  const url = $('#radioManualUrl').value.trim();
  if (!/^https:\/\//i.test(url)) {
    toast('Use uma URL HTTPS direta do stream de áudio.', 3600);
    return;
  }
  const station = normalizedStation({name, url, url_resolved:url, custom:true, codec:'stream'});
  radioState.stations = [station, ...radioState.stations.filter(s => stationStreamUrl(s) !== url)];
  cacheRadioStations();
  renderRadioStations();
  playRadioStation(station);
  $('#radioManualName').value = '';
  $('#radioManualUrl').value = '';
}

function initializeRadio() {
  restoreRadioCache();
  const audio = $('#radioAudio');
  const volume = Math.min(1, Math.max(0, Number(localStorage.getItem('memorias-radio-volume') ?? .7)));
  audio.volume = Number.isFinite(volume) ? volume : .7;
  $('#radioVolume').value = Math.round(audio.volume * 100);
  const collapsed = localStorage.getItem('memorias-radio-collapsed') === '1';
  $('#radioDock').classList.toggle('collapsed', collapsed);
  if (radioState.current) {
    audio.src = stationStreamUrl(radioState.current);
    radioState.currentIndex = radioState.stations.findIndex(s => s.stationuuid === radioState.current.stationuuid);
  }
  syncRadioPlayerUi();
}

// Navegação e ações gerais
addEventListener('click', async (e) => {
  const nav = e.target.closest('[data-view]');
  if (nav) { state.view=nav.dataset.view; state.selectionMode=false; state.selectedIds.clear(); state.momentFilter='all'; $('#sidebar').classList.remove('open'); renderCurrent(); return; }
  const viewLink = e.target.closest('[data-view-link]');
  if (viewLink) { state.view=viewLink.dataset.viewLink; state.selectionMode=false; state.selectedIds.clear(); state.momentFilter='all'; renderCurrent(); return; }
  const uploadAction = e.target.closest('[data-action="upload"]');
  if (uploadAction) { openUploadDialog(); return; }
  const albumAction = e.target.closest('[data-action="album"]');
  if (albumAction) { $('#albumDialog').showModal(); return; }
  const coverEdit = e.target.closest('[data-edit-album-cover]');
  if (coverEdit) { e.preventDefault(); e.stopPropagation(); openAlbumCoverEditor(coverEdit.dataset.editAlbumCover); return; }
  const albumSlideshow = e.target.closest('[data-start-album-slideshow]');
  if (albumSlideshow) { e.preventDefault(); e.stopPropagation(); startAlbumSlideshow(albumSlideshow.dataset.startAlbumSlideshow); return; }
  const viewSlideshow = e.target.closest('[data-start-view-slideshow]');
  if (viewSlideshow) { e.preventDefault(); startViewSlideshow(); return; }
  const homeDot = e.target.closest('[data-home-slide]');
  if (homeDot) { e.preventDefault(); e.stopPropagation(); setHomeCarouselSlide(Number(homeDot.dataset.homeSlide)); return; }
  const manageAlbum = e.target.closest('[data-manage-album]');
  if (manageAlbum) { e.preventDefault(); e.stopPropagation(); openAlbumManager(manageAlbum.dataset.manageAlbum); return; }
  const galleryMode = e.target.closest('[data-gallery-mode]');
  if (galleryMode) { state.galleryMode=galleryMode.dataset.galleryMode; localStorage.setItem('memorias-gallery-mode', state.galleryMode); renderCurrent(); return; }
  const momentFilter = e.target.closest('[data-moment-filter]');
  if (momentFilter) { state.momentFilter=momentFilter.dataset.momentFilter; renderCurrent(); return; }
  const selectionToggle = e.target.closest('[data-toggle-selection]');
  if (selectionToggle) { state.selectionMode=!state.selectionMode; if(!state.selectionMode) state.selectedIds.clear(); renderCurrent(); return; }
  const selectPhoto = e.target.closest('[data-select-photo]');
  if (selectPhoto) { e.preventDefault(); e.stopPropagation(); togglePhotoSelection(selectPhoto.dataset.selectPhoto); return; }
  const bulkAction = e.target.closest('[data-bulk-action]');
  if (bulkAction) { e.preventDefault(); await handleBulkAction(bulkAction.dataset.bulkAction); return; }
  const albumCard = e.target.closest('[data-album-id]');
  if (albumCard) { state.view=`album:${albumCard.dataset.albumId}`; state.momentFilter='all'; state.selectionMode=false; state.selectedIds.clear(); renderCurrent(); return; }
  const fav = e.target.closest('[data-favorite-id]');
  if (fav) { e.stopPropagation(); await toggleFavorite(fav.dataset.favoriteId); return; }
  const photoCard = e.target.closest('[data-photo-id]');
  if (photoCard) { if (state.selectionMode) togglePhotoSelection(photoCard.dataset.photoId); else openLightbox(photoCard.dataset.photoId); return; }
  const coverChoice = e.target.closest('[data-cover-choice]');
  if (coverChoice) { coverEditorState.selectedPhotoId = coverChoice.dataset.coverChoice; renderAlbumCoverEditor(); return; }
  const removeUpload = e.target.closest('[data-remove-upload]');
  if (removeUpload) { state.uploadFiles.splice(Number(removeUpload.dataset.removeUpload),1); renderUploadPreview(); return; }
  const trash = e.target.closest('[data-trash-id]');
  if (trash) {
    const id=trash.dataset.trashId;
    const choice = confirm('OK para restaurar esta foto. Cancelar para escolher exclusão definitiva.');
    if (choice) await restorePhoto(id); else await permanentDelete(id);
  }
});

$('#uploadBtn').addEventListener('click', openUploadDialog);
$('#newAlbumBtn').addEventListener('click', () => $('#albumDialog').showModal());
$('#settingsBtn').addEventListener('click', () => $('#settingsDialog').showModal());
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

// Rádio
$('#radioBrowseBtn').addEventListener('click', () => { $('#sidebar').classList.remove('open'); openRadioDialog(); });
$('#radioOpenBtn').addEventListener('click', openRadioDialog);
$('#radioStationsBtn').addEventListener('click', openRadioDialog);
$('#radioPlayBtn').addEventListener('click', toggleRadioPlayback);
$('#radioPrevBtn').addEventListener('click', () => stepRadio(-1));
$('#radioNextBtn').addEventListener('click', () => stepRadio(1));
$('#radioCollapseBtn').addEventListener('click', () => {
  const collapsed = !$('#radioDock').classList.contains('collapsed');
  $('#radioDock').classList.toggle('collapsed', collapsed);
  localStorage.setItem('memorias-radio-collapsed', collapsed ? '1' : '0');
});
$('#radioVolume').addEventListener('input', e => {
  const volume = Number(e.target.value) / 100;
  $('#radioAudio').volume = volume;
  localStorage.setItem('memorias-radio-volume', String(volume));
});
$('#radioSearchBtn').addEventListener('click', () => fetchRadioStations($('#radioSearchInput').value));
$('#radioSearchInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fetchRadioStations(e.currentTarget.value); } });
$('#radioManualAddBtn').addEventListener('click', addManualRadio);
$('#radioStationList').addEventListener('click', e => {
  const item = e.target.closest('[data-radio-index]');
  if (!item) return;
  playRadioStation(radioState.stations[Number(item.dataset.radioIndex)]);
});
$('#radioAudio').addEventListener('loadstart', () => { radioState.loading = !!radioState.current; syncRadioPlayerUi(); });
$('#radioAudio').addEventListener('playing', () => { radioState.loading = false; syncRadioPlayerUi(); renderRadioStations(); });
$('#radioAudio').addEventListener('pause', () => { if (!radioState.loading) syncRadioPlayerUi(); });
$('#radioAudio').addEventListener('waiting', () => { radioState.loading = true; syncRadioPlayerUi(); });
$('#radioAudio').addEventListener('canplay', () => { radioState.loading = false; syncRadioPlayerUi(); });
$('#radioAudio').addEventListener('error', () => {
  radioState.loading = false;
  syncRadioPlayerUi();
  if (radioState.current) toast('A transmissão desta rádio caiu ou está indisponível. Tente outra estação.', 3800);
});

$('#searchInput').addEventListener('input', (e)=>{ state.search=e.target.value; renderCurrent(); });
root.addEventListener('change', e => { if(e.target.id==='sortSelect'){ state.sort=e.target.value; renderCurrent(); } });

$('#chooseGalleryBtn').addEventListener('click', ()=>$('#fileInput').click());
$('#takePhotoBtn').addEventListener('click', ()=>$('#cameraInput').click());
$('#dropZone').addEventListener('click', ()=>$('#fileInput').click());
$('#dropZone').addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); $('#fileInput').click(); } });
$('#fileInput').addEventListener('change', e=>{ addUploadFiles(e.target.files); e.target.value=''; });
$('#cameraInput').addEventListener('change', e=>{ addUploadFiles(e.target.files); e.target.value=''; });
['dragenter','dragover'].forEach(ev => $('#dropZone').addEventListener(ev, e=>{e.preventDefault(); $('#dropZone').classList.add('drag');}));
['dragleave','drop'].forEach(ev => $('#dropZone').addEventListener(ev, e=>{e.preventDefault(); $('#dropZone').classList.remove('drag');}));
$('#dropZone').addEventListener('drop', e=>addUploadFiles(e.dataTransfer.files));

$('#confirmUploadBtn').addEventListener('click', async e=>{
  e.preventDefault();
  if(await saveUploads()) $('#uploadDialog').close();
});
$('#saveAlbumBtn').addEventListener('click', async e=>{
  e.preventDefault();
  if(await createAlbum()) $('#albumDialog').close();
});
$('#saveAlbumManageBtn').addEventListener('click', saveAlbumManage);
$('#deleteAlbumBtn').addEventListener('click', deleteManagedAlbum);
$('#confirmMovePhotosBtn').addEventListener('click', confirmMovePhotos);
$('#savePhotoMomentBtn').addEventListener('click', savePhotoMoment);

$('#lightboxClose').addEventListener('click', ()=>{ setSlideshowPlaying(false); $('#lightbox').close(); });
$('#lightboxPrev').addEventListener('click', ()=>{ if (galleryUiState.slideshowPlaying) setSlideshowPlaying(false); transitionLightbox(-1); });
$('#lightboxNext').addEventListener('click', ()=>{ if (galleryUiState.slideshowPlaying) setSlideshowPlaying(false); transitionLightbox(1); });
$('#lightboxFavorite').addEventListener('click', ()=>toggleFavorite(currentLightboxPhoto()?.id));
$('#lightboxEdit').addEventListener('click', ()=>openEditor(currentLightboxPhoto()));
$('#lightboxInfo').addEventListener('click', ()=>openPhotoInfo(currentLightboxPhoto()));
$('#lightboxMove').addEventListener('click', ()=>openMovePhotos([currentLightboxPhoto()?.id]));
$('#lightboxShare').addEventListener('click', ()=>sharePhoto(currentLightboxPhoto()));
$('#lightboxDownload').addEventListener('click', ()=>{ const p=currentLightboxPhoto(); if(p) downloadPhoto(p); });
$('#lightboxDelete').addEventListener('click', async ()=>{ const p=currentLightboxPhoto(); if(!p)return; await softDelete(p.id); $('#lightbox').close(); });
$('#lightboxSlideshow').addEventListener('click', ()=>setSlideshowPlaying(!galleryUiState.slideshowPlaying));
$('#lightbox').addEventListener('close', ()=>setSlideshowPlaying(false));

addEventListener('keydown', e=>{
  if(!$('#lightbox').open) return;
  if(e.key==='ArrowLeft') { if (galleryUiState.slideshowPlaying) setSlideshowPlaying(false); transitionLightbox(-1); }
  if(e.key==='ArrowRight') { if (galleryUiState.slideshowPlaying) setSlideshowPlaying(false); transitionLightbox(1); }
  if(e.key===' ') { e.preventDefault(); setSlideshowPlaying(!galleryUiState.slideshowPlaying); }
});

let lightboxTouchStartX = 0;
let lightboxTouchStartY = 0;
let lightboxPinchDistance = 0;
let lightboxZoom = 1;
function lightboxDistance(touches) {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx,dy);
}
function applyLightboxZoom(value) {
  lightboxZoom = Math.max(1, Math.min(4, value));
  $('#lightboxImage').style.transform = `scale(${lightboxZoom})`;
  $('#lightboxImage').classList.toggle('is-zoomed', lightboxZoom > 1.02);
}
$('#lightbox').addEventListener('touchstart', e=>{
  if (e.touches.length === 1) {
    lightboxTouchStartX = e.touches[0].clientX;
    lightboxTouchStartY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    lightboxPinchDistance = lightboxDistance(e.touches);
  }
}, {passive:true});
$('#lightbox').addEventListener('touchmove', e=>{
  if (e.touches.length === 2 && lightboxPinchDistance) {
    const current = lightboxDistance(e.touches);
    applyLightboxZoom(lightboxZoom * (current / lightboxPinchDistance));
    lightboxPinchDistance = current;
  }
}, {passive:true});
$('#lightbox').addEventListener('touchend', e=>{
  if (e.touches.length === 0 && e.changedTouches.length === 1 && lightboxZoom <= 1.02) {
    const dx = e.changedTouches[0].clientX - lightboxTouchStartX;
    const dy = e.changedTouches[0].clientY - lightboxTouchStartY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.25) transitionLightbox(dx < 0 ? 1 : -1);
  }
  if (e.touches.length < 2) lightboxPinchDistance = 0;
}, {passive:true});
$('#lightboxImage').addEventListener('dblclick', ()=>applyLightboxZoom(lightboxZoom > 1 ? 1 : 2));
$('#lightbox').addEventListener('close', ()=>applyLightboxZoom(1));

// Capa de álbum
for (const id of ['coverPositionX','coverPositionY','coverZoom']) {
  $('#'+id).addEventListener('input', updateAlbumCoverPreviewStyle);
}
$('#saveAlbumCoverBtn').addEventListener('click', saveAlbumCoverSettings);

// Editor
for (const id of ['cropAspect','frameMode','fillBlur','cropX','cropY','brightness','contrast','saturation','noiseReduction','sharpness','warmth','upscaleMode','grayscale']) {
  $('#'+id).addEventListener('input', () => { updateFrameControls(); renderEditorPreview(); });
  $('#'+id).addEventListener('change', () => { updateFrameControls(); renderEditorPreview(); });
}
$('#rotateLeftBtn').addEventListener('click', ()=>{ editorState.rotation=(editorState.rotation-90)%360; renderEditorPreview(); });
$('#rotateRightBtn').addEventListener('click', ()=>{ editorState.rotation=(editorState.rotation+90)%360; renderEditorPreview(); });
$('#flipHBtn').addEventListener('click', ()=>{ editorState.flipX=!editorState.flipX; $('#flipHBtn').classList.toggle('active',editorState.flipX); renderEditorPreview(); });
$('#flipVBtn').addEventListener('click', ()=>{ editorState.flipY=!editorState.flipY; $('#flipVBtn').classList.toggle('active',editorState.flipY); renderEditorPreview(); });
$('#autoEnhanceBtn').addEventListener('click', autoEnhanceEditor);
$('#resetEditBtn').addEventListener('click', ()=>{ resetEditorControls(); $('#flipHBtn').classList.remove('active'); $('#flipVBtn').classList.remove('active'); renderEditorPreview(); });
$('#saveEditBtn').addEventListener('click', saveEditedCopy);
$('#editorDialog').addEventListener('close', cleanupEditor);

$('#themeSwitch').addEventListener('click', ()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('#exportBtn').addEventListener('click', exportBackup);
$('#importBackupBtn').addEventListener('click', ()=>$('#backupFileInput').click());
$('#backupFileInput').addEventListener('change', e=>importBackupFile(e.target.files?.[0]));
$('#settingsLockBtn').addEventListener('click', ()=>$('#lockVaultBtn').click());
$('#slideshowSpeed').value = localStorage.getItem('memorias-slideshow-speed') || '4200';
$('#slideshowEffect').value = localStorage.getItem('memorias-slideshow-effect') || 'kenburns';
$('#slideshowSpeed').addEventListener('change', e=>localStorage.setItem('memorias-slideshow-speed', e.target.value));
$('#slideshowEffect').addEventListener('change', e=>localStorage.setItem('memorias-slideshow-effect', e.target.value));
$('#autoLockMinutes').value = localStorage.getItem('memorias-auto-lock') || '15';
$('#autoLockMinutes').addEventListener('change', e=>{ localStorage.setItem('memorias-auto-lock', e.target.value); resetAutoLockTimer(); });

let autoLockTimer = null;
function resetAutoLockTimer() {
  clearTimeout(autoLockTimer);
  if (!window.MemVault?.isUnlocked()) return;
  const minutes = Number(localStorage.getItem('memorias-auto-lock') || 15);
  if (!minutes) return;
  autoLockTimer = setTimeout(()=>{
    try { $('#radioAudio')?.pause(); } catch (_) {}
    window.MemVault?.clearSession();
    location.reload();
  }, minutes * 60 * 1000);
}
for (const eventName of ['pointerdown','keydown','touchstart']) {
  addEventListener(eventName, resetAutoLockTimer, {passive:true});
}

applyTheme(localStorage.getItem('memorias-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

async function unlockProtectedApp(password) {
  const card = $('.vault-card');
  const status = $('#vaultStatus');
  const button = $('#vaultUnlockBtn');
  card?.classList.add('is-busy');
  if (button) button.textContent = 'Verificando…';
  if (status) { status.textContent = 'Derivando a chave de criptografia…'; status.className = 'vault-status'; }
  try {
    await window.MemVault.loadManifest();
    await window.MemVault.unlock(password);
    if (status) { status.textContent = 'Cofre desbloqueado com segurança.'; status.className = 'vault-status success'; }
    document.body.classList.remove('vault-locked');
    $('#vaultPassword').value = '';
    initializeRadio();
    const requestedView = new URLSearchParams(location.search).get('view');
    if (['home','photos','albums','favorites','trash'].includes(requestedView)) state.view = requestedView;
    await loadState();
    resetAutoLockTimer();
    requestAnimationFrame(()=>$('#searchInput')?.focus({preventScroll:true}));
  } catch (err) {
    console.error(err);
    if (status) { status.textContent = err?.message || 'Não foi possível desbloquear o acervo.'; status.className = 'vault-status error'; }
    $('#vaultPassword')?.focus();
  } finally {
    card?.classList.remove('is-busy');
    if (button) button.textContent = 'Desbloquear acervo';
  }
}

$('#vaultUnlockForm').addEventListener('submit', e => {
  e.preventDefault();
  unlockProtectedApp($('#vaultPassword').value);
});
$('#vaultTogglePassword').addEventListener('click', () => {
  const input = $('#vaultPassword');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('#vaultTogglePassword').textContent = input.type === 'password' ? '◉' : '◌';
});
$('#lockVaultBtn').addEventListener('click', () => {
  try { $('#radioAudio')?.pause(); } catch (_) {}
  window.MemVault?.clearSession();
  location.reload();
});

window.MemVault?.loadManifest().catch(err => {
  console.error(err);
  const status = $('#vaultStatus');
  if (status) { status.textContent = 'Não foi possível carregar o cofre protegido.'; status.className = 'vault-status error'; }
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
