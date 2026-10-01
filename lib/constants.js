export const UUID = 'shadow-panel@shadowokx';
export const APP_VERSION = '3.1.2';
export const MODULE_IDS = Object.freeze(['codex', 'claude', 'opencode', 'commandcode', 'deepseek', 'glm', 'gemini', 'weather']);
export const VISIBLE_CODEX_REFRESH_INTERVAL = 30;
export const BACKGROUND_CODEX_REFRESH_INTERVAL = 60;
export const CODEX_TIMED_LABEL_INTERVAL = 10;

export const ACCENTS = Object.freeze({
    purple: '#8b5cf6',
    blue: '#3b82f6',
    cyan: '#06b6d4',
    emerald: '#10b981',
    orange: '#f97316',
    amber: '#f59e0b',
    rose: '#f43f5e',
    graphite: '#64748b',
    teal: '#14b8a6',
    pink: '#ec4899',
    red: '#ef4444',
    indigo: '#6366f1',
    lime: '#84cc16',
});

export const AI_IDS = Object.freeze(MODULE_IDS.filter(id => id !== 'weather'));

export const MODULE_META = Object.freeze({
    codex: {name: 'ChatGPT Codex', icon: 'system-run-symbolic'},
    claude: {name: 'Claude', icon: 'application-x-executable-symbolic', url: 'https://claude.ai/settings/usage'},
    opencode: {name: 'OpenCode', icon: 'utilities-terminal-symbolic', url: 'https://opencode.ai/zen'},
    commandcode: {name: 'Command Code', icon: 'utilities-terminal-symbolic', url: 'https://commandcode.ai'},
    deepseek: {name: 'DeepSeek', icon: 'application-x-executable-symbolic', url: 'https://platform.deepseek.com'},
    glm: {name: 'GLM · Z.ai', icon: 'application-x-executable-symbolic', url: 'https://z.ai/manage-apikey/subscription'},
    gemini: {name: 'Gemini', icon: 'application-x-executable-symbolic', url: 'https://aistudio.google.com/usage'},
    weather: {name: 'Weather', icon: 'weather-clear-symbolic'},
});
