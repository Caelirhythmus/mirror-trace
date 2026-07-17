/**
 * Mirror Trace — Theme definitions
 *
 * Each theme provides a full set of CSS colour values.
 * The active theme is persisted in localStorage under 'mirror-trace-theme'.
 */

export interface Theme {
  name: string;
  label: string;
  /** Preview colour shown in the theme selector dot */
  dot: string;
  vars: Record<string, string>;
}

export const themes: Theme[] = [
  {
    name: 'dark-blue',
    label: '深蓝',
    dot: '#4a9eff',
    vars: {
      'bg-app': '#1a1a2e',
      'bg-panel': '#12122a',
      'bg-canvas': '#0f0f1a',
      'bg-sidebar': 'rgba(18,18,42,0.92)',
      'bg-chart': '#0a0a18',
      'bg-progress': '#1a1a3a',
      'bg-button': '#1a1a3a',
      'bg-button-hover': '#2a2a5a',
      'bg-button-danger-hover': '#3a1a2a',
      'bg-toggle-off': '#3a3a5a',
      'bg-toggle-on': '#4a6a9a',
      'text-primary': '#e0e0e0',
      'text-title': '#a0a0c0',
      'text-dim': '#8080a0',
      'text-muted': '#606080',
      'text-debug': '#505060',
      'text-coverage': '#707090',
      'text-score': '#a0d0ff',
      'text-strong': '#c0c0e0',
      'text-button': '#8080a0',
      'text-button-hover': '#c0c0e0',
      'text-danger-hover': '#d06060',
      'text-chart-label': '#404060',
      'text-chart-label2': '#505068',
      'border': '#2a2a4a',
      'border-light': '#3a3a5a',
      'border-canvas': '#333',
      'border-button-hover': '#5a5a8a',
      'border-danger-hover': '#6a3a3a',
      'border-eval': '#2a4a2a',
      'accent': '#4a9eff',
      'accent-bright': '#a0d0ff',
      'accent-green': '#50c878',
      'accent-gold': '#ffd700',
      'stroke-default': '#ff6b6b',
      'stroke-replay': '#ff4d4d',
      'stroke-processed': 'rgba(255,255,100,0.45)',
      'progress-start': '#555',
      'progress-end': '#50c878',
      'toggle-knob-off': '#8080a0',
      'toggle-knob-on': '#a0d0ff',
      'heatmap-color': 'rgba(74,158,255,0.10)',
      'heatmap-line': 'rgba(74,158,255,0.08)',
    },
  },
  {
    name: 'light',
    label: '浅色',
    dot: '#f5f5f7',
    vars: {
      'bg-app': '#f5f5f7',
      'bg-panel': '#ffffff',
      'bg-canvas': '#e8e8ec',
      'bg-sidebar': 'rgba(255,255,255,0.95)',
      'bg-chart': '#f0f0f4',
      'bg-progress': '#d0d0d8',
      'bg-button': '#e0e0e6',
      'bg-button-hover': '#d0d0d8',
      'bg-button-danger-hover': '#f0d0d0',
      'bg-toggle-off': '#c0c0c8',
      'bg-toggle-on': '#4a9eff',
      'text-primary': '#1a1a2e',
      'text-title': '#505068',
      'text-dim': '#707090',
      'text-muted': '#9090a0',
      'text-debug': '#b0b0b8',
      'text-coverage': '#707090',
      'text-score': '#4a6a9a',
      'text-strong': '#2a2a4a',
      'text-button': '#505068',
      'text-button-hover': '#1a1a2e',
      'text-danger-hover': '#c04040',
      'text-chart-label': '#9090a0',
      'text-chart-label2': '#a0a0b0',
      'border': '#d0d0d8',
      'border-light': '#c0c0c8',
      'border-canvas': '#c0c0c8',
      'border-button-hover': '#a0a0b0',
      'border-danger-hover': '#c06060',
      'border-eval': '#b0d0b0',
      'accent': '#4a9eff',
      'accent-bright': '#4a6a9a',
      'accent-green': '#40a868',
      'accent-gold': '#d4a000',
      'stroke-default': '#e05050',
      'stroke-replay': '#cc3333',
      'stroke-processed': 'rgba(200,200,50,0.50)',
      'progress-start': '#c0c0c8',
      'progress-end': '#40a868',
      'toggle-knob-off': '#808090',
      'toggle-knob-on': '#4a9eff',
      'heatmap-color': 'rgba(74,158,255,0.12)',
      'heatmap-line': 'rgba(74,158,255,0.10)',
    },
  },
  {
    name: 'dark-green',
    label: '墨绿',
    dot: '#50c878',
    vars: {
      'bg-app': '#0f1a0f',
      'bg-panel': '#0a140a',
      'bg-canvas': '#0a100a',
      'bg-sidebar': 'rgba(10,20,10,0.92)',
      'bg-chart': '#060e06',
      'bg-progress': '#142014',
      'bg-button': '#142014',
      'bg-button-hover': '#1e301e',
      'bg-button-danger-hover': '#2a1414',
      'bg-toggle-off': '#2a3a2a',
      'bg-toggle-on': '#3a7a3a',
      'text-primary': '#c0d0c0',
      'text-title': '#70a070',
      'text-dim': '#508050',
      'text-muted': '#406040',
      'text-debug': '#305030',
      'text-coverage': '#508050',
      'text-score': '#70d070',
      'text-strong': '#a0d0a0',
      'text-button': '#508050',
      'text-button-hover': '#80b080',
      'text-danger-hover': '#d06060',
      'text-chart-label': '#305030',
      'text-chart-label2': '#406040',
      'border': '#1e301e',
      'border-light': '#2a3a2a',
      'border-canvas': '#1a2a1a',
      'border-button-hover': '#4a7a4a',
      'border-danger-hover': '#6a3a3a',
      'border-eval': '#2a4a2a',
      'accent': '#50c878',
      'accent-bright': '#70d070',
      'accent-green': '#50c878',
      'accent-gold': '#ffd700',
      'stroke-default': '#ff6b6b',
      'stroke-replay': '#ff4d4d',
      'stroke-processed': 'rgba(255,255,100,0.45)',
      'progress-start': '#2a3a2a',
      'progress-end': '#50c878',
      'toggle-knob-off': '#508050',
      'toggle-knob-on': '#70d070',
      'heatmap-color': 'rgba(80,200,120,0.10)',
      'heatmap-line': 'rgba(80,200,120,0.08)',
    },
  },
  {
    name: 'dark-purple',
    label: '暮紫',
    dot: '#b388ff',
    vars: {
      'bg-app': '#1a0f2e',
      'bg-panel': '#140a24',
      'bg-canvas': '#0f081a',
      'bg-sidebar': 'rgba(20,10,36,0.92)',
      'bg-chart': '#0a0614',
      'bg-progress': '#241a3a',
      'bg-button': '#241a3a',
      'bg-button-hover': '#322a4a',
      'bg-button-danger-hover': '#2a1414',
      'bg-toggle-off': '#3a2a5a',
      'bg-toggle-on': '#6a4a9a',
      'text-primary': '#d0c0e0',
      'text-title': '#a080c0',
      'text-dim': '#8060a0',
      'text-muted': '#604080',
      'text-debug': '#503070',
      'text-coverage': '#8060a0',
      'text-score': '#b388ff',
      'text-strong': '#c0a0e0',
      'text-button': '#8060a0',
      'text-button-hover': '#b090d0',
      'text-danger-hover': '#d06060',
      'text-chart-label': '#503070',
      'text-chart-label2': '#604080',
      'border': '#2a1a4a',
      'border-light': '#3a2a5a',
      'border-canvas': '#1a0f2e',
      'border-button-hover': '#5a4a7a',
      'border-danger-hover': '#6a3a3a',
      'border-eval': '#3a2a4a',
      'accent': '#b388ff',
      'accent-bright': '#c0a0ff',
      'accent-green': '#50c878',
      'accent-gold': '#ffd700',
      'stroke-default': '#ff6b6b',
      'stroke-replay': '#ff4d4d',
      'stroke-processed': 'rgba(255,255,100,0.45)',
      'progress-start': '#3a2a5a',
      'progress-end': '#50c878',
      'toggle-knob-off': '#8060a0',
      'toggle-knob-on': '#b388ff',
      'heatmap-color': 'rgba(179,136,255,0.10)',
      'heatmap-line': 'rgba(179,136,255,0.08)',
    },
  },
  {
    name: 'gray',
    label: '现代',
    dot: '#888',
    vars: {
      'bg-app': '#1a1a1a',
      'bg-panel': '#222222',
      'bg-canvas': '#111111',
      'bg-sidebar': 'rgba(30,30,30,0.95)',
      'bg-chart': '#0d0d0d',
      'bg-progress': '#2a2a2a',
      'bg-button': '#2a2a2a',
      'bg-button-hover': '#3a3a3a',
      'bg-button-danger-hover': '#2a1414',
      'bg-toggle-off': '#3a3a3a',
      'bg-toggle-on': '#5a5a5a',
      'text-primary': '#d0d0d0',
      'text-title': '#999',
      'text-dim': '#777',
      'text-muted': '#666',
      'text-debug': '#555',
      'text-coverage': '#777',
      'text-score': '#bbb',
      'text-strong': '#bbb',
      'text-button': '#777',
      'text-button-hover': '#bbb',
      'text-danger-hover': '#d06060',
      'text-chart-label': '#444',
      'text-chart-label2': '#555',
      'border': '#333',
      'border-light': '#3a3a3a',
      'border-canvas': '#2a2a2a',
      'border-button-hover': '#5a5a5a',
      'border-danger-hover': '#6a3a3a',
      'border-eval': '#3a3a3a',
      'accent': '#888',
      'accent-bright': '#aaa',
      'accent-green': '#6a6',
      'accent-gold': '#cc0',
      'stroke-default': '#ff6b6b',
      'stroke-replay': '#ff4d4d',
      'stroke-processed': 'rgba(255,255,100,0.45)',
      'progress-start': '#3a3a3a',
      'progress-end': '#6a6',
      'toggle-knob-off': '#777',
      'toggle-knob-on': '#aaa',
      'heatmap-color': 'rgba(150,150,150,0.12)',
      'heatmap-line': 'rgba(150,150,150,0.08)',
    },
  },
];

export const THEME_STORAGE_KEY = 'mirror-trace-theme';

/** Apply a theme by setting CSS custom properties on :root */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.vars)) {
    root.style.setProperty(`--${key}`, value);
  }
}

/** Load the saved theme name from localStorage */
export function loadThemeName(): string {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || 'dark-blue';
  } catch {
    return 'dark-blue';
  }
}

/** Save the theme name to localStorage */
export function saveThemeName(name: string): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, name);
  } catch {
    /* localStorage may be unavailable */
  }
}

/** Find a theme by name */
export function findTheme(name: string): Theme | undefined {
  return themes.find(t => t.name === name);
}
