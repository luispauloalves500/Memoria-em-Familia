const DB_NAME = 'memorias-em-familia';
const DB_VERSION = 1;
const PHOTO_STORE = 'photos';
const ALBUM_STORE = 'albums';

const BUNDLED_MANIFEST_URL = './assets/family-photos/manifest.json';
const BUNDLED_IMPORT_KEY = 'memorias-bundled-family-photos-v1';
const assetBlobCache = new Map();

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
  if (thumbnail && photo.thumbUrl) return photo.thumbUrl;
  if (photo.assetUrl) return photo.assetUrl;
  const blob = thumbnail ? thumbnailBlob(photo) : displayBlob(photo);
  return blob ? urlForBlob(blob) : '';
}
async function blobForPhoto(photo) {
  const direct = displayBlob(photo);
  if (direct) return direct;
  if (!photo?.assetUrl) return null;
  if (assetBlobCache.has(photo.assetUrl)) return assetBlobCache.get(photo.assetUrl);
  const response = await fetch(photo.assetUrl);
  if (!response.ok) throw new Error(`Não foi possível abrir a foto (${response.status}).`);
  const blob = await response.blob();
  assetBlobCache.set(photo.assetUrl, blob);
  return blob;
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
  return `
    <article class="photo-card" data-photo-id="${photo.id}">
      ${photoVisual(photo, {thumbnail:true})}
      <div class="photo-overlay"></div>
      <div class="photo-badges">
        ${album ? `<span class="photo-badge">${escapeHtml(album.name)}</span>` : ''}
        ${photo.editedFrom ? `<span class="photo-badge edited">Editada</span>` : ''}
      </div>
      <button class="favorite-btn ${photo.favorite ? 'on' : ''}" data-favorite-id="${photo.id}" aria-label="Favoritar">${photo.favorite ? '♥' : '♡'}</button>
      <div class="photo-info"><strong>${escapeHtml(photo.name || 'Foto')}</strong><span>${formatDate(photo.createdAt)}</span></div>
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

function renderHome() {
  const photos = activePhotos();
  const recent = sorted(photos.filter(photoMatches)).slice(0,10);
  const favorites = photos.filter(p=>p.favorite).length;
  const totalBytes = photos.reduce((sum,p)=>sum+(p.size||0),0);
  const albumCards = state.albums.slice(0,4).map(renderAlbumCard).join('');

  root.innerHTML = `
    <section class="hero">
      <div class="hero-content">
        <div class="eyebrow">Seu acervo particular</div>
        <h1>Momentos que merecem ficar.</h1>
        <p>Organize, edite e preserve as fotos da família com álbuns, favoritos e uma experiência feita para celular e computador.</p>
        <button class="btn" data-action="upload">↑ Adicionar novas fotos</button>
      </div>
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

function renderAlbumCard(album) {
  const photos = albumPhotoList(album.id);
  const covers = photos.slice(0,4);
  return `
    <article class="album-card" data-album-id="${album.id}">
      <div class="album-cover">
        ${covers.length ? covers.map(p=>photoVisual(p,{thumbnail:true,alt:''})).join('') : '<div class="album-placeholder">▣</div>'}
      </div>
      <div class="album-body"><strong>${escapeHtml(album.name)}</strong><span>${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}${album.description ? ' · '+escapeHtml(album.description) : ''}</span></div>
    </article>`;
}

function renderAlbums() {
  root.innerHTML = `
    <div class="section-head" style="margin-top:0"><div><h2>Álbuns</h2><p>Momentos, viagens, pessoas e datas especiais.</p></div><button class="btn primary" data-action="album">+ Novo álbum</button></div>
    ${state.albums.length ? `<div class="album-grid">${state.albums.map(renderAlbumCard).join('')}</div>` : renderEmpty('Nenhum álbum ainda', 'Crie um álbum para começar a separar suas fotos por momentos.', 'Criar álbum', 'album')}
  `;
}

function renderPhotoView(title, subtitle, list, opts={}) {
  const filtered = sorted(list.filter(photoMatches));
  root.innerHTML = `
    <div class="section-head" style="margin-top:0"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button class="btn primary" data-action="upload">↑ Enviar fotos</button></div>
    <div class="toolbar">
      <div class="filter-row">
        ${opts.backAlbum ? `<button class="chip" data-view-link="albums">← Álbuns</button>` : ''}
        <span class="chip active">${filtered.length} ${filtered.length===1?'foto':'fotos'}</span>
      </div>
      <select class="select" id="sortSelect">
        <option value="newest" ${state.sort==='newest'?'selected':''}>Mais recentes</option>
        <option value="oldest" ${state.sort==='oldest'?'selected':''}>Mais antigas</option>
        <option value="name" ${state.sort==='name'?'selected':''}>Nome</option>
      </select>
    </div>
    ${filtered.length ? `<div class="photo-grid">${filtered.map(renderPhotoCard).join('')}</div>` : renderEmpty('Nada por aqui', state.search ? 'Nenhuma foto corresponde à sua busca.' : 'Adicione fotos para preencher esta coleção.')}
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

function renderCurrent() {
  $$('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === state.view || (state.view.startsWith('album:') && b.dataset.view === 'albums')));
  if (state.view === 'home') return renderHome();
  if (state.view === 'albums') return renderAlbums();
  if (state.view === 'favorites') return renderPhotoView('Favoritos', 'As fotos que você marcou para encontrar mais rápido.', activePhotos().filter(p=>p.favorite));
  if (state.view === 'trash') return renderTrash();
  if (state.view.startsWith('album:')) {
    const albumId = state.view.split(':')[1];
    const album = getAlbum(albumId);
    return renderPhotoView(album?.name || 'Álbum', album?.description || 'Fotos deste álbum.', albumPhotoList(albumId), { backAlbum:true });
  }
  renderPhotoView('Todas as fotos', 'Sua coleção completa de memórias.', activePhotos());
}

async function importBundledFamilyPhotos() {
  if (localStorage.getItem(BUNDLED_IMPORT_KEY) === 'done') return false;
  try {
    const response = await fetch(BUNDLED_MANIFEST_URL, { cache:'no-cache' });
    if (!response.ok) throw new Error(`Manifesto indisponível (${response.status})`);
    const manifest = await response.json();
    const albumInfo = manifest?.album;
    const photos = Array.isArray(manifest?.photos) ? manifest.photos : [];
    if (!albumInfo?.id || !photos.length) return false;

    let album = state.albums.find(a => a.id === albumInfo.id);
    if (!album) {
      album = {
        id: albumInfo.id,
        name: albumInfo.name || 'Fotos da Família',
        description: albumInfo.description || 'Fotos incluídas no acervo do site',
        createdAt: new Date().toISOString(),
      };
      await idbPut(ALBUM_STORE, album);
      state.albums.push(album);
    }

    const existing = new Set(state.photos.map(p => p.id));
    const baseTime = Date.now();
    let added = 0;
    for (let i=0; i<photos.length; i++) {
      const item = photos[i];
      if (!item?.id || existing.has(item.id)) continue;
      const createdAt = new Date(baseTime - (photos.length - i) * 1000).toISOString();
      const photo = {
        id: item.id,
        name: item.name || item.filename || 'Foto',
        filename: item.filename || `${item.id}.webp`,
        type: 'image/webp',
        size: Number(item.size) || 0,
        width: Number(item.width) || null,
        height: Number(item.height) || null,
        assetUrl: item.path,
        thumbUrl: item.thumb || item.path,
        previewUnsupported: false,
        albumId: album.id,
        tags: ['família', item.sourceLot || 'acervo'].filter(Boolean),
        favorite: false,
        bundled: true,
        bundleVersion: manifest.version || '1',
        sourceLot: item.sourceLot || null,
        createdAt,
        importedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      };
      await idbPut(PHOTO_STORE, photo);
      state.photos.push(photo);
      existing.add(photo.id);
      added++;
    }
    localStorage.setItem(BUNDLED_IMPORT_KEY, 'done');
    if (added) toast(`${added} fotos da família adicionadas ao acervo.`, 4200);
    return added > 0;
  } catch (err) {
    console.warn('Não foi possível carregar as fotos incluídas no projeto.', err);
    return false;
  }
}

async function loadState() {
  state.photos = await idbAll(PHOTO_STORE);
  state.albums = await idbAll(ALBUM_STORE);
  if (!state.albums.length) {
    const starters = [
      { id:uid('alb'), name:'Família', description:'Momentos especiais juntos', createdAt:new Date().toISOString() },
      { id:uid('alb'), name:'Viagens', description:'Lugares e histórias para lembrar', createdAt:new Date().toISOString() },
    ];
    for (const a of starters) await idbPut(ALBUM_STORE, a);
    state.albums = starters;
  }
  refreshAlbumSelect();
  renderCurrent();
  const imported = await importBundledFamilyPhotos();
  if (imported) {
    refreshAlbumSelect();
    renderCurrent();
  }
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
      const photo = {
        id: uid('photo'),
        name: file.name.replace(/\.[^.]+$/, '') || 'Foto',
        filename: file.name || `foto-${Date.now()}.jpg`,
        type: mimeFromFile(file),
        size: file.size,
        blob: file,
        thumbBlob,
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

function updateLightbox() {
  const photo = currentLightboxPhoto(); if(!photo) return;
  const album = getAlbum(photo.albumId);
  const img = $('#lightboxImage');
  if (photo.previewUnsupported) {
    img.removeAttribute('src');
    img.alt = 'Prévia não disponível neste navegador';
    img.style.display = 'none';
  } else {
    img.style.display = '';
    img.src = photoSourceUrl(photo, false);
    img.alt = photo.name || 'Foto';
  }
  $('#lightboxTitle').textContent = photo.name || 'Foto';
  $('#lightboxMeta').textContent = `${album?.name || 'Sem álbum'} · ${formatDate(photo.createdAt)} · ${bytesLabel(photo.size)}${photo.editedFrom ? ' · versão editada' : ''}`;
  $('#lightboxFavorite').textContent = photo.favorite ? '♥ Favorita' : '♡ Favoritar';
  $('#lightboxEdit').disabled = !!photo.previewUnsupported;
  $('#lightboxEdit').title = photo.previewUnsupported ? 'Este formato não pode ser editado neste navegador.' : 'Editar foto';
}

function moveLightbox(delta) {
  if (!state.lightboxIds.length) return;
  state.lightboxIndex = (state.lightboxIndex + delta + state.lightboxIds.length) % state.lightboxIds.length;
  updateLightbox();
}

function downloadPhoto(photo) {
  if (!photo) return;
  const href = photo.assetUrl || (displayBlob(photo) ? urlForBlob(displayBlob(photo)) : '');
  if (!href) return;
  const a = document.createElement('a');
  a.href = href;
  a.download = photo.filename || `${photo.name || 'foto'}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function exportBackup() {
  const data = {
    version:2,
    exportedAt:new Date().toISOString(),
    albums:state.albums,
    photos:state.photos.map(({blob, thumbBlob, ...meta})=>meta),
    note:'Este backup contém metadados. As imagens continuam no armazenamento local do navegador.'
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const a=document.createElement('a');
  a.href=urlForBlob(blob);
  a.download=`memorias-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  toast('Backup de metadados exportado.');
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
  for (const [id,val] of [['cropX',50],['cropY',50],['brightness',100],['contrast',100],['saturation',100],['grayscale',0]]) $('#'+id).value = val;
  updateEditorOutputs();
  updateFrameControls();
}

function updateEditorOutputs() {
  for (const id of ['cropX','cropY','brightness','contrast','saturation','grayscale']) {
    const out = $('#'+id+'Out');
    if (out) out.textContent = `${$('#'+id).value}%`;
  }
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

function drawEditedCanvas(canvas, maxDimension=1100) {
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
    const scale = Math.min(1, maxDimension / Math.max(naturalOutW, naturalOutH));
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
  const outputScale = Math.min(1, maxDimension / Math.max(naturalOutW, naturalOutH));
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
    drawEditedCanvas(canvas, 4096);
    const out = editorOutputType(sourcePhoto);
    const blob = await canvasToBlob(canvas, out.type, out.quality);
    let thumbBlob = null;
    try { thumbBlob = await createThumbnail(blob); } catch (_) {}
    const now = new Date().toISOString();
    const base = (sourcePhoto.name || 'Foto').replace(/\s+-\s+editada(?:\s+\d+)?$/i,'');
    const existingEdits = state.photos.filter(p=>p.editedFrom === (sourcePhoto.editedFrom || sourcePhoto.id)).length;
    const suffix = existingEdits ? ` - editada ${existingEdits+1}` : ' - editada';
    const copy = {
      ...sourcePhoto,
      id: uid('photo'),
      name: `${base}${suffix}`,
      filename: `${base}${suffix}.${out.ext}`.replace(/[\\/:*?"<>|]/g,'-'),
      type: out.type,
      size: blob.size,
      blob,
      thumbBlob,
      assetUrl:null,
      thumbUrl:null,
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
        grayscale: Number($('#grayscale').value),
      }
    };
    await idbPut(PHOTO_STORE, copy);
    state.photos.push(copy);
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
  if (nav) { state.view=nav.dataset.view; $('#sidebar').classList.remove('open'); renderCurrent(); return; }
  const viewLink = e.target.closest('[data-view-link]');
  if (viewLink) { state.view=viewLink.dataset.viewLink; renderCurrent(); return; }
  const uploadAction = e.target.closest('[data-action="upload"]');
  if (uploadAction) { openUploadDialog(); return; }
  const albumAction = e.target.closest('[data-action="album"]');
  if (albumAction) { $('#albumDialog').showModal(); return; }
  const albumCard = e.target.closest('[data-album-id]');
  if (albumCard) { state.view=`album:${albumCard.dataset.albumId}`; renderCurrent(); return; }
  const fav = e.target.closest('[data-favorite-id]');
  if (fav) { e.stopPropagation(); await toggleFavorite(fav.dataset.favoriteId); return; }
  const photoCard = e.target.closest('[data-photo-id]');
  if (photoCard) { openLightbox(photoCard.dataset.photoId); return; }
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

$('#lightboxClose').addEventListener('click', ()=>$('#lightbox').close());
$('#lightboxPrev').addEventListener('click', ()=>moveLightbox(-1));
$('#lightboxNext').addEventListener('click', ()=>moveLightbox(1));
$('#lightboxFavorite').addEventListener('click', ()=>toggleFavorite(currentLightboxPhoto()?.id));
$('#lightboxEdit').addEventListener('click', ()=>openEditor(currentLightboxPhoto()));
$('#lightboxDownload').addEventListener('click', ()=>{ const p=currentLightboxPhoto(); if(p) downloadPhoto(p); });
$('#lightboxDelete').addEventListener('click', async ()=>{ const p=currentLightboxPhoto(); if(!p)return; await softDelete(p.id); $('#lightbox').close(); });

addEventListener('keydown', e=>{
  if(!$('#lightbox').open) return;
  if(e.key==='ArrowLeft') moveLightbox(-1);
  if(e.key==='ArrowRight') moveLightbox(1);
});

// Editor
for (const id of ['cropAspect','frameMode','fillBlur','cropX','cropY','brightness','contrast','saturation','grayscale']) {
  $('#'+id).addEventListener('input', () => { updateFrameControls(); renderEditorPreview(); });
  $('#'+id).addEventListener('change', () => { updateFrameControls(); renderEditorPreview(); });
}
$('#rotateLeftBtn').addEventListener('click', ()=>{ editorState.rotation=(editorState.rotation-90)%360; renderEditorPreview(); });
$('#rotateRightBtn').addEventListener('click', ()=>{ editorState.rotation=(editorState.rotation+90)%360; renderEditorPreview(); });
$('#flipHBtn').addEventListener('click', ()=>{ editorState.flipX=!editorState.flipX; $('#flipHBtn').classList.toggle('active',editorState.flipX); renderEditorPreview(); });
$('#flipVBtn').addEventListener('click', ()=>{ editorState.flipY=!editorState.flipY; $('#flipVBtn').classList.toggle('active',editorState.flipY); renderEditorPreview(); });
$('#resetEditBtn').addEventListener('click', ()=>{ resetEditorControls(); $('#flipHBtn').classList.remove('active'); $('#flipVBtn').classList.remove('active'); renderEditorPreview(); });
$('#saveEditBtn').addEventListener('click', saveEditedCopy);
$('#editorDialog').addEventListener('close', cleanupEditor);

$('#themeSwitch').addEventListener('click', ()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('#exportBtn').addEventListener('click', exportBackup);

applyTheme(localStorage.getItem('memorias-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
initializeRadio();
loadState().catch(err=>{
  console.error(err);
  root.innerHTML=renderEmpty('Não foi possível abrir o armazenamento', 'Seu navegador pode estar bloqueando o IndexedDB. Tente abrir o site em uma janela normal.');
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
