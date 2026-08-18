const POSTS_KEY = 'btvNewsPosts';
const CURRENT_USER_KEY = 'btvNewsCurrentUser';
// Title and Description maximum character limits
const TITLE_MAX_LENGTH = 150;
const DESCRIPTION_MAX_LENGTH = 600;
const BTV_LOGO_PATH = 'assets/btv-logo.png';

// =====================================================
// BTV IMAGE STORAGE
// IndexedDB database for large image data.
// Stores images separately from localStorage to avoid quota issues.
// =====================================================
const BTV_DB_NAME = 'BTVNewsDB';
const BTV_DB_VERSION = 1;
const BTV_IMAGES_STORE = 'images';

let btvDB = null;

// ==========================================
// BTV IMAGE STORAGE
// Stores large image data outside localStorage.
// ==========================================
function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl);
  if (!match) {
    return null;
  }

  const mimeType = match[1];
  const encoded = match[2];
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    if (!blob) {
      resolve('');
      return;
    }

    if (typeof blob === 'string') {
      resolve(blob);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}

async function initBTVDatabase() {
  if (btvDB) return btvDB;
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BTV_DB_NAME, BTV_DB_VERSION);
    
    request.onerror = () => {
      console.error('Failed to open IndexedDB:', request.error);
      resolve(null);
    };
    
    request.onsuccess = () => {
      btvDB = request.result;
      resolve(btvDB);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(BTV_IMAGES_STORE)) {
        db.createObjectStore(BTV_IMAGES_STORE);
      }
    };
  });
}

async function saveImageToIndexedDB(imageId, imageData) {
  const db = await initBTVDatabase();
  if (!db || !imageId || !imageData) return false;
  
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([BTV_IMAGES_STORE], 'readwrite');
      const store = transaction.objectStore(BTV_IMAGES_STORE);
      const imageBlob = imageData instanceof Blob ? imageData : dataUrlToBlob(imageData);
      if (!imageBlob) {
        resolve(false);
        return;
      }
      store.put(imageBlob, imageId);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
    } catch (error) {
      console.error('Failed to save image to IndexedDB:', error);
      resolve(false);
    }
  });
}

async function getImageFromIndexedDB(imageId) {
  const db = await initBTVDatabase();
  if (!db || !imageId) return null;
  
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([BTV_IMAGES_STORE], 'readonly');
      const store = transaction.objectStore(BTV_IMAGES_STORE);
      const request = store.get(imageId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch (error) {
      console.error('Failed to get image from IndexedDB:', error);
      resolve(null);
    }
  });
}

async function deleteImageFromIndexedDB(imageId) {
  const db = await initBTVDatabase();
  if (!db) return false;
  
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([BTV_IMAGES_STORE], 'readwrite');
      const store = transaction.objectStore(BTV_IMAGES_STORE);
      store.delete(imageId);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
    } catch (error) {
      console.error('Failed to delete image from IndexedDB:', error);
      resolve(false);
    }
  });
}

// =====================================================
// BTV LOGO ASSET LOADER
// Robustly loads the local BTV logo image asset.
// Ensures logo is fully loaded with valid dimensions before Canvas rendering.
// =====================================================
let cachedBtvLogo = null;

function createUntaintedImage(src, label = 'image') {
  if (!src) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const image = new Image();
    // Do NOT set crossOrigin (causes taint on local/data URLs)
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve(image);
      } else {
        reject(new Error(`Image ${label} loaded with zero dimensions`));
      }
    };
    image.onerror = (err) => {
      console.warn(`Untainted image load failed for ${label}`);
      reject(new Error(`Failed to load ${label}`));
    };
    image.src = src;
  });
}

function getBtvLogoSize(baseSize = 72) {
  const logo = cachedBtvLogo || state.btvLogoImage;
  if (!logo || !logo.naturalWidth || !logo.naturalHeight) {
    return { width: baseSize, height: baseSize };
  }

  const aspectRatio = logo.naturalWidth / logo.naturalHeight;
  const width = baseSize;
  const height = width / aspectRatio;
  return { width, height };
}

function getImageLogoSize(image, baseSize = 72) {
  if (!image || !image.naturalWidth || !image.naturalHeight) {
    return { width: baseSize, height: baseSize };
  }

  const aspectRatio = image.naturalWidth / image.naturalHeight;
  const width = baseSize;
  const height = width / aspectRatio;
  return { width, height };
}

async function loadBtvLogo() {
  if (cachedBtvLogo && cachedBtvLogo.complete && cachedBtvLogo.naturalWidth > 0) {
    return cachedBtvLogo;
  }

  // Priority 1: Use in-memory Base64 Data URL (Guaranteed zero canvas taint in any browser)
  if (typeof window !== 'undefined' && window.BTV_LOGO_DATA_URL) {
    try {
      const logo = await createUntaintedImage(window.BTV_LOGO_DATA_URL, 'BTV Logo DataURL');
      if (logo && logo.naturalWidth > 0) {
        cachedBtvLogo = logo;
        state.btvLogoImage = logo;
        console.log('BTV logo loaded via in-memory DataURL:', logo.naturalWidth, 'x', logo.naturalHeight);
        return logo;
      }
    } catch (e) {
      console.warn('Failed to load window.BTV_LOGO_DATA_URL:', e);
    }
  }

  // Priority 2: Candidate local asset paths
  const candidateSources = [
    BTV_LOGO_PATH,
    './assets/btv-logo.png',
    '../assets/btv-logo.png',
    '/assets/btv-logo.png',
    '/project/assets/btv-logo.png'
  ];

  for (const src of candidateSources) {
    try {
      const logo = await createUntaintedImage(src, 'BTV Logo local path');
      if (logo && logo.naturalWidth > 0) {
        cachedBtvLogo = logo;
        state.btvLogoImage = logo;
        console.log('BTV logo loaded from path:', src);
        return logo;
      }
    } catch (e) {
      // try next candidate
    }
  }

  console.error('All BTV logo sources failed to load');
  return null;
}

const THEMES = {
  'royal-red': { titleColor: '#F3C74A', highlightColor: '#A10D1F', textColor: '#F5F1F3', accentColor: '#3F0A19' },
  'deep-blue': { titleColor: '#F3C74A', highlightColor: '#8B0F22', textColor: '#F5F1F3', accentColor: '#3F0A19' },
  nature: { titleColor: '#F3C74A', highlightColor: '#A10D1F', textColor: '#F5F1F3', accentColor: '#2E0F1B' },
  summer: { titleColor: '#F3C74A', highlightColor: '#B5122A', textColor: '#F5F1F3', accentColor: '#5C0F21' },
  purple: { titleColor: '#F3C74A', highlightColor: '#8B0F22', textColor: '#F5F1F3', accentColor: '#3F0A19' },
  pastel: { titleColor: '#F3C74A', highlightColor: '#A10D1F', textColor: '#F5F1F3', accentColor: '#48141E' },
  gold: { titleColor: '#F7D266', highlightColor: '#8B0F22', textColor: '#F5F1F3', accentColor: '#3F0A19' },
  dark: { titleColor: '#F7D266', highlightColor: '#A10D1F', textColor: '#F5F1F3', accentColor: '#1F0B12' },
  cyan: { titleColor: '#F3C74A', highlightColor: '#A10D1F', textColor: '#F5F1F3', accentColor: '#2B0E1B' }
};

// ==========================================
// BTV CARD STATE
// Stores all data used by Preview and Export.
// ==========================================
const state = {
  title: 'Breaking update from the newsroom',
  description: 'Your headline and description will appear here as the final published story.',
  // Title font selection (default English / Roboto)
  titleFont: 'Roboto',
  // Description font selection (default English / Roboto)
  descriptionFont: 'Roboto',
  titleSize: 54,
  descriptionSize: 30,
  gap: 24,
  autoFit: true,
  titleColor: '#F3C74A',
  highlightColor: '#A10D1F',
  textColor: '#F5F1F3',
  accentColor: '#3F0A19',
  imageData: '',
  newsImage: null,
  btvLogoImage: null,
  reporterName: '',
  designation: '',
  reporterDesignation: '',
  crop: { zoom: 1, x: 50, y: 50 },
  previewDate: new Date().toISOString(),
  publishedUrl: '',
  renderedCanvas: null
};

const elements = {};

