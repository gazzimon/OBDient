#!/usr/bin/env node
/**
 * CARpsy-v2 Evaluation Script
 *
 * Tests the model against 5 diagnostic scenarios before integrating into the app.
 * Requires llama.cpp CLI or Ollama installed.
 *
 * Usage:
 *   node scripts/eval-carpsy.js --backend ollama
 *   node scripts/eval-carpsy.js --backend llamacpp --model ./path/to/CARpsy-v2-qwen3-0.6b.Q4_K_M.gguf
 */

const { execSync, spawn } = require('child_process');
const path = require('path');

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const backend  = args.includes('--backend') ? args[args.indexOf('--backend') + 1] : 'ollama';
const modelArg = args.includes('--model')   ? args[args.indexOf('--model') + 1]   : null;

const OLLAMA_MODEL = 'hf.co/gazzimon/CARpsy-v2-qwen3-0.6b-GGUF:Q4_K_M';
const LLAMACPP_BIN = args.includes('--llamacpp-bin') ? args[args.indexOf('--llamacpp-bin') + 1] : 'llama-cli';

const SYSTEM_PROMPT =
  'You are OBDient, an expert automotive diagnostic assistant. ' +
  'You receive real-time OBD-II vehicle data and fault codes. ' +
  'Provide concise, accurate diagnostic interpretations and actionable repair guidance. ' +
  'Never fabricate DTC definitions. If unsure, say so.';

// ─── Test cases ──────────────────────────────────────────────────────────────
const TEST_CASES = [
  {
    id: 'TC-01',
    name: 'Simple single DTC',
    description: 'P0420 alone — expects catalyst efficiency diagnosis',
    prompt: 'Vehicle: 2017 Toyota Camry 2.5L I4. Active DTCs: P0420. Live data: RPM=820, coolant=88°C, O2_B1S1=0.45V cycling, O2_B1S2=0.44V flat. What is wrong and what should I do?',
    mustContain: ['P0420', 'catalyst', 'bank'],
    mustNotContain: ['P0300', 'misfire', 'I don\'t know'],
    maxTokensExpected: 250,
  },
  {
    id: 'TC-02',
    name: 'Multi-DTC misfire pattern',
    description: 'P0300 + P0301 + P0302 — expects cylinder-specific misfire diagnosis',
    prompt: 'Vehicle: 2018 Ford F-150 3.5L EcoBoost V6. Active DTCs: P0300, P0301, P0302. Live data: RPM=750, MAF=11.2g/s, coolant=93°C, fuel_trim_ST_B1=+4%, fuel_trim_LT_B1=+6%. Engine shaking at idle. Diagnose.',
    mustContain: ['cylinder', 'coil', 'spark'],
    mustNotContain: ['catalyst', 'O2 sensor'],
    maxTokensExpected: 300,
  },
  {
    id: 'TC-03',
    name: 'Lean condition with context',
    description: 'P0171 + high fuel trim — must differentiate vacuum leak vs MAF vs injector',
    prompt: 'Vehicle: 2015 Honda Civic 1.8L. Active DTCs: P0171. Live data: RPM=800, MAF=4.1g/s (low for displacement), fuel_trim_ST_B1=+18%, fuel_trim_LT_B1=+14%, coolant=90°C, throttle=12%. What are the top 3 causes in order of probability?',
    mustContain: ['vacuum', 'MAF', 'fuel trim'],
    mustNotContain: ['rich', 'P0172'],
    maxTokensExpected: 350,
  },
  {
    id: 'TC-04',
    name: 'Unknown DTC — hallucination guard',
    description: 'Manufacturer-specific DTC — model must NOT fabricate a definition',
    prompt: 'Vehicle: 2020 Subaru Outback 2.5L. Active DTCs: P1SC4. No other symptoms. What does this code mean?',
    mustContain: [],
    mustNotContain: [],
    hallucination_check: true,
    note: 'Manually verify: model should express uncertainty or say it\'s manufacturer-specific, NOT invent a definition.',
    maxTokensExpected: 150,
  },
  {
    id: 'TC-05',
    name: 'No DTC — parameter-only diagnosis',
    description: 'Overheating scenario without stored codes yet',
    prompt: 'Vehicle: 2016 Chevrolet Silverado 5.3L V8. No active DTCs. Live data: coolant=112°C (ALERT), RPM=1200, oil_temp=118°C, MAF=28g/s, throttle=22%, engine_load=48%. What is happening and what should the driver do immediately?',
    mustContain: ['overheat', 'coolant', 'stop'],
    mustNotContain: [],
    urgent: true,
    maxTokensExpected: 200,
  },
];

