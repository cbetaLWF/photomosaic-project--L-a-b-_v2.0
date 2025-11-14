// L*a*b*変換のための定数とヘルパー関数
const REF_X = 95.047; // D65
const REF_Y = 100.000;
const REF_Z = 108.883;

// ★ 修正点: 欠落していた f(t) 関数を追加
// これがクラッシュの根本原因です
function f(t) {
// ... (既存のコード) ...
}

function rgbToLab(r, g, b) {
// ... (既存のコード) ...
}

// 平均RGBからL*値のみを返す簡易ヘルパー
function getLstar(r, g, b) {
// ... (既存のコード) ...
}

// Workerで受け取ったデータとタイルデータ配列を処理
self.onmessage = async (e) => {
    // 担当範囲 startY, endY を受け取る
    const { 
// ... (既存のコード) ...
        startY, endY 
    } = e.data;
    
    const results = [];
    
    const ASPECT_RATIO = 1.0; 
    const tileWidth = tileSize;
    const tileHeight = Math.round(tileSize * ASPECT_RATIO); // = tileWidth
    
    const usageCount = new Map(); 

    // ★ 変更点 1: このWorkerが処理する各行(y)の「最後に配置したタイル情報」を記憶するMap
    // Key: y座標, Value: { url: "...", type: "..." }
    const lastChoiceInRow = new Map();

    self.postMessage({ type: 'status', message: `担当範囲 (Y: ${startY}～${endY}) の処理中...` });

// ... (既存のコード: totalRowsInChunk, processedRows) ...

    // --- メインループ (担当範囲 y = startY から endY まで) ---
    for (let y = startY; y < endY; y += tileHeight) {
        for (let x = 0; x < width; x += tileWidth) {
            
            // ★ 変更点 2: このセルの「左隣」に配置されたタイル情報を取得
            const neighborLeft = lastChoiceInRow.get(y); // (x=0 の場合は undefined)

            // ターゲットブロックのサイズ
            const currentBlockWidth = Math.min(tileWidth, width - x);
// ... (既存のコード: currentSize, 3x3 L*ベクトル計算, targetLab, target_l_vector) ...
// ... (既存のコード: bestMatch, minDistance, 定数定義, targetChroma) ...
            
            // 6倍拡張に対応したネストループ
            for (const tile of tileData) {
                for (const pattern of tile.patterns) {
                    
// ... (既存のコード: colorDistance, textureDistance の計算) ...

                    // --- 3. 最終距離(totalDistance)の計算 ---
                    let totalDistance = colorDistance + (textureDistance * TEXTURE_SCALE_FACTOR * textureWeight);

                    // --- 4. 公平性ペナルティ ---
                    // (Soft Rule: 同じ「パターン」の使いすぎを避ける)
                    const patternKey = pattern.l_vector.toString(); 
                    const count = usageCount.get(patternKey) || 0; 
                    const fairnessPenalty = count * 0.5; 
                    totalDistance += fairnessPenalty; 

                    // ★ 変更点 3: 【Hard Rule】 反転隣接ペナルティ
                    // もし「左隣のタイル」が存在し、かつ「元画像URLが同じ」場合
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
// ... (既存のコード: bestMatch, bestMatchUrl の更新) ...
                    }
                } // 拡張パターン (6種) のループ終わり
            } // タイル (tileData) のループ終わり

            // ( ... 結果を格納するロジック ... )
            if (bestMatch) {
                results.push({
// ... (既存のコード: url, patternType, x, y, width, height, targetL, tileL) ...
                });

                // 公平性カウントを更新
                usageCount.set(bestMatch.l_vector.toString(), (usageCount.get(bestMatch.l_vector.toString()) || 0) + 1);

                // ★ 変更点 4: この行(y)の「最後に配置したタイル」として記憶
                lastChoiceInRow.set(y, { url: bestMatchUrl, type: bestMatch.type });
            }
        } // xループの終わり

// ... (既存のコード: 進捗報告, ループ終わり, 完了報告) ...
};