// =====================================================
// USER SESSION
// Reads the active dashboard user from localStorage.
// =====================================================
function getCurrentUser() {
  try {
    const value = localStorage.getItem(CURRENT_USER_KEY);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
}

function ensureAuthenticated() {
  if (!getCurrentUser()) {
    window.location.href = 'index.html';
    return false;
  }

  return true;
}

// =====================================================
// PUBLISH STORAGE
// Saves metadata and image data without exceeding localStorage quota.
// =====================================================
function getPosts() {
  try {
    const raw = localStorage.getItem(POSTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function sanitizePostForStorage(post = {}) {
  const metadata = { ...post };
  delete metadata.imageData;
  delete metadata.sourceImage;
  delete metadata.publishedImage;

  if (post.id && !metadata.imageId) {
    metadata.imageId = `${post.id}_source`;
  }

  if (post.id && !metadata.publishedImageId) {
    metadata.publishedImageId = `${post.id}_published`;
  }

  return metadata;
}

function savePosts(posts) {
  const metadataPosts = posts.map((post) => sanitizePostForStorage(post));

  try {
    localStorage.setItem(POSTS_KEY, JSON.stringify(metadataPosts));
  } catch (error) {
    console.error('Failed to save posts to localStorage:', error);
    throw new Error('Unable to save posts. Storage quota may be exceeded.');
  }
}

async function savePostWithImages(post) {
  if (!post || !post.id) {
    return;
  }

  const sourceImageId = `${post.id}_source`;
  const publishedImageId = `${post.id}_published`;

  if (post.imageData) {
    await saveImageToIndexedDB(sourceImageId, post.imageData);
  }

  if (post.publishedImage) {
    await saveImageToIndexedDB(publishedImageId, post.publishedImage);
  }

  const posts = getPosts();
  const nextPost = {
    ...post,
    imageId: sourceImageId,
    publishedImageId
  };

  delete nextPost.imageData;
  delete nextPost.sourceImage;
  delete nextPost.publishedImage;

  const index = posts.findIndex((item) => item.id === post.id);
  const updatedPosts = [...posts];

  if (index >= 0) {
    updatedPosts[index] = sanitizePostForStorage(nextPost);
  } else {
    updatedPosts.unshift(sanitizePostForStorage(nextPost));
  }

  savePosts(updatedPosts);
}

async function loadPostWithImages(post) {
  if (!post || !post.id) {
    return post;
  }

  const sourceImageId = post.imageId || `${post.id}_source`;
  const publishedImageId = post.publishedImageId || `${post.id}_published`;

  if (sourceImageId) {
    const sourceImage = await getImageFromIndexedDB(sourceImageId);
    if (sourceImage) {
      post.imageData = await blobToDataUrl(sourceImage);
    }
  }

  if (publishedImageId) {
    const publishedImage = await getImageFromIndexedDB(publishedImageId);
    if (publishedImage) {
      post.publishedImage = await blobToDataUrl(publishedImage);
    }
  }

  return post;
}

const TELUGU_MONTHS = [
  'జనవరి',
  'ఫిబ్రవరి',
  'మార్చి',
  'ఏప్రిల్',
  'మే',
  'జూన్',
  'జూలై',
  'ఆగస్టు',
  'సెప్టెంబర్',
  'అక్టోబర్',
  'నవంబర్',
  'డిసెంబర్'
];

function formatTeluguDate(dateValue) {
  let d = dateValue ? new Date(dateValue) : new Date();
  if (isNaN(d.getTime())) {
    d = new Date();
  }
  const day = d.getDate();
  const month = TELUGU_MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month}, ${year}`;
}

function todayLabel(dateValue) {
  return formatTeluguDate(dateValue);
}

function createId() {
  return `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function setStatus(message) {
  if (elements.copyStatus) {
    elements.copyStatus.textContent = message;
  }
}

function setDownloadButtonsState(enabled) {
  const buttons = [
    document.getElementById('downloadCardBtn'),
    document.getElementById('downloadPngBtn'),
    document.getElementById('downloadJpgBtn'),
    document.getElementById('downloadStoryBtn')
  ].filter(Boolean);

  buttons.forEach((button) => {
    button.disabled = !enabled;
    button.style.opacity = enabled ? '1' : '0.55';
    button.style.cursor = enabled ? 'pointer' : 'not-allowed';
  });
}

// =====================================================
// FORM DATA
// Keeps the live editor values and color inputs synced.
// =====================================================
function syncHexInputs() {
  elements.titleColorHex.value = state.titleColor;
  elements.highlightColorHex.value = state.highlightColor;
  elements.textColorHex.value = state.textColor;
  elements.accentColorHex.value = state.accentColor;

  elements.titleColorPicker.value = state.titleColor;
  elements.highlightColorPicker.value = state.highlightColor;
  elements.textColorPicker.value = state.textColor;
  elements.accentColorPicker.value = state.accentColor;
}

function syncDisplayValues() {
  if (elements.titleInput) {
    elements.titleInput.value = state.title || '';
    // Roboto font / Mandali font for title input box
    elements.titleInput.style.fontFamily = (state.titleFont === 'Mandali')
      ? '"Mandali", "Noto Sans Telugu", sans-serif'
      : '"Roboto", sans-serif';
  }
  if (elements.descriptionInput) {
    elements.descriptionInput.value = state.description || '';
    // Roboto font / Mandali font for description input box
    elements.descriptionInput.style.fontFamily = (state.descriptionFont === 'Mandali')
      ? '"Mandali", "Noto Sans Telugu", sans-serif'
      : '"Roboto", sans-serif';
  }

  // Title font selection
  const titleFont = state.titleFont || 'Roboto';
  document.querySelectorAll('[data-field="title"][data-font]').forEach((btn) => {
    const isSelected = btn.dataset.font === titleFont;
    btn.classList.toggle('active', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });

  // Description font selection
  const descriptionFont = state.descriptionFont || 'Roboto';
  document.querySelectorAll('[data-field="description"][data-font]').forEach((btn) => {
    const isSelected = btn.dataset.font === descriptionFont;
    btn.classList.toggle('active', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });

  if (elements.titleSizeValue) elements.titleSizeValue.textContent = `${state.titleSize}px`;
  if (elements.descriptionSizeValue) elements.descriptionSizeValue.textContent = `${state.descriptionSize}px`;
  if (elements.gapValue) elements.gapValue.textContent = `${state.gap}px`;
  if (elements.reporterNameInput) elements.reporterNameInput.value = state.reporterName || '';
  if (elements.reporterDesignationInput) elements.reporterDesignationInput.value = state.designation || state.reporterDesignation || '';
  if (elements.autoFitToggle) elements.autoFitToggle.checked = state.autoFit;
  if (elements.cropZoom) elements.cropZoom.value = state.crop.zoom;
  if (elements.cropX) elements.cropX.value = state.crop.x;
  if (elements.cropY) elements.cropY.value = state.crop.y;
  syncCharacterCounters();
  syncHexInputs();
}

// =====================================================
// TITLE VALIDATION
// =====================================================
function clampTitleInput(value) {
  return String(value || '').slice(0, TITLE_MAX_LENGTH);
}

// =====================================================
// DESCRIPTION VALIDATION
// =====================================================
function clampDescriptionInput(value) {
  return String(value || '').slice(0, DESCRIPTION_MAX_LENGTH);
}

function syncCharacterCounters() {
  if (!elements.titleCounter || !elements.descriptionCounter) return;
  elements.titleCounter.textContent = `${(state.title || '').length} / ${TITLE_MAX_LENGTH}`;
  elements.descriptionCounter.textContent = `${(state.description || '').length} / ${DESCRIPTION_MAX_LENGTH}`;
}

function validateTitle(titleValue) {
  const value = (titleValue || '').trim();
  if (!value) return 'Please enter a title.';
  if (value.length > TITLE_MAX_LENGTH) return 'Title cannot exceed 150 characters.';
  return '';
}

function validateDescription(descriptionValue) {
  const value = (descriptionValue || '').trim();
  if (!value) return 'Please enter a description.';
  if (value.length > DESCRIPTION_MAX_LENGTH) return 'Description cannot exceed 600 characters.';
  return '';
}

function validateFormData() {
  const titleError = validateTitle(state.title);
  if (titleError) {
    return titleError;
  }

  const descriptionError = validateDescription(state.description);
  if (descriptionError) {
    return descriptionError;
  }

  return '';
}

function updateStateFromInputs() {
  const nextTitle = clampTitleInput(elements.titleInput ? elements.titleInput.value : '');
  const nextDescription = clampDescriptionInput(elements.descriptionInput ? elements.descriptionInput.value : '');

  if (elements.titleInput && nextTitle !== elements.titleInput.value) {
    elements.titleInput.value = nextTitle;
  }

  if (elements.descriptionInput && nextDescription !== elements.descriptionInput.value) {
    elements.descriptionInput.value = nextDescription;
  }

  state.title = nextTitle.trim();
  state.description = nextDescription.trim();
  state.reporterName = elements.reporterNameInput ? elements.reporterNameInput.value.trim() : '';
  state.designation = elements.reporterDesignationInput ? elements.reporterDesignationInput.value.trim() : '';
  state.reporterDesignation = state.designation;
  state.autoFit = elements.autoFitToggle ? elements.autoFitToggle.checked : true;
  syncCharacterCounters();
}

function applyTheme(themeKey) {
  const theme = THEMES[themeKey] || THEMES['royal-red'];
  state.titleColor = theme.titleColor;
  state.highlightColor = theme.highlightColor;
  state.textColor = theme.textColor;
  state.accentColor = theme.accentColor;
  syncHexInputs();
  updatePreview();
}

// =====================================================
// FONT LOADER: ROBOTO & MANDALI
// // Roboto font
// // Mandali font
// Ensures Roboto and Mandali fonts are loaded and available before canvas drawing.
// =====================================================
async function ensureCardFontsLoaded() {
  try {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      await Promise.all([
        document.fonts.load('800 54px "Mandali"'),
        document.fonts.load('700 38px "Mandali"'),
        document.fonts.load('700 33px "Mandali"'),
        document.fonts.load('700 31px "Mandali"'),
        document.fonts.load('600 26px "Mandali"'),
        document.fonts.load('400 30px "Mandali"'),
        document.fonts.load('400 24px "Mandali"'),
        document.fonts.load('800 54px "Roboto"'),
        document.fonts.load('700 38px "Roboto"'),
        document.fonts.load('400 30px "Roboto"'),
        document.fonts.load('400 24px "Roboto"'),
        document.fonts.load('800 54px "Noto Sans Telugu"'),
        document.fonts.load('700 33px "Noto Sans Telugu"'),
        document.fonts.load('700 31px "Noto Sans Telugu"'),
        document.fonts.load('600 26px "Noto Sans Telugu"'),
        document.fonts.load('400 30px "Noto Sans Telugu"')
      ]);
      await document.fonts.ready;
    }
  } catch (err) {
    console.warn('Font load check notice:', err);
  }
}

// =====================================================
// FONT SELECTION HANDLERS
// // Title font selection
// // Description font selection
// // Roboto font
// // Mandali font
// =====================================================
function setupFontSelectionHandlers() {
  document.querySelectorAll('.font-btn[data-field]').forEach((button) => {
    button.addEventListener('click', () => {
      const field = button.dataset.field; // 'title' or 'description'
      const font = button.dataset.font;   // 'Roboto' or 'Mandali'

      if (field === 'title') {
        state.titleFont = font;
      } else if (field === 'description') {
        state.descriptionFont = font;
      }

      syncDisplayValues();
      // Applying selected fonts to live preview
      updatePreview();
    });
  });
}

// =====================================================
// 1. Reporter data storage
// Saves reporterName and designation to the logged-in reporter in localStorage.
// =====================================================
function saveReporterData(reporterName, designation) {
  const currentUser = getCurrentUser();
  const currentReporterId = currentUser ? (currentUser.reporterId || currentUser.username || '') : '';

  let users = [];
  try {
    users = JSON.parse(localStorage.getItem('btvNewsUsers') || '[]');
  } catch (e) {
    users = [];
  }

  let updated = false;
  users = users.map((user) => {
    const uId = user.reporterId || user.username || '';
    if (uId && currentReporterId && uId.toLowerCase() === currentReporterId.toLowerCase()) {
      user.reporterName = reporterName;
      user.designation = designation;
      updated = true;
    }
    return user;
  });

  if (!updated && currentReporterId) {
    users.push({
      reporterId: currentReporterId,
      reporterName: reporterName,
      designation: designation
    });
  }

  localStorage.setItem('btvNewsUsers', JSON.stringify(users));

  state.reporterName = reporterName;
  state.designation = designation;
  state.reporterDesignation = designation;
}

// =====================================================
// 2. Add/Update Reporter
// Listens for Add/Update and Remove Reporter buttons to persist data and update preview.
// =====================================================
function setupReporterHandlers() {
  const addBtn = document.getElementById('addReporterBtn');
  const removeBtn = document.getElementById('removeReporterBtn');
  const nameInput = document.getElementById('reporterNameInput');
  const designationInput = document.getElementById('reporterDesignationInput');

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const name = nameInput ? nameInput.value.trim() : '';
      const desig = designationInput ? designationInput.value.trim() : '';
      saveReporterData(name, desig);
      setStatus('Reporter details updated successfully.');
      updatePreview();
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      if (nameInput) nameInput.value = '';
      if (designationInput) designationInput.value = '';
      saveReporterData('', '');
      setStatus('Reporter details removed.');
      updatePreview();
    });
  }

  if (nameInput) {
    nameInput.addEventListener('input', () => {
      state.reporterName = nameInput.value.trim();
      updatePreview();
    });
  }

  if (designationInput) {
    designationInput.addEventListener('input', () => {
      state.designation = designationInput.value.trim();
      state.reporterDesignation = state.designation;
      updatePreview();
    });
  }
}

// =====================================================
// 3. Loading reporter data
// Automatically loads saved reporterName and designation from user profile on initialization.
// =====================================================
function loadSavedReporterData() {
  const currentUser = getCurrentUser();
  const currentReporterId = currentUser ? (currentUser.reporterId || currentUser.username || '') : '';
  let savedName = '';
  let savedDesignation = '';

  if (currentReporterId) {
    try {
      const users = JSON.parse(localStorage.getItem('btvNewsUsers') || '[]');
      const user = users.find(
        (u) => (u.reporterId && u.reporterId.toLowerCase() === currentReporterId.toLowerCase()) ||
               (u.username && u.username.toLowerCase() === currentReporterId.toLowerCase())
      );
      if (user) {
        savedName = user.reporterName || '';
        savedDesignation = user.designation || '';
        if (!savedName && (user.firstName || user.lastName)) {
          savedName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
        }
      }
    } catch (e) {
      console.warn('Error loading saved reporter details:', e);
    }
  }

  state.reporterName = savedName;
  state.designation = savedDesignation;
  state.reporterDesignation = savedDesignation;

  const nameInput = document.getElementById('reporterNameInput');
  const desigInput = document.getElementById('reporterDesignationInput');
  if (nameInput) nameInput.value = savedName;
  if (desigInput) desigInput.value = savedDesignation;
}

// =====================================================
// CARD RENDERING ENGINE (ROBOTO & MANDALI FONTS & DYNAMIC HEIGHT)
// - Uses selected font (Roboto / Mandali) independently for Title & Description
// - Calculates dynamic card height based on description & title length
// - Reduced image height (480px) to allocate more vertical space to text
// - Aspect ratio preserved with no distortion
// =====================================================
async function renderCard(props = {}) {
  const { width = 1080, targetCanvas = null, cardData = state } = props;
  await ensureCardFontsLoaded();

  const titleFont = cardData.titleFont || state.titleFont || 'Roboto';
  const descriptionFont = cardData.descriptionFont || state.descriptionFont || 'Roboto';

  // Title font selection
  // Roboto font
  // Mandali font
  const titleFontFamily = titleFont === 'Mandali'
    ? '"Mandali", "Noto Sans Telugu", sans-serif'
    : '"Roboto", sans-serif';

  // Description font selection
  // Roboto font
  // Mandali font
  const descFontFamily = descriptionFont === 'Mandali'
    ? '"Mandali", "Noto Sans Telugu", sans-serif'
    : '"Roboto", sans-serif';

  const data = {
    title: cardData.title || 'Breaking update from the newsroom',
    description: cardData.description || 'Your headline and description will appear here as the final published story.',
    titleFont,
    descriptionFont,
    titleSize: Number(cardData.titleSize) || 54,
    descriptionSize: Number(cardData.descriptionSize) || 30,
    gap: Number(cardData.gap) !== undefined ? Number(cardData.gap) : 24,
    titleColor: cardData.titleColor || '#F3C74A',
    textColor: cardData.textColor || '#F5F1F3',
    accentColor: cardData.accentColor || '#A10D1F',
    reporterName: cardData.reporterName || '',
    designation: cardData.designation || cardData.reporterDesignation || '',
    reporterDesignation: cardData.designation || cardData.reporterDesignation || '',
    imageData: cardData.imageData || '',
    crop: cardData.crop || { zoom: 1, x: 50, y: 50 }
  };

  // Pre-calculate text layout to dynamically adjust card height
  const titleAreaLeft = 78;
  const titleAreaWidth = width - 156; // 924px
  const headerHeight = 180;
  const imageY = 220;
  const imageH = 480; // Reduced height (was 610) to give more room for title and description
  const titleAreaTop = imageY + imageH + 36; // 736px

  const titleFontSize = Math.max(20, Math.min(96, Number(data.titleSize) || 54));
  const titleLineHeight = Math.round(titleFontSize * 1.25);

  // Temporary canvas to measure text with selected font
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  measureCtx.font = `800 ${titleFontSize}px ${titleFontFamily}`;
  const titleLines = wrapText(measureCtx, data.title, titleAreaWidth);
  const titleTotalHeight = titleLines.length * titleLineHeight;

  const contentGap = Math.max(4, Math.min(60, Number(data.gap) !== undefined ? Number(data.gap) : 24));
  const descriptionStartY = titleAreaTop + titleTotalHeight + contentGap;

  const descriptionFontSize = Math.max(16, Math.min(64, Number(data.descriptionSize) || 30));
  const descLineHeight = Math.round(descriptionFontSize * 1.35);
  measureCtx.font = `400 ${descriptionFontSize}px ${descFontFamily}`;
  const descLines = wrapText(measureCtx, data.description, titleAreaWidth);
  const descTotalHeight = descLines.length * descLineHeight;

  const descriptionBottom = descriptionStartY + descTotalHeight;
  const footerHeight = 190;
  const bottomPadding = 48;

  // Automatically adjust card height based on actual description and title length
  const neededHeight = descriptionBottom + bottomPadding + footerHeight;
  const computedHeight = Math.max(1920, neededHeight);

  const canvas = targetCanvas || document.createElement('canvas');
  canvas.width = width;
  canvas.height = computedHeight;
  const ctx = canvas.getContext('2d');

  let btvLogo = cardData.btvLogoImage || state.btvLogoImage || null;
  if (!btvLogo || !btvLogo.complete || btvLogo.naturalWidth === 0) {
    try {
      btvLogo = await loadBtvLogo();
    } catch (error) {
      console.error('Failed to load BTV logo:', error);
      btvLogo = null;
    }
  }

  let newsImage = cardData.newsImage || null;
  if ((!newsImage || !newsImage.complete || newsImage.naturalWidth === 0) && data.imageData) {
    try {
      newsImage = await loadImageFromDataUrl(data.imageData, 'uploaded news image');
    } catch (error) {
      console.error('Failed to load news image:', error);
      newsImage = null;
    }
  }

  await waitForImagesLoaded([btvLogo, newsImage]);
  state.btvLogoImage = btvLogo || state.btvLogoImage;
  state.newsImage = newsImage || state.newsImage;

  const bgDark = '#200811';
  ctx.fillStyle = bgDark;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Decorative ambient circles
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.arc(160, 290, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(930, 820, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(350, canvas.height - 300, 220, 0, Math.PI * 2);
  ctx.fill();

  // =====================================================
  // BTV CARD TOP HEADER (Mandali Font)
  // // 4. Rendering reporter details in the top header
  // Matches reference design:
  // - Red gradient background
  // - Rounded top-left and top-right corners
  // - Left: "BTV — TRUE NEWS FOR PEOPLE" in Mandali white
  // - Left (under tagline): "🎙 Reporter Name — Designation" if details exist
  // - Right: Telugu date in Mandali white
  // - Thin bright-red horizontal separator at the bottom
  // =====================================================
  const headerRadius = 32;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, headerHeight);
  ctx.lineTo(0, headerRadius);
  ctx.quadraticCurveTo(0, 0, headerRadius, 0);
  ctx.lineTo(canvas.width - headerRadius, 0);
  ctx.quadraticCurveTo(canvas.width, 0, canvas.width, headerRadius);
  ctx.lineTo(canvas.width, headerHeight);
  ctx.closePath();

  const headerGradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  headerGradient.addColorStop(0, '#7C0A20');
  headerGradient.addColorStop(0.5, '#A10D1F');
  headerGradient.addColorStop(1, '#B4152A');
  ctx.fillStyle = headerGradient;
  ctx.fill();
  ctx.restore();

  // Thin bright-red horizontal separator
  ctx.fillStyle = '#E5122E';
  ctx.fillRect(0, headerHeight, canvas.width, 3);

  const headerPaddingX = 54;
  const headerCenterY = headerHeight / 2;

  const repName = (data.reporterName || '').trim();
  const repDesig = (data.designation || data.reporterDesignation || '').trim();
  let reporterLine = '';
  if (repName && repDesig) {
    reporterLine = `${repName} — ${repDesig}`;
  } else if (repName) {
    reporterLine = repName;
  } else if (repDesig) {
    reporterLine = repDesig;
  }

  // Header Right: Telugu date in Mandali (increased by ~18% from 28px to 33px)
  const dateText = formatTeluguDate(cardData.date || cardData.publishedAt);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 33px "Mandali", "Noto Sans Telugu", sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(dateText, canvas.width - headerPaddingX, headerCenterY);

  const measuredDateWidth = ctx.measureText(dateText).width;
  const maxHeaderLeftWidth = canvas.width - (headerPaddingX * 2) - measuredDateWidth - 36;

  // Header Left Text Elements (increased typography by ~15-20%)
  if (reporterLine) {
    // 1. Tagline: "BTV — TRUE NEWS FOR PEOPLE" (increased by ~19% from 26px to 31px)
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 31px "Mandali", "Noto Sans Telugu", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const displayTagline = fitHeaderLeftText(ctx, 'BTV — TRUE NEWS FOR PEOPLE', maxHeaderLeftWidth);
    ctx.fillText(displayTagline, headerPaddingX, 60);

    // 2. Under Tagline: "🎙 Reporter Name — Designation" (increased by ~18% from 22px to 26px)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.font = '600 26px "Mandali", "Noto Sans Telugu", sans-serif';
    const displayReporter = fitHeaderLeftText(ctx, '🎙 ' + reporterLine, maxHeaderLeftWidth);
    ctx.fillText(displayReporter, headerPaddingX, 120);
  } else {
    // Graceful fallback when no reporter details are saved (increased by ~18% from 28px to 33px)
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 33px "Mandali", "Noto Sans Telugu", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const displayTagline = fitHeaderLeftText(ctx, 'BTV — TRUE NEWS FOR PEOPLE', maxHeaderLeftWidth);
    ctx.fillText(displayTagline, headerPaddingX, headerCenterY);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // =====================================================
  // NEWS IMAGE (Aspect Ratio Preserved, Never Distorted)
  // =====================================================
  const imageX = 70;
  const imageW = canvas.width - 140;

  if (data.imageData && newsImage) {
    try {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const cropZoom = Math.max(1, Number(data.crop.zoom) || 1);
      const cropX = Number(data.crop.x) || 50;
      const cropY = Number(data.crop.y) || 50;
      const imgW = newsImage.naturalWidth || newsImage.width;
      const imgH = newsImage.naturalHeight || newsImage.height;
      const coverScale = Math.max(imageW / imgW, imageH / imgH);
      const drawWidth = imgW * coverScale * cropZoom;
      const drawHeight = imgH * coverScale * cropZoom;
      const maxPanX = Math.max(0, drawWidth - imageW);
      const maxPanY = Math.max(0, drawHeight - imageH);
      const offsetX = -maxPanX * (cropX / 100);
      const offsetY = -maxPanY * (cropY / 100);

      ctx.save();
      roundRect(ctx, imageX, imageY, imageW, imageH, 26);
      ctx.clip();
      ctx.drawImage(newsImage, imageX + offsetX, imageY + offsetY, drawWidth, drawHeight);
      ctx.restore();

      ctx.strokeStyle = 'rgba(240, 128, 80, 0.9)';
      ctx.lineWidth = 2;
      roundRect(ctx, imageX, imageY, imageW, imageH, 26);
      ctx.stroke();
    } catch (error) {
      console.error('News image rendering error:', error);
      ctx.fillStyle = '#3E1129';
      ctx.fillRect(imageX, imageY, imageW, imageH);
    }
  } else {
    const fallbackGradient = ctx.createLinearGradient(0, imageY, 0, imageY + imageH);
    fallbackGradient.addColorStop(0, '#3E1129');
    fallbackGradient.addColorStop(1, '#1C0A14');
    ctx.fillStyle = fallbackGradient;
    ctx.fillRect(imageX, imageY, imageW, imageH);
  }

  // =====================================================
  // TITLE RENDERING (Applying selected fonts to live preview & downloaded images)
  // // Title font selection
  // // Roboto font
  // // Mandali font
  // // Applying selected fonts to live preview
  // // Applying selected fonts to downloaded images
  // =====================================================
  ctx.fillStyle = data.titleColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `800 ${titleFontSize}px ${titleFontFamily}`;

  titleLines.forEach((line, index) => {
    const y = titleAreaTop + (index * titleLineHeight);
    ctx.fillText(line, titleAreaLeft, y);
  });

  // =====================================================
  // DESCRIPTION RENDERING (Applying selected fonts to live preview & downloaded images)
  // // Description font selection
  // // Roboto font
  // // Mandali font
  // // Applying selected fonts to live preview
  // // Applying selected fonts to downloaded images
  // =====================================================
  ctx.fillStyle = data.textColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `400 ${descriptionFontSize}px ${descFontFamily}`;

  descLines.forEach((line, index) => {
    const y = descriptionStartY + (index * descLineHeight);
    ctx.fillText(line, titleAreaLeft, y);
  });

  // =====================================================
  // BTV CARD FOOTER (Mandali Font, Bottom-Right Logo)
  // =====================================================
  const footerStartY = canvas.height - footerHeight;
  const footerRadius = 32;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, footerStartY);
  ctx.lineTo(canvas.width, footerStartY);
  ctx.lineTo(canvas.width, canvas.height - footerRadius);
  ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - footerRadius, canvas.height);
  ctx.lineTo(footerRadius, canvas.height);
  ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - footerRadius);
  ctx.closePath();

  const footerGradient = ctx.createLinearGradient(0, footerStartY, 0, canvas.height);
  footerGradient.addColorStop(0, '#860D20');
  footerGradient.addColorStop(0.4, '#700918');
  footerGradient.addColorStop(1, '#4A050F');
  ctx.fillStyle = footerGradient;
  ctx.fill();
  ctx.restore();

  // Top thin bright red separator
  ctx.fillStyle = '#E5122E';
  ctx.fillRect(0, footerStartY, canvas.width, 3);

  const footerTextX = 54;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Primary Telugu text: "నిజమైన వార్తలు కోసం" in Mandali
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 38px "Mandali", "Noto Sans Telugu", sans-serif';
  ctx.fillText('నిజమైన వార్తలు కోసం', footerTextX, footerStartY + 76);

  // Subtitle text: "BTV News · btvmedia.info" in Mandali
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.font = '500 24px "Mandali", "Noto Sans Telugu", sans-serif';
  ctx.fillText('BTV News · btvmedia.info', footerTextX, footerStartY + 128);

  // 4. Right side: BTV Logo Image
  const logo = (btvLogo && btvLogo.complete && btvLogo.naturalWidth > 0)
    ? btvLogo
    : ((state.btvLogoImage && state.btvLogoImage.complete && state.btvLogoImage.naturalWidth > 0)
      ? state.btvLogoImage
      : cachedBtvLogo);

  const maxLogoW = 216;
  const maxLogoH = 140;
  let footerLogoWidth = maxLogoW;
  let footerLogoHeight = maxLogoH;

  if (logo && logo.naturalWidth > 0 && logo.naturalHeight > 0) {
    const naturalRatio = logo.naturalWidth / logo.naturalHeight;
    if (naturalRatio > maxLogoW / maxLogoH) {
      footerLogoWidth = maxLogoW;
      footerLogoHeight = Math.round(maxLogoW / naturalRatio);
    } else {
      footerLogoHeight = maxLogoH;
      footerLogoWidth = Math.round(maxLogoH * naturalRatio);
    }
  }

  const logoMargin = 24;
  const footerLogoX = canvas.width - footerLogoWidth - logoMargin;
  const footerLogoY = canvas.height - footerLogoHeight - logoMargin;

  if (logo && logo.complete && logo.naturalWidth > 0 && logo.naturalHeight > 0) {
    ctx.drawImage(
      logo,
      footerLogoX,
      footerLogoY,
      footerLogoWidth,
      footerLogoHeight
    );
  } else {
    console.error('BTV logo not ready for Canvas rendering:', logo);
  }

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  return canvas;
}

async function updatePreview() {
  updateStateFromInputs();
  setDownloadButtonsState(!validateFormData());

  const canvas = document.getElementById('newsCanvas');
  if (!canvas) return;

  if (!state.btvLogoImage || !state.btvLogoImage.complete || state.btvLogoImage.naturalWidth === 0) {
    try {
      state.btvLogoImage = await loadBtvLogo();
    } catch (error) {
      console.warn('BTV logo load warning in updatePreview:', error);
    }
  }

  try {
    await renderCard({ targetCanvas: canvas, cardData: state });
  } catch (error) {
    console.error('BTV renderCard preview failed:', error);
  }
}

function applyAutoFit() {
  const titleEl = elements.previewTitle;
  const descEl = elements.previewDescription;

  titleEl.style.fontSize = `${state.titleSize}px`;
  descEl.style.fontSize = `${state.descriptionSize}px`;

  let titleSize = state.titleSize;
  let descSize = state.descriptionSize;

  while (titleSize > 22 && titleEl.scrollHeight > 120) {
    titleSize -= 2;
    titleEl.style.fontSize = `${titleSize}px`;
  }

  while (descSize > 16 && descEl.scrollHeight > 150) {
    descSize -= 2;
    descEl.style.fontSize = `${descSize}px`;
  }
}

function handleColorInput(colorKey, value) {
  const normalized = value.startsWith('#') ? value : `#${value}`;
  if (!/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
    return;
  }

  state[colorKey] = normalized.toUpperCase();
  syncHexInputs();
  updatePreview();
}

// =====================================================
// STEP CONTROLS (Title Size, Description Size, Gap/Spacing)
// Directly updates state and updates live preview immediately.
// =====================================================
function handleStepChange(target, stepValue) {
  const step = Number(stepValue) || 2;

  if (target === 'titleSize') {
    state.titleSize = Math.max(20, Math.min(96, (Number(state.titleSize) || 54) + step));
    if (elements.titleSizeValue) {
      elements.titleSizeValue.textContent = `${state.titleSize}px`;
    }
  }

  if (target === 'descriptionSize') {
    state.descriptionSize = Math.max(16, Math.min(64, (Number(state.descriptionSize) || 30) + step));
    if (elements.descriptionSizeValue) {
      elements.descriptionSizeValue.textContent = `${state.descriptionSize}px`;
    }
  }

  if (target === 'gap') {
    state.gap = Math.max(4, Math.min(60, (Number(state.gap) !== undefined ? Number(state.gap) : 24) + step));
    if (elements.gapValue) {
      elements.gapValue.textContent = `${state.gap}px`;
    }
  }

  updatePreview();
}

function addPresetHandlers() {
  document.querySelectorAll('.preset-btn').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach((preset) => preset.classList.remove('active'));
      button.classList.add('active');
      applyTheme(button.dataset.theme);
    });
  });
}

