// download_worker.js
// F3処理（高解像度描画 + JPEGエンコード）を完全に実行するWorker

// ★★★ 修正点: ネットワークI/Oロジック (A, Bプラン) を全て削除 ★★★
// (I/O と Bitmap変換は メインスレッド (main.js) が担当する)


/**
 * Worker内で実行されるrenderMosaicのコピー (Cプラン)
 */
async function renderMosaicWorker(
    canvas, 
    tileData, // JSON全体
    results, // F1のレシピ
    mainImageBitmap, 
    edgeImageBitmap, 
    fullSheetBitmaps, // ★ 修正: Cプラン (メインスレッドで生成済みのImageBitmap Map)
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

    const MIN_TILE_L = 5.0; 
    const MAX_BRIGHTNESS_RATIO = 5.0; 
    const brightnessFactor = lightParams.brightnessCompensation / 100; 

    // F3用のスプライトシート情報を取得
    const fullSet = tileData.tileSets.full;
    const fullTileW = fullSet.tileWidth;   // 640
    const fullTileH = fullSet.tileHeight;  // 360
    
    // ★ F3描画ループ: F1の結果 (results) に基づいて描画
    for (const tileResult of results) {
        
        const tileInfo = tileData.tiles[tileResult.tileId];
        if (!tileInfo) {
            console.warn(`Tile data not found for id: ${tileResult.tileId}`);
            continue;
        }
        
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

        // 2. 描画座標 (Canvas上のの位置)
        const dx = tileResult.x * scale;
        const dy = tileResult.y * scale;
        const dWidth = tileResult.width * scale;
        const dHeight = tileResult.height * scale; 
        
        // 3. ソース座標 (スプライトシート上の位置)
        const coords = tileInfo.fullCoords;
        const sheetIndex = coords.sheetIndex;
        
        // ★ 修正: MapからBitmapを取得
        const sourceSheet = fullSheetBitmaps.get(sheetIndex); 
        
        // 4. クロップ計算 (F1の解析ロジックと一致させる)
        const sSize = Math.min(fullTileW, fullTileH); // 360
        const isHorizontal = fullTileW > fullTileH; // true
        
        let sx = coords.x; // スプライトシート上のタイル左上X
        let sy = coords.y; // スプライトシート上のタイル左上Y
        
        const typeParts = tileResult.patternType.split('_'); 
        const cropType = typeParts[0]; 
        const flipType = typeParts[1]; 
        
        if (isHorizontal) {
            if (cropType === "cropC") sx += Math.floor((fullTileW - sSize) / 2); // 640-360 / 2
            else if (cropType === "cropR") sx += (fullTileW - sSize); // 640-360
        } else {
            // (今回は16:9なのでここは実行されない)
            if (cropType === "cropM") sy += Math.floor((fullTileH - sSize) / 2);
            else if (cropType === "cropB") sy += (fullTileH - sSize);
        }

        // 5. 描画実行
        if (!sourceSheet) {
            // ★ 修正: Mapに存在しない (転送失敗)
            console.error(`F3スプライトシート[${sheetIndex}]が見つかりません。フォールバック描画します。`);
            const grayValue = Math.round(tileResult.targetL * 2.55); 
            ctx.fillStyle = `rgb(${grayValue}, ${grayValue}, ${grayValue})`; 
            ctx.fillRect(dx, dy, dWidth, dHeight); 
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

    // 2段階ブレンド処理 (変更なし)
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
    
    const { 
        tileData,
        cachedResults, // F1の結果
        // ★ 修正: Cプラン: ImageBitmap Map を受け取る
        sheetBitmaps, // Map<number, ImageBitmap>
        mainImageBitmap, 
        edgeImageBitmap, 
        width, height,
        lightParams, scale, quality
    } = e.data;
    
    try {
        // 1. Worker内でOffscreenCanvasを作成
        const highResCanvas = new OffscreenCanvas(width * scale, height * scale);

        // ★★★ 修正: F3-A1 (I/O) は不要 ★★★
        // (Bitmapはメインスレッドから転送済み)
        const t_load_start = performance.now();
        // ★★★ 修正ここまで ★★★

        // 2. 描画処理を実行 (F3-A2) (変更なし)
        const { canvas: finalCanvas, renderTime } = await renderMosaicWorker(
            highResCanvas, tileData, cachedResults, mainImageBitmap, edgeImageBitmap, 
            sheetBitmaps, // ★ 修正: CプランのMapを渡す
            width, height, lightParams, scale
        );
        
        // 3. JPEGエンコード処理を実行 (F3-B) (変更なし)
        const t_encode_start = performance.now();
        const blob = await finalCanvas.convertToBlob({ 
            type: 'image/jpeg',
            quality: quality
        });
        const t_encode_end = performance.now();
        
        const buffer = await blob.arrayBuffer();
        const mimeType = blob.type; 
        
        const totalTime = t_encode_end - t_start;
        const encodeTime = t_encode_end - t_encode_start;
        const finalFileSizeMB = blob.size / 1024 / 1024;
        
        // ★ 修正: F3-A1の時間は 0 (または ほぼ0) になる
        const loadTime = t_load_start - t_start; // (実質0)

        // 4. メインスレッドに結果を返送
        self.postMessage({ 
            type: 'complete', 
            buffer: buffer, 
            mimeType: mimeType,
            totalTime: totalTime / 1000.0,
            loadTime: loadTime / 1000.0, // ★ F3-A1 (実質0)
            renderTime: renderTime / 1000.0,
            encodeTime: encodeTime / 1000.0,
            // ★★★ 修正点: 詳細メトリクス ★★★
            sheetCount: sheetBitmaps.size, // ★ 修正: 実際に処理した枚数
            totalLoadSizeMB: 0, // ★ 修正: WorkerはI/Oしない
            retryCount: 0, 
            failCount: 0,  
            finalFileSizeMB: finalFileSizeMB
        }, [buffer]); // ArrayBufferを転送リストに追加
        
    } catch (error) {
        self.postMessage({ type: 'error', message: `Full F3 Worker failed: ${error.message}` });
    }
};
