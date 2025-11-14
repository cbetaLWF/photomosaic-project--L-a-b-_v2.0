// L*a*b*変換のための定数とヘルパー関数
const REF_X = 95.047; // D65
const REF_Y = 100.000;
const REF_Z = 108.883;

function f(t) {
    return t > 0.008856 ? Math.pow(t, 1/3) : (7.787 * t) + (16 / 116);
}

function rgbToLab(r, g, b) {
    // ( ... rgbToLab関数の内容は変更なし ... )
    r /= 255; g /= 255; b /= 255;
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100;
    let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100;
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
 * ★ 変更点: サムネイル（Blob）を生成するヘルパー関数
 */
async function createThumbnail(imageBitmap, crop, size, quality) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // 中央クロップ (cropC) と同じ正方形領域を描画
    ctx.drawImage(imageBitmap, 
        crop.x, crop.y, // ソース (元画像) のクロップ位置
        crop.sSize, crop.sSize, // ソースのサイズ (正方形)
        0, 0,           // 描画先 (Canvas) の位置
        size, size      // 描画先のサイズ (サムネイルサイズ)
    );

    // Blob (JPEG) を非同期で生成
    return await canvas.convertToBlob({
        type: "image/jpeg",
        quality: quality // 0.0 - 1.0
    });
}


// 縦長/横長画像に対応したクロップと6パターン解析
async function analyzeImagePatterns(imageBitmap, thumbnailSize, thumbnailQuality) {
    const patterns = [];
    const thumbnails = []; // ★ 変更点: サムネイルBlobを格納する配列

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

    // ★ 変更点: サムネイルは「中央クロップ」のみを生成する
    const centralCrop = cropSettings[1]; // cropC または cropM
    const thumbnailBlob = await createThumbnail(imageBitmap, centralCrop, thumbnailSize, thumbnailQuality);
    thumbnails.push(thumbnailBlob); // 1枚だけ生成


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
    // ★ 変更点: L*パターン(6種)と、サムネイルBlob(1枚)を返す
    return { patterns, thumbnails }; 
}


// Workerで受け取った画像データ配列を処理
self.onmessage = async (e) => {
    // ★ 変更点: サムネイル設定を受け取る
    const { files, thumbnailQuality, thumbnailSize } = e.data;
    
    // ★ 変更点: 最終結果をJSON用とサムネイル用に分ける
    const jsonResults = [];
    const thumbnailResults = [];
    
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) continue;

        try {
            const imageBitmap = await createImageBitmap(file);
            
            // ★ 変更点: 6パターンとサムネイル1枚を生成
            const { patterns, thumbnails } = await analyzeImagePatterns(imageBitmap, thumbnailSize, thumbnailQuality);

            // 1. JSON用データ
            const originalUrl = `tiles/${file.name}`;
            const thumbUrl = originalUrl.replace('tiles/', 'tiles_thumb/');
            jsonResults.push({
                url: originalUrl, 
                thumb_url: thumbUrl,
                patterns: patterns 
            });
            
            // 2. サムネイルBlobデータ (ZIP用)
            // (thumbnails[0] が中央クロップのBlob)
            if (thumbnails.length > 0) {
                thumbnailResults.push({
                    path: file.name, // ZIP内のパス (例: image001.jpg)
                    blob: thumbnails[0]
                });
            }
            
            self.postMessage({ type: 'progress', progress: (i + 1) / totalFiles, fileName: file.name });

        } catch (error) {
            self.postMessage({ type: 'error', message: `解析エラー (${file.name}): ${error.message}` });
        }
    }

    // ★ 変更点: JSONとサムネイルBlobの両方をメインスレッドに渡す
    self.postMessage({ 
        type: 'complete', 
        results: {
            json: jsonResults,
            thumbnails: thumbnailResults
        } 
    });
};