// ==========================================
// SAFE IMAGE LOADING (ZERO CANVAS TAINT)
// Converts files to DataURLs and loads Images
// with strict same-origin semantics (no crossOrigin).
// ==========================================
function loadFileAsImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No image file selected.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const image = new Image();
      image.onload = () => {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          resolve(image);
        } else {
          reject(new Error('Image has zero dimensions.'));
        }
      };
      image.onerror = () => reject(new Error('Failed to load selected image.'));
      image.src = dataUrl;
    };
    reader.onerror = () => reject(new Error('Failed to read selected image file.'));
    reader.readAsDataURL(file);
  });
}

async function handleImageUpload(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  try {
    const image = await loadFileAsImage(file);
    state.newsImage = image;
    state.imageData = image.src;
    state.crop = { zoom: 1, x: 50, y: 50 };
    syncDisplayValues();
    await updatePreview();
  } catch (error) {
    console.error('BTV IMAGE UPLOAD ERROR:', error);
    setStatus('Unable to load the selected image.');
  }
}

function loadSafeImage(src, label = 'image') {
  if (!src) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve(image);
      } else {
        reject(new Error(`Image ${label} loaded with zero dimensions`));
      }
    };
    image.onerror = () => {
      console.error(`Safe image load failed: ${label}`);
      resolve(null);
    };
    image.src = src;
  });
}

