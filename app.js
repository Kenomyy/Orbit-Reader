// Orbit RSS Reader - Core Logic

const RSS2JSON_API = 'https://api.rss2json.com/v1/api.json?rss_url=';

// State Management
let state = {
    folders: JSON.parse(localStorage.getItem('orbit_folders')) || [
        { id: 'cinema', name: 'Cinéma', feeds: ['https://www.cineserie.com/feed/'] }
    ],
    activeFolder: localStorage.getItem('orbit_active_folder') || 'all',
    activeSource: localStorage.getItem('orbit_active_source') || null, // For individual source filtering
    readArticles: new Set(JSON.parse(localStorage.getItem('orbit_read_articles')) || []),
    hideRead: localStorage.getItem('orbit_hide_read') === 'true',
    settings: JSON.parse(localStorage.getItem('orbit_settings')) || {
        accentColor: '#00f2ff',
        readerWidth: '800px',
        fontSize: '18', // Default 18px
        linkColor: '#00f2ff',
        showThumbnails: true,
        showImages: true,
        showVideos: true,
        bgColor: '#050505'
    },
    articles: [],
    displayCount: 20, // Infinite scroll initial count
    increment: 20,
    feedCache: {} // Cache for performance
};

// DOM Elements
let folderList, feedGrid, readerView, readerContent, closeReader, externalLink, addSourceBtn, addFolderBtn, settingsBtn, modalContainer, refreshBtn, hideReadBtn, markAllReadBtn;

// Initialization
function init() {
    // Get Elements
    folderList = document.getElementById('folder-list');
    feedGrid = document.getElementById('feed-grid');
    readerView = document.getElementById('reader-view');
    readerContent = document.getElementById('reader-content');
    closeReader = document.getElementById('close-reader');
    externalLink = document.getElementById('external-link');
    addSourceBtn = document.getElementById('add-source-btn');
    addFolderBtn = document.getElementById('add-folder-btn');
    settingsBtn = document.getElementById('settings-btn');
    modalContainer = document.getElementById('modal-container');
    refreshBtn = document.getElementById('refresh-btn');
    hideReadBtn = document.getElementById('hide-read-btn');
    markAllReadBtn = document.getElementById('mark-all-read-btn');

    // Data Migration: Normalize feeds from strings to objects if necessary
    state.folders.forEach(folder => {
        folder.feeds = folder.feeds.map(feed => {
            if (typeof feed === 'string') {
                return { url: feed, name: null };
            }
            return feed;
        });
    });
    saveState();

    applySettings();
    renderFolders();
    loadActiveFolder();
    setupEventListeners();
}

// Icons
const ICONS = {
    refresh: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`,
    eye: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
    eyeOff: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`,
    checkAll: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13l3 3 7-7"></path><path d="M2 13l3 3 7-7"></path></svg>`
};

// Settings Logic
function applySettings() {
    const root = document.documentElement;
    root.style.setProperty('--accent-color', state.settings.accentColor);
    root.style.setProperty('--reader-width', state.settings.readerWidth);
    root.style.setProperty('--reader-font-size', state.settings.fontSize + 'px');
    root.style.setProperty('--link-color', state.settings.linkColor);
    root.style.setProperty('--bg-color', state.settings.bgColor || '#050505');

    // Update Refresh Icon
    if (refreshBtn) {
        refreshBtn.innerHTML = ICONS.refresh;
    }

    // Update Hide Read button icon
    if (hideReadBtn) {
        hideReadBtn.innerHTML = state.hideRead ? ICONS.eyeOff : ICONS.eye;
        hideReadBtn.title = state.hideRead ? 'Show Read' : 'Hide Read';
    }

    if (markAllReadBtn) {
        markAllReadBtn.innerHTML = ICONS.checkAll;
    }

    if (feedGrid) {
        feedGrid.classList.toggle('no-thumbnails', !state.settings.showThumbnails);
    }
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + "y";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + "mo";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + "d";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + "h";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + "m";
    return Math.floor(seconds) + "s";
}

window.updateSetting = (key, value) => {
    state.settings[key] = value;
    saveState();
    applySettings();
    if (key === 'showThumbnails') renderArticles();
};

