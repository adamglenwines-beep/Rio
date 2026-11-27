// `node --test tests/unit/` (Node 22+) treats the directory as a module and loads this file,
// so import every suite from here. Prefer `node --test tests/unit/*.test.js`.
import './geom.test.js';
import './noise.test.js';
import './terrain.test.js';
import './paths.test.js';
import './access.test.js';
import './growth.test.js';
import './assets.test.js';