function readImageElement(src) {
  return loadSafeImage(src, 'readImageElement');
}

async function loadImage(src, label = 'canvas image') {
  return loadSafeImage(src, label);
}

async function loadImageFromDataUrl(dataUrl, label = 'uploaded image') {
  return loadSafeImage(dataUrl, label);
}

async function waitForImagesLoaded(images = []) {
  const pending = images.filter(Boolean);
  if (!pending.length) return [];

  await Promise.all(pending.map((image) => new Promise((resolve) => {
    if (image.complete && image.naturalWidth > 0) {
      resolve(image);
      return;
    }

    image.onload = () => resolve(image);
    image.onerror = () => {
      console.warn('Image failed to load before render:', image.src);
      resolve(image);
    };
  })));

  return pending;
}

// ==========================================
// TEXT WRAPPING
// Calculates the natural lines from measured width,
// ensuring no word or character overflows horizontally.
// ==========================================
function wrapText(ctx, text, maxWidth) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [''];

  const words = normalized.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const measuredWidth = ctx.measureText(candidate).width;

    if (measuredWidth <= maxWidth || !currentLine) {
      if (measuredWidth > maxWidth && !currentLine) {
        // Individual word exceeds max width — break down by characters
        let partial = '';
        for (const char of word) {
          if (ctx.measureText(partial + char).width <= maxWidth) {
            partial += char;
          } else {
            lines.push(partial);
            partial = char;
          }
        }
        currentLine = partial;
      } else {
        currentLine = candidate;
      }
    } else {
      lines.push(currentLine);
      if (ctx.measureText(word).width > maxWidth) {
        let partial = '';
        for (const char of word) {
          if (ctx.measureText(partial + char).width <= maxWidth) {
            partial += char;
          } else {
            lines.push(partial);
            partial = char;
          }
        }
        currentLine = partial;
      } else {
        currentLine = word;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function wrapTextLines(ctx, text, maxWidth, maxLines = 24) {
  return wrapText(ctx, text, maxWidth).slice(0, maxLines);
}

function fitHeaderLeftText(ctx, text, maxWidth) {
  if (!text || ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1).trim();
  }
  return truncated ? truncated + '…' : text;
}

// ==========================================
// TITLE FONT CALCULATION
// Adjusts title size based on title length (supports up to 150 chars).
// ==========================================
function getTitleFontSize(title) {
  const length = String(title || '').length;

  if (length <= 40) return 64;
  if (length <= 70) return 56;
  if (length <= 110) return 50;
  return 46;
}

// ==========================================
// DESCRIPTION FONT CALCULATION
// Adjusts description size based on content (supports up to 600 chars).
// ==========================================
function getDescriptionFontSize(description) {
  const length = String(description || '').length;

  if (length <= 150) return 38;
  if (length <= 300) return 32;
  if (length <= 450) return 28;
  return 26;
}

function getLineHeight(fontSize) {
  return Math.round(fontSize * 1.2);
}

function measureTextBlock(ctx, text, maxWidth, preferredFontSize, fontWeight, minFontSize, maxLines, maxHeight) {
  const safeText = String(text || '').trim() || 'Untitled story';
  let finalFontSize = preferredFontSize;
  let finalLines = wrapText(ctx, safeText, maxWidth);
  let finalLineHeight = getLineHeight(finalFontSize);

  while (finalFontSize >= minFontSize) {
    ctx.font = `${fontWeight} ${finalFontSize}px "Segoe UI", sans-serif`;
    finalLines = wrapTextLines(ctx, safeText, maxWidth, maxLines);
    finalLineHeight = getLineHeight(finalFontSize);
    const totalHeight = finalLines.length * finalLineHeight;

    if (totalHeight <= maxHeight) {
      break;
    }

    finalFontSize -= 2;
  }

  if (finalLines.length === 0) {
    finalLines = [safeText];
  }

  return {
    lines: finalLines,
    size: finalFontSize,
    lineHeight: finalLineHeight,
    totalHeight: finalLines.length * finalLineHeight
  };
}

// ==========================================
// DYNAMIC CONTENT HEIGHT
// Calculates where the description ends before placing the reporter section.
// ==========================================
function getReporterPosition(canvasHeight, descriptionBottom, footerHeight) {
  return canvasHeight - footerHeight;
}

// =====================================================
// UNIFIED EXPORT CANVAS RENDERER (ZERO TAINT GUARANTEE)
// Pre-loads all required images safely (Data URLs / local assets),
// renders the full 1080 × 1920 card onto canvas, verifies untainted status,
// and returns the clean Canvas element for preview, export, and publish.
// =====================================================
async function renderExportCanvas(cardData = state) {
  // 1. Ensure BTV logo is loaded and ready
  let logo = cardData.btvLogoImage || state.btvLogoImage || cachedBtvLogo || null;
  if (!logo || !logo.complete || logo.naturalWidth === 0) {
    try {
      logo = await loadBtvLogo();
    } catch (err) {
      console.error('Error loading BTV logo in renderExportCanvas:', err);
      logo = null;
    }
  }

  // 2. Ensure news image is loaded and ready if imageData exists
  const rawImageData = cardData.imageData || state.imageData || '';
  let newsImage = cardData.newsImage || state.newsImage || null;
  if ((!newsImage || !newsImage.complete || newsImage.naturalWidth === 0) && rawImageData) {
    try {
      newsImage = await loadSafeImage(rawImageData, 'uploaded news image');
    } catch (err) {
      console.error('Error loading news image in renderExportCanvas:', err);
      newsImage = null;
    }
  }

  // 3. Obtain canvas target
  const targetCanvas = document.getElementById('newsCanvas') || document.createElement('canvas');

  // 4. Render card onto canvas
  await renderCard({
    targetCanvas,
    cardData: {
      ...cardData,
      btvLogoImage: logo,
      newsImage: newsImage
    }
  });

  // 5. Test export to verify canvas is 100% untainted and clean
  targetCanvas.toDataURL('image/png');

  state.renderedCanvas = targetCanvas;
  return targetCanvas;
}

const renderCardToCanvas = renderExportCanvas;
window.renderExportCanvas = renderExportCanvas;
window.renderCardToCanvas = renderCardToCanvas;

async function syncRenderedCanvas() {
  return renderExportCanvas();
}

async function createCanvasForDownload(format) {
  return renderExportCanvas();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || '').split(' ');
  let line = '';
  let lineCount = 0;

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const testLine = line ? `${line} ${word}` : word;
    const testWidth = ctx.measureText(testLine).width;

    if (testWidth > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = word;
      lineCount += 1;
      if (lineCount >= maxLines) break;
    } else {
      line = testLine;
    }
  }

  if (line && lineCount < maxLines) {
    ctx.fillText(line, x, y);
  }
}

