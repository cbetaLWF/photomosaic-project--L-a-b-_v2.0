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

// Workerで受け取ったデータとタイルデータ配列を処理
self.onmessage = async (e) => {
    // ★ 変更点: blendOpacity を削除
    const { 
        imageData, tileData, tileSize, width, height, 
        brightnessCompensation, textureWeight,
        startY, endY 
    } = e.data;
    
    const results = [];
    
    const ASPECT_RATIO = 1.0; 
    const tileWidth = tileSize;
    const tileHeight = Math.round(tileSize * ASPECT_RATIO); 
    
    const usageCount = new Map(); 
    const lastChoiceInRow = new Map();

    self.postMessage({ type: 'status', message: `担当範囲 (Y: ${startY}～${endY}) の処理中...` });

    const totalRowsInChunk = Math.ceil((endY - startY) / tileHeight);
    let processedRows = 0;

    // --- メインループ (担当範囲 y = startY から endY まで) ---
    for (let y = startY; y < endY; y += tileHeight) {
        for (let x = 0; x < width; x += tileWidth) {
            
            const neighborLeft = lastChoiceInRow.get(y); 
            const currentBlockWidth = Math.min(tileWidth, width - x);
            const currentBlockHeight = Math.min(tileHeight, height - y);
            const currentSize = Math.min(currentBlockWidth, currentBlockHeight);
            
            // ( ... 3x3 L*ベクトル計算 (変更なし) ... )
            const oneThirdX = x + Math.floor(currentSize / 3);
            const twoThirdsX = x + Math.floor(currentSize * 2 / 3);
            const oneThirdY = y + Math.floor(currentSize / 3);
            const twoThirdsY = y + Math.floor(currentSize * 2 / 3);
            const sums = Array(9).fill(null).map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
            let r_sum_total = 0, g_sum_total = 0, b_sum_total = 0;
            let pixelCountTotal = 0;
            for (let py = y; py < y + currentSize; py++) {
                const row = (py < oneThirdY) ? 0 : (py < twoThirdsY ? 1 : 2);
                for (let px = x; px < x + currentSize; px++) {
                    const i = (py * width + px) * 4;
                    const r = imageData.data[i]; const g = imageData.data[i + 1]; const b = imageData.data[i + 2];
                    r_sum_total += r; g_sum_total += g; b_sum_total += b; pixelCountTotal++;
                    const col = (px < oneThirdX) ? 0 : (px < twoThirdsX ? 1 : 2);
                    const gridIndex = row * 3 + col;
                    sums[gridIndex].r += r; sums[gridIndex].g += g; sums[gridIndex].b += b; sums[gridIndex].count++;
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
            
            // ( ... 最適なタイルを検索するループ ... )
            let bestMatch = null;
            let bestMatchUrl = null;
            let bestMatchThumbUrl = null; // ★ 修正点1: thumb_urlを保持する変数を追加
            let minDistance = Infinity;
            
            const L_WEIGHT = 0.05; const AB_WEIGHT = 2.0; 
            const LOW_CHROMA_THRESHOLD = 25.0; 
            const HIGH_CHROMA_PENALTY_FACTOR = 10.0; 
            const DEFAULT_CHROMA_PENALTY_FACTOR = 0.5; 
            const TEXTURE_SCALE_FACTOR = 0.5;
            const targetChroma = Math.sqrt(targetLab.a * targetLab.a + targetLab.b_star * targetLab.b_star);
            
            // 6倍拡張に対応したネストループ
            for (const tile of tileData) {
                for (const pattern of tile.patterns) {
                    
                    // ( ... 色距離(colorDistance)の計算 (変更なし) ... )
                    const dL = targetLab.l - pattern.l;
                    const dA = targetLab.a - pattern.a;
                    const dB = targetLab.b_star - pattern.b_star;
                    let baseColorDistance = Math.sqrt((L_WEIGHT * dL * dL) + (AB_WEIGHT * dA * dA) + (AB_WEIGHT * dB * dB));
                    const tileChroma = Math.sqrt(pattern.a * pattern.a + pattern.b_star * pattern.b_star);
                    const chromaDifference = Math.abs(targetChroma - tileChroma);
                    const dynamicChromaPenaltyFactor = (targetChroma < LOW_CHROMA_THRESHOLD) ? HIGH_CHROMA_PENALTY_FACTOR : DEFAULT_CHROMA_PENALTY_FACTOR;
                    const chromaPenalty = chromaDifference * dynamicChromaPenaltyFactor;
                    const colorDistance = baseColorDistance + chromaPenalty;

                    // ( ... 3x3 L*ベクトル距離(textureDistance)の計算 (変更なし) ... )
                    let textureDistanceSquared = 0;
                    for (let k = 0; k < 9; k++) {
                        const diff = target_l_vector[k] - pattern.l_vector[k];
                        textureDistanceSquared += diff * diff;
                    }
                    const textureDistance = Math.sqrt(textureDistanceSquared);

                    // ( ... 最終距離(totalDistance)の計算 (変更なし) ... )
                    let totalDistance = colorDistance + (textureDistance * TEXTURE_SCALE_FACTOR * textureWeight);

                    // ( ... 公平性ペナルティ (変更なし) ... )
                    const patternKey = pattern.l_vector.toString(); 
                    const count = usageCount.get(patternKey) || 0; 
                    const fairnessPenalty = count * 0.5; 
                    totalDistance += fairnessPenalty; 

                    // ( ... 隣接ペナルティ (変更なし) ... )
                    if (neighborLeft && tile.url === neighborLeft.url) {
                        const currentType = pattern.type;
                        const neighborType = neighborLeft.type;
                        const currentParts = currentType.split('_');
                        const neighborParts = neighborType.split('_');
                        if (currentParts.length === 2 && neighborParts.length === 2) {
                            const currentCrop = currentParts[0];
                            const currentFlip = currentParts[1];
                            const neighborCrop = neighborParts[0];
                            const neighborFlip = neighborParts[1];
                            if (currentCrop === neighborCrop && currentFlip !== neighborFlip) {
                                totalDistance += 100000.0;
                            }
                        }
                    }
                    
                    if (totalDistance < minDistance) {
                        minDistance = totalDistance;
                        bestMatch = pattern; 
                        bestMatchUrl = tile.url; 
                        bestMatchThumbUrl = tile.thumb_url; // ★ 修正点2: thumb_urlも保持
                    }
                } // 拡張パターン (6種) のループ終わり
            } // タイル (tileData) のループ終わり

            // ( ... 結果を格納するロジック ... )
            if (bestMatch) {
                results.push({
                    url: bestMatchUrl, 
                    thumb_url: bestMatchThumbUrl, // ★ 修正点3: 結果オブジェクトにthumb_urlを追加
                    patternType: bestMatch.type, 
                    x: x, y: y,
                    width: tileWidth, 
                    height: tileHeight, 
                    targetL: targetLab.l, 
                    tileL: bestMatch.l 
                });
                usageCount.set(bestMatch.l_vector.toString(), (usageCount.get(bestMatch.l_vector.toString()) || 0) + 1);
                lastChoiceInRow.set(y, { url: bestMatchUrl, type: bestMatch.type });
            }
        } // xループの終わり

        // ( ... 進捗報告 (変更なし) ... )
        processedRows++;
        self.postMessage({ type: 'progress', progress: processedRows / totalRowsInChunk });

    } // yループの終わり

    // 完了と「部分的な」結果を送信
    self.postMessage({ 
        type: 'complete', 
        results: results, 
        width: width, 
        height: height, 
        // ★ 変更点: blendOpacity を削除
        brightnessCompensation: brightnessCompensation 
    });
};
