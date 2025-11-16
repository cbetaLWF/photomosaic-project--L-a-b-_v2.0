// preview_worker.js
// F2処理（プレビュー描画 + ブレンド）を完全に実行するWorker

/**
 * Worker内で実行されるrenderMosaicのコピー (F2プレビュー版)
 * F3 (download_worker.js) とほぼ同じロジックだが、
 * F2 (Thumb) のスプライトシートとBitmapを扱う点が異なる。
 */
async function renderMosaicPreviewWorker(
    canvas, 
    tileData, // JSON全体
    results, // F1のレシピ
    mainImageBitmap, 
    edgeImageBitmap, 
    thumbSheetBitmap, // ★ F2用のサムネイル スプライトシートBitmap
    width, height,
    lightParams
) {
    const t_render_start = performance.now(); // 描画時間計測開始

    // プレビューはスケール1.0固定
    const canvasWidth = width;
    const canvasHeight = height;
    
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // 1. 元画像の描画 (背景リセット)
    // F2では、元画像を最初に描画し、その上にタイルを重ねる
    // (F3は高画質化のためタイルが先だったが、F2は元画像が先の方がSoft-Lightが乗りやすい)
    // → やはりF3と同じロジック（タイルを先に描画）に統一する
    /*
    if (mainImageBitmap) {
        ctx.drawImage(mainImageBitmap, 0, 0, canvasWidth, canvasHeight);
    }
    */

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvasWidth, canvasHeight); 
    ctx.clip(); 

    const MIN_TILE_L = 5.0; 
    const MAX_BRIGHTNESS_RATIO = 5.0; 
    const brightnessFactor = lightParams.brightnessCompensation / 100; 

    // F2（プレビュー）用のスプライトシート情報を取得
    const thumbSet = tileData.tileSets.thumb;
    const thumbTileW = thumbSet.tileWidth;
    const thumbTileH = thumbSet.tileHeight;
    
    // ★ F2描画ループ
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
        
        // 1. 明度補正
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
        const dx = tileResult.x;
        const dy = tileResult.y;
        const dWidth = tileResult.width;
        const dHeight = tileResult.height; 
        
        // 3. ソース座標 (スプライトシート上の位置)
        const coords = tileInfo.thumbCoords;
        const sourceSheet = thumbSheetBitmap; // F2はシートが1枚
        
        // 4. クロップ計算 (F1の解析ロジックと一致させる)
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

        // 5. 描画実行
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

    ctx.restore(); // クリッピングを解除

    // 2段階ブレンド処理 (WorkerではImageBitmapに対して実行)
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


self.onmessage = async (e) => {
    const t_start = performance.now();
    
    const { 
        tileData,
        cachedResults, // F1の結果
        mainImageBitmap, 
        edgeImageBitmap, 
        thumbSheetBitmap, // ★ F2用Bitmap
        width, height,
        lightParams
    } = e.data;
    
    try {
        // 1. Worker内でOffscreenCanvasを作成
        // プレビューはスケール1.0固定
        const previewCanvas = new OffscreenCanvas(width, height);

        // 2. 描画処理を実行 (F2-A, F2-B)
        const { tileTime, blendTime } = await renderMosaicPreviewWorker(
            previewCanvas, tileData, cachedResults, mainImageBitmap, edgeImageBitmap, 
            thumbSheetBitmap,
            width, height, lightParams
        );
        
        // 3. ImageBitmapに変換 (エンコードはしない)
        const finalBitmap = previewCanvas.transferToImageBitmap();
        
        const t_end = performance.now();
        const totalTime = t_end - t_start;

        // 4. メインスレッドに結果を返送
        self.postMessage({ 
            type: 'complete', 
            bitmap: finalBitmap,
            totalTime: totalTime / 1000.0,
            tileTime: tileTime / 1000.0,
            blendTime: blendTime / 1000.0
        }, [finalBitmap]); // ImageBitmapを転送リストに追加
        
    } catch (error) {
        self.postMessage({ type: 'error', message: `F2 Preview Worker failed: ${error.message}` });
    }
};
