import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RULES } from '../skills/design-audit/scripts/lib/lint-rules.mjs';
import { lint } from '../skills/design-audit/scripts/lint.mjs';

// Each rule: lines that carry the tell, and near misses that must stay quiet. A rule that runs in app mode only is
// checked in app mode; the rest in both modes.
const CASES = {
  'side-tab': {
    flag: ['.card { border-left: 4px solid var(--accent); }', '<div class="border-l-4 border-blue-500 p-4">', '.note { border-inline-start: 3px solid teal; }'],
    pass: ['.card { border-left: 1px solid #ddd; }', '<div class="border-l border-gray-200">', '<div class="border-l-2">'],
  },
  'border-accent-on-rounded': {
    flag: ['<div class="rounded-xl border-t-4 border-emerald-500">', '.card { border-radius: 12px; border-top: 3px solid teal; }', '<div className={cn("rounded-xl border-t-4")}>', '<div className={`rounded-xl border-t-4`}>', '.card { border-radius: 0.5rem; border-top: 4px solid red; }', '.card { border-radius: .5rem; border-top: 4px solid red; }'],
    pass: ['<div class="rounded-none border-t-4">', '.card { border-radius: 0; border-top: 4px solid red; }', '<div class="rounded-lg border-t-[1px] border-teal-500">', '<div class="rounded-xl border">', '.card { border-radius: 12px; border-top: 1px solid #eee; }', '<div class="border-t-4 p-4">'],
  },
  'bounce-easing': {
    flag: ['.btn { transition: transform .3s cubic-bezier(.34,1.56,.64,1); }', '.x { transition: all 1s cubic-bezier(0.5,-0.4,0.5,1); }', '.pop { animation: bounce-in 600ms; }', '.drawer { animation-timing-function: elastic; }', '.toast { animation: springy 1s; }'],
    pass: ['.y { transition: opacity 1s cubic-bezier(0.2, 0, 0, 1); }', '.y { transition: opacity 1s cubic-bezier(0.4, 0.1, 0.2, 1.1); }', '.pop { animation: fade-in 200ms ease-out; }', '.btn { transition: transform 150ms ease-out; }'],
  },
  'dark-glow': {
    flag: ['.cta { box-shadow: 0 0 24px #22d3ee; }', '.title { text-shadow: 0 0 12px rgba(168, 85, 247, 0.8); }', '<button class="shadow-cyan-500/50">', '<div class="shadow-[0_0_20px_#22d3ee]">'],
    pass: ['.menu { box-shadow: 0 0 8px rgba(0, 0, 0, 0.2); }', '.lift { box-shadow: 0 0 16px white; }', '.lift { box-shadow: 0 0 16px rgba(255, 255, 255, 0.4); }', '.m { box-shadow: 0 0 8px rgb(0 0 0 / 0.2); }', '.m { box-shadow: 0 0 8px #00000033; }', '.m { box-shadow: 0 0 8px #0003; }', '<div class="shadow-[0_0_12px_#0003]">', '.card { box-shadow: 0 4px 12px #0003; }', '<div class="shadow-lg">', '<div class="shadow-black/20">'],
  },
  'radial-halo': {
    flag: ['.hero { background: radial-gradient(circle at 50% 0, #7c3aed66, transparent 60%); }', '.glow { background: radial-gradient(#22d3ee, rgba(34, 211, 238, 0)); }'],
    pass: ['.dot { background: radial-gradient(#111 1px, #fff 1px); }', '.grid { background-image: radial-gradient(#ccc 1px, transparent 1px); }', '.grid { background-image: radial-gradient(circle, rgba(0,0,0,.2) 24px, transparent 24px); }', '.hero { background: linear-gradient(#000, transparent); }'],
  },
  marquee: {
    flag: ['<marquee>Breaking news</marquee>', '.logos { animation: marquee 30s linear infinite; }', '<div class="animate-marquee">', '@keyframes ticker {'],
    pass: ['.logos { display: flex; gap: 32px; }', '<div class="animate-spin">'],
  },
  'blinking-cursor': {
    flag: ['@keyframes blink { 50% { opacity: 0; } }', '.caret { animation: caret-blink 1s steps(1) infinite; }', '<span class="typewriter">'],
    pass: ['.caret-input { caret-color: var(--accent); }', '.cursor { cursor: pointer; }'],
  },
  'extreme-negative-tracking': {
    flag: ['h1 { letter-spacing: -0.1em; }', 'h1 { letter-spacing: -0.095em; }', '<h1 class="tracking-[-0.12em]">'],
    pass: ['h1 { letter-spacing: -0.05em; }', 'h1 { letter-spacing: -0.09em; }', '<h1 class="tracking-tighter">', 'p { letter-spacing: 0.1em; }'],
  },
  'justified-text': {
    flag: ['.body { text-align: justify; }', '<p class="text-justify">'],
    pass: ['.body { text-align: left; }', '<p class="text-left">'],
  },
  'repeating-stripes-gradient': {
    flag: ['.panel { background: repeating-linear-gradient(45deg, #eee 0 4px, #fff 4px 8px); }'],
    pass: ['.panel { background: linear-gradient(#eee, #fff); }'],
  },
  'organic-clip-path': {
    flag: [
      '.blob { clip-path: polygon(10% 0, 30% 5%, 50% 0, 70% 6%, 90% 0, 100% 40%, 92% 70%, 100% 100%, 50% 94%, 0 100%); }',
      ".shape { clip-path: path('M0 0 C 40 10, 60 10, 100 0 L 100 100 Z'); }",
    ],
    pass: ['.nine { clip-path: polygon(0% 0%, 75% 0%, 100% 25%, 100% 100%, 25% 100%, 0% 75%, 0% 40%, 8% 30%, 0% 20%); }', '.tri { clip-path: polygon(50% 0, 100% 100%, 0 100%); }', '.avatar { clip-path: circle(50%); }', ".flat { clip-path: path('M0 0 L 100 0 L 100 100 Z'); }"],
  },
  'hard-offset-shadow': {
    flag: ['.btn { box-shadow: 4px 4px 0 #000; }', '.btn { box-shadow: 4px 4px #000; }', '.btn { box-shadow: -6px 6px var(--ink); }', '<button class="shadow-[4px_4px_0_#000]">', '.card { box-shadow: 0 6px 0px var(--ink); }', '.btn { box-shadow: 4px 4px 0px 0px rgba(0,0,0,1); }', '.btn { box-shadow: 4px 4px 0 0 #000; }'],
    pass: ['.btn { box-shadow: 2px 2px 0 #000; }', '.card { box-shadow: 4px 4px 8px #000; }', '.card { box-shadow: 4px 4px 8px 0 #000; }', '.card { box-shadow: 0 4px 12px #0002; }', '.card { box-shadow: 0 6px 12px #0002; }', '.ring { box-shadow: 0 0 0 4px var(--focus); }'],
  },
  'theater-slop-phrase': {
    flag: ['<p>Most audits are security theater.</p>', "const lead = 'No more compliance theatre';"],
    pass: ['<p>Tickets for the theater go on sale today.</p>', '// security theater is out of scope for this module', 'const securityTheater = 1;'],
  },
};

