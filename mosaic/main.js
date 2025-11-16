// main.js (Hプラン: 競合フリーズ対策 - 全オブジェクトをクローン)

// ( ... ヘルパー関数 (applySobelFilter, etc) は変更なし ... )
function applySobelFilter(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const grayscaleData = new Uint8ClampedArray(width * height);
    for (let i = 0; i < data.length; i += 4) {
        const gray = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        grayscaleData[i / 4] = gray;
    }
    const finalSobelData = new Uint8ClampedArray(data.length);
    const Gx = [
        [-1, 0, 1],
        [-2, 0, 2],
        [-1, 0, 1]
    ];
    const Gy = [
        [-1, -2, -1],
        [0, 0, 0],
        [1, 2, 1]
    ];
    const thresholds = {
        low: 15, 
        med: 30, 
        high: 80
    };
    const detailVector = { low: 0, med: 0, high: 0 };
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let sumX = 0;
            let sumY = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const idx = ((y + ky) * width + (x + kx));
                    if (idx < 0 || idx >= grayscaleData.length) continue; 
                    const gray = grayscaleData[idx];
                    sumX += gray * Gx[ky + 1][kx + 1];
                    sumY += gray * Gy[ky + 1][kx + 1];
                }
            }
            const magnitude = Math.sqrt(sumX * sumX + sumY * sumY);
            const i = (y * width + x) * 4;
            if (magnitude > thresholds.med) {
                const alpha = Math.min(255, magnitude * 1.5);
                finalSobelData[i] = 0;
                finalSobelData[i + 1] = 0;
                finalSobelData[i + 2] = 0;
                finalSobelData[i + 3] = alpha; 
                detailVector.med += alpha;
            }
            if (magnitude > thresholds.high) {
                detailVector.high += magnitude;
            }
        }
    }
    return { 
        finalEdgeImageData: new ImageData(finalSobelData, width, height), 
        detailVector: detailVector
    };
}
function analyzeImageAndGetRecommendations(image, analysisImageData) {
    const width = image.width;
    const height = image.height;
    const data = analysisImageData.data; 
    let sumLuma = 0;
    for (let i = 0; i < data.length; i += 4) {
        const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        sumLuma += luma;
    }
    const pixelCount = data.length / 4;
    const meanLuma = sumLuma / pixelCount; 
    const edgeResult = applySobelFilter(analysisImageData); 
    const detailVector = edgeResult.detailVector; 
    const detailLow = (detailVector.low / pixelCount) || 0;    
    const detailHigh = (detailVector.high / pixelCount) || 0; 
    const recommendations = {};
    if (width > 3000) recommendations.tileSize = 15;
    else if (width > 1500) recommendations.tileSize = 25;
    else recommendations.tileSize = 30;
    recommendations.brightnessCompensation = 100;
    recommendations.textureWeight = Math.round(Math.min(200, detailLow * 3.0 + 30)); 
    recommendations.blendRange = Math.round(Math.max(10, meanLuma / 7.0)); 
    recommendations.edgeOpacity = Math.round(Math.max(10, 60 - detailHigh * 10.0));
    return recommendations;
}
function highlightParameter(element) {
    if (!element) return;
    element.style.borderColor = '#dc2626';
    element.style.borderWidth = '2px';
    element.style.boxShadow = '0 0 5px rgba(220, 38, 38, 0.5)';
}
function resetParameterStyles(elements) {
    elements.forEach(element => {
        if (element) {
            element.style.borderColor = '';
            element.style.borderWidth = '';
            element.style.boxShadow = '';
        }
    });
}