function titleTextForCanvas() {
  return state.title || 'Breaking update from the newsroom';
}

function descriptionTextForCanvas() {
  return state.description || 'Your headline and description will appear here as the final published story.';
}

// ==========================================
// CANVAS EXPORT
// Exports the exact rendered Preview canvas.
// ==========================================
async function exportCard(format = 'image/png', quality = 1) {
  const canvas = await renderCardToCanvas();
  if (!canvas) {
    throw new Error('Canvas export failed because the final card canvas was not created.');
  }

  const mimeType = format === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const dataUrl = canvas.toDataURL(mimeType, quality);
  console.log('BTV canvas export check PASSED');

  return new Promise((resolve, reject) => {
    try {
      const blob = dataUrlToBlob(dataUrl);
      if (!blob) {
        reject(new Error('Canvas export returned no Blob.'));
        return;
      }
      resolve(blob);
    } catch (error) {
      reject(error);
    }
  });
}

async function exportCanvasToDataUrl(canvas, mimeType = 'image/png', quality = 1) {
  if (!canvas) {
    throw new Error('No canvas available for export.');
  }

  return canvas.toDataURL(mimeType, quality);
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;

  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: match[1] });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function generatePublishedImageData() {
  const canvas = await renderCardToCanvas();
  return canvas ? canvas.toDataURL('image/png') : '';
}

