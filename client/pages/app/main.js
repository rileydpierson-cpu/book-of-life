import '../../styles/app.css';
import { loadScript } from '../../core/load-script.js';

await loadScript('/vendor/exifr/full.umd.js');
await import('./legacy-app.js');
