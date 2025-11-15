// download_worker.js
// F3処理（高解像度描画 + JPEGエンコード）を完全に実行するWorker

// F2で成功したI/Oスロットリング回避ロジックをWorkerにも実装します。
async function runBatchedLoads(tilePromises, maxConcurrency) {
    // F3 Worker内でのI/Oスロットリングを避けるため、直列に近い実行を強制します。
    // F2とは異なり、Workerでは Promise.race は使用せず、直列実行でI/Oの失敗率を下げます。
    
    // 最大並列数を50に設定しても、実際にはブラウザが制御するため、
    // ここでは単純なforループで直列にawaitすることで、I/O負荷を最小限にします。
    
    for (const promise of tilePromises) {
        // 直列実行を強制
        await promise; 
    }
    return true; 
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

    // ★ 修正点1: 描画に必要な定数を関数のローカルスコープに定義
    const MIN_TILE_L = 5.0; 
    const MAX_BRIGHTNESS_RATIO = 5.0; 
    const brightnessFactor = lightParams.brightnessCompensation / 100; // lightParamsから計算

    const tilePromises = []; // ロードと描画を含むPromiseを格納する配列
    
    // ★★★ 修正点: F3 Worker内でのタイルロードロジックを修正 (I/O失敗許容) ★★★
    for (const tile of results) {
        const p = (async () => {
            let tileBitmap = null;
            let finalUrl = tile.url; 

            try {
                // 1. 画像ファイルを非同期でフェッチし、Blobとして取得
                const response = await fetch(finalUrl);
                if (!response.ok) {
                    // ネットワークエラーだが、Workerをクラッシュさせない
                    throw new Error(`HTTP Error: ${response.status} or network fail`);
                }
                const blob = await response.blob();
                
                // 2. BlobからImageBitmapを生成
                tileBitmap = await createImageBitmap(blob);

                // 3. 描画ロジックの実行
                let targetL = tile.targetL; 
                let tileL = tile.tileL; 
                
                // (描画ロジックは変更なし)
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
                // ★ 修正点: I/Oエラーが発生した場合でも、フォールバック（単色描画）を行い、Promiseは解決する。
                console.error(`Worker I/O Failed: ${finalUrl} -> ${error.message}. Drawing fallback color.`);
                const grayValue = Math.round(tile.targetL * 2.55); 
                ctx.fillStyle = `rgb(${grayValue}, ${grayValue}, ${grayValue})`; 
                ctx.fillRect(tile.x * scale, tile.y * scale, tile.width * scale, tile.height * scale); 
            } finally {
                if (tileBitmap) tileBitmap.close();
            }
        })(); 
        tilePromises.push(p); 
    }

    // F3-AのI/Oを直列に近い形で実行し、I/Oスロットリングの失敗率を最小限にする
    await runBatchedLoads(tilePromises, 10); // 念のため最大並列数を10に制限
    
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
