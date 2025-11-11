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

    l = Math.max(0, Math.min(100, l));

    return { l: l, a: a, b_star: b_star };
}

// ★ 変更点: 平均RGBからL*値のみを返す簡易ヘルパー
function getLstar(r, g, b) {
    return rgbToLab(r, g, b).l;
}

// Workerで受け取ったデータとタイルデータ配列を処理
self.onmessage = async (e) => {
    // ★ 変更点 (提案3): histogramWeight -> textureRatio (0.0-1.0の比率)
    const { imageData, tileData, tileSize, width, height, blendOpacity, brightnessCompensation, textureRatio } = e.data;
    const results = [];
    
    const ASPECT_RATIO = 9 / 16; 
    const tileWidth = tileSize;
    const tileHeight = Math.round(tileSize * ASPECT_RATIO);
    
    const usageCount = new Map();
    
    // ★ 変更点: ヒストグラム定数を削除

    self.postMessage({ type: 'status', message: 'ブロック解析とL*a*b*・空間L*ベクトル マッチング中...' });

    // --- メインループ ---
    for (let y = 0; y < height; y += tileHeight) {
        for (let x = 0; x < width; x += tileWidth) {
            
            // ブロック内のピクセルを走査
            const currentBlockWidth = Math.min(tileWidth, width - x);
            const currentBlockHeight = Math.min(tileHeight, height - y);
            
            // --- ★ 変更点 (提案2): 2x2 L*ベクトル計算のための準備 ---
            const midX = x + Math.floor(currentBlockWidth / 2);
            const midY = y + Math.floor(currentBlockHeight / 2);

            // [0]=TL, [1]=TR, [2]=BL, [3]=BR
            const sums = [
                { r: 0, g: 0, b: 0, count: 0 }, // Top-Left
                { r: 0, g: 0, b: 0, count: 0 }, // Top-Right
                { r: 0, g: 0, b: 0, count: 0 }, // Bottom-Left
                { r: 0, g: 0, b: 0, count: 0 }  // Bottom-Right
            ];
            
            // 全体の平均色計算用
            let r_sum_total = 0, g_sum_total = 0, b_sum_total = 0;
            let pixelCountTotal = 0;

            for (let py = y; py < y + currentBlockHeight; py++) {
                for (let px = x; px < x + currentBlockWidth; px++) {
                    const i = (py * width + px) * 4;
                    const r = imageData.data[i];
                    const g = imageData.data[i + 1];
                    const b = imageData.data[i + 2];
                    
                    // 1. 全体の平均色
                    r_sum_total += r;
                    g_sum_total += g;
                    b_sum_total += b;
                    pixelCountTotal++;

                    // 2. ★ 変更点 (提案2): どの領域(Quadrant)に属するか判定
                    let quadIndex;
                    if (py < midY) {
                        quadIndex = (px < midX) ? 0 : 1; // Top
                    } else {
                        quadIndex = (px < midX) ? 2 : 3; // Bottom
                    }
                    sums[quadIndex].r += r;
                    sums[quadIndex].g += g;
                    sums[quadIndex].b += b;
                    sums[quadIndex].count++;
                }
            }

            if (pixelCountTotal === 0) continue;

            // --- ターゲットブロックの全体平均L*a*b*を計算 ---
            const r_avg_total = r_sum_total / pixelCountTotal;
            const g_avg_total = g_sum_total / pixelCountTotal;
            const b_avg_total = b_sum_total / pixelCountTotal;
            const targetLab = rgbToLab(r_avg_total, g_avg_total, b_avg_total);

            // --- ★ 変更点 (提案2): ターゲットブロックの 2x2 L*ベクトルを計算 ---
            const target_l_vector = sums.map(s => {
                if (s.count === 0) return 0;
                return getLstar(s.r / s.count, s.g / s.count, s.b / s.count);
            });
            
            // 3. 最適なタイルを検索
            let bestMatch = null;
            let minDistance = Infinity;
            
            // L*a*b* 色距離の重み (変更なし)
            const L_WEIGHT = 0.05; 
            const AB_WEIGHT = 2.0; 
            
            // 動的彩度ペナルティの定数 (変更なし)
            const LOW_CHROMA_THRESHOLD = 25.0; 
            const HIGH_CHROMA_PENALTY_FACTOR = 10.0; 
            const DEFAULT_CHROMA_PENALTY_FACTOR = 0.5; 
            
            // ★ 変更点 (提案3): テクスチャ距離のスケールを色距離に合わせるための係数
            // 色距離の最大が約400、テクスチャ距離(L* 4次元)の最大が約200 (sqrt(4*100^2))
            // なので、2.0を掛けてスケールを合わせる
            const TEXTURE_SCALE_FACTOR = 2.0;

            // ターゲット彩度 (変更なし)
            const targetChroma = Math.sqrt(targetLab.a * targetLab.a + targetLab.b_star * targetLab.b_star);
            
            for (const tile of tileData) {
                // --- 1. 色距離 (Color Distance) の計算 ---
                const dL = targetLab.l - tile.l;
                const dA = targetLab.a - tile.a;
                const dB = targetLab.b_star - tile.b_star;
                
                let colorDistance = Math.sqrt(
                    (L_WEIGHT * dL * dL) + (AB_WEIGHT * dA * dA) + (AB_WEIGHT * dB * dB)          
                );
                
                // 動的彩度ペナルティ
                const tileChroma = Math.sqrt(tile.a * tile.a + tile.b_star * tile.b_star);
                const chromaDifference = Math.abs(targetChroma - tileChroma);
                const dynamicChromaPenaltyFactor = (targetChroma < LOW_CHROMA_THRESHOLD)
                    ? HIGH_CHROMA_PENALTY_FACTOR
                    : DEFAULT_CHROMA_PENALTY_FACTOR;
                colorDistance += chromaDifference * dynamicChromaPenaltyFactor;

                // --- 2. ★ 変更点 (提案2): テクスチャ距離 (Texture Distance) の計算 ---
                // 4次元 L*ベクトルのユークリッド距離
                const d_l_tl = target_l_vector[0] - tile.l_vector[0];
                const d_l_tr = target_l_vector[1] - tile.l_vector[1];
                const d_l_bl = target_l_vector[2] - tile.l_vector[2];
                const d_l_br = target_l_vector[3] - tile.l_vector[3];
                
                const textureDistance = Math.sqrt(
                    (d_l_tl * d_l_tl) + (d_l_tr * d_l_tr) + (d_l_bl * d_l_bl) + (d_l_br * d_l_br)
                );

                // --- 3. ★ 変更点 (提案3): 最終距離の重み付き計算 ---
                // (1.0 - textureRatio) * 色距離 + textureRatio * テクスチャ距離
                let totalDistance = 
                    (1.0 - textureRatio) * colorDistance + 
                    textureRatio * (textureDistance * TEXTURE_SCALE_FACTOR);

                // --- 4. 公平性ペナルティ (変更なし) ---
                const count = usageCount.get(tile.l_vector) || 0; // キーをl_vectorに変更
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
