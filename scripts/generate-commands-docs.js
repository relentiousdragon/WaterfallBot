const fs = require('fs');
const path = require('path');

const SLASH_COMMANDS_DIR = path.join(__dirname, '..', 'slashCommands');
const OUTPUT_FILE = path.join(__dirname, '..', 'commands.md');

const CATEGORY_INFO = {
    'General': {
        emoji: '🧭',
        description: 'General commands for everyday use'
    },
    'Moderation': {
        emoji: '🛡️',
        description: 'Moderation commands to keep your server safe and organized'
    },
    'Dev': {
        emoji: '💻',
        description: 'Developer-only commands for bot management'
    },
    'Bot': {
        emoji: '🤖',
        description: 'Bot-related commands and feedback tools'
    },
    'Games': {
        emoji: '🎲',
        description: 'Game commands'
    },
    'Utility': {
        emoji: '⚙️',
        description: 'Helpful utility commands'
    },
    'Other': {
        emoji: '📦',
        description: 'Miscellaneous commands'
    }
};

function findCommandFiles(dir) {
    const files = [];
    const items = fs.readdirSync(dir);

    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            files.push(...findCommandFiles(fullPath));
        } else if (item.endsWith('.js')) {
            files.push(fullPath);
        }
    }

    return files;
}

function extractCommandMetadata(filePath) {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');

        const helpMatch = fileContent.match(/help:\s*{([^}]+(?:{[^}]*}[^}]*)*?)}/s);
        if (!helpMatch) {
            return null;
        }

        const helpSection = helpMatch[0];
        const name = extractValue(helpSection, 'name');
        const description = extractValue(helpSection, 'description');
        const category = extractValue(helpSection, 'category') || 'Other';

        const permissions = extractArray(helpSection, 'permissions');
        const botPermissions = extractArray(helpSection, 'botPermissions');

        const nameMatch = fileContent.match(/\.setName\(['"]([^'"]+)['"]\)/);
        const descMatch = fileContent.match(/\.setDescription\(['"]([^'"]+)['"]\)/);

        const commandName = nameMatch ? nameMatch[1] : name;
        const commandDesc = descMatch ? descMatch[1] : description;

        if (!commandName || !commandDesc) {
            return null;
        }

        const dev = fileContent.includes('dev: true');
        const mod = fileContent.includes('mod: true');
        const beta = fileContent.includes('beta: true');
        const explicit = fileContent.includes('explicit: true');

        const metadata = {
            name: commandName,
            description: commandDesc,
            category: category,
            permissions: permissions,
            botPermissions: botPermissions,
            dev: dev,
            mod: mod,
            beta: beta,
            explicit: explicit,
            subcommands: []
        };

        const subcommandMatches = fileContent.matchAll(/\.addSubcommand\(\s*(?:sub|subcommand)\s*=>\s*(?:sub|subcommand)\s*\.setName\(['"]([^'"]+)['"]\)(?:[\s\S]*?)\.setDescription\(['"]([^'"]+)['"]\)/g);

        for (const match of subcommandMatches) {
            metadata.subcommands.push({
                name: match[1],
                description: match[2],
                options: []
            });
        }

        return metadata;
    } catch (error) {
        console.error(`Error parsing ${filePath}:`, error.message);
        return null;
    }
}

function extractValue(section, key) {
    const match = section.match(new RegExp(`${key}:\\s*['"]([^'"]+)['"]`));
    return match ? match[1] : null;
}

