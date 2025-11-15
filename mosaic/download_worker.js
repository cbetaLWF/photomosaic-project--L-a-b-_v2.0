// download_worker.js
// F3処理（高解像度描画 + JPEGエンコード）を完全に実行するWorker

// F2で成功したI/Oスロットリング回避ロジックをWorkerにも実装します。
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


/**
 * Worker内で実行されるrenderMosaicのコピー (タイル画像ロードのロジックを含む)
 */
async function renderMosaicWorker(
    canvas, 
    results, mainImageBitmap, edgeImageBitmap, width, height,
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

    // ★★★ 修正点: F2で成功したチャンク描画ロジックを移植 ★★★
    const totalTiles = results.length;
    const CHUNK_SIZE = 50; 
    
    // I/Oの並列実行制御: F3 Workerではfetchを使うため、MAX_CONCURRENT_REQUESTSで制限します
    const MAX_CONCURRENT_REQUESTS = 50; 
    const tilePromises = []; // ロードと描画を含むPromiseを格納する配列

    // ★ 描画処理をPromiseでキューに追加し、その後 runBatchedLoads で実行を制御
    for (const tile of results) {
        const p = (async () => {
            let tileBitmap = null;
            let finalUrl = tile.url; 

            try {
                // 1. 画像ファイルを非同期でフェッチし、Blobとして取得
                const response = await fetch(finalUrl);
                if (!response.ok) {
                    throw new new Error(`HTTP Error: ${response.status}`);
                }
                const blob = await response.blob();
                
                // 2. BlobからImageBitmapを生成
                tileBitmap = await createImageBitmap(blob);

                // 3. 描画ロジックの実行
                let targetL = tile.targetL; 
                let tileL = tile.tileL; 
                if (tileL < MIN_TILE_L) tileL = MIN_TILE_L; 
                let brightnessRatio = targetL / tileL; 
                if (brightnessRatio > MAX_BRIGHTNESS_RATIO) {
                    brightnessRatio = MAX_BRIGHTNESS_RATIO;
                }
                const finalBrightness = (1 - brightnessFactor) + (brightnessFactor * brightnessRatio); 
                ctx.filter = `brightness(${finalBrightness.toFixed(4)})`;

                const sWidth = tileBitmap.width;
                const sHeight = tileBitmap.height;
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
                    ctx.drawImage(tileBitmap, sx, sy, sSize, sSize, -dx - dWidth, dy, dWidth, dHeight);
                } else {
                    ctx.drawImage(tileBitmap, sx, sy, sSize, sSize, dx, dy, dWidth, dHeight);
                }
                ctx.restore();
                ctx.filter = 'none';

            } catch (error) {
                // ロードまたは生成失敗時のフォールバック処理
                console.error(`Worker failed to load/draw tile ${finalUrl}: ${error.message}`);
                const grayValue = Math.round(tile.targetL * 2.55); 
                ctx.fillStyle = `rgb(${grayValue}, ${grayValue}, ${grayValue})`; 
                ctx.fillRect(tile.x * scale, tile.y * scale, tile.width * scale, tile.height * scale); 
            } finally {
                // ImageBitmapの解放 (メモリ管理のため)
                if (tileBitmap) tileBitmap.close();
            }
        })(); 
        tilePromises.push(p); 
    }

    // ★ 修正点3: F3-AのI/Oを並列制御キューで実行
    await runBatchedLoads(tilePromises, MAX_CONCURRENT_REQUESTS); 
    // ★★★ 修正点ここまで ★★★
    
    const t_render_end = performance.now();

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
        
        // ★ 修正点: BlobをArrayBufferに変換
        const buffer = await blob.arrayBuffer();
        const mimeType = blob.type; // BlobのMIME Typeを取得
        
        const totalTime = t_encode_end - t_start;
        const encodeTime = t_encode_end - t_encode_start;

        // 4. メインスレッドに結果を返送
        self.postMessage({ 
            type: 'complete', 
            buffer: buffer, 
            mimeType: mimeType,
            totalTime: totalTime / 1000.0,
            renderTime: renderTime / 1000.0,
            encodeTime: encodeTime / 1000.0 
        }, [buffer]); // ArrayBufferを転送リストに追加
        
    } catch (error) {
        self.postMessage({ type: 'error', message: `Full F3 Worker failed: ${error.message}` });
    }
};