// ==========================================
// DOWNLOAD
// Downloads the rendered card.
// ==========================================
async function downloadCard() {
  try {
    const validationError = validateFormData();
    if (validationError) {
      setStatus(validationError);
      return;
    }

    const canvas = await renderCardToCanvas();
    const dataUrl = canvas.toDataURL('image/png');
    downloadDataUrl(dataUrl, 'btv-news-card.png');
    setStatus('Card downloaded.');
  } catch (error) {
    console.error('BTV Download Card Error:', error);
    setStatus('Unable to download the card: ' + error.message);
  }
}

async function downloadImage(format) {
  try {
    const validationError = validateFormData();
    if (validationError) {
      setStatus(validationError);
      return;
    }

    const mimeTypeMap = {
      png: 'image/png',
      jpg: 'image/jpeg',
      story: 'image/png'
    };
    const qualityMap = {
      png: 1,
      jpg: 0.95,
      story: 1
    };
    const fileNameMap = {
      png: 'btv-news-card.png',
      jpg: 'btv-news-card.jpg',
      story: 'btv-news-story-9x16.png'
    };

    const mimeType = mimeTypeMap[format] || 'image/png';
    const quality = qualityMap[format] || 1;
    const fileName = fileNameMap[format] || 'btv-news-card.png';

    const canvas = await renderCardToCanvas();
    if (!canvas) {
      throw new Error('No canvas available for download.');
    }

    const dataUrl = canvas.toDataURL(mimeType, quality);
    downloadDataUrl(dataUrl, fileName);
    setStatus('Download complete.');
  } catch (error) {
    console.error('BTV Download Error:', error);
    setStatus('Unable to download the current card: ' + error.message);
  }
}

async function triggerPublish(selectedCategories = ['News']) {
  console.group('BTV PUBLISH DEBUG');
  console.log('1. Publish process initiated');

  try {
    console.log('2. Form data collected');
    updateStateFromInputs();

    const title = state.title.trim();
    const description = state.description.trim();
    // Selected categories
    const categories = Array.isArray(selectedCategories) && selectedCategories.length
      ? selectedCategories
      : ['News'];

    const payload = {
      title,
      description,
      // Title font selection
      titleFont: state.titleFont || 'Roboto',
      // Description font selection
      descriptionFont: state.descriptionFont || 'Roboto',
      categories,
      titleSize: state.titleSize,
      descriptionSize: state.descriptionSize,
      gap: state.gap,
      titleColor: state.titleColor,
      highlightColor: state.highlightColor,
      textColor: state.textColor,
      accentColor: state.accentColor,
      reporterName: state.reporterName || '',
      designation: state.designation || state.reporterDesignation || '',
      reporterDesignation: state.designation || state.reporterDesignation || '',
      imageData: state.imageData,
      crop: state.crop,
      autoFit: state.autoFit,
      date: new Date().toISOString(),
      user: getCurrentUser()?.reporterId || null
    };
    console.log('Form data:', payload);

    console.log('3. Validation passed');
    const validationError = validateFormData();
    if (validationError) {
      throw new Error(validationError);
    }

    console.log('4. Canvas rendering');
    const canvas = await renderCardToCanvas();
    if (!canvas) {
      throw new Error('newsCanvas element was not found.');
    }
    console.log('5. Canvas dimensions:', canvas.width, canvas.height);

    if (canvas.width !== 1080 || canvas.height < 1920) {
      throw new Error(`Wrong canvas size: ${canvas.width} × ${canvas.height}. Expected width 1080 and height >= 1920.`);
    }

    console.log('6. Image export started');
    const publishedImage = canvas.toDataURL('image/jpeg', 0.92);
    console.log('7. Image export completed. Data size:', publishedImage.length);

    try {
      localStorage.setItem('__btv_test__', 'test');
      localStorage.removeItem('__btv_test__');
    } catch (error) {
      console.error('localStorage unavailable:', error);
    }

    console.log('8. Storage started');
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : createId();
    const sourceImageId = `${id}_source`;
    const publishedImageId = `${id}_published`;

    // Save categories and font selections with card
    const post = {
      id,
      title,
      description,
      // Title font selection
      titleFont: state.titleFont || 'Roboto',
      // Description font selection
      descriptionFont: state.descriptionFont || 'Roboto',
      categories,
      date: new Date().toISOString(),
      reporterName: state.reporterName || '',
      designation: state.designation || state.reporterDesignation || '',
      reporterDesignation: state.designation || state.reporterDesignation || '',
      imageData: state.imageData,
      sourceImage: state.imageData,
      publishedImage,
      imageId: sourceImageId,
      publishedImageId,
      titleSize: state.titleSize,
      descriptionSize: state.descriptionSize,
      gap: state.gap,
      titleColor: state.titleColor,
      highlightColor: state.highlightColor,
      textColor: state.textColor,
      accentColor: state.accentColor,
      autoFit: state.autoFit,
      crop: state.crop,
      publishedAt: new Date().toISOString(),
      published: true,
      status: 'published',
      user: payload.user
    };

    if (state.imageData) {
      await saveImageToIndexedDB(sourceImageId, state.imageData);
    }
    await saveImageToIndexedDB(publishedImageId, dataUrlToBlob(publishedImage) || publishedImage);

    const posts = getPosts();
    posts.unshift(sanitizePostForStorage(post));
    savePosts(posts);
    console.log('9. Storage completed');

    const shareUrl = new URL('post.html', window.location.href);
    shareUrl.searchParams.set('id', id);
    state.publishedUrl = shareUrl.toString();
    if (elements.shareLinkInput) {
      elements.shareLinkInput.value = shareUrl.toString();
      elements.shareLinkInput.setAttribute('title', shareUrl.toString());
    }
    console.log('10. Public URL generated:', shareUrl.toString());
    renderMyCards();
    setStatus('Published successfully!');
    console.log('BTV PUBLISH SUCCESS');
    console.groupEnd();
    return;
  } catch (error) {
    console.error('=== BTV PUBLISH FAILED ===');
    console.error('BTV PUBLISH ERROR:', error);
    console.error(error && error.stack ? error.stack : error);
    console.groupEnd();
    setStatus('Publish failed: ' + error.message);
  }
}

function copyPublishedLink() {
  const shareUrl = state.publishedUrl || elements.shareLinkInput.value;

  if (!shareUrl) {
    setStatus('Publish a card first to create a link.');
    return;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareUrl)
      .then(() => {
        setStatus('Link copied!');
      })
      .catch(() => {
        const fallback = document.createElement('textarea');
        fallback.value = shareUrl;
        document.body.appendChild(fallback);
        fallback.select();
        try {
          document.execCommand('copy');
          setStatus('Link copied!');
        } catch (copyError) {
          setStatus('Clipboard is unavailable. Copy the URL manually.');
        } finally {
          fallback.remove();
        }
      });
    return;
  }

  const fallback = document.createElement('textarea');
  fallback.value = shareUrl;
  document.body.appendChild(fallback);
  fallback.select();
  try {
    document.execCommand('copy');
    setStatus('Link copied!');
  } catch (copyError) {
    setStatus('Clipboard is unavailable. Copy the URL manually.');
  } finally {
    fallback.remove();
  }
}

