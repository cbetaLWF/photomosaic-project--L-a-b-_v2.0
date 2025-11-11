// L*a*b*変換のための定数とヘルパー関数 (Analyzerと同じものをWorkerにも定義)
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

    // L*は0-100の範囲に、a*b*は約-100から+100の範囲になるようにクランプ
    l = Math.max(0, Math.min(100, l));

    return { l: l, a: a, b_star: b_star };
}

// Workerで受け取ったデータとタイルデータ配列を処理
self.onmessage = async (e) => {
    // ★ 変更点: histogramWeight を受け取る
    const { imageData, tileData, tileSize, width, height, blendOpacity, brightnessCompensation, histogramWeight } = e.data;
    const results = [];
    
    // 16:9アスペクト比固定 (9 / 16 = 0.5625)
    const ASPECT_RATIO = 9 / 16; 
    const tileWidth = tileSize;
    const tileHeight = Math.round(tileSize * ASPECT_RATIO);
    
    // タイルの使用回数を記録し、公平性を確保するためのマップ
    const usageCount = new Map();

    // ★ 変更点: ヒストグラム定数 (Analyzerと同一)
    const HISTOGRAM_BINS = 16;
    const BIN_SIZE = 256 / HISTOGRAM_BINS; // 16

    self.postMessage({ type: 'status', message: 'ブロック解析とL*a*b*・ヒストグラム マッチング中...' });

    // --- メインループ ---
    for (let y = 0; y < height; y += tileHeight) {
        for (let x = 0; x < width; x += tileWidth) {
            
            // 1. ブロックの平均色とヒストグラムを計算
            let r_sum = 0, g_sum = 0, b_sum = 0;
            let pixelCount = 0;
            // ★ 変更点: ブロックヒストグラムの初期化
            const blockHistogram = new Array(HISTOGRAM_BINS).fill(0);

            // ブロック内のピクセルを走査
            const currentBlockWidth = Math.min(tileWidth, width - x);
            const currentBlockHeight = Math.min(tileHeight, height - y);

            for (let py = y; py < y + currentBlockHeight; py++) {
                for (let px = x; px < x + currentBlockWidth; px++) {
                    const i = (py * width + px) * 4;
                    const r = imageData.data[i];
                    const g = imageData.data[i + 1];
                    const b = imageData.data[i + 2];
                    
                    // 平均色用
                    r_sum += r;
                    g_sum += g;
                    b_sum += b;
                    
                    // ★ 変更点: ブロックのヒストグラム計算
                    const luma = (r * 0.2126 + g * 0.7152 + b * 0.0722);
                    const binIndex = Math.min(Math.floor(luma / BIN_SIZE), HISTOGRAM_BINS - 1);
                    blockHistogram[binIndex]++;

                    pixelCount++;
                }
            }

            if (pixelCount === 0) continue;

            const r_avg = r_sum / pixelCount;
            const g_avg = g_sum / pixelCount;
            const b_avg = b_sum / pixelCount;
            
            // 2. ブロックのL*a*b*値を計算 (ターゲットL*a*b*)
            const targetLab = rgbToLab(r_avg, g_avg, b_avg);

            // ★ 変更点: ブロックヒストグラムの正規化
            const normalizedBlockHistogram = blockHistogram.map(count => count / pixelCount);
            
            // 3. 最適なタイルを検索
            let bestMatch = null;
            let minDistance = Infinity;
            
            // L*成分の重み (明度補正を前提とし、L*の影響を大幅に減らす)
            const L_WEIGHT = 0.05; 
            // a*b*成分の重み (色相優先のため、L*の2倍の重み)
            const AB_WEIGHT = 2.0; 
            // 彩度ペナルティの係数
            const CHROMA_PENALTY_FACTOR = 0.5; // 彩度差10ごとにペナルティを加える (調整可能)

            // ブロックのターゲット彩度 C* を計算
            const targetChroma = Math.sqrt(targetLab.a * targetLab.a + targetLab.b_star * targetLab.b_star);
            
            for (const tile of tileData) {
                // L*a*b*距離の計算
                const dL = targetLab.l - tile.l;
                const dA = targetLab.a - tile.a;
                const dB = targetLab.b_star - tile.b_star;
                
                // --- 1. 重み付けされたL*a*b*距離 (色) ---
                let distance = Math.sqrt(
                    (L_WEIGHT * dL * dL) +         
                    (AB_WEIGHT * dA * dA) +        
                    (AB_WEIGHT * dB * dB)          
                );
                
                // --- 2. 彩度ペナルティの計算 (C*) ---
                const tileChroma = Math.sqrt(tile.a * tile.a + tile.b_star * tile.b_star);
                const chromaDifference = Math.abs(targetChroma - tileChroma);
                const chromaPenalty = chromaDifference * CHROMA_PENALTY_FACTOR;

                distance += chromaPenalty;

                // --- 3. ★ 変更点: ヒストグラム距離 (テクスチャ) の計算 ---
                // (Sum of Absolute Differences - SAD)
                let histogramDistance = 0;
                for (let k = 0; k < HISTOGRAM_BINS; k++) {
                    histogramDistance += Math.abs(normalizedBlockHistogram[k] - tile.histogram[k]);
                }
                // ヒストグラム距離に重みをかけてペナルティとして加算
                // (histogramDistanceは 0～2 の範囲)
                distance += histogramDistance * histogramWeight;


                // --- 4. 公平性のためのペナルティ ---
                const count = usageCount.get(tile.url) || 0;
                const fairnessPenalty = count * 5; // 調整可能な係数
                distance += fairnessPenalty; 

                if (distance < minDistance) {
                    minDistance = distance;
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
                usageCount.set(bestMatch.url, (usageCount.get(bestMatch.url) || 0) + 1);
            }
            
            // 進捗をメインスレッドに通知 (負荷軽減のため一定間隔で)
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
