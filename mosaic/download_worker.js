// download_worker.js
// F3処理（高解像度描画 + JPEGエンコード）を完全に実行するWorker

// ★★★ 修正点: 安定性メトリクスのためのグローバルカウンター ★★★
let totalRetryCount = 0;
let totalFailCount = 0;
// ★★★ 修正点ここまで ★★★

// (F2/F3-A共通の並列ロード制御キュー)
async function runBatchedLoads(tilePromises, maxConcurrency) {
    const running = [];

    for (const promise of tilePromises) {
        // 実行中の配列に新しいPromiseを追加
        const p = promise.then(result => {
            // Promiseが解決したら、実行中の配列から自身を削除
            running.splice(running.indexOf(p), 1);
            return result;
        });

        running.push(p);

        // 同時実行数の上限を超えたら、最も古いPromiseの完了を待つ
        if (running.length >= maxConcurrency) {
            await Promise.race(running);
        }
    }
    // 残りのすべてのPromiseが完了するのを待つ
    return Promise.all(running);
}

// ★★★ 修正点: 画像ロード、リトライカウント、サイズ取得 ★★★
async function fetchImageWithRetry(url, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                if (response.status !== 404) {
                    throw new Error(`HTTP Error: ${response.status}`);
                }
                throw new Error(`Non-retryable Error: Status ${response.status}`);
            }
            
            const blob = await response.blob();
            const bitmap = await createImageBitmap(blob);
            
            // ★ 修正: ビットマップとサイズを返す
            return { bitmap: bitmap, size: blob.size }; 
            
        } catch (error) {
            // ★ 修正: リトライ回数をカウント
            totalRetryCount++; 
            
            if (attempt === maxRetries) {
                throw new Error(`Final fetch failure after ${maxRetries} attempts: ${error.message}`);
            }
            console.warn(`Fetch attempt ${attempt} failed for ${url}. Retrying...`);
            await new Promise(r => setTimeout(r, 500 * attempt)); 
        }
    }
}


/**
 * Worker内で実行されるrenderMosaicのコピー (タイル画像ロードのロジックを含む)
 */