function createMyCardMarkup(post) {
  const cardImage = post.publishedImage || post.imageData || '';
  const previewStyle = cardImage
    ? `background-image: url('${cardImage}'); background-size: cover; background-position: center;`
    : 'background: linear-gradient(135deg, rgba(11,31,216,0.12), rgba(227,27,35,0.11));';
  const link = new URL('post.html', window.location.href);
  link.searchParams.set('id', post.id);

  return `
    <article class="my-card-item" data-id="${post.id}">
      <div class="my-card-thumb" style="${previewStyle}"></div>
      <div class="my-card-body">
        <h4>${(post.title || 'Untitled card').slice(0, 52)}</h4>
        <div class="meta-row">
          <span>${new Date(post.publishedAt || Date.now()).toLocaleDateString('en-GB')}</span>
          <span class="status-pill">Published</span>
        </div>
        <div class="my-card-actions">
          <button type="button" data-action="view" data-id="${post.id}">View</button>
          <button type="button" data-action="edit" data-id="${post.id}">Edit</button>
          <button type="button" data-action="copy" data-id="${post.id}">Copy Link</button>
          <button type="button" data-action="download" data-id="${post.id}">Download</button>
          <button type="button" class="danger" data-action="delete" data-id="${post.id}">Delete</button>
        </div>
      </div>
    </article>
  `;
}

// =====================================================
// MY CARDS
// Displays the user's published cards in the gallery.
// =====================================================
function renderMyCards() {
  const list = elements.myCardsList;
  if (!list) return;

  const posts = getPosts();

  if (!posts.length) {
    list.innerHTML = '<div class="empty-state">No published cards yet.</div>';
    return;
  }

  list.innerHTML = posts.map(createMyCardMarkup).join('');
}

function applyCardFromStorage(post) {
  state.title = post.title || '';
  state.description = post.description || '';
  // Title font selection
  state.titleFont = post.titleFont || 'Roboto';
  // Description font selection
  state.descriptionFont = post.descriptionFont || 'Roboto';
  state.titleSize = post.titleSize || 54;
  state.descriptionSize = post.descriptionSize || 30;
  state.gap = post.gap || 18;
  state.titleColor = post.titleColor || '#F3C74A';
  state.highlightColor = post.highlightColor || '#A10D1F';
  state.textColor = post.textColor || '#F5F1F3';
  state.accentColor = post.accentColor || '#3F0A19';
  state.imageData = post.imageData || '';
  state.reporterName = post.reporterName || 'Reporter Name';
  state.reporterDesignation = post.reporterDesignation || 'Designation';
  state.autoFit = post.autoFit !== false;
  state.crop = post.crop || { zoom: 1, x: 50, y: 50 };
  syncDisplayValues();
  updatePreview();
}

// =====================================================
// REPORTER PROFILE & DROPDOWN MANAGEMENT
// =====================================================
// REPORTER PROFILE & DROPDOWN MANAGEMENT
// Reads the logged-in reporter's actual information from localStorage:
// - Profile Photo (uploaded during registration, max 2MB)
// - Full Name (firstName + lastName)
// - Date of Birth (dob)
// - Reporter ID (reporterId)
// Controls the Profile dropdown, My Cards option, and Logout functionality.
// =====================================================
function getLoggedInReporter() {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    return {
      name: state.reporterName || 'Reporter',
      firstName: '',
      lastName: '',
      dob: '',
      id: 'BTV-REP-01',
      reporterId: 'BTV-REP-01',
      photo: null,
      initial: (state.reporterName || 'R')[0].toUpperCase()
    };
  }

  // Look up full user account in btvNewsUsers by matching reporterId
  let users = [];
  try {
    const raw = localStorage.getItem('btvNewsUsers');
    users = raw ? JSON.parse(raw) : [];
  } catch (e) {
    users = [];
  }

  const currentReporterId = currentUser.reporterId || currentUser.username || '';
  const fullUser = users.find(
    (u) => (u.reporterId && u.reporterId.toLowerCase() === currentReporterId.toLowerCase()) ||
           (u.username && u.username.toLowerCase() === currentReporterId.toLowerCase())
  ) || currentUser;

  let displayName = '';
  if (fullUser.reporterName) {
    displayName = fullUser.reporterName;
  } else if (fullUser.firstName || fullUser.lastName) {
    displayName = `${fullUser.firstName || ''} ${fullUser.lastName || ''}`.trim();
  }
  if (!displayName) {
    displayName = fullUser.name || fullUser.reporterId || fullUser.username || state.reporterName || 'Reporter';
  }

  const reporterId = fullUser.reporterId || fullUser.username || 'BTV-REP-01';
  const photo = fullUser.profilePhoto || fullUser.photo || fullUser.avatar || fullUser.image || null;
  const dob = fullUser.dob || '';
  const initial = displayName && displayName[0] ? displayName[0].toUpperCase() : 'R';

  return {
    name: displayName,
    reporterName: displayName,
    firstName: fullUser.firstName || '',
    lastName: fullUser.lastName || '',
    mobileNumber: fullUser.mobileNumber || '',
    email: fullUser.email || '',
    designation: fullUser.designation || 'Reporter',
    dob: dob,
    id: reporterId,
    reporterId: reporterId,
    profilePhoto: photo,
    photo: photo,
    initial: initial
  };
}

