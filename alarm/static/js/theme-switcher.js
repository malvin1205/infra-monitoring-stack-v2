/**
 * InfraWatch — Theme Modes & Figma Design Tokens Engine
 * Style 1 (Light Mode) & Style 2 (Dark Mode)
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'infrawatch_theme_mode';

  const THEMES = {
    'light': {
      id: 'light',
      name: 'Light Mode',
      subtitle: 'Style 1 Design Tokens',
      file: 'Style 1.tokens.json',
      icon: '☀️',
      vars: {
        '--bg': '#F1F5F9',
        '--bg2': '#F8FAFC',
        '--surface': '#FFFFFF',
        '--surface-hover': '#E2E8F0',
        '--border': '#CBD5E1',
        '--border-strong': '#94A3B8',
        '--text': '#0F172A',
        '--text-alt': '#1E293B',
        '--text-2': '#475569',
        '--text-3': '#64748B',
        '--white': '#FFFFFF',
        '--black': '#000000',
        '--blue': '#0EA5E9',
        '--blue-dark': '#0284C7',
        '--blue-light': '#BAE6FD',
        '--blue-subtle': '#F0F9FF',
        '--blue-bg': '#E0F2FE',
        '--blue-dim': 'rgba(14, 165, 233, 0.12)',
        '--red': '#F43F5E',
        '--red-dark': '#E11D48',
        '--red-subtle': '#FFF1F2',
        '--red-dim': 'rgba(244, 63, 94, 0.12)',
        '--red-glow': 'rgba(244, 63, 94, 0.35)',
        '--yellow': '#F59E0B',
        '--yellow-dark': '#D97706',
        '--yellow-subtle': '#FEF3C7',
        '--yellow-dim': 'rgba(245, 158, 11, 0.12)',
        '--amber': '#D97706',
        '--amber-dark': '#B45309',
        '--amber-subtle': '#FEF3C7',
        '--amber-dim': 'rgba(217, 119, 6, 0.12)',
        '--green': '#10B981',
        '--green-dark': '#059669',
        '--green-subtle': '#ECFDF5',
        '--green-dim': 'rgba(16, 185, 129, 0.12)',
        '--green-glow': 'rgba(16, 185, 129, 0.35)',
        '--purple': '#8B5CF6',
        '--purple-dark': '#7C3AED',
        '--purple-subtle': '#F5F3FF',
        '--purple-dim': 'rgba(139, 92, 246, 0.12)',
        '--orange': '#F97316',
        '--orange-dark': '#C2410C',
        '--orange-dim': 'rgba(249, 115, 22, 0.12)',
        '--teal': '#0EA5E9',
        '--teal-dim': 'rgba(14, 165, 233, 0.12)',
        '--teal-glow': 'rgba(14, 165, 233, 0.35)',
        '--status-success': '#10B981',
        '--status-warning': '#F59E0B',
        '--status-error': '#F43F5E',
        '--status-info': '#0EA5E9',
        '--status-success-subtle': '#ECFDF5',
        '--status-warning-subtle': '#FEF3C7',
        '--status-error-subtle': '#FFF1F2',
        '--status-info-subtle': '#F0F9FF',
        '--t-neutral': 'rgba(15, 23, 42, 0.05)',
        '--t-blue': 'rgba(14, 165, 233, 0.08)',
        '--t-green': 'rgba(16, 185, 129, 0.08)',
        '--t-red': 'rgba(244, 63, 94, 0.08)',
        '--t-yellow': 'rgba(245, 158, 11, 0.08)',
        '--t-purple': 'rgba(139, 92, 246, 0.08)'
      }
    },

    'dark': {
      id: 'dark',
      name: 'Dark Mode',
      subtitle: 'Style 2 Design Tokens',
      file: 'Style 2.tokens.json',
      icon: '🌙',
      vars: {
        '--bg': '#0B0F19',
        '--bg2': '#111827',
        '--surface': '#1F2937',
        '--surface-hover': '#374151',
        '--border': '#4B5563',
        '--border-strong': '#6B7280',
        '--text': '#F9FAFB',
        '--text-alt': '#F3F4F6',
        '--text-2': '#E5E7EB',
        '--text-3': '#9CA3AF',
        '--white': '#FFFFFF',
        '--black': '#000000',
        '--blue': '#6366F1',
        '--blue-dark': '#4F46E5',
        '--blue-light': '#C7D2FE',
        '--blue-subtle': '#312E81',
        '--blue-bg': '#1E1B4B',
        '--blue-dim': 'rgba(99, 102, 241, 0.20)',
        '--red': '#FF2E93',
        '--red-dark': '#DB2777',
        '--red-subtle': '#831843',
        '--red-dim': 'rgba(255, 46, 147, 0.20)',
        '--red-glow': 'rgba(255, 46, 147, 0.50)',
        '--yellow': '#FACC15',
        '--yellow-dark': '#CA8A04',
        '--yellow-subtle': '#713F12',
        '--yellow-dim': 'rgba(250, 204, 21, 0.20)',
        '--amber': '#F59E0B',
        '--amber-dark': '#D97706',
        '--amber-subtle': '#78350F',
        '--amber-dim': 'rgba(245, 158, 11, 0.20)',
        '--green': '#00FF9D',
        '--green-dark': '#059669',
        '--green-subtle': '#064E3B',
        '--green-dim': 'rgba(0, 255, 157, 0.20)',
        '--green-glow': 'rgba(0, 255, 157, 0.50)',
        '--purple': '#C084FC',
        '--purple-dark': '#9333EA',
        '--purple-subtle': '#581C87',
        '--purple-dim': 'rgba(192, 132, 252, 0.20)',
        '--orange': '#FF7A00',
        '--orange-dark': '#EA580C',
        '--orange-dim': 'rgba(255, 122, 0, 0.20)',
        '--teal': '#00FF9D',
        '--teal-dim': 'rgba(0, 255, 157, 0.20)',
        '--teal-glow': 'rgba(0, 255, 157, 0.50)',
        '--status-success': '#00FF9D',
        '--status-warning': '#FACC15',
        '--status-error': '#FF2E93',
        '--status-info': '#6366F1',
        '--status-success-subtle': '#064E3B',
        '--status-warning-subtle': '#713F12',
        '--status-error-subtle': '#831843',
        '--status-info-subtle': '#312E81',
        '--t-neutral': 'rgba(255, 255, 255, 0.10)',
        '--t-blue': 'rgba(99, 102, 241, 0.12)',
        '--t-green': 'rgba(0, 255, 157, 0.12)',
        '--t-red': 'rgba(255, 46, 147, 0.12)',
        '--t-yellow': 'rgba(250, 204, 21, 0.12)',
        '--t-purple': 'rgba(192, 132, 252, 0.12)'
      }
    }
  };

  let currentThemeKey = 'dark';

  function applyTheme(themeKey, save = true) {
    if (themeKey === 'style1') themeKey = 'light';
    if (themeKey === 'style2') themeKey = 'dark';
    if (!THEMES[themeKey]) themeKey = 'dark';

    const theme = THEMES[themeKey];
    currentThemeKey = themeKey;

    const root = document.documentElement;
    root.setAttribute('data-theme', themeKey);

    Object.entries(theme.vars).forEach(([prop, val]) => {
      root.style.setProperty(prop, val);
    });

    if (save) {
      try {
        localStorage.setItem(STORAGE_KEY, themeKey);
      } catch (e) {
        console.warn('Could not save theme to localStorage:', e);
      }
    }

    updateActiveThemeUI(theme);
  }

  function toggleTheme() {
    const nextTheme = currentThemeKey === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme, true);
  }

  function updateActiveThemeUI(theme) {
    const currentThemeLabel = document.getElementById('currentThemeLabel');
    const currentThemeIcon = document.getElementById('currentThemeIcon');
    const sidebarThemeIcon = document.getElementById('sidebarThemeIcon');
    const sidebarThemeText = document.getElementById('sidebarThemeText');

    if (currentThemeLabel) currentThemeLabel.textContent = theme.name;
    if (currentThemeIcon) currentThemeIcon.textContent = theme.icon;
    if (sidebarThemeIcon) sidebarThemeIcon.textContent = theme.icon;
    if (sidebarThemeText) sidebarThemeText.textContent = theme.name;
  }

  function initThemeUI() {
    const theme = THEMES[currentThemeKey] || THEMES['dark'];
    updateActiveThemeUI(theme);

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const sidebarThemeBtn = document.getElementById('sidebarThemeBtn');

    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleTheme();
      });
    }

    if (sidebarThemeBtn) {
      sidebarThemeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleTheme();
      });
    }
  }

  try {
    const savedTheme = localStorage.getItem(STORAGE_KEY) || 'dark';
    applyTheme(savedTheme, false);
  } catch (e) {
    applyTheme('dark', false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeUI);
  } else {
    initThemeUI();
  }

  window.InfraWatchTheme = {
    getThemes: () => THEMES,
    getCurrentTheme: () => THEMES[currentThemeKey],
    setTheme: applyTheme,
    toggleTheme: toggleTheme
  };
})();
