const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(PROJECT_ROOT, 'locales', 'en');
const SOURCE_DIRS = [
    path.join(PROJECT_ROOT, 'slashCommands'),
    path.join(PROJECT_ROOT, 'events'),
    path.join(PROJECT_ROOT, 'util'),
    path.join(PROJECT_ROOT, 'schemas'),
    path.join(PROJECT_ROOT, 'contextCommands'),
    path.join(PROJECT_ROOT, 'commands'),
];
const SOURCE_EXTENSIONS = ['.js'];

const NAMESPACES = ['common', 'commands', 'events', 'modlog'];

const args = process.argv.slice(2);
const warnOnly = args.includes('--warn');
const removeUnusedIdx = args.indexOf('--remove-unused');
const removeUnused = removeUnusedIdx !== -1;
const removeUnusedNamespace = removeUnused && args[removeUnusedIdx + 1] && !args[removeUnusedIdx + 1].startsWith('--')
    ? args[removeUnusedIdx + 1]
    : null;

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m'
};

function colorize(text, color) {
    return `${colors[color]}${text}${colors.reset}`;
}

function getAllFiles(dir, extensions, files = []) {
    if (!fs.existsSync(dir)) return files;

    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            getAllFiles(fullPath, extensions, files);
        } else if (extensions.includes(path.extname(item))) {
            files.push(fullPath);
        }
    }
    return files;
}

function extractUsedKeys(files) {
    const usedKeys = new Map();

    for (const ns of NAMESPACES) {
        usedKeys.set(ns, new Set());
    }

    const patterns = [
        /t\(['"`](\w+):([a-zA-Z0-9_.\-]+)['"`]\)/g,
        /t\(['"`](\w+):([a-zA-Z0-9_.\-]+)['"`],/g,
        /getFixedT\([^)]+\)\(['"`](\w+):([a-zA-Z0-9_.\-]+)['"`]\)/g
    ];

    for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');

        for (const pattern of patterns) {
            let match;

            pattern.lastIndex = 0;

            while ((match = pattern.exec(content)) !== null) {
                const namespace = match[1];
                const key = match[2];

                if (usedKeys.has(namespace)) {
                    usedKeys.get(namespace).add(key);
                }
            }
        }
    }

    return usedKeys;
}

function flattenKeys(obj, prefix = '') {
    const keys = [];

    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            keys.push(...flattenKeys(value, fullKey));
        } else {
            keys.push(fullKey);
        }
    }

    return keys;
}

function getDefinedKeys(namespace) {
    const filePath = path.join(LOCALES_DIR, `${namespace}.json`);

    if (!fs.existsSync(filePath)) {
        return new Set();
    }

    try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const flattened = flattenKeys(content);
        return new Set(flattened);
    } catch (err) {
        console.error(colorize(`Error parsing ${filePath}: ${err.message}`, 'red'));
        return new Set();
    }
}

function removeNestedKey(obj, keyPath) {
    const parts = keyPath.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        if (current[parts[i]] === undefined) return false;
        current = current[parts[i]];
    }

    const lastKey = parts[parts.length - 1];
    if (current[lastKey] !== undefined) {
        delete current[lastKey];
        return true;
    }
    return false;
}

function cleanupEmptyObjects(obj) {
    for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            cleanupEmptyObjects(obj[key]);
            if (Object.keys(obj[key]).length === 0) {
                delete obj[key];
            }
        }
    }
}

function removeUnusedKeysFromNamespace(namespace, unusedKeys) {
    const filePath = path.join(LOCALES_DIR, `${namespace}.json`);

    if (!fs.existsSync(filePath)) {
        console.log(colorize(`   File not found: ${filePath}`, 'red'));
        return 0;
    }

    try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        let removedCount = 0;

        for (const key of unusedKeys) {
            if (removeNestedKey(content, key)) {
                removedCount++;
            }
        }

        cleanupEmptyObjects(content);

        fs.writeFileSync(filePath, JSON.stringify(content, null, 4) + '\n', 'utf8');

        return removedCount;
    } catch (err) {
        console.error(colorize(`   Error processing ${filePath}: ${err.message}`, 'red'));
        return 0;
    }
}

