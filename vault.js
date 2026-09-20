(() => {
  const MANIFEST_URL = './assets/vault/manifest.json';
  let manifest = null;
  let key = null;
  const decryptedCache = new Map();
  const objectUrlCache = new Map();

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function b64ToBytes(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64(bytes) {
    let bin = '';
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  async function loadManifest() {
    if (manifest) return manifest;
    const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Cofre indisponível (${response.status})`);
    manifest = await response.json();
    return manifest;
  }

  async function deriveKey(password) {
    const m = await loadManifest();
    const material = await crypto.subtle.importKey(
      'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey({
      name: 'PBKDF2',
      salt: b64ToBytes(m.crypto.salt),
      iterations: Number(m.crypto.iterations || 350000),
      hash: 'SHA-256',
    }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function unlock(password) {
    if (!password) throw new Error('Digite a senha.');
    const candidate = await deriveKey(password);
    const m = await loadManifest();
    try {
      const plain = await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv: b64ToBytes(m.crypto.canaryIv),
        additionalData: enc.encode(m.crypto.canaryAad),
      }, candidate, b64ToBytes(m.crypto.canary));
      if (dec.decode(plain) !== 'MEMORIAS_FAMILIA_V2_OK') throw new Error('Senha incorreta');
    } catch (_) {
      throw new Error('Senha incorreta.');
    }
    key = candidate;
    return true;
  }

  function isUnlocked() { return !!key; }

  function clearSession() {
    key = null;
    for (const url of objectUrlCache.values()) URL.revokeObjectURL(url);
    objectUrlCache.clear();
    decryptedCache.clear();
  }

  async function decryptBytes(buffer, ivB64, aad) {
    if (!key) throw new Error('Cofre bloqueado.');
    return crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: b64ToBytes(ivB64),
      additionalData: enc.encode(aad),
    }, key, buffer);
  }

  async function decryptBundledBlob(photo, thumbnail = false) {
    const cacheKey = `${thumbnail ? 't' : 'o'}:${photo.id}`;
    if (decryptedCache.has(cacheKey)) return decryptedCache.get(cacheKey);
    const url = thumbnail ? photo.thumbAssetUrl : photo.assetUrl;
    const iv = thumbnail ? photo.thumbIv : photo.iv;
    const aad = thumbnail ? photo.thumbAad : photo.aad;
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Não foi possível abrir a mídia protegida (${response.status}).`);
    const cipher = await response.arrayBuffer();
    const plain = await decryptBytes(cipher, iv, aad);
    const blob = new Blob([plain], { type: photo.type || 'image/webp' });
    decryptedCache.set(cacheKey, blob);
    return blob;
  }

  async function decryptLocalBlob(photo, thumbnail = false) {
    const cacheKey = `${thumbnail ? 'lt' : 'lo'}:${photo.id}`;
    if (decryptedCache.has(cacheKey)) return decryptedCache.get(cacheKey);
    const cipherBlob = thumbnail ? photo.thumbEncryptedBlob : photo.encryptedBlob;
    const iv = thumbnail ? photo.thumbLocalIv : photo.localIv;
    const aad = thumbnail ? photo.thumbLocalAad : photo.localAad;
    if (!cipherBlob || !iv || !aad) return null;
    const plain = await decryptBytes(await cipherBlob.arrayBuffer(), iv, aad);
    const blob = new Blob([plain], { type: thumbnail ? (photo.thumbType || photo.type || 'image/webp') : (photo.type || 'image/jpeg') });
    decryptedCache.set(cacheKey, blob);
    return blob;
  }

  async function getBlob(photo, thumbnail = false) {
    if (!photo) return null;
    if (photo.encryptedBlob || photo.thumbEncryptedBlob) {
      const local = await decryptLocalBlob(photo, thumbnail);
      if (local) return local;
    }
    if (photo.bundled && photo.encryptedAsset) return decryptBundledBlob(photo, thumbnail);
    if (thumbnail && photo.thumbBlob) return photo.thumbBlob;
    return photo.blob || null;
  }

  async function getObjectUrl(photo, thumbnail = false) {
    const cacheKey = `${thumbnail ? 'url:t' : 'url:o'}:${photo.id}`;
    if (objectUrlCache.has(cacheKey)) return objectUrlCache.get(cacheKey);
    const blob = await getBlob(photo, thumbnail);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    objectUrlCache.set(cacheKey, url);
    return url;
  }

  async function encryptBlob(blob, id, variant = 'original') {
    if (!key) throw new Error('Cofre bloqueado.');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = `memorias-v2:local:${id}:${variant}`;
    const cipher = await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: enc.encode(aad)
    }, key, await blob.arrayBuffer());
    return { blob: new Blob([cipher], { type: 'application/octet-stream' }), iv: bytesToB64(iv), aad };
  }

  async function migratePlainPhoto(photo) {
    if (!photo || photo.bundled || photo.encryptedBlob || !photo.blob) return photo;
    const original = await encryptBlob(photo.blob, photo.id, 'original');
    let thumb = null;
    if (photo.thumbBlob) thumb = await encryptBlob(photo.thumbBlob, photo.id, 'thumb');
    const next = {
      ...photo,
      encryptedBlob: original.blob,
      localIv: original.iv,
      localAad: original.aad,
      thumbEncryptedBlob: thumb?.blob || null,
      thumbLocalIv: thumb?.iv || null,
      thumbLocalAad: thumb?.aad || null,
      encryptedLocal: true,
    };
    delete next.blob;
    delete next.thumbBlob;
    return next;
  }

  async function bundledManifest() {
    const m = await loadManifest();
    return m;
  }

  window.MemVault = {
    loadManifest,
    bundledManifest,
    unlock,
    isUnlocked,
    clearSession,
    getBlob,
    getObjectUrl,
    encryptBlob,
    migratePlainPhoto,
  };
})();
