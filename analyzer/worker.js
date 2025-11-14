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
 * ★ 変更点: 1枚の「縮小版」サムネイルを生成する
 */
async function createThumbnail(imageBitmap, thumbWidth, quality) {
    // 元のアスペクト比を維持したまま、指定幅に縮小
    const ratio = thumbWidth / imageBitmap.width;
    const thumbHeight = Math.round(imageBitmap.height * ratio);
    
    const canvas = new OffscreenCanvas(thumbWidth, thumbHeight);
    const ctx = canvas.getContext('2d');
    
    ctx.drawImage(imageBitmap, 
        0, 0, imageBitmap.width, imageBitmap.height, // ソース (元画像)
        0, 0, thumbWidth, thumbHeight               // 描画先 (縮小)
    );

    // Blob (JPEG) を非同期で生成
    return await canvas.convertToBlob({
        type: "image/jpeg",
        quality: quality // 0.0 - 1.0
    });
}


// 縦長/横長画像に対応したクロップと6パターン解析
async function analyzeImagePatterns(imageBitmap) {
    const patterns = [];

    const baseWidth = imageBitmap.width;
    const baseHeight = imageBitmap.height;
    
    // 1. クロップ設定 (短辺に合わせた正方形)
    const sSize = Math.min(baseWidth, baseHeight); // ソースの正方形サイズ
    const isHorizontal = baseWidth > baseHeight; 

    const cropSettings = isHorizontal ? [
        { name: "cropL", x: 0, y: 0, sSize: sSize },
        { name: "cropC", x: Math.floor((baseWidth - sSize) / 2), y: 0, sSize: sSize },
        { name: "cropR", x: baseWidth - sSize, y: 0, sSize: sSize }
    ] : [
        { name: "cropT", x: 0, y: 0, sSize: sSize }, 
        { name: "cropM", x: 0, y: Math.floor((baseHeight - sSize) / 2), sSize: sSize },
        { name: "cropB", x: 0, y: baseHeight - sSize, sSize: sSize }
    ];

    // 2. 反転設定
    const flipSettings = [
        { name: "flip0", flip: false }, // 通常
        { name: "flip1", flip: true }  // 水平反転
    ];

    // 3x3 L*ベクトル計算用の境界 (正方形なので共通)
    const oneThird = Math.floor(sSize / 3);
    const twoThirds = Math.floor(sSize * 2 / 3);
    
    // 一時描画用のOffscreenCanvas (L*ベクトル解析用)
    const analysisCanvas = new OffscreenCanvas(sSize, sSize);
    const ctx = analysisCanvas.getContext('2d');

    // --- 3 (クロップ) x 2 (反転) = 6 パターンのループ ---
    for (const crop of cropSettings) {
        for (const flip of flipSettings) {
            
            // --- 描画フェーズ ---
            ctx.clearRect(0, 0, sSize, sSize);
            if (flip.flip) {
                ctx.save();
                ctx.scale(-1, 1); // 左右反転
                ctx.drawImage(imageBitmap, crop.x, crop.y, sSize, sSize, -sSize, 0, sSize, sSize);
                ctx.restore();
            } else {
                ctx.drawImage(imageBitmap, crop.x, crop.y, sSize, sSize, 0, 0, sSize, sSize);
            }
            
            // --- 解析フェーズ ---
            const imageData = ctx.getImageData(0, 0, sSize, sSize);
            // ( ... 3x3 L*ベクトル計算 ... )
            const data = imageData.data;
            const sums = Array(9).fill(null).map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
            let r_sum_total = 0, g_sum_total = 0, b_sum_total = 0;
            const pixelCountTotal = data.length / 4;
            for (let y = 0; y < sSize; y++) {
                const row = (y < oneThird) ? 0 : (y < twoThirds ? 1 : 2);
                for (let x = 0; x < sSize; x++) {
                    const idx = (y * sSize + x) * 4;
                    const r = data[idx], g = data[idx+1], b = data[idx+2];
                    r_sum_total += r; g_sum_total += g; b_sum_total += b;
                    const col = (x < oneThird) ? 0 : (x < twoThirds ? 1 : 2);
                    const gridIndex = row * 3 + col;
                    sums[gridIndex].r += r; sums[gridIndex].g += g; sums[gridIndex].b += b;
                    sums[gridIndex].count++;
                }
            }
            const r_avg = r_sum_total / pixelCountTotal;
            const g_avg = g_sum_total / pixelCountTotal;
            const b_avg = b_sum_total / pixelCountTotal;
            const lab = rgbToLab(r_avg, g_avg, b_avg);
            const l_vector = sums.map(s => {
                if (s.count === 0) return 0;
                return getLstar(s.r / s.count, s.g / s.count, s.b / s.count);
            });

            patterns.push({
                type: `${crop.name}_${flip.name}`, 
                l: lab.l, a: lab.a, b_star: lab.b_star,
                l_vector: l_vector
            });
        }
    }
    // L*パターン(6種)を返す
    return patterns;
}


// Workerで受け取った画像データ配列を処理
self.onmessage = async (e) => {
    // ★ 変更点: サムネイル設定を受け取る (thumbnailSizeは最大幅)
    const { files, thumbnailQuality, thumbnailSize } = e.data;
    
    const jsonResults = [];
    const thumbnailResults = [];
    
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) continue;

        try {
            const imageBitmap = await createImageBitmap(file);
            
            // 1. L*ベクトルパターン(6種)を生成
            const patterns = await analyzeImagePatterns(imageBitmap);

            // 2. ★ 変更点: 1枚の「縮小版」サムネイルを生成
            const thumbnailBlob = await createThumbnail(imageBitmap, thumbnailSize, thumbnailQuality);

            // 1. JSON用データ
            const originalUrl = `tiles/${file.name}`;
            // ★ 変更点: サムネイルのパスも同じファイル名にする
            // (Mosaic Appは /tiles/ と /tiles_thumb/ を切り替えるため)
            const thumbUrl = originalUrl.replace('tiles/', 'tiles_thumb/');
            
            jsonResults.push({
                url: originalUrl, 
                thumb_url: thumbUrl,
                patterns: patterns 
            });
            
            // 2. サムネイルBlobデータ (ZIP用)
            thumbnailResults.push({
                path: file.name, // ZIP内のパス (例: image001.jpg)
                blob: thumbnailBlob
            });
            
            self.postMessage({ type: 'progress', progress: (i + 1) / totalFiles, fileName: file.name });

        } catch (error) {
            self.postMessage({ type: 'error', message: `解析エラー (${file.name}): ${error.message}` });
        }
    }

    // JSONとサムネイルBlobの両方をメインスレッドに渡す
    self.postMessage({ 
        type: 'complete', 
        results: {
            json: jsonResults,
            thumbnails: thumbnailResults
        } 
    });
};