async function renderMosaicWorker(
    canvas, 
    tileData, // ★ 修正: JSON全体
    results, // ★ 修正: F1のレシピ
    mainImageBitmap, 
    edgeImageBitmap, 
    fullSheetBitmaps, // ★ 修正: ロード済みのF3スプライトシート配列
    width, height,
    lightParams, scale
) {
    const t_render_start = performance.now(); // 描画時間計測開始

    const canvasWidth = width * scale;
    const canvasHeight = height * scale;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // 1. 元画像の描画 (背景リセット)
    if (mainImageBitmap) {
        ctx.drawImage(mainImageBitmap, 0, 0, canvasWidth, canvasHeight);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvasWidth, canvasHeight); 
    ctx.clip(); 

    // ★ 修正点1: 描画に必要な定数を関数のローカルスコープに定義
    const MIN_TILE_L = 5.0; 
    const MAX_BRIGHTNESS_RATIO = 5.0; 
    const brightnessFactor = lightParams.brightnessCompensation / 100; 

    // F3用のスプライトシート情報を取得
    const fullSet = tileData.tileSets.full;
    const fullTileW = fullSet.tileWidth;   // 1280
    const fullTileH = fullSet.tileHeight;  // 720
    
    // ★ F3描画ループ: F1の結果 (results) に基づいて描画
    for (const tileResult of results) {
        
        const tileInfo = tileData.tiles[tileResult.tileId];
        if (!tileInfo) {
            console.warn(`Tile data not found for id: ${tileResult.tileId}`);
            continue;
        }
        
        // 選択されたパターン（L/C/R, flip0/1）の情報を取得
        const pattern = tileInfo.patterns.find(p => p.type === tileResult.patternType);
        if (!pattern) {
            console.warn(`Pattern ${tileResult.patternType} not found for tile id: ${tileResult.tileId}`);
            continue;
        }
        
        // 1. 明度補正 (変更なし)
        let targetL = tileResult.targetL; 
        let tileL = pattern.l; 
        
        if (tileL < MIN_TILE_L) tileL = MIN_TILE_L; 
        let brightnessRatio = targetL / tileL; 
        if (brightnessRatio > MAX_BRIGHTNESS_RATIO) {
            brightnessRatio = MAX_BRIGHTNESS_RATIO;
        }
        const finalBrightness = (1 - brightnessFactor) + (brightnessFactor * brightnessRatio); 
        ctx.filter = `brightness(${finalBrightness.toFixed(4)})`;

        // 2. 描画座標 (Canvas上の位置)
        const dx = tileResult.x * scale;
        const dy = tileResult.y * scale;
        const dWidth = tileResult.width * scale;
        const dHeight = tileResult.height * scale; 
        
        // 3. ソース座標 (スプライトシート上の位置)
        const coords = tileInfo.fullCoords;
        const sheetIndex = coords.sheetIndex;
        const sourceSheet = fullSheetBitmaps[sheetIndex]; // 対応するシートBitmap
        
        // 4. クロップ計算 (F1の解析ロジックと一致させる)
        const sSize = Math.min(fullTileW, fullTileH); // 720
        const isHorizontal = fullTileW > fullTileH;
        
        let sx = coords.x; // スプライトシート上のタイル左上X (例: 0)
        let sy = coords.y; // スプライトシート上のタイル左上Y (例: 0)
        
        const typeParts = tileResult.patternType.split('_'); 
        const cropType = typeParts[0]; 
        const flipType = typeParts[1]; 
        
        if (isHorizontal) {
            if (cropType === "cropC") sx += Math.floor((fullTileW - sSize) / 2); // 1280-720 / 2
            else if (cropType === "cropR") sx += (fullTileW - sSize); // 1280-720
        } else {
            // (今回は16:9なのでここは実行されない)
            if (cropType === "cropM") sy += Math.floor((fullTileH - sSize) / 2);
            else if (cropType === "cropB") sy += (fullTileH - sSize);
        }

        // 5. 描画実行
        if (!sourceSheet) {
            // ★ 修正: エラーの原因 (fullSheetBitmaps[sheetIndex] が undefined)
            // このエラーは、fullSheetBitmaps がロードされていない場合に発生する
            console.error(`F3スプライトシート[${sheetIndex}]が見つかりません。`);
            continue;
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
    
    const t_render_end = performance.now();

    ctx.restore(); // クリッピングを解除

    // 2段階ブレンド処理 (WorkerではImageBitmapに対して実行)
    // (中略 - 変更なし)
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
    
    return { canvas: canvas, renderTime: t_render_end - t_render_start };
}


self.onmessage = async (e) => {
    const t_start = performance.now();
    
    // ★★★ 修正点: 安定性メトリクスのリセット ★★★
    totalRetryCount = 0;
    totalFailCount = 0;
    
    const { 
        tileData, // ★ 修正: JSON全体
        cachedResults, // F1の結果
        // fullSheetBitmaps, // ★ 修正: メインスレッドからは渡されない
        mainImageBitmap, 
        edgeImageBitmap, 
        width, height,
        lightParams, scale, quality
    } = e.data;
    
    try {
        // 1. Worker内でOffscreenCanvasを作成
        const highResCanvas = new OffscreenCanvas(width * scale, height * scale);

        // ★★★ 修正: F3-A1 (スプライトシートロード) を Worker 内部で実行 ★★★
        const t_load_start = performance.now();
        
        const fullSet = tileData.tileSets.full;
        let totalLoadSize = 0;
        
        // ★ 修正: ロード処理をリトライ + サイズ取得 + 並列制御キュー
        const sheetPromises = fullSet.sheetUrls.map(url => 
            (async () => {
                try {
                    const result = await fetchImageWithRetry(url, 3);
                    totalLoadSize += result.size;
                    return result.bitmap;
                } catch (error) {
                    console.error(`Worker failed to load F3 sheet ${url}: ${error.message}`);
                    totalFailCount++; // ロード失敗をカウント
                    return null; // 失敗した場合はnullを返す
                }
            })()
        );
        
        // F3スプライトシート(ImageBitmapの配列)をロード (並列数10に制限)
        const fullSheetBitmaps = await runBatchedLoads(sheetPromises, 10);
        
        const t_load_end = performance.now();
        const loadTime = t_load_end - t_load_start;
        // ★★★ 修正ここまで ★★★

        // 2. 描画処理を実行 (F3-A2)
        const { canvas: finalCanvas, renderTime } = await renderMosaicWorker(
            highResCanvas, tileData, cachedResults, mainImageBitmap, edgeImageBitmap, 
            fullSheetBitmaps.filter(b => b !== null), // ★ 修正: 失敗した(null)シートを除外
            width, height, lightParams, scale
        );
        
        // 3. JPEGエンコード処理を実行 (F3-B)
        const t_encode_start = performance.now();
        const blob = await finalCanvas.convertToBlob({ 
            type: 'image/jpeg',
            quality: quality
        });
        const t_encode_end = performance.now();
        
        // ★ 修正点: BlobをArrayBufferに変換
        const buffer = await blob.arrayBuffer();
        const mimeType = blob.type; // BlobのMIME Typeを取得
        
        const totalTime = t_encode_end - t_start;
        const encodeTime = t_encode_end - t_encode_start;
        const finalFileSizeMB = blob.size / 1024 / 1024;
        const totalLoadSizeMB = totalLoadSize / 1024 / 1024;

        // 4. メインスレッドに結果を返送
        self.postMessage({ 
            type: 'complete', 
            buffer: buffer, 
            mimeType: mimeType,
            totalTime: totalTime / 1000.0,
            loadTime: loadTime / 1000.0, 
            renderTime: renderTime / 1000.0,
            encodeTime: encodeTime / 1000.0,
            // ★★★ 修正点: 詳細メトリクスを送信 ★★★
            totalLoadSizeMB: totalLoadSizeMB,
            retryCount: totalRetryCount,
            failCount: totalFailCount,
            finalFileSizeMB: finalFileSizeMB
        }, [buffer]); // ArrayBufferを転送リストに追加
        
    } catch (error) {
        self.postMessage({ type: 'error', message: `Full F3 Worker failed: ${error.message}` });
    }
};