function analyzeTranslations() {
    console.log(colorize('\nTranslation Key Check (locales/en)', 'cyan'));
    console.log(colorize('==========================================\n', 'cyan'));

    const sourceFiles = [];
    for (const dir of SOURCE_DIRS) {
        sourceFiles.push(...getAllFiles(dir, SOURCE_EXTENSIONS));
    }
    const indexPath = path.join(PROJECT_ROOT, 'index.js');
    if (fs.existsSync(indexPath)) {
        sourceFiles.push(indexPath);
    }

    console.log(colorize(`Scanned ${sourceFiles.length} source files`, 'dim'));
    console.log(colorize(`Checking keys against: locales/en/*.json\n`, 'dim'));

    const usedKeys = extractUsedKeys(sourceFiles);

    let totalUnused = 0;
    let totalMissing = 0;
    let totalRemoved = 0;
    const results = [];

    const namespacesToProcess = removeUnusedNamespace
        ? (NAMESPACES.includes(removeUnusedNamespace) ? [removeUnusedNamespace] : [])
        : NAMESPACES;

    if (removeUnusedNamespace && !NAMESPACES.includes(removeUnusedNamespace)) {
        console.log(colorize(`Invalid namespace: ${removeUnusedNamespace}`, 'red'));
        console.log(colorize(`Valid namespaces: ${NAMESPACES.join(', ')}`, 'dim'));
        return 1;
    }

    for (const namespace of namespacesToProcess) {
        const defined = getDefinedKeys(namespace);
        const used = usedKeys.get(namespace);

        const unused = [...defined].filter(key => !used.has(key));

        const missing = [...used].filter(key => !defined.has(key));

        totalUnused += unused.length;
        totalMissing += missing.length;

        results.push({
            namespace,
            defined: defined.size,
            used: used.size,
            unused,
            missing
        });
    }

    for (const result of results) {
        console.log(colorize(`\nNamespace: ${result.namespace}`, 'blue'));
        console.log(`   ✓ ${result.defined} keys defined in en/${result.namespace}.json`);
        console.log(`   ✓ ${result.used} keys used in code`);

        if (result.unused.length > 0) {
            if (removeUnused) {
                const removed = removeUnusedKeysFromNamespace(result.namespace, result.unused);
                totalRemoved += removed;
                console.log(colorize(`      Removed ${removed} unused keys`, 'green'));
            } else {
                console.log(colorize(`   ⚠️  ${result.unused.length} unused keys (defined but not used):`, 'yellow'));
                for (const key of result.unused.slice(0, 10)) {
                    console.log(colorize(`      - ${key}`, 'dim'));
                }
                if (result.unused.length > 10) {
                    console.log(colorize(`      ... and ${result.unused.length - 10} more`, 'dim'));
                }
            }
        } else {
            console.log(colorize('   ✓ 0 unused keys', 'green'));
        }

        if (result.missing.length > 0) {
            console.log(colorize(`   ❌ ${result.missing.length} missing keys in en/${result.namespace}.json:`, 'red'));
            for (const key of result.missing.slice(0, 10)) {
                console.log(colorize(`      - ${key}`, 'red'));
            }
            if (result.missing.length > 10) {
                console.log(colorize(`      ... and ${result.missing.length - 10} more`, 'dim'));
            }
        } else {
            console.log(colorize('     0 missing keys', 'green'));
        }
    }

    console.log(colorize('\n📋 Summary', 'cyan'));
    console.log('─'.repeat(40));

    if (removeUnused) {
        console.log(colorize(`   🗑️  Removed ${totalRemoved} unused translation keys`, 'green'));
    } else if (totalUnused > 0) {
        console.log(colorize(`   ⚠️  ${totalUnused} unused translation keys`, 'yellow'));
    } else {
        console.log(colorize('     No unused translation keys', 'green'));
    }

    if (totalMissing > 0) {
        console.log(colorize(`   ❌ ${totalMissing} missing translation keys in en/`, 'red'));
    } else {
        console.log(colorize('     No missing translation keys', 'green'));
    }

    console.log('');

    if (totalMissing > 0 && !removeUnused) {
        if (warnOnly) {
            console.log(colorize('⚠️  Missing keys detected, add them to locale files.', 'yellow'));
            return 0;
        } else {
            console.log(colorize('❌ Missing keys detected in en/. Add them to locale files or use --warn to skip.', 'red'));
            return 1;
        }
    }

    console.log(colorize('Translation check passed!!', 'green'));
    return 0;
}

const exitCode = analyzeTranslations();
process.exit(exitCode);
