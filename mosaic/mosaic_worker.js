// mosaic_worker.js (Hプラン: 詳細ステータス報告 + 無限ループ対策)

// ( ... L*a*b*ヘルパー関数群 (変更なし) ... )
// ( ... renderMosaicPreview (F2描画) 関数 (変更なし) ... )
const REF_X = 95.047; // D65
const REF_Y = 100.000;
const REF_Z = 108.883;
function f(t) {
    return t > 0.008856 ? Math.pow(t, 1/3) : (7.787 * t) + (16 / 116);
}
function rgbToLab(r, g, b) {
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
function getLstar(r, g, b) {
    return rgbToLab(r, g, b).l;
}
async function renderMosaicPreview(
    canvas, 
    tileData, 
    results, 
    mainImageBitmap, 
    edgeImageBitmap, 
    thumbSheetBitmap, 
    width, height,
    lightParams
) {
    // ★ 修正: 詳細ステータス報告 (F2-A) ★
    self.postMessage({ type: 'status', message: `F2描画（タイル描画）を開始...` });
    
    const t_render_start = performance.now(); 
    const canvasWidth = width;
    const canvasHeight = height;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvasWidth, canvasHeight); 
    ctx.clip(); 
    const MIN_TILE_L = 5.0; 
    const MAX_BRIGHTNESS_RATIO = 5.0; 
    const brightnessFactor = lightParams.brightnessCompensation / 100; 
    const thumbSet = tileData.tileSets.thumb;
    const thumbTileW = thumbSet.tileWidth;
    const thumbTileH = thumbSet.tileHeight;
    for (const tileResult of results) {
        const tileInfo = tileData.tiles[tileResult.tileId];
        if (!tileInfo) continue;
        const pattern = tileInfo.patterns.find(p => p.type === tileResult.patternType);
        if (!pattern) continue;
        let targetL = tileResult.targetL; 
        let tileL = pattern.l; 
        if (tileL < MIN_TILE_L) tileL = MIN_TILE_L; 
        let brightnessRatio = targetL / tileL; 
        if (brightnessRatio > MAX_BRIGHTNESS_RATIO) {
            brightnessRatio = MAX_BRIGHTNESS_RATIO;
        }
        const finalBrightness = (1 - brightnessFactor) + (brightnessFactor * brightnessRatio); 
        ctx.filter = `brightness(${finalBrightness.toFixed(4)})`;
        const dx = tileResult.x;
        const dy = tileResult.y;
        const dWidth = tileResult.width;
        const dHeight = tileResult.height; 
        const coords = tileInfo.thumbCoords;
        const sourceSheet = thumbSheetBitmap; 
        const sSize = Math.min(thumbTileW, thumbTileH);
        const isHorizontal = thumbTileW > thumbTileH;
        let sx = coords.x;
        let sy = coords.y;
        const typeParts = tileResult.patternType.split('_'); 
        const cropType = typeParts[0]; 
        const flipType = typeParts[1]; 
        if (isHorizontal) {
            if (cropType === "cropC") sx += Math.floor((thumbTileW - sSize) / 2);
            else if (cropType === "cropR") sx += (thumbTileW - sSize);
        } else {
            if (cropType === "cropM") sy += Math.floor((thumbTileH - sSize) / 2);
            else if (cropType === "cropB") sy += (thumbTileH - sSize);
        }
        ctx.save();
        if (flipType === "flip1") {
            ctx.scale(-1, 1);
            ctx.drawImage(sourceSheet, sx, sy, sSize, sSize, -dx - dWidth, dy, dWidth, dHeight);
        } else {
            ctx.drawImage(sourceSheet, sx, sy, sSize, sSize, dx, dy, dWidth, dHeight);
        }
        ctx.restore();
        ctx.filter = 'none';
    }
    const t_render_tile_end = performance.now();
    ctx.restore(); 

    // ★ 修正: 詳細ステータス報告 (F2-B) ★
    self.postMessage({ type: 'status', message: `F2描画（ブレンド処理）を開始...` });

    if (lightParams.blendOpacity > 0 && mainImageBitmap) {
        ctx.globalCompositeOperation = 'soft-light'; 
        ctx.globalAlpha = lightParams.blendOpacity / 100;
        ctx.drawImage(mainImageBitmap, 0, 0, canvasWidth, canvasHeight);
    }
    if (lightParams.edgeOpacity > 0 && edgeImageBitmap) {
        ctx.globalCompositeOperation = 'multiply'; 
        ctx.globalAlpha = lightParams.edgeOpacity / 100;
        ctx.drawImage(edgeImageBitmap, 0, 0, canvasWidth, canvasHeight);
    }
    ctx.globalCompositeOperation = 'source-over'; 
    ctx.globalAlpha = 1.0; 
    const t_render_blend_end = performance.now();
    return { 
        tileTime: t_render_tile_end - t_render_start,
        blendTime: t_render_blend_end - t_render_tile_end
    };
}


