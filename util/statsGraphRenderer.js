const Canvas = require('canvas');
const GIFEncoder = require('gifencoder');
const funcs = require('./functions.js');
const path = require('path');

try {
    const emojiFontPath = require.resolve('noto-color-emoji/ttf/NotoColorEmoji.ttf');
    Canvas.registerFont(emojiFontPath, { family: 'Noto Color Emoji' });
} catch (e) {
    //
}

const COLORS = {
    background: '#0d1117',
    backgroundAlt: '#161b22',
    grid: '#21262d',
    text: '#f0f6fc',
    textDim: '#8b949e',
    textMuted: '#484f58',
    accent: '#58a6ff',
    accentGlow: '#388bfd',
    success: '#3fb950',
    warning: '#d29922',
    danger: '#f85149',
    gradientStart: '#58a6ff',
    gradientEnd: '#bc8cff',
    barGradientStart: '#238636',
    barGradientEnd: '#3fb950'
};

const FONTS = {
    title: 'bold 20px "Segoe UI", Arial, sans-serif',
    subtitle: '14px "Segoe UI", Arial, sans-serif',
    label: '13px Arial, sans-serif',
    value: 'bold 15px Arial, sans-serif',
    small: '11px Arial, sans-serif',
    tiny: '10px Arial, sans-serif'
};

const EMOJI_FONT = 'bold 15px Arial, "Noto Color Emoji", sans-serif';


async function renderLineChart(options) {
    const {
        data,
        labels,
        title = '',
        width = 700,
        height = 350
    } = options;

    return new Promise(async (resolve, reject) => {
        const encoder = new GIFEncoder(width, height);
        const stream = encoder.createReadStream();
        encoder.start();
        encoder.setRepeat(-1);
        encoder.setDelay(50);
        encoder.setQuality(15);

        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', (err) => reject(err));

        const canvas = Canvas.createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const padding = { top: 50, right: 30, bottom: 50, left: 55 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        const maxValue = Math.max(...data, 1);
        const minValue = 0;
        const valueRange = maxValue - minValue || 1;

        const points = data.length === 1
            ? [{ x: padding.left + chartWidth / 2, y: padding.top + chartHeight - ((data[0] - minValue) / valueRange) * chartHeight }]
            : data.map((value, index) => ({
                x: padding.left + (index / (data.length - 1)) * chartWidth,
                y: padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight
            }));

        const totalFrames = Math.max(data.length * 5, 40);

        for (let frame = 1; frame <= totalFrames; frame++) {
            const rawProgress = frame / totalFrames;
            const progress = easeInOutCubic(rawProgress);

            const totalProgress = progress * (data.length - 1);
            const fullSegments = Math.floor(totalProgress);
            const partial = totalProgress - fullSegments;

            const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
            bgGradient.addColorStop(0, COLORS.background);
            bgGradient.addColorStop(1, COLORS.backgroundAlt);
            ctx.fillStyle = bgGradient;
            ctx.fillRect(0, 0, width, height);

            if (title) {
                ctx.fillStyle = COLORS.text;
                ctx.font = FONTS.title;
                ctx.textAlign = 'left';
                ctx.fillText(title, padding.left, 35);
            }

            const gridLines = 5;
            for (let i = 0; i <= gridLines; i++) {
                const y = padding.top + (i / gridLines) * chartHeight;

                ctx.strokeStyle = COLORS.grid;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(width - padding.right, y);
                ctx.stroke();
                ctx.setLineDash([]);

                const value = maxValue - (i / gridLines) * valueRange;
                ctx.fillStyle = COLORS.textDim;
                ctx.font = FONTS.small;
                ctx.textAlign = 'right';
                ctx.fillText(formatNumber(value), padding.left - 12, y + 4);
            }

            if (labels && labels.length > 0) {
                ctx.fillStyle = COLORS.textDim;
                ctx.font = FONTS.small;
                ctx.textAlign = 'center';

                const maxLabels = 8;
                const step = Math.max(1, Math.ceil(labels.length / maxLabels));

                for (let i = 0; i < labels.length; i += step) {
                    const x = padding.left + (i / (labels.length - 1 || 1)) * chartWidth;
                    ctx.fillText(labels[i], x, height - padding.bottom + 25);
                }
            }

            ctx.strokeStyle = COLORS.grid;
            ctx.lineWidth = 1;
            ctx.strokeRect(padding.left, padding.top, chartWidth, chartHeight);

            if (data.length >= 1) {
                ctx.strokeStyle = COLORS.accentGlow;
                ctx.lineWidth = 10;
                ctx.globalAlpha = 0.1;
                ctx.lineJoin = 'round';
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);

                for (let i = 1; i <= fullSegments; i++) {
                    ctx.lineTo(points[i].x, points[i].y);
                }
                if (partial > 0 && fullSegments < points.length - 1) {
                    const nextP = points[fullSegments + 1];
                    const currP = points[fullSegments];
                    ctx.lineTo(currP.x + (nextP.x - currP.x) * partial, currP.y + (nextP.y - currP.y) * partial);
                }
                ctx.stroke();
                ctx.globalAlpha = 1;

                const gradient = ctx.createLinearGradient(padding.left, 0, width - padding.right, 0);
                gradient.addColorStop(0, COLORS.gradientStart);
                gradient.addColorStop(1, COLORS.gradientEnd);

                ctx.strokeStyle = gradient;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);

                for (let i = 1; i <= fullSegments; i++) {
                    ctx.lineTo(points[i].x, points[i].y);
                }
                if (partial > 0 && fullSegments < points.length - 1) {
                    const nextP = points[fullSegments + 1];
                    const currP = points[fullSegments];
                    ctx.lineTo(currP.x + (nextP.x - currP.x) * partial, currP.y + (nextP.y - currP.y) * partial);
                }
                ctx.stroke();

                for (let i = 0; i <= fullSegments; i++) {
                    const p = points[i];
                    ctx.fillStyle = COLORS.accent;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = COLORS.background;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }

            encoder.addFrame(ctx);
            if (frame % 8 === 0) await new Promise(resolve => setImmediate(resolve));
        }

        for (let i = 0; i < 30; i++) {
            encoder.addFrame(ctx);
        }

        encoder.finish();
    });
}