const APP_ONLY = new Set(['dark-glow', 'radial-halo', 'repeating-stripes-gradient', 'hard-offset-shadow']);
const EXTENSION = (line) => (line.startsWith('<') ? 'html' : /^(const|\/\/)/.test(line) ? 'ts' : 'css');

function findings(line, mode) {
  const dir = mkdtempSync(join(tmpdir(), 'impeccable-rules-'));
  try {
    writeFileSync(join(dir, `case.${EXTENSION(line)}`), `${line}\n`);
    return lint([dir], { mode }).findings;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const [rule, { flag, pass }] of Object.entries(CASES)) {
  const modes = APP_ONLY.has(rule) ? ['app'] : ['app', 'site'];
  for (const mode of modes) {
    test(`${rule} (${mode}) flags the tell`, () => {
      for (const line of flag) assert.ok(findings(line, mode).some((f) => f.id === rule), `${rule} missed: ${line}`);
    });
    test(`${rule} (${mode}) passes the near miss`, () => {
      for (const line of pass) assert.ok(!findings(line, mode).some((f) => f.id === rule), `${rule} fired on: ${line}`);
    });
  }
}

test('rules the site house rules already ban stay out of site mode', () => {
  for (const rule of APP_ONLY) assert.ok(!findings(CASES[rule].flag[0], 'site').some((f) => f.id === rule), rule);
});

test('a repeat run over the same files gives the same findings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'impeccable-repeat-'));
  writeFileSync(join(dir, 'all.css'), Object.values(CASES).flatMap((c) => c.flag.filter((l) => !l.startsWith('<') && !/^(const|\/\/)/.test(l))).join('\n'));
  writeFileSync(join(dir, 'all.html'), Object.values(CASES).flatMap((c) => c.flag.filter((l) => l.startsWith('<'))).join('\n'));
  try {
    assert.deepEqual(lint([dir]), lint([dir]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Backtracking regexes stall the audit on one long line, so each ported rule must stay linear on near misses.
test('every ported rule answers fast on long near-miss lines', () => {
  const ported = new Set(Object.keys(CASES));
  const near = [
    `.x { clip-path: polygon(${Array.from({ length: 9 }, () => '10.5% 20.5%').join(', ')}); }`,
    `.x { clip-path: polygon(${Array.from({ length: 9 }, () => '12.34% 56.78%').join(', ')}); }`,
    `.x { box-shadow: ${'0 0 1px '.repeat(200)}; }`,
    `.x { transition: ${'cubic-bezier(0.1, 0.1, 0.1, 0.1) '.repeat(200)}; }`,
    `<div class="${'rounded border-t-1 '.repeat(200)}">`,
    `.x { letter-spacing: -${'0'.repeat(500)}em; }`,
  ];
  for (const rule of RULES.filter((r) => ported.has(r.id))) {
    for (const line of near) {
      const started = process.hrtime.bigint();
      rule.re.test(line);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      assert.ok(ms < 50, `${rule.id} took ${ms.toFixed(1)} ms on: ${line.slice(0, 60)}`);
    }
  }
});
