import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const args = process.argv.slice(2);
const findings = [];
const summaries = [];

const hasFlag = (flag) => args.includes(flag);
const getOption = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const auditRepository = hasFlag('--repository');
const distOption = getOption('--dist');
const historyRange = getOption('--history-range');
const historyTip = getOption('--history-tip');

if (!auditRepository && !distOption && !historyRange && !historyTip) {
  throw new Error(
    '検査対象を --repository / --dist <dir> / --history-range <range> / --history-tip <sha> で指定してください。',
  );
}

const normalizePath = (value) => value.replaceAll('\\', '/').replace(/^\.\//, '');

const runGit = (gitArgs) =>
  execFileSync('git', gitArgs, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const addFinding = (scope, file, reason) => {
  findings.push({ scope, file: normalizePath(file), reason });
};

const privatePathRules = [
  {
    reason: '個人用AI・エージェント設定',
    pattern: /(^|\/)\.(?:agents|claude|codex)(?:\/|$)/i,
  },
  {
    reason: '個人用Gitフック',
    pattern: /(^|\/)\.githooks(?:\/|$)/i,
  },
  {
    reason: '個人用IDE設定',
    pattern: /(^|\/)\.(?:idea|vscode)(?:\/|$)/i,
  },
  {
    reason: '内部文書',
    pattern: /(^|\/)(?:AGENTS|CLAUDE|REQUIREMENTS)\.md$/i,
  },
  {
    reason: '内部文書ディレクトリ',
    pattern: /^docs\//i,
  },
  {
    reason: '生成元メタデータ',
    pattern: /^metadata\.json$/i,
  },
  {
    reason: '環境変数ファイル',
    pattern: /(^|\/)\.env(?:\.|$)/i,
  },
  {
    reason: '資格情報ファイル',
    pattern:
      /(^|\/)(?:\.npmrc|credentials[^/]*\.json|service-account[^/]*\.json|id_(?:rsa|ed25519)|[^/]+\.(?:pem|key|p12|pfx|jks))$/i,
  },
  {
    reason: 'ローカル音声素材',
    pattern: /\.(?:wav|mp3|m4a|aac|ogg|webm)$/i,
  },
  {
    reason: 'ローカルアーカイブ',
    pattern: /\.(?:zip|7z)$/i,
  },
];

const privateMarkerPattern = new RegExp(
  [String.raw`\.clau` + 'de', String.raw`\.co` + 'dex', 'settings.' + 'local.json'].join('|'),
  'i'
);
const fileUriPattern = new RegExp('file:' + String.raw`\/\/\/`, 'i');
const privateKeyPattern = new RegExp(
  ['BEGIN', '(?:RSA |OPENSSH |EC )?', 'PRIVATE KEY'].join(' ')
);

const contentRules = [
  {
    reason: 'Windows絶対パス',
    pattern: /(?:^|[\s"'`(=])(?:[A-Za-z]:[\\/](?![\\/]))/m,
  },
  {
    reason: 'ユーザーホーム絶対パス',
    pattern: /\/(?:Users|home)\/(?!web_user(?:\/|\b))[^/\s"'`<>]+\//i,
  },
  {
    reason: 'ローカルfile URI',
    pattern: fileUriPattern,
  },
  {
    reason: '秘密鍵',
    pattern: privateKeyPattern,
  },
  {
    reason: 'GitHubトークンらしき値',
    pattern: /(?:github_pat_|ghp_)[A-Za-z0-9_]{20,}/,
  },
  {
    reason: 'OpenAI APIキーらしき値',
    pattern: /sk-[A-Za-z0-9_-]{20,}/,
  },
  {
    reason: 'AWSアクセスキーらしき値',
    pattern: /AKIA[0-9A-Z]{16}/,
  },
  {
    reason: 'Slackトークンらしき値',
    pattern: /xox[baprs]-[A-Za-z0-9-]{20,}/,
  },
  {
    reason: 'ハードコードされた資格情報らしき値',
    pattern:
      /(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[:=]\s*["'][^"'\s]{12,}["']/i,
  },
];

const distOnlyContentRules = [
  {
    reason: '個人用開発メタデータ参照',
    pattern: privateMarkerPattern,
  },
  {
    reason: '開発サーバーURL',
    pattern: /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i,
  },
  {
    reason: 'source map参照',
    pattern: /sourceMappingURL=/i,
  },
];

const textExtensions = new Set([
  '.bat',
  '.cjs',
  '.cmd',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.lock',
  '.md',
  '.mjs',
  '.ps1',
  '.sh',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const isTextFile = (file) => {
  const extension = path.extname(file).toLowerCase();
  return textExtensions.has(extension) || path.basename(file).startsWith('.');
};

const scanPath = (scope, file) => {
  for (const rule of privatePathRules) {
    if (rule.pattern.test(normalizePath(file))) {
      addFinding(scope, file, rule.reason);
    }
  }
};

const scanText = (scope, file, content, additionalRules = []) => {
  for (const rule of [...contentRules, ...additionalRules]) {
    if (rule.pattern.test(content)) {
      addFinding(scope, file, rule.reason);
    }
  }
};

const readTextFile = (file) => {
  const absolutePath = path.resolve(workspaceRoot, file);
  const stat = lstatSync(absolutePath);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024 || !isTextFile(file)) return undefined;

  const buffer = readFileSync(absolutePath);
  if (buffer.includes(0)) return undefined;
  return buffer.toString('utf8');
};

const listFilesRecursively = (directory, scope) => {
  const absoluteDirectory = path.resolve(workspaceRoot, directory);
  if (!existsSync(absoluteDirectory)) {
    addFinding(scope, directory, '検査対象ディレクトリが存在しません');
    return [];
  }

  const files = [];
  const visit = (currentDirectory) => {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = normalizePath(path.relative(absoluteDirectory, absolutePath));
      if (entry.isSymbolicLink()) {
        addFinding(scope, relativePath, 'シンボリックリンクは公開対象にできません');
      } else if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  };

  visit(absoluteDirectory);
  return files.sort();
};

const allowedPublicFiles = new Set([
  'THIRD_PARTY_NOTICES.txt',
  'apple-touch-icon.png',
  'coi-serviceworker.js',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon.png',
  'icon-192.png',
  'icon-512.png',
  'models/silero_vad.onnx',
  'onnxruntime/ort-wasm-simd-threaded.mjs',
  'onnxruntime/ort-wasm-simd-threaded.wasm',
]);

const auditPublicDirectory = () => {
  const files = listFilesRecursively('public', 'public');
  for (const file of files) {
    if (!allowedPublicFiles.has(file)) {
      addFinding('public', file, 'public/の許可リストにないファイル');
    }
  }
  for (const expectedFile of allowedPublicFiles) {
    if (!files.includes(expectedFile)) {
      addFinding('public', expectedFile, 'public/の必須ファイルがありません');
    }
  }
  summaries.push(`public ${files.length}ファイル`);
};

const auditRepositoryFiles = () => {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: workspaceRoot,
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const files = output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .filter((file) => existsSync(path.resolve(workspaceRoot, file)));

  for (const file of files) {
    scanPath('repository', file);
    const content = readTextFile(file);
    if (content !== undefined) {
      scanText('repository', file, content);
    }
  }

  auditPublicDirectory();
  summaries.push(`repository ${files.length}ファイル`);
};

const distFileRules = [
  { label: 'index.html', pattern: /^index\.html$/ },
  { label: 'THIRD_PARTY_NOTICES.txt', pattern: /^THIRD_PARTY_NOTICES\.txt$/ },
  { label: 'apple-touch-icon.png', pattern: /^apple-touch-icon\.png$/ },
  { label: 'coi-serviceworker.js', pattern: /^coi-serviceworker\.js$/ },
  { label: 'favicon-16x16.png', pattern: /^favicon-16x16\.png$/ },
  { label: 'favicon-32x32.png', pattern: /^favicon-32x32\.png$/ },
  { label: 'favicon.png', pattern: /^favicon\.png$/ },
  { label: 'icon-192.png', pattern: /^icon-192\.png$/ },
  { label: 'icon-512.png', pattern: /^icon-512\.png$/ },
  { label: 'Silero model', pattern: /^models\/silero_vad\.onnx$/ },
  {
    label: 'ONNX Runtime module',
    pattern: /^onnxruntime\/ort-wasm-simd-threaded\.mjs$/,
  },
  {
    label: 'ONNX Runtime wasm',
    pattern: /^onnxruntime\/ort-wasm-simd-threaded\.wasm$/,
  },
  {
    label: 'application CSS',
    pattern: /^assets\/index-[A-Za-z0-9_-]+\.css$/,
  },
  {
    label: 'application JavaScript',
    pattern: /^assets\/index-[A-Za-z0-9_-]+\.js$/,
  },
  {
    label: 'Silero worker',
    pattern: /^assets\/sileroVadWorker-[A-Za-z0-9_-]+\.js$/,
  },
  {
    label: 'ONNX Runtime bundle',
    pattern: /^assets\/ort\.wasm\.bundle\.min-[A-Za-z0-9_-]+\.js$/,
  },
  {
    label: 'bundled ONNX Runtime wasm',
    pattern: /^assets\/ort-wasm-simd-threaded-[A-Za-z0-9_-]+\.wasm$/,
  },
];

const auditDist = (directory) => {
  const normalizedDirectory = normalizePath(directory);
  const files = listFilesRecursively(directory, 'dist');

  for (const file of files) {
    const matchingRules = distFileRules.filter((rule) => rule.pattern.test(file));
    if (matchingRules.length !== 1) {
      addFinding('dist', file, '公開成果物の許可リストにないファイル');
    }

    const content = readTextFile(path.join(normalizedDirectory, file));
    if (content !== undefined) {
      scanText('dist', file, content, distOnlyContentRules);
    }
  }

  for (const rule of distFileRules) {
    const count = files.filter((file) => rule.pattern.test(file)).length;
    if (count !== 1) {
      addFinding('dist', rule.label, `必須成果物の件数が1ではありません（${count}件）`);
    }
  }

  summaries.push(`dist ${files.length}ファイル`);
};

const auditHistoryRange = (range) => {
  if (!/^[0-9a-f]{40}\.\.[0-9a-f]{40}$/i.test(range)) {
    throw new Error(`不正な履歴範囲です: ${range}`);
  }

  const nameStatus = runGit([
    'log',
    '--format=',
    '--name-status',
    '--no-renames',
    range,
  ]);
  for (const line of nameStatus.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [status, ...pathParts] = line.split('\t');
    const file = pathParts.at(-1);
    if (!file || status.startsWith('D')) continue;
    scanPath('outgoing-history', file);
  }

  const patch = runGit([
    'log',
    '--format=',
    '--no-ext-diff',
    '--unified=0',
    '-p',
    range,
  ]);
  const additions = patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
  scanText('outgoing-history', range, additions);
  summaries.push(`outgoing history ${range}`);
};

const auditHistoryTip = (tip) => {
  if (!/^[0-9a-f]{40}$/i.test(tip)) {
    throw new Error(`不正な履歴先端です: ${tip}`);
  }

  const nameStatus = runGit([
    'log',
    '--format=',
    '--name-status',
    '--no-renames',
    tip,
  ]);
  for (const line of nameStatus.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [status, ...pathParts] = line.split('\t');
    const file = pathParts.at(-1);
    if (!file || status.startsWith('D')) continue;
    scanPath('outgoing-history', file);
  }

  const patch = runGit([
    'log',
    '--format=',
    '--no-ext-diff',
    '--unified=0',
    '-p',
    tip,
  ]);
  const additions = patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
  scanText('outgoing-history', tip, additions);
  summaries.push(`outgoing history tip ${tip}`);
};

if (auditRepository) {
  auditRepositoryFiles();
}
if (distOption) {
  auditDist(distOption);
}
if (historyRange) {
  auditHistoryRange(historyRange);
}
if (historyTip) {
  auditHistoryTip(historyTip);
}

if (findings.length > 0) {
  console.error('[public-audit] 公開を停止しました。');
  for (const finding of findings) {
    console.error(`- ${finding.scope}: ${finding.file} (${finding.reason})`);
  }
  process.exitCode = 1;
} else {
  console.log(`[public-audit] OK: ${summaries.join(', ')}`);
}