// ─── Runner helpers ───────────────────────────────────────────────────────────
function buildChatML(system, user) {
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n`;
}

async function runWithOllama(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ollama', ['run', OLLAMA_MODEL, '--nowordwrap'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let errOut = '';
    proc.stdout.on('data', d => { output += d.toString(); process.stdout.write('.'); });
    proc.stderr.on('data', d => { errOut += d.toString(); });
    proc.on('close', code => {
      if (code !== 0 && output === '') reject(new Error(`Ollama exited ${code}: ${errOut}`));
      else resolve(output.trim());
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

async function runWithLlamaCpp(prompt, modelPath) {
  if (!modelPath) throw new Error('--model path required for llamacpp backend');
  return new Promise((resolve, reject) => {
    const chatml = buildChatML(SYSTEM_PROMPT, prompt);
    const proc = spawn(LLAMACPP_BIN, [
      '-m', modelPath,
      '--chat-template', 'chatml',
      '-p', chatml,
      '-n', '400',
      '--temp', '0.3',
      '--no-display-prompt',
      '-c', '2048',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    proc.stdout.on('data', d => { output += d.toString(); process.stdout.write('.'); });
    proc.on('close', code => {
      if (code !== 0 && output === '') reject(new Error(`llama-cli exited ${code}`));
      else resolve(output.trim());
    });
  });
}

async function queryModel(userPrompt) {
  if (backend === 'ollama') return runWithOllama(userPrompt);
  if (backend === 'llamacpp') return runWithLlamaCpp(userPrompt, modelArg);
  throw new Error(`Unknown backend: ${backend}. Use --backend ollama or --backend llamacpp`);
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
function scoreResponse(tc, response) {
  const lower = response.toLowerCase();
  const results = { passed: true, issues: [], score: 0, maxScore: 0 };

  // Check mustContain
  for (const term of tc.mustContain) {
    results.maxScore += 10;
    if (lower.includes(term.toLowerCase())) {
      results.score += 10;
    } else {
      results.issues.push(`MISSING expected term: "${term}"`);
      results.passed = false;
    }
  }

  // Check mustNotContain
  for (const term of tc.mustNotContain) {
    results.maxScore += 5;
    if (!lower.includes(term.toLowerCase())) {
      results.score += 5;
    } else {
      results.issues.push(`FOUND forbidden term: "${term}"`);
      results.passed = false;
    }
  }

  // Length sanity check (tokens ≈ words * 1.3)
  const approxTokens = response.split(/\s+/).length * 1.3;
  results.maxScore += 5;
  if (approxTokens <= tc.maxTokensExpected * 1.5) {
    results.score += 5;
  } else {
    results.issues.push(`Response too long (~${Math.round(approxTokens)} tokens, expected ≤${tc.maxTokensExpected})`);
  }

  // Non-empty
  results.maxScore += 10;
  if (response.length > 20) {
    results.score += 10;
  } else {
    results.issues.push('Response too short or empty');
    results.passed = false;
  }

  results.percentage = results.maxScore > 0
    ? Math.round((results.score / results.maxScore) * 100)
    : 0;

  return results;
}

// ─── Report ───────────────────────────────────────────────────────────────────
function printHeader(text) {
  const line = '─'.repeat(70);
  console.log(`\n${line}`);
  console.log(` ${text}`);
  console.log(line);
}

function printResult(tc, response, scoring, elapsed) {
  const status = tc.hallucination_check ? '⚠ MANUAL' : (scoring.passed ? '✓ PASS' : '✗ FAIL');
  console.log(`\n[${tc.id}] ${tc.name}  ${status}  (${scoring.percentage}%)  ${elapsed}ms`);
  console.log(`Description: ${tc.description}`);

  if (tc.hallucination_check) {
    console.log('\n*** MANUAL CHECK REQUIRED ***');
    console.log('The model should NOT invent a definition for P1SC4.');
    console.log('Acceptable answers: "manufacturer-specific", "unknown", "I cannot confirm".');
  }

  if (scoring.issues.length > 0) {
    console.log('Issues:');
    scoring.issues.forEach(i => console.log(`  • ${i}`));
  }

  console.log('\n--- Response ---');
  console.log(response || '(empty)');
  console.log('────────────────');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\nCARpsy-v2 Evaluation Suite');
  console.log(`Backend: ${backend}${backend === 'llamacpp' ? ` | Model: ${modelArg}` : ` | Model: ${OLLAMA_MODEL}`}`);
  console.log(`Test cases: ${TEST_CASES.length}`);

  // Verify backend is available
  try {
    if (backend === 'ollama') {
      execSync('ollama --version', { stdio: 'ignore' });
    } else {
      execSync(`${LLAMACPP_BIN} --version`, { stdio: 'ignore' });
    }
  } catch {
    console.error(`\nERROR: "${backend === 'ollama' ? 'ollama' : LLAMACPP_BIN}" not found in PATH.`);
    if (backend === 'ollama') {
      console.error('Install Ollama from https://ollama.com, then run:');
      console.error(`  ollama pull ${OLLAMA_MODEL}`);
    } else {
      console.error('Build llama.cpp or provide --llamacpp-bin path to the binary.');
    }
    process.exit(1);
  }

  const summary = [];

  for (const tc of TEST_CASES) {
    printHeader(`${tc.id} — ${tc.name}`);
    console.log(`Prompt: ${tc.prompt.substring(0, 100)}...`);
    process.stdout.write('Generating');

    const start = Date.now();
    let response = '';
    let error = null;

    try {
      response = await queryModel(tc.prompt);
    } catch (e) {
      error = e.message;
    }

    const elapsed = Date.now() - start;
    console.log(' done.');

    if (error) {
      console.log(`\n[${tc.id}] ERROR: ${error}`);
      summary.push({ id: tc.id, name: tc.name, status: 'ERROR', score: 0, elapsed });
      continue;
    }

    const scoring = scoreResponse(tc, response);
    printResult(tc, response, scoring, elapsed);

    summary.push({
      id: tc.id,
      name: tc.name,
      status: tc.hallucination_check ? 'MANUAL' : (scoring.passed ? 'PASS' : 'FAIL'),
      score: scoring.percentage,
      elapsed,
    });
  }

  // Final summary table
  printHeader('SUMMARY');
  console.log('');
  console.log('ID      Name                               Status    Score   Time');
  console.log('─'.repeat(70));
  let totalScore = 0;
  let autoCount = 0;
  for (const r of summary) {
    const name = r.name.padEnd(35);
    const status = r.status.padEnd(9);
    const score = r.status === 'MANUAL' ? '  N/A' : `${String(r.score).padStart(3)}%`;
    console.log(`${r.id}    ${name} ${status} ${score}   ${r.elapsed}ms`);
    if (r.status !== 'MANUAL' && r.status !== 'ERROR') {
      totalScore += r.score;
      autoCount++;
    }
  }
  console.log('─'.repeat(70));
  const avg = autoCount > 0 ? Math.round(totalScore / autoCount) : 0;
  console.log(`\nAuto-scored average: ${avg}%  (${autoCount}/${TEST_CASES.length} cases auto-evaluated)`);
  console.log('TC-04 requires manual review of the response above.\n');

  console.log('Next step: if avg ≥ 80% and TC-04 does not hallucinate →');
  console.log('  Set customModelSrc in Settings to the HuggingFace GGUF URL and test on device.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