function extractArray(section, key) {
    const match = section.match(new RegExp(`${key}:\\s*\\[([^\\]]*)]`));
    if (!match) return [];

    const content = match[1];
    const items = content.match(/['"]([^'"]+)['"]/g);
    return items ? items.map(item => item.replace(/['"]/g, '')) : [];
}

function extractOptions(options) {
    if (!options || options.length === 0) return [];

    return options.map(opt => ({
        name: opt.name,
        description: opt.description,
        required: opt.required || false,
        type: getOptionTypeName(opt.type)
    }));
}

function getOptionTypeName(type) {
    const types = {
        3: 'String',
        4: 'Integer',
        5: 'Boolean',
        6: 'User',
        7: 'Channel',
        8: 'Role',
        10: 'Number'
    };
    return types[type] || 'Unknown';
}

function generateBadges(command) {
    const badges = [];

    if (command.dev) {
        badges.push('`🔧 Developer Only`');
    }
    if (command.mod) {
        badges.push('`👮 Moderator Only`');
    }
    if (command.beta) {
        badges.push('`🧪 Beta`');
    }
    if (command.explicit) {
        badges.push('`🧪 Testing Server Only`');
    }

    return badges.length > 0 ? badges.join(' ') : '';
}

function generateCommandMarkdown(command) {
    let md = `### \`/${command.name}\`\n\n`;

    const badges = generateBadges(command);
    if (badges) {
        md += `${badges}\n\n`;
    }

    md += `${command.description}\n\n`;

    if (command.permissions && command.permissions.length > 0) {
        md += `**Required Permissions:** ${command.permissions.join(', ')}\n\n`;
    }

    if (command.botPermissions && command.botPermissions.length > 0) {
        md += `**Bot Permissions:** ${command.botPermissions.join(', ')}\n\n`;
    }

    if (command.subcommands && command.subcommands.length > 0) {
        md += `**Subcommands:**\n\n`;
        for (const sub of command.subcommands) {
            md += `- \`/${command.name} ${sub.name}\` - ${sub.description}\n`;

            if (sub.options && sub.options.length > 0) {
                md += `  - **Options:**\n`;
                for (const opt of sub.options) {
                    const requiredTag = opt.required ? '*(required)*' : '*(optional)*';
                    md += `    - \`${opt.name}\` (${opt.type}) ${requiredTag}: ${opt.description}\n`;
                }
            }
        }
        md += '\n';
    }

    md += '---\n\n';
    return md;
}

function generateDocumentation() {
    console.log('🔍 Scanning for slash commands...');

    const commandFiles = findCommandFiles(SLASH_COMMANDS_DIR);
    console.log(`Found ${commandFiles.length} command files`);

    const commands = [];
    for (const file of commandFiles) {
        const metadata = extractCommandMetadata(file);
        if (metadata) {
            commands.push(metadata);
        }
    }

    console.log(`Loaded ${commands.length} valid commands`);

    const categories = {};
    for (const cmd of commands) {
        if (!categories[cmd.category]) {
            categories[cmd.category] = [];
        }
        categories[cmd.category].push(cmd);
    }

    for (const cat in categories) {
        categories[cat].sort((a, b) => a.name.localeCompare(b.name));
    }

    let markdown = `# Waterfall Commands\n\n`;
    markdown += `*Last updated: ${new Date().toUTCString()}*\n\n`;

    markdown += `## Commands\n\n`;
    const sortedCategories = Object.keys(categories).sort();
    for (const category of sortedCategories) {
        const info = CATEGORY_INFO[category] || CATEGORY_INFO['Other'];
        const count = categories[category].length;
        markdown += `- ${info.emoji} **${category}** (${count})\n`;
    }
    markdown += '\n---\n\n';

    for (const category of sortedCategories) {
        const info = CATEGORY_INFO[category] || CATEGORY_INFO['Other'];
        markdown += `## ${info.emoji} ${category}\n\n`;

        for (const command of categories[category]) {
            markdown += generateCommandMarkdown(command);
        }
    }

    markdown += `---\n\n`;
    markdown += `**Badges:**\n`;
    markdown += `🔧 Developer Only | 👮 Moderator Only | 🧪 Beta | 🧪 Testing Server Only\n\n`;
    markdown += `Developer and Moderator roles are configured in \`settings.json\`.\n`;

    fs.writeFileSync(OUTPUT_FILE, markdown, 'utf8');
    console.log(`✅ Documentation generated successfully: ${OUTPUT_FILE}`);
    console.log(`Total commands documented: ${commands.length}`);
    console.log(`Categories: ${sortedCategories.join(', ')}`);
}

try {
    generateDocumentation();
    process.exit(0);
} catch (error) {
    console.error('❌ Error generating documentation:', error);
    process.exit(1);
}
