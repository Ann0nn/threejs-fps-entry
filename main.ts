// SUNFALL's entrypoint (Node 22, standard library only): the program that
// hands the game in. It copies this repository's game/ and screenshots/ to
// /output and writes /output/dossier.json — the summary the judge reads — with
// the kit's vendored make.fun library, unchanged.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Serve the game locally to play it: any static file server over game/, then
// open index.html in desktop Chrome. The screenshots in screenshots/ were
// posed with the game's own demo mode (?shot=buy|firefight|plant|defuse).

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps, passed through so this program fails where the
// scorer would: the text cap shapes the dossier's bytes; the rest refuse an
// entry the gate would refuse (more than 4 screenshots or one over 256 KiB;
// game/ over 993 entries or 48 MiB).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
