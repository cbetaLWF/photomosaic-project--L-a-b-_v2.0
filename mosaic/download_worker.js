// download_worker.js
// F3処理（高解像度描画 + JPEGエンコード）を完全に実行するWorker

/**
 * Worker内で実行されるrenderMosaicのコピー (タイル画像ロードのロジックを含む)
 */
async function renderMosaicWorker(
    canvas, 
    results, mainImageBitmap, edgeImageBitmap, width, height,
    lightParams, scale
) {
    const canvasWidth = width * scale;
    const canvasHeight = height * scale;
    
    // Canvasをリセット (OffscreenCanvasはWorker内で作成されるため、ここではgetContextで準備のみ)
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

    const totalTiles = results.length;
    const promises = [];
    
    const MIN_TILE_L = 5.0; 
    const MAX_BRIGHTNESS_RATIO = 5.0; 
    const brightnessFactor = lightParams.brightnessCompensation / 100; 

    for (const tile of results) {
        const p = new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                // ( ... 明度補正、クロップ/反転ロジック ... )
                let targetL = tile.targetL; 
                let tileL = tile.tileL; 
                if (tileL < MIN_TILE_L) tileL = MIN_TILE_L; 
                let brightnessRatio = targetL / tileL; 
                if (brightnessRatio > MAX_BRIGHTNESS_RATIO) {
                    brightnessRatio = MAX_BRIGHTNESS_RATIO;
                }
                const finalBrightness = (1 - brightnessFactor) + (brightnessFactor * brightnessRatio); 
                ctx.filter = `brightness(${finalBrightness.toFixed(4)})`;
                const sWidth = img.naturalWidth;
                const sHeight = img.naturalHeight;
                const sSize = Math.min(sWidth, sHeight);
                const isHorizontal = sWidth > sHeight; 
                const typeParts = tile.patternType.split('_'); 
                const cropType = typeParts[0]; 
                const flipType = typeParts[1]; 
                let sx = 0, sy = 0;
                if (isHorizontal) {
                    if (cropType === "cropC") sx = Math.floor((sWidth - sSize) / 2);
                    else if (cropType === "cropR") sx = sWidth - sSize;
                } else {
                    if (cropType === "cropM") sy = Math.floor((sHeight - sSize) / 2);
                    else if (cropType === "cropB") sy = sHeight - sSize;
                }
                const dx = tile.x * scale;
                const dy = tile.y * scale;
                const dWidth = tile.width * scale;
                const dHeight = tile.height * scale; 
                ctx.save();
                if (flipType === "flip1") {
                    ctx.scale(-1, 1);
                    ctx.drawImage(img, sx, sy, sSize, sSize, -dx - dWidth, dy, dWidth, dHeight);
                } else {
                    ctx.drawImage(img, sx, sy, sSize, sSize, dx, dy, dWidth, dHeight);
                }
                ctx.restore();
                ctx.filter = 'none';
                resolve();
            };
            img.onerror = () => {
                // ダウンロードモードでは高速プレビューのフォールバックは不要（常にフル解像度を試行）
                console.error(`タイル画像のロードに失敗: ${tile.url}`);
                const grayValue = Math.round(tile.targetL * 2.55); 
                ctx.fillStyle = `rgb(${grayValue}, ${grayValue}, ${grayValue})`; 
                ctx.fillRect(tile.x * scale, tile.y * scale, tile.width * scale, tile.height * scale); 
                resolve(); 
            };
            
            // F3モードでは常にフル解像度を使用
            img.src = tile.url; 
        });
        promises.push(p);
    }

    await Promise.all(promises);
    
    const t_render_end = performance.now();

    ctx.restore(); // クリッピングを解除

    // 2段階ブレンド処理
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
    
    // メインスレッドから転送されたデータを受け取る
    const { 
        cachedResults, mainImageBitmap, edgeImageBitmap, width, height,
        lightParams, scale, quality
    } = e.data;
    
    try {
        // 1. Worker内でOffscreenCanvasを作成（コンテキストはまだアクティブでない）
        const highResCanvas = new OffscreenCanvas(width * scale, height * scale);

        // 2. 描画処理を実行 (F3-A)
        const { canvas: finalCanvas, renderTime } = await renderMosaicWorker(
            highResCanvas, cachedResults, mainImageBitmap, edgeImageBitmap, 
            width, height, lightParams, scale
        );
        
        // 3. JPEGエンコード処理を実行 (F3-B)
        const t_encode_start = performance.now();
        const blob = await finalCanvas.convertToBlob({ 
            type: 'image/jpeg',
            quality: quality
        });
        const t_encode_end = performance.now();
        
        const totalTime = t_encode_end - t_start;
        const encodeTime = t_encode_end - t_encode_start;

        // 4. メインスレッドに結果を返送
        // Blobを転送可能オブジェクトとして渡す
        self.postMessage({ 
            type: 'complete', 
            blob: blob,
            totalTime: totalTime / 1000.0,
            renderTime: renderTime / 1000.0,
            encodeTime: encodeTime / 1000.0 
        }, [blob]); 
        
    } catch (error) {
        self.postMessage({ type: 'error', message: `Full F3 Worker failed: ${error.message}` });
    }
};
