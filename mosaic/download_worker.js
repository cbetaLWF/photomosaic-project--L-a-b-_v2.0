// download_worker.js
// F3処理（高解像度描画 + JPEGエンコード）を完全に実行するWorker

// F2で成功したI/Oスロットリング回避ロジックをWorkerにも実装します。
async function runBatchedLoads(tilePromises, maxConcurrency) {
    // F3 Worker内でのI/Oスロットリングを避けるため、直列に近い実行を強制します。
    for (const promise of tilePromises) {
        // 直列実行を強制
        await promise; 
    }
    return true; 
}

// ★★★ 新規ヘルパー関数: 画像ロードとImageBitmap生成をリトライする ★★★
async function fetchImageWithRetry(url, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                // HTTPエラー（例: 500, 404）はネットワーク失敗ではないため、リトライしない
                if (response.status !== 404) {
                    throw new Error(`HTTP Error: ${response.status}`);
                }
                throw new Error(`Non-retryable Error: Status ${response.status}`);
            }
            
            const blob = await response.blob();
            // ImageBitmapの生成も失敗することがあるため、ここでImageBitmapに変換
            const bitmap = await createImageBitmap(blob);
            return bitmap;
            
        } catch (error) {
            // "Failed to fetch" やタイムアウトなどのネットワーク失敗の場合
            if (attempt === maxRetries) {
                throw new Error(`Final fetch failure after ${maxRetries} attempts: ${error.message}`);
            }
            // 一時的なネットワークエラーの場合、短い時間待ってリトライ
            console.warn(`Fetch attempt ${attempt} failed for ${url}. Retrying...`);
            await new Promise(r => setTimeout(r, 500 * attempt)); // 待機時間を増やす
        }
    }
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
    const brightnessFactor = lightParams.brightnessCompensation / 100; 

    // F3 Workerではfetchを使うため、直列実行でI/Oの失敗率を下げます。
    const tilePromises = []; // ロードと描画を含むPromiseを格納する配列
    
    for (const tile of results) {
        const p = (async () => {
            let tileBitmap = null;
            let finalUrl = tile.url; 

            try {
                // ★ 修正点2: リトライ機構付きのロード関数を使用
                tileBitmap = await fetchImageWithRetry(finalUrl, 3);
                
                // 描画ロジックの実行
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
                // ★ 修正点3: 最終的なロード失敗の場合のフォールバック処理（ブロックノイズ回避）
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

    // F3-AのI/Oを直列に近い形で実行
    await runBatchedLoads(tilePromises, 10); // 念のため最大並列数を10に制限
    
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
    
    const { 
        cachedResults, mainImageBitmap, edgeImageBitmap, width, height,
        lightParams, scale, quality
    } = e.data;
    
    try {
        const highResCanvas = new OffscreenCanvas(width * scale, height * scale);

        const { canvas: finalCanvas, renderTime } = await renderMosaicWorker(
            highResCanvas, cachedResults, mainImageBitmap, edgeImageBitmap, 
            width, height, lightParams, scale
        );
        
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

        self.postMessage({ 
            type: 'complete', 
            buffer: buffer, 
            mimeType: mimeType,
            totalTime: totalTime / 1000.0,
            renderTime: renderTime / 1000.0,
            encodeTime: encodeTime / 1000.0 
        }, [buffer]); 
        
    } catch (error) {
        self.postMessage({ type: 'error', message: `Full F3 Worker failed: ${error.message}` });
    }
};
