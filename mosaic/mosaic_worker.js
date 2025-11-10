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
    const { imageData, tileData, tileSize, width, height, blendOpacity, brightnessCompensation } = e.data;
    const results = [];
    
    // 16:9アスペクト比固定 (9 / 16 = 0.5625)
    const ASPECT_RATIO = 9 / 16; 
    const tileWidth = tileSize;
    const tileHeight = Math.round(tileSize * ASPECT_RATIO);
    
    // タイルの使用回数を記録し、公平性を確保するためのマップ
    const usageCount = new Map();

    self.postMessage({ type: 'status', message: 'ブロック解析とL*a*b*マッチング中...' });

    // --- メインループ ---
    for (let y = 0; y < height; y += tileHeight) {
        for (let x = 0; x < width; x += tileWidth) {
            
            // 1. ブロックの平均色を計算 (RGB)
            let r_sum = 0, g_sum = 0, b_sum = 0;
            let pixelCount = 0;

            // ブロック内のピクセルを走査
            const currentBlockWidth = Math.min(tileWidth, width - x);
            const currentBlockHeight = Math.min(tileHeight, height - y);

            for (let py = y; py < y + currentBlockHeight; py++) {
                for (let px = x; px < x + currentBlockWidth; px++) {
                    const i = (py * width + px) * 4;
                    r_sum += imageData.data[i];
                    g_sum += imageData.data[i + 1];
                    b_sum += imageData.data[i + 2];
                    pixelCount++;
                }
            }

            if (pixelCount === 0) continue;

            const r_avg = r_sum / pixelCount;
            const g_avg = g_sum / pixelCount;
            const b_avg = b_sum / pixelCount;
            
            // 2. ブロックのL*a*b*値を計算 (ターゲットL*a*b*)
            const targetLab = rgbToLab(r_avg, g_avg, b_avg);
            
            // 3. 最適なタイルを検索
            let bestMatch = null;
            let minDistance = Infinity;
            
            // L*成分の重み (明度補正を前提とし、L*の影響を大幅に減らす)
            const L_WEIGHT = 0.05; 
            // a*b*成分の重み (色相優先のため、L*の2倍の重み、つまり標準の200%とする)
            const AB_WEIGHT = 2.0; 
            
            for (const tile of tileData) {
                // L*a*b*距離の計算
                const dL = targetLab.l - tile.l;
                const dA = targetLab.a - tile.a;
                const dB = targetLab.b_star - tile.b_star;
                
                // 重み付けされた距離を計算: 色相(a*b*)を優先し、L*の影響を最小限にする
                let distance = Math.sqrt(
                    (L_WEIGHT * dL * dL) +         // L*の差
                    (AB_WEIGHT * dA * dA) +        // a*の差 (色相/彩度) - 2倍に強調
                    (AB_WEIGHT * dB * dB)          // b*の差 (色相/彩度) - 2倍に強調
                );
                
                // 公平性のためのペナルティ (使用回数が多いタイルを避ける)
                const count = usageCount.get(tile.url) || 0;
                const penaltyFactor = 5; // 調整可能な係数
                distance += count * penaltyFactor; 

                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = tile;
                }
            }

            // 4. 結果を格納
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
