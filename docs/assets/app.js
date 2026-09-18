(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const stage = $('stage');
  const audio = $('audio');
  const mediaReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const DEFAULT_IMAGES = { background: $('backgroundA').src, cover: $('coverImage').src, bgSource: '', coverSource: '', bgCrop: null, coverCrop: null };
  const DEMO_AUDIO = audio.src;
  const DEFAULT_PREFS = Object.freeze({
    theme: 'light', title: 'FASHION', subtitle: 'SELF-PORTRAIT',
    tagline: '让每一首歌，都有自己的风景。', bgX: 50, bgY: 50, bgZoom: 100,
    brightness: 100, blur: 0, coverX: 50, coverY: 50, volume: .65,
    muted: false, shuffle: false, repeat: 'all', spectrum: true,
    motion: !mediaReduced.matches, lyrics: true, playbackRate: 1, currentId: 'demo-ambient'
  });
  const demoTrack = () => ({ id: 'demo-ambient', title: '花间晚风', artist: '内置氛围音 · 合成试听',
    fileName: 'ambient-demo.mp3', duration: 64, isDemo: true, liked: false, lrcText: '', addedAt: 0 });
  const state = {
    prefs: { ...DEFAULT_PREFS }, images: { ...DEFAULT_IMAGES }, tracks: [demoTrack()], index: 0,
    history: [], db: null, persistent: false, persistenceFailed: false, currentTab: 'music',
    imageTarget: 'both', filterLiked: false, drawerOpen: false, restoreFocus: null,
    imageSlot: 'A', imageChangeId: 0, importing: false, seeking: false, loaded: false,
    lyrics: [], lyricIndex: -99, timerEnd: 0, timerMinutes: 0, lastTimerSecond: -1
  };
  let audioContext = null, analyser = null, masterGain = null, sourceNode = null;
  let fftData = null, saveTimeout = 0, toastTimeout = 0, metadataGeneration = 0, cropperState = null;
  const trackURLs = new Map();
  const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
  const currentTrack = () => state.tracks[state.index];
  const pad2 = n => String(n).padStart(2, '0');
  const formatTime = seconds => {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    return s >= 3600 ? `${Math.floor(s / 3600)}:${pad2(Math.floor(s % 3600 / 60))}:${pad2(s % 60)}` : `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
  };
  const iconHTML = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  function setIcon(button, name) { const use = button.querySelector('use'); if (use) use.setAttribute('href', `#i-${name}`); }
  const CROPPER_SPECS = Object.freeze({
    background: { key: 'background', width: 2560, height: 1440, ratio: '16 / 9', shape: 'rect', title: '背景取景',
      hint: '先选出照片中要保留的范围。网页背景会铺满右侧区域；不同屏幕比例会影响边缘显示，可在外观面板微调。',
      tip: '背景建议保留人物主体和环境氛围；也可以把景深、花朵、霓虹等氛围放进来。' },
    cover: { key: 'cover', width: 1400, height: 1400, ratio: '1 / 1', shape: 'circle', title: '唱片取景',
      hint: '唱片封面更适合突出头像、半身或最有辨识度的局部。',
      tip: '唱片区域是圆形，建议让人物居中一些，脸部不要贴边。' }
  });
  function sanitizeStoredCrop(value) {
    if (!value || typeof value !== 'object') return null;
    const x = Number(value.x), y = Number(value.y), zoom = Number(value.zoom);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(zoom)
      ? { x, y, zoom: clamp(zoom, 100, 280) }
      : null;
  }
  function createCropPreset(image, spec, saved = null) {
    const baseScale = Math.max(spec.width / image.naturalWidth, spec.height / image.naturalHeight);
    const crop = { x: 0, y: 0, zoom: 100, baseScale };
    if (saved) {
      crop.x = Number(saved.x) || 0;
      crop.y = Number(saved.y) || 0;
      crop.zoom = clamp(saved.zoom, 100, 280);
    }
    return crop;
  }
  function getCropMetrics(image, spec, crop) {
    const scale = crop.baseScale * (crop.zoom / 100);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const limitX = Math.max(0, (width - spec.width) / 2);
    const limitY = Math.max(0, (height - spec.height) / 2);
    return { width, height, limitX, limitY };
  }
  function clampCrop(crop, key) {
    if (!cropperState) return crop;
    const spec = CROPPER_SPECS[key];
    const { image } = cropperState;
    const { limitX, limitY } = getCropMetrics(image, spec, crop);
    crop.x = clamp(crop.x, -limitX, limitX);
    crop.y = clamp(crop.y, -limitY, limitY);
    return crop;
  }
  function activeCropSpec() {
    return cropperState ? CROPPER_SPECS[cropperState.activeKey] : CROPPER_SPECS.background;
  }
  function updateCropperView() {
    if (!cropperState) return;
    const spec = activeCropSpec();
    const crop = clampCrop(cropperState.crops[spec.key], spec.key);
    const frame = $('cropperFrame');
    const image = $('cropperImage');
    const { width, height } = getCropMetrics(cropperState.image, spec, crop);
    frame.dataset.shape = spec.shape;
    frame.style.aspectRatio = spec.ratio;
    if (image.getAttribute('src') !== cropperState.url) image.src = cropperState.url;
    const previewScale = frame.clientWidth / spec.width;
    image.style.width = `${width * previewScale}px`;
    image.style.height = `${height * previewScale}px`;
    image.style.transform = `translate(-50%, -50%) translate(${crop.x * previewScale}px, ${crop.y * previewScale}px)`;
    $('cropperZoom').value = String(crop.zoom);
    $('cropperZoomOut').textContent = `${Math.round(crop.zoom)}%`;
    $('cropperPanelTitle').textContent = spec.title;
    $('cropperPanelText').textContent = spec.hint;
    $('cropperTip').textContent = spec.tip + ' 手机上也可以双指缩放。';
    $('cropperTabBackground').hidden = !cropperState.keys.includes('background');
    $('cropperTabCover').hidden = !cropperState.keys.includes('cover');
    $('cropperTabBackground').classList.toggle('is-active', spec.key === 'background');
    $('cropperTabCover').classList.toggle('is-active', spec.key === 'cover');
  }
  function switchCropperTab(key) {
    if (!cropperState || !cropperState.keys.includes(key)) return;
    resetCropGestures();
    cropperState.activeKey = key;
    updateCropperView();
  }
  function setCropZoom(value) {
    if (!cropperState) return;
    const crop = cropperState.crops[cropperState.activeKey];
    crop.zoom = clamp(value, 100, 280);
    clampCrop(crop, cropperState.activeKey);
    updateCropperView();
  }
  function resetCurrentCrop() {
    if (!cropperState) return;
    cropperState.crops[cropperState.activeKey] = createCropPreset(cropperState.image, CROPPER_SPECS[cropperState.activeKey]);
    updateCropperView();
  }
  function snapshotCrop(crop) {
    return { x: Math.round(crop.x * 100) / 100, y: Math.round(crop.y * 100) / 100, zoom: Math.round(crop.zoom) };
  }
  function renderCropToDataURL(key) {
    const spec = CROPPER_SPECS[key];
    const crop = clampCrop(cropperState.crops[key], key);
    const canvas = document.createElement('canvas');
    canvas.width = spec.width; canvas.height = spec.height;
    const ctx = canvas.getContext('2d');
    const { width, height } = getCropMetrics(cropperState.image, spec, crop);
    const dx = (spec.width - width) / 2 + crop.x;
    const dy = (spec.height - height) / 2 + crop.y;
    ctx.drawImage(cropperState.image, dx, dy, width, height);
    return canvas.toDataURL('image/webp', .92);
  }
  function closeCropper(resolveValue = null) {
    if (!cropperState) return;
    const { resolver, restoreFocus } = cropperState;
    resetCropGestures();
    $('cropperModal').hidden = true;
    document.body.classList.remove('modal-open');
    $('cropperFrame').classList.remove('is-dragging');
    cropperState = null;
    stage.inert = false; $('drawer').inert = false;
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    $('cropperImage').removeAttribute('src');
    resolver(resolveValue);
  }
  async function openPhotoCropperFromSource(sourceData, target = 'both', savedCrops = {}) {
    if (cropperState) { toast('请先保存或取消当前照片调整。'); return null; }
    const image = await decodeImage(sourceData);
    if (cropperState) return null;
    const keys = target === 'both' ? ['background', 'cover'] : target === 'background' ? ['background'] : ['cover'];
    return new Promise(resolve => {
      cropperState = {
        resolver: resolve, target, url: sourceData, image, keys, activeKey: keys[0],
        crops: Object.fromEntries(keys.map(key => [key, createCropPreset(image, CROPPER_SPECS[key], sanitizeStoredCrop(savedCrops[key]))])),
        dragPointerId: null, dragX: 0, dragY: 0, pointers: new Map(), pinchStart: null, restoreFocus: document.activeElement
      };
      $('cropperModal').hidden = false;
      document.body.classList.add('modal-open');
      stage.inert = true; $('drawer').inert = true;
      updateCropperView();
      requestAnimationFrame(() => $('cropperFrame').focus({ preventScroll: true }));
    });
  }
  async function openPhotoCropper(file, target = 'both', savedCrops = {}) {
    const sourceData = await loadImageFile(file, 2560);
    return openPhotoCropperFromSource(sourceData, target, savedCrops);
  }
  function cropPointerPoint(event) {
    const frame = $('cropperFrame'), spec = activeCropSpec();
    const rect = frame.getBoundingClientRect();
    const ratio = spec.width / Math.max(1, frame.clientWidth);
    return { x: (event.clientX - rect.left - frame.clientWidth / 2) * ratio,
      y: (event.clientY - rect.top - frame.clientHeight / 2) * ratio };
  }
  function resetCropGestures() {
    if (!cropperState) return;
    const frame = $('cropperFrame');
    const ids = [...cropperState.pointers.keys()];
    cropperState.pointers.clear(); cropperState.pinchStart = null; cropperState.dragPointerId = null;
    for (const id of ids) { try { if (frame.hasPointerCapture(id)) frame.releasePointerCapture(id); } catch (_) {} }
    frame.classList.remove('is-dragging');
  }
  function beginCropGesture() {
    if (!cropperState) return;
    const points = [...cropperState.pointers.entries()], crop = cropperState.crops[cropperState.activeKey];
    cropperState.pinchStart = null; cropperState.dragPointerId = null;
    $('cropperFrame').classList.toggle('is-dragging', points.length > 0);
    if (points.length === 1) {
      cropperState.dragPointerId = points[0][0];
      cropperState.dragX = points[0][1].x - crop.x;
      cropperState.dragY = points[0][1].y - crop.y;
    } else if (points.length >= 2) {
      const a = points[0][1], b = points[1][1];
      cropperState.pinchStart = { distance: Math.max(1, Math.hypot(a.x-b.x,a.y-b.y)),
        zoom: crop.zoom, x: crop.x, y: crop.y, centerX: (a.x+b.x)/2, centerY: (a.y+b.y)/2 };
    }
  }
  function handleCropKeys(event) {
    if (!cropperState) return;
    if (event.key === 'Escape') { event.preventDefault(); closeCropper(null); return; }
    if (event.key === 'Tab') {
      const nodes = $$('button:not(:disabled),input:not(:disabled),[tabindex="0"]', $('cropperModal'))
        .filter(el => !el.closest('[hidden]') && el.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length-1];
      if (event.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
      return;
    }
    if (document.activeElement !== $('cropperFrame')) return;
    const crop = cropperState.crops[cropperState.activeKey], step = (event.shiftKey ? 20 : 4) * activeCropSpec().width / $('cropperFrame').clientWidth;
    const move = { ArrowLeft: [-step,0], ArrowRight: [step,0], ArrowUp: [0,-step], ArrowDown: [0,step] }[event.key];
    if (move) { event.preventDefault(); crop.x += move[0]; crop.y += move[1]; updateCropperView(); }
    if (['+','=','-'].includes(event.key)) { event.preventDefault(); setCropZoom(crop.zoom + (event.key === '-' ? -5 : 5)); }
  }
  function bindCropperEvents() {
    $('cropperTabBackground').onclick = () => switchCropperTab('background');
    $('cropperTabCover').onclick = () => switchCropperTab('cover');
    $('cropperZoom').oninput = event => setCropZoom(Number(event.target.value));
    $('cropperResetCurrent').onclick = () => { resetCropGestures(); resetCurrentCrop(); };
    $('cropperCancel').onclick = () => closeCropper(null);
    $('cropperSave').onclick = () => {
      if (!cropperState) return;
      try {
        const result = {};
        for (const key of cropperState.keys) result[key] = { image: renderCropToDataURL(key), crop: snapshotCrop(cropperState.crops[key]) };
        result.__source = cropperState.url;
        closeCropper(result);
      } catch (_) { toast('图片保存失败，请减小图片尺寸后重试。'); }
    };
    const frame = $('cropperFrame');
    frame.addEventListener('pointerdown', event => {
      if (!cropperState || (event.pointerType === 'mouse' && event.button !== 0) || cropperState.pointers.size >= 2) return;
      event.preventDefault(); frame.focus({ preventScroll: true });
      cropperState.pointers.set(event.pointerId, cropPointerPoint(event));
      try { frame.setPointerCapture(event.pointerId); } catch (_) {}
      beginCropGesture();
    });
    frame.addEventListener('pointermove', event => {
      if (!cropperState || !cropperState.pointers.has(event.pointerId)) return;
      event.preventDefault();
      const point = cropPointerPoint(event);
      cropperState.pointers.set(event.pointerId, point);
      const crop = cropperState.crops[cropperState.activeKey];
      if (cropperState.pointers.size >= 2 && cropperState.pinchStart) {
        const [a,b] = [...cropperState.pointers.values()], start = cropperState.pinchStart;
        const zoom = clamp(start.zoom * Math.hypot(a.x-b.x,a.y-b.y) / start.distance, 100, 280);
        const ratio = zoom / start.zoom;
        crop.zoom = zoom;
        // Keep the same source point under the two-finger midpoint, including translation.
        crop.x = (a.x+b.x)/2 - (start.centerX - start.x) * ratio;
        crop.y = (a.y+b.y)/2 - (start.centerY - start.y) * ratio;
      } else if (cropperState.dragPointerId === event.pointerId) {
        crop.x = point.x - cropperState.dragX; crop.y = point.y - cropperState.dragY;
      }
      updateCropperView();
    });
    const finish = event => {
      if (!cropperState || !cropperState.pointers.has(event.pointerId)) return;
      cropperState.pointers.delete(event.pointerId);
      try { if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId); } catch (_) {}
      beginCropGesture();
    };
    frame.addEventListener('pointerup', finish); frame.addEventListener('pointercancel', finish);
    frame.addEventListener('lostpointercapture', finish);
    frame.addEventListener('wheel', event => {
      if (!cropperState) return;
      event.preventDefault();
      const crop = cropperState.crops[cropperState.activeKey], anchor = cropPointerPoint(event);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1);
      const zoom = clamp(crop.zoom * Math.exp(-clamp(delta,-240,240) * .002),100,280);
      const ratio = zoom / crop.zoom;
      crop.x = anchor.x - (anchor.x - crop.x) * ratio;
      crop.y = anchor.y - (anchor.y - crop.y) * ratio;
      crop.zoom = zoom; updateCropperView();
    }, { passive: false });
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => { if (cropperState) { resetCropGestures(); updateCropperView(); } });
      observer.observe(frame);
    } else window.addEventListener('resize', () => { if (cropperState) { resetCropGestures(); updateCropperView(); } });
    window.addEventListener('blur', resetCropGestures);
  }
  function toast(message, actionLabel = '', action = null, delay = 3700) {
    window.clearTimeout(toastTimeout);
    $('toastText').textContent = message;
    $('toastAction').hidden = !actionLabel;
    $('toastAction').textContent = actionLabel;
    $('toastAction').onclick = () => { if (action) action(); $('toast').hidden = true; };
    $('toast').hidden = false;
    toastTimeout = window.setTimeout(() => { $('toast').hidden = true; }, delay);
  }

  // IndexedDB holds user-selected files inside this browser, with a session-only fallback.
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('本地存储不可用'));
      let settled = false;
      const timeout = setTimeout(() => { settled = true; reject(new Error('本地存储暂时不可用')); }, 3500);
      let request;
      try { request = indexedDB.open('portrait-fm-local-v1', 1); }
      catch (error) { clearTimeout(timeout); reject(error); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('prefs')) db.createObjectStore('prefs');
        if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
      };
      request.onerror = () => { if (!settled) { settled = true; clearTimeout(timeout); reject(request.error); } };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true; clearTimeout(timeout); resolve(request.result);
      };
    });
  }
  function dbTask(store, mode, operation) {
    return new Promise((resolve, reject) => {
      if (!state.db) { reject(new Error('本地存储不可用')); return; }
      let tx, request, result;
      try {
        tx = state.db.transaction(store, mode);
        request = operation(tx.objectStore(store));
        if (request) request.onsuccess = () => { result = request.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('本地存储失败'));
        tx.onabort = () => reject(tx.error || new Error('本地存储已中断'));
      } catch (error) { reject(error); }
    });
  }
  function updateStorageStatus() {
    const okay = state.persistent && !state.persistenceFailed;
    $('storageStatus').textContent = okay ? '已开启浏览器本地保存' : '当前内容仅保证在本页保留';
    $('storageDetail').textContent = okay
      ? '图片、歌曲和设置保存在此浏览器，不会上传。清理浏览器数据、换浏览器或隐私模式可能使保存失效。'
      : '浏览器未允许保存，或可用空间不足。图片与音乐仍不会上传；刷新后可能需要重新选择文件。';
    $('storageStatus').closest('.storage-note').classList.toggle('warn', !okay);
  }
  async function persist(store, operation, notify = true) {
    if (!state.db || !state.persistent) return false;
    try { await dbTask(store, 'readwrite', operation); return true; }
    catch (error) {
      const first = !state.persistenceFailed;
      state.persistenceFailed = true;
      updateStorageStatus();
      if (notify && first) toast('本地保存空间不足或被限制，新增内容暂时只在当前页面保留。', '', null, 7000);
      console.warn('[PORTRAIT FM] Local persistence unavailable:', error?.name || 'storage');
      return false;
    }
  }
  function savePrefs(immediate = false) {
    clearTimeout(saveTimeout);
    const save = () => {
      state.prefs.currentId = currentTrack()?.id || 'demo-ambient';
      persist('prefs', store => store.put({ ...state.prefs }, 'settings'), false);
    };
    if (immediate) save(); else saveTimeout = setTimeout(save, 260);
  }
  const saveTrack = track => persist('tracks', store => store.put(track));
  const saveImages = () => persist('prefs', store => store.put({ ...state.images }, 'images'));

  function fitHeadline() {
    const node = $('headline');
    const contentWidth = $('playerColumn')?.clientWidth || node.parentElement.clientWidth;
    const text = node.textContent || 'FASHION';
    const chinese = /[\u3400-\u9fff]/.test(text);
    const base = window.innerWidth <= 600 ? 86 : Math.min(148, window.innerWidth * .094);
    const measurement = document.createElement('canvas').getContext('2d');
    if (!measurement) return;
    const family = getComputedStyle(node).fontFamily;
    measurement.font = `400 ${base}px ${family}`;
    const letterSpacing = chinese ? base * .015 : -base * .055;
    const measured = measurement.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
    const size = Math.max(20, Math.min(base, base * (contentWidth + 1) / Math.max(1, measured)));
    node.style.fontSize = `${size}px`;
    node.style.letterSpacing = chinese ? '.015em' : '-.055em';
    fitPlayerHeight();
  }
  function fitPlayerHeight() {
    const column = document.querySelector('.player-column');
    const footer = document.querySelector('.stage-footer');
    if (!column || !footer || !column.offsetHeight) return;
    const available = Math.max(120, footer.offsetTop - column.offsetTop - 22);
    const scale = Math.min(1, available / column.offsetHeight);
    column.style.transform = `scale(${scale})`;
    column.style.transformOrigin = 'top left';
  }
  function applyPrefs(syncInputs = true) {
    const p = state.prefs;
    stage.dataset.theme = p.theme;
    stage.style.setProperty('--bg-x', `${p.bgX}%`);
    stage.style.setProperty('--bg-y', `${p.bgY}%`);
    stage.style.setProperty('--bg-scale', String(p.bgZoom / 100 + .04));
    stage.style.setProperty('--brightness', String(p.brightness / 100));
    stage.style.setProperty('--blur', `${p.blur}px`);
    stage.style.setProperty('--cover-x', `${p.coverX}%`);
    stage.style.setProperty('--cover-y', `${p.coverY}%`);
    const motion = p.motion && !mediaReduced.matches;
    stage.classList.toggle('motion-on', motion);
    stage.classList.toggle('motion-off', !motion);
    stage.classList.toggle('lyrics-off', !p.lyrics);
    stage.classList.toggle('no-spectrum', !p.spectrum);
    $('dustCanvas').hidden = !motion;
    $('headline').textContent = p.title || 'FASHION';
    $('subtitle').textContent = p.subtitle || 'SELF-PORTRAIT';
    $('tagline').textContent = p.tagline;
    document.title = (p.title === 'FASHION' ? '花间' : p.title || '花间') + ' · 私人音乐空间';
    document.querySelector('meta[name="theme-color"]').content = p.theme === 'dark' ? '#171f1b' : p.theme === 'warm' ? '#f4e5d3' : '#f0efe8';
    setIcon($('themeToggle'), p.theme === 'dark' ? 'sun' : 'moon');
    $('shuffleBtn').classList.toggle('is-active', p.shuffle);
    $('shuffleBtn').setAttribute('aria-pressed', String(p.shuffle));
    $('shuffleBtn').title = p.shuffle ? '关闭随机播放' : '开启随机播放';
    const repeatLabel = { all: '列表循环', one: '单曲循环', none: '播完停止' }[p.repeat];
    $('repeatBtn').title = `${repeatLabel} · 点击切换`;
    $('repeatBtn').setAttribute('aria-label', repeatLabel);
    $('repeatBtn').classList.toggle('is-active', p.repeat !== 'none');
    $('repeatBtn').querySelector('.repeat-one').hidden = p.repeat !== 'one';
    audio.playbackRate = p.playbackRate;
    audio.muted = p.muted;
    if (!state.timerEnd || state.timerEnd - Date.now() > 5000 || masterGain) audio.volume = p.volume;
    $('volume').value = String(Math.round(p.volume * 100));
    $('volumeValue').textContent = `${Math.round(p.volume * 100)}%`;
    setIcon($('muteBtn'), p.muted || p.volume === 0 ? 'mute' : 'volume');
    $('muteBtn').setAttribute('aria-label', p.muted ? '取消静音' : '静音');
    $('muteBtn').title = `${p.muted ? '取消静音' : '静音'} · M`;
    if (syncInputs) {
      for (const key of ['bgX', 'bgY', 'bgZoom', 'brightness', 'blur', 'coverX', 'coverY']) {
        $(key).value = String(p[key]);
        $(`${key}Out`).textContent = key === 'blur' ? `${p[key]}` : `${p[key]}%`;
      }
      $('titleInput').value = p.title; $('subtitleInput').value = p.subtitle; $('taglineInput').value = p.tagline;
      $('spectrumToggle').checked = p.spectrum; $('motionToggle').checked = p.motion; $('lyricsToggle').checked = p.lyrics;
      $('playbackRate').value = String(p.playbackRate);
    }
    $$('.theme-option').forEach(button => {
      const active = button.dataset.theme === p.theme;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    fitHeadline();
  }
  function applyImages(initial = false) {
    $('coverImage').src = state.images.cover;
    $('coverThumb').src = state.images.cover;
    $('miniCover').src = state.images.cover;
    $('bgThumb').src = state.images.background;
    if (initial) {
      $('backgroundA').src = state.images.background;
      $('backgroundA').classList.add('is-current');
      $('backgroundB').classList.remove('is-current');
      state.imageSlot = 'A';
    } else {
      const changeId = ++state.imageChangeId;
      const nextSlot = state.imageSlot === 'A' ? 'B' : 'A';
      const nextImage = $(`background${nextSlot}`);
      nextImage.onload = () => {
        if (changeId !== state.imageChangeId) return;
        $(`background${state.imageSlot}`).classList.remove('is-current');
        nextImage.classList.add('is-current'); state.imageSlot = nextSlot;
        nextImage.onload = null;
      };
      nextImage.src = state.images.background;
    }
    renderPlaylist(); updateMediaSession();
  }

  function renderTrackMetadata() {
    const track = currentTrack();
    if (!track) return;
    $('trackTitle').textContent = track.title;
    $('trackArtist').textContent = track.artist;
    $('miniTitle').textContent = track.title;
    $('trackIndex').replaceChildren(document.createTextNode(`${pad2(state.index + 1)} `));
    const count = document.createElement('b'); count.textContent = `/ ${pad2(state.tracks.length)}`;
    $('trackIndex').appendChild(count);
    $('playlistCount').textContent = pad2(state.tracks.length);
    $('libraryCount').textContent = `共 ${state.tracks.length} 首`;
    $('likeBtn').classList.toggle('liked', !!track.liked);
    $('likeBtn').setAttribute('aria-pressed', String(!!track.liked));
    $('likeBtn').setAttribute('aria-label', track.liked ? '取消喜欢这首歌' : '喜欢这首歌');
    $('likeBtn').title = track.liked ? '已喜欢 · 点击取消' : '喜欢这首歌';
    $('lrcTrackName').textContent = `为「${track.title}」添加歌词`;
    $('lrcEditor').value = track.lrcText || '';
    $('duration').textContent = formatTime(Number.isFinite(audio.duration) ? audio.duration : track.duration);
    $('qualityLabel').innerHTML = track.isDemo ? 'STEREO <span>·</span> AMBIENT DEMO' : 'STEREO <span>·</span> LOCAL AUDIO';
    state.lyrics = parseLyrics(track.lrcText || ''); state.lyricIndex = -99; updateLyrics();
    updateMediaSession();
  }
  function renderPlaylist() {
    const list = $('trackList'); list.replaceChildren();
    const visible = state.tracks.filter(t => !state.filterLiked || t.liked);
    $('emptyFavorites').hidden = visible.length !== 0;
    $('favoriteFilter').classList.toggle('is-active', state.filterLiked);
    $('favoriteFilter').setAttribute('aria-pressed', String(state.filterLiked));
    $('favoriteFilter').textContent = state.filterLiked ? '显示全部' : '只看喜欢';
    $('libraryCount').textContent = state.filterLiked ? `${visible.length} 首喜欢的歌曲` : `共 ${state.tracks.length} 首`;
    for (const track of visible) {
      const index = state.tracks.indexOf(track);
      const selected = index === state.index;
      const row = document.createElement('div'); row.className = 'track-row' + (selected ? ' is-current' : '');
      row.dataset.id = track.id;
      const button = document.createElement('button'); button.className = 'track-select';
      button.setAttribute('aria-label', `播放：${track.title}`);
      button.setAttribute('aria-current', selected ? 'true' : 'false');
      const number = document.createElement('span'); number.className = 'track-number';
      number.textContent = selected && !audio.paused ? '♫' : pad2(index + 1);
      const image = document.createElement('img'); image.className = 'track-cover-small'; image.src = state.images.cover; image.alt = ''; image.loading = 'lazy';
      const text = document.createElement('span'); text.className = 'track-row-text';
      const title = document.createElement('strong'); title.textContent = track.title;
      const artist = document.createElement('span'); artist.textContent = track.artist;
      text.append(title, artist); button.append(number, image, text);
      button.onclick = () => {
        if (index === state.index) togglePlay(); else selectTrack(index, true, true);
      };
      const duration = document.createElement('span'); duration.className = 'track-length'; duration.textContent = track.duration ? formatTime(track.duration) : '--:--';
      row.append(button, duration);
      if (!track.isDemo) {
        const remove = document.createElement('button'); remove.className = 'track-remove';
        remove.setAttribute('aria-label', `移除：${track.title}`); remove.title = '从歌单中移除'; remove.innerHTML = iconHTML('trash');
        remove.onclick = () => removeTrack(track.id);
        row.appendChild(remove);
      } else {
        const badge = document.createElement('span'); badge.className = 'track-local-badge'; badge.textContent = '试听'; row.appendChild(badge);
      }
      list.appendChild(row);
    }
  }
  function updatePlayUI() {
    const playing = !audio.paused && !audio.ended;
    stage.classList.toggle('is-playing', playing);
    for (const id of ['playBtn', 'miniPlayBtn']) setIcon($(id), playing ? 'pause' : 'play');
    setIcon($('vinylButton'), playing ? 'pause' : 'play');
    $('playBtn').setAttribute('aria-label', playing ? '暂停' : '播放');
    $('vinylButton').setAttribute('aria-label', playing ? '暂停音乐' : '播放音乐');
    $('nowLabel').textContent = playing ? '正在播放' : audio.currentTime > 0 ? '暂歇片刻' : '即将播放';
    $('recordStatus').textContent = playing ? 'NOW SPINNING' : audio.currentTime > 0 ? 'TAKE A BREATH' : 'READY TO PLAY';
    $('spectrumStatus').textContent = playing ? 'THE SOUND OF THIS MOMENT' : 'WAITING FOR YOUR SOUND';
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    $$('.track-row').forEach(row => {
      const number = row.querySelector('.track-number');
      const index = state.tracks.findIndex(t => t.id === row.dataset.id);
      if (number) number.textContent = index === state.index && playing ? '♫' : pad2(index + 1);
    });
  }
  function ensureAudioGraph() {
    if (audioContext) { if (audioContext.state === 'suspended') audioContext.resume().catch(() => {}); return; }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    try {
      audioContext = new Context();
      analyser = audioContext.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = .84;
      fftData = new Uint8Array(analyser.frequencyBinCount);
      masterGain = audioContext.createGain(); masterGain.gain.value = 1;
      sourceNode = audioContext.createMediaElementSource(audio);
      sourceNode.connect(analyser); analyser.connect(masterGain); masterGain.connect(audioContext.destination);
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    } catch (error) {
      // A browser without Web Audio still retains ordinary audio playback.
      console.warn('[PORTRAIT FM] Spectrum unavailable:', error?.name || 'Web Audio');
      analyser = null; fftData = null;
      if (sourceNode && audioContext) { try { sourceNode.connect(audioContext.destination); } catch (_) {} }
    }
  }
  async function playAudio() {
    if (!currentTrack()) return;
    ensureAudioGraph();
    if (audio.ended) audio.currentTime = 0;
    try { await audio.play(); }
    catch (error) {
      if (error?.name === 'AbortError') return;
      stage.classList.remove('is-loading');
      toast(error?.name === 'NotAllowedError'
        ? '歌曲已准备好，请再点一下播放按钮。'
        : '这首歌暂时无法播放，请换用浏览器支持的音频，例如 MP3 或 WAV。', '', null, 5500);
      updatePlayUI();
    }
  }
  function togglePlay() { if (audio.paused || audio.ended) playAudio(); else audio.pause(); }
  function sourceForTrack(track) {
    if (track.isDemo) return DEMO_AUDIO;
    if (!trackURLs.has(track.id)) trackURLs.set(track.id, URL.createObjectURL(track.blob));
    return trackURLs.get(track.id);
  }
  function selectTrack(index, autoplay = false, remember = false) {
    if (index < 0 || index >= state.tracks.length) return;
    if (remember && currentTrack() && index !== state.index) {
      state.history.push(currentTrack().id); if (state.history.length > 100) state.history.shift();
    }
    audio.pause(); state.index = index;
    audio.src = sourceForTrack(currentTrack());
    audio.load(); audio.playbackRate = state.prefs.playbackRate;
    $('currentTime').textContent = '00:00'; $('seek').value = '0'; $('seek').style.setProperty('--progress', '0%');
    renderTrackMetadata(); renderPlaylist(); updatePlayUI(); savePrefs();
    if (autoplay) playAudio();
  }
  function nextTrack(direction = 1, manual = true) {
    const count = state.tracks.length;
    if (!count) return;
    const keepPlaying = !audio.paused || !manual;
    if (!manual && state.prefs.repeat === 'one') { audio.currentTime = 0; playAudio(); return; }
    if (count === 1) {
      if (manual || state.prefs.repeat !== 'none') { audio.currentTime = 0; if (keepPlaying) playAudio(); }
      return;
    }
    let target = state.index + direction;
    if (state.prefs.shuffle) {
      if (!manual && state.prefs.repeat === 'none' && state.history.length >= count - 1) { audio.pause(); state.history = []; return; }
      if (direction < 0 && state.history.length) {
        const previousId = state.history.pop();
        target = state.tracks.findIndex(t => t.id === previousId);
        if (target < 0) target = (state.index - 1 + count) % count;
        selectTrack(target, keepPlaying); return;
      }
      let candidates = state.tracks.map((_, i) => i).filter(i => i !== state.index);
      if (!manual && state.prefs.repeat === 'none') candidates = candidates.filter(i => !state.history.includes(state.tracks[i].id));
      if (!candidates.length) { audio.pause(); state.history = []; return; }
      target = candidates[Math.floor(Math.random() * candidates.length)];
    } else if (!manual && target >= count && state.prefs.repeat === 'none') { audio.pause(); return; }
    target = (target + count) % count;
    selectTrack(target, keepPlaying, direction > 0);
  }
  async function removeTrack(id) {
    const index = state.tracks.findIndex(t => t.id === id);
    if (index < 0 || state.tracks[index].isDemo) return;
    const track = state.tracks[index], wasCurrent = index === state.index, playing = !audio.paused;
    if (wasCurrent) audio.pause();
    state.tracks.splice(index, 1);
    state.history = state.history.filter(v => v !== id);
    if (wasCurrent) selectTrack(Math.min(index, state.tracks.length - 1), playing);
    else { if (index < state.index) state.index--; renderTrackMetadata(); renderPlaylist(); savePrefs(); }
    if (trackURLs.has(id)) { URL.revokeObjectURL(trackURLs.get(id)); trackURLs.delete(id); }
    await persist('tracks', store => store.delete(id));
    toast(`已移除「${track.title}」`, '撤销', async () => {
      state.tracks.splice(Math.min(index, state.tracks.length), 0, track);
      if (index <= state.index) state.index++;
      await saveTrack(track); renderTrackMetadata(); renderPlaylist(); savePrefs();
    }, 5500);
  }
  function seekBy(seconds) {
    if (!Number.isFinite(audio.duration)) return;
    audio.currentTime = clamp(audio.currentTime + seconds, 0, audio.duration);
    updateProgress();
  }
  function updateProgress() {
    if (!state.seeking) {
      const duration = Number.isFinite(audio.duration) ? audio.duration : currentTrack()?.duration || 0;
      const progress = duration > 0 ? clamp(audio.currentTime / duration * 100, 0, 100) : 0;
      $('seek').value = String(Math.round(progress * 10));
      $('seek').style.setProperty('--progress', `${progress}%`);
      $('currentTime').textContent = formatTime(audio.currentTime);
      $('seek').setAttribute('aria-valuetext', `${formatTime(audio.currentTime)}，总时长 ${formatTime(duration)}`);
    }
    updateLyrics();
  }
  function setVolume(value) {
    state.prefs.volume = clamp(value, 0, 1);
    if (state.prefs.volume > 0) state.prefs.muted = false;
    applyPrefs(false); savePrefs();
  }
  function toggleMute() { state.prefs.muted = !state.prefs.muted; applyPrefs(false); savePrefs(); }

  async function loadImageFile(file, maxSize = 2560) {
    if (!file || !(/\.(jpe?g|png|webp|avif|gif|bmp)$/i.test(file.name) || /image\/(jpeg|png|webp|avif|gif|bmp)/i.test(file.type))) throw new Error('请选择 JPG、PNG、WebP 等常见图片文件。');
    if (file.size > 25 * 1024 * 1024) throw new Error('这张图片超过 25 MB，请先压缩后再选择。');
    const url = URL.createObjectURL(file);
    try {
      const image = await decodeImage(url);
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片未能解码，请换一张图片。');
      const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#eeece3'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', .91);
    } finally { URL.revokeObjectURL(url); }
  }
  function decodeImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片无法读取，请换用 JPG、PNG 或 WebP 图片。'));
      image.src = url;
    });
  }
  async function handleImage(file, target = 'both') {
    if (!file) return;
    const changeToken = ++metadataGeneration;
    try {
      const result = await openPhotoCropper(file, target);
      if (!result || changeToken !== metadataGeneration) return;
      const sourceData = result.__source || '';
      if (result.background) {
        state.images.background = result.background.image; state.images.bgSource = sourceData || state.images.bgSource; state.images.bgCrop = result.background.crop;
        state.prefs.bgX = 50; state.prefs.bgY = 50; state.prefs.bgZoom = 100;
      }
      if (result.cover) {
        state.images.cover = result.cover.image; state.images.coverSource = sourceData || state.images.coverSource; state.images.coverCrop = result.cover.crop;
        state.prefs.coverX = 50; state.prefs.coverY = 50;
      }
      applyImages(); applyPrefs(); savePrefs();
      const saved = await saveImages();
      const label = target === 'both' ? '背景与唱片已换成你的照片' : target === 'background' ? '背景照片已更新' : '唱片封面已更新';
      toast(label + ' · 已按你的取景保存' + (saved ? '' : '（当前页面可用）'), '', null, 4200);
    } catch (error) { toast(error.message || '图片读取失败，请重新选择。'); }
  }
  async function recropExisting(target = 'background') {
    const key = target === 'cover' ? 'cover' : 'background';
    const sourceKey = key === 'background' ? 'bgSource' : 'coverSource';
    const cropKey = key === 'background' ? 'bgCrop' : 'coverCrop';
    const source = state.images[sourceKey] || state.images[key];
    const changeToken = ++metadataGeneration;
    try {
      const result = await openPhotoCropperFromSource(source, key, { [key]: state.images[sourceKey] ? state.images[cropKey] : null });
      if (!result || changeToken !== metadataGeneration) return;
      if (key === 'background' && result.background) {
        state.images.background = result.background.image;
        state.images.bgSource = result.__source || source;
        state.images.bgCrop = result.background.crop;
        state.prefs.bgX = 50; state.prefs.bgY = 50; state.prefs.bgZoom = 100;
      }
      if (key === 'cover' && result.cover) {
        state.images.cover = result.cover.image;
        state.images.coverSource = result.__source || source;
        state.images.coverCrop = result.cover.crop;
        state.prefs.coverX = 50; state.prefs.coverY = 50;
      }
      applyImages(); applyPrefs(); savePrefs();
      const saved = await saveImages();
      toast(key === 'background' ? '背景取景已更新' + (saved ? '' : '（当前页面可用）') : '唱片取景已更新' + (saved ? '' : '（当前页面可用）'), '', null, 3600);
    } catch (error) { toast(error.message || '重新取景失败，请稍后重试。'); }
  }
  function pickImage(target) { state.imageTarget = target; $('imageInput').value = ''; $('imageInput').click(); }
  function fileDuration(file) {
    return new Promise(resolve => {
      const sample = new Audio(); const url = URL.createObjectURL(file); let finished = false;
      const finish = value => {
        if (finished) return; finished = true;
        clearTimeout(timer); sample.onloadedmetadata = null; sample.onerror = null;
        sample.removeAttribute('src'); sample.load(); URL.revokeObjectURL(url); resolve(value);
      };
      const timer = setTimeout(() => finish(0), 6000);
      sample.preload = 'metadata';
      sample.onloadedmetadata = () => finish(Number.isFinite(sample.duration) ? sample.duration : 0);
      sample.onerror = () => finish(0);
      sample.src = url;
    });
  }
  function namesFromFile(file) {
    const name = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    const split = name.split(/\s+-\s+/);
    if (split.length > 1) return { artist: split[0].slice(0, 120), title: split.slice(1).join(' - ').slice(0, 160) };
    return { title: name.slice(0, 160) || '未命名歌曲', artist: '本地音乐' };
  }
  async function addAudioFiles(files) {
    if (state.importing) { toast('正在添加歌曲，请稍等片刻。'); return; }
    const candidates = [...files].filter(file => file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|webm|opus|aiff?)$/i.test(file.name));
    if (!candidates.length) { toast('请选择音乐文件，例如 MP3、WAV、M4A。'); return; }
    state.importing = true; $('addTracksBtn').disabled = true;
    const label = $('addTracksBtn').querySelector('span'); label.textContent = '正在添加…';
    let added = 0, skipped = 0, firstId = null, allSaved = true;
    try {
      for (let i = 0; i < candidates.length; i++) {
        const file = candidates[i];
        if (state.tracks.length >= 100) { skipped += candidates.length - i; break; }
        if (file.size > 200 * 1024 * 1024 || !file.size) { skipped++; continue; }
        const fingerprint = `${file.name}|${file.size}|${file.lastModified}`;
        if (state.tracks.some(t => t.fingerprint === fingerprint)) { skipped++; continue; }
        label.textContent = `正在添加 ${i + 1} / ${candidates.length}`;
        const duration = await fileDuration(file);
        const id = globalThis.crypto?.randomUUID ? crypto.randomUUID() : `track-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const track = { id, ...namesFromFile(file), duration, blob: file, fileName: file.name,
          fingerprint, isDemo: false, liked: false, lrcText: '', addedAt: Date.now() + i };
        state.tracks.push(track); if (!firstId) firstId = id; added++;
        const saved = await saveTrack(track); if (!saved) allSaved = false;
        renderPlaylist();
      }
      if (added) {
        state.filterLiked = false;
        const wasPlaying = !audio.paused;
        const firstIndex = state.tracks.findIndex(t => t.id === firstId);
        selectTrack(firstIndex, wasPlaying);
        toast(`已添加 ${added} 首歌曲${skipped ? `，跳过 ${skipped} 个重复、过大或超出数量限制的文件` : ''}${allSaved ? '' : ' · 新增内容暂未完整保存'}`, '', null, skipped || !allSaved ? 6500 : 3700);
      } else toast('没有新增歌曲：可能已经添加，或文件超过 200 MB / 歌单已达 100 首。', '', null, 5500);
    } catch (error) { toast('部分歌曲未能添加，请检查文件后重试。'); console.warn('[PORTRAIT FM] Import interrupted:', error?.name); }
    finally {
      state.importing = false; $('addTracksBtn').disabled = false; label.textContent = '添加本地歌曲';
      $('audioInput').value = ''; renderPlaylist(); renderTrackMetadata(); savePrefs();
    }
  }

  // LRC supports multiple timestamps per line, offset metadata, and UTF-8 / GB18030 text files.
  function parseLyrics(text) {
    if (!text?.trim()) return [];
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const offsetMatch = text.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
    const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
    const timed = [], plain = [];
    for (const raw of lines) {
      const matches = [...raw.matchAll(/\[(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const clean = raw.replace(/\[[^\]]*\]/g, '').trim();
      if (!clean) continue;
      if (matches.length) {
        for (const m of matches) {
          const fraction = m[4] ? Number(`0.${m[4]}`) : 0;
          const time = (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]) + fraction - offset;
          timed.push({ time: Math.max(0, time), text: clean });
        }
      } else if (!/^\s*\[(ar|ti|al|by|re|ve|length|offset):/i.test(raw)) plain.push({ time: null, text: clean });
    }
    return timed.length ? timed.sort((a, b) => a.time - b.time) : plain;
  }
  function lyricElement(text, active, time = null) {
    const element = document.createElement(time === null ? 'span' : 'button');
    element.className = 'lyric-line' + (active ? ' active' : '');
    element.textContent = text || ' ';
    if (time !== null) { element.title = `跳到 ${formatTime(time)}`; element.onclick = () => { audio.currentTime = time; updateProgress(); }; }
    return element;
  }
  function updateLyrics() {
    const rows = state.lyrics;
    const target = $('lyricLines');
    if (!rows.length) {
      if (state.lyricIndex === -100) return;
      state.lyricIndex = -100; $('lyricLabel').textContent = '此刻 · 心绪';
      $('lyricHint').textContent = 'A LITTLE TIME, JUST FOR YOU.';
      target.replaceChildren(lyricElement('把世界的声音调小', false), lyricElement('把喜欢的旋律调大', true), lyricElement('留一点时间给自己', false));
      return;
    }
    if (rows[0].time === null) {
      if (state.lyricIndex === -101) return;
      state.lyricIndex = -101; $('lyricLabel').textContent = '歌词 · 文字'; $('lyricHint').textContent = '点上方标题编辑完整歌词';
      target.replaceChildren(...rows.slice(0, 3).map((row, i) => lyricElement(row.text, i === Math.min(1, rows.length - 1))));
      return;
    }
    let low = 0, high = rows.length - 1, active = -1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (rows[middle].time <= audio.currentTime + .035) { active = middle; low = middle + 1; }
      else high = middle - 1;
    }
    if (active === state.lyricIndex) return;
    state.lyricIndex = active; $('lyricLabel').textContent = '歌词 · 同步'; $('lyricHint').textContent = '点击歌词，可跳到那一句。';
    const prev = active > 0 ? rows[active - 1] : null;
    const now = active >= 0 ? rows[active] : { text: '前奏', time: null };
    const next = rows[active + 1] || null;
    target.replaceChildren(lyricElement(prev?.text || ' ', false, prev?.time ?? null), lyricElement(now.text, true, now.time), lyricElement(next?.text || ' ', false, next?.time ?? null));
  }
  async function readLyricsFile(file) {
    if (!file) return;
    if (file.size > 1024 * 1024) { toast('歌词文件过大，请选择小于 1 MB 的 LRC 或 TXT。'); return; }
    try {
      const buffer = await file.arrayBuffer(); let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
      catch (_) { text = new TextDecoder('gb18030').decode(buffer); }
      await assignLyrics(text);
    } catch (_) { toast('歌词读取失败，请将文件保存为 UTF-8 格式后重试。'); }
  }
  async function assignLyrics(text) {
    const track = currentTrack(); if (!track) return;
    track.lrcText = text.slice(0, 200000);
    const saved = await saveTrack(track);
    $('lrcEditor').value = track.lrcText;
    state.lyrics = parseLyrics(track.lrcText); state.lyricIndex = -99; updateLyrics();
    toast(text.trim() ? `歌词已添加到「${track.title}」${saved ? '' : ' · 当前页面可用'}` : '已清除当前歌曲的歌词');
  }

  function switchTab(tab) {
    state.currentTab = tab;
    for (const [name, panelId] of Object.entries({ music: 'panelMusic', look: 'panelLook', more: 'panelMore' })) {
      const selected = name === tab;
      $(panelId).hidden = !selected;
      const button = document.querySelector(`.drawer-tab[data-tab="${name}"]`);
      button.classList.toggle('is-active', selected); button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    }
    $('drawer').querySelector('.drawer-content').scrollTop = 0;
  }
  function openDrawer(tab = 'music', focusLyrics = false) {
    if (!state.drawerOpen) state.restoreFocus = document.activeElement;
    state.drawerOpen = true; $('drawerBackdrop').hidden = false; $('drawer').hidden = false;
    stage.inert = true;
    switchTab(tab); renderPlaylist();
    requestAnimationFrame(() => {
      $('closeDrawer').focus({ preventScroll: true });
      if (focusLyrics) $('lrcTrackName').scrollIntoView({ block: 'center', behavior: mediaReduced.matches ? 'auto' : 'smooth' });
    });
  }
  function closeDrawer() {
    if (!state.drawerOpen) return;
    state.drawerOpen = false; $('drawer').hidden = true; $('drawerBackdrop').hidden = true; stage.inert = false;
    if (state.restoreFocus?.isConnected) state.restoreFocus.focus({ preventScroll: true });
  }
  function toggleImmersive(force) {
    const active = typeof force === 'boolean' ? force : !stage.classList.contains('immersive');
    stage.classList.toggle('immersive', active); $('exitImmersive').hidden = !active;
    $('immersiveBtn').setAttribute('aria-label', active ? '退出沉浸模式' : '进入沉浸模式');
    if (active) { $('exitImmersive').focus({ preventScroll: true }); toast('沉浸模式已开启 · 按 H 或右上角按钮退出'); }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else { toggleImmersive(); toast('此浏览器未开放网页全屏，已切换为沉浸模式。'); }
    } catch (_) { toast('浏览器未允许全屏，可尝试使用浏览器的 F11 全屏。'); }
  }
  function startTimer(minutes) {
    state.timerMinutes = minutes; state.timerEnd = minutes ? Date.now() + minutes * 60000 : 0; state.lastTimerSecond = -1;
    if (masterGain && audioContext) masterGain.gain.setTargetAtTime(1, audioContext.currentTime, .12);
    audio.volume = state.prefs.volume;
    $$('.timer-options button').forEach(button => button.classList.toggle('is-active', Number(button.dataset.minutes) === minutes && minutes > 0));
    updateTimer();
    toast(minutes ? `${minutes} 分钟后，音乐会缓缓暂停。` : '已关闭睡眠定时');
  }
  function updateTimer() {
    if (!state.timerEnd) { $('timerBadge').hidden = true; $('timerInfo').textContent = '尚未开启定时'; return; }
    const remaining = Math.max(0, (state.timerEnd - Date.now()) / 1000);
    const second = Math.ceil(remaining);
    if (second !== state.lastTimerSecond) {
      state.lastTimerSecond = second;
      $('timerBadge').hidden = false; $('timerBadge').querySelector('span').textContent = formatTime(second);
      $('timerInfo').textContent = `剩余 ${formatTime(second)}，到时自动暂停`;
    }
    if (remaining <= 5) {
      const value = remaining / 5;
      if (masterGain && audioContext) masterGain.gain.setTargetAtTime(value, audioContext.currentTime, .16);
      else audio.volume = state.prefs.volume * value;
    }
    if (remaining <= 0) {
      audio.pause(); state.timerEnd = 0; state.timerMinutes = 0;
      if (masterGain && audioContext) { masterGain.gain.cancelScheduledValues(audioContext.currentTime); masterGain.gain.value = 1; }
      audio.volume = state.prefs.volume; $('timerBadge').hidden = true; $('timerInfo').textContent = '定时已结束，音乐已暂停';
      $$('.timer-options button').forEach(button => button.classList.remove('is-active'));
      toast('音乐已经暂停，愿你有一段安静的时光。', '', null, 5500);
    }
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator) || !('MediaMetadata' in window) || !currentTrack()) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: currentTrack().title, artist: currentTrack().artist,
        album: '花间 · 私人音乐空间', artwork: [{ src: state.images.cover }] });
    } catch (_) { /* Media Session is optional. */ }
  }
  function installMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const actions = {
      play: playAudio, pause: () => audio.pause(), previoustrack: () => nextTrack(-1), nexttrack: () => nextTrack(1),
      seekbackward: event => seekBy(-(event.seekOffset || 5)), seekforward: event => seekBy(event.seekOffset || 5),
      seekto: event => { if (Number.isFinite(event.seekTime) && Number.isFinite(audio.duration)) { audio.currentTime = clamp(event.seekTime, 0, audio.duration); updateProgress(); } }
    };
    for (const [action, handler] of Object.entries(actions)) { try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {} }
  }

  // Draw frequency bars from the real audio signal. No fabricated playback animation.
  const dustCanvas = $('dustCanvas'), spectrumCanvas = $('spectrumCanvas');
  const dustCtx = dustCanvas.getContext('2d'), spectrumCtx = spectrumCanvas.getContext('2d');
  let dustSize = { width: 0, height: 0 }, spectrumSize = { width: 0, height: 0 };
  let lastFrame = 0;
  const particles = Array.from({ length: 35 }, (_, index) => ({
    x: .40 + Math.random() * .62, y: Math.random(), radius: .5 + Math.random() * 1.2,
    speed: .003 + Math.random() * .009, phase: index * .74, opacity: .1 + Math.random() * .24
  }));
  function resizeCanvas(canvas, context) {
    const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr));
    context?.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height };
  }
  function resizeVisuals() {
    dustSize = resizeCanvas(dustCanvas, dustCtx); spectrumSize = resizeCanvas(spectrumCanvas, spectrumCtx); fitHeadline();
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden || now - lastFrame < 40) return;
    const delta = Math.min(.1, (now - lastFrame) / 1000); lastFrame = now;
    if (dustCtx && state.prefs.motion && !mediaReduced.matches) {
      const { width: w, height: h } = dustSize;
      dustCtx.clearRect(0, 0, w, h);
      for (const particle of particles) {
        particle.y -= particle.speed * delta; if (particle.y < -.01) particle.y = 1.01;
        const x = particle.x * w + Math.sin(now / 7400 + particle.phase) * 11;
        const y = particle.y * h;
        dustCtx.beginPath(); dustCtx.arc(x, y, particle.radius, 0, Math.PI * 2);
        dustCtx.fillStyle = `rgba(255,247,216,${particle.opacity * (.6 + .4 * Math.sin(now / 2300 + particle.phase))})`; dustCtx.fill();
      }
    }
    if (spectrumCtx && spectrumSize.width > 0 && state.prefs.spectrum) {
      const { width: w, height: h } = spectrumSize;
      spectrumCtx.clearRect(0, 0, w, h);
      const active = analyser && fftData && !audio.paused && !audio.ended;
      if (active) analyser.getByteFrequencyData(fftData);
      const count = 48, gap = w / count, barWidth = Math.max(1, gap * .34);
      for (let i = 0; i < count; i++) {
        let amplitude = 0;
        if (active) {
          const frequency = 70 * Math.pow(105, i / (count - 1));
          const bin = Math.min(fftData.length - 1, Math.max(1, Math.round(frequency / (audioContext.sampleRate / analyser.fftSize))));
          amplitude = (fftData[bin] + fftData[Math.max(0, bin - 1)]) / 510;
        }
        const barHeight = 1.3 + Math.pow(amplitude, 1.7) * Math.max(0, h - 3);
        spectrumCtx.fillStyle = `rgba(255,250,231,${.28 + amplitude * .62})`;
        spectrumCtx.fillRect(i * gap + (gap - barWidth) / 2, h - barHeight, barWidth, barHeight);
      }
    }
  }

  // Export is deliberately a deterministic canvas composition, not a screenshot library.
  function drawImageCover(ctx, image, x, y, width, height, posX = 50, posY = 50, zoom = 1) {
    const ratio = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
    const dw = image.naturalWidth * ratio, dh = image.naturalHeight * ratio;
    ctx.drawImage(image, x - (dw - width) * posX / 100, y - (dh - height) * posY / 100, dw, dh);
  }
  function ellipsis(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let result = text;
    while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
    return `${result}…`;
  }
  async function exportPoster() {
    const button = $('exportPosterBtn'); button.disabled = true;
    try {
      const [background, cover] = await Promise.all([decodeImage(state.images.background), decodeImage(state.images.cover)]);
      const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900;
      const ctx = canvas.getContext('2d');
      const p = state.prefs;
      const colors = p.theme === 'dark' ? { paper: [23,31,27], ink: '#e9ebe2', muted: '#98a395', accent: '#d5af8b' }
        : p.theme === 'warm' ? { paper: [244,229,211], ink: '#5b4134', muted: '#a4937f', accent: '#b56f4b' }
        : { paper: [240,239,232], ink: '#303a33', muted: '#8d9389', accent: '#bd8763' };
      const rgb = colors.paper.join(','); ctx.fillStyle = `rgb(${rgb})`; ctx.fillRect(0, 0, 1600, 900);
      ctx.save(); ctx.beginPath(); ctx.rect(530, 0, 1070, 900); ctx.clip();
      ctx.filter = `brightness(${p.brightness}%) blur(${p.blur}px)`;
      drawImageCover(ctx, background, 530, 0, 1070, 900, p.bgX, p.bgY, p.bgZoom / 100 + .04); ctx.restore();
      const gradient = ctx.createLinearGradient(0, 0, 1260, 0);
      [[0,1],[.38,1],[.48,.97],[.58,.8],[.7,.3],[.88,0]].forEach(([stop, opacity]) => gradient.addColorStop(stop, `rgba(${rgb},${opacity})`));
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1600, 900);
      ctx.fillStyle = colors.ink; ctx.font = '14px "Microsoft YaHei", sans-serif'; ctx.fillText('花间  /  PORTRAIT FM', 84, 54);
      ctx.fillStyle = colors.muted; ctx.font = '9px Arial, sans-serif'; ctx.fillText('THE PERSONAL COLLECTION — VOL. 01', 84, 124);
      ctx.font = '126px Georgia, "Songti SC", "Noto Serif CJK SC", serif'; ctx.fillStyle = colors.accent;
      ctx.fillText(p.title || 'FASHION', 77, 248, 584);
      ctx.font = '24px Georgia, "Songti SC", serif'; ctx.fillText(p.subtitle || 'SELF-PORTRAIT', 84, 289, 575);
      ctx.font = '13px "Microsoft YaHei", sans-serif'; ctx.fillStyle = colors.muted; ctx.fillText(p.tagline, 85, 322, 565);
      const cx = 392, cy = 508, radius = 143;
      ctx.save(); ctx.shadowColor = '#182b184a'; ctx.shadowBlur = 27; ctx.shadowOffsetY = 13;
      ctx.fillStyle = '#111711'; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      for (let r = 113; r < radius; r += 2.4) { ctx.strokeStyle = '#53604438'; ctx.lineWidth = .7; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.strokeStyle = colors.accent + '48'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, radius + 10, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, 108, 0, Math.PI * 2); ctx.clip(); drawImageCover(ctx, cover, cx - 108, cy - 108, 216, 216, p.coverX, p.coverY); ctx.restore();
      ctx.fillStyle = '#c1bcaa'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
      if (p.lyrics) {
        ctx.font = '11px "Microsoft YaHei", sans-serif';
        const lyricRows = state.lyrics.length ? state.lyrics.slice(Math.max(0, state.lyricIndex - 1), Math.max(0, state.lyricIndex - 1) + 3).map(r => r.text) : ['把世界的声音调小', '把喜欢的旋律调大', '留一点时间给自己'];
        lyricRows.forEach((text, i) => { ctx.fillStyle = i === 1 ? colors.ink : colors.muted; ctx.fillText(ellipsis(ctx, text, 153), 84, 475 + i * 28); });
      }
      ctx.fillStyle = colors.muted; ctx.font = '8px Arial, sans-serif'; ctx.fillText('SIDE A    /    YOUR OWN SOUNDTRACK', cx - 99, 683);
      ctx.fillStyle = colors.ink; ctx.font = '24px "Microsoft YaHei", sans-serif'; ctx.fillText(ellipsis(ctx, currentTrack().title, 530), 84, 729);
      ctx.fillStyle = colors.muted; ctx.font = '11px "Microsoft YaHei", sans-serif'; ctx.fillText(ellipsis(ctx, currentTrack().artist, 530), 85, 754);
      ctx.fillStyle = colors.muted + '45'; ctx.fillRect(85, 783, 550, 1);
      const d = Number.isFinite(audio.duration) ? audio.duration : currentTrack().duration || 1;
      const progress = clamp(audio.currentTime / d, 0, 1);
      ctx.fillStyle = colors.ink; ctx.fillRect(85, 783, 550 * progress, 1);
      ctx.beginPath(); ctx.arc(85 + 550 * progress, 783.5, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = '9px Arial, sans-serif'; ctx.fillStyle = colors.muted; ctx.fillText(formatTime(audio.currentTime), 85, 802); ctx.fillText(formatTime(d), 608, 802);
      ctx.fillStyle = '#fff9ec'; ctx.font = '31px "Songti SC", "Noto Serif CJK SC", SimSun, serif';
      ctx.shadowColor = '#0004'; ctx.shadowBlur = 10; ctx.fillText('此刻，', 1193, 644); ctx.fillText('世界为你慢半拍。', 1193, 694);
      ctx.shadowBlur = 0; ctx.font = '9px Arial, sans-serif'; ctx.fillStyle = '#fff9ecad'; ctx.fillText('YOUR PICTURE. YOUR SOUND.', 1196, 737);
      ctx.fillStyle = colors.muted; ctx.font = '10px "Microsoft YaHei", sans-serif'; ctx.fillText('一人，一曲，一整个自己的世界。', 85, 862);
      ctx.font = '8px Arial, sans-serif'; ctx.fillStyle = '#fff9ecb0'; ctx.fillText('SLOW DOWN. TUNE IN.', 1407, 862);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('海报生成失败');
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `花间-${currentTrack().title.replace(/[<>:"/\\|?*]/g, '').slice(0, 48)}.png`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast('16:9 海报已生成。');
    } catch (error) { toast('海报暂时未能生成，请重新选择图片后再试。'); console.warn('[PORTRAIT FM] Poster export:', error?.name); }
    finally { button.disabled = false; }
  }

  function bindEvents() {
    for (const id of ['playBtn', 'miniPlayBtn', 'vinylButton']) $(id).addEventListener('click', togglePlay);
    $('prevBtn').onclick = () => nextTrack(-1); $('nextBtn').onclick = () => nextTrack(1);
    $('shuffleBtn').onclick = () => { state.prefs.shuffle = !state.prefs.shuffle; state.history = []; applyPrefs(false); savePrefs(); toast(state.prefs.shuffle ? '随机播放已开启' : '已切回歌单顺序'); };
    $('repeatBtn').onclick = () => { const values = ['all', 'one', 'none']; state.prefs.repeat = values[(values.indexOf(state.prefs.repeat) + 1) % values.length]; state.history = []; applyPrefs(false); savePrefs(); toast({ all: '列表循环', one: '单曲循环', none: '歌单播完后停止' }[state.prefs.repeat]); };
    $('likeBtn').onclick = () => { const track = currentTrack(); track.liked = !track.liked; saveTrack(track); renderTrackMetadata(); renderPlaylist(); };
    $('favoriteFilter').onclick = () => { state.filterLiked = !state.filterLiked; renderPlaylist(); };
    $('muteBtn').onclick = toggleMute; $('volume').oninput = e => setVolume(Number(e.target.value) / 100);
    const seek = $('seek');
    seek.addEventListener('pointerdown', () => { state.seeking = true; });
    seek.addEventListener('input', () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : currentTrack()?.duration || 0;
      const value = Number(seek.value) / 1000; seek.style.setProperty('--progress', `${value * 100}%`);
      $('currentTime').textContent = formatTime(value * duration);
      if (Number.isFinite(audio.duration)) audio.currentTime = value * audio.duration;
      updateLyrics();
    });
    seek.addEventListener('change', () => { state.seeking = false; updateProgress(); });
    seek.addEventListener('pointercancel', () => { state.seeking = false; });
    window.addEventListener('pointerup', () => { if (state.seeking) { state.seeking = false; updateProgress(); } });
    audio.addEventListener('play', updatePlayUI); audio.addEventListener('pause', () => { updatePlayUI(); savePrefs(); });
    audio.addEventListener('playing', () => { stage.classList.remove('is-loading'); updatePlayUI(); });
    audio.addEventListener('waiting', () => { if (!audio.paused) stage.classList.add('is-loading'); });
    audio.addEventListener('canplay', () => stage.classList.remove('is-loading'));
    audio.addEventListener('timeupdate', updateProgress); audio.addEventListener('seeked', updateProgress);
    audio.addEventListener('loadedmetadata', () => {
      const track = currentTrack();
      if (track && Number.isFinite(audio.duration)) {
        const changed = Math.abs((track.duration || 0) - audio.duration) > .2; track.duration = audio.duration;
        $('duration').textContent = formatTime(audio.duration); if (changed) saveTrack(track); renderPlaylist();
      }
      updateProgress();
    });
    audio.addEventListener('ended', () => { updatePlayUI(); nextTrack(1, false); });
    audio.addEventListener('error', () => {
      stage.classList.remove('is-loading');
      if (audio.src && state.loaded) toast('当前音频无法解码，请尝试 MP3 或 WAV 格式。', '', null, 5500);
      updatePlayUI();
    });
    $('playlistBtn').onclick = () => openDrawer('music'); $('customizeBtn').onclick = () => openDrawer('look');
    $('photoQuickBtn').onclick = () => openDrawer('look'); $('helpBtn').onclick = () => openDrawer('more');
    $('lyricsOpen').onclick = () => openDrawer('more', true); $('timerBadge').onclick = () => openDrawer('more');
    $('closeDrawer').onclick = closeDrawer; $('drawerBackdrop').onclick = closeDrawer;
    $$('.drawer-tab').forEach(button => { button.onclick = () => switchTab(button.dataset.tab); button.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); const tabs = ['music', 'look', 'more']; const index = tabs.indexOf(state.currentTab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + 3) % 3;
      switchTab(tabs[next]); document.querySelector(`.drawer-tab[data-tab="${tabs[next]}"]`).focus();
    }; });
    $('uploadBothBtn').onclick = () => pickImage('both'); $('uploadBgBtn').onclick = () => pickImage('background'); $('uploadCoverBtn').onclick = () => pickImage('cover');
    $('recropBgBtn').onclick = () => recropExisting('background'); $('recropCoverBtn').onclick = () => recropExisting('cover');
    $('imageInput').onchange = event => handleImage(event.target.files?.[0], state.imageTarget);
    $('addTracksBtn').onclick = () => { $('audioInput').value = ''; $('audioInput').click(); };
    $('audioInput').onchange = event => addAudioFiles(event.target.files || []);
    $('importLrcBtn').onclick = () => { $('lrcInput').value = ''; $('lrcInput').click(); };
    $('lrcInput').onchange = event => readLyricsFile(event.target.files?.[0]);
    $('editLrcBtn').onclick = () => { $('lrcEditorWrap').hidden = !$('lrcEditorWrap').hidden; if (!$('lrcEditorWrap').hidden) $('lrcEditor').focus(); };
    $('saveLrcBtn').onclick = () => assignLyrics($('lrcEditor').value); $('clearLrcBtn').onclick = () => assignLyrics('');
    $$('.theme-option').forEach(button => { button.onclick = () => { state.prefs.theme = button.dataset.theme; applyPrefs(false); savePrefs(); }; });
    $('themeToggle').onclick = () => { state.prefs.theme = state.prefs.theme === 'dark' ? 'light' : 'dark'; applyPrefs(false); savePrefs(); };
    $$('[data-setting]').forEach(input => { input.oninput = () => {
      const key = input.dataset.setting; state.prefs[key] = Number(input.value);
      $(`${key}Out`).textContent = key === 'blur' ? input.value : `${input.value}%`; applyPrefs(false); savePrefs();
    }; });
    for (const [inputId, key] of [['titleInput', 'title'], ['subtitleInput', 'subtitle'], ['taglineInput', 'tagline']]) {
      $(inputId).oninput = () => { state.prefs[key] = $(inputId).value; applyPrefs(false); savePrefs(); };
    }
    for (const [id, key] of [['spectrumToggle', 'spectrum'], ['motionToggle', 'motion'], ['lyricsToggle', 'lyrics']]) {
      $(id).onchange = () => { state.prefs[key] = $(id).checked; applyPrefs(false); resizeVisuals(); savePrefs(); };
    }
    $('playbackRate').onchange = event => { state.prefs.playbackRate = Number(event.target.value); audio.playbackRate = state.prefs.playbackRate; savePrefs(); };
    $('resetLookBtn').onclick = async () => {
      if (!window.confirm('恢复默认背景、唱片封面、标题和主题？你的歌曲与歌词会保留。')) return;
      ++metadataGeneration;
      for (const key of ['theme','title','subtitle','tagline','bgX','bgY','bgZoom','brightness','blur','coverX','coverY']) state.prefs[key] = DEFAULT_PREFS[key];
      state.images = { ...DEFAULT_IMAGES }; applyImages(); applyPrefs(); savePrefs(); await saveImages(); toast('已恢复初始外观，歌单保持不变。');
    };
    $('fullscreenBtn').onclick = toggleFullscreen; $('immersiveBtn').onclick = () => toggleImmersive(); $('exitImmersive').onclick = () => toggleImmersive(false);
    document.addEventListener('fullscreenchange', () => { const active = !!document.fullscreenElement; setIcon($('fullscreenBtn'), active ? 'exitfull' : 'full'); $('fullscreenBtn').setAttribute('aria-label', active ? '退出全屏' : '进入全屏'); setTimeout(resizeVisuals, 100); });
    $$('.timer-options button').forEach(button => { button.onclick = () => startTimer(Number(button.dataset.minutes)); });
    $('exportPosterBtn').onclick = exportPoster;
    bindCropperEvents();
    $('brandHome').onclick = event => { event.preventDefault(); toast('花间 · 你的私人音乐空间', '添加歌曲', () => openDrawer('music')); };
    document.addEventListener('keydown', event => {
      if (cropperState) { handleCropKeys(event); return; }
      if (event.key === 'Escape') {
        if (cropperState) { closeCropper(null); return; }
        if (state.drawerOpen) closeDrawer(); else if (stage.classList.contains('immersive')) toggleImmersive(false);
        $('dropOverlay').hidden = true; return;
      }
      if (state.drawerOpen && event.key === 'Tab') {
        const focusables = $$('button:not(:disabled),a[href],input:not([type=hidden]),select,textarea,summary,[tabindex="0"]', $('drawer'))
          .filter(el => !el.closest('[hidden]') && el.getClientRects().length && el.tabIndex >= 0);
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      if (cropperState) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === ' ' && event.target.closest('button,a,summary')) return;
      const key = event.key.toLowerCase();
      const handlers = {
        ' ': togglePlay, arrowleft: () => seekBy(-5), arrowright: () => seekBy(5),
        arrowup: () => { setVolume(state.prefs.volume + .05); toast(`音量 ${Math.round(state.prefs.volume * 100)}%`, '', null, 1000); },
        arrowdown: () => { setVolume(state.prefs.volume - .05); toast(`音量 ${Math.round(state.prefs.volume * 100)}%`, '', null, 1000); },
        m: toggleMute, n: () => nextTrack(1), p: () => nextTrack(-1), f: toggleFullscreen,
        h: () => { if (state.drawerOpen) closeDrawer(); toggleImmersive(); }, l: () => openDrawer('music'), e: () => openDrawer('look'), '?': () => openDrawer('more')
      };
      if (handlers[key]) { event.preventDefault(); handlers[key](); }
    });
    let dragDepth = 0;
    document.addEventListener('dragenter', event => {
      if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
      event.preventDefault(); dragDepth++; $('dropOverlay').hidden = false;
    });
    document.addEventListener('dragover', event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
    document.addEventListener('dragleave', event => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropOverlay').hidden = true; });
    document.addEventListener('drop', async event => {
      event.preventDefault(); dragDepth = 0; $('dropOverlay').hidden = true;
      const files = [...(event.dataTransfer?.files || [])]; if (!files.length) return;
      const image = files.find(file => file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|avif|gif|bmp)$/i.test(file.name));
      const tracks = files.filter(file => file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|webm|opus|aiff?)$/i.test(file.name));
      const lrc = files.find(file => /\.(lrc|txt)$/i.test(file.name));
      if (image) await handleImage(image, 'both');
      if (tracks.length) await addAudioFiles(tracks);
      if (lrc) await readLyricsFile(lrc);
      if (!image && !tracks.length && !lrc) toast('可拖入图片、音乐文件，或 LRC 歌词文件。');
    });
    window.addEventListener('blur', () => { dragDepth = 0; $('dropOverlay').hidden = true; });
    let pointerRaf = 0;
    stage.addEventListener('pointermove', event => {
      if (!state.prefs.motion || mediaReduced.matches || window.innerWidth < 901 || event.pointerType === 'touch') return;
      if (pointerRaf) return;
      pointerRaf = requestAnimationFrame(() => {
        stage.style.setProperty('--parallax-x', `${(event.clientX / innerWidth - .5) * -7}px`);
        stage.style.setProperty('--parallax-y', `${(event.clientY / innerHeight - .5) * -5}px`); pointerRaf = 0;
      });
    });
    window.addEventListener('resize', resizeVisuals);
    mediaReduced.addEventListener?.('change', () => { applyPrefs(false); resizeVisuals(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateTimer(); resizeVisuals(); } });
    window.addEventListener('pagehide', () => { savePrefs(true); });
    setInterval(updateTimer, 250);
  }
  function validatePrefs(saved) {
    const p = { ...DEFAULT_PREFS, ...(saved || {}) };
    if (!['light','dark','warm'].includes(p.theme)) p.theme = 'light';
    if (!['all','one','none'].includes(p.repeat)) p.repeat = 'all';
    for (const key of ['bgX','bgY','coverX','coverY']) p[key] = clamp(p[key], 0, 100);
    p.bgZoom = clamp(p.bgZoom, 100, 160); p.brightness = clamp(p.brightness, 45, 130); p.blur = clamp(p.blur, 0, 14); p.volume = clamp(p.volume, 0, 1);
    p.playbackRate = [.75,1,1.25,1.5,2].includes(p.playbackRate) ? p.playbackRate : 1;
    for (const key of ['muted','shuffle','spectrum','motion','lyrics']) p[key] = !!p[key];
    p.title = String(p.title ?? DEFAULT_PREFS.title).slice(0, 20); p.subtitle = String(p.subtitle ?? DEFAULT_PREFS.subtitle).slice(0, 48); p.tagline = String(p.tagline ?? DEFAULT_PREFS.tagline).slice(0, 56);
    return p;
  }
  async function init() {
    applyPrefs(); applyImages(true); renderTrackMetadata(); renderPlaylist(); updatePlayUI();
    bindEvents(); installMediaSession(); resizeVisuals(); requestAnimationFrame(frame);
    try {
      state.db = await openDatabase(); state.persistent = true;
      state.db.onversionchange = () => { state.db.close(); state.db = null; state.persistent = false; updateStorageStatus(); };
      const [prefs, images, tracks] = await Promise.all([
        dbTask('prefs','readonly', store => store.get('settings')),
        dbTask('prefs','readonly', store => store.get('images')),
        dbTask('tracks','readonly', store => store.getAll())
      ]);
      state.prefs = validatePrefs(prefs);
      if (images?.background?.startsWith('data:image/')) state.images.background = images.background;
      if (images?.cover?.startsWith('data:image/')) state.images.cover = images.cover;
      if (images?.bgSource?.startsWith('data:image/')) state.images.bgSource = images.bgSource;
      if (images?.coverSource?.startsWith('data:image/')) state.images.coverSource = images.coverSource;
      state.images.bgCrop = sanitizeStoredCrop(images?.bgCrop);
      state.images.coverCrop = sanitizeStoredCrop(images?.coverCrop);
      const savedDemo = (tracks || []).find(t => t.id === 'demo-ambient');
      const locals = (tracks || []).filter(t => !t.isDemo && t.blob instanceof Blob && t.id && typeof t.title === 'string').sort((a,b) => a.addedAt - b.addedAt);
      state.tracks = [{ ...demoTrack(), ...(savedDemo || {}), isDemo: true }, ...locals].slice(0, 100);
      const index = state.tracks.findIndex(t => t.id === state.prefs.currentId);
      applyPrefs(); applyImages(true); selectTrack(index >= 0 ? index : 0, false);
    } catch (error) {
      state.persistent = false;
      console.info('[PORTRAIT FM] This session will not require persistent storage.');
    }
    state.loaded = true; updateStorageStatus(); resizeVisuals();
    document.fonts?.ready.then(resizeVisuals);
    document.documentElement.dataset.ready = 'true';
  }
  init().catch(error => { console.error('[PORTRAIT FM] Initialization failed:', error); toast('本地设置未能恢复；刷新后可重新选择音乐。'); document.documentElement.dataset.ready = 'error'; });
})();