async function renderBarChart(options) {
    const {
        data,
        labels,
        title = '',
        width = 800,
        height = 350
    } = options;

    return new Promise(async (resolve, reject) => {
        const encoder = new GIFEncoder(width, height);
        const stream = encoder.createReadStream();
        encoder.start();
        encoder.setRepeat(-1);
        encoder.setDelay(35);
        encoder.setQuality(14);

        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', (err) => reject(err));

        const canvas = Canvas.createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const padding = { top: 50, right: 20, bottom: 50, left: 50 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        const maxValue = Math.max(...data, ...(options.backgroundData || []), 1);
        const barCount = data.length;
        const totalBarSpace = chartWidth / barCount;
        const barWidth = totalBarSpace * 0.75;
        const barGap = totalBarSpace * 0.25;

        const totalFrames = 18;

        for (let frame = 0; frame <= totalFrames; frame++) {
            const progress = easeOutCubic(frame / totalFrames);

            const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
            bgGradient.addColorStop(0, COLORS.background);
            bgGradient.addColorStop(1, COLORS.backgroundAlt);
            ctx.fillStyle = bgGradient;
            ctx.fillRect(0, 0, width, height);

            if (title) {
                ctx.fillStyle = COLORS.text;
                ctx.font = FONTS.value;
                ctx.textAlign = 'left';
                ctx.fillText(title, 20, 30);
            }

            const gridLines = 4;
            for (let i = 0; i <= gridLines; i++) {
                const y = padding.top + (i / gridLines) * chartHeight;

                ctx.strokeStyle = COLORS.grid;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(width - padding.right, y);
                ctx.stroke();
                ctx.setLineDash([]);

                const value = maxValue - (i / gridLines) * maxValue;
                ctx.fillStyle = COLORS.textDim;
                ctx.font = FONTS.small;
                ctx.textAlign = 'right';
                ctx.fillText(formatNumber(value), padding.left - 10, y + 4);
            }

            const maxVal = Math.max(...data);
            const peakIndices = data.map((v, i) => v === maxVal && v > 0 ? i : -1).filter(i => i !== -1);

            let bgMaxVal = 0;
            let bgPeakIndices = [];
            if (options.backgroundData) {
                bgMaxVal = Math.max(...options.backgroundData);
                bgPeakIndices = options.backgroundData.map((v, i) => v === bgMaxVal && v > 0 ? i : -1).filter(i => i !== -1);
            }

            for (let i = 0; i < barCount; i++) {
                const x = padding.left + i * totalBarSpace + barGap / 2;

                let bgBarHeight = 0;
                let bgY = 0;
                if (options.backgroundData && options.backgroundData[i] > 0) {
                    bgBarHeight = (options.backgroundData[i] / maxValue) * chartHeight * progress;
                    bgY = padding.top + chartHeight - bgBarHeight;
                    ctx.fillStyle = COLORS.grid;
                    roundRect(ctx, x, bgY, barWidth, bgBarHeight, 3);
                    ctx.fill();
                }

                const todayBarWidth = options.backgroundData ? barWidth * 0.7 : barWidth;
                const todayX = x + (barWidth - todayBarWidth) / 2;
                const barHeight = (data[i] / maxValue) * chartHeight * progress;
                const y = padding.top + chartHeight - barHeight;

                const isPeak = peakIndices.includes(i);
                const gradient = ctx.createLinearGradient(todayX, y + barHeight, todayX, y);

                if (isPeak) {
                    gradient.addColorStop(0, '#d29922');
                    gradient.addColorStop(1, '#f0b429');
                } else {
                    gradient.addColorStop(0, COLORS.barGradientStart);
                    gradient.addColorStop(1, COLORS.barGradientEnd);
                }

                if (barHeight > 0) {
                    ctx.fillStyle = 'rgba(0,0,0,0.25)';
                    roundRect(ctx, todayX + 2, y + 2, todayBarWidth, barHeight, 3);
                    ctx.fill();

                    ctx.fillStyle = gradient;
                    roundRect(ctx, todayX, y, todayBarWidth, barHeight, 3);
                    ctx.fill();
                }

                if (labels && labels[i] && (i % 3 === 0 || barCount <= 12)) {
                    ctx.fillStyle = isPeak ? COLORS.warning : COLORS.textDim;
                    ctx.font = isPeak ? FONTS.label : FONTS.tiny;
                    ctx.textAlign = 'center';
                    ctx.fillText(labels[i].replace(':00', 'h'), x + barWidth / 2, height - padding.bottom + 20);
                }

                if (progress > 0.9) {
                    if (data[i] > 0 && (isPeak || data[i] > maxValue * 0.8)) {
                        ctx.fillStyle = COLORS.text;
                        ctx.font = FONTS.small;
                        ctx.textAlign = 'center';
                        ctx.fillText(formatNumber(data[i]), x + barWidth / 2, y - 8);
                    } else if (bgBarHeight > 0 && bgPeakIndices.includes(i)) {
                        ctx.fillStyle = COLORS.textDim;
                        ctx.font = FONTS.tiny;
                        ctx.textAlign = 'center';
                        ctx.fillText(formatNumber(options.backgroundData[i]), x + barWidth / 2, bgY - 4);
                    }
                }
            }


            encoder.addFrame(ctx);
            if (frame % 8 === 0) await new Promise(resolve => setImmediate(resolve));
        }

        for (let i = 0; i < 12; i++) {
            encoder.addFrame(ctx);
        }

        encoder.finish();
    });
}

async function renderStatsCard(options) {
    const {
        stats,
        title = '',
        width = 450,
        height = 220
    } = options;

    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
    bgGradient.addColorStop(0, COLORS.background);
    bgGradient.addColorStop(1, COLORS.backgroundAlt);
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);

    if (title) {
        ctx.fillStyle = COLORS.text;
        ctx.font = FONTS.title;
        ctx.textAlign = 'left';
        ctx.fillText(title, 25, 40);
    }

    const startY = title ? 75 : 45;
    const statHeight = (height - startY - 25) / stats.length;

    stats.forEach((stat, i) => {
        const y = startY + i * statHeight;
        const centerY = y + statHeight / 2;

        ctx.fillStyle = COLORS.textDim;
        ctx.font = FONTS.label;
        ctx.textAlign = 'left';
        ctx.fillText(stat.label, 25, centerY + 6);

        ctx.fillStyle = stat.color || COLORS.text;
        ctx.font = stat.hasEmoji ? EMOJI_FONT : FONTS.value;
        ctx.textAlign = 'right';
        ctx.fillText(stat.value, width - 25, centerY + 6);

        if (i < stats.length - 1) {
            ctx.strokeStyle = COLORS.grid;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(25, y + statHeight);
            ctx.lineTo(width - 25, y + statHeight);
            ctx.stroke();
        }
    });

    return canvas.toBuffer();
}

