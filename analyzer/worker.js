// L*a*b*変換のための定数とヘルパー関数
const REF_X = 95.047; // D65
const REF_Y = 100.000;
const REF_Z = 108.883;

function f(t) {
    return t > 0.008856 ? Math.pow(t, 1/3) : (7.787 * t) + (16 / 116);
}

function rgbToLab(r, g, b) {
    // 1. RGB to XYZ
    r /= 255; g /= 255; b /= 255;
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100;
    let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100;
    // 2. XYZ to L*a*b*
    let fx = f(x / REF_X); let fy = f(y / REF_Y); let fz = f(z / REF_Z);
    let l = (116 * fy) - 16; let a = 500 * (fx - fy); let b_star = 200 * (fy - fz);
    l = Math.max(0, Math.min(100, l));
    return { l: l, a: a, b_star: b_star };
}

// 平均RGBからL*値のみを返す簡易ヘルパー
function getLstar(r, g, b) {
    return rgbToLab(r, g, b).l;
}

/**
 * ★ 変更点: データ拡張（クロップ、反転）を行い、
 * 6つのパターン（Lab平均色と3x3 L*ベクトル）を計算するコア関数
 */
async function analyzeImagePatterns(file) {
    const imageBitmap = await createImageBitmap(file);
    const patterns = [];

    const baseWidth = imageBitmap.width;
    const baseHeight = imageBitmap.height;
    
    // 1. クロップ設定 (短辺に合わせた正方形)
    const size = Math.min(baseWidth, baseHeight);
    const cropSettings = [
        { name: "cropL", x: 0, y: 0 }, // 左クロップ
        { name: "cropC", x: Math.floor((baseWidth - size) / 2), y: 0 }, // 中央クロップ
        { name: "cropR", x: baseWidth - size, y: 0 }  // 右クロップ
    ];

    // 2. 反転設定
    const flipSettings = [
        { name: "flip0", flip: false }, // 通常
        { name: "flip1", flip: true }  // 水平反転
    ];

    // 3x3 L*ベクトル計算用の境界 (正方形なので共通)
    const oneThird = Math.floor(size / 3);
    const twoThirds = Math.floor(size * 2 / 3);
    
    // 一時描画用のOffscreenCanvas
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // --- 3 (クロップ) x 2 (反転) = 6 パターンのループ ---
    for (const crop of cropSettings) {
        for (const flip of flipSettings) {
            
            // --- 描画フェーズ ---
            ctx.clearRect(0, 0, size, size);
            if (flip.flip) {
                ctx.save();
                ctx.scale(-1, 1); // 左右反転
                // 元画像からクロップ領域を指定して、反転描画
                ctx.drawImage(imageBitmap, crop.x, crop.y, size, size, -size, 0, size, size);
                ctx.restore();
            } else {
                // 元画像からクロップ領域を指定して、通常描画
                ctx.drawImage(imageBitmap, crop.x, crop.y, size, size, 0, 0, size, size);
            }
            
            // --- 解析フェーズ ---
            const imageData = ctx.getImageData(0, 0, size, size);
            const data = imageData.data;
            const sums = Array(9).fill(null).map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
            let r_sum_total = 0, g_sum_total = 0, b_sum_total = 0;
            const pixelCountTotal = data.length / 4;

            for (let y = 0; y < size; y++) {
                const row = (y < oneThird) ? 0 : (y < twoThirds ? 1 : 2);
                for (let x = 0; x < size; x++) {
                    const idx = (y * size + x) * 4;
                    const r = data[idx], g = data[idx+1], b = data[idx+2];

                    r_sum_total += r; g_sum_total += g; b_sum_total += b;
                    
                    const col = (x < oneThird) ? 0 : (x < twoThirds ? 1 : 2);
                    const gridIndex = row * 3 + col;
                    
                    sums[gridIndex].r += r; sums[gridIndex].g += g; sums[gridIndex].b += b;
                    sums[gridIndex].count++;
                }
            }
            
            // このパターンの平均L*a*b*
            const r_avg = r_sum_total / pixelCountTotal;
            const g_avg = g_sum_total / pixelCountTotal;
            const b_avg = b_sum_total / pixelCountTotal;
            const lab = rgbToLab(r_avg, g_avg, b_avg);

            // このパターンの3x3 L*ベクトル
            const l_vector = sums.map(s => {
                if (s.count === 0) return 0;
                return getLstar(s.r / s.count, s.g / s.count, s.b / s.count);
            });

            // 6つのパターンの1つとして結果を追加
            patterns.push({
                type: `${crop.name}_${flip.name}`,
                l: lab.l,
                a: lab.a,
                b_star: lab.b_star,
                l_vector: l_vector
            });
        }
    }
    return patterns;
}


// Workerで受け取った画像データ配列を処理
self.onmessage = async (e) => {
    const { files } = e.data;
    const results = [];
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) continue;

        try {
            // ★ 変更点: 6パターンを生成する関数を呼び出す
            const patterns = await analyzeImagePatterns(file);

            // 結果を格納 (新しいJSON構造)
            results.push({
                url: `tiles/${file.name}`, 
                // ★ 変更点: 6つの拡張パターンを配列で保存
                patterns: patterns 
            });
            
            self.postMessage({ type: 'progress', progress: (i + 1) / totalFiles, fileName: file.name });

        } catch (error) {
            self.postMessage({ type: 'error', message: `解析エラー (${file.name}): ${error.message}` });
        }
    }

    self.postMessage({ type: 'complete', results: results });
};