document.addEventListener('DOMContentLoaded', async () => {
    // --- UI要素の取得 ---
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    const downloadButton = document.getElementById('download-button');
    const mainCanvas = document.getElementById('main-canvas');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    const tileSizeInput = document.getElementById('tile-size');
    const blendRangeInput = document.getElementById('blend-range');
    const edgeOpacityInput = document.getElementById('edge-opacity-range');
    const brightnessCompensationInput = document.getElementById('brightness-compensation');
    const textureWeightInput = document.getElementById('texture-weight');
    const blendValue = document.getElementById('blend-value');
    const edgeOpacityValue = document.getElementById('edge-opacity-value');
    const brightnessCompensationValue = document.getElementById('brightness-compensation-value');
    const textureWeightValue = document.getElementById('texture-weight-value');
    const recommendationArea = document.getElementById('recommendation-area');
    const applyRecommendationsButton = document.getElementById('apply-recommendations-button');
    const recTileSize = document.getElementById('rec-tile-size');
    const recBrightness = document.getElementById('rec-brightness');
    const recTextureWeight = document.getElementById('rec-texture-weight');
    const recBlendRange = document.getElementById('rec-blend-range');
    const recEdgeOpacity = document.getElementById('rec-edge-opacity');
    const previewModeCheckbox = document.getElementById('preview-mode-checkbox');
    const downloadSpinner = document.getElementById('download-spinner');
    const downloadWarningArea = document.getElementById('download-warning-area');
    const downloadWarningMessage = document.getElementById('download-warning-message');
    const warningYesButton = document.getElementById('warning-yes-button');
    const warningNoButton = document.getElementById('warning-no-button');
    const resolutionScaleInput = document.getElementById('resolution-scale');
    const jpegQualityInput = document.getElementById('jpeg-quality');
    const timingLog = document.getElementById('timing-log');

    
    // ( ... 必須要素チェック ... )
    if (!mainCanvas || !statusText || !generateButton || !mainImageInput || !previewModeCheckbox || !tileSizeInput) {
        console.error("Initialization Error: One or more critical HTML elements are missing.");
        document.body.innerHTML = "<h1>Initialization Error</h1><p>The application failed to load because critical elements (Canvas, Buttons, Status, mainImageInput, previewModeCheckbox, tileSizeInput) are missing from the HTML.</p>";
        return;
    }
    
    const t_app_start = performance.now();
    let t_f3_preload_start = 0;
    let t_f1_click = 0;
    let t_f3_click = 0;
    
    if (timingLog) {
        timingLog.textContent = ''; 
        const cpuCores = navigator.hardwareConcurrency || 'N/A';
        const deviceRam = navigator.deviceMemory || 'N/A';
        timingLog.innerHTML = `[環境] CPUコア: ${cpuCores}, RAM: ${deviceRam} GB`;
    }
    
    const ctx = mainCanvas.getContext('2d');
    let tileData = null; 
    let mainImage = null; 
    let workers = [];
    let edgeCanvas = null; 
    let currentRecommendations = null;
    
    let isGeneratingFullRes = false; 
    let lastGeneratedBlob = null; 
    let thumbSheetImage = null; 
    let isGeneratingF1F2 = false; 
    let preloadPromise = null; 
    let f3SheetCache = new Map(); 

    generateButton.disabled = true;
    if(downloadButton) downloadButton.style.display = 'none';
    if (brightnessCompensationInput && brightnessCompensationValue) { /* ... */ }
    if (textureWeightInput && textureWeightValue) { /* ... */ }
    if (blendRangeInput && blendValue) { /* ... */ }
    if (edgeOpacityInput && edgeOpacityValue) { /* ... */ }


    // --- 1. タイルデータの初期ロード ---
    try {
        const t_json_load_start = performance.now();
        statusText.textContent = 'ステータス: tile_data.jsonをロード中...';
        const response = await fetch('tile_data.json');
        
        if (!response.ok) { 
            throw new Error(`HTTP ${response.status} - ${response.statusText}`); 
        }
        
        tileData = await response.json(); 
        const t_json_load_end = performance.now();
        if(timingLog) timingLog.textContent += `\n[INIT] tile_data.json ロード: ${((t_json_load_end - t_json_load_start)/1000.0).toFixed(3)} 秒`;
        
        if (!tileData || !tileData.tileSets || !tileData.tileSets.thumb || !tileData.tiles || tileData.tiles.length === 0) {
             throw new Error('tile_data.jsonがスプライトシート形式ではありません。Analyzer Appで新しいデータを再生成してください。');
        }
        
        const t_f2_load_start = performance.now();
        statusText.textContent = `ステータス: プレビュースプライトシート (${tileData.tileSets.thumb.sheetUrl}) をロード中...`;
        thumbSheetImage = new Image();
        
        thumbSheetImage.onload = () => {
            const t_f2_load_end = performance.now();
            if(timingLog) timingLog.textContent += `\n[INIT] F2スプライトシート ロード: ${((t_f2_load_end - t_f2_load_start)/1000.0).toFixed(3)} 秒`;
            statusText.textContent = `ステータス: プレビュー準備完了 (${tileData.tiles.length}タイル)。メイン画像を選択してください。`;
            if (mainImageInput) mainImageInput.disabled = false;
        };
        thumbSheetImage.onerror = () => {
            statusText.textContent = `エラー: プレビュースプライトシート (${tileData.tileSets.thumb.sheetUrl}) のロードに失敗しました。`;
            console.error("Failed to load thumbnail sprite sheet.");
        };
        thumbSheetImage.src = tileData.tileSets.thumb.sheetUrl;

    } catch (error) {
        // ( ... エラーハンドリング (変更なし) ... )
        console.error("Initialization Error:", error); 
        if (error instanceof TypeError) {
             statusText.textContent = `エラー: ネットワーク接続に失敗しました (CORS or 接続拒否)。${error.message}`;
        } else if (error.message.includes('HTTP')) {
             statusText.textContent = `エラー: tile_data.json のロードに失敗しました (${error.message})。ファイルが正しい場所に配置されているか確認してください。`;
        } else {
             statusText.textContent = `エラー: tile_data.json の解析に失敗しました。ファイルが破損している可能性があります。${error.message}`;
        }
        return; 
    }
    
    // --- 2. メイン画像アップロード (推奨値/線画計算) ---
    if (mainImageInput) {
        mainImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                
                mainImage = new Image();
                mainImage.onload = () => {
                    const t_img_load_start = performance.now();
                    
                    generateButton.disabled = false;
                    if(downloadButton) downloadButton.style.display = 'none';
                    mainCanvas.width = mainImage.width;
                    mainCanvas.height = mainImage.height;
                    
                    ctx.clearRect(0, 0, mainImage.width, mainImage.height); 
                    ctx.drawImage(mainImage, 0, 0); 
                    
                    statusText.textContent = `ステータス: 画像ロード完了。推奨値を計算中...`;

                    if (recommendationArea && applyRecommendationsButton) {
                        try {
                            const analysisSize = 400; 
                            const ratio = analysisSize / Math.max(mainImage.width, mainImage.height);
                            const w = mainImage.width * ratio;
                            const h = mainImage.height * ratio;
                            const analysisCanvas = new OffscreenCanvas(w, h);
                            const analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });
                            analysisCtx.drawImage(mainImage, 0, 0, w, h);
                            const analysisImageData = analysisCtx.getImageData(0, 0, w, h);
                            const recommendations = analyzeImageAndGetRecommendations(mainImage, analysisImageData);
                            currentRecommendations = recommendations; 
                            statusText.textContent = `ステータス: フルサイズの線画を事前計算中...`;
                            
                            const fullCtx = mainCanvas.getContext('2d', { willReadFrequently: true });
                            fullCtx.drawImage(mainImage, 0, 0); 
                            const fullImageData = fullCtx.getImageData(0, 0, mainImage.width, mainImage.height);
                            const fullEdgeResult = applySobelFilter(fullImageData);
                            
                            edgeCanvas = new OffscreenCanvas(mainImage.width, mainImage.height);
                            edgeCanvas.getContext('2d').putImageData(fullEdgeResult.finalEdgeImageData, 0, 0);
                            
                            if (recTileSize) recTileSize.textContent = recommendations.tileSize;
                            if (recBrightness) recBrightness.textContent = recommendations.brightnessCompensation;
                            if (recTextureWeight) recTextureWeight.textContent = recommendations.textureWeight;
                            if (recBlendRange) recBlendRange.textContent = recommendations.blendRange;
                            if (recEdgeOpacity) recEdgeOpacity.textContent = recommendations.edgeOpacity;
                            recommendationArea.style.display = 'block';
                            statusText.textContent = `ステータス: 推奨値を表示しました。適用ボタンを押すか、手動で設定してください。`;
                            
                            const t_img_load_end = performance.now();
                            if(timingLog) timingLog.textContent += `\n[IMG] 画像ロード+線画計算: ${((t_img_load_end - t_img_load_start)/1000.0).toFixed(3)} 秒`;

                        } catch (err) {
                            console.error("Recommendation analysis failed:", err);
                            statusText.textContent = `ステータス: 画像ロード完了 (推奨値の計算に失敗)。`;
                            if (recommendationArea) recommendationArea.style.display = 'none';
                        }
                    } else { /* ( ... 推奨値エリアなしの場合 ... ) */ }
                };
                mainImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // ( ... applyRecommendationsButton リスナー (変更なし) ... )
    if (applyRecommendationsButton) {
        applyRecommendationsButton.addEventListener('click', () => {
            if (!currentRecommendations) return;
            if (tileSizeInput) tileSizeInput.value = currentRecommendations.tileSize;
            if (brightnessCompensationInput) {
                brightnessCompensationInput.value = currentRecommendations.brightnessCompensation;
                if (brightnessCompensationValue) brightnessCompensationValue.textContent = currentRecommendations.brightnessCompensation;
            }
            if (textureWeightInput) {
                textureWeightInput.value = currentRecommendations.textureWeight;
                if (textureWeightValue) textureWeightValue.textContent = currentRecommendations.textureWeight;
            }
            if (blendRangeInput) {
                blendRangeInput.value = currentRecommendations.blendRange;
                if (blendValue) blendValue.textContent = currentRecommendations.blendRange;
            }
            if (edgeOpacityInput) {
                edgeOpacityInput.value = currentRecommendations.edgeOpacity;
                if (edgeOpacityValue) edgeOpacityValue.textContent = currentRecommendations.edgeOpacity;
            }
            statusText.textContent = 'ステータス: 推奨パラメータを適用しました。';
            generateButton.disabled = false;
        });
    }

    function terminateWorkers() {
        workers.forEach(worker => worker.terminate());
        workers = [];
    }
    
    // ( ... runBatchedLoads (変更なし) ... )
    async function runBatchedLoads(loadPromises, maxConcurrency) {
        const running = [];
        const results = []; 
        for (const loadPromise of loadPromises) {
            const p = loadPromise().then(result => {
                running.splice(running.indexOf(p), 1);
                results.push(result);
                return result;
            });
            running.push(p);
            if (running.length >= maxConcurrency) {
                await Promise.race(running);
            }
        }
        return Promise.all(running);
    }
    
    // ( ... startF3Preload (変更なし) ... )
    function startF3Preload(tileData) {
        if (preloadPromise) return;
        const fullSet = tileData.tileSets.full; 
        const urlsToPreload = fullSet.sheetUrls;
        console.log(`[F3 Preload] F2描画完了。${urlsToPreload.length}枚のF3スプライトシートのプリロードを開始します。`);
        t_f3_preload_start = performance.now();
        f3SheetCache.clear();
        const MAX_PRELOAD_CONCURRENCY = 10;
        const preloadTasks = urlsToPreload.map((url, index) => {
            return () => fetch(url, { mode: 'cors' }) 
                         .then(response => {
                             if (!response.ok) {
                                 throw new Error(`HTTP error ${response.status} for ${url}`);
                             }
                             return response.arrayBuffer();
                         })
                         .then(buffer => {
                             f3SheetCache.set(index, buffer);
                             return buffer.byteLength;
                         })
                         .catch(err => console.warn(`[F3 Preload] プリロード失敗: ${url}`, err.message));
        });
        preloadPromise = runBatchedLoads(preloadTasks, MAX_PRELOAD_CONCURRENCY);
        if(timingLog) timingLog.textContent += `\n[F3 Preload] F3高画質シート (${urlsToPreload.length}枚) のバックグラウンドロード開始...`;
        preloadPromise.then((sizes) => {
            const t_f3_preload_end = performance.now();
            const totalSizeMB = sizes.reduce((acc, s) => acc + (s || 0), 0) / 1024 / 1024;
            if(timingLog) {
                timingLog.textContent += `\n[F3 Preload] F3全シートのバックグラウンドロード完了: ${((t_f3_preload_end - t_f3_preload_start)/1000.0).toFixed(3)} 秒 (${totalSizeMB.toFixed(2)} MB)`;
            }
        });
    }


    // --- 3. モザイク生成開始 (F1/F2ハイブリッドWorker) ---
    generateButton.addEventListener('click', async () => {
        if (!mainImage || !edgeCanvas || !thumbSheetImage.complete) {
            statusText.textContent = 'エラー: メイン画像またはスプライトシートが準備できていません。';
            return; 
        }
        if (isGeneratingF1F2 || isGeneratingFullRes) {
            console.warn("[Button Click] 既に別の処理が実行中です。");
            return;
        }

        terminateWorkers(); 
        isGeneratingF1F2 = true; 
        
        generateButton.disabled = true;
        if (downloadButton) downloadButton.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';
        
        t_f1_click = performance.now();
        
        if (timingLog) {
            const envLog = timingLog.innerHTML.split('\n')[0]; 
            timingLog.innerHTML = envLog; 
        }

        const currentHeavyParams = {
            src: mainImage.src,
            tileSize: parseInt(tileSizeInput.value), 
            textureWeight: parseFloat(textureWeightInput.value) / 100.0 
        };
        const currentLightParams = {
            blendOpacity: parseInt(blendRangeInput.value),
            edgeOpacity: parseInt(edgeOpacityInput.value),
            brightnessCompensation: parseInt(brightnessCompensationInput.value)
        };
        
        // ( ... パラメータログ (変更なし) ... )
        if (timingLog) {
            timingLog.textContent += `\n--- [F1/F2 PARAMS] ---`;
            timingLog.textContent += `\n  - Image Size: ${mainImage.width}x${mainImage.height}`;
            timingLog.textContent += `\n  - Tile Size: ${currentHeavyParams.tileSize}`;
            // ( ... 他 ... )
        }
        
        statusText.textContent = 'ステータス: F1(計算) + F2(描画) をWorkerで実行中...';
        
        await renderMosaicWithWorker(
            mainCanvas,
            currentLightParams,
            currentHeavyParams,
            false 
        );
        
        isGeneratingF1F2 = false; 
    });

    // --- 4. F1/F2ハイブリッドWorkerの呼び出し ---
    async function renderMosaicWithWorker(
        targetCanvas, 
        lightParams,
        heavyParams,
        isRerender
    ) {
        
        const t_f1f2_start = performance.now(); 

        try {
            const t_f1f2_bitmap_start = performance.now();
            const mainImageBitmap = await createImageBitmap(mainImage);
            const edgeImageBitmap = edgeCanvas ? await createImageBitmap(edgeCanvas) : null;
            const thumbSheetBitmap = await createImageBitmap(thumbSheetImage);
            
            let imageData = null;
            // ★★★ 修正: 競合フリーズ対策 - transferList を初期化 ★★★
            let transferList = [mainImageBitmap, thumbSheetBitmap];
            if (edgeImageBitmap) transferList.push(edgeImageBitmap);

            const mainCtx = mainCanvas.getContext('2d', { willReadFrequently: true });
            mainCtx.clearRect(0, 0, mainImage.width, mainImage.height);
            mainCtx.drawImage(mainImage, 0, 0); 
            imageData = mainCtx.getImageData(0, 0, mainImage.width, mainImage.height); 
            
            // ★★★ 修正: 競合フリーズ対策 - imageBuffer を transferList に追加しない ★★★
            // transferList.push(imageData.data.buffer); // <-- 削除 (コピーさせる)
            
            const t_f1f2_bitmap_end = performance.now();
            
            statusText.textContent = `ステータス: F1/F2 Worker実行中...`;
            
            const tileSize = heavyParams.tileSize;
            if (!tileSize || tileSize < 1 || isNaN(tileSize)) {
                throw new Error(`不正なタイルサイズです: ${tileSize}。1以上の数値を入力してください。`);
            }
            
            const hybridWorker = new Worker('./mosaic_worker.js');
            workers.push(hybridWorker); 
            
            const t_f1f2_worker_start = performance.now();
            const workerPromise = new Promise((resolve, reject) => {
                hybridWorker.onmessage = (e) => {
                    if (e.data.type === 'complete') {
                        const finalBitmap = e.data.bitmap;
                        const ctx = targetCanvas.getContext('2d');
                        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
                        ctx.drawImage(finalBitmap, 0, 0);
                        finalBitmap.close(); 
                        
                        // ( ... ログ出力 (変更なし) ... )
                        const t_f1f2_worker_end = performance.now();
                        if(timingLog) {
                            // ( ... ログ ... )
                        }
                        
                        resolve();
                        
                    } else if (e.data.type === 'status') {
                        statusText.textContent = `ステータス (F1/F2 Worker): ${e.data.message}`;
                    } else if (e.data.type === 'progress') {
                        if (progressBar) progressBar.style.width = `${e.data.progress * 100}%`;
                    } else if (e.data.type === 'error') {
                        reject(new Error(e.data.message));
                    }
                    terminateWorkers(); 
                };
                hybridWorker.onerror = (error) => {
                    reject(new Error(`F1/F2 Worker error: ${error.message}`));
                    terminateWorkers(); 
                };
                
                // ★★★ 修正: 第2引数 (transferList) を削除 ★★★
                hybridWorker.postMessage({
                    // F1用
                    imageBuffer: imageData.data.buffer, 
                    tileSize: heavyParams.tileSize,
                    width: mainImage.width,
                    height: mainImage.height,
                    brightnessCompensation: lightParams.brightnessCompensation,
                    textureWeight: heavyParams.textureWeight,
                    startY: 0, 
                    endY: mainImage.height, 
                    
                    // F2用
                    mainImageBitmap: mainImageBitmap,
                    edgeImageBitmap: edgeImageBitmap,
                    thumbSheetBitmap: thumbSheetBitmap,
                    lightParams: lightParams,
                    
                    isRerender: isRerender
                    
                }); // <-- transferList を削除
            });
            
            await workerPromise; 

            statusText.textContent = 'ステータス: モザイクアートが完成しました！';
            
        } catch (err) {
            statusText.textContent = `エラー: F1/F2 Workerの起動に失敗しました。 ${err.message}`;
            console.error("F1/F2 Hybrid Worker failed:", err);
        } finally {
            isGeneratingF1F2 = false;
            generateButton.disabled = false;
            if (downloadButton) downloadButton.style.display = 'block';
            
            if (!preloadPromise) {
                startF3Preload(tileData);
            }
        }
    }

    // --- 5. ダウンロード機能 (F3) ---
    if (downloadButton) {
        
        const allDownloadParams = [resolutionScaleInput, jpegQualityInput];

        downloadButton.addEventListener('click', () => { 
            resetParameterStyles(allDownloadParams);
            
            if (isGeneratingF1F2 || isGeneratingFullRes) {
                console.warn("[Button Click] 既に別の処理が実行中です。");
                return;
            } 
            
            if (!mainImage) {
                 statusText.textContent = 'エラー: メイン画像がありません。';
                 return;
            }

            if (downloadWarningArea) downloadWarningArea.style.display = 'none';
            lastGeneratedBlob = null;
            
            isGeneratingFullRes = true;
            generateButton.disabled = true;
            downloadButton.disabled = true;
            if (downloadSpinner) downloadSpinner.style.display = 'inline-block';

            t_f3_click = performance.now();

            if (!preloadPromise) {
                 statusText.textContent = 'エラー: F3プリロードがまだ開始されていません。F2の描画が完了してから再度お試しください。';
                 isGeneratingFullRes = false;
                 generateButton.disabled = false;
                 downloadButton.disabled = false;
                 return;
            }

            statusText.textContent = 'ステータス: F3プリロードの完了を待機中... 完了次第、自動的にダウンロードを開始します。';
            
            const t_f3_wait_start = performance.now();
            
            const f3_scale = parseFloat(resolutionScaleInput.value);
            const f3_quality = parseInt(jpegQualityInput.value) / 100.0;
            if(timingLog) {
                // ( ... F3パラメータログ (変更なし) ... )
            }
            
            preloadPromise.then(async () => {
                const t_f3_wait_end = performance.now();
                if(timingLog) {
                    timingLog.textContent += `\n[F3] メインスレッド: プリロード待機: ${((t_f3_wait_end - t_f3_wait_start)/1000.0).toFixed(3)} 秒`;
                }
                statusText.textContent = 'ステータス: プリロード完了。F3 Workerを起動します...';

                try {
                    const lightParams = {
                        blendOpacity: parseInt(blendRangeInput.value),
                        edgeOpacity: parseInt(edgeOpacityInput.value),
                        brightnessCompensation: parseInt(brightnessCompensationInput.value)
                    };

                    const t_f3_bitmap_start = performance.now();
                    const mainImageBitmap = await createImageBitmap(mainImage);
                    const edgeImageBitmap = edgeCanvas ? await createImageBitmap(edgeCanvas) : null;
                    
                    const mainCtx = mainCanvas.getContext('2d', { willReadFrequently: true });
                    mainCtx.clearRect(0, 0, mainImage.width, mainImage.height);
                    mainCtx.drawImage(mainImage, 0, 0); 
                    const imageData = mainCtx.getImageData(0, 0, mainImage.width, mainImage.height); 
                    
                    const bitmapsToSend = new Map();
                    // ★★★ 修正: 競合フリーズ対策 - transferList を初期化 ★★★
                    let transferList = [mainImageBitmap]; 
                    if (edgeImageBitmap) transferList.push(edgeImageBitmap);
                    
                    let totalSendSize = 0;
                    const bitmapCreationPromises = [];
                    
                    for (const [index, buffer] of f3SheetCache.entries()) {
                        if (buffer) {
                            totalSendSize += buffer.byteLength;
                            bitmapCreationPromises.push(
                                createImageBitmap(new Blob([buffer]))
                                    .then(bitmap => {
                                        bitmapsToSend.set(index, bitmap);
                                        transferList.push(bitmap); // ★ Bitmapの転送はOK
                                    })
                            );
                        } else {
                            console.warn(`[F3] Preload cache missing for sheet ${index}.`);
                        }
                    }
                    
                    await Promise.all(bitmapCreationPromises);
                    const t_f3_bitmap_end = performance.now();
                    
                    if(timingLog) timingLog.textContent += `\n[F3] メインスレッド: F3スプライトシート (Buffer to Bitmap): ${((t_f3_bitmap_end - t_f3_bitmap_start)/1000.0).toFixed(3)} 秒 (${(totalSendSize / 1024 / 1024).toFixed(2)} MB)`;

                    statusText.textContent = 'ステータス: Workerに描画とエンコードを委譲中...';
                    
                    const tileSize = parseInt(tileSizeInput.value);
                    if (!tileSize || tileSize < 1 || isNaN(tileSize)) {
                        throw new Error(`不正なタイルサイズです: ${tileSize}。1以上の数値を入力してください。`);
                    }
                    
                    const downloadWorker = new Worker('./download_worker.js'); 
                    workers.push(downloadWorker);
                    
                    const t_f3_worker_start = performance.now();
                    const workerPromise = new Promise((resolve, reject) => {
                        downloadWorker.onmessage = (e) => {
                            if (e.data.type === 'complete') {
                                // ( ... ログ出力 (変更なし) ... )
                                const t_f3_worker_end = performance.now();
                                if (timingLog) {
                                    // ( ... ログ ... )
                                }
                                const blob = new Blob([e.data.buffer], { type: e.data.mimeType });
                                resolve(blob);
                            } else if (e.data.type === 'error') {
                                reject(new Error(e.data.message));
                            }
                            terminateWorkers(); 
                        };
                        downloadWorker.onerror = (error) => {
                            reject(new Error(`Worker error: ${error.message}`));
                            terminateWorkers(); 
                        };
                        
                        // ★★★ 修正: 第2引数 (transferList) をBitmapのみに限定 ★★★
                        downloadWorker.postMessage({
                            sheetBitmaps: bitmapsToSend, 
                            
                            imageBuffer: imageData.data.buffer, // ★ imageBufferはコピー
                            tileSize: tileSize,
                            textureWeight: parseFloat(textureWeightInput.value) / 100.0,
                            
                            mainImageBitmap: mainImageBitmap, 
                            edgeImageBitmap: edgeImageBitmap,
                            width: mainImage.width,
                            height: mainImage.height,
                            lightParams: lightParams,
                            scale: f3_scale, 
                            quality: f3_quality
                        }, transferList); // ★ 修正: transferList には Bitmap のみ含まれる
                    });
                    
                    const blob = await workerPromise;
                    
                    // ( ... ファイルサイズチェック (変更なし) ... )
                    const fileSizeMB = blob.size / 1024 / 1024;
                    const limitMB = 15;
                    if (fileSizeMB <= limitMB || !downloadWarningArea) {
                        statusText.textContent = `ステータス: 高画質版 ( ${fileSizeMB.toFixed(1)} MB) の準備完了。`;
                        downloadBlob(blob, `photomosaic-${Date.now()}.jpg`);
                    } else {
                        lastGeneratedBlob = blob; 
                        downloadWarningMessage.textContent = `警告: ファイルサイズが ${fileSizeMB.toFixed(1)} MB となり、X/Twitterの上限(15MB)を超えています。このままダウンロードしますか？`;
                        downloadWarningArea.style.display = 'block';
                        statusText.textContent = 'ステータス: 警告！ ファイルサイズが15MBを超えました。';
                    }

                } catch (err) {
                    statusText.textContent = `エラー: 高画質版の生成またはダウンロードに失敗しました。 ${err.message}`;
                    console.error("Download failed:", err);
                } finally {
                    isGeneratingFullRes = false;
                    generateButton.disabled = false;
                    if (downloadWarningArea.style.display !== 'block') {
                         downloadButton.disabled = false;
                    }
                }
            }); 
        });
    }

    // --- 6. 警告ボタンのリスナー (変更なし) ---
    if (warningYesButton && warningNoButton) {
        // ( ... 変更なし ... )
    }

});

// ( ... downloadBlobヘルパー関数 (変更なし) ... )
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100); 
}