function roundRect(ctx, x, y, width, height, radius) {
    if (height <= 0) return;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function formatNumber(num) {
    return funcs.abbr(num, 1000);
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

async function renderSegmentDonut(options) {
    const {
        data, //{ label, value, color }[]
        title = '',
        width = 700,
        height = 300
    } = options;

    const encoder = new GIFEncoder(width, height);
    const stream = encoder.createReadStream();
    const chunks = [];

    stream.on('data', chunk => chunks.push(chunk));

    encoder.start();
    encoder.setRepeat(-1);
    encoder.setDelay(40);
    encoder.setQuality(14);

    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const total = data.reduce((a, b) => a + b.value, 0);

    if (total === 0) {
        const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
        bgGradient.addColorStop(0, COLORS.background);
        bgGradient.addColorStop(1, COLORS.backgroundAlt);
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, width, height);
        if (title) {
            ctx.fillStyle = COLORS.text;
            ctx.font = FONTS.title;
            ctx.fillText(title, 20, 30);
        }
        ctx.fillStyle = COLORS.textDim;
        ctx.font = FONTS.small;
        ctx.textAlign = 'center';
        ctx.fillText("No data", width / 2, height / 2);
        encoder.addFrame(ctx);
        encoder.finish();
        return Buffer.concat(chunks);
    }

    const centerX = width * 0.35;
    const centerY = height / 2 + 15;
    const radius = Math.min(width * 0.3, height * 0.35);
    const innerRadius = radius * 0.6;

    const TOTAL_FRAMES = 25;

    for (let frame = 0; frame <= TOTAL_FRAMES; frame++) {
        const progress = easeOutCubic(frame / TOTAL_FRAMES);

        const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
        bgGradient.addColorStop(0, COLORS.background);
        bgGradient.addColorStop(1, COLORS.backgroundAlt);
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, width, height);

        if (title) {
            ctx.fillStyle = COLORS.text;
            ctx.font = FONTS.title;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(title, 20, 30);
        }

        let startAngle = -Math.PI / 2;
        const animatedEndAngle = -Math.PI / 2 + (2 * Math.PI * progress);

        data.forEach(segment => {
            if (segment.value === 0) return;
            const sliceAngle = (segment.value / total) * 2 * Math.PI;
            let endAngle = startAngle + sliceAngle;

            if (endAngle > animatedEndAngle) endAngle = animatedEndAngle;
            if (startAngle >= animatedEndAngle) return;

            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = segment.color;
            ctx.fill();

            ctx.strokeStyle = COLORS.background;
            ctx.lineWidth = 2;
            ctx.stroke();

            startAngle += sliceAngle;
        });

        const legendAlpha = frame >= TOTAL_FRAMES - 4 ? (frame - (TOTAL_FRAMES - 4)) / 4 : 0;
        if (legendAlpha > 0) {
            const legendX = width * 0.6;
            const legendStartY = height / 2 - (data.length * 25) / 2;

            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = legendAlpha;

            data.forEach((segment, i) => {
                const legendY = legendStartY + (i * 30);

                ctx.fillStyle = segment.color;
                ctx.fillRect(legendX, legendY - 5, 12, 12);

                ctx.fillStyle = COLORS.text;
                ctx.font = FONTS.small;
                ctx.fillText(segment.label, legendX + 18, legendY + 1);

                ctx.fillStyle = COLORS.textDim;
                ctx.font = FONTS.tiny;
                const pct = Math.round(segment.value / total * 100);
                ctx.fillText(`${pct}% (${funcs.abbr(segment.value)})`, legendX + 18, legendY + 15);
            });

            ctx.globalAlpha = 1;
        }

        if (frame >= TOTAL_FRAMES - 4) {
            const textAlpha = (frame - (TOTAL_FRAMES - 4)) / 4;
            ctx.globalAlpha = textAlpha;

            ctx.fillStyle = COLORS.text;
            ctx.font = 'bold 20px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(funcs.abbr(total), centerX, centerY - 8);

            ctx.fillStyle = COLORS.textDim;
            ctx.font = FONTS.tiny;
            ctx.fillText("Total", centerX, centerY + 12);

            ctx.globalAlpha = 1;
        }

        encoder.addFrame(ctx);
        if (frame % 8 === 0) await new Promise(resolve => setImmediate(resolve));
    }

    encoder.finish();

    return new Promise(resolve => {
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}
//
module.exports = {
    renderLineChart,
    renderBarChart,
    renderStatsCard,
    renderSegmentDonut,
    COLORS
};


// contributors: @relentiousdragon