// Workerで受け取ったデータとタイルデータ配列を処理
self.onmessage = async (e) => {
    
    try {
        // ★ 修正: 詳細ステータス報告 ★
        self.postMessage({ type: 'status', message: `起動。必須データを検証中...` });
        
        const t_f1_start = performance.now();
        
        const { 
            imageDataArray, tileData, tileSize, width, height, 
            brightnessCompensation, textureWeight,
            startY, endY,
            mainImageBitmap, edgeImageBitmap, thumbSheetBitmap, lightParams,
            isRerender
        } = e.data;
        
        // ( ... 事前検証 (Sanity Check) ... )
        if (!imageDataArray) {
            throw new Error("Worker Error: 'imageDataArray' (ピクセル配列) が main.js から渡されませんでした。");
        }
        if (!tileData) {
            throw new Error("Worker Error: 'tileData' (JSON) が main.js から渡されませんでした。");
        }
        if (!mainImageBitmap) {
            throw new Error("Worker Error: 'mainImageBitmap' (メイン画像) が main.js から渡されませんでした。");
        }
        if (!thumbSheetBitmap) {
            throw new Error("Worker Error: 'thumbSheetBitmap' (スプライトシート) が main.js から渡されませんでした。");
        }
        if (!lightParams) {
            throw new Error("Worker Error: 'lightParams' (描画パラメータ) が main.js から渡されませんでした。");
        }
        if (!tileSize || tileSize < 1 || isNaN(tileSize)) {
            throw new Error(`Worker Error: 不正なタイルサイズです: ${tileSize}。1以上の数値を入力してください。`);
        }

        // ★ 修正: 詳細ステータス報告 ★
        self.postMessage({ type: 'status', message: `検証完了。F1計算ループを開始...` });

        const tiles = tileData.tiles;
        
        let results = []; 
        let f1Time = 0;
        
        const ASPECT_RATIO = 1.0; 
        const tileWidth = tileSize;
        const tileHeight = Math.round(tileSize * ASPECT_RATIO); 
        
        const usageCount = new Map(); 
        const lastChoiceInRow = new Map();

        const totalRowsInChunk = Math.ceil((endY - startY) / tileHeight);
        let processedRows = 0;

        // --- F1: メインループ (計算) ---
        for (let y = startY; y < endY; y += tileHeight) {
            for (let x = 0; x < width; x += tileWidth) {
                
                // ( ... F1計算ロジック (変更なし) ... )
                const neighborLeft = lastChoiceInRow.get(y); 
                const currentBlockWidth = Math.min(tileWidth, width - x);
                const currentBlockHeight = Math.min(tileHeight, height - y);
                const thumbW = tileData.tileSets.thumb.tileWidth;
                const thumbH = tileData.tileSets.thumb.tileHeight;
                const sSize = Math.min(thumbW, thumbH);
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
                        const r = imageDataArray[i]; 
                        const g = imageDataArray[i + 1]; 
                        const b = imageDataArray[i + 2];
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
                let bestMatchPattern = null;
                let bestMatchTileId = -1; 
                let minDistance = Infinity;
                const L_WEIGHT = 0.05; const AB_WEIGHT = 2.0; 
                const LOW_CHROMA_THRESHOLD = 25.0; 
                const HIGH_CHROMA_PENALTY_FACTOR = 10.0; 
                const DEFAULT_CHROMA_PENALTY_FACTOR = 0.5; 
                const TEXTURE_SCALE_FACTOR = 0.5;
                const targetChroma = Math.sqrt(targetLab.a * targetLab.a + targetLab.b_star * targetLab.b_star);
                for (const tile of tiles) {
                    for (const pattern of tile.patterns) {
                        const dL = targetLab.l - pattern.l;
                        const dA = targetLab.a - pattern.a;
                        const dB = targetLab.b_star - pattern.b_star;
                        let baseColorDistance = Math.sqrt((L_WEIGHT * dL * dL) + (AB_WEIGHT * dA * dA) + (AB_WEIGHT * dB * dB));
                        const tileChroma = Math.sqrt(pattern.a * pattern.a + pattern.b_star * pattern.b_star);
                        const chromaDifference = Math.abs(targetChroma - tileChroma);
                        const dynamicChromaPenaltyFactor = (targetChroma < LOW_CHROMA_THRESHOLD) ? HIGH_CHROMA_PENALTY_FACTOR : DEFAULT_CHROMA_PENALTY_FACTOR;
                        const chromaPenalty = chromaDifference * dynamicChromaPenaltyFactor;
                        const colorDistance = baseColorDistance + chromaPenalty;
                        let textureDistanceSquared = 0;
                        for (let k = 0; k < 9; k++) {
                            const diff = target_l_vector[k] - pattern.l_vector[k];
                            textureDistanceSquared += diff * diff;
                        }
                        const textureDistance = Math.sqrt(textureDistanceSquared);
                        let totalDistance = colorDistance + (textureDistance * TEXTURE_SCALE_FACTOR * textureWeight);
                        const patternKey = pattern.l_vector.toString(); 
                        const count = usageCount.get(patternKey) || 0; 
                        const fairnessPenalty = count * 0.5; 
                        totalDistance += fairnessPenalty; 
                        if (neighborLeft && tile.id === neighborLeft.tileId) {
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
                            bestMatchPattern = pattern; 
                            bestMatchTileId = tile.id; 
                        }
                    } 
                } 
                if (bestMatchPattern) {
                    results.push({
                        tileId: bestMatchTileId,            
                        patternType: bestMatchPattern.type, 
                        x: x, y: y,
                        width: tileWidth,     
                        height: tileHeight,    
                        targetL: targetLab.l, 
                        tileL: bestMatchPattern.l
                    });
                    usageCount.set(bestMatchPattern.l_vector.toString(), (usageCount.get(bestMatchPattern.l_vector.toString()) || 0) + 1);
                    lastChoiceInRow.set(y, { tileId: bestMatchTileId, type: bestMatchPattern.type });
                }
            } // xループの終わり

            // ★ 修正: F1の進捗は'progress'で報告
            processedRows++;
            self.postMessage({ type: 'progress', progress: processedRows / totalRowsInChunk });
        } // yループの終わり
        
        const t_f1_end = performance.now();
        f1Time = (t_f1_end - t_f1_start) / 1000.0;
        
        // ★ 修正: 詳細ステータス報告 ★
        self.postMessage({ type: 'status', message: `F1計算完了。F2描画準備中...` });
        
        const t_f2_start = performance.now();
        const previewCanvas = new OffscreenCanvas(width, height);

        // F2描画処理 (内部で 'F2描画（タイル描画）' と 'F2描画（ブレンド処理）' を報告)
        const { tileTime, blendTime } = await renderMosaicPreview(
            previewCanvas, tileData, results,
            mainImageBitmap, edgeImageBitmap, 
            thumbSheetBitmap,
            width, height, lightParams
        );
        
        const finalBitmap = previewCanvas.transferToImageBitmap();
        const t_f2_end = performance.now();
        
        const f2Time = (t_f2_end - t_f2_start) / 1000.0;

        // ★ 修正: 詳細ステータス報告 ★
        self.postMessage({ type: 'status', message: `F2描画完了。メインスレッドへ転送中...` });

        // メインスレッドに結果を返送
        self.postMessage({ 
            type: 'complete', 
            bitmap: finalBitmap,
            f1Time: f1Time,
            f2Time: f2Time,
            f2TileTime: tileTime / 1000.0,
            f2BlendTime: blendTime / 1000.0,
            f1Skipped: isRerender,
            drawTiles: results.length,
            jsonSizeKB: (JSON.stringify(results).length / 1024)
        }, [finalBitmap]);

    } catch (error) {
        // ( ... catchブロック (変更なし) ... )
        let detailedMessage = `F1/F2 Worker CRASH: ${error.message}\n`;
        if (error.stack) {
            detailedMessage += `Stack: ${error.stack}`;
        }
        if (error.message.includes("Cannot read properties of null") || error.message.includes("undefined")) {
            detailedMessage += "\nHint: 'imageDataArray' または 'tileData' が null または undefined のまま使用されようとしました。";
        }
        if (error.message.includes("Invalid tile size")) {
             detailedMessage += "\nHint: タイルサイズに 0 または NaN が指定されました。";
        }
        if (error.name === 'ReferenceError') {
            detailedMessage += "\nHint: 'idbKeyval' のような未定義の変数や関数が呼び出されました。";
        }
        self.postMessage({ 
            type: 'error', 
            message: detailedMessage 
        });
    }
};
