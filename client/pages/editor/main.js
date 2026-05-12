import '../../styles/editor.css';
import '../../styles/viewer.css';
import { loadScript } from '../../core/load-script.js';

await loadScript('/vendor/exifr/full.umd.js');
await loadScript('/vendor/markdown-it/dist/markdown-it.min.js');
await import('./legacy-editor.js');