function initializeProfileMenu() {
  // Profile data
  const reporter = getLoggedInReporter();

  // 1. Header Profile Button (Photo thumbnail / initial + Name)
  const headerAvatar = document.getElementById('headerProfileAvatar');
  const headerName = document.getElementById('headerProfileName');
  if (headerAvatar) {
    if (reporter.photo) {
      headerAvatar.innerHTML = `<img src="${reporter.photo}" alt="${reporter.name}" />`;
    } else {
      headerAvatar.textContent = reporter.initial;
    }
  }
  if (headerName) {
    headerName.textContent = reporter.name;
  }

  // 2. Profile Dropdown Card Header (Reporter photo/initial, Name, ID, and DOB)
  const photoEl = document.getElementById('profileCardPhoto');
  const fallbackEl = document.getElementById('profileCardAvatarFallback');
  const nameEl = document.getElementById('profileReporterName');
  const idEl = document.getElementById('profileReporterId');
  const dobEl = document.getElementById('profileReporterDob');
  const dobWrap = document.getElementById('profileDobWrap');

  if (nameEl) nameEl.textContent = reporter.name;
  if (idEl) idEl.textContent = reporter.reporterId;

  if (reporter.dob) {
    if (dobEl) {
      dobEl.textContent = new Date(reporter.dob).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    if (dobWrap) dobWrap.classList.remove('hidden');
  } else if (dobWrap) {
    dobWrap.classList.add('hidden');
  }

  if (reporter.photo && photoEl) {
    photoEl.src = reporter.photo;
    photoEl.classList.remove('hidden');
    if (fallbackEl) fallbackEl.classList.add('hidden');
  } else {
    if (photoEl) photoEl.classList.add('hidden');
    if (fallbackEl) {
      fallbackEl.textContent = reporter.initial;
      fallbackEl.classList.remove('hidden');
    }
  }

  // 3. Profile Dropdown Toggle Behavior (Desktop & Mobile)
  const profileBtn = document.getElementById('profileBtn');
  const profileDropdown = document.getElementById('profileDropdown');

  if (profileBtn && profileDropdown) {
    profileBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = profileDropdown.classList.contains('open');
      if (isOpen) {
        profileDropdown.classList.remove('open');
        profileBtn.setAttribute('aria-expanded', 'false');
      } else {
        profileDropdown.classList.add('open');
        profileBtn.setAttribute('aria-expanded', 'true');
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (event) => {
      if (!profileDropdown.contains(event.target) && !profileBtn.contains(event.target)) {
        profileDropdown.classList.remove('open');
        profileBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Close dropdown on Escape key
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && profileDropdown.classList.contains('open')) {
        profileDropdown.classList.remove('open');
        profileBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // 4. Logout Functionality inside Profile dropdown
  const profileLogoutBtn = document.getElementById('profileLogoutBtn');
  if (profileLogoutBtn) {
    profileLogoutBtn.addEventListener('click', () => {
      localStorage.removeItem(CURRENT_USER_KEY);
      window.location.href = 'index.html';
    });
  }
}

// =====================================================
// CATEGORY SELECTION & PUBLISH MODAL
// // Category selection
// Displays all 8 categories upon clicking "Publish & Get Link",
// allows selecting single or multiple categories, and confirms publish.
// =====================================================
function openCategoryModal() {
  updateStateFromInputs();
  const validationError = validateFormData();
  if (validationError) {
    setStatus(validationError);
    return;
  }

  const modal = document.getElementById('categoryModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeCategoryModal() {
  const modal = document.getElementById('categoryModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function getSelectedCategories() {
  // Selected categories
  const checkboxes = document.querySelectorAll('#categorySelectionGrid input[name="categories"]:checked');
  const selected = Array.from(checkboxes).map((cb) => cb.value);
  return selected.length ? selected : ['News'];
}

function setupCategoryModal() {
  const closeBtn = document.getElementById('closeCategoryModal');
  const cancelBtn = document.getElementById('cancelCategoryBtn');
  const confirmBtn = document.getElementById('confirmPublishBtn');
  const modal = document.getElementById('categoryModal');

  if (closeBtn) closeBtn.addEventListener('click', closeCategoryModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeCategoryModal);

  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeCategoryModal();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeCategoryModal();
    }
  });

  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      const categories = getSelectedCategories();
      closeCategoryModal();
      await triggerPublish(categories);
    });
  }
}

function bindActions() {
  document.querySelectorAll('[data-action="new-card"]').forEach((button) => {
    button.addEventListener('click', () => {
      window.location.href = 'dashboard.html';
    });
  });

  document.querySelectorAll('.step-btn').forEach((button) => {
    button.addEventListener('click', () => handleStepChange(button.dataset.target, button.dataset.step));
  });

  ['paste-title', 'paste-description', 'clear-title', 'clear-description'].forEach((actionName) => {
    document.querySelector(`[data-action="${actionName}"]`)?.addEventListener('click', () => {
      const target = actionName.includes('title') ? elements.titleInput : elements.descriptionInput;
      const value = actionName.includes('clear') ? '' : navigator.clipboard ? 'Sample headline copied from clipboard' : '';
      if (!actionName.includes('clear')) {
        navigator.clipboard.readText().then((text) => {
          target.value = text || value;
          updateStateFromInputs();
          updatePreview();
        }).catch(() => {
          target.value = '';
        });
      } else {
        target.value = '';
        updateStateFromInputs();
        updatePreview();
      }
    });
  });

  elements.titleInput.addEventListener('input', (event) => {
    const value = clampTitleInput(event.target.value);
    event.target.value = value;
    updateStateFromInputs();
    updatePreview();
  });

  elements.descriptionInput.addEventListener('input', (event) => {
    const value = clampDescriptionInput(event.target.value);
    event.target.value = value;
    updateStateFromInputs();
    updatePreview();
  });

  elements.titleInput.addEventListener('paste', (event) => {
    event.preventDefault();
    const pasted = (event.clipboardData || window.clipboardData).getData('text');
    const nextValue = clampTitleInput((elements.titleInput.value || '') + pasted);
    elements.titleInput.value = nextValue;
    updateStateFromInputs();
    updatePreview();
  });

  elements.descriptionInput.addEventListener('paste', (event) => {
    event.preventDefault();
    const pasted = (event.clipboardData || window.clipboardData).getData('text');
    const nextValue = clampDescriptionInput((elements.descriptionInput.value || '') + pasted);
    elements.descriptionInput.value = nextValue;
    updateStateFromInputs();
    updatePreview();
  });

  elements.reporterNameInput.addEventListener('input', updatePreview);
  elements.reporterDesignationInput.addEventListener('input', updatePreview);
  elements.autoFitToggle.addEventListener('change', updatePreview);

  elements.titleColorPicker.addEventListener('input', (event) => handleColorInput('titleColor', event.target.value));
  elements.highlightColorPicker.addEventListener('input', (event) => handleColorInput('highlightColor', event.target.value));
  elements.textColorPicker.addEventListener('input', (event) => handleColorInput('textColor', event.target.value));
  elements.accentColorPicker.addEventListener('input', (event) => handleColorInput('accentColor', event.target.value));

  elements.titleColorHex.addEventListener('change', (event) => handleColorInput('titleColor', event.target.value));
  elements.highlightColorHex.addEventListener('change', (event) => handleColorInput('highlightColor', event.target.value));
  elements.textColorHex.addEventListener('change', (event) => handleColorInput('textColor', event.target.value));
  elements.accentColorHex.addEventListener('change', (event) => handleColorInput('accentColor', event.target.value));

  elements.imageUpload.addEventListener('change', handleImageUpload);
  elements.cropZoom.addEventListener('input', () => {
    state.crop.zoom = Number(elements.cropZoom.value);
    updatePreview();
  });
  elements.cropX.addEventListener('input', () => {
    state.crop.x = Number(elements.cropX.value);
    updatePreview();
  });
  elements.cropY.addEventListener('input', () => {
    state.crop.y = Number(elements.cropY.value);
    updatePreview();
  });

  document.getElementById('applyCropBtn').addEventListener('click', updatePreview);
  document.getElementById('resetCropBtn').addEventListener('click', () => {
    state.crop = { zoom: 1, x: 50, y: 50 };
    syncDisplayValues();
    updatePreview();
  });
  document.getElementById('replaceImageBtn').addEventListener('click', () => elements.imageUpload.click());

  document.getElementById('previewRenderBtn').addEventListener('click', () => {
    updateStateFromInputs();
    const error = validateFormData();
    if (error) {
      setStatus(error);
      return;
    }
    updatePreview();
    setStatus('Preview rendered successfully.');
  });

  document.getElementById('publishBtn')?.addEventListener('click', () => {
    // Category selection
    openCategoryModal();
  });

  document.getElementById('copyLinkBtn')?.addEventListener('click', copyPublishedLink);

  // =====================================================
  // DOWNLOAD BUTTON SECTION
  // // Download button section: exports current card as PNG, JPG, or Story 9:16.
  // =====================================================
  document.querySelectorAll('[data-format]').forEach((button) => {
    button.addEventListener('click', () => {
      const format = button.dataset.format || 'png';
      downloadImage(format);
    });
  });

  if (!elements.myCardsList) return;

  elements.myCardsList.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const { action, id } = target.dataset;
    const posts = getPosts();
    const post = posts.find((item) => item.id === id);

    if (!post) return;

    if (action === 'view') {
      window.location.href = `post.html?id=${id}`;
      return;
    }

    if (action === 'edit') {
      applyCardFromStorage(post);
      document.getElementById('titleInput').focus();
      return;
    }

    if (action === 'copy') {
      const url = new URL('post.html', window.location.href);
      url.searchParams.set('id', id);
      navigator.clipboard.writeText(url.toString()).then(() => setStatus('Link copied successfully!'));
      return;
    }

    if (action === 'download') {
      state.title = post.title || '';
      state.description = post.description || '';
      // Title font selection
      state.titleFont = post.titleFont || 'Roboto';
      // Description font selection
      state.descriptionFont = post.descriptionFont || 'Roboto';
      state.titleSize = post.titleSize || 54;
      state.descriptionSize = post.descriptionSize || 30;
      state.gap = post.gap || 18;
      state.titleColor = post.titleColor || '#F3C74A';
      state.highlightColor = post.highlightColor || '#A10D1F';
      state.textColor = post.textColor || '#F5F1F3';
      state.accentColor = post.accentColor || '#3F0A19';
      state.imageData = post.imageData || '';
      state.reporterName = post.reporterName || '';
      state.designation = post.designation || post.reporterDesignation || '';
      state.reporterDesignation = state.designation;
      state.autoFit = post.autoFit !== false;
      state.crop = post.crop || { zoom: 1, x: 50, y: 50 };
      syncDisplayValues();
      updatePreview();
      downloadImage('png');
      return;
    }

    if (action === 'delete') {
      const filtered = posts.filter((item) => item.id !== id);
      savePosts(filtered);
      renderMyCards();
      setStatus('Card deleted.');
    }
  });
}

function cacheElements() {
  elements.titleInput = document.getElementById('titleInput');
  elements.descriptionInput = document.getElementById('descriptionInput');
  elements.titleSizeValue = document.getElementById('titleSizeValue');
  elements.descriptionSizeValue = document.getElementById('descriptionSizeValue');
  elements.gapValue = document.getElementById('gapValue');
  elements.titleColorPicker = document.getElementById('titleColorPicker');
  elements.highlightColorPicker = document.getElementById('highlightColorPicker');
  elements.textColorPicker = document.getElementById('textColorPicker');
  elements.accentColorPicker = document.getElementById('accentColorPicker');
  elements.titleColorHex = document.getElementById('titleColorHex');
  elements.highlightColorHex = document.getElementById('highlightColorHex');
  elements.textColorHex = document.getElementById('textColorHex');
  elements.accentColorHex = document.getElementById('accentColorHex');
  elements.previewTitle = document.getElementById('previewTitle');
  elements.previewDescription = document.getElementById('previewDescription');
  elements.previewDate = document.getElementById('previewDate');
  elements.previewReporterName = document.getElementById('previewReporterName');
  elements.previewReporterDesignation = document.getElementById('previewReporterDesignation');
  elements.newsCardPreview = document.getElementById('newsCardPreview');
  elements.previewMedia = document.getElementById('previewMedia');
  elements.autoFitToggle = document.getElementById('autoFitToggle');
  elements.reporterNameInput = document.getElementById('reporterNameInput');
  elements.reporterDesignationInput = document.getElementById('reporterDesignationInput');
  elements.imageUpload = document.getElementById('imageUpload');
  elements.cropZoom = document.getElementById('cropZoom');
  elements.cropX = document.getElementById('cropX');
  elements.cropY = document.getElementById('cropY');
  elements.copyStatus = document.getElementById('copyStatus');
  elements.myCardsList = document.getElementById('myCardsList');
  elements.shareLinkInput = document.getElementById('shareLinkInput');
  elements.titleCounter = document.getElementById('titleCounter');
  elements.descriptionCounter = document.getElementById('descriptionCounter');
}

async function loadPostFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const editId = params.get('edit') || params.get('id');
  if (!editId) return;

  const posts = getPosts();
  let post = posts.find((p) => p.id === editId);
  if (post) {
    post = await loadPostWithImages(post);
    applyCardFromStorage(post);
  }
}

async function initializeDashboard() {
  if (!ensureAuthenticated()) return;

  cacheElements();
  loadSavedReporterData();
  setupReporterHandlers();
  setupFontSelectionHandlers();
  bindActions();
  setupCategoryModal();
  initializeProfileMenu();
  addPresetHandlers();
  renderMyCards();
  syncDisplayValues();
  setDownloadButtonsState(true);

  // Pre-load BTV logo asset before initial canvas render
  try {
    state.btvLogoImage = await loadBtvLogo();
  } catch (err) {
    console.warn('Initial BTV logo pre-load warning:', err);
  }

  await loadPostFromQuery();
  await updatePreview();
}

document.addEventListener('DOMContentLoaded', initializeDashboard);
