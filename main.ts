// The harness driver: node runs this file (node22) with the cases at /input/cases.json, a JSON array of {id, input}.
// Each case is answered on its own by run() from ./solve.js, and the answers go to /output/answers.json as a JSON
// array, one per case and in the cases' order. Outside a container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand
// in for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// The house driver turns V8's incremental marking off before solve.js is imported, and the rules let an entry do
// the same; the parse builds a great many short strings, and marking them a step at a time is pure cost.
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const answers = new Array(cases.length);
for (let i = 0; i < cases.length; i++) answers[i] = run(cases[i].input);
// The scorer lines the answers up with the cases one for one: a short file would fail every case after the gap
// silently, so refuse to write one.
if (answers.length !== cases.length) throw new Error(`answered ${answers.length} of ${cases.length} cases`);
writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
