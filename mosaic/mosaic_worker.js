// RGB -> L*a*b* 変換のためのヘルパー関数 (Analyzerと同じロジック)
function rgbToLab(r, g, b) {
    let var_R = r / 255;
    let var_G = g / 255;
    let var_B = b / 255;

    // Gamma correction
    if (var_R > 0.04045) var_R = Math.pow(((var_R + 0.055) / 1.055), 2.4);
    else var_R = var_R / 12.92;
    if (var_G > 0.04045) var_G = Math.pow(((var_G + 0.055) / 1.055), 2.4);
    else var_G = var_G / 12.92;
    if (var_B > 0.04045) var_B = Math.pow(((var_B + 0.055) / 1.055), 2.4);
    else var_B = var_B / 12.92;

    var_R = var_R * 100;
    var_G = var_G * 100;
    var_B = var_B * 100;

    // RGB to XYZ conversion
    let X = var_R * 0.4124 + var_G * 0.3576 + var_B * 0.1805;
    let Y = var_R * 0.2126 + var_G * 0.7152 + var_B * 0.0722;
    let Z = var_R * 0.0193 + var_G * 0.1192 + var_B * 0.9505;

    // Reference White Point (D65)
    let ref_X = 95.047; 
    let ref_Y = 100.000;
    let ref_Z = 108.883;

    let var_X = X / ref_X;
    let var_Y = Y / ref_Y;
    let var_Z = Z / ref_Z;

    // f(t) function for L*a*b*
    const f = (t) => t > 0.008856 ? Math.pow(t, (1 / 3)) : (7.787 * t) + (16 / 116);

    var_X = f(var_X);
    var_Y = f(var_Y);
    var_Z = f(var_Z);

    // L*a*b*値の計算
    let L = (116 * var_Y) - 16;
    let a = 500 * (var_X - var_Y);
    let b_star = 200 * (var_Y - var_Z);
    
    // 値を丸めて精度を保つ
    return { 
        l: parseFloat(L.toFixed(4)), 
        a: parseFloat(a.toFixed(4)), 
        b_star: parseFloat(b_star.toFixed(4)) 
    };
}


// Workerで受け取ったデータとタイルデータ配列を処理
self.onmessage = async (e) => {
    const { imageData, tileData, tileSize, width, height, blendOpacity, brightnessCompensation } = e.data;
    const results = [];
    
    // ★修正ポイント1: タイルブロックの縦横比を16:9に固定して計算★
    const tileWidth = tileSize;
    // 高さ = 幅 * (9 / 16)
    const fixedAspectRatio = 9 / 16; 
    const tileHeight = Math.round(tileWidth * fixedAspectRatio); 
    const safeTileHeight = Math.max(tileHeight, 1); 

    const usageCount = new Map();

    self.postMessage({ type: 'status', message: 'ブロック解析とマッチング中 (L*a*b*)...' });

    // ブロック分割に固定された safeTileHeight を使用
    for (let y = 0; y < height; y += safeTileHeight) {
        for (let x = 0; x < width; x += tileWidth) {
            
            // 1. ブロックの平均色を計算 (RGB)
            let r_sum = 0, g_sum = 0, b_sum = 0;
            let pixelCount = 0;

            // ブロック内のピクセル走査に safeTileHeight を使用
            for (let py = y; py < Math.min(y + safeTileHeight, height); py++) {
                for (let px = x; px < Math.min(x + tileWidth, width); px++) {
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
            
            // 2. ブロックの平均RGBをL*a*b*に変換 (ターゲットL*値を取得)
            const main_lab = rgbToLab(r_avg, g_avg, b_avg);

            // 3. 最適なタイルをL*a*b*距離で検索
            let bestMatch = null;
            let minDistance = Infinity;
            
            for (const tile of tileData) {
                // L*a*b* ユークリッド距離 (Delta E)
                const dL = main_lab.l - tile.l;
                const dA = main_lab.a - tile.a;
                const dB = main_lab.b_star - tile.b_star;
                
                let distance = Math.sqrt(dL * dL + dA * dA + dB * dB); 
                
                // 公平性のためのペナルティ
                const count = usageCount.get(tile.url) || 0;
                const penaltyFactor = 5; 
                distance += count * penaltyFactor; 

                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = tile;
                }
            }

            // 4. 結果を格納 (ターゲットL*とタイルのL*を格納)
            if (bestMatch) {
                results.push({
                    url: bestMatch.url,
                    x: x,
                    y: y,
                    width: Math.min(tileWidth, width - x), 
                    // 描画サイズに safeTileHeight を使用
                    height: Math.min(safeTileHeight, height - y), 
                    targetL: main_lab.l,
                    tileL: bestMatch.l
                });
                // 使用回数を更新
                usageCount.set(bestMatch.url, (usageCount.get(bestMatch.url) || 0) + 1);
            }
            
            // 進捗をメインスレッドに通知
            if ((y * width + x) % (width * safeTileHeight * 5) === 0) {
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
        brightnessCompensation: brightnessCompensation // 明度補正設定もメインスレッドに返す
    });
};
