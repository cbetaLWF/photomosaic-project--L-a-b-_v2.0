// L*a*b*変換のための定数とヘルパー関数
const REF_X = 95.047; // D65
const REF_Y = 100.000;
const REF_Z = 108.883;

function f(t) {
    return t > 0.008856 ? Math.pow(t, 1/3) : (7.787 * t) + (16 / 116);
}

function rgbToLab(r, g, b) {
    // 1. RGB to XYZ
    r /= 255;
    g /= 255;
    b /= 255;

    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100;
    let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100;

    // 2. XYZ to L*a*b*
    let fx = f(x / REF_X);
    let fy = f(y / REF_Y);
    let fz = f(z / REF_Z);

    let l = (116 * fy) - 16;
    let a = 500 * (fx - fy);
    let b_star = 200 * (fy - fz);

    l = Math.max(0, Math.min(100, l));

    return { l: l, a: a, b_star: b_star };
}

// 平均RGBからL*値のみを返す簡易ヘルパー
function getLstar(r, g, b) {
    return rgbToLab(r, g, b).l;
}

// Workerで受け取ったデータとタイルデータ配列を処理
self.onmessage = async (e) => {
    // ★ 変更点: textureWeight は 0.0〜2.0 の値として受け取る
    const { imageData, tileData, tileSize, width, height, blendOpacity, brightnessCompensation, textureWeight } = e.data;
    const results = [];
    
    const ASPECT_RATIO = 9 / 16; 
    const tileWidth = tileSize;
    const tileHeight = Math.round(tileSize * ASPECT_RATIO);
    
    const usageCount = new Map();

    self.postMessage({ type: 'status', message: 'ブロック解析とL*a*b*・3x3空間L*ベクトル マッチング中...' });

    // --- メインループ ---
    for (let y = 0; y < height; y += tileHeight) {
        for (let x = 0; x < width; x += tileWidth) {
            
            // ブロック内のピクセルを走査
            const currentBlockWidth = Math.min(tileWidth, width - x);
            const currentBlockHeight = Math.min(tileHeight, height - y);
            
            // 3x3 L*ベクトル計算のための準備
            const oneThirdX = x + Math.floor(currentBlockWidth / 3);
            const twoThirdsX = x + Math.floor(currentBlockWidth * 2 / 3);
            const oneThirdY = y + Math.floor(currentBlockHeight / 3);
            const twoThirdsY = y + Math.floor(currentBlockHeight * 2 / 3);

            const sums = Array(9).fill(null).map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
            
            let r_sum_total = 0, g_sum_total = 0, b_sum_total = 0;
            let pixelCountTotal = 0;

            for (let py = y; py < y + currentBlockHeight; py++) {
                const row = (py < oneThirdY) ? 0 : (py < twoThirdsY ? 1 : 2);
                for (let px = x; px < x + currentBlockWidth; px++) {
                    const i = (py * width + px) * 4;
                    const r = imageData.data[i];
                    const g = imageData.data[i + 1];
                    const b = imageData.data[i + 2];
                    
                    r_sum_total += r;
                    g_sum_total += g;
                    b_sum_total += b;
                    pixelCountTotal++;

                    const col = (px < oneThirdX) ? 0 : (px < twoThirdsX ? 1 : 2);
                    const gridIndex = row * 3 + col;
                    
                    sums[gridIndex].r += r;
                    sums[gridIndex].g += g;
                    sums[gridIndex].b += b;
                    sums[gridIndex].count++;
                }
            }

            if (pixelCountTotal === 0) continue;

            const r_avg_total = r_sum_total / pixelCountTotal;
            const g_avg_total = g_sum_total / pixelCountTotal;
            const b_avg_total = b_sum_total / pixelCountTotal;
            const targetLab = rgbToLab(r_avg_total, g_avg_total, b_avg_total);

            const target_l_vector = sums.map(s => {
                if (s.count === 0) return 0;
                return getLstar(s.r / s.count, s.g / s.count, s.b / s.count);
            });
            
            let bestMatch = null;
            let minDistance = Infinity;
            
            const L_WEIGHT = 0.05; 
            const AB_WEIGHT = 2.0; 
            
            const LOW_CHROMA_THRESHOLD = 25.0; 
            const HIGH_CHROMA_PENALTY_FACTOR = 10.0; 
            const DEFAULT_CHROMA_PENALTY_FACTOR = 0.5; 
            
            // ★ 変更点: テクスチャ距離のスケール係数を 0.5 に設定
            // これにより、テクスチャ距離(〜300)が基本色距離(〜150)と
            // バランスが取れるように調整される (300 * 0.5 = 150)
            const TEXTURE_SCALE_FACTOR = 0.5;
            
            const targetChroma = Math.sqrt(targetLab.a * targetLab.a + targetLab.b_star * targetLab.b_star);
            
            for (const tile of tileData) {
                // --- 1. 色距離 (Color Distance) の計算 ---
                const dL = targetLab.l - tile.l;
                const dA = targetLab.a - tile.a;
                const dB = targetLab.b_star - tile.b_star;
                
                // 基本的なL*a*b*距離
                let baseColorDistance = Math.sqrt(
                    (L_WEIGHT * dL * dL) + (AB_WEIGHT * dA * dA) + (AB_WEIGHT * dB * dB)          
                );
                
                // 動的彩度ペナルティ (ノイズ除去の核)
                const tileChroma = Math.sqrt(tile.a * tile.a + tile.b_star * tile.b_star);
                const chromaDifference = Math.abs(targetChroma - tileChroma);
                const dynamicChromaPenaltyFactor = (targetChroma < LOW_CHROMA_THRESHOLD)
                    ? HIGH_CHROMA_PENALTY_FACTOR
                    : DEFAULT_CHROMA_PENALTY_FACTOR;
                const chromaPenalty = chromaDifference * dynamicChromaPenaltyFactor;
                
                // ペナルティを含めた最終的な色距離
                const colorDistance = baseColorDistance + chromaPenalty;

                // --- 2. 3x3 L*ベクトル距離 (Texture Distance) の計算 ---
                let textureDistanceSquared = 0;
                for (let k = 0; k < 9; k++) {
                    const diff = target_l_vector[k] - tile.l_vector[k];
                    textureDistanceSquared += diff * diff;
                }
                const textureDistance = Math.sqrt(textureDistanceSquared);

                // --- 3. 最終距離の「加算」ロジック ---
                // (textureWeight は 0.0 〜 2.0)
                let totalDistance = 
                      colorDistance 
                    + (textureDistance * TEXTURE_SCALE_FACTOR * textureWeight);

                // --- 4. 公平性ペナルティ (弱めた 0.5 で維持) ---
                const count = usageCount.get(tile.l_vector) || 0; 
                const fairnessPenalty = count * 0.5; 
                totalDistance += fairnessPenalty; 

                if (totalDistance < minDistance) {
                    minDistance = totalDistance;
                    bestMatch = tile;
                }
            }

            // 5. 結果を格納
            if (bestMatch) {
                results.push({
                    url: bestMatch.url,
                    x: x,
                    y: y,
                    width: currentBlockWidth,
                    height: currentBlockHeight,
                    targetL: targetLab.l, // ブロックのL*値
                    tileL: bestMatch.l // タイル画像のL*値
                });
                // 使用回数を更新
                usageCount.set(bestMatch.l_vector, (usageCount.get(bestMatch.l_vector) || 0) + 1);
            }
            
            // 進捗をメインスレッドに通知
            if ((y * width + x) % (width * tileHeight * 5) === 0) {
                 self.postMessage({ type: 'progress', progress: (y * width + x) / (width * height) });
            }
        }
    }

    // 完了と結果を送信
    self.postMessage({ 
        type: 'complete', 
        results: results, 
        width: width, 
        height: height, 
        blendOpacity: blendOpacity, 
        brightnessCompensation: brightnessCompensation 
    });
};
