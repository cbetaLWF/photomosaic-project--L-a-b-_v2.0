// L*a*b*変換のための定数とヘルパー関数
const REF_X = 95.047; // D65
const REF_Y = 100.000;
const REF_Z = 108.883;

// ★ 修正点: 欠落していた f(t) 関数を追加
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

// Workerで受け取ったデータとタイルデータ配列を処理
self.onmessage = async (e) => {
    // 担当範囲 startY, endY を受け取る
    const { 
        imageData, tileData, tileSize, width, height, 
        blendOpacity, brightnessCompensation, textureWeight,
        startY, endY 
    } = e.data;
    
    const results = [];
    
    const ASPECT_RATIO = 1.0; 
    const tileWidth = tileSize;
    const tileHeight = Math.round(tileSize * ASPECT_RATIO); // = tileWidth
    
    const usageCount = new Map(); 

    // ★ 変更点 1: このWorkerが処理する各行(y)の「最後に配置したタイル情報」を記憶するMap
    const lastChoiceInRow = new Map();

    self.postMessage({ type: 'status', message: `担当範囲 (Y: ${startY}～${endY}) の処理中...` });

    const totalRowsInChunk = Math.ceil((endY - startY) / tileHeight);
    let processedRows = 0;

    // --- メインループ (担当範囲 y = startY から endY まで) ---
    for (let y = startY; y < endY; y += tileHeight) {
        for (let x = 0; x < width; x += tileWidth) {
            
            // ★ 変更点 2: このセルの「左隣」に配置されたタイル情報を取得
            const neighborLeft = lastChoiceInRow.get(y); // (x=0 の場合は undefined)

            // ターゲットブロックのサイズ
            const currentBlockWidth = Math.min(tileWidth, width - x);
            const currentBlockHeight = Math.min(tileHeight, height - y);

            // 常に正方形のブロックを処理する
            const currentSize = Math.min(currentBlockWidth, currentBlockHeight);
            
            // 3x3 L*ベクトル計算のための準備 (currentSize基準)
            const oneThirdX = x + Math.floor(currentSize / 3);
            const twoThirdsX = x + Math.floor(currentSize * 2 / 3);
            const oneThirdY = y + Math.floor(currentSize / 3);
            const twoThirdsY = y + Math.floor(currentSize * 2 / 3);

            const sums = Array(9).fill(null).map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
            
            let r_sum_total = 0, g_sum_total = 0, b_sum_total = 0;
            let pixelCountTotal = 0;

            // currentSize (正方形) の範囲でブロックを走査
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

            // ターゲットブロックの平均L*a*b*と3x3 L*ベクトル (正方形ベース)
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
                    
                    // --- 1. 色距離 (Color Distance) の計算 ---
                    const dL = targetLab.l - pattern.l;
                    const dA = targetLab.a - pattern.a;
                    const dB = targetLab.b_star - pattern.b_star;
                    let baseColorDistance = Math.sqrt((L_WEIGHT * dL * dL) + (AB_WEIGHT * dA * dA) + (AB_WEIGHT * dB * dB));
                    const tileChroma = Math.sqrt(pattern.a * pattern.a + pattern.b_star * pattern.b_star);
                    const chromaDifference = Math.abs(targetChroma - tileChroma);
                    const dynamicChromaPenaltyFactor = (targetChroma < LOW_CHROMA_THRESHOLD) ? HIGH_CHROMA_PENALTY_FACTOR : DEFAULT_CHROMA_PENALTY_FACTOR;
                    const chromaPenalty = chromaDifference * dynamicChromaPenaltyFactor;
                    const colorDistance = baseColorDistance + chromaPenalty;

                    // --- 2. 3x3 L*ベクトル距離 (Texture Distance) の計算 ---
                    let textureDistanceSquared = 0;
                    for (let k = 0; k < 9; k++) {
                        const diff = target_l_vector[k] - pattern.l_vector[k];
                        textureDistanceSquared += diff * diff;
                    }
                    const textureDistance = Math.sqrt(textureDistanceSquared);

                    // --- 3. 最終距離(totalDistance)の計算 ---
                    let totalDistance = colorDistance + (textureDistance * TEXTURE_SCALE_FACTOR * textureWeight);

                    // --- 4. 公平性ペナルティ ---
                    const patternKey = pattern.l_vector.toString(); 
                    const count = usageCount.get(patternKey) || 0; 
                    const fairnessPenalty = count * 0.5; 
                    totalDistance += fairnessPenalty; 

                    // ★ 変更点 3: 【Hard Rule】 反転隣接ペナルティ
                    if (neighborLeft && tile.url === neighborLeft.url) {
                        const currentType = pattern.type;    // 例: "cropC_flip1"
                        const neighborType = neighborLeft.type; // 例: "cropC_flip0"

                        const currentParts = currentType.split('_');
                        const neighborParts = neighborType.split('_');

                        if (currentParts.length === 2 && neighborParts.length === 2) {
                            const currentCrop = currentParts[0]; // "cropC"
                            const currentFlip = currentParts[1]; // "flip1"
                            const neighborCrop = neighborParts[0]; // "cropC"
                            const neighborFlip = neighborParts[1]; // "flip0"

                            // 「クロップ位置が同じ」かつ「反転状態が異なる」場合
                            if (currentCrop === neighborCrop && currentFlip !== neighborFlip) {
                                // これは最悪パターンなので、選ばれないよう巨大なペナルティを課す
                                totalDistance += 100000.0;
                            }
                        }
                    }
                    
                    if (totalDistance < minDistance) {
                        minDistance = totalDistance;
                        bestMatch = pattern; // 最適な「パターン」
                        bestMatchUrl = tile.url; // その「画像URL」
                    }
                } // 拡張パターン (6種) のループ終わり
            } // タイル (tileData) のループ終わり

            // ( ... 結果を格納するロジック ... )
            if (bestMatch) {
                results.push({
                    url: bestMatchUrl, // 実際に描画する画像URL
                    patternType: bestMatch.type, // どの拡張パターンが選ばれたか
                    x: x,
                    y: y,
                    width: tileWidth, // フルサイズ
                    height: tileHeight, // フルサイズ
                    targetL: targetLab.l, // ブロックのL*値
                    tileL: bestMatch.l // 選ばれた「パターン」のL*値
                });

                // 公平性カウントを更新
                usageCount.set(bestMatch.l_vector.toString(), (usageCount.get(bestMatch.l_vector.toString()) || 0) + 1);

                // ★ 変更点 4: この行(y)の「最後に配置したタイル」として記憶
                lastChoiceInRow.set(y, { url: bestMatchUrl, type: bestMatch.type });
            }
        } // xループの終わり

        // 1行処理するごとに進捗を報告
        processedRows++;
        self.postMessage({ type: 'progress', progress: processedRows / totalRowsInChunk });

    } // yループの終わり

    // 完了と「部分的な」結果を送信
    self.postMessage({ 
        type: 'complete', 
        results: results, 
        width: width, 
        height: height, 
        blendOpacity: blendOpacity, 
        brightnessCompensation: brightnessCompensation 
    });
};