// Rendering
function renderFolders() {
    if (!folderList) return;

    // Virtual "All" folder
    const allFolderHtml = `
        <div class="folder-item ${state.activeFolder === 'all' ? 'active' : ''}" 
             onclick="window.switchFolder('all')">
            ALL
        </div>
    `;

    folderList.innerHTML = allFolderHtml + state.folders.map(folder => {
        const isActive = state.activeFolder === folder.id;
        const feedsHtml = isActive ? `
            <div class="source-sublist">
                ${folder.feeds.map(feed => {
            const url = typeof feed === 'string' ? feed : feed.url;
            const name = (typeof feed === 'object' && feed.name) ? feed.name : url.replace('https://', '').split('/')[0];
            return `
                        <div class="source-item ${state.activeSource === url ? 'active' : ''}" 
                             onclick="event.stopPropagation(); window.switchSource('${url}')">
                            <span>${name}</span>
                            <div class="source-actions" onclick="event.stopPropagation(); window.openSourceMenu('${folder.id}', '${url}')">
                                ⋮
                            </div>
                        </div>
                    `;
        }).join('')}
            </div>
        ` : '';

        return `
            <div class="folder-wrapper">
                <div class="folder-item ${isActive ? 'active' : ''}" 
                     onclick="window.switchFolder('${folder.id}')">
                    <span>${folder.name.toUpperCase()}</span>
                    <div class="folder-actions" onclick="event.stopPropagation(); window.openFolderMenu('${folder.id}')">
                        ⋮
                    </div>
                </div>
                ${feedsHtml}
            </div>
        `;
    }).join('');
}

async function loadActiveFolder() {
    if (!feedGrid) return;

    let feedsToLoad = [];
    if (state.activeSource) {
        feedsToLoad = [state.activeSource];
    } else if (state.activeFolder === 'all') {
        state.folders.forEach(f => {
            f.feeds.forEach(feedInfo => {
                feedsToLoad.push(typeof feedInfo === 'string' ? feedInfo : feedInfo.url);
            });
        });
    } else {
        const folder = state.folders.find(f => f.id === state.activeFolder);
        if (folder) feedsToLoad = folder.feeds.map(f => typeof f === 'string' ? f : f.url);
    }

    if (feedsToLoad.length === 0) {
        feedGrid.innerHTML = '<div class="empty">NO_FEEDS_FOUND</div>';
        return;
    }

    feedGrid.innerHTML = '<div class="loading">SYNCING_CORE...</div>';

    const uniqueFeeds = [...new Set(feedsToLoad)];
    const cacheKey = uniqueFeeds.sort().join('|');
    const now = Date.now();

    if (state.feedCache[cacheKey] && (now - state.feedCache[cacheKey].timestamp < 600000)) { // 10 min cache
        state.articles = state.feedCache[cacheKey].data;
        state.displayCount = state.increment;
        renderArticles();
        return;
    }

    // Parallel Fetching
    const fetchPromises = uniqueFeeds.map(async (url) => {
        try {
            const res = await fetch(`${RSS2JSON_API}${encodeURIComponent(url)}`);
            const data = await res.json();
            if (data.status === 'ok') {
                return data.items.map(item => ({ ...item, source: data.feed.title }));
            }
        } catch (e) {
            console.error('Error fetching feed:', url, e);
        }
        return [];
    });

    const results = await Promise.all(fetchPromises);
    const allArticles = results.flat();

    // Sort by date (desc)
    state.articles = allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    // Save to cache
    state.feedCache[cacheKey] = {
        timestamp: now,
        data: state.articles
    };

    state.displayCount = state.increment; // Reset on folder change
    renderArticles();
}

function renderArticles() {
    if (!feedGrid) return;

    let articlesToRender = state.articles;
    if (state.hideRead) {
        articlesToRender = articlesToRender.filter(a => !state.readArticles.has(a.guid || a.link));
    }

    if (articlesToRender.length === 0) {
        feedGrid.innerHTML = '<div class="empty">NO_DATA_DETECTED</div>';
        return;
    }

    const spanOptions = [
        'span-big', 'span-wide', 'span-tall',
        '', '', '', '',
        'span-wide', '', 'span-tall', ''
    ];

    feedGrid.innerHTML = articlesToRender.slice(0, state.displayCount).map((article, index) => {
        const articleId = article.guid || article.link;
        const isRead = state.readArticles.has(articleId);
        let spanClass = spanOptions[Math.floor(Math.random() * spanOptions.length)];
        if (index === 0) spanClass = 'span-big featured';

        const showThumb = state.settings.showThumbnails && (article.thumbnail || article.enclosure?.link);
        const cardClass = `${spanClass} ${isRead ? 'read' : ''} ${!showThumb ? 'no-thumbnail' : ''}`;

        return `
            <div class="article-card ${cardClass}" onclick="window.openArticle(${index})">
                ${showThumb ? `<img class="article-image" src="${article.thumbnail || article.enclosure?.link}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
                <div class="article-info">
                    <div class="article-meta-small">
                        <span>${article.source.toUpperCase()} // ${getTimeAgo(article.pubDate).toUpperCase()}</span>
                    </div>
                    <div class="article-title">${article.title}</div>
                </div>
            </div>
        `;
    }).join('');
}

window.switchSource = (feedUrl) => {
    state.activeSource = feedUrl;
    localStorage.setItem('orbit_active_source', feedUrl);
    renderFolders();
    loadActiveFolder();
};

function showModal(contentHtml) {
    modalContainer.innerHTML = contentHtml;
    modalContainer.classList.remove('hidden');
}

window.closeModal = () => {
    modalContainer.classList.add('hidden');
    modalContainer.innerHTML = '';
};

window.saveFolder = () => {
    const name = document.getElementById('folder-name-input').value.trim();
    if (name) {
        const id = name.toLowerCase().replace(/\s+/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, "");
        state.folders.push({ id, name, feeds: [] });
        saveState();
        renderFolders();
        window.closeModal();
    }
};

window.saveSource = () => {
    const url = document.getElementById('source-url-input').value.trim();
    const name = document.getElementById('source-name-input').value.trim();
    const folderId = document.getElementById('folder-select').value;

    if (url && folderId) {
        const folder = state.folders.find(f => f.id === folderId);
        if (folder) {
            const feedExists = folder.feeds.some(f => (typeof f === 'string' ? f : f.url) === url);
            if (!feedExists) {
                folder.feeds.push({ url, name: name || null });
                saveState();
                if (state.activeFolder === folderId || state.activeFolder === 'all') loadActiveFolder();
            }
            window.closeModal();
        }
    }
};

window.openAddFolderModal = () => {
    showModal(`
        <div class="modal-content">
            <h2 class="display-font">NEW FOLDER</h2>
            <div class="form-group">
                <label>Folder Name (Emojis allowed ✨)</label>
                <input type="text" id="folder-name-input" placeholder="e.g. Cinema 🍿" autofocus>
            </div>
            <div class="modal-actions">
                <button class="btn-secondary" onclick="window.closeModal()">CANCEL</button>
                <button class="btn-primary" onclick="window.saveFolder()">CREATE</button>
            </div>
        </div>
    `);
};

window.openAddSourceModal = () => {
    const options = state.folders.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
    showModal(`
        <div class="modal-content">
            <h2 class="display-font">ADD SOURCE</h2>
            <div class="form-group">
                <label>RSS URL</label>
                <input type="url" id="source-url-input" placeholder="https://site.com/feed" autofocus>
            </div>
            <div class="form-group">
                <label>Custom Name (Optional)</label>
                <input type="text" id="source-name-input" placeholder="e.g. My Tech News">
            </div>
            <div class="form-group">
                <label>Target Folder</label>
                <div style="display: flex; gap: 0.5rem;">
                    <div class="select-wrapper" style="flex: 1;">
                        <select id="folder-select">
                            ${options}
                        </select>
                    </div>
                    <button class="btn-secondary" style="padding: 0.5rem;" onclick="window.openAddFolderModal()">+</button>
                </div>
            </div>
            <div class="modal-actions">
                <button class="btn-secondary" onclick="window.closeModal()">CANCEL</button>
                <button class="btn-primary" onclick="window.saveSource()">ADD FEED</button>
            </div>
        </div>
    `);
};

window.openFolderMenu = (folderId) => {
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) return;

    showModal(`
        <div class="modal-content">
            <h2 class="display-font">MANAGE FOLDER</h2>
            <div class="form-group">
                <label>Rename Folder</label>
                <input type="text" id="rename-input" value="${folder.name}">
            </div>
            <div class="modal-actions">
                <button class="btn-secondary" style="color: #ff4444; border-color: #ff4444;" onclick="window.deleteFolder('${folder.id}')">DELETE</button>
                <div style="flex: 1"></div>
                <button class="btn-secondary" onclick="window.closeModal()">CANCEL</button>
                <button class="btn-primary" onclick="window.saveRename('${folder.id}')">SAVE</button>
            </div>
        </div>
    `);
};

window.openSourceMenu = (folderId, sourceUrl) => {
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) return;
    const feed = folder.feeds.find(f => (typeof f === 'string' ? f : f.url) === sourceUrl);
    if (!feed) return;

    const currentName = (typeof feed === 'object' && feed.name) ? feed.name : sourceUrl.replace('https://', '').split('/')[0];

    showModal(`
        <div class="modal-content">
            <h2 class="display-font">MANAGE SOURCE</h2>
            <div class="form-group">
                <label>Source Name</label>
                <input type="text" id="source-rename-input" value="${currentName}">
            </div>
            <div class="modal-actions">
                <button class="btn-secondary" style="color: #ff4444; border-color: #ff4444;" onclick="window.deleteSource('${folderId}', '${sourceUrl}')">DELETE</button>
                <div style="flex: 1"></div>
                <button class="btn-secondary" onclick="window.closeModal()">CANCEL</button>
                <button class="btn-primary" onclick="window.saveSourceRename('${folderId}', '${sourceUrl}')">SAVE</button>
            </div>
        </div>
    `);
};

window.saveSourceRename = (folderId, url) => {
    const newName = document.getElementById('source-rename-input').value.trim();
    if (newName) {
        const folder = state.folders.find(f => f.id === folderId);
        if (folder) {
            const feedIndex = folder.feeds.findIndex(f => (typeof f === 'string' ? f : f.url) === url);
            if (feedIndex > -1) {
                if (typeof folder.feeds[feedIndex] === 'string') {
                    folder.feeds[feedIndex] = { url: folder.feeds[feedIndex], name: newName };
                } else {
                    folder.feeds[feedIndex].name = newName;
                }
                saveState();
                renderFolders();
                window.closeModal();
            }
        }
    }
};

window.deleteSource = (folderId, url) => {
    if (confirm('Remove this source?')) {
        const folder = state.folders.find(f => f.id === folderId);
        if (folder) {
            folder.feeds = folder.feeds.filter(f => (typeof f === 'string' ? f : f.url) !== url);
            if (state.activeSource === url) state.activeSource = null;
            saveState();
            renderFolders();
            loadActiveFolder();
            window.closeModal();
        }
    }
};

window.saveRename = (id) => {
    const newName = document.getElementById('rename-input').value.trim();
    if (newName) {
        const folder = state.folders.find(f => f.id === id);
        if (folder) folder.name = newName;
        saveState();
        renderFolders();
        window.closeModal();
    }
};

window.deleteFolder = (id) => {
    if (confirm('Delete this folder and all its feeds?')) {
        state.folders = state.folders.filter(f => f.id !== id);
        if (state.activeFolder === id) state.activeFolder = 'all';
        saveState();
        renderFolders();
        loadActiveFolder();
        window.closeModal();
    }
};

window.openSettingsModal = () => {
    showModal(`
        <div class="modal-content">
            <h2 class="display-font">SETTINGS</h2>
            
            <div class="form-group">
                <label>Article Font Size (${state.settings.fontSize}px)</label>
                <input type="range" min="12" max="24" value="${state.settings.fontSize}" 
                    oninput="this.previousElementSibling.innerText='Article Font Size ('+this.value+'px)'; window.updateSetting('fontSize', this.value)">
            </div>

            <div class="form-group toggle-container">
                <label>Show Thumbnails</label>
                <label class="switch">
                    <input type="checkbox" ${state.settings.showThumbnails ? 'checked' : ''} 
                        onchange="window.updateSetting('showThumbnails', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>

            <div class="form-group toggle-container">
                <label>Images in Articles</label>
                <label class="switch">
                    <input type="checkbox" ${state.settings.showImages ? 'checked' : ''} 
                        onchange="window.updateSetting('showImages', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>

            <div class="form-group toggle-container">
                <label>Videos in Articles</label>
                <label class="switch">
                    <input type="checkbox" ${state.settings.showVideos ? 'checked' : ''} 
                        onchange="window.updateSetting('showVideos', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>

            <div class="form-group color-settings">
                <div>
                    <label>Background</label>
                    <input type="color" value="${state.settings.bgColor || '#050505'}" 
                        oninput="window.updateSetting('bgColor', this.value)">
                </div>
                <div>
                    <label>Accent</label>
                    <input type="color" value="${state.settings.accentColor}" 
                        oninput="window.updateSetting('accentColor', this.value)">
                </div>
                <div>
                    <label>Link</label>
                    <input type="color" value="${state.settings.linkColor}" 
                        oninput="window.updateSetting('linkColor', this.value)">
                </div>
            </div>

            <div class="form-group">
                <label>Reader Layout</label>
                <div class="select-wrapper">
                    <select onchange="window.updateSetting('readerWidth', this.value)">
                        <option value="800px" ${state.settings.readerWidth === '800px' ? 'selected' : ''}>Centered (800px)</option>
                        <option value="100%" ${state.settings.readerWidth === '100%' ? 'selected' : ''}>Full Width</option>
                    </select>
                </div>
            </div>

            <div class="modal-actions">
                <button class="btn-primary" onclick="window.closeModal()">CLOSE</button>
            </div>
        </div>
    `);
};

// Global functions for inline handlers
window.switchFolder = (id) => {
    state.activeFolder = id;
    state.activeSource = null; // Reset source filter
    localStorage.setItem('orbit_active_folder', id);
    localStorage.removeItem('orbit_active_source');
    renderFolders();
    loadActiveFolder();
};

window.openArticle = (index) => {
    const article = state.articles[index];
    const articleId = article.guid || article.link;
    state.readArticles.add(articleId);
    saveState();
    renderArticles();

    let content = article.content || article.description;

    // Media Filtering
    if (!state.settings.showImages) {
        content = content.replace(/<img[^>]*>/g, '');
    }
    if (!state.settings.showVideos) {
        content = content.replace(/<video[^>]*>.*?<\/video>/g, '');
        content = content.replace(/<iframe[^>]*src="[^"]*?(youtube|vimeo|dailymotion)[^"]*?"[^>]*><\/iframe>/g, '');
    }

    // Apply current layout
    const isFullWidth = state.settings.readerWidth === '100%';
    readerContent.classList.toggle('full-width', isFullWidth);

    // Update Reader Header (Source button left, Close icon right)
    // Static header in HTML now, just update link
    const header = readerView.querySelector('.reader-header');

    const thumb = article.thumbnail || article.enclosure?.link;
    const thumbHtml = (thumb && state.settings.showThumbnails) ? `
        <a href="${thumb}" target="_blank" title="View full resolution">
            <img src="${thumb}" class="article-main-image" onerror="this.style.display='none'">
        </a>` : '';

    readerContent.innerHTML = `
        <h1 class="display-font">${article.title}</h1>
        <div class="article-meta">${article.source.toUpperCase()} // ${getTimeAgo(article.pubDate).toUpperCase()}</div>
        ${thumbHtml}
        <hr style="margin: 1.5rem 0; opacity: 0.1;">
        <div class="article-full-content">
            ${content}
        </div>
    `;
    externalLink.href = article.link;
    readerView.classList.remove('hidden');
};

// Event Listeners
function setupEventListeners() {
    closeReader.addEventListener('click', (e) => {
        e.stopPropagation();
        readerView.classList.add('hidden');
    });

    addSourceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.openAddSourceModal();
    });

    addFolderBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.openAddFolderModal();
    });

    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.openSettingsModal();
    });

    refreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadActiveFolder();
    });

    hideReadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.hideRead = !state.hideRead;
        localStorage.setItem('orbit_hide_read', state.hideRead);
        applySettings();
        renderArticles();
    });

    markAllReadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Mark all articles in current view as read?')) {
            let articlesInView = state.articles;
            if (state.activeSource) {
                // Filter by active source if any
            }
            articlesInView.forEach(a => state.readArticles.add(a.guid || a.link));
            saveState();
            renderArticles();
        }
    });

    // Close reader or modals on background click
    readerView.addEventListener('click', (e) => {
        if (e.target === readerView) readerView.classList.add('hidden');
    });

    modalContainer.addEventListener('click', (e) => {
        if (e.target === modalContainer) window.closeModal();
    });

    // Keyboard navigation
    let selectedIndex = -1;
    document.addEventListener('keydown', (e) => {
        // Don't trigger shortcuts if user is typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

        if (e.key === 'j') { // Next
            selectedIndex = Math.min(selectedIndex + 1, state.displayCount - 1, state.articles.length - 1);
            window.openArticle(selectedIndex);
        } else if (e.key === 'k') { // Previous
            selectedIndex = Math.max(selectedIndex - 1, 0);
            window.openArticle(selectedIndex);
        } else if (e.key === 'Escape') {
            readerView.classList.add('hidden');
            window.closeModal();
        }
    });

    // Infinite Scroll
    const feedContainer = document.querySelector('.feed-container');
    if (feedContainer) {
        feedContainer.addEventListener('scroll', () => {
            if (feedContainer.scrollTop + feedContainer.clientHeight >= feedContainer.scrollHeight - 100) {
                if (state.displayCount < state.articles.length) {
                    state.displayCount += state.increment;
                    renderArticles();
                }
            }
        });
    }
}

function saveState() {
    localStorage.setItem('orbit_folders', JSON.stringify(state.folders));
    localStorage.setItem('orbit_settings', JSON.stringify(state.settings));
    localStorage.setItem('orbit_read_articles', JSON.stringify([...state.readArticles]));
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